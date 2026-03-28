# Memory Store + Solus Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the semantic memory store (TF-IDF search) and the Gemini-powered AI agent that uses it — powering Demo B (debug), Demo C (team memory), Demo D (external knowledge), and Demo A (impact explanation).

**Architecture:** The MemoryStore is a standalone class that stores text items in SQLite and retrieves similar items using TF-IDF cosine similarity (pure Python, no numpy). The SolusAgent routes queries by type, builds context from the graph (via ContextEngine) + memory (via MemoryStore) + recent changes, and sends it to Google Gemini for reasoning. If Gemini is unavailable, it returns useful fallback text. The agent does NOT own the ContextEngine — it receives it as a dependency.

**Tech Stack:** Python 3.11+, SQLite, google-generativeai SDK, pytest

**Dependencies:** The ContextEngine (being built in parallel by Pratham) provides: `get_full_graph()`, `get_subgraph(entity_id, depth)`, `impact_analysis(entity_id, depth)`, `list_changes()`, `list_entities()`. Code against these interfaces — they will resolve when Pratham merges. The test infrastructure (`apps/backend/tests/conftest.py`) is also being created by Pratham's agent — if it doesn't exist yet, Task 1 creates a standalone version.

---

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/backend/src/memory/__init__.py` | Empty package init (verify exists, create if not) |
| `apps/backend/src/agent/__init__.py` | Empty package init (verify exists, create if not) |
| `apps/backend/src/memory/memory_store.py` | TF-IDF semantic search, issue/fix storage, document chunk storage |
| `apps/backend/src/agent/solus_agent.py` | Gemini-powered AI agent with query routing, context assembly, fallback |
| `apps/backend/tests/test_memory_store.py` | Tests for memory store CRUD and TF-IDF similarity |
| `apps/backend/tests/test_solus_agent.py` | Tests for agent query routing, context building, fallback behavior |
| `apps/backend/tests/__init__.py` | Empty file (if not already created by Pratham's agent) |
| `apps/backend/tests/conftest.py` | Shared test fixtures (if not already created by Pratham's agent) |

### Existing Files (Read-Only References)

| File | Used For |
|------|----------|
| `packages/shared_types/src/models.py` | SemanticMemoryItem, AgentQuery, AgentResponse, Entity, Relation, ChangeEvent, Issue, Fix |
| `apps/backend/src/database.py` | `get_connection()`, `init_db()` — semantic_memory table already defined |
| `apps/backend/src/context_engine.py` | ContextEngine class (being built in parallel — code against the interface) |

---

## Task 1: Test Infrastructure + MemoryStore — Basic Storage

**Files:**
- Create (if not exists): `apps/backend/tests/__init__.py`
- Create (if not exists): `apps/backend/tests/conftest.py`
- Create: `apps/backend/tests/test_memory_store.py`
- Create: `apps/backend/src/memory/memory_store.py`

**Context:** The MemoryStore wraps the `semantic_memory` table in SQLite. Each item has: id, project_id, content (text), content_type (e.g., "issue_fix", "datasheet_chunk", "note"), metadata (JSON), embedding (unused for hackathon — we use TF-IDF instead), created_at. The `store()` method saves an item, `store_issue_fix()` and `store_document_chunk()` are convenience methods that create SemanticMemoryItem objects internally.

- [ ] **Step 1: Create test infrastructure (if not already present)**

Check if `apps/backend/tests/conftest.py` exists. If it does (created by Pratham's context engine agent), **use it as-is** — do NOT overwrite it. Only create these files if they don't exist yet.

Also verify that `apps/backend/src/memory/__init__.py` and `apps/backend/src/agent/__init__.py` exist (they should from the initial scaffold). If not, create them as empty files.

Create `apps/backend/tests/__init__.py` (empty file, if not exists).

Create `apps/backend/tests/conftest.py` (if not exists):

```python
"""Shared test fixtures for Solus backend tests."""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

@pytest.fixture(autouse=True)
def fresh_db(tmp_path):
    """Give every test a fresh SQLite database."""
    db_path = str(tmp_path / "test.db")
    os.environ["SOLUS_DB_PATH"] = db_path
    from apps.backend.src.database import init_db
    init_db()
    yield db_path


@pytest.fixture
def project_id(fresh_db):
    """Create a test project and return its ID."""
    # Prefer ContextEngine if available (Pratham's code), fall back to raw SQL
    try:
        from apps.backend.src.context_engine import ContextEngine
        from packages.shared_types.src.models import Project
        p = ContextEngine.create_project(Project(name="TestBot", description="A test robot"))
        return p.id
    except ImportError:
        from packages.shared_types.src.models import _uid, _now
        from apps.backend.src.database import get_connection
        pid = _uid()
        conn = get_connection()
        conn.execute(
            "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (pid, "TestBot", "A test robot", _now(), _now()),
        )
        conn.commit()
        conn.close()
        return pid
```

- [ ] **Step 2: Write failing tests for basic storage**

Create `apps/backend/tests/test_memory_store.py`:

```python
"""Tests for the MemoryStore — storage and retrieval."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

from packages.shared_types.src.models import SemanticMemoryItem


class TestMemoryStoreBasicStorage:
    def test_store_item(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        item = store.store(SemanticMemoryItem(
            project_id=project_id,
            content="Motor driver DRV8825 overheating under load",
            content_type="issue_fix",
            metadata={"issue_title": "DRV8825 overheat"},
        ))
        assert item.id
        assert item.project_id == project_id
        assert item.content_type == "issue_fix"

    def test_store_issue_fix(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        item = store.store_issue_fix(
            project_id=project_id,
            issue_title="SLAM map won't save",
            issue_desc="map_saver node crashes when writing to disk",
            fix_desc="map_saver wasn't subscribed to the correct topic",
            fix_steps=["Change topic from /map to /map_data", "Rebuild the package"],
            entity_ids=["entity-123"],
        )
        assert item.id
        assert item.content_type == "issue_fix"
        assert "SLAM map won't save" in item.content
        assert "map_saver wasn't subscribed" in item.content
        assert item.metadata["issue_title"] == "SLAM map won't save"
        assert item.metadata["fix_steps"] == ["Change topic from /map to /map_data", "Rebuild the package"]

    def test_store_document_chunk(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        item = store.store_document_chunk(
            project_id=project_id,
            content="The TMC2209 supports up to 2A RMS with 256 microstep interpolation.",
            doc_name="TMC2209_datasheet.pdf",
            chunk_index=3,
            doc_type="datasheet",
        )
        assert item.id
        assert item.content_type == "datasheet"
        assert item.metadata["doc_name"] == "TMC2209_datasheet.pdf"
        assert item.metadata["chunk_index"] == 3

    def test_store_multiple_items(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Bug A", "desc A", "fix A", ["step"])
        store.store_issue_fix(project_id, "Bug B", "desc B", "fix B", ["step"])
        store.store_document_chunk(project_id, "Some datasheet text", "doc.pdf", 0)
        # Verify all 3 are stored by searching with an empty-ish query
        results = store.find_similar("bug", project_id=project_id)
        # Should return items (at least the issue_fix ones match "bug")
        assert len(results) >= 1
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_memory_store.py -v 2>&1 | head -20`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.backend.src.memory.memory_store'` or `ImportError`

- [ ] **Step 4: Implement MemoryStore — storage methods**

Create `apps/backend/src/memory/memory_store.py`:

```python
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
        # Fetch candidate items from the database
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

        # Build corpus: list of token lists
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

        # Compute TF-IDF vector for the query
        query_tfidf = self._tfidf_vector(query_tokens, idf)

        # Compute TF-IDF vectors for each document and score
        scored: list[tuple[int, float]] = []
        for i, doc_tokens in enumerate(corpus_tokens):
            if not doc_tokens:
                continue
            doc_tfidf = self._tfidf_vector(doc_tokens, idf)
            sim = self._cosine_similarity(query_tfidf, doc_tfidf)
            if sim > 0:
                scored.append((i, sim))

        # Sort by similarity descending, take top `limit`
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
        # Dot product
        common_keys = set(vec_a.keys()) & set(vec_b.keys())
        if not common_keys:
            return 0.0
        dot = sum(vec_a[k] * vec_b[k] for k in common_keys)
        # Magnitudes
        mag_a = math.sqrt(sum(v * v for v in vec_a.values()))
        mag_b = math.sqrt(sum(v * v for v in vec_b.values()))
        if mag_a == 0 or mag_b == 0:
            return 0.0
        return dot / (mag_a * mag_b)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_memory_store.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/memory/memory_store.py apps/backend/tests/test_memory_store.py
# Also add conftest.py and __init__.py if they were created in Step 1
git add apps/backend/tests/__init__.py apps/backend/tests/conftest.py 2>/dev/null
git commit -m "feat: memory store — basic storage + TF-IDF similarity search"
```

---

## Task 2: MemoryStore — TF-IDF Similarity Quality Tests

**Files:**
- Modify: `apps/backend/tests/test_memory_store.py`

**Context:** The basic storage tests verify CRUD works. Now we need tests that verify the TF-IDF similarity actually returns semantically relevant results and ranks them correctly. This is critical for Demo C (Team Memory Reuse) — when an engineer encounters a similar issue, the system must retrieve the right past fix.

- [ ] **Step 1: Write similarity quality tests**

Append to `apps/backend/tests/test_memory_store.py`:

```python
class TestMemoryStoreSimilarity:
    def _seed_issues(self, project_id):
        """Seed 4 issue/fix pairs covering different domains."""
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(
            project_id, "SLAM map won't save",
            "map_saver node crashes when writing to disk after mapping session",
            "map_saver wasn't subscribed to the correct topic /map_data",
            ["Change subscription topic from /map to /map_data", "Rebuild nav package"],
        )
        store.store_issue_fix(
            project_id, "Motor driver overheating",
            "DRV8825 gets extremely hot after 5 minutes of continuous operation at 1.5A",
            "Current limit was set too high for passive cooling, reduced to 1.0A",
            ["Adjust VREF potentiometer to 0.5V", "Add heatsink to DRV8825"],
        )
        store.store_issue_fix(
            project_id, "IMU calibration drift",
            "MPU6050 IMU readings drift significantly after 10 minutes",
            "Needed to run calibration routine on startup and apply offsets",
            ["Add calibration routine to setup()", "Store offsets in EEPROM"],
        )
        store.store_issue_fix(
            project_id, "ROS topic not publishing",
            "sensor_reader node starts but /distance topic shows no messages",
            "Publisher was created with wrong message type, should be Float32 not String",
            ["Change msg type to Float32", "Verify with rostopic echo /distance"],
        )
        return store

    def test_similar_issue_returns_relevant_match(self, project_id):
        store = self._seed_issues(project_id)
        results = store.find_similar("map saving crashes", project_id=project_id)
        assert len(results) > 0
        # The SLAM map issue should be the top result
        assert "SLAM" in results[0]["content"] or "map_saver" in results[0]["content"]

    def test_motor_query_returns_motor_result(self, project_id):
        store = self._seed_issues(project_id)
        results = store.find_similar("motor driver hot overheating", project_id=project_id)
        assert len(results) > 0
        assert "DRV8825" in results[0]["content"] or "overheating" in results[0]["content"]

    def test_imu_query_returns_imu_result(self, project_id):
        store = self._seed_issues(project_id)
        results = store.find_similar("IMU sensor drift calibration", project_id=project_id)
        assert len(results) > 0
        assert "IMU" in results[0]["content"] or "MPU6050" in results[0]["content"]

    def test_filter_by_content_type(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Bug", "desc", "fix", ["step"])
        store.store_document_chunk(project_id, "TMC2209 datasheet content about motors", "tmc.pdf", 0)
        # Search only datasheets
        results = store.find_similar("motor", project_id=project_id, content_type="datasheet")
        assert all(r["content_type"] == "datasheet" for r in results)

    def test_limit_results(self, project_id):
        store = self._seed_issues(project_id)
        results = store.find_similar("motor", project_id=project_id, limit=2)
        assert len(results) <= 2

    def test_no_results_for_unrelated_query(self, project_id):
        store = self._seed_issues(project_id)
        results = store.find_similar("blockchain cryptocurrency", project_id=project_id)
        # Should return 0 or very low similarity results
        if results:
            assert results[0]["similarity"] < 0.3

    def test_empty_store_returns_empty(self, project_id):
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        results = store.find_similar("anything", project_id=project_id)
        assert results == []

    def test_stop_words_only_query_returns_empty(self, project_id):
        """Query made entirely of stop words should return empty (all tokens filtered)."""
        store = self._seed_issues(project_id)
        results = store.find_similar("the and or is it", project_id=project_id)
        assert results == []

    def test_store_document_chunk_default_doc_type(self, project_id):
        """Verify the default doc_type='datasheet' works when not explicitly passed."""
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        item = store.store_document_chunk(
            project_id=project_id,
            content="TMC2209 supports UART interface",
            doc_name="tmc2209.pdf",
            chunk_index=0,
        )
        assert item.content_type == "datasheet"
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_memory_store.py -v`
Expected: All tests PASS (these test the implementation from Task 1)

- [ ] **Step 3: Commit**

```bash
git add apps/backend/tests/test_memory_store.py
git commit -m "test: memory store — TF-IDF similarity quality tests"
```

---

## Task 3: SolusAgent — Core Query Routing + Fallback

**Files:**
- Create: `apps/backend/tests/test_solus_agent.py`
- Create: `apps/backend/src/agent/solus_agent.py`

**Context:** The SolusAgent is initialized with optional `context_engine` and `memory_store` dependencies. It routes queries by `query_type` to specialized handlers. Each handler calls `_build_context()` to assemble relevant information, then sends it to Gemini. If Gemini is unavailable (no API key, network error), it returns useful fallback text.

For testing, we test WITHOUT Gemini (fallback mode). This lets us verify the routing, context assembly, and fallback behavior without needing an API key.

The ContextEngine interface (being built in parallel):
- `ContextEngine(project_id)` — constructor
- `engine.get_full_graph()` → `{"entities": [...], "relations": [...]}`
- `engine.get_subgraph(entity_id, depth=2)` → `{"entities": [...], "relations": [...]}`
- `engine.impact_analysis(entity_id, depth=3)` → `list[Entity]`
- `engine.list_changes()` → `list[ChangeEvent]`
- `engine.list_entities(entity_type=None)` → `list[Entity]` (optional filter by EntityType)

- [ ] **Step 1: Write failing tests for agent query routing and fallback**

Create `apps/backend/tests/test_solus_agent.py`:

```python
"""Tests for the SolusAgent — query routing and fallback behavior."""

import sys, os
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

from packages.shared_types.src.models import AgentQuery, AgentResponse


class TestAgentInit:
    def test_create_agent_no_deps(self):
        from apps.backend.src.agent.solus_agent import SolusAgent
        agent = SolusAgent()
        assert agent.context_engine is None
        assert agent.memory_store is None

    def test_create_agent_with_memory(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        agent = SolusAgent(memory_store=store)
        assert agent.memory_store is store


class TestAgentFallback:
    """Test that the agent returns useful fallback text when Gemini is unavailable."""

    @pytest.mark.asyncio
    async def test_general_query_fallback(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        agent = SolusAgent()
        query = AgentQuery(project_id=project_id, query="What is this project about?", query_type="general")
        response = await agent.query(query)
        assert isinstance(response, AgentResponse)
        assert response.query_id == query.id
        assert len(response.response_text) > 0

    @pytest.mark.asyncio
    async def test_debug_query_fallback(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Motor overheating", "DRV8825 hot", "Reduce current", ["Lower VREF"])
        agent = SolusAgent(memory_store=store)
        query = AgentQuery(project_id=project_id, query="My motor driver is getting hot", query_type="debug")
        response = await agent.query(query)
        assert isinstance(response, AgentResponse)
        assert len(response.response_text) > 0
        # Fallback should still include memory hits in structured_data
        assert "memory_hits" in response.structured_data

    @pytest.mark.asyncio
    async def test_search_parts_query_fallback(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        agent = SolusAgent()
        query = AgentQuery(
            project_id=project_id,
            query="I need a motor driver for NEMA 17, 12V, must work with Teensy 4.1",
            query_type="search_parts",
        )
        response = await agent.query(query)
        assert isinstance(response, AgentResponse)
        assert len(response.response_text) > 0

    @pytest.mark.asyncio
    async def test_extract_values_query_fallback(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_document_chunk(project_id, "PID values: Kp=2.5, Ki=0.1, Kd=0.05 for NEMA 17 stepper", "paper.pdf", 0)
        agent = SolusAgent(memory_store=store)
        query = AgentQuery(project_id=project_id, query="Extract PID values for stepper motor", query_type="extract_values")
        response = await agent.query(query)
        assert isinstance(response, AgentResponse)
        assert len(response.response_text) > 0
        assert "memory_hits" in response.structured_data

    @pytest.mark.asyncio
    async def test_unknown_query_type_defaults_to_general(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        agent = SolusAgent()
        query = AgentQuery(project_id=project_id, query="Hello", query_type="nonexistent_type")
        response = await agent.query(query)
        assert isinstance(response, AgentResponse)
        assert len(response.response_text) > 0

    @pytest.mark.asyncio
    async def test_response_includes_query_id(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        agent = SolusAgent()
        query = AgentQuery(project_id=project_id, query="test", query_type="general")
        response = await agent.query(query)
        assert response.query_id == query.id
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_solus_agent.py -v 2>&1 | head -20`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.backend.src.agent.solus_agent'`

- [ ] **Step 3: Install pytest-asyncio**

The tests use `@pytest.mark.asyncio` for async test methods. Add to the venv:

Run: `cd /Users/bentontameling/VentureHacksSolus/apps/backend && source .venv/bin/activate && pip install pytest-asyncio`

- [ ] **Step 4: Implement SolusAgent — core structure + fallback**

Create `apps/backend/src/agent/solus_agent.py`:

```python
"""
Solus Agent — Gemini-powered AI reasoning for robotics development.

Routes queries by type, builds context from the graph + memory + recent changes,
and sends to Google Gemini for reasoning. Falls back gracefully when Gemini is unavailable.
"""

import asyncio
import os
import json
import sys
from typing import Optional

# Consistent import strategy: sys.path for cross-package imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../.."))
from packages.shared_types.src.models import (
    AgentQuery, AgentResponse, _uid, _now,
)

# Gemini import — optional, fails gracefully
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False


class SolusAgent:
    """AI agent that uses the Robotics Context Model + memory to answer queries."""

    def __init__(self, context_engine=None, memory_store=None):
        self.context_engine = context_engine
        self.memory_store = memory_store
        self._gemini_model = None
        self._init_gemini()

    def _init_gemini(self):
        """Initialize Gemini if API key is available."""
        api_key = os.environ.get("GEMINI_API_KEY")
        if GEMINI_AVAILABLE and api_key:
            try:
                genai.configure(api_key=api_key)
                self._gemini_model = genai.GenerativeModel("gemini-2.0-flash")
            except Exception:
                self._gemini_model = None

    async def query(self, agent_query: AgentQuery) -> AgentResponse:
        """Route a query to the appropriate handler based on query_type."""
        handlers = {
            "general": self._handle_general,
            "debug": self._handle_debug,
            "search_parts": self._handle_search_parts,
            "extract_values": self._handle_extract_values,
            "impact_analysis": self._handle_impact_analysis,
            "plan": self._handle_plan,
        }
        handler = handlers.get(agent_query.query_type, self._handle_general)
        return await handler(agent_query)

    # ── Context Assembly ──

    def _build_context(self, agent_query: AgentQuery) -> dict:
        """Assemble context from graph, memory, and recent changes."""
        context = {
            "query": agent_query.query,
            "query_type": agent_query.query_type,
            "project_id": agent_query.project_id,
            "graph": None,
            "memory_hits": [],
            "recent_changes": [],
        }

        # Get graph context if context engine is available
        if self.context_engine:
            try:
                if agent_query.context_entity_ids:
                    # Get subgraph around specific entities
                    context["graph"] = self.context_engine.get_subgraph(
                        agent_query.context_entity_ids[0], depth=2
                    )
                else:
                    context["graph"] = self.context_engine.get_full_graph()
            except Exception:
                pass

            try:
                context["recent_changes"] = [
                    {
                        "change_type": c.change_type.value if hasattr(c.change_type, 'value') else c.change_type,
                        "entity_name": c.entity_name,
                        "description": c.description,
                    }
                    for c in self.context_engine.list_changes()[:10]
                ]
            except Exception:
                pass

        # Get memory hits if memory store is available
        if self.memory_store:
            try:
                context["memory_hits"] = self.memory_store.find_similar(
                    agent_query.query,
                    project_id=agent_query.project_id,
                    limit=5,
                )
            except Exception:
                pass

        return context

    def _format_context_for_prompt(self, context: dict) -> str:
        """Format assembled context into a string for the Gemini prompt."""
        parts = []

        if context.get("graph") and context["graph"].get("entities"):
            entities = context["graph"]["entities"]
            parts.append(f"## Project Graph ({len(entities)} entities)")
            for e in entities[:20]:  # Limit to avoid token overflow
                parts.append(f"- {e.get('name', 'unnamed')} ({e.get('entity_type', 'unknown')}): {e.get('description', '')}")

            relations = context["graph"].get("relations", [])
            if relations:
                parts.append(f"\n## Relations ({len(relations)} edges)")
                for r in relations[:20]:
                    parts.append(f"- {r.get('source_entity_id', '?')[:8]} --[{r.get('relation_type', '?')}]--> {r.get('target_entity_id', '?')[:8]}")

        if context.get("memory_hits"):
            parts.append(f"\n## Relevant Past Knowledge ({len(context['memory_hits'])} items)")
            for hit in context["memory_hits"]:
                parts.append(f"- [{hit.get('content_type', 'unknown')}] (similarity: {hit.get('similarity', 0):.2f})")
                parts.append(f"  {hit.get('content', '')[:300]}")

        if context.get("recent_changes"):
            parts.append(f"\n## Recent Changes ({len(context['recent_changes'])} events)")
            for ch in context["recent_changes"]:
                parts.append(f"- {ch.get('change_type', '?')}: {ch.get('entity_name', '?')} — {ch.get('description', '')}")

        return "\n".join(parts) if parts else "No project context available."

    # ── Gemini Call ──

    async def _call_gemini(self, system_prompt: str, user_prompt: str) -> Optional[str]:
        """Call Gemini API. Returns None if unavailable.
        Uses asyncio.to_thread to avoid blocking the event loop since
        google-generativeai's generate_content() is synchronous."""
        if not self._gemini_model:
            return None
        try:
            full_prompt = f"{system_prompt}\n\n{user_prompt}"
            response = await asyncio.to_thread(
                self._gemini_model.generate_content, full_prompt
            )
            return response.text
        except Exception:
            return None

    # ── Query Handlers ──

    async def _handle_general(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)
        context_str = self._format_context_for_prompt(context)

        system_prompt = """You are Solus, an AI assistant for robotics development teams.
You have access to the project's context model — a graph of hardware, software, and runtime components.
Answer the user's question using the project context provided. Be specific and actionable."""

        user_prompt = f"""Project Context:
{context_str}

User Question: {query.query}"""

        gemini_response = await self._call_gemini(system_prompt, user_prompt)

        if gemini_response:
            return AgentResponse(
                query_id=query.id,
                response_text=gemini_response,
                structured_data={"memory_hits": context.get("memory_hits", [])},
                sources=["gemini", "context_model"],
                confidence=0.8,
            )

        # Fallback: return context summary
        fallback = self._build_fallback_general(query, context)
        return AgentResponse(
            query_id=query.id,
            response_text=fallback,
            structured_data={"memory_hits": context.get("memory_hits", [])},
            sources=["context_model", "fallback"],
            confidence=0.3,
        )

    async def _handle_debug(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)
        context_str = self._format_context_for_prompt(context)

        system_prompt = """You are Solus, an AI debugging assistant for robotics.
Diagnose the issue using the project's context model, past issues, and recent changes.
If a similar issue was found in team memory, reference it and suggest the same fix.
Be systematic: identify the component, trace the signal path, suggest root causes."""

        user_prompt = f"""Project Context:
{context_str}

Issue to Debug: {query.query}"""

        gemini_response = await self._call_gemini(system_prompt, user_prompt)

        if gemini_response:
            return AgentResponse(
                query_id=query.id,
                response_text=gemini_response,
                structured_data={"memory_hits": context.get("memory_hits", [])},
                sources=["gemini", "context_model", "memory"],
                confidence=0.8,
            )

        # Fallback
        fallback = self._build_fallback_debug(query, context)
        return AgentResponse(
            query_id=query.id,
            response_text=fallback,
            structured_data={"memory_hits": context.get("memory_hits", [])},
            sources=["context_model", "memory", "fallback"],
            confidence=0.3,
        )

    async def _handle_search_parts(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)
        context_str = self._format_context_for_prompt(context)

        system_prompt = """You are Solus, an AI assistant that recommends electronic components for robotics projects.
Given the user's requirements and the project's existing system context, recommend specific components.
Include: part name, manufacturer, key specs, compatibility reasoning with existing components, and price range.
Cross-reference with the project's context model for compatibility. NEVER hallucinate specifications."""

        user_prompt = f"""Project Context:
{context_str}

Component Request: {query.query}"""

        gemini_response = await self._call_gemini(system_prompt, user_prompt)

        if gemini_response:
            return AgentResponse(
                query_id=query.id,
                response_text=gemini_response,
                structured_data={"memory_hits": context.get("memory_hits", [])},
                sources=["gemini", "context_model"],
                confidence=0.7,
            )

        fallback = f"Component search for: {query.query}\n\n"
        fallback += "Gemini API is not available. To get AI-powered component recommendations, set the GEMINI_API_KEY environment variable.\n\n"
        if context.get("memory_hits"):
            fallback += "Related items from memory:\n"
            for hit in context["memory_hits"]:
                fallback += f"- {hit['content'][:200]}\n"
        return AgentResponse(
            query_id=query.id,
            response_text=fallback,
            structured_data={"memory_hits": context.get("memory_hits", [])},
            sources=["fallback"],
            confidence=0.1,
        )

    async def _handle_extract_values(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)
        context_str = self._format_context_for_prompt(context)

        system_prompt = """You are Solus, an AI assistant that extracts parameter values from research papers and datasheets.
Search the provided memory items (document chunks) for the requested values.
For each value found, provide: parameter name, value, unit, confidence level (high/medium/low), and source reference.
NEVER hallucinate values. If a value is not found, say so explicitly."""

        user_prompt = f"""Project Context:
{context_str}

Extraction Request: {query.query}"""

        gemini_response = await self._call_gemini(system_prompt, user_prompt)

        if gemini_response:
            return AgentResponse(
                query_id=query.id,
                response_text=gemini_response,
                structured_data={"memory_hits": context.get("memory_hits", [])},
                sources=["gemini", "memory"],
                confidence=0.7,
            )

        # Fallback: show raw memory hits
        fallback = f"Value extraction request: {query.query}\n\n"
        if context.get("memory_hits"):
            fallback += "Relevant document chunks found:\n"
            for hit in context["memory_hits"]:
                fallback += f"\n[{hit.get('content_type', 'unknown')}] (similarity: {hit.get('similarity', 0):.2f})\n"
                fallback += f"{hit['content'][:500]}\n"
            fallback += "\nSet GEMINI_API_KEY to enable AI-powered value extraction."
        else:
            fallback += "No relevant document chunks found in memory. Upload a PDF or datasheet first."
        return AgentResponse(
            query_id=query.id,
            response_text=fallback,
            structured_data={"memory_hits": context.get("memory_hits", [])},
            sources=["memory", "fallback"],
            confidence=0.2,
        )

    async def _handle_impact_analysis(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)

        impacted_entities = []
        if self.context_engine and query.context_entity_ids:
            try:
                impacted = self.context_engine.impact_analysis(query.context_entity_ids[0], depth=3)
                impacted_entities = [
                    {"id": e.id, "name": e.name, "entity_type": e.entity_type.value if hasattr(e.entity_type, 'value') else e.entity_type}
                    for e in impacted
                ]
            except Exception:
                pass

        context_str = self._format_context_for_prompt(context)

        system_prompt = """You are Solus, an AI assistant explaining the impact of changes in a robotics system.
Given a changed component and the list of impacted components (found via graph traversal),
explain HOW each impacted component is affected and what the engineer should do about it.
Be specific about signal paths, interfaces, and code changes needed."""

        impact_info = ""
        if impacted_entities:
            impact_info = "\n\nImpacted Components (from graph traversal):\n"
            for ie in impacted_entities:
                impact_info += f"- {ie['name']} ({ie['entity_type']})\n"

        user_prompt = f"""Project Context:
{context_str}
{impact_info}

Change Description: {query.query}"""

        gemini_response = await self._call_gemini(system_prompt, user_prompt)

        if gemini_response:
            return AgentResponse(
                query_id=query.id,
                response_text=gemini_response,
                structured_data={
                    "impacted_entities": impacted_entities,
                    "memory_hits": context.get("memory_hits", []),
                },
                sources=["gemini", "context_model", "impact_analysis"],
                confidence=0.8,
            )

        # Fallback
        fallback = f"Impact analysis for: {query.query}\n\n"
        if impacted_entities:
            fallback += f"Found {len(impacted_entities)} impacted components:\n"
            for ie in impacted_entities:
                fallback += f"- {ie['name']} ({ie['entity_type']})\n"
            fallback += "\nSet GEMINI_API_KEY for a detailed explanation of how each component is affected."
        else:
            fallback += "No impacted components found. Provide entity IDs in context_entity_ids to run impact analysis."
        return AgentResponse(
            query_id=query.id,
            response_text=fallback,
            structured_data={
                "impacted_entities": impacted_entities,
                "memory_hits": context.get("memory_hits", []),
            },
            sources=["context_model", "fallback"],
            confidence=0.3,
        )

    async def _handle_plan(self, query: AgentQuery) -> AgentResponse:
        context = self._build_context(query)
        context_str = self._format_context_for_prompt(context)

        system_prompt = """You are Solus, an AI assistant that helps plan integration work for robotics projects.
Given the project's context model, suggest a plan for the requested integration task.
Consider hardware-software boundaries, testing order, and potential failure points."""

        user_prompt = f"""Project Context:
{context_str}

Planning Request: {query.query}"""

        gemini_response = await self._call_gemini(system_prompt, user_prompt)

        if gemini_response:
            return AgentResponse(
                query_id=query.id,
                response_text=gemini_response,
                structured_data={"memory_hits": context.get("memory_hits", [])},
                sources=["gemini", "context_model"],
                confidence=0.7,
            )

        fallback = f"Planning request: {query.query}\n\nSet GEMINI_API_KEY to enable AI-powered planning assistance."
        return AgentResponse(
            query_id=query.id,
            response_text=fallback,
            structured_data={"memory_hits": context.get("memory_hits", [])},
            sources=["fallback"],
            confidence=0.1,
        )

    # ── Fallback Builders ──

    def _build_fallback_general(self, query: AgentQuery, context: dict) -> str:
        """Build a useful fallback response for general queries."""
        parts = [f"Query: {query.query}\n"]
        graph = context.get("graph")
        if graph and graph.get("entities"):
            parts.append(f"Project has {len(graph['entities'])} entities and {len(graph.get('relations', []))} relations in the context model.")
        if context.get("memory_hits"):
            parts.append("\nRelated items from memory:")
            for hit in context["memory_hits"][:3]:
                parts.append(f"- {hit['content'][:200]}")
        if context.get("recent_changes"):
            parts.append(f"\n{len(context['recent_changes'])} recent changes detected.")
        parts.append("\nSet GEMINI_API_KEY for AI-powered responses.")
        return "\n".join(parts)

    def _build_fallback_debug(self, query: AgentQuery, context: dict) -> str:
        """Build a useful fallback response for debug queries."""
        parts = [f"Debugging: {query.query}\n"]
        if context.get("memory_hits"):
            parts.append("Similar past issues found:")
            for hit in context["memory_hits"][:3]:
                meta = hit.get("metadata", {})
                if meta.get("issue_title"):
                    parts.append(f"\n**{meta['issue_title']}** (similarity: {hit.get('similarity', 0):.2f})")
                    if meta.get("fix_desc"):
                        parts.append(f"  Fix: {meta['fix_desc']}")
                    if meta.get("fix_steps"):
                        parts.append(f"  Steps: {'; '.join(meta['fix_steps'])}")
                else:
                    parts.append(f"- {hit['content'][:200]}")
        else:
            parts.append("No similar past issues found in team memory.")
        if context.get("recent_changes"):
            parts.append(f"\nNote: {len(context['recent_changes'])} recent changes — one of these may be related.")
        parts.append("\nSet GEMINI_API_KEY for AI-powered diagnosis.")
        return "\n".join(parts)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_solus_agent.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/agent/solus_agent.py apps/backend/tests/test_solus_agent.py
git commit -m "feat: solus agent — query routing + context assembly + fallback for all 6 query types"
```

---

## Task 4: SolusAgent — Context Assembly Integration Tests

**Files:**
- Modify: `apps/backend/tests/test_solus_agent.py`

**Context:** These tests verify that the agent correctly assembles context from both the MemoryStore and the ContextEngine (when available). We mock the ContextEngine with a simple fake since it may not be built yet, and test that the agent includes graph data, memory hits, and change events in its context.

- [ ] **Step 1: Write integration tests for context assembly**

Append to `apps/backend/tests/test_solus_agent.py`:

```python
from packages.shared_types.src.models import (
    Entity, EntityType, ChangeEvent, ChangeType, SourceType,
)


class FakeContextEngine:
    """Minimal fake for testing agent context assembly without the real ContextEngine.
    Uses real Entity and ChangeEvent objects to match the production ContextEngine interface."""

    def __init__(self, project_id):
        self.project_id = project_id

    def get_full_graph(self):
        return {
            "entities": [
                {"id": "e1", "name": "DRV8825", "entity_type": "electrical_part", "description": "Motor driver"},
                {"id": "e2", "name": "motor_controller.py", "entity_type": "software_module", "description": "Stepper control"},
            ],
            "relations": [
                {"id": "r1", "source_entity_id": "e1", "target_entity_id": "e2", "relation_type": "drives"},
            ],
        }

    def get_subgraph(self, entity_id, depth=2):
        return self.get_full_graph()

    def impact_analysis(self, entity_id, depth=3):
        """Return real Entity objects matching the production interface."""
        return [
            Entity(
                id="e2",
                project_id=self.project_id,
                name="motor_controller.py",
                entity_type=EntityType.SOFTWARE_MODULE,
                description="Stepper control code",
            ),
        ]

    def list_changes(self):
        """Return real ChangeEvent objects matching the production interface."""
        return [
            ChangeEvent(
                project_id=self.project_id,
                change_type=ChangeType.MODIFIED,
                entity_name="DRV8825",
                description="Voltage range changed",
            ),
        ]

    def list_entities(self, entity_type=None):
        return []


class TestAgentContextAssembly:
    @pytest.mark.asyncio
    async def test_context_includes_graph(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        fake_engine = FakeContextEngine(project_id)
        agent = SolusAgent(context_engine=fake_engine)
        query = AgentQuery(project_id=project_id, query="What components are in my system?", query_type="general")
        context = agent._build_context(query)
        assert context["graph"] is not None
        assert len(context["graph"]["entities"]) == 2

    @pytest.mark.asyncio
    async def test_context_includes_memory(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Motor bug", "driver issue", "fixed it", ["step1"])
        agent = SolusAgent(memory_store=store)
        query = AgentQuery(project_id=project_id, query="motor driver problem", query_type="debug")
        context = agent._build_context(query)
        assert len(context["memory_hits"]) > 0

    @pytest.mark.asyncio
    async def test_context_includes_changes(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        fake_engine = FakeContextEngine(project_id)
        agent = SolusAgent(context_engine=fake_engine)
        query = AgentQuery(project_id=project_id, query="What changed?", query_type="general")
        context = agent._build_context(query)
        assert len(context["recent_changes"]) > 0
        assert context["recent_changes"][0]["entity_name"] == "DRV8825"

    @pytest.mark.asyncio
    async def test_impact_analysis_with_engine(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        fake_engine = FakeContextEngine(project_id)
        agent = SolusAgent(context_engine=fake_engine)
        query = AgentQuery(
            project_id=project_id,
            query="DRV8825 was replaced with TMC2209",
            query_type="impact_analysis",
            context_entity_ids=["e1"],
        )
        response = await agent.query(query)
        assert "impacted_entities" in response.structured_data
        assert len(response.structured_data["impacted_entities"]) > 0
        assert response.structured_data["impacted_entities"][0]["name"] == "motor_controller.py"

    @pytest.mark.asyncio
    async def test_debug_with_both_engine_and_memory(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Motor overheating", "DRV8825 hot", "Reduce current", ["Lower VREF"])
        fake_engine = FakeContextEngine(project_id)
        agent = SolusAgent(context_engine=fake_engine, memory_store=store)
        query = AgentQuery(project_id=project_id, query="Motor driver getting hot", query_type="debug")
        response = await agent.query(query)
        # Should have both memory hits and graph context in the response
        assert "memory_hits" in response.structured_data
        assert len(response.response_text) > 0

    @pytest.mark.asyncio
    async def test_format_context_for_prompt(self, project_id):
        from apps.backend.src.agent.solus_agent import SolusAgent
        fake_engine = FakeContextEngine(project_id)
        from apps.backend.src.memory.memory_store import MemoryStore
        store = MemoryStore()
        store.store_issue_fix(project_id, "Bug", "desc", "fix", ["step"])
        agent = SolusAgent(context_engine=fake_engine, memory_store=store)
        query = AgentQuery(project_id=project_id, query="motor issue", query_type="debug")
        context = agent._build_context(query)
        formatted = agent._format_context_for_prompt(context)
        assert "DRV8825" in formatted
        assert "Project Graph" in formatted
```

- [ ] **Step 2: Run all tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_solus_agent.py -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/backend/tests/test_solus_agent.py
git commit -m "test: solus agent — context assembly integration tests with fake engine"
```

---

## Task 5: Run Full Test Suite + Final Verification

**Files:** None new — verification only.

**Context:** Before considering this work complete, run all tests together and verify everything works in concert.

- [ ] **Step 1: Run all memory store tests**

Run: `cd /Users/bentontameling/VentureHacksSolus && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_memory_store.py -v`
Expected: All tests PASS

- [ ] **Step 2: Run all agent tests**

Run: `cd /Users/bentontameling/VentureHacksSolus && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_solus_agent.py -v`
Expected: All tests PASS

- [ ] **Step 3: Run all tests together**

Run: `cd /Users/bentontameling/VentureHacksSolus && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/ -v`
Expected: All tests PASS (including context engine tests if Pratham's agent has created them)

- [ ] **Step 4: Verify imports work correctly**

Run: `cd /Users/bentontameling/VentureHacksSolus && source apps/backend/.venv/bin/activate && python -c "from apps.backend.src.memory.memory_store import MemoryStore; print('MemoryStore OK')" && python -c "from apps.backend.src.agent.solus_agent import SolusAgent; print('SolusAgent OK')"`
Expected: Both print OK

- [ ] **Step 5: Commit any remaining changes**

```bash
git status
# If there are any uncommitted changes:
git add -A apps/backend/
git commit -m "chore: final verification — all memory store + agent tests passing"
```
