"""
Python AST Analyzer — extract relations from Python source files.

Discovers: import dependencies, ROS topic pub/sub, hardware address references.
"""

import ast
import os
import re
from dataclasses import dataclass, field
from typing import Optional

from packages.shared_types.src.models import (
    Entity, EntityType, RelationType, CandidateRelation,
)


class EntityIndex:
    """Pre-built lookup for matching names/refs/metadata to entities."""

    def __init__(self, entities: list[Entity]):
        self.by_id: dict[str, Entity] = {}
        self.by_name: dict[str, Entity] = {}
        self.by_name_lower: dict[str, Entity] = {}
        self.by_ref: dict[str, Entity] = {}
        self.by_addr: dict[str, Entity] = {}
        self.by_topic: dict[str, Entity] = {}
        self.by_module: dict[str, Entity] = {}

        for e in entities:
            self.by_id[e.id] = e
            self.by_name[e.name] = e
            self.by_name_lower[e.name.lower()] = e

            # Module name (strip .py)
            if e.name.endswith(".py"):
                self.by_module[e.name[:-3]] = e

            # Reference designator from metadata
            ref = e.metadata.get("ref", "")
            if ref:
                self.by_ref[ref] = e

            # I2C/SPI address from metadata
            addr = e.metadata.get("addr", "")
            if addr:
                self.by_addr[addr.lower()] = e

            # Interface entities by name (ROS topics start with /)
            if e.entity_type == EntityType.INTERFACE and e.name.startswith("/"):
                self.by_topic[e.name] = e


# ROS2 method patterns
_PUB_METHODS = {"create_publisher", "Publisher"}
_SUB_METHODS = {"create_subscription", "Subscriber", "create_service"}
_CLIENT_METHODS = {"create_client"}


class PythonAstAnalyzer:
    """Analyze Python source files for discoverable relations."""

    @staticmethod
    def analyze_file(
        file_path: str,
        source_entity_id: str,
        index: EntityIndex,
    ) -> list[CandidateRelation]:
        """Analyze a single Python file. Returns candidate relations."""
        try:
            with open(file_path, "r") as f:
                source_code = f.read()
        except (FileNotFoundError, PermissionError):
            return []

        try:
            tree = ast.parse(source_code, filename=file_path)
        except SyntaxError:
            return []

        source_entity = index.by_id.get(source_entity_id)
        source_name = source_entity.name if source_entity else os.path.basename(file_path)

        candidates: list[CandidateRelation] = []

        for node in ast.walk(tree):
            # --- ROS topic pub/sub ---
            if isinstance(node, ast.Call):
                candidates.extend(
                    PythonAstAnalyzer._check_ros_call(
                        node, source_entity_id, source_name, index
                    )
                )

            # --- Hardware hex addresses ---
            if isinstance(node, ast.Assign):
                candidates.extend(
                    PythonAstAnalyzer._check_hw_assignment(
                        node, source_entity_id, source_name, index
                    )
                )

        return candidates

    @staticmethod
    def _check_ros_call(
        node: ast.Call,
        source_id: str,
        source_name: str,
        index: EntityIndex,
    ) -> list[CandidateRelation]:
        """Check if a Call node is a ROS publisher/subscriber."""
        results = []
        func_name = ""
        if isinstance(node.func, ast.Attribute):
            func_name = node.func.attr
        elif isinstance(node.func, ast.Name):
            func_name = node.func.id

        if not func_name:
            return results

        # Determine relation type
        rel_type = None
        if func_name in _PUB_METHODS:
            rel_type = RelationType.PUBLISHES
        elif func_name in _SUB_METHODS:
            rel_type = RelationType.SUBSCRIBES_TO
        elif func_name in _CLIENT_METHODS:
            rel_type = RelationType.SUBSCRIBES_TO

        if not rel_type:
            return results

        # Extract topic string from arguments
        for arg in node.args:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value.startswith("/"):
                topic_name = arg.value
                target = index.by_topic.get(topic_name)
                if target:
                    results.append(CandidateRelation(
                        source_entity_id=source_id,
                        target_entity_id=target.id,
                        source_entity_name=source_name,
                        target_entity_name=target.name,
                        relation_type=rel_type,
                        confidence=0.85,
                        discovered_by="python_ast",
                        evidence=f"{source_name} calls {func_name}('{topic_name}') at line {node.lineno}",
                    ))

        return results

    @staticmethod
    def _check_hw_assignment(
        node: ast.Assign,
        source_id: str,
        source_name: str,
        index: EntityIndex,
    ) -> list[CandidateRelation]:
        """Check if an assignment references a hardware address or entity name."""
        results = []

        # Check for hex literal values (e.g., IMU_ADDRESS = 0x68)
        if isinstance(node.value, ast.Constant) and isinstance(node.value.value, int):
            val = node.value.value
            if val > 0 and val < 0x100:  # plausible I2C/SPI address range
                hex_str = hex(val)
                target = index.by_addr.get(hex_str)
                if target:
                    var_name = ""
                    if node.targets and isinstance(node.targets[0], ast.Name):
                        var_name = node.targets[0].id
                    results.append(CandidateRelation(
                        source_entity_id=source_id,
                        target_entity_id=target.id,
                        source_entity_name=source_name,
                        target_entity_name=target.name,
                        relation_type=RelationType.READS_FROM,
                        confidence=0.7,
                        discovered_by="python_ast",
                        evidence=f"{source_name} defines {var_name} = {hex_str} matching {target.name} at line {node.lineno}",
                    ))

        # Check for entity name references in variable names
        # e.g., DRV8825_STEP_PIN → matches entity "DRV8825"
        for target_node in node.targets:
            if isinstance(target_node, ast.Name):
                var_name_upper = target_node.id.upper()
                for entity_name, entity in index.by_name.items():
                    if entity.entity_type == EntityType.ELECTRICAL_PART and entity_name.upper() in var_name_upper:
                        # Don't duplicate if we already matched by address
                        if not any(r.target_entity_id == entity.id for r in results):
                            results.append(CandidateRelation(
                                source_entity_id=source_id,
                                target_entity_id=entity.id,
                                source_entity_name=source_name,
                                target_entity_name=entity.name,
                                relation_type=RelationType.CONFIGURED_BY,
                                confidence=0.7,
                                discovered_by="python_ast",
                                evidence=f"{source_name} variable '{target_node.id}' references {entity.name} at line {node.lineno}",
                            ))

        return results
