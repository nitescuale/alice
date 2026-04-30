"""Local GPU transcription with two backends.

At first use, ALICE picks one of:

  - **CUDA** via faster-whisper (NVIDIA GPUs, fastest path).
  - **Vulkan** via whisper.cpp (any GPU with Vulkan drivers — AMD, Intel, integrated).

CPU is intentionally NOT supported (faster-whisper / whisper.cpp on CPU are
both too slow for typical podcast lengths).

Backend selection happens once, lazily, on the first call to ``get_config()``.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_model: Any = None
_config: dict[str, Any] | None = None


# ─── NVIDIA / CUDA detection ────────────────────────────────────────────────


def _query_nvidia_smi() -> tuple[str, int, float]:
    """Returns (gpu_name, vram_mib, compute_capability) for the first GPU.

    Raises RuntimeError if nvidia-smi is missing, fails, or no GPU is found.
    """
    if shutil.which("nvidia-smi") is None:
        raise RuntimeError("nvidia-smi introuvable")
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
        raise RuntimeError(f"nvidia-smi a échoué : {e}") from e

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


def _select_cuda_config() -> dict[str, Any]:
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
        "backend": "cuda",
        "model": model_name,
        "compute_type": compute_type,
        "device": "cuda",
        "device_name": name,
        "vram_gb": round(vram_gb, 1),
        "compute_capability": cc_val,
    }


# ─── Vulkan / whisper.cpp detection ─────────────────────────────────────────


def _vulkan_available() -> bool:
    """Cheap check for a Vulkan loader on the system.

    We don't need a full Vulkan device probe here — pywhispercpp will fail
    with a clear error if no usable device is found. We just want to avoid
    importing pywhispercpp on machines that obviously have nothing.
    """
    if shutil.which("vulkaninfo"):
        return True
    if os.name == "nt":
        sysroot = os.environ.get("SYSTEMROOT", r"C:\Windows")
        return (Path(sysroot) / "System32" / "vulkan-1.dll").exists()
    candidates = [
        "/usr/lib/x86_64-linux-gnu/libvulkan.so.1",
        "/usr/lib/libvulkan.so.1",
        "/usr/lib64/libvulkan.so.1",
    ]
    return any(Path(p).exists() for p in candidates)


def _select_vulkan_config() -> dict[str, Any]:
    # We can't reliably probe AMD/Intel VRAM without extra deps, so we pick
    # a sensible default. `medium` is a good speed/quality trade-off and
    # whisper.cpp will download the ggml weights on first use.
    model_name = os.environ.get("ALICE_WHISPERCPP_MODEL", "medium")
    return {
        "backend": "vulkan",
        "model": model_name,
        "compute_type": "f16",
        "device": "vulkan",
        "device_name": "Vulkan GPU",
        "vram_gb": None,
        "compute_capability": None,
    }


# ─── Top-level selection ────────────────────────────────────────────────────


def _select_config() -> dict[str, Any]:
    """Pick a backend at startup. CUDA wins if available, Vulkan otherwise."""
    cuda_err: Exception | None = None
    if shutil.which("nvidia-smi") is not None:
        try:
            cfg = _select_cuda_config()
            logger.info(
                "Backend: CUDA / faster-whisper on %s (%s, %sGB)",
                cfg["device_name"], cfg["model"], cfg["vram_gb"],
            )
            return cfg
        except RuntimeError as e:
            cuda_err = e
            logger.warning("CUDA detected but unusable, falling back to Vulkan: %s", e)

    if _vulkan_available():
        cfg = _select_vulkan_config()
        logger.info("Backend: Vulkan / whisper.cpp (%s)", cfg["model"])
        return cfg

    raise RuntimeError(
        "Aucun GPU compatible détecté. ALICE a besoin soit d'un GPU NVIDIA (CUDA), "
        "soit de drivers Vulkan (AMD / Intel / GPU intégré). Le CPU n'est pas "
        f"supporté.{f' Cause CUDA : {cuda_err}' if cuda_err else ''}"
    )


def get_config() -> dict[str, Any]:
    global _config
    if _config is None:
        _config = _select_config()
    return _config


# ─── Model loading ──────────────────────────────────────────────────────────


def _load_model() -> Any:
    global _model
    if _model is not None:
        return _model
    cfg = get_config()
    if cfg["backend"] == "cuda":
        from faster_whisper import WhisperModel

        logger.info(
            "Whisper (CUDA): %s on %s (%s, %sGB VRAM)",
            cfg["model"], cfg["device_name"], cfg["compute_type"], cfg["vram_gb"],
        )
        _model = WhisperModel(
            cfg["model"], device=cfg["device"], compute_type=cfg["compute_type"],
        )
    elif cfg["backend"] == "vulkan":
        try:
            from pywhispercpp.model import Model as WhisperCppModel
        except ImportError as e:
            raise RuntimeError(
                "pywhispercpp manquant. Installe-le avec un backend Vulkan : "
                "`GGML_VULKAN=1 pip install pywhispercpp --no-binary pywhispercpp` "
                "(le SDK Vulkan doit être présent sur la machine)."
            ) from e

        logger.info("Whisper (Vulkan/whisper.cpp): %s", cfg["model"])
        _model = WhisperCppModel(cfg["model"])
    else:
        raise RuntimeError(f"Backend inconnu : {cfg['backend']!r}")
    return _model


# ─── Transcription dispatch ─────────────────────────────────────────────────


def _transcribe_sync_cuda(
    audio_path: Path, language: str | None, progress_cb: Any
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


def _probe_audio_duration(audio_path: Path) -> float:
    """Use ffprobe to get audio duration in seconds (best-effort, returns 0 on fail)."""
    if shutil.which("ffprobe") is None:
        return 0.0
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(audio_path),
            ],
            capture_output=True, text=True, timeout=15, check=True,
        )
        return float(out.stdout.strip() or 0.0)
    except Exception:  # noqa: BLE001
        return 0.0


def _transcribe_sync_vulkan(
    audio_path: Path, language: str | None, progress_cb: Any
) -> dict[str, Any]:
    model = _load_model()
    cfg = get_config()
    duration = _probe_audio_duration(audio_path)
    segments: list[dict[str, Any]] = []

    def _on_segment(segment: Any, _state: Any) -> None:
        # whisper.cpp timestamps are in centiseconds (t0/t1).
        start = float(getattr(segment, "t0", 0)) / 100.0
        end = float(getattr(segment, "t1", 0)) / 100.0
        text = (getattr(segment, "text", "") or "").strip()
        segments.append({"start": start, "end": end, "text": text})
        if progress_cb is not None and duration > 0:
            try:
                progress_cb(min(1.0, end / duration))
            except Exception:  # noqa: BLE001
                pass

    model.transcribe(
        media=str(audio_path),
        language=language or "auto",
        new_segment_callback=_on_segment,
    )

    detected_lang = language or getattr(model, "params", None)
    detected_lang = (
        getattr(detected_lang, "language", None)
        if detected_lang and not isinstance(detected_lang, str)
        else (detected_lang if isinstance(detected_lang, str) else "en")
    )

    if not duration and segments:
        duration = segments[-1]["end"]

    return {
        "language": detected_lang or "en",
        "segments": segments,
        "duration": duration,
        "model_used": f"whisper.cpp-{cfg['model']}",
    }


def _transcribe_sync(
    audio_path: Path,
    language: str | None,
    progress_cb: Any = None,
) -> dict[str, Any]:
    cfg = get_config()
    if cfg["backend"] == "cuda":
        return _transcribe_sync_cuda(audio_path, language, progress_cb)
    if cfg["backend"] == "vulkan":
        return _transcribe_sync_vulkan(audio_path, language, progress_cb)
    raise RuntimeError(f"Backend inconnu : {cfg['backend']!r}")


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
    """Drop the loaded model from memory + free GPU VRAM.

    Lets Ollama reclaim the GPU for the LLM cleanup pass on shared-GPU
    setups. Next ``transcribe()`` call will reload from disk.
    """
    global _model
    if _model is None:
        return
    logger.info("Whisper: unloading model to free VRAM")
    _model = None
    gc.collect()
