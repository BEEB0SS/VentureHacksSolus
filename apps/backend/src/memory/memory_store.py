"""
Solus Memory Store — Semantic search over past knowledge using TF-IDF.

Stores issues, fixes, document chunks, and notes. Retrieves similar items
using TF-IDF cosine similarity. Pure Python — no numpy or external ML libs.
"""

import json
import math
import re
import sys
import os
from collections import Counter
from typing import Optional

# All imports use sys.path for consistency across the project
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../.."))

# packages/shared-types uses a hyphen which Python cannot import via dot notation.
# Register a packages.shared_types.src shim so the canonical import path works.
_shared_types_src = os.path.join(os.path.dirname(__file__), "../../../../packages/shared-types/src")
if _shared_types_src not in sys.path:
    sys.path.insert(0, _shared_types_src)

import types as _types
import importlib as _importlib

if "packages" not in sys.modules:
    _pkg = _types.ModuleType("packages")
    _pkg.__path__ = [os.path.join(os.path.dirname(__file__), "../../../../packages")]
    sys.modules["packages"] = _pkg

if "packages.shared_types" not in sys.modules:
    _st = _types.ModuleType("packages.shared_types")
    _st.__path__ = [os.path.join(os.path.dirname(__file__), "../../../../packages/shared-types")]
    sys.modules["packages.shared_types"] = _st

if "packages.shared_types.src" not in sys.modules:
    _st_src = _types.ModuleType("packages.shared_types.src")
    _st_src.__path__ = [_shared_types_src]
    sys.modules["packages.shared_types.src"] = _st_src

if "packages.shared_types.src.models" not in sys.modules:
    _models_mod = _importlib.import_module("models")
    sys.modules["packages.shared_types.src.models"] = _models_mod

from apps.backend.src.database import get_connection
from packages.shared_types.src.models import SemanticMemoryItem, _uid, _now


# Common English stop words to filter out of TF-IDF
STOP_WORDS = frozenset({
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "this", "that", "are", "was",
    "were", "be", "been", "being", "have", "has", "had", "do", "does",
    "did", "will", "would", "could", "should", "may", "might", "can",
    "not", "no", "so", "if", "as", "into", "than", "then", "its", "my",
    "we", "our", "your", "they", "them", "their", "what", "which", "who",
    "when", "where", "how", "all", "each", "every", "both", "few", "more",
    "most", "other", "some", "such", "only", "own", "same", "too", "very",
    "just", "about", "above", "after", "before", "between", "during",
    "through", "up", "down", "out", "off", "over", "under", "again",
    "further", "once", "here", "there", "any", "also",
})


def _tokenize(text: str) -> list[str]:
    """Lowercase, split on non-alphanumeric, filter stop words and short tokens."""
    tokens = re.findall(r'[a-z0-9_]+', text.lower())
    return [t for t in tokens if t not in STOP_WORDS and len(t) > 1]


class MemoryStore:
    """Semantic memory store backed by SQLite with TF-IDF similarity search."""

    def store(self, item: SemanticMemoryItem) -> SemanticMemoryItem:
        """Store a semantic memory item in the database.
        Note: SemanticMemoryItem dataclass auto-generates id and created_at via default_factory.
        """
        conn = get_connection()
        conn.execute(
            """INSERT INTO semantic_memory (id, project_id, content, content_type, metadata, embedding, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (item.id, item.project_id, item.content, item.content_type,
             json.dumps(item.metadata), None, item.created_at),
        )
        conn.commit()
        conn.close()
        return item

    def store_issue_fix(
        self,
        project_id: str,
        issue_title: str,
        issue_desc: str,
        fix_desc: str,
        fix_steps: list[str],
        entity_ids: Optional[list[str]] = None,
    ) -> SemanticMemoryItem:
        """Convenience method: store an issue + fix as a single memory item."""
        content = f"Issue: {issue_title}\nDescription: {issue_desc}\nFix: {fix_desc}\nSteps: {'; '.join(fix_steps)}"
        item = SemanticMemoryItem(
            project_id=project_id,
            content=content,
            content_type="issue_fix",
            metadata={
                "issue_title": issue_title,
                "issue_desc": issue_desc,
                "fix_desc": fix_desc,
                "fix_steps": fix_steps,
                "entity_ids": entity_ids or [],
            },
        )
        return self.store(item)

    def store_document_chunk(
        self,
        project_id: str,
        content: str,
        doc_name: str,
        chunk_index: int,
        doc_type: str = "datasheet",
    ) -> SemanticMemoryItem:
        """Convenience method: store a document chunk."""
        item = SemanticMemoryItem(
            project_id=project_id,
            content=content,
            content_type=doc_type,
            metadata={
                "doc_name": doc_name,
                "chunk_index": chunk_index,
            },
        )
        return self.store(item)

    def find_similar(
        self,
        query: str,
        project_id: Optional[str] = None,
        content_type: Optional[str] = None,
        limit: int = 5,
    ) -> list[dict]:
        """Find items similar to the query using TF-IDF cosine similarity."""
        conn = get_connection()
        sql = "SELECT id, project_id, content, content_type, metadata, created_at FROM semantic_memory WHERE 1=1"
        params: list = []
        if project_id:
            sql += " AND project_id = ?"
            params.append(project_id)
        if content_type:
            sql += " AND content_type = ?"
            params.append(content_type)
        rows = conn.execute(sql, params).fetchall()
        conn.close()

        if not rows:
            return []

        query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        corpus_tokens = [_tokenize(row["content"]) for row in rows]

        # Compute IDF across the corpus only (exclude query to avoid bias)
        num_docs = len(corpus_tokens)
        if num_docs == 0:
            return []
        doc_freq: Counter = Counter()
        for doc in corpus_tokens:
            doc_freq.update(set(doc))

        idf: dict[str, float] = {}
        for term, df in doc_freq.items():
            idf[term] = math.log((num_docs + 1) / (df + 1))  # +1 smoothing

        query_tfidf = self._tfidf_vector(query_tokens, idf)

        scored: list[tuple[int, float]] = []
        for i, doc_tokens in enumerate(corpus_tokens):
            if not doc_tokens:
                continue
            doc_tfidf = self._tfidf_vector(doc_tokens, idf)
            sim = self._cosine_similarity(query_tfidf, doc_tfidf)
            if sim > 0:
                scored.append((i, sim))

        scored.sort(key=lambda x: x[1], reverse=True)
        results = []
        for idx, score in scored[:limit]:
            row = rows[idx]
            results.append({
                "id": row["id"],
                "project_id": row["project_id"],
                "content": row["content"],
                "content_type": row["content_type"],
                "metadata": json.loads(row["metadata"]) if row["metadata"] else {},
                "created_at": row["created_at"],
                "similarity": round(score, 4),
            })
        return results

    @staticmethod
    def _tfidf_vector(tokens: list[str], idf: dict[str, float]) -> dict[str, float]:
        """Compute a TF-IDF vector (sparse dict) for a list of tokens."""
        tf = Counter(tokens)
        total = len(tokens)
        return {term: (count / total) * idf.get(term, 0) for term, count in tf.items()}

    @staticmethod
    def _cosine_similarity(vec_a: dict[str, float], vec_b: dict[str, float]) -> float:
        """Cosine similarity between two sparse vectors (dicts)."""
        common_keys = set(vec_a.keys()) & set(vec_b.keys())
        if not common_keys:
            return 0.0
        dot = sum(vec_a[k] * vec_b[k] for k in common_keys)
        mag_a = math.sqrt(sum(v * v for v in vec_a.values()))
        mag_b = math.sqrt(sum(v * v for v in vec_b.values()))
        if mag_a == 0 or mag_b == 0:
            return 0.0
        return dot / (mag_a * mag_b)
