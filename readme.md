# ALICE — Adaptive Learning Interview Coaching Engine

Desktop app to **study and practice technical interviews**, built around your own material. Feed it slides (PDF) and ALICE turns them into a structured course (via NotebookLM), then layers a quiz bank, a curated interview-question trainer, a local RAG assistant over your chapters, and a podcast/video transcript library on top — with all the interactive reasoning driven by a **local Ollama LLM**.

Stack: **Tauri 2** + **React** + **Python** (FastAPI, ChromaDB, sentence-transformers, Ollama, notebooklm-py, faster-whisper).

## App sections

The sidebar groups every screen into three areas plus settings:

### Apprentissage (Learning)

- **Tableau de bord** (`/dashboard`) — home overview: your progress, quiz scores, and recent activity at a glance.
- **Cours** (`/`) — browse the subject → chapter tree and read each chapter. A built-in **RAG assistant** answers questions grounded in the selected chapter (ChromaDB + sentence-transformers retrieval, Ollama for the answer). Includes **Reindex RAG** after you add or edit files. See [Course content](#course-content).
- **Quiz** (`/quiz`) — a per-subject question bank pre-generated via RAG + Ollama. Generate the bank for a subject, take quizzes, and keep a scored history.

### Pratique (Practice)

- **Interviews** (`/interviews`) — open-ended interview training over a **curated data-science question bank** (see [Interview question bank](#interview-question-bank)). Pick a topic, then either **draw a random question** or **browse and search** the topic's questions to pick a specific one. You answer freely; **Ollama grades** your answer against the reference, gives a score, strengths/gaps, and **hints on demand**. Questions render in **FR or EN** (toggle), with attachments (images/tables) inline.
- **Podcasts** (`/podcasts`) — a searchable **transcript library** from Spotify episodes or YouTube videos. See [Podcasts](#podcasts-transcript--video-library).

### Importer (Import)

- **Cours (NotebookLM)** (`/import`) — generate a chapter automatically from a source file via NotebookLM, or import an existing markdown course by hand. See [Course content](#course-content).
- **GitHub** (`/github-import`) — import a public GitHub repository into ALICE's RAG knowledge base (optionally with a token for private/large repos), so the Courses assistant can answer over its files.

### Réglages (Settings)

- **Apparence** — switch between the **Soft Minimal** light and dark themes (persisted locally).
- **Ollama**, **Podcasts**, **Transcription** — see [Settings](#settings).

## Requirements

- **Node.js** (npm)
- **Python 3.11+**
- **Rust** (for `npm run tauri dev` / `.exe` build) — [install](https://rustup.rs/)
- **Ollama** running locally for the LLM ([ollama.com](https://ollama.com)) — e.g. `ollama pull gemma2:2b`
- **Google account** with NotebookLM access (for the automatic course generator)
- **NVIDIA GPU + recent driver** — only for **local** podcast transcription (faster-whisper is GPU-only). Not required if you transcribe via a cloud provider (Groq/Deepgram). Minimum: Pascal-class (compute capability 6.0) with 3+ GB VRAM. Recommended: Turing+ with 6+ GB.

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

2. **Tauri + Vite**:

```bash
cd alice
npm run tauri dev
```

Or a single command:

```bash
npm run dev:full
```

## Course content

Two ways to add a chapter from the **Importer → Cours** screen:

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
- In the app: **Reindex RAG** (Cours screen) after adding files.

### Deletion

- **Chapter**: trash icon on hover in the tree. Deletes only the chapter; the subject stays (even if empty).
- **Subject**: trash icon on hover on the subject row. Cascading — deletes every chapter and their files. A subject can also exist without any chapter.

## Interview question bank

The **Interviews** screen practices against curated, open-ended data-science questions. Click **Importer la banque** (or **Ré-importer**) to build/refresh the bank from public GitHub sources:

- [`youssefHosni/Data-Science-Interview-Questions-Answers`](https://github.com/youssefHosni/Data-Science-Interview-Questions-Answers) — topic Q&A markdown files.
- [`Devinterview-io`](https://github.com/Devinterview-io) — a curated DS/ML subset (~34 topic repos: LLMs, deep learning, computer vision, feature engineering, classic ML algorithms, …). See [docs/devinterview-repos-proposal.md](docs/devinterview-repos-proposal.md).

Questions are parsed into `(question, reference answer)` pairs, stored in SQLite, and optionally **translated to French** in the background (English originals kept for the FR/EN toggle). Then per question: answer freely → Ollama grades against the reference, or ask for a hint.

## Podcasts (transcript & video library)

Paste a **Spotify episode** or **YouTube** URL → ALICE fetches the audio (Spotify resolves the matching RSS feed via [Podcast Index](https://podcastindex.org)), transcribes it, and stores segments in SQLite for browsing and full-text search. A **Résumé** mode produces a summary instead of a raw transcript. Spotify-exclusive episodes (Joe Rogan, etc.) are not supported.

**Transcription provider** (selector on the Podcasts screen, configured in Settings → Transcription):

- **Local GPU** — `faster-whisper`, no per-minute cost, needs an NVIDIA GPU.
- **Groq** / **Deepgram** — cloud APIs, no GPU required (you supply an API key).

**Local GPU model auto-selection** based on detected VRAM and compute capability (via `nvidia-smi`):

| VRAM    | Compute cap. | Model      | Compute type     |
|---------|--------------|------------|------------------|
| ≥ 10 GB | ≥ 7.0        | `large-v3` | `float16`        |
| 6–10 GB | ≥ 7.0        | `large-v3` | `int8_float16`   |
| 4–6 GB  | ≥ 7.0        | `medium`   | `float16`        |
| 3–4 GB  | ≥ 7.0        | `medium`   | `int8_float16`   |
| < 3 GB  | ≥ 6.0        | `small`    | `int8_float16`   |

First local transcription downloads the chosen model from HuggingFace (~3 GB for `large-v3`) into `~/.cache/huggingface/hub/`. Subsequent runs use the cache. Throughput on RTX 2060 6GB: ~10× realtime.

## Settings

- **Apparence** — light/dark theme toggle (Soft Minimal), persisted in the browser.
- **Ollama** — host URL (default `http://127.0.0.1:11434`) and model name; **Refresh models** lists what Ollama has pulled.
- **Podcasts** — Podcast Index **Key + Secret** ([api.podcastindex.org](https://api.podcastindex.org)) and a Spotify app **Client ID + Client Secret** ([developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), Client Credentials flow; redirect URI `http://127.0.0.1:8000/callback` is unused). Stored in `.alice_data/podcast_creds.json` (gitignored, `0600`).
- **Transcription** — provider choice and **Groq / Deepgram API keys**, stored in `.alice_data/transcription_creds.json` (gitignored).
- Optional environment variables: `OLLAMA_HOST`, `OLLAMA_MODEL`, `ALICE_SUBJECTS_ROOT`, `ALICE_CHROMA_PATH`, `ALICE_SQLITE_PATH`, `PODCAST_INDEX_KEY`, `PODCAST_INDEX_SECRET`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `ALICE_PODCAST_CREDS_PATH`, `ALICE_TRANSCRIPTION_CREDS_PATH`.

## Production build (web frontend)

```bash
npm run build
```

Assets end up in `dist/`. The UI then calls `http://127.0.0.1:8765` (backend must be started separately).
