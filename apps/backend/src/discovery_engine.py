"""
Discovery Engine — orchestrate analyzers, merge, dedup, batch add.

Builds an EntityIndex, runs Python AST / KiCad Netlist / Config File analyzers,
merges results with cross-modal boosting, deduplicates against the existing graph.
"""

import json
import os
from typing import Optional

from .database import get_connection
from .context_engine import ContextEngine
from .analyzers.python_ast_analyzer import PythonAstAnalyzer, EntityIndex
from .analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
from .analyzers.config_file_analyzer import ConfigFileAnalyzer

from packages.shared_types.src.models import (
    Entity, EntityType, Relation, RelationType, SourceType,
    SourceConnection, CandidateRelation, DiscoveryReport,
    _uid, _now,
)


_SYMMETRIC_TYPES = {RelationType.CONNECTED_TO, RelationType.SIMILAR_TO}


class DiscoveryEngine:
    """Orchestrate auto-discovery of relations."""

    def __init__(self, project_id: str):
        self.project_id = project_id
        self._engine = ContextEngine(project_id)

    def discover(
        self,
        analyzers: Optional[list[str]] = None,
        auto_add: bool = False,
        min_confidence: float = 0.6,
    ) -> DiscoveryReport:
        """Run discovery. Returns a DiscoveryReport."""
        if analyzers is None:
            analyzers = ["python_ast", "kicad_netlist", "config_file"]

        entities = self._engine.list_entities()
        index = EntityIndex(entities)
        sources = self._engine.list_sources()
        warnings: list[str] = []

        all_candidates: list[CandidateRelation] = []

        if "python_ast" in analyzers:
            cands, warns = self._run_python_ast(entities, sources, index)
            all_candidates.extend(cands)
            warnings.extend(warns)

        if "kicad_netlist" in analyzers:
            cands, warns = self._run_kicad_netlist(sources, index)
            all_candidates.extend(cands)
            warnings.extend(warns)

        if "config_file" in analyzers:
            cands, warns = self._run_config_files(entities, sources, index)
            all_candidates.extend(cands)
            warnings.extend(warns)

        report = self._merge_and_dedup(all_candidates, min_confidence)
        report.warnings = warnings

        if auto_add and report.relations:
            self._batch_add_relations(report.relations)

        return report

    # ── Analyzer runners ──

    def _run_python_ast(
        self, entities: list[Entity], sources: list[SourceConnection], index: EntityIndex,
    ) -> tuple[list[CandidateRelation], list[str]]:
        candidates = []
        warnings = []
        for entity in entities:
            if entity.entity_type != EntityType.SOFTWARE_MODULE:
                continue
            if not entity.name.endswith(".py"):
                continue
            path = self._resolve_file_path(entity, sources)
            if not path:
                warnings.append(f"Could not resolve file path for {entity.name}")
                continue
            candidates.extend(PythonAstAnalyzer.analyze_file(path, entity.id, index))
        return candidates, warnings

    def _run_kicad_netlist(
        self, sources: list[SourceConnection], index: EntityIndex,
    ) -> tuple[list[CandidateRelation], list[str]]:
        candidates = []
        warnings = []
        for source in sources:
            src_type = source.source_type.value if isinstance(source.source_type, SourceType) else source.source_type
            if src_type != "kicad":
                continue
            pcb_path = self._resolve_kicad_pcb_path(source)
            if not pcb_path:
                warnings.append(f"No .kicad_pcb file found for source '{source.name}'")
                continue
            candidates.extend(KicadNetlistAnalyzer.analyze_pcb(pcb_path, index))
        return candidates, warnings

    def _run_config_files(
        self, entities: list[Entity], sources: list[SourceConnection], index: EntityIndex,
    ) -> tuple[list[CandidateRelation], list[str]]:
        candidates = []
        warnings = []
        config_exts = {".yaml", ".yml", ".json", ".toml"}
        for entity in entities:
            ext = os.path.splitext(entity.name)[1].lower()
            if ext not in config_exts:
                continue
            path = self._resolve_file_path(entity, sources)
            if not path:
                warnings.append(f"Could not resolve file path for {entity.name}")
                continue
            candidates.extend(ConfigFileAnalyzer.analyze_file(path, entity.id, index))
        return candidates, warnings

    # ── File resolution ──

    def _resolve_file_path(self, entity: Entity, sources: list[SourceConnection]) -> Optional[str]:
        """Resolve an entity's source_ref to an absolute file path."""
        if not entity.source_ref:
            return None
        for source in sources:
            repo_path = source.config.get("repo_path") or source.config.get("repo") or ""
            if not repo_path or not os.path.isdir(repo_path):
                continue
            full_path = os.path.join(repo_path, entity.source_ref)
            if os.path.isfile(full_path):
                return full_path
        return None

    def _resolve_kicad_pcb_path(self, source: SourceConnection) -> Optional[str]:
        """Resolve the .kicad_pcb file from a KiCad source connection."""
        pcb_path = source.config.get("pcb_path")
        if pcb_path and os.path.isfile(pcb_path):
            return pcb_path
        sch_path = source.config.get("schematic_path") or source.config.get("file") or ""
        if sch_path:
            pcb_path = sch_path.replace(".kicad_sch", ".kicad_pcb")
            if os.path.isfile(pcb_path):
                return pcb_path
        return None

    # ── Merge & Dedup ──

    def _merge_and_dedup(
        self, candidates: list[CandidateRelation], min_confidence: float = 0.6,
    ) -> DiscoveryReport:
        """Merge candidates, boost cross-modal, dedup against existing graph."""
        existing_relations = self._engine.list_relations()
        existing_keys = set()
        for r in existing_relations:
            rt = r.relation_type.value if isinstance(r.relation_type, RelationType) else r.relation_type
            existing_keys.add((r.source_entity_id, r.target_entity_id, rt))
            if r.relation_type in _SYMMETRIC_TYPES:
                existing_keys.add((r.target_entity_id, r.source_entity_id, rt))

        # Group by normalized key for cross-modal boosting
        grouped: dict[tuple, list[CandidateRelation]] = {}
        for c in candidates:
            rt_val = c.relation_type.value if isinstance(c.relation_type, RelationType) else c.relation_type
            if c.relation_type in _SYMMETRIC_TYPES:
                key = (min(c.source_entity_id, c.target_entity_id),
                       max(c.source_entity_id, c.target_entity_id), rt_val)
            else:
                key = (c.source_entity_id, c.target_entity_id, rt_val)
            grouped.setdefault(key, []).append(c)

        duplicates_skipped = 0
        boosted = 0
        final: list[CandidateRelation] = []

        for key, group in grouped.items():
            src, tgt, rt_val = key
            if (src, tgt, rt_val) in existing_keys:
                duplicates_skipped += 1
                continue

            if len(group) > 1:
                best = max(group, key=lambda c: c.confidence)
                max_conf = max(c.confidence for c in group)
                best.confidence = min(1.0, max_conf + 0.1)
                best.evidence = " | ".join(c.evidence for c in group)
                boosted += 1
                candidate = best
            else:
                candidate = group[0]

            if candidate.confidence >= min_confidence:
                final.append(candidate)

        final.sort(key=lambda c: c.confidence, reverse=True)

        return DiscoveryReport(
            total_candidates=len(candidates),
            new_relations=len(final),
            duplicates_skipped=duplicates_skipped,
            boosted=boosted,
            relations=final,
        )

    # ── Batch Add ──

    def _batch_add_relations(self, candidates: list[CandidateRelation]):
        """Add all candidates to the graph in a single transaction."""
        conn = get_connection()
        try:
            for c in candidates:
                rt_val = c.relation_type.value if isinstance(c.relation_type, RelationType) else c.relation_type
                conn.execute(
                    """INSERT INTO relations (id, project_id, source_entity_id, target_entity_id,
                       relation_type, metadata, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (_uid(), self.project_id, c.source_entity_id, c.target_entity_id,
                     rt_val,
                     json.dumps({"discovered_by": c.discovered_by, "evidence": c.evidence}),
                     c.confidence, _now()),
                )
                c.added = True
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
