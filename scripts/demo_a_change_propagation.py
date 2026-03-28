#!/usr/bin/env python3
"""
Demo A: Change Propagation — End-to-End Test

Simulates the full Demo A flow:
1. Create a project with a KiCad source
2. Sync the KiCad schematic (baseline: DRV8825 motor driver)
3. "Swap" the chip by modifying the schematic (DRV8825 → TMC2209)
4. Re-sync → detect the change via snapshot diff
5. Run impact analysis → show which software modules are affected
6. Show the full change propagation chain

Usage: python scripts/demo_a_change_propagation.py
  (requires backend running on localhost:8000)
"""

import json
import os
import shutil
import tempfile
import requests

API = "http://localhost:8000/api"
FIXTURES = os.path.join(os.path.dirname(__file__), "..", "apps", "backend", "tests", "fixtures")


def heading(text: str):
    print(f"\n{'='*60}")
    print(f"  {text}")
    print(f"{'='*60}\n")


def step(n: int, text: str):
    print(f"  [{n}] {text}")


def main():
    heading("DEMO A: Change Propagation")
    print("  Scenario: A chip is swapped on the PCB (DRV8825 → TMC2209).")
    print("  Solus detects the change, diffs the snapshots, and shows")
    print("  which software modules are impacted.\n")

    # ── Step 1: Create project ──
    heading("Step 1: Create Project")
    resp = requests.post(f"{API}/projects", json={
        "name": "Mars Rover",
        "description": "Autonomous exploration rover with 4WD stepper drive",
    })
    resp.raise_for_status()
    project = resp.json()
    pid = project["id"]
    step(1, f"Created project: {project['name']} ({pid[:8]}...)")

    # ── Step 2: Add entities + relations (the robot's system graph) ──
    heading("Step 2: Build System Graph")

    entities = {}
    entity_defs = [
        ("DRV8825", "electrical_part", "Stepper motor driver IC (original)"),
        ("motor_controller.py", "software_module", "Stepper control code — uses DRV8825 microstepping protocol"),
        ("ros_navigation.py", "software_module", "ROS navigation stack — depends on motor controller"),
        ("/cmd_vel", "interface", "ROS velocity command topic"),
        ("NEMA17", "mechanical_part", "Stepper motor — driven by DRV8825"),
    ]
    for name, etype, desc in entity_defs:
        r = requests.post(f"{API}/projects/{pid}/entities", json={
            "entity_type": etype, "name": name, "description": desc,
        })
        r.raise_for_status()
        entities[name] = r.json()
        step(2, f"  + {etype:20s} {name}")

    relations = [
        ("DRV8825", "motor_controller.py", "drives"),
        ("DRV8825", "NEMA17", "drives"),
        ("motor_controller.py", "ros_navigation.py", "depends_on"),
        ("ros_navigation.py", "/cmd_vel", "publishes"),
    ]
    for src, tgt, rtype in relations:
        requests.post(f"{API}/projects/{pid}/relations", json={
            "source_entity_id": entities[src]["id"],
            "target_entity_id": entities[tgt]["id"],
            "relation_type": rtype,
        }).raise_for_status()
        step(2, f"  ~ {src} --{rtype}--> {tgt}")

    # Verify graph
    graph = requests.get(f"{API}/projects/{pid}/graph").json()
    print(f"\n  Graph: {len(graph['entities'])} entities, {len(graph['relations'])} relations")

    # ── Step 3: Add KiCad source and initial sync ──
    heading("Step 3: Initial KiCad Sync (Baseline)")

    # Copy fixtures to a temp dir so we can modify them
    tmpdir = tempfile.mkdtemp(prefix="solus_demo_")
    sch_src = os.path.join(FIXTURES, "test_motor.kicad_sch")
    pcb_src = os.path.join(FIXTURES, "test_motor.kicad_pcb")
    sch_path = os.path.join(tmpdir, "motor.kicad_sch")
    pcb_path = os.path.join(tmpdir, "motor.kicad_pcb")
    shutil.copy2(sch_src, sch_path)
    shutil.copy2(pcb_src, pcb_path)

    src_resp = requests.post(f"{API}/projects/{pid}/sources", json={
        "source_type": "kicad",
        "name": "Motor Controller PCB",
        "config": {"schematic_path": sch_path, "pcb_path": pcb_path},
    })
    src_resp.raise_for_status()
    source = src_resp.json()
    source_id = source["id"]
    step(3, f"Created KiCad source: {source['name']}")

    sync1 = requests.post(f"{API}/projects/{pid}/sources/{source_id}/sync")
    sync1.raise_for_status()
    sync1_data = sync1.json()
    step(3, f"Initial sync complete — {sync1_data.get('items_synced', sync1_data.get('entity_count', '?'))} items synced")
    step(3, f"Snapshot ID: {sync1_data['snapshot_id'][:8]}...")

    # ── Step 4: Simulate chip swap (DRV8825 → TMC2209) ──
    heading("Step 4: Swap Component (DRV8825 → TMC2209)")

    # Modify the schematic file
    with open(sch_path, "r") as f:
        sch_content = f.read()
    sch_content = sch_content.replace("DRV8825", "TMC2209")
    sch_content = sch_content.replace("Motor_Driver:DRV8825", "Motor_Driver:TMC2209")
    sch_content = sch_content.replace("HTSSOP-28-1EP_4.4x9.7mm", "HTSSOP-28-1EP_5.0x10.0mm")
    with open(sch_path, "w") as f:
        f.write(sch_content)

    # Modify the PCB file
    with open(pcb_path, "r") as f:
        pcb_content = f.read()
    pcb_content = pcb_content.replace("DRV8825", "TMC2209")
    with open(pcb_path, "w") as f:
        f.write(pcb_content)

    step(4, "Modified schematic: DRV8825 → TMC2209")
    step(4, "Modified PCB: DRV8825 → TMC2209")
    step(4, "Changed footprint package dimensions")

    # ── Step 5: Re-sync → detect changes ──
    heading("Step 5: Re-Sync — Detect Changes")

    sync2 = requests.post(f"{API}/projects/{pid}/sources/{source_id}/sync")
    sync2.raise_for_status()
    sync2_data = sync2.json()
    changes = sync2_data.get("changes", [])
    step(5, f"Re-sync complete — {len(changes)} changes detected!")

    for change in changes:
        ctype = change["change_type"]
        name = change["entity_name"]
        icon = {"added": "+", "modified": "~", "removed": "-"}.get(ctype, "?")
        print(f"    {icon} [{ctype:8s}] {name}")
        if change.get("diff_data"):
            for prop, diff in change["diff_data"].items():
                if isinstance(diff, dict) and "old" in diff and "new" in diff:
                    print(f"      {prop}: {diff['old']} → {diff['new']}")

    # ── Step 6: Impact Analysis ──
    heading("Step 6: Impact Analysis (from DRV8825)")

    drv_id = entities["DRV8825"]["id"]
    impact = requests.get(f"{API}/projects/{pid}/impact/{drv_id}").json()
    step(6, f"Changing DRV8825 impacts {len(impact)} other components:")
    for entity in impact:
        print(f"    → {entity['entity_type']:20s} {entity['name']}")
        if entity.get("description"):
            print(f"      {entity['description']}")

    # ── Step 7: Show full changes history ──
    heading("Step 7: Full Change Log")

    all_changes = requests.get(f"{API}/projects/{pid}/changes").json()
    step(7, f"{len(all_changes)} total changes in the project log")

    # ── Cleanup ──
    shutil.rmtree(tmpdir, ignore_errors=True)

    heading("DEMO A COMPLETE")
    print("  The system detected a chip swap on the PCB, diffed the")
    print("  before/after snapshots, identified what changed, and")
    print("  traced the impact through the system graph to find all")
    print("  affected software modules.")
    print()
    print("  This is what Solus does: makes robotics development")
    print("  observable, understandable, and debuggable.")
    print()


if __name__ == "__main__":
    main()
