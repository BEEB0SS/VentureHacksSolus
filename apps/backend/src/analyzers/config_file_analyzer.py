"""
Config File Analyzer — discover relations from YAML/JSON/TOML config files.

Discovers: configured_by relations when config values match entity names, addresses, or topics.
"""

import json
import os
from typing import Any

from apps.backend.src.analyzers.python_ast_analyzer import EntityIndex
from packages.shared_types.src.models import (
    RelationType, CandidateRelation,
)


def _walk_values(data: Any) -> list[str]:
    """Recursively extract all string values from a nested dict/list structure."""
    values: list[str] = []
    if isinstance(data, dict):
        for v in data.values():
            values.extend(_walk_values(v))
    elif isinstance(data, list):
        for item in data:
            values.extend(_walk_values(item))
    elif isinstance(data, str):
        values.append(data)
    return values


def _parse_file(path: str) -> Any:
    """Parse a config file based on extension. Returns parsed data or None."""
    ext = os.path.splitext(path)[1].lower()
    try:
        with open(path, "r") as f:
            content = f.read()
    except (FileNotFoundError, PermissionError):
        return None

    try:
        if ext in (".yaml", ".yml"):
            import yaml
            return yaml.safe_load(content)
        elif ext == ".json":
            return json.loads(content)
        elif ext == ".toml":
            import tomllib
            return tomllib.loads(content)
    except Exception:
        return None

    return None


class ConfigFileAnalyzer:
    """Analyze config files for entity name/address/topic references."""

    @staticmethod
    def analyze_file(
        file_path: str,
        source_entity_id: str,
        index: EntityIndex,
    ) -> list[CandidateRelation]:
        """Analyze a single config file. Returns candidate relations."""
        data = _parse_file(file_path)
        if data is None:
            return []

        source_entity = index.by_id.get(source_entity_id)
        source_name = source_entity.name if source_entity else os.path.basename(file_path)

        string_values = _walk_values(data)
        candidates: list[CandidateRelation] = []
        seen_targets: set[str] = set()

        for val in string_values:
            target = None
            match_type = ""

            # Check topic match (exact)
            if val.startswith("/") and val in index.by_topic:
                target = index.by_topic[val]
                match_type = f"topic '{val}'"

            # Check address match (exact, case-insensitive)
            elif val.lower() in index.by_addr:
                target = index.by_addr[val.lower()]
                match_type = f"address '{val}'"

            # Check entity name match (exact, case-insensitive)
            elif val.lower() in index.by_name_lower:
                target = index.by_name_lower[val.lower()]
                match_type = f"name '{val}'"

            if target and target.id != source_entity_id and target.id not in seen_targets:
                seen_targets.add(target.id)
                candidates.append(CandidateRelation(
                    source_entity_id=source_entity_id,
                    target_entity_id=target.id,
                    source_entity_name=source_name,
                    target_entity_name=target.name,
                    relation_type=RelationType.CONFIGURED_BY,
                    confidence=0.7,
                    discovered_by="config_file",
                    evidence=f"{source_name} references {target.name} via {match_type}",
                ))

        return candidates
