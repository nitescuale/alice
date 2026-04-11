"""Chroma + sentence-transformers retrieval."""

from __future__ import annotations

import uuid
from typing import Any

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer

from alice_server.config import CHROMA_PATH, EMBEDDING_MODEL

COLLECTION_COURSES = "alice_courses"
COLLECTION_INTERVIEWS = "alice_interviews"

_model: SentenceTransformer | None = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(EMBEDDING_MODEL)
    return _model


def get_client() -> chromadb.PersistentClient:
    CHROMA_PATH.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(CHROMA_PATH), settings=Settings(anonymized_telemetry=False))


def get_course_collection():
    client = get_client()
    return client.get_or_create_collection(
        name=COLLECTION_COURSES,
        metadata={"hnsw:space": "cosine"},
    )


def get_interview_collection():
    client = get_client()
    return client.get_or_create_collection(
        name=COLLECTION_INTERVIEWS,
        metadata={"hnsw:space": "cosine"},
    )


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = get_model()
    return model.encode(texts, show_progress_bar=False).tolist()


def upsert_course_chunks(
    ids: list[str],
    documents: list[str],
    metadatas: list[dict[str, Any]],
) -> None:
    col = get_course_collection()
    embeddings = embed_texts(documents)
    col.upsert(ids=ids, documents=documents, metadatas=metadatas, embeddings=embeddings)


def query_courses(
    query: str,
    n_results: int = 8,
    chapter_id: str | None = None,
    subject_id: str | None = None,
) -> dict[str, Any]:
    col = get_course_collection()
    emb = embed_texts([query])[0]
    where: dict[str, Any] | None = None
    conds: list[dict[str, Any]] = []
    if chapter_id:
        conds.append({"chapter_id": chapter_id})
    if subject_id:
        conds.append({"subject_id": subject_id})
    if len(conds) == 1:
        where = conds[0]
    elif len(conds) > 1:
        where = {"$and": conds}

    return col.query(
        query_embeddings=[emb],
        n_results=n_results,
        where=where,
        include=["documents", "metadatas", "distances"],
    )


def upsert_interview_chunks(
    ids: list[str],
    documents: list[str],
    metadatas: list[dict[str, Any]],
) -> None:
    col = get_interview_collection()
    embeddings = embed_texts(documents)
    col.upsert(ids=ids, documents=documents, metadatas=metadatas, embeddings=embeddings)


def query_interviews(
    query: str,
    n_results: int = 6,
    company: str | None = None,
) -> dict[str, Any]:
    col = get_interview_collection()
    emb = embed_texts([query])[0]
    where = {"company": company} if company else None
    return col.query(
        query_embeddings=[emb],
        n_results=n_results,
        where=where,
        include=["documents", "metadatas", "distances"],
    )


def new_id() -> str:
    return str(uuid.uuid4())
