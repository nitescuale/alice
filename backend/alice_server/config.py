import json
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

# Persisted credentials (gitignored). Env vars > on-disk file > empty.
PODCAST_CREDS_PATH = Path(
    os.environ.get("ALICE_PODCAST_CREDS_PATH", str(PROJECT_ROOT / ".alice_data" / "podcast_creds.json"))
)


def _load_persisted_podcast_creds() -> dict[str, str]:
    try:
        if PODCAST_CREDS_PATH.is_file():
            return json.loads(PODCAST_CREDS_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


_persisted = _load_persisted_podcast_creds()
_runtime_pi_key: str | None = _persisted.get("podcast_index_key") or None
_runtime_pi_secret: str | None = _persisted.get("podcast_index_secret") or None
_runtime_sp_id: str | None = _persisted.get("spotify_client_id") or None
_runtime_sp_secret: str | None = _persisted.get("spotify_client_secret") or None


def get_podcast_index_creds() -> tuple[str, str]:
    # Env vars take precedence over persisted runtime values.
    return (
        PODCAST_INDEX_KEY or _runtime_pi_key or "",
        PODCAST_INDEX_SECRET or _runtime_pi_secret or "",
    )


def get_spotify_creds() -> tuple[str, str]:
    return (
        SPOTIFY_CLIENT_ID or _runtime_sp_id or "",
        SPOTIFY_CLIENT_SECRET or _runtime_sp_secret or "",
    )


def _persist_podcast_creds() -> None:
    PODCAST_CREDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "podcast_index_key": _runtime_pi_key or "",
        "podcast_index_secret": _runtime_pi_secret or "",
        "spotify_client_id": _runtime_sp_id or "",
        "spotify_client_secret": _runtime_sp_secret or "",
    }
    PODCAST_CREDS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    try:
        os.chmod(PODCAST_CREDS_PATH, 0o600)
    except Exception:
        pass


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
    _persist_podcast_creds()
