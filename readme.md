# ALICE — Adaptive Learning Interview Coaching Engine

Application de révision & d'entraînement aux entretiens techniques : tu fournis des slides (PDF), ALICE en fait un cours structuré (via NotebookLM), puis génère des QCM, des sessions d'interview et un assistant RAG local sur tes chapitres — le tout avec un LLM Ollama local pour la partie interactive.

Stack : **Tauri 2** + **React** + **Python** (FastAPI, ChromaDB, sentence-transformers, Ollama, notebooklm-py).

## Prérequis

- **Node.js** (npm)
- **Python 3.11+**
- **Rust** (pour `npm run tauri dev` / build `.exe`) — [install](https://rustup.rs/)
- **Ollama** en local pour le LLM ([ollama.com](https://ollama.com)) — ex. `ollama pull gemma2:2b`
- **Compte Google** avec accès à NotebookLM (pour la génération automatique de cours)

## Installation

```bash
cd alice
npm install
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

Premier lancement : les **embeddings** (`sentence-transformers`) seront téléchargés (une fois).

## Lancer l’app (développement)

Deux terminaux :

1. **Backend** (port `8765`) :

```bash
cd alice
npm run dev:backend
```

1. **Tauri + Vite** :

```bash
cd alice
npm run tauri dev
```

Ou une seule commande :

```bash
npm run dev:full
```

## Contenu des cours

Deux manières d'ajouter un chapitre depuis l'écran **Importer** :

### 1. Mode automatique (recommandé) — via NotebookLM

Une seule fois, authentifier `notebooklm-py` dans un terminal (ouvre un navigateur) :

```bash
pip install "notebooklm-py[browser]"
playwright install chromium
notebooklm login
```

Ensuite dans l'app, onglet **Importer → Automatique** : uploader un fichier source (`.pdf`, `.md`, `.txt`, `.docx`), renseigner matière + chapitre, cliquer **Générer**. Pipeline en deux étapes :

1. **Source → Cours** : un notebook NotebookLM est créé à partir du fichier source, le cours markdown est généré (prompt : [subjects/NOTEBOOKLM_PROMPT.md](subjects/NOTEBOOKLM_PROMPT.md)) puis rangé sous `subjects/<matière>/<chapitre>/Cours.md`.
2. **Cours → Quiz** : un second notebook (suffixe `[Cours]`) est créé avec **`Cours.md` comme seule source**, pour que le QCM ne référence que le contenu du cours généré (et pas des passages du PDF que NotebookLM avait filtrés).

La taxonomie est mise à jour et le RAG réindexé. Compter 1–3 min par chapitre.

### 2. Mode manuel — import d'un markdown existant

Onglet **Importer → Manuel** : coller le prompt dans NotebookLM à la main, uploader le markdown obtenu. Utile si la session NotebookLM n'est pas configurée, ou pour réimporter un cours déjà produit.

### Édition directe

- Éditer `[subjects/taxonomy.yaml](subjects/taxonomy.yaml)` (matières → cours → chapitres).
- Placer les fichiers par chapitre sous `subjects/...` (PDF, Markdown, `.ipynb`, `.py`).
- Dans l’app : **Réindexer RAG** (écran Cours) après ajout de fichiers.

### Suppression

- **Chapitre** : icône poubelle au survol dans l'arbre. Supprime uniquement le chapitre ; la matière reste (même vide).
- **Matière** : icône poubelle au survol sur la ligne matière. Cascade — supprime tous les chapitres et leurs fichiers. Une matière peut aussi exister sans chapitre.

## Réglages

- **Réglages** : URL Ollama (défaut `http://127.0.0.1:11434`) et nom du modèle.
- Variables d’environnement optionnelles : `OLLAMA_HOST`, `OLLAMA_MODEL`, `ALICE_SUBJECTS_ROOT`, `ALICE_CHROMA_PATH`, `ALICE_SQLITE_PATH`.

## Build production (frontend web)

```bash
npm run build
```

Les assets sont dans `dist/`. L’UI appelle alors `http://127.0.0.1:8765` (backend à lancer à part).

