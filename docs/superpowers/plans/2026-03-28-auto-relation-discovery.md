# Auto Relation Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically infer relations between entities in the context model by analyzing Python source code (AST), KiCad PCB netlists, and config files (YAML/JSON/TOML), then merge/dedup the results against the existing graph.

**Architecture:** Three independent analyzers (Python AST, KiCad Netlist, Config File) each produce `CandidateRelation` objects with confidence scores. A `DiscoveryEngine` orchestrates them: it builds an `EntityIndex` for name-to-ID resolution, runs each analyzer, merges results with cross-modal confidence boosting, deduplicates against the existing graph, and optionally batch-inserts new relations. A single FastAPI endpoint exposes the feature.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, pytest; `ast` (stdlib), `yaml` (PyYAML), `json` (stdlib), `tomllib` (stdlib)

---

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/backend/src/analyzers/__init__.py` | Empty package init |
| `apps/backend/src/analyzers/python_ast_analyzer.py` | Parse Python AST: extract imports, ROS topic pub/sub, hardware address refs |
| `apps/backend/src/analyzers/kicad_netlist_analyzer.py` | Parse KiCad PCB: shared signal nets → connected_to, driver-motor → drives |
| `apps/backend/src/analyzers/config_file_analyzer.py` | Parse YAML/JSON/TOML: entity name/addr/topic references → configured_by |
| `apps/backend/src/discovery_engine.py` | EntityIndex builder, orchestrate analyzers, merge, dedup, batch add |
| `apps/backend/src/routes_discovery.py` | FastAPI APIRouter: POST /api/projects/{id}/discover |
| `apps/backend/tests/test_python_ast_analyzer.py` | Tests for Python AST extraction |
| `apps/backend/tests/test_kicad_netlist_analyzer.py` | Tests for KiCad netlist analysis |
| `apps/backend/tests/test_config_file_analyzer.py` | Tests for config file analysis |
| `apps/backend/tests/test_discovery_engine.py` | Tests for merge, dedup, boosting, batch add |
| `apps/backend/tests/test_routes_discovery.py` | Integration tests for the API endpoint |
| `apps/backend/tests/fixtures/discovery/motor_controller.py` | Test fixture: Python ROS node with topics + hardware refs |
| `apps/backend/tests/fixtures/discovery/sensor_reader.py` | Test fixture: Python ROS node with I2C reads |
| `apps/backend/tests/fixtures/discovery/test_board.kicad_pcb` | Test fixture: minimal PCB with shared nets |
| `apps/backend/tests/fixtures/discovery/motor_params.yaml` | Test fixture: YAML config referencing entities |

### Files to Modify

| File | Change |
|------|--------|
| `packages/shared_types/src/models.py` | Add `CandidateRelation` and `DiscoveryReport` dataclasses |
| `apps/backend/src/main.py` | Add `include_router(discovery_router)` |
| `apps/backend/requirements.txt` | Add `PyYAML>=6.0` |

### Existing Files (Read-Only References)

| File | Used For |
|------|----------|
| `apps/backend/src/context_engine.py` | `ContextEngine.list_entities()`, `list_relations()`, `list_sources()`, `create_relation()` |
| `apps/backend/src/connectors/kicad_connector.py` | `KiCadConnector.parse_pcb()` returns `{"components": [...], "nets": [...]}` |
| `apps/backend/src/database.py` | `get_connection()` for batch inserts |
| `apps/backend/tests/conftest.py` | `fresh_db`, `project_id` fixtures |

---

## Task 1: Data Models + Test Fixtures

**Files:**
- Modify: `packages/shared_types/src/models.py`
- Modify: `apps/backend/requirements.txt`
- Create: `apps/backend/tests/fixtures/discovery/motor_controller.py`
- Create: `apps/backend/tests/fixtures/discovery/sensor_reader.py`
- Create: `apps/backend/tests/fixtures/discovery/test_board.kicad_pcb`
- Create: `apps/backend/tests/fixtures/discovery/motor_params.yaml`

**Context:** Before writing any analyzer, we need the shared data models and realistic test fixture files that all three analyzers will work with. The fixtures must contain discoverable patterns: ROS topic strings, shared PCB nets, and config references to entity names.

- [ ] **Step 1: Add CandidateRelation and DiscoveryReport to shared types**

Append to `packages/shared_types/src/models.py` at the end of the file:

```python
# ──────────────────────────────────────────────
# Auto-Discovery
# ──────────────────────────────────────────────

@dataclass
class CandidateRelation:
    """A relation inferred by auto-discovery, not yet in the graph."""
    source_entity_id: str = ""
    target_entity_id: str = ""
    source_entity_name: str = ""
    target_entity_name: str = ""
    relation_type: RelationType = RelationType.CONNECTED_TO
    confidence: float = 0.0
    discovered_by: str = ""          # "python_ast" | "kicad_netlist" | "config_file"
    evidence: str = ""               # human-readable explanation
    added: bool = False              # True after auto-add succeeds


@dataclass
class DiscoveryReport:
    """Results from running auto-discovery on a project."""
    total_candidates: int = 0
    new_relations: int = 0
    duplicates_skipped: int = 0
    boosted: int = 0
    relations: list[CandidateRelation] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
```

- [ ] **Step 2: Add PyYAML to requirements.txt**

Append to `apps/backend/requirements.txt`:

```
PyYAML>=6.0
```

Run: `cd /Users/bentontameling/VentureHacksSolus/apps/backend && pip install PyYAML>=6.0`

- [ ] **Step 3: Create test fixture — Python ROS node (motor_controller.py)**

Create `apps/backend/tests/fixtures/discovery/motor_controller.py`:

```python
"""Fixture: a ROS2 motor controller node with discoverable patterns."""
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist

# Hardware constants — discoverable by AST analyzer
DRV8825_STEP_PIN = 17
DRV8825_DIR_PIN = 27
MICROSTEPPING = 16

class MotorController(Node):
    def __init__(self):
        super().__init__('motor_controller')
        # ROS topic subscription — discoverable
        self.subscription = self.create_subscription(
            Twist, '/cmd_vel', self.cmd_callback, 10)
        # ROS topic publisher — discoverable
        self.odom_pub = self.create_publisher(
            Twist, '/odom', 10)

    def cmd_callback(self, msg):
        pass
```

- [ ] **Step 4: Create test fixture — Python ROS node (sensor_reader.py)**

Create `apps/backend/tests/fixtures/discovery/sensor_reader.py`:

```python
"""Fixture: a ROS2 sensor reader with I2C hardware references."""
import rclpy
from rclpy.node import Node

# Hardware I2C addresses — discoverable by AST analyzer
IMU_ADDRESS = 0x68      # MPU6050
TOF_ADDRESS = 0x29      # VL53L0X

class SensorReader(Node):
    def __init__(self):
        super().__init__('sensor_reader')
        self.imu_pub = self.create_publisher(None, '/imu/data', 10)
        self.scan_pub = self.create_publisher(None, '/scan', 10)

    def read_imu(self):
        # I2C bus read — address discoverable
        data = self.bus.read_byte_data(0x68, 0x3B)
        return data
```

- [ ] **Step 5: Create test fixture — KiCad PCB with shared nets**

Create `apps/backend/tests/fixtures/discovery/test_board.kicad_pcb`:

```
(kicad_pcb (version 20211014) (generator pcbnew)
  (net 0 "")
  (net 1 "VCC")
  (net 2 "GND")
  (net 3 "I2C_SDA")
  (net 4 "I2C_SCL")
  (net 5 "MOTOR_STEP")
  (footprint "Package_QFP:LQFP-48" (layer "F.Cu") (at 100 80)
    (property "Reference" "U1")
    (property "Value" "ESP32")
    (pad "1" smd rect (at 0 0) (size 0.5 1.0) (layers "F.Cu") (net 1 "VCC"))
    (pad "2" smd rect (at 1 0) (size 0.5 1.0) (layers "F.Cu") (net 3 "I2C_SDA"))
    (pad "3" smd rect (at 2 0) (size 0.5 1.0) (layers "F.Cu") (net 4 "I2C_SCL"))
  )
  (footprint "Package_SO:HTSSOP-28" (layer "F.Cu") (at 120 80)
    (property "Reference" "U2")
    (property "Value" "DRV8825")
    (pad "1" smd rect (at 0 0) (size 0.5 1.0) (layers "F.Cu") (net 1 "VCC"))
    (pad "2" smd rect (at 1 0) (size 0.5 1.0) (layers "F.Cu") (net 5 "MOTOR_STEP"))
  )
  (footprint "Package_LGA:LGA-14" (layer "F.Cu") (at 140 80)
    (property "Reference" "U3")
    (property "Value" "MPU6050")
    (pad "1" smd rect (at 0 0) (size 0.5 1.0) (layers "F.Cu") (net 3 "I2C_SDA"))
    (pad "2" smd rect (at 1 0) (size 0.5 1.0) (layers "F.Cu") (net 4 "I2C_SCL"))
    (pad "3" smd rect (at 2 0) (size 0.5 1.0) (layers "F.Cu") (net 2 "GND"))
  )
  (footprint "Package_LGA:LGA-12" (layer "F.Cu") (at 160 80)
    (property "Reference" "U4")
    (property "Value" "VL53L0X")
    (pad "1" smd rect (at 0 0) (size 0.5 1.0) (layers "F.Cu") (net 3 "I2C_SDA"))
    (pad "2" smd rect (at 1 0) (size 0.5 1.0) (layers "F.Cu") (net 4 "I2C_SCL"))
  )
  (footprint "Connector_Motor" (layer "F.Cu") (at 180 80)
    (property "Reference" "M1")
    (property "Value" "NEMA17")
    (pad "1" smd rect (at 0 0) (size 0.5 1.0) (layers "F.Cu") (net 5 "MOTOR_STEP"))
  )
)
```

- [ ] **Step 6: Create test fixture — YAML config with entity references**

Create `apps/backend/tests/fixtures/discovery/motor_params.yaml`:

```yaml
# Motor configuration — references discoverable by config analyzer
motor:
  driver: DRV8825
  step_mode: 16
  max_current_a: 1.5
  motor_type: NEMA17

sensors:
  imu:
    address: "0x68"
    topic: /imu/data
  tof:
    address: "0x29"
    topic: /scan

control:
  velocity_topic: /cmd_vel
  odometry_topic: /odom
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared_types/src/models.py apps/backend/requirements.txt apps/backend/tests/fixtures/discovery/
git commit -m "feat: add discovery data models, test fixtures, and PyYAML dependency"
```

---

## Task 2: Python AST Analyzer

**Files:**
- Create: `apps/backend/tests/test_python_ast_analyzer.py`
- Create: `apps/backend/src/analyzers/__init__.py`
- Create: `apps/backend/src/analyzers/python_ast_analyzer.py`

**Context:** The Python AST analyzer reads `.py` files from disk, walks the AST to find import statements (→ `depends_on`), ROS topic publisher/subscriber calls (→ `publishes`/`subscribes_to`), and hardware address references (→ `reads_from`). It receives an `EntityIndex` dict for name-to-ID resolution. It does NOT touch the database — it returns a list of `CandidateRelation` objects.

- [ ] **Step 1: Write failing tests for Python AST analyzer**

Create `apps/backend/tests/test_python_ast_analyzer.py`:

```python
"""Tests for the Python AST analyzer."""

import os
from packages.shared_types.src.models import (
    Entity, EntityType, RelationType, SourceType,
)

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "discovery")


def _make_index():
    """Build a minimal EntityIndex for test matching."""
    from apps.backend.src.analyzers.python_ast_analyzer import EntityIndex
    entities = [
        Entity(id="e-motor-ctrl", entity_type=EntityType.SOFTWARE_MODULE,
               name="motor_controller.py", source_ref="src/motor_controller.py"),
        Entity(id="e-sensor-rdr", entity_type=EntityType.SOFTWARE_MODULE,
               name="sensor_reader.py", source_ref="src/sensor_reader.py"),
        Entity(id="e-drv8825", entity_type=EntityType.ELECTRICAL_PART,
               name="DRV8825", metadata={"ref": "U2", "addr": ""}),
        Entity(id="e-mpu6050", entity_type=EntityType.ELECTRICAL_PART,
               name="MPU6050", metadata={"ref": "U3", "addr": "0x68"}),
        Entity(id="e-vl53l0x", entity_type=EntityType.ELECTRICAL_PART,
               name="VL53L0X", metadata={"ref": "U4", "addr": "0x29"}),
        Entity(id="e-cmd-vel", entity_type=EntityType.INTERFACE,
               name="/cmd_vel"),
        Entity(id="e-odom", entity_type=EntityType.INTERFACE,
               name="/odom"),
        Entity(id="e-imu-data", entity_type=EntityType.INTERFACE,
               name="/imu/data"),
        Entity(id="e-scan", entity_type=EntityType.INTERFACE,
               name="/scan"),
    ]
    return EntityIndex(entities)


class TestRosTopicDiscovery:
    def test_finds_subscription(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_controller.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-motor-ctrl", index)
        subs = [r for r in results if r.relation_type == RelationType.SUBSCRIBES_TO]
        assert any(r.target_entity_id == "e-cmd-vel" for r in subs)

    def test_finds_publisher(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_controller.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-motor-ctrl", index)
        pubs = [r for r in results if r.relation_type == RelationType.PUBLISHES]
        assert any(r.target_entity_id == "e-odom" for r in pubs)

    def test_confidence_is_085(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_controller.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-motor-ctrl", index)
        topic_results = [r for r in results if r.relation_type in (RelationType.PUBLISHES, RelationType.SUBSCRIBES_TO)]
        assert all(r.confidence == 0.85 for r in topic_results)


class TestHardwareRefDiscovery:
    def test_finds_hex_address_match(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "sensor_reader.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-sensor-rdr", index)
        hw_results = [r for r in results if r.relation_type == RelationType.READS_FROM]
        target_ids = {r.target_entity_id for r in hw_results}
        assert "e-mpu6050" in target_ids  # 0x68
        assert "e-vl53l0x" in target_ids  # 0x29

    def test_finds_name_reference(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_controller.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-motor-ctrl", index)
        hw_results = [r for r in results if r.relation_type == RelationType.CONFIGURED_BY]
        target_ids = {r.target_entity_id for r in hw_results}
        assert "e-drv8825" in target_ids  # DRV8825 in variable names


class TestAllFieldsPresent:
    def test_candidate_has_all_fields(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_controller.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-motor-ctrl", index)
        assert len(results) > 0
        r = results[0]
        assert r.source_entity_id == "e-motor-ctrl"
        assert r.discovered_by == "python_ast"
        assert r.evidence != ""
        assert r.source_entity_name == "motor_controller.py"


class TestBadFile:
    def test_nonexistent_file_returns_empty(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        results = PythonAstAnalyzer.analyze_file("/nonexistent.py", "e-x", index)
        assert results == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_python_ast_analyzer.py -v 2>&1 | head -20`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.backend.src.analyzers'`

- [ ] **Step 3: Implement EntityIndex and PythonAstAnalyzer**

Create `apps/backend/src/analyzers/__init__.py` (empty file).

Create `apps/backend/src/analyzers/python_ast_analyzer.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_python_ast_analyzer.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/analyzers/ apps/backend/tests/test_python_ast_analyzer.py
git commit -m "feat: Python AST analyzer — discover imports, ROS topics, hardware refs"
```

---

## Task 3: KiCad Netlist Analyzer

**Files:**
- Create: `apps/backend/tests/test_kicad_netlist_analyzer.py`
- Create: `apps/backend/src/analyzers/kicad_netlist_analyzer.py`

**Context:** The KiCad netlist analyzer calls `KiCadConnector.parse_pcb()` on the `.kicad_pcb` file, then finds components that share signal nets (not power/ground). It creates `connected_to` relations for shared I2C/SPI/UART/signal nets, and `drives` relations for driver→motor connections. Power nets (VCC, GND, etc.) are filtered out to avoid combinatorial explosion.

- [ ] **Step 1: Write failing tests for KiCad netlist analyzer**

Create `apps/backend/tests/test_kicad_netlist_analyzer.py`:

```python
"""Tests for the KiCad netlist analyzer."""

import os
from packages.shared_types.src.models import (
    Entity, EntityType, RelationType,
)
from apps.backend.src.analyzers.python_ast_analyzer import EntityIndex

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "discovery")


def _make_index():
    """Build EntityIndex matching the test_board.kicad_pcb fixture."""
    entities = [
        Entity(id="e-esp32", entity_type=EntityType.ELECTRICAL_PART,
               name="ESP32", metadata={"ref": "U1"}),
        Entity(id="e-drv8825", entity_type=EntityType.ELECTRICAL_PART,
               name="DRV8825", metadata={"ref": "U2"}),
        Entity(id="e-mpu6050", entity_type=EntityType.ELECTRICAL_PART,
               name="MPU6050", metadata={"ref": "U3"}),
        Entity(id="e-vl53l0x", entity_type=EntityType.ELECTRICAL_PART,
               name="VL53L0X", metadata={"ref": "U4"}),
        Entity(id="e-nema17", entity_type=EntityType.MECHANICAL_PART,
               name="NEMA17", metadata={"ref": "M1"}),
    ]
    return EntityIndex(entities)


class TestSharedSignalNets:
    def test_i2c_components_connected(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        pcb_path = os.path.join(FIXTURES, "test_board.kicad_pcb")
        results = KicadNetlistAnalyzer.analyze_pcb(pcb_path, index)
        conn = [r for r in results if r.relation_type == RelationType.CONNECTED_TO]
        # ESP32 (U1), MPU6050 (U3), VL53L0X (U4) all share I2C_SDA
        pairs = {(r.source_entity_id, r.target_entity_id) for r in conn}
        # At least ESP32↔MPU6050 and ESP32↔VL53L0X via I2C
        assert ("e-esp32", "e-mpu6050") in pairs or ("e-mpu6050", "e-esp32") in pairs
        assert ("e-esp32", "e-vl53l0x") in pairs or ("e-vl53l0x", "e-esp32") in pairs

    def test_power_nets_filtered_out(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        pcb_path = os.path.join(FIXTURES, "test_board.kicad_pcb")
        results = KicadNetlistAnalyzer.analyze_pcb(pcb_path, index)
        # VCC and GND connect everything — should NOT produce relations
        for r in results:
            assert "VCC" not in r.evidence or "power" in r.evidence
            # No relation should exist purely from VCC/GND
            if r.relation_type == RelationType.CONNECTED_TO:
                assert "I2C" in r.evidence or "MOTOR" in r.evidence or "signal" in r.evidence.lower()


class TestDriverMotor:
    def test_drives_relation_discovered(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        pcb_path = os.path.join(FIXTURES, "test_board.kicad_pcb")
        results = KicadNetlistAnalyzer.analyze_pcb(pcb_path, index)
        drives = [r for r in results if r.relation_type == RelationType.DRIVES]
        # DRV8825 and NEMA17 share MOTOR_STEP net
        assert any(r.source_entity_id == "e-drv8825" and r.target_entity_id == "e-nema17" for r in drives)


class TestConfidenceAndEvidence:
    def test_confidence_is_095(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        pcb_path = os.path.join(FIXTURES, "test_board.kicad_pcb")
        results = KicadNetlistAnalyzer.analyze_pcb(pcb_path, index)
        assert all(r.confidence == 0.95 for r in results)

    def test_evidence_includes_net_name(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        pcb_path = os.path.join(FIXTURES, "test_board.kicad_pcb")
        results = KicadNetlistAnalyzer.analyze_pcb(pcb_path, index)
        assert all(r.evidence != "" for r in results)


class TestBadFile:
    def test_nonexistent_file_returns_empty(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        results = KicadNetlistAnalyzer.analyze_pcb("/nonexistent.kicad_pcb", index)
        assert results == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_kicad_netlist_analyzer.py -v 2>&1 | head -20`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement KicadNetlistAnalyzer**

Create `apps/backend/src/analyzers/kicad_netlist_analyzer.py`:

```python
"""
KiCad Netlist Analyzer — discover relations from shared PCB nets.

Discovers: connected_to (shared signal nets), drives (driver→motor).
Filters out power/ground nets to avoid combinatorial explosion.
"""

import re
from itertools import combinations

from apps.backend.src.connectors.kicad_connector import KiCadConnector
from apps.backend.src.analyzers.python_ast_analyzer import EntityIndex
from packages.shared_types.src.models import (
    RelationType, CandidateRelation,
)


_POWER_NET_RE = re.compile(r"^(VCC|VDD|V\d|GND|VBAT|\+\d+V|-\d+V|3V3|5V|12V)", re.IGNORECASE)


def _classify_net(name: str) -> str:
    """Classify a net by name pattern."""
    upper = name.upper()
    if _POWER_NET_RE.match(name):
        return "power"
    if any(k in upper for k in ("SDA", "SCL", "I2C")):
        return "I2C"
    if any(k in upper for k in ("MOSI", "MISO", "SCK", "SPI")):
        return "SPI"
    if any(k in upper for k in ("TX", "RX", "UART")):
        return "UART"
    if any(k in upper for k in ("MOTOR", "STEP", "DIR")):
        return "motor_control"
    return "signal"


class KicadNetlistAnalyzer:
    """Analyze KiCad PCB files for component connectivity."""

    @staticmethod
    def analyze_pcb(
        pcb_path: str,
        index: EntityIndex,
    ) -> list[CandidateRelation]:
        """Analyze a .kicad_pcb file. Returns candidate relations."""
        try:
            pcb_data = KiCadConnector.parse_pcb(pcb_path)
        except (FileNotFoundError, PermissionError, Exception):
            return []

        components = pcb_data.get("components", [])

        # Map component reference → entity ID via index
        ref_to_entity: dict[str, str] = {}
        ref_to_name: dict[str, str] = {}
        for comp in components:
            ref = comp["name"]  # e.g., "U1"
            entity = index.by_ref.get(ref)
            if entity:
                ref_to_entity[ref] = entity.id
                ref_to_name[ref] = entity.name

        # Build net → [component refs] map
        net_components: dict[str, list[str]] = {}
        for comp in components:
            ref = comp["name"]
            if ref not in ref_to_entity:
                continue
            for net_name in comp.get("connected_nets", []):
                if net_name:
                    net_components.setdefault(net_name, []).append(ref)

        candidates: list[CandidateRelation] = []

        for net_name, refs in net_components.items():
            net_type = _classify_net(net_name)

            # Skip power nets
            if net_type == "power":
                continue

            # Skip nets with only one component
            if len(refs) < 2:
                continue

            # Motor control nets: look for driver→motor drives relation
            if net_type == "motor_control":
                drivers = [r for r in refs if r.startswith("U")]
                motors = [r for r in refs if r.startswith("M")]
                for d in drivers:
                    for m in motors:
                        if d in ref_to_entity and m in ref_to_entity:
                            candidates.append(CandidateRelation(
                                source_entity_id=ref_to_entity[d],
                                target_entity_id=ref_to_entity[m],
                                source_entity_name=ref_to_name.get(d, d),
                                target_entity_name=ref_to_name.get(m, m),
                                relation_type=RelationType.DRIVES,
                                confidence=0.95,
                                discovered_by="kicad_netlist",
                                evidence=f"{ref_to_name.get(d, d)} and {ref_to_name.get(m, m)} share motor net '{net_name}' on PCB",
                            ))

            # Signal nets: pairwise connected_to
            # Sort refs to normalize and avoid A→B + B→A
            sorted_refs = sorted(set(refs))
            for a, b in combinations(sorted_refs, 2):
                if a in ref_to_entity and b in ref_to_entity:
                    candidates.append(CandidateRelation(
                        source_entity_id=ref_to_entity[a],
                        target_entity_id=ref_to_entity[b],
                        source_entity_name=ref_to_name.get(a, a),
                        target_entity_name=ref_to_name.get(b, b),
                        relation_type=RelationType.CONNECTED_TO,
                        confidence=0.95,
                        discovered_by="kicad_netlist",
                        evidence=f"{ref_to_name.get(a, a)} and {ref_to_name.get(b, b)} share {net_type} net '{net_name}' on PCB",
                    ))

        # Dedup: same pair + same relation_type → keep first
        seen = set()
        deduped = []
        for c in candidates:
            key = (min(c.source_entity_id, c.target_entity_id),
                   max(c.source_entity_id, c.target_entity_id),
                   c.relation_type)
            if key not in seen:
                seen.add(key)
                deduped.append(c)

        return deduped
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_kicad_netlist_analyzer.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/analyzers/kicad_netlist_analyzer.py apps/backend/tests/test_kicad_netlist_analyzer.py
git commit -m "feat: KiCad netlist analyzer — discover connected_to and drives from shared PCB nets"
```

---

## Task 4: Config File Analyzer

**Files:**
- Create: `apps/backend/tests/test_config_file_analyzer.py`
- Create: `apps/backend/src/analyzers/config_file_analyzer.py`

**Context:** The config file analyzer reads YAML/JSON/TOML files, recursively walks all string values, and checks if they match known entity names, addresses, or topic names from the EntityIndex. Matches produce `configured_by` relations.

- [ ] **Step 1: Write failing tests for config file analyzer**

Create `apps/backend/tests/test_config_file_analyzer.py`:

```python
"""Tests for the config file analyzer."""

import os
from packages.shared_types.src.models import (
    Entity, EntityType, RelationType,
)
from apps.backend.src.analyzers.python_ast_analyzer import EntityIndex

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "discovery")


def _make_index():
    """Build EntityIndex matching the motor_params.yaml fixture."""
    entities = [
        Entity(id="e-drv8825", entity_type=EntityType.ELECTRICAL_PART,
               name="DRV8825", metadata={"ref": "U2"}),
        Entity(id="e-nema17", entity_type=EntityType.MECHANICAL_PART,
               name="NEMA17", metadata={"ref": "M1"}),
        Entity(id="e-mpu6050", entity_type=EntityType.ELECTRICAL_PART,
               name="MPU6050", metadata={"ref": "U3", "addr": "0x68"}),
        Entity(id="e-vl53l0x", entity_type=EntityType.ELECTRICAL_PART,
               name="VL53L0X", metadata={"ref": "U4", "addr": "0x29"}),
        Entity(id="e-cmd-vel", entity_type=EntityType.INTERFACE, name="/cmd_vel"),
        Entity(id="e-odom", entity_type=EntityType.INTERFACE, name="/odom"),
        Entity(id="e-imu-data", entity_type=EntityType.INTERFACE, name="/imu/data"),
        Entity(id="e-scan", entity_type=EntityType.INTERFACE, name="/scan"),
        Entity(id="e-config", entity_type=EntityType.DOCUMENT,
               name="motor_params.yaml", source_ref="config/motor_params.yaml"),
    ]
    return EntityIndex(entities)


class TestYamlEntityReferences:
    def test_finds_entity_name_reference(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_params.yaml")
        results = ConfigFileAnalyzer.analyze_file(path, "e-config", index)
        target_ids = {r.target_entity_id for r in results}
        assert "e-drv8825" in target_ids   # "DRV8825" in YAML
        assert "e-nema17" in target_ids    # "NEMA17" in YAML

    def test_finds_address_reference(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_params.yaml")
        results = ConfigFileAnalyzer.analyze_file(path, "e-config", index)
        target_ids = {r.target_entity_id for r in results}
        assert "e-mpu6050" in target_ids   # "0x68" in YAML

    def test_finds_topic_reference(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_params.yaml")
        results = ConfigFileAnalyzer.analyze_file(path, "e-config", index)
        target_ids = {r.target_entity_id for r in results}
        assert "e-cmd-vel" in target_ids   # "/cmd_vel" in YAML
        assert "e-imu-data" in target_ids  # "/imu/data" in YAML

    def test_relation_type_is_configured_by(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_params.yaml")
        results = ConfigFileAnalyzer.analyze_file(path, "e-config", index)
        assert all(r.relation_type == RelationType.CONFIGURED_BY for r in results)

    def test_confidence_is_07(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_params.yaml")
        results = ConfigFileAnalyzer.analyze_file(path, "e-config", index)
        assert all(r.confidence == 0.7 for r in results)


class TestBadFile:
    def test_nonexistent_file_returns_empty(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        results = ConfigFileAnalyzer.analyze_file("/nonexistent.yaml", "e-x", index)
        assert results == []

    def test_json_file(self, tmp_path):
        """Test that JSON files are also parsed."""
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        json_file = tmp_path / "config.json"
        json_file.write_text('{"driver": "DRV8825", "topic": "/cmd_vel"}')
        results = ConfigFileAnalyzer.analyze_file(str(json_file), "e-config", index)
        target_ids = {r.target_entity_id for r in results}
        assert "e-drv8825" in target_ids
        assert "e-cmd-vel" in target_ids
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_config_file_analyzer.py -v 2>&1 | head -20`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement ConfigFileAnalyzer**

Create `apps/backend/src/analyzers/config_file_analyzer.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_config_file_analyzer.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/analyzers/config_file_analyzer.py apps/backend/tests/test_config_file_analyzer.py
git commit -m "feat: config file analyzer — discover configured_by from YAML/JSON/TOML references"
```

---

## Task 5: Discovery Engine — Orchestration, Merge, Dedup

**Files:**
- Create: `apps/backend/tests/test_discovery_engine.py`
- Create: `apps/backend/src/discovery_engine.py`

**Context:** The DiscoveryEngine ties everything together. It builds the EntityIndex, resolves file paths from source connections, runs each analyzer, merges results with cross-modal confidence boosting, deduplicates against the existing graph, and optionally batch-inserts new relations in a single transaction.

- [ ] **Step 1: Write failing tests for discovery engine**

Create `apps/backend/tests/test_discovery_engine.py`:

```python
"""Tests for the DiscoveryEngine — merge, dedup, boosting."""

import os
from packages.shared_types.src.models import (
    Entity, EntityType, RelationType, Relation,
    CandidateRelation, SourceConnection, SourceType,
)


class TestMergeAndDedup:
    def test_dedup_against_existing_relations(self, project_id):
        from apps.backend.src.discovery_engine import DiscoveryEngine
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        # Create two entities and an existing relation
        e1 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="ESP32"))
        e2 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="MPU6050"))
        engine.create_relation(Relation(
            source_entity_id=e1.id, target_entity_id=e2.id,
            relation_type=RelationType.CONNECTED_TO,
        ))
        # Candidate that duplicates the existing relation
        candidate = CandidateRelation(
            source_entity_id=e1.id, target_entity_id=e2.id,
            source_entity_name="ESP32", target_entity_name="MPU6050",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.95, discovered_by="kicad_netlist", evidence="test",
        )
        disco = DiscoveryEngine(project_id)
        report = disco._merge_and_dedup([candidate])
        assert report.duplicates_skipped == 1
        assert report.new_relations == 0

    def test_cross_modal_boosting(self, project_id):
        from apps.backend.src.discovery_engine import DiscoveryEngine
        # Two candidates from different analyzers for the same relation
        c1 = CandidateRelation(
            source_entity_id="a", target_entity_id="b",
            source_entity_name="X", target_entity_name="Y",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.85, discovered_by="python_ast", evidence="from AST",
        )
        c2 = CandidateRelation(
            source_entity_id="a", target_entity_id="b",
            source_entity_name="X", target_entity_name="Y",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.95, discovered_by="kicad_netlist", evidence="from PCB",
        )
        disco = DiscoveryEngine(project_id)
        report = disco._merge_and_dedup([c1, c2])
        assert report.boosted == 1
        # Boosted confidence: min(1.0, max(0.85, 0.95) + 0.1) = 1.0
        assert report.relations[0].confidence == 1.0
        assert "AST" in report.relations[0].evidence
        assert "PCB" in report.relations[0].evidence

    def test_symmetric_dedup(self, project_id):
        from apps.backend.src.discovery_engine import DiscoveryEngine
        c1 = CandidateRelation(
            source_entity_id="a", target_entity_id="b",
            source_entity_name="X", target_entity_name="Y",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.95, discovered_by="kicad_netlist", evidence="test",
        )
        c2 = CandidateRelation(
            source_entity_id="b", target_entity_id="a",
            source_entity_name="Y", target_entity_name="X",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.95, discovered_by="kicad_netlist", evidence="test reverse",
        )
        disco = DiscoveryEngine(project_id)
        report = disco._merge_and_dedup([c1, c2])
        assert report.new_relations == 1  # only one direction kept

    def test_min_confidence_filter(self, project_id):
        from apps.backend.src.discovery_engine import DiscoveryEngine
        c_high = CandidateRelation(
            source_entity_id="a", target_entity_id="b",
            source_entity_name="X", target_entity_name="Y",
            relation_type=RelationType.DEPENDS_ON,
            confidence=0.9, discovered_by="python_ast", evidence="test",
        )
        c_low = CandidateRelation(
            source_entity_id="c", target_entity_id="d",
            source_entity_name="W", target_entity_name="Z",
            relation_type=RelationType.CONFIGURED_BY,
            confidence=0.4, discovered_by="config_file", evidence="test",
        )
        disco = DiscoveryEngine(project_id)
        report = disco._merge_and_dedup([c_high, c_low], min_confidence=0.6)
        assert report.new_relations == 1
        assert report.relations[0].confidence == 0.9


class TestBatchAdd:
    def test_auto_add_creates_relations(self, project_id):
        from apps.backend.src.discovery_engine import DiscoveryEngine
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e1 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="ChipA"))
        e2 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="ChipB"))
        candidate = CandidateRelation(
            source_entity_id=e1.id, target_entity_id=e2.id,
            source_entity_name="ChipA", target_entity_name="ChipB",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.95, discovered_by="kicad_netlist", evidence="test",
        )
        disco = DiscoveryEngine(project_id)
        disco._batch_add_relations([candidate])
        rels = engine.list_relations()
        assert len(rels) == 1
        assert rels[0].source_entity_id == e1.id
        assert rels[0].target_entity_id == e2.id
        assert candidate.added is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_discovery_engine.py -v 2>&1 | head -20`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement DiscoveryEngine**

Create `apps/backend/src/discovery_engine.py`:

```python
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
from .connectors.kicad_connector import KiCadConnector

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
            # Add reverse for symmetric types
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
            # Check against existing relations
            src, tgt, rt_val = key
            if (src, tgt, rt_val) in existing_keys:
                duplicates_skipped += 1
                continue

            if len(group) > 1:
                # Cross-modal boosting
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_discovery_engine.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/discovery_engine.py apps/backend/tests/test_discovery_engine.py
git commit -m "feat: discovery engine — merge, dedup, cross-modal boosting, batch add"
```

---

## Task 6: API Route + Wiring

**Files:**
- Create: `apps/backend/tests/test_routes_discovery.py`
- Create: `apps/backend/src/routes_discovery.py`
- Modify: `apps/backend/src/main.py`

**Context:** One FastAPI endpoint: `POST /api/projects/{id}/discover`. Accepts optional `analyzers`, `auto_add`, and `min_confidence` parameters. Returns the full DiscoveryReport as JSON.

- [ ] **Step 1: Write failing tests for the API route**

Create `apps/backend/tests/test_routes_discovery.py`:

```python
"""Integration tests for the discovery API route."""

import os
import pytest
from fastapi.testclient import TestClient

from packages.shared_types.src.models import (
    Entity, EntityType, SourceType, SourceConnection,
)


@pytest.fixture
def client(fresh_db):
    from apps.backend.src.main import app
    return TestClient(app)


@pytest.fixture
def seeded_project(client, project_id, tmp_path):
    """Create a project with entities and source connections pointing to fixture files."""
    from apps.backend.src.context_engine import ContextEngine
    engine = ContextEngine(project_id)

    fixtures = os.path.join(os.path.dirname(__file__), "fixtures", "discovery")

    # Source connection pointing to fixtures dir as "repo"
    engine.create_source(SourceConnection(
        source_type=SourceType.GITHUB,
        name="Test Repo",
        config={"repo_path": fixtures},
    ))

    # Software entities with source_ref relative to fixtures dir
    engine.create_entity(Entity(
        entity_type=EntityType.SOFTWARE_MODULE,
        name="motor_controller.py",
        source_ref="motor_controller.py",
    ))

    # Interface entities
    engine.create_entity(Entity(entity_type=EntityType.INTERFACE, name="/cmd_vel"))
    engine.create_entity(Entity(entity_type=EntityType.INTERFACE, name="/odom"))

    # Electrical entities
    engine.create_entity(Entity(
        entity_type=EntityType.ELECTRICAL_PART,
        name="DRV8825", metadata={"ref": "U2"},
    ))

    return project_id


class TestDiscoverEndpoint:
    def test_discover_returns_report(self, client, seeded_project):
        resp = client.post(f"/api/projects/{seeded_project}/discover",
                           json={"analyzers": ["python_ast"]})
        assert resp.status_code == 200
        data = resp.json()
        assert "total_candidates" in data
        assert "relations" in data
        assert "warnings" in data

    def test_discover_finds_ros_topics(self, client, seeded_project):
        resp = client.post(f"/api/projects/{seeded_project}/discover",
                           json={"analyzers": ["python_ast"]})
        data = resp.json()
        rel_types = {r["relation_type"] for r in data["relations"]}
        assert "subscribes_to" in rel_types or "publishes" in rel_types

    def test_discover_with_auto_add(self, client, seeded_project):
        resp = client.post(f"/api/projects/{seeded_project}/discover",
                           json={"analyzers": ["python_ast"], "auto_add": True})
        data = resp.json()
        if data["new_relations"] > 0:
            assert any(r["added"] for r in data["relations"])
            # Verify relations were actually created in the graph
            graph_resp = client.get(f"/api/projects/{seeded_project}/graph")
            graph = graph_resp.json()
            assert len(graph["relations"]) > 0

    def test_discover_nonexistent_project(self, client):
        resp = client.post("/api/projects/fake-id/discover", json={})
        assert resp.status_code == 404

    def test_discover_default_params(self, client, seeded_project):
        resp = client.post(f"/api/projects/{seeded_project}/discover", json={})
        assert resp.status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_routes_discovery.py -v 2>&1 | head -20`
Expected: FAIL — 404 (route doesn't exist)

- [ ] **Step 3: Implement routes_discovery.py**

Create `apps/backend/src/routes_discovery.py`:

```python
"""
Discovery API Route — trigger auto-relation discovery.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from .context_engine import ContextEngine
from .discovery_engine import DiscoveryEngine

router = APIRouter(prefix="/api")


class DiscoverReq(BaseModel):
    analyzers: Optional[list[str]] = None
    auto_add: bool = False
    min_confidence: float = 0.6


def _require_project(project_id: str):
    p = ContextEngine.get_project(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")


@router.post("/projects/{project_id}/discover")
async def discover_relations(project_id: str, req: DiscoverReq = DiscoverReq()):
    _require_project(project_id)
    disco = DiscoveryEngine(project_id)
    report = disco.discover(
        analyzers=req.analyzers,
        auto_add=req.auto_add,
        min_confidence=req.min_confidence,
    )
    return {
        "total_candidates": report.total_candidates,
        "new_relations": report.new_relations,
        "duplicates_skipped": report.duplicates_skipped,
        "boosted": report.boosted,
        "warnings": report.warnings,
        "relations": [
            {
                "source_entity_id": r.source_entity_id,
                "source_entity_name": r.source_entity_name,
                "target_entity_id": r.target_entity_id,
                "target_entity_name": r.target_entity_name,
                "relation_type": r.relation_type.value if hasattr(r.relation_type, 'value') else r.relation_type,
                "confidence": r.confidence,
                "discovered_by": r.discovered_by,
                "evidence": r.evidence,
                "added": r.added,
            }
            for r in report.relations
        ],
    }
```

- [ ] **Step 4: Wire router into main.py**

Add to `apps/backend/src/main.py` after the existing router includes:

```python
# Discovery routes
try:
    from .routes_discovery import router as discovery_router
    app.include_router(discovery_router)
except ImportError:
    pass
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_routes_discovery.py -v`
Expected: All tests PASS

- [ ] **Step 6: Run ALL tests to verify nothing is broken**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/ -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/routes_discovery.py apps/backend/src/main.py apps/backend/tests/test_routes_discovery.py
git commit -m "feat: discovery API route — POST /api/projects/{id}/discover"
```

---

## Parallelism Map

```
Task 1 (Data Models + Fixtures)  ──sequential──▶ Task 2 (Python AST Analyzer)
                                  ──sequential──▶ Task 3 (KiCad Netlist Analyzer)
                                  ──sequential──▶ Task 4 (Config File Analyzer)

Tasks 2, 3, 4 can run in parallel (independent analyzers, all depend on Task 1 only)

Task 5 (Discovery Engine)         ──depends on──▶ Tasks 2, 3, 4
Task 6 (API Route + Wiring)       ──depends on──▶ Task 5
```

**Optimal dispatch order:**
1. Task 1 (data models + fixtures)
2. Tasks 2 + 3 + 4 (parallel — independent analyzers)
3. Task 5 (merge engine — after all analyzers done)
4. Task 6 (API route — last)
