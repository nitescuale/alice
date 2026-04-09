import os
from pathlib import Path

# Project root = parent of backend/ when running from repo
BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent

SUBJECTS_ROOT = Path(os.environ.get("ALICE_SUBJECTS_ROOT", str(PROJECT_ROOT / "subjects")))
CHROMA_PATH = Path(os.environ.get("ALICE_CHROMA_PATH", str(PROJECT_ROOT / ".alice_data" / "chroma")))
SQLITE_PATH = Path(os.environ.get("ALICE_SQLITE_PATH", str(PROJECT_ROOT / ".alice_data" / "alice.db")))

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma2:2b")

# Overrides set via POST /api/settings (session du processus backend)
_runtime_ollama_host: str | None = None
_runtime_ollama_model: str | None = None


def get_ollama_host() -> str:
    return _runtime_ollama_host or OLLAMA_HOST


def get_ollama_model() -> str:
    return _runtime_ollama_model or OLLAMA_MODEL


def set_ollama_runtime(host: str | None, model: str | None) -> None:
    global _runtime_ollama_host, _runtime_ollama_model
    if host is not None:
        _runtime_ollama_host = host.strip() or None
    if model is not None:
        _runtime_ollama_model = model.strip() or None


EMBEDDING_MODEL = os.environ.get("ALICE_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
