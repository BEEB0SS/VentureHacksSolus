"""
Solus Database — SQLite schema and connection management.
"""

import sqlite3
import os
from pathlib import Path

DB_PATH = os.environ.get("SOLUS_DB_PATH", str(Path.home() / ".solus" / "solus.db"))


def get_connection() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_connection()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT DEFAULT '',
        email TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS source_connections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        name TEXT NOT NULL,
        config TEXT DEFAULT '{}',
        last_synced_at TEXT,
        status TEXT DEFAULT 'disconnected'
    );

    CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        metadata TEXT DEFAULT '{}',
        source TEXT DEFAULT 'manual',
        source_ref TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_id);
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);

    CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        confidence REAL DEFAULT 1.0,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_relations_project ON relations(project_id);
    CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_entity_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_entity_id);

    CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        source_connection_id TEXT REFERENCES source_connections(id),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        data TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS change_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_connection_id TEXT REFERENCES source_connections(id),
        change_type TEXT NOT NULL,
        entity_id TEXT DEFAULT '',
        entity_name TEXT DEFAULT '',
        description TEXT DEFAULT '',
        diff_data TEXT DEFAULT '{}',
        impacted_entity_ids TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        acknowledged INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_changes_project ON change_events(project_id);

    CREATE TABLE IF NOT EXISTS runtime_packets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source TEXT DEFAULT '',
        timestamp TEXT NOT NULL,
        signals TEXT DEFAULT '[]',
        status TEXT DEFAULT 'healthy',
        metadata TEXT DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_project ON runtime_packets(project_id);

    CREATE TABLE IF NOT EXISTS anomalies (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        runtime_packet_id TEXT REFERENCES runtime_packets(id),
        signal_name TEXT NOT NULL,
        expected_min REAL DEFAULT 0,
        expected_max REAL DEFAULT 1,
        actual_value REAL NOT NULL,
        severity TEXT DEFAULT 'warning',
        description TEXT DEFAULT '',
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT DEFAULT 'open',
        related_entity_ids TEXT DEFAULT '[]',
        reported_by TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fixes (
        id TEXT PRIMARY KEY,
        issue_id TEXT REFERENCES issues(id),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        description TEXT DEFAULT '',
        steps TEXT DEFAULT '[]',
        applied_by TEXT DEFAULT '',
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS simulation_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        model_path TEXT DEFAULT '',
        parameters TEXT DEFAULT '{}',
        results TEXT DEFAULT '{}',
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS semantic_memory (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        embedding BLOB,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_project ON semantic_memory(project_id);
    CREATE INDEX IF NOT EXISTS idx_memory_type ON semantic_memory(content_type);

    CREATE TABLE IF NOT EXISTS agent_queries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        query TEXT NOT NULL,
        query_type TEXT DEFAULT 'general',
        context_entity_ids TEXT DEFAULT '[]',
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_responses (
        id TEXT PRIMARY KEY,
        query_id TEXT REFERENCES agent_queries(id),
        response_text TEXT DEFAULT '',
        structured_data TEXT DEFAULT '{}',
        sources TEXT DEFAULT '[]',
        confidence REAL DEFAULT 0.0,
        created_at TEXT NOT NULL
    );
    """)
    conn.commit()
    conn.close()
    print(f"Database initialized at {DB_PATH}")


if __name__ == "__main__":
    init_db()