"""Local transcription via faster-whisper.

GPU-only : refuse de tourner sans CUDA. Le modèle et le compute_type sont
choisis dynamiquement selon la VRAM et la compute capability du GPU détecté.
La détection passe par `nvidia-smi` (zéro dépendance Python).
"""

from __future__ import annotations

import asyncio
import gc
import logging
import shutil
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_model: Any = None
_config: dict[str, Any] | None = None


def _query_nvidia_smi() -> tuple[str, int, float]:
    """Returns (gpu_name, vram_mib, compute_capability) for the first GPU.

    Raises RuntimeError if nvidia-smi is missing, fails, or no GPU is found.
    """
    if shutil.which("nvidia-smi") is None:
        raise RuntimeError(
            "Aucun GPU CUDA détecté (nvidia-smi introuvable). La transcription "
            "des podcasts est GPU-only (faster-whisper sur CPU est trop lent)."
        )
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,compute_cap",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        raise RuntimeError(
            f"nvidia-smi a échoué : {e}. Driver NVIDIA installé mais non fonctionnel ?"
        ) from e

    line = next((ln.strip() for ln in out.stdout.splitlines() if ln.strip()), "")
    if not line:
        raise RuntimeError("nvidia-smi n'a retourné aucun GPU.")

    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 3:
        raise RuntimeError(f"nvidia-smi: format inattendu '{line}'.")
    name = parts[0]
    try:
        vram_mib = int(parts[1])
        cc_val = float(parts[2])
    except ValueError as e:
        raise RuntimeError(f"nvidia-smi: parsing impossible de '{line}'.") from e
    return name, vram_mib, cc_val


def _select_config() -> dict[str, Any]:
    """Inspect the GPU and pick (model, compute_type). Raises if no CUDA."""
    name, vram_mib, cc_val = _query_nvidia_smi()
    vram_gb = vram_mib / 1024

    if cc_val < 6.0:
        raise RuntimeError(
            f"GPU {name} (compute capability {cc_val}) trop ancien pour faster-whisper. "
            "Minimum requis : Pascal (6.0)."
        )

    fp16_ok = cc_val >= 7.0

    if vram_gb >= 10 and fp16_ok:
        model_name, compute_type = "large-v3", "float16"
    elif vram_gb >= 6 and fp16_ok:
        model_name, compute_type = "large-v3", "int8_float16"
    elif vram_gb >= 4 and fp16_ok:
        model_name, compute_type = "medium", "float16"
    elif vram_gb >= 3 and fp16_ok:
        model_name, compute_type = "medium", "int8_float16"
    else:
        model_name, compute_type = "small", "int8_float16"

    return {
        "model": model_name,
        "compute_type": compute_type,
        "device": "cuda",
        "device_name": name,
        "vram_gb": round(vram_gb, 1),
        "compute_capability": cc_val,
    }


def get_config() -> dict[str, Any]:
    global _config
    if _config is None:
        _config = _select_config()
    return _config


def _load_model() -> Any:
    global _model
    if _model is not None:
        return _model
    cfg = get_config()
    from faster_whisper import WhisperModel

    logger.info(
        "Whisper: %s on %s (%s, %sGB VRAM)",
        cfg["model"],
        cfg["device_name"],
        cfg["compute_type"],
        cfg["vram_gb"],
    )
    _model = WhisperModel(
        cfg["model"],
        device=cfg["device"],
        compute_type=cfg["compute_type"],
    )
    return _model


def _transcribe_sync(
    audio_path: Path,
    language: str | None,
    progress_cb: Any = None,
) -> dict[str, Any]:
    model = _load_model()
    cfg = get_config()
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        beam_size=1,
        condition_on_previous_text=False,
    )
    duration = float(info.duration) if info.duration else 0.0
    segments: list[dict[str, Any]] = []
    for s in segments_iter:
        segments.append(
            {"start": float(s.start), "end": float(s.end), "text": s.text.strip()}
        )
        if progress_cb is not None and duration > 0:
            try:
                progress_cb(min(1.0, float(s.end) / duration))
            except Exception:  # noqa: BLE001
                pass
    return {
        "language": info.language,
        "segments": segments,
        "duration": duration,
        "model_used": f"{cfg['model']}/{cfg['compute_type']}",
    }


async def transcribe(
    audio_path: Path,
    language: str | None = None,
    progress_cb: Any = None,
) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, _transcribe_sync, audio_path, language, progress_cb
    )


def unload_model() -> None:
    """Drop the Whisper model from memory + free CUDA VRAM.

    Lets Ollama reclaim the GPU for the LLM cleanup pass on shared-GPU
    setups (RTX 2060 6GB etc.). Next transcribe() reloads from disk
    (~5-10s extra).
    """
    global _model
    if _model is None:
        return
    logger.info("Whisper: unloading model to free VRAM")
    _model = None
    gc.collect()
