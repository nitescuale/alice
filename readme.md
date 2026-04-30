# ALICE — Adaptive Learning Interview Coaching Engine

Desktop app for studying and practicing technical interviews: feed it slides (PDF), ALICE turns them into a structured course (via NotebookLM), then generates quizzes, interview sessions, and a local RAG assistant over your chapters — all driven by a local Ollama LLM for the interactive parts. A separate **Podcasts** module turns Spotify episode URLs into searchable transcripts via local GPU transcription.

Stack: **Tauri 2** + **React** + **Python** (FastAPI, ChromaDB, sentence-transformers, Ollama, notebooklm-py, faster-whisper).

## Requirements

- **Node.js** (npm)
- **Python 3.11+**
- **Rust** (for `npm run tauri dev` / `.exe` build) — [install](https://rustup.rs/)
- **Ollama** running locally for the LLM ([ollama.com](https://ollama.com)) — e.g. `ollama pull gemma2:2b`
- **Google account** with NotebookLM access (for the automatic course generator)
- **NVIDIA GPU + recent driver** (only if you use the Podcasts module — faster-whisper is GPU-only). Minimum: Pascal-class (compute capability 6.0) with 3+ GB VRAM. Recommended: Turing+ with 6+ GB.

## Installation

```bash
cd alice
npm install
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

First run: the **embeddings** (`sentence-transformers`) will be downloaded (once).

## Run the app (development)

Two terminals:

1. **Backend** (port `8765`):

```bash
cd alice
npm run dev:backend
```

1. **Tauri + Vite**:

```bash
cd alice
npm run tauri dev
```

Or a single command:

```bash
npm run dev:full
```

## Course content

Two ways to add a chapter from the **Import** screen:

### 1. Automatic mode (recommended) — via NotebookLM

One-time setup: authenticate `notebooklm-py` in a terminal (opens a browser):

```bash
pip install "notebooklm-py[browser]"
playwright install chromium
notebooklm login
```

Then in the app, tab **Import → Automatic**: upload a source file (`.pdf`, `.md`, `.txt`, `.docx`), fill in subject + chapter, click **Generate**. Two-stage pipeline:

1. **Source → Course**: a NotebookLM notebook is created from the source file, the markdown course is generated (prompt: [subjects/NOTEBOOKLM_PROMPT.md](subjects/NOTEBOOKLM_PROMPT.md)) and saved under `subjects/<subject>/<chapter>/Cours.md`.
2. **Course → Quiz**: a second notebook (suffix `[Cours]`) is created with **`Cours.md` as the only source**, so the quiz only references the generated course content (and not passages from the PDF that NotebookLM had filtered out).

The taxonomy is updated and the RAG re-indexed. Budget 1–3 min per chapter.

### 2. Manual mode — import an existing markdown

Tab **Import → Manual**: paste the prompt into NotebookLM by hand, then upload the resulting markdown. Useful if the NotebookLM session is not set up, or to re-import a course you already produced.

### Direct editing

- Edit [subjects/taxonomy.yaml](subjects/taxonomy.yaml) (subjects → courses → chapters).
- Drop per-chapter files under `subjects/...` (PDF, Markdown, `.ipynb`, `.py`).
- In the app: **Reindex RAG** (Courses screen) after adding files.

### Deletion

- **Chapter**: trash icon on hover in the tree. Deletes only the chapter; the subject stays (even if empty).
- **Subject**: trash icon on hover on the subject row. Cascading — deletes every chapter and their files. A subject can also exist without any chapter.

## Podcasts (transcript library)

Independent module: paste a Spotify episode URL → ALICE resolves the matching RSS feed via [Podcast Index](https://podcastindex.org), downloads the audio, transcribes it locally on GPU, and stores segments in SQLite for browsing and full-text search. Spotify-exclusive episodes (Joe Rogan, etc.) are not supported.

**One-time setup** (Settings → Podcasts):

1. Free API key from [api.podcastindex.org](https://api.podcastindex.org) (sign up → "Get an API Key"). Yields **Key + Secret**.
2. App on [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → "Create app" with redirect URI `http://127.0.0.1:8000/callback` (unused — Client Credentials flow). Yields **Client ID + Client Secret**.
3. Paste all four into Settings → **Save**. Stored in `.alice_data/podcast_creds.json` (gitignored, `0600`) and reloaded at backend startup.

**GPU model auto-selection** based on detected VRAM and compute capability (via `nvidia-smi`):

| VRAM    | Compute cap. | Model      | Compute type     |
|---------|--------------|------------|------------------|
| ≥ 10 GB | ≥ 7.0        | `large-v3` | `float16`        |
| 6–10 GB | ≥ 7.0        | `large-v3` | `int8_float16`   |
| 4–6 GB  | ≥ 7.0        | `medium`   | `float16`        |
| 3–4 GB  | ≥ 7.0        | `medium`   | `int8_float16`   |
| < 3 GB  | ≥ 6.0        | `small`    | `int8_float16`   |

First transcription downloads the chosen model from HuggingFace (~3 GB for `large-v3`) into `~/.cache/huggingface/hub/`. Subsequent runs use the cache. Throughput on RTX 2060 6GB: ~10× realtime.

## Settings

- **Settings → Ollama**: host URL (default `http://127.0.0.1:11434`) and model name.
- **Settings → Podcasts**: 4 credentials (see above).
- Optional environment variables: `OLLAMA_HOST`, `OLLAMA_MODEL`, `ALICE_SUBJECTS_ROOT`, `ALICE_CHROMA_PATH`, `ALICE_SQLITE_PATH`, `PODCAST_INDEX_KEY`, `PODCAST_INDEX_SECRET`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `ALICE_PODCAST_CREDS_PATH`.

## Production build (web frontend)

```bash
npm run build
```

Assets end up in `dist/`. The UI then calls `http://127.0.0.1:8765` (backend must be started separately).
