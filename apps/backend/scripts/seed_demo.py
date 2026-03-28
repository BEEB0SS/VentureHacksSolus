"""
Seed script — pre-populates the Solus database with realistic demo data.

Usage:
    cd apps/backend && python scripts/seed_demo.py
"""

import sys
import os
import uuid
import json
import datetime

# Allow imports from apps/backend/src
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from src.database import get_connection, init_db


def uid() -> str:
    return str(uuid.uuid4())


def ts(days_ago: int = 0) -> str:
    dt = datetime.datetime.utcnow() - datetime.timedelta(days=days_ago)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def seed():
    init_db()
    conn = get_connection()
    cur = conn.cursor()

    # ------------------------------------------------------------------
    # Project
    # ------------------------------------------------------------------
    project_id = uid()
    cur.execute(
        "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)",
        (
            project_id,
            "Differential Drive Robot",
            "Two-wheeled differential drive robot with motor control, sensors, and ROS2 navigation.",
            ts(30),
            ts(0),
        ),
    )

    # ------------------------------------------------------------------
    # Team members
    # ------------------------------------------------------------------
    team = [
        ("Pratham", "Lead Engineer",        "pratham@solus.dev"),
        ("Alex",    "Electrical Engineer",  "alex@solus.dev"),
        ("Jordan",  "Software Engineer",    "jordan@solus.dev"),
        ("Sam",     "Mechanical Engineer",  "sam@solus.dev"),
    ]
    for name, role, email in team:
        cur.execute(
            "INSERT INTO team_members (id, project_id, name, role, email) VALUES (?,?,?,?,?)",
            (uid(), project_id, name, role, email),
        )

    # ------------------------------------------------------------------
    # Source connections
    # ------------------------------------------------------------------
    kicad_src_id  = uid()
    github_src_id = uid()
    cur.execute(
        "INSERT INTO source_connections (id, project_id, source_type, name, config, last_synced_at, status) VALUES (?,?,?,?,?,?,?)",
        (
            kicad_src_id,
            project_id,
            "kicad",
            "Motor Controller PCB",
            json.dumps({"file": "hardware/motor_controller/motor_controller.kicad_sch"}),
            ts(1),
            "synced",
        ),
    )
    cur.execute(
        "INSERT INTO source_connections (id, project_id, source_type, name, config, last_synced_at, status) VALUES (?,?,?,?,?,?,?)",
        (
            github_src_id,
            project_id,
            "github",
            "Robot Firmware Repo",
            json.dumps({"repo": "org/diff-drive-robot", "branch": "main"}),
            ts(0),
            "synced",
        ),
    )

    # ------------------------------------------------------------------
    # Entities
    # ------------------------------------------------------------------
    # electrical parts
    esp32_id      = uid()
    drv8825_id    = uid()
    nema17_id     = uid()
    mpu6050_id    = uid()
    vl53l0x_id    = uid()
    lm2596_id     = uid()
    battery_id    = uid()

    electrical = [
        (esp32_id,   "ESP32",      "U1 — Main MCU, dual-core Xtensa LX6, Wi-Fi + BT",
         {"ref": "U1", "footprint": "ESP32-WROOM-32", "voltage": "3.3V"},   kicad_src_id,  "kicad:U1"),
        (drv8825_id, "DRV8825",    "U2 — Stepper motor driver, up to 1/32 microstepping",
         {"ref": "U2", "footprint": "HTSSOP-28",      "max_current": "2.5A"}, kicad_src_id, "kicad:U2"),
        (nema17_id,  "NEMA17",     "M1 — Stepper motor, 1.8°/step, 1.5A rated",
         {"ref": "M1", "steps_per_rev": 200, "rated_current": "1.5A"},       kicad_src_id, "kicad:M1"),
        (mpu6050_id, "MPU6050",    "U3 — 6-axis IMU (accelerometer + gyroscope), I2C",
         {"ref": "U3", "interface": "I2C", "addr": "0x68"},                  kicad_src_id, "kicad:U3"),
        (vl53l0x_id, "VL53L0X",   "U4 — Time-of-Flight distance sensor, up to 2m, I2C",
         {"ref": "U4", "interface": "I2C", "range_m": 2.0},                  kicad_src_id, "kicad:U4"),
        (lm2596_id,  "LM2596",    "U5 — Buck converter, 12V→5V, 3A",
         {"ref": "U5", "vin": "12V", "vout": "5V", "iout": "3A"},            kicad_src_id, "kicad:U5"),
        (battery_id, "12V_Battery","BT1 — 3S LiPo, 11.1V nominal, 2200mAh",
         {"ref": "BT1", "chemistry": "LiPo", "cells": 3, "capacity_mah": 2200}, kicad_src_id, "kicad:BT1"),
    ]
    for eid, name, desc, meta, src, sref in electrical:
        cur.execute(
            "INSERT INTO entities (id, project_id, entity_type, name, description, metadata, source, source_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (eid, project_id, "electrical_part", name, desc, json.dumps(meta), "kicad", sref, ts(28), ts(2)),
        )

    # software modules
    motor_ctrl_id  = uid()
    sensor_rdr_id  = uid()
    nav_plan_id    = uid()
    teleop_id      = uid()
    urdf_id        = uid()

    software = [
        (motor_ctrl_id, "motor_controller.py", "ROS2 node — subscribes /cmd_vel, drives DRV8825 via GPIO PWM",
         {"package": "diff_drive_bringup", "language": "Python", "ros_version": "humble"}, github_src_id, "src/diff_drive_bringup/motor_controller.py"),
        (sensor_rdr_id, "sensor_reader.py",    "ROS2 node — polls MPU6050 and VL53L0X over I2C, publishes sensor topics",
         {"package": "diff_drive_bringup", "language": "Python", "ros_version": "humble"}, github_src_id, "src/diff_drive_bringup/sensor_reader.py"),
        (nav_plan_id,   "nav_planner.py",      "ROS2 node — simple reactive navigation planner",
         {"package": "diff_drive_bringup", "language": "Python", "ros_version": "humble"}, github_src_id, "src/diff_drive_bringup/nav_planner.py"),
        (teleop_id,     "teleop_twist.py",     "Keyboard teleop node — publishes geometry_msgs/Twist to /cmd_vel",
         {"package": "teleop_twist_keyboard", "language": "Python"},                       github_src_id, "src/teleop_twist_keyboard/teleop_twist_keyboard.py"),
        (urdf_id,       "robot_description.urdf", "URDF model — full robot kinematics and link geometry",
         {"format": "URDF", "joints": 4, "links": 5},                                     github_src_id, "urdf/diff_drive.urdf"),
    ]
    for eid, name, desc, meta, src, sref in software:
        cur.execute(
            "INSERT INTO entities (id, project_id, entity_type, name, description, metadata, source, source_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (eid, project_id, "software_module", name, desc, json.dumps(meta), "github", sref, ts(25), ts(1)),
        )

    # interfaces
    i2c_id      = uid()
    cmd_vel_id  = uid()
    odom_id     = uid()
    imu_data_id = uid()
    scan_id     = uid()

    interfaces = [
        (i2c_id,      "I2C_Bus",                    "Shared I2C bus at 400 kHz connecting IMU and ToF sensor",
         {"speed_khz": 400, "bus": 1}),
        (cmd_vel_id,  "/cmd_vel",                   "ROS2 topic — geometry_msgs/Twist velocity commands",
         {"msg_type": "geometry_msgs/Twist", "qos": "reliable"}),
        (odom_id,     "/odom",                      "ROS2 topic — nav_msgs/Odometry wheel odometry",
         {"msg_type": "nav_msgs/Odometry",   "qos": "reliable"}),
        (imu_data_id, "/imu/data",                  "ROS2 topic — sensor_msgs/Imu orientation and angular velocity",
         {"msg_type": "sensor_msgs/Imu",     "qos": "best_effort"}),
        (scan_id,     "/scan",                      "ROS2 topic — sensor_msgs/Range ToF distance reading",
         {"msg_type": "sensor_msgs/Range",   "qos": "best_effort"}),
    ]
    for eid, name, desc, meta in interfaces:
        cur.execute(
            "INSERT INTO entities (id, project_id, entity_type, name, description, metadata, source, source_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (eid, project_id, "interface", name, desc, json.dumps(meta), "manual", "", ts(20), ts(3)),
        )

    # runtime signals
    motor_rpm_id      = uid()
    batt_voltage_id   = uid()
    imu_temp_id       = uid()

    signals = [
        (motor_rpm_id,    "motor_rpm",       "Stepper motor rotational speed in RPM",
         {"unit": "RPM",     "expected_min": 0,   "expected_max": 300}),
        (batt_voltage_id, "battery_voltage", "Battery pack terminal voltage",
         {"unit": "V",       "expected_min": 9.6, "expected_max": 12.6}),
        (imu_temp_id,     "imu_temperature", "MPU6050 die temperature",
         {"unit": "°C",      "expected_min": 15,  "expected_max": 65}),
    ]
    for eid, name, desc, meta in signals:
        cur.execute(
            "INSERT INTO entities (id, project_id, entity_type, name, description, metadata, source, source_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (eid, project_id, "runtime_signal", name, desc, json.dumps(meta), "manual", "", ts(10), ts(0)),
        )

    # ------------------------------------------------------------------
    # Relations (24 total)
    # ------------------------------------------------------------------
    relations = [
        # Power chain
        (battery_id,   lm2596_id,     "connected_to",   1.0),
        (lm2596_id,    esp32_id,       "connected_to",   1.0),
        (battery_id,   drv8825_id,     "connected_to",   1.0),
        (drv8825_id,   nema17_id,      "drives",         1.0),

        # I2C bus
        (esp32_id,     i2c_id,         "connected_to",   1.0),
        (mpu6050_id,   i2c_id,         "connected_to",   1.0),
        (vl53l0x_id,   i2c_id,         "connected_to",   1.0),

        # Software → hardware
        (motor_ctrl_id, drv8825_id,    "configured_by",  0.95),
        (motor_ctrl_id, esp32_id,      "depends_on",     1.0),
        (sensor_rdr_id, mpu6050_id,    "reads_from",     1.0),
        (sensor_rdr_id, vl53l0x_id,    "reads_from",     1.0),

        # ROS topic: publish
        (teleop_id,     cmd_vel_id,    "publishes",      1.0),
        (motor_ctrl_id, odom_id,       "publishes",      1.0),
        (sensor_rdr_id, imu_data_id,   "publishes",      1.0),
        (sensor_rdr_id, scan_id,       "publishes",      1.0),
        (nav_plan_id,   cmd_vel_id,    "publishes",      1.0),

        # ROS topic: subscribe
        (motor_ctrl_id, cmd_vel_id,    "subscribes_to",     1.0),
        (nav_plan_id,   odom_id,       "subscribes_to",     1.0),
        (nav_plan_id,   scan_id,       "subscribes_to",     1.0),
        (nav_plan_id,   imu_data_id,   "subscribes_to",     1.0),

        # Runtime signals observed_in
        (nema17_id,    motor_rpm_id,   "observed_in",    1.0),
        (battery_id,   batt_voltage_id,"observed_in",    1.0),
        (mpu6050_id,   imu_temp_id,    "observed_in",    1.0),

        # URDF
        (urdf_id,      nema17_id,      "documented_by",  0.9),
    ]
    for src_e, tgt_e, rtype, conf in relations:
        cur.execute(
            "INSERT INTO relations (id, project_id, source_entity_id, target_entity_id, relation_type, metadata, confidence, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (uid(), project_id, src_e, tgt_e, rtype, json.dumps({}), conf, ts(15)),
        )

    # ------------------------------------------------------------------
    # Issues
    # ------------------------------------------------------------------
    issue1_id = uid()
    issue2_id = uid()
    issue3_id = uid()

    issues = [
        (issue1_id, "Motor stalls at low RPM",
         "NEMA17 stepper stalls below ~30 RPM when DRV8825 is in full-step mode. "
         "The torque ripple is too high without microstepping enabled.",
         "resolved",
         json.dumps([nema17_id, drv8825_id]),
         "Alex",
         ts(20), ts(12)),
        (issue2_id, "IMU readings drift after 5 minutes",
         "MPU6050 gyroscope integrates bias error over time, causing heading to drift ~15° over "
         "a 5-minute run. Also correlates with rising die temperature.",
         "resolved",
         json.dumps([mpu6050_id, sensor_rdr_id]),
         "Jordan",
         ts(15), ts(8)),
        (issue3_id, "ESP32 brownout on motor startup",
         "When DRV8825 energizes NEMA17 from rest, inrush current causes a voltage sag on the 5V "
         "rail supplied by LM2596, triggering ESP32 brownout reset.",
         "open",
         json.dumps([esp32_id, lm2596_id, drv8825_id]),
         "Pratham",
         ts(5), ts(0)),
    ]
    for iid, title, desc, status, rel_ids, reporter, created, updated in issues:
        cur.execute(
            "INSERT INTO issues (id, project_id, title, description, status, related_entity_ids, reported_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (iid, project_id, title, desc, status, rel_ids, reporter, created, updated),
        )

    # ------------------------------------------------------------------
    # Fixes
    # ------------------------------------------------------------------
    fix1_id = uid()
    fix2_id = uid()

    fix1_steps = json.dumps([
        "Set DRV8825 MICROSTEP pins (M0=HIGH, M1=HIGH, M2=LOW) for 1/8 microstepping.",
        "Update motor_controller.py STEPS_PER_REV constant from 200 to 1600.",
        "Lower the minimum target RPM threshold in the velocity ramp from 20 RPM to 5 RPM.",
        "Re-run motion profile tests — stall no longer observed down to 3 RPM.",
    ])
    cur.execute(
        "INSERT INTO fixes (id, issue_id, project_id, description, steps, applied_by, created_at) VALUES (?,?,?,?,?,?,?)",
        (
            fix1_id,
            issue1_id,
            project_id,
            "Enabled 1/8 microstepping on DRV8825 and updated firmware step count to match.",
            fix1_steps,
            "Alex",
            ts(12),
        ),
    )

    fix2_steps = json.dumps([
        "Implement a complementary filter in sensor_reader.py: angle = 0.98*(angle + gyro_rate*dt) + 0.02*accel_angle.",
        "Read MPU6050 internal temperature register each cycle.",
        "Add linear temperature compensation: bias_correction = 0.004 * (temp_c - 25.0).",
        "Apply bias_correction to gyro_z before integrating.",
        "Verify drift < 1° over 5-minute bench test.",
    ])
    cur.execute(
        "INSERT INTO fixes (id, issue_id, project_id, description, steps, applied_by, created_at) VALUES (?,?,?,?,?,?,?)",
        (
            fix2_id,
            issue2_id,
            project_id,
            "Added complementary filter with temperature-based gyro bias compensation.",
            fix2_steps,
            "Jordan",
            ts(8),
        ),
    )

    # ------------------------------------------------------------------
    # Semantic memory (5 entries)
    # ------------------------------------------------------------------
    memory_entries = [
        (
            "Issue: Motor stalls at low RPM — resolved by enabling 1/8 microstepping on DRV8825 "
            "(M0=HIGH, M1=HIGH, M2=LOW) and updating STEPS_PER_REV from 200 to 1600 in motor_controller.py. "
            "Stall threshold dropped from 30 RPM to 3 RPM.",
            "issue_summary",
            json.dumps({"issue_id": issue1_id, "fix_id": fix1_id, "entities": [nema17_id, drv8825_id]}),
        ),
        (
            "Issue: IMU drift after 5 minutes — resolved with complementary filter "
            "(α=0.98) and MPU6050 temperature-based gyro bias correction. "
            "Formula: corrected_gyro_z = raw_gyro_z - 0.004*(temp_c - 25.0).",
            "issue_summary",
            json.dumps({"issue_id": issue2_id, "fix_id": fix2_id, "entities": [mpu6050_id, sensor_rdr_id]}),
        ),
        (
            "Issue: ESP32 brownout on motor startup — open. Suspected root cause: LM2596 output "
            "capacitance insufficient to absorb NEMA17 inrush current transient through DRV8825. "
            "Candidate fixes: add bulk capacitor (470 µF) on 5V rail; add soft-start ramp in firmware.",
            "issue_summary",
            json.dumps({"issue_id": issue3_id, "entities": [esp32_id, lm2596_id, drv8825_id]}),
        ),
        (
            "Reference — DRV8825 peak current calculation: I_peak = V_ref / (5 * R_sense). "
            "Our board uses R_sense = 0.1 Ω. To set 1.0 A peak: V_ref = 1.0 * 5 * 0.1 = 0.5 V. "
            "Trim the onboard potentiometer while measuring V_ref at the VREF pin. "
            "NEMA17 rated at 1.5 A — set V_ref = 0.75 V for rated current.",
            "reference_note",
            json.dumps({"entities": [drv8825_id], "topic": "current_setting"}),
        ),
        (
            "Reference — NEMA17 optimal operating settings for differential drive: "
            "use 1/8 microstepping for smooth low-speed motion; target 200–250 RPM max "
            "(limited by back-EMF at 12 V supply); keep winding current at 1.2 A (80% rated) "
            "for sustained operation to avoid thermal shutdown of DRV8825.",
            "reference_note",
            json.dumps({"entities": [nema17_id, drv8825_id], "topic": "operating_parameters"}),
        ),
    ]
    for content, ctype, meta in memory_entries:
        cur.execute(
            "INSERT INTO semantic_memory (id, project_id, content, content_type, metadata, embedding, created_at) VALUES (?,?,?,?,?,?,?)",
            (uid(), project_id, content, ctype, meta, None, ts(5)),
        )

    conn.commit()
    conn.close()

    print("=" * 60)
    print("Solus demo seed complete")
    print("=" * 60)
    print(f"  Project:        Differential Drive Robot ({project_id})")
    print(f"  Team members:   {len(team)}")
    print(f"  Source conns:   2")
    print(f"  Entities:       {len(electrical) + len(software) + len(interfaces) + len(signals)}")
    print(f"  Relations:      {len(relations)}")
    print(f"  Issues:         {len(issues)}")
    print(f"  Fixes:          2")
    print(f"  Semantic mem:   {len(memory_entries)}")
    print("=" * 60)


if __name__ == "__main__":
    seed()
