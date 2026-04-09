# ALICE — Adaptive Learning Interview Coaching Engine

Stack : **Tauri 2** + **React** + **Python** (FastAPI, ChromaDB, sentence-transformers, Ollama).

## Prérequis

- **Node.js** (npm)
- **Python 3.11+**
- **Rust** (pour `npm run tauri dev` / build `.exe`) — [install](https://rustup.rs/)
- **Ollama** en local pour le LLM ([ollama.com](https://ollama.com)) — ex. `ollama pull gemma2:2b`

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

2. **Tauri + Vite** :

```bash
cd alice
npm run tauri dev
```

Ou une seule commande :

```bash
npm run dev:full
```

## Contenu des cours

- Éditer [`subjects/taxonomy.yaml`](subjects/taxonomy.yaml) (matières → cours → chapitres).
- Placer les fichiers par chapitre sous `subjects/...` (PDF, Markdown, `.ipynb`, `.py`).
- Workflow auteur recommandé : **NotebookLM** → export manuel → ces dossiers.
- Dans l’app : **Réindexer RAG** (écran Cours) après ajout de fichiers.

## Réglages

- **Réglages** : URL Ollama (défaut `http://127.0.0.1:11434`) et nom du modèle.
- Variables d’environnement optionnelles : `OLLAMA_HOST`, `OLLAMA_MODEL`, `ALICE_SUBJECTS_ROOT`, `ALICE_CHROMA_PATH`, `ALICE_SQLITE_PATH`.

## Build production (frontend web)

```bash
npm run build
```

Les assets sont dans `dist/`. L’UI appelle alors `http://127.0.0.1:8765` (backend à lancer à part).

## Licence

Projet open source — préciser la licence choisie dans le dépôt.
