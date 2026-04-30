import os
from pathlib import Path

# Project root = parent of backend/ when running from repo
BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent

SUBJECTS_ROOT = Path(os.environ.get("ALICE_SUBJECTS_ROOT", str(PROJECT_ROOT / "subjects")))
CHROMA_PATH = Path(os.environ.get("ALICE_CHROMA_PATH", str(PROJECT_ROOT / ".alice_data" / "chroma")))
SQLITE_PATH = Path(os.environ.get("ALICE_SQLITE_PATH", str(PROJECT_ROOT / ".alice_data" / "alice.db")))

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4:e4b")

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

PODCAST_INDEX_KEY = os.environ.get("PODCAST_INDEX_KEY", "")
PODCAST_INDEX_SECRET = os.environ.get("PODCAST_INDEX_SECRET", "")
SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "")

_runtime_pi_key: str | None = None
_runtime_pi_secret: str | None = None
_runtime_sp_id: str | None = None
_runtime_sp_secret: str | None = None


def get_podcast_index_creds() -> tuple[str, str]:
    return (_runtime_pi_key or PODCAST_INDEX_KEY, _runtime_pi_secret or PODCAST_INDEX_SECRET)


def get_spotify_creds() -> tuple[str, str]:
    return (_runtime_sp_id or SPOTIFY_CLIENT_ID, _runtime_sp_secret or SPOTIFY_CLIENT_SECRET)


def set_podcast_runtime(
    pi_key: str | None = None,
    pi_secret: str | None = None,
    sp_id: str | None = None,
    sp_secret: str | None = None,
) -> None:
    global _runtime_pi_key, _runtime_pi_secret, _runtime_sp_id, _runtime_sp_secret
    if pi_key is not None:
        _runtime_pi_key = pi_key.strip() or None
    if pi_secret is not None:
        _runtime_pi_secret = pi_secret.strip() or None
    if sp_id is not None:
        _runtime_sp_id = sp_id.strip() or None
    if sp_secret is not None:
        _runtime_sp_secret = sp_secret.strip() or None
