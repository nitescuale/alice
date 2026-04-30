"""Local transcription via faster-whisper.

GPU-only : refuse de tourner sans CUDA. Le modèle et le compute_type sont
choisis dynamiquement selon la VRAM et la compute capability du GPU détecté.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_model: Any = None
_config: dict[str, Any] | None = None


def _select_config() -> dict[str, Any]:
    """Inspect the GPU and pick (model, compute_type). Raises if no CUDA."""
    try:
        import torch
    except ImportError as e:
        raise RuntimeError(
            "PyTorch n'est pas installé. La transcription requiert un GPU CUDA."
        ) from e

    if not torch.cuda.is_available():
        raise RuntimeError(
            "Aucun GPU CUDA détecté. La transcription des podcasts est GPU-only "
            "(faster-whisper sur CPU est trop lent pour être utilisable)."
        )

    props = torch.cuda.get_device_properties(0)
    vram_gb = props.total_memory / (1024**3)
    cc = torch.cuda.get_device_capability(0)
    cc_major, cc_minor = cc
    cc_val = cc_major + cc_minor / 10
    name = props.name

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


def _transcribe_sync(audio_path: Path, language: str | None) -> dict[str, Any]:
    model = _load_model()
    cfg = get_config()
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        vad_filter=True,
        beam_size=5,
    )
    segments = [
        {"start": float(s.start), "end": float(s.end), "text": s.text.strip()}
        for s in segments_iter
    ]
    return {
        "language": info.language,
        "segments": segments,
        "duration": float(info.duration),
        "model_used": f"{cfg['model']}/{cfg['compute_type']}",
    }


async def transcribe(audio_path: Path, language: str | None = None) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _transcribe_sync, audio_path, language)
