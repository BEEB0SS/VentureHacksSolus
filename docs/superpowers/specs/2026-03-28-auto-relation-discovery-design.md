# Auto Relation Discovery — Design Spec

**Goal:** Automatically infer relations between entities in the context model by analyzing source code (Python AST), KiCad netlists, and config files. Outputs discovered edges with confidence scores, deduped against existing relations.

**Timeline:** Before Causal Debugging and Live Graph Animation — enriches the graph they depend on.

**Dependencies:** Context Engine (entity/relation CRUD), KiCad Connector (parsed PCB data), GitHub Connector (tracked files).

---

## Architecture

Three independent analyzers produce candidate relations. A merge step deduplicates against existing relations and combines cross-modal confidence scores.

```
Source Sync (or on-demand trigger)
  → Build entity lookup index (name/ref/metadata → entity ID)
  → Python AST Analyzer → candidate relations
  → KiCad Netlist Analyzer → candidate relations
  → Config File Analyzer → candidate relations
  → Merge & Dedup (against existing graph)
  → Discovery Report + optionally auto-add to graph (batched transaction)
```

New file: `apps/backend/src/discovery_engine.py` — orchestrates all three analyzers.
New file: `apps/backend/src/routes_discovery.py` — one API endpoint.

---

## Data Model

Dataclasses live in `packages/shared_types/src/models.py` alongside existing types.

```python
@dataclass
class CandidateRelation:
    source_entity_id: str           # existing entity in graph
    target_entity_id: str           # existing entity in graph
    source_entity_name: str         # for display (looked up from entity)
    target_entity_name: str         # for display (looked up from entity)
    relation_type: RelationType     # typed enum, not plain string
    confidence: float               # 0.0 - 1.0
    discovered_by: str              # "python_ast" | "kicad_netlist" | "config_file"
    evidence: str                   # human-readable explanation
    added: bool = False             # set to True after auto-add succeeds

@dataclass
class DiscoveryReport:
    total_candidates: int
    new_relations: int              # candidates not already in graph
    duplicates_skipped: int         # already existed
    boosted: int                    # found by multiple analyzers
    relations: list[CandidateRelation]
    warnings: list[str]             # skipped files, parse errors, etc.
```

---

## Entity Lookup Index

**Built once by the DiscoveryEngine before any analyzer runs.** This solves name-to-ID resolution consistently across all analyzers.

```python
class EntityIndex:
    """Pre-built lookup structure for matching names/refs/metadata to entity IDs."""

    by_name: dict[str, Entity]              # "DRV8825" → Entity
    by_name_lower: dict[str, Entity]        # "drv8825" → Entity (case-insensitive)
    by_ref: dict[str, Entity]               # "U1" → Entity (from metadata["ref"])
    by_addr: dict[str, Entity]              # "0x68" → Entity (from metadata["addr"])
    by_topic: dict[str, Entity]             # "/cmd_vel" → Entity (interface entities by name)
    by_module: dict[str, Entity]            # "motor_controller" → Entity (strip .py)
```

Built from `engine.list_entities()`. Each analyzer receives this index and uses it for resolution — no analyzer does its own entity lookups.

**Ambiguity:** If two entities share a name (unlikely in a single project, but possible), the index stores the first one and adds a warning. The implementer should use the most specific match available (ref > addr > name).

---

## File Path Resolution

**Problem:** Analyzers need to read files from disk, but source connection configs are inconsistent — seed data uses `"repo"` key, routes use `"repo_path"`.

**Solution:** The DiscoveryEngine resolves file paths with this logic:

```python
def _resolve_file_path(self, entity: Entity) -> Optional[str]:
    """Resolve an entity's source_ref to an absolute file path."""
    source = self._get_source_for_entity(entity)
    if not source:
        return None
    # Try both config keys (normalize the inconsistency)
    repo_path = source.config.get("repo_path") or source.config.get("repo") or ""
    if not repo_path or not os.path.isdir(repo_path):
        return None
    full_path = os.path.join(repo_path, entity.source_ref)
    return full_path if os.path.isfile(full_path) else None

def _resolve_kicad_pcb_path(self, source: SourceConnection) -> Optional[str]:
    """Resolve the .kicad_pcb file path from a KiCad source connection."""
    # Try pcb_path config key first
    pcb_path = source.config.get("pcb_path")
    if pcb_path and os.path.isfile(pcb_path):
        return pcb_path
    # Try sibling of schematic file (replace .kicad_sch with .kicad_pcb)
    sch_path = source.config.get("schematic_path") or source.config.get("file") or ""
    if sch_path:
        pcb_path = sch_path.replace(".kicad_sch", ".kicad_pcb")
        if os.path.isfile(pcb_path):
            return pcb_path
    return None
```

Each analyzer calls `_resolve_file_path()` and skips entities whose files can't be found — adding a warning to the report.

---

## Analyzer 1: Python AST

**Input:** All entities with `entity_type == "software_module"` and a `.py` file extension. Uses `_resolve_file_path()` to find the file on disk.

**Extractions:**

### Import Statements → `depends_on`

```python
import motor_controller    # → depends_on if motor_controller.py is an entity
from sensor_reader import  # → depends_on if sensor_reader.py is an entity
```

Walk the AST for `Import` and `ImportFrom` nodes. Match the module name against `EntityIndex.by_module`. Confidence: 0.9.

### ROS Topic Strings → `publishes` / `subscribes_to`

```python
self.publisher = self.create_publisher(Twist, '/cmd_vel', 10)
self.subscription = self.create_subscription(Imu, '/imu/data', self.callback, 10)
self.srv = self.create_service(SetBool, '/enable_motors', self.callback)
self.client = self.create_client(SetBool, '/enable_motors')
```

Walk the AST for `Call` nodes where the function name matches:
- `create_publisher`, `Publisher` → `publishes`
- `create_subscription`, `Subscriber` → `subscribes_to`
- `create_service` → `publishes` (service server)
- `create_client` → `subscribes_to` (service client)

Extract string literal arguments that start with `/`. Match against `EntityIndex.by_topic`. Confidence: 0.85.

### Hardware References → `reads_from` / `configured_by`

```python
IMU_ADDRESS = 0x68          # matches MPU6050 metadata addr: "0x68"
bus.read_byte_data(0x68, REG)  # I2C read from address matching an entity
```

Walk the AST for:
- Hex literal assignments (`0x68`, `0x29`) → match against `EntityIndex.by_addr`
- Variable names containing hardware entity names (case-insensitive) → match against `EntityIndex.by_name_lower`
- I2C/SPI bus method calls with address arguments → match against `EntityIndex.by_addr`

Confidence: 0.7.

**Fallback:** If a `.py` file can't be read from disk, skip it and add warning to report.

---

## Analyzer 2: KiCad Netlist

**Input:** Source connections with `source_type == "kicad"`. Uses `_resolve_kicad_pcb_path()` to find the `.kicad_pcb` file, then calls `KiCadConnector.parse_pcb()`.

**Extractions:**

### Shared Signal Nets → `connected_to`

For each net, find all components connected to it. Create pairwise `connected_to` relations.

**Power net filtering:** Skip power/ground nets (`VCC`, `3V3`, `5V`, `GND`, `VBAT`, and any net matching `^(V\w+|GND\w*|\+\d+V|-\d+V)$`). These connect to nearly every component and would create a combinatorial explosion of low-value relations. Instead, create a single summary warning: "Skipped power net VCC (connects 6 components)."

**Signal net classification** (added as relation metadata):
- `SDA`, `SCL`, `I2C*` → I2C bus
- `MOSI`, `MISO`, `SCK`, `SPI*` → SPI bus
- `TX`, `RX`, `UART*` → UART
- `MOTOR*`, `STEP*`, `DIR*` → motor control
- Everything else → generic signal

Skip the empty net (`""`).

Confidence: 0.95 (netlists are ground truth).

### Motor/Driver Nets → `drives`

If a driver component (matched to an entity like DRV8825 via `EntityIndex.by_ref`) shares a motor-classified net with a motor component (reference prefix M), infer `driver --drives--> motor`. Confidence: 0.95.

**Matching to entities:** Match PCB component references (U1, R1, M1) against `EntityIndex.by_ref`.

---

## Analyzer 3: Config Files

**Input:** All entities with a `.yaml`, `.yml`, `.json`, or `.toml` file extension — regardless of entity_type (covers both `document` and `software_module` classifications). Uses `_resolve_file_path()` to find the file on disk.

**Note on seed data:** The current seed data does not include config file entities. The seed script must be updated to add at least one YAML config file entity (e.g., `motor_params.yaml` with content referencing DRV8825 and NEMA17) for this analyzer to produce results during the demo.

**Extractions:**

### Entity Name References → `configured_by`

Parse the config file. Recursively walk all string values. For each value, check if it matches:
- `EntityIndex.by_name` (exact, case-insensitive): `"DRV8825"`, `"motor_controller"`, `"MPU6050"`
- `EntityIndex.by_addr`: I2C address `"0x68"`, reference designator `"U1"`
- `EntityIndex.by_topic`: ROS topic name `"/cmd_vel"`, `"/imu/data"`

If a config file references an entity, infer `config_entity --configured_by--> referenced_entity`. Confidence: 0.7.

### Parameter Cross-References

If two config files reference the same entity or topic, infer `config_a --depends_on--> config_b` with lower confidence (0.5). Only include these if both configs are different files.

**Parsing:**
- `.yaml`/`.yml` → `yaml.safe_load()` (requires `PyYAML` — add to requirements.txt)
- `.json` → `json.loads()` (stdlib)
- `.toml` → `tomllib.load()` (stdlib Python 3.11+)

**Fallback:** If parsing fails (malformed file), skip it and add warning to report.

---

## Merge & Dedup

After all three analyzers return candidate relations:

1. **Dedup against existing graph:** For each candidate, check if a relation already exists between the same two entities with the same relation_type. If so, mark as `duplicate_skipped`.

2. **Cross-modal boosting:** If two analyzers independently discover the same relation (same source, target, and relation_type), boost confidence: `min(1.0, max(c1, c2) + 0.1)`. Mark as `boosted`. Keep the evidence from both (join with ` | `).

3. **Bidirectional dedup:** For symmetric relation types (`connected_to`, `similar_to`), `A → B` is the same as `B → A`. Normalize by sorting entity IDs and only keeping one direction. Don't create both.

4. **Filter by min_confidence.** Drop candidates below the threshold.

5. **Sort by confidence** descending. Return the DiscoveryReport.

---

## Auto-Add (Batched Transaction)

When `auto_add` is true, all new relations are inserted in a **single database transaction**:

```python
def _batch_add_relations(self, candidates: list[CandidateRelation]):
    conn = get_connection()
    try:
        for c in candidates:
            conn.execute(
                "INSERT INTO relations (...) VALUES (...)",
                (uid(), self.project_id, c.source_entity_id, c.target_entity_id,
                 c.relation_type.value, json.dumps({"discovered_by": c.discovered_by,
                 "evidence": c.evidence}), c.confidence, _now()),
            )
            c.added = True
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
```

Relations are added with metadata `{"discovered_by": "python_ast", "evidence": "..."}` so they're distinguishable from manual relations.

---

## API

### `POST /api/projects/{project_id}/discover`

Request body (all optional):
```json
{
  "analyzers": ["python_ast", "kicad_netlist", "config_file"],
  "auto_add": true,
  "min_confidence": 0.6
}
```

- `analyzers`: which analyzers to run (default: all three)
- `auto_add`: if true, automatically add discovered relations to the graph in a single transaction (default: false — preview mode)
- `min_confidence`: only include/add relations above this threshold (default: 0.6)

Response:
```json
{
  "total_candidates": 15,
  "new_relations": 11,
  "duplicates_skipped": 3,
  "boosted": 1,
  "warnings": ["Could not read file: config/missing.yaml (FileNotFoundError)"],
  "relations": [
    {
      "source_entity_id": "abc-123",
      "source_entity_name": "motor_controller.py",
      "target_entity_id": "def-456",
      "target_entity_name": "DRV8825",
      "relation_type": "configured_by",
      "confidence": 0.9,
      "discovered_by": "python_ast",
      "evidence": "motor_controller.py references DRV8825 step/dir pins at line 23",
      "added": true
    }
  ]
}
```

### Frontend Integration

The discovery report renders in the WorkspaceTab (or a new panel) as a list of discovered relations with confidence bars. Each relation has an "Add" / "Dismiss" button if `auto_add` is false. An "Apply All" button adds all relations above the confidence threshold.

On the ContextModelTab, discovered relations are shown as **dashed edges** (vs. solid for declared relations). The `added` boolean in the API response determines rendering — discovered relations are only stored in the database after auto-add or manual "Add" click. Before that, they exist only in frontend state from the API response and are lost on page refresh. This is acceptable for hackathon scope.

---

## Seed Data Update

Add to `apps/backend/scripts/seed_demo.py` — a config file entity so the Config File Analyzer has something to discover:

```python
# Config file entity
motor_params_id = uid()
cur.execute(
    "INSERT INTO entities (id, project_id, entity_type, name, description, metadata, source, source_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    (motor_params_id, project_id, "document", "motor_params.yaml",
     "Motor configuration parameters — step mode, current limits, speed profiles",
     json.dumps({"format": "yaml", "package": "diff_drive_bringup"}),
     "github", "config/motor_params.yaml", ts(20), ts(5)),
)
```

And create the corresponding fixture file for tests and demo.

---

## Files to Create

| File | Responsibility |
|------|---------------|
| `apps/backend/src/discovery_engine.py` | DiscoveryEngine class: EntityIndex builder, orchestrates analyzers, merge, dedup, batch add |
| `apps/backend/src/analyzers/__init__.py` | Empty package init |
| `apps/backend/src/analyzers/python_ast_analyzer.py` | Python AST analysis: imports, ROS topics, hardware refs |
| `apps/backend/src/analyzers/kicad_netlist_analyzer.py` | KiCad PCB net analysis: shared signal nets, driver-motor |
| `apps/backend/src/analyzers/config_file_analyzer.py` | Config file parsing: YAML/JSON/TOML entity references |
| `apps/backend/src/routes_discovery.py` | FastAPI APIRouter: POST /discover endpoint |
| `apps/backend/tests/test_python_ast_analyzer.py` | Tests for Python AST extraction |
| `apps/backend/tests/test_kicad_netlist_analyzer.py` | Tests for KiCad net analysis |
| `apps/backend/tests/test_config_file_analyzer.py` | Tests for config file analysis |
| `apps/backend/tests/test_discovery_engine.py` | Tests for merge, dedup, boosting, batch add |
| `apps/backend/tests/test_routes_discovery.py` | Integration tests for API endpoint |
| `apps/backend/tests/fixtures/discovery/` | Test fixture files (Python source, KiCad PCB, YAML config) |

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared_types/src/models.py` | Add `CandidateRelation` and `DiscoveryReport` dataclasses |
| `apps/backend/src/main.py` | Add `include_router(discovery_router)` |
| `apps/backend/requirements.txt` | Add `PyYAML>=6.0` |
| `apps/backend/scripts/seed_demo.py` | Add config file entity + fixture |
| `apps/desktop/src/renderer/components/context-model/ContextModelTab.tsx` | Render discovered relations as dashed edges |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| File can't be read from disk | Skip file, add warning to `report.warnings` |
| AST parse fails (syntax error in Python file) | Skip file, add warning |
| Config file malformed | Skip file, add warning |
| No source connections with local paths | Return empty report with warning, no error |
| Entity referenced in code doesn't exist in graph | Skip that candidate relation |
| All analyzers return zero candidates | Return report with zero counts, no error |
| KiCad source has no .kicad_pcb file (only schematic) | Skip netlist analysis, add warning |
| Power net connects many components | Skip power nets, add summary warning |
| Two entities share the same name | Use first match, add warning about ambiguity |
| Auto-add fails mid-transaction | Rollback all, return error |

---

## Demo Narrative

"We synced the robot's code repo and KiCad project. Now watch — I click Discover Relations. Solus analyzed the Python source code, the PCB netlist, and the config files. It found 12 connections we never explicitly defined: motor_controller.py subscribes to /cmd_vel — discovered from the AST. The ESP32 and MPU6050 share the I2C bus — discovered from the PCB netlist. The IMU calibration config references the MPU6050 — discovered from the YAML file. Two of these were found by both the code analyzer and the netlist analyzer independently, so their confidence got boosted. One click to add them all to the graph."
