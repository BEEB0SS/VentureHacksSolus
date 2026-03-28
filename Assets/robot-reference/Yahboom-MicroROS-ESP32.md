# Yahboom MicroROS ESP32 Robot — Reference Sheet

> This is our demo robot. All specs, files, and links needed for simulation and Context Model seed data.

## Quick Links

| Resource | Link |
|---|---|
| Tutorial hub | https://www.yahboom.net/study/MicroROS-ESP32 |
| GitHub (VM code) | https://github.com/YahboomTechnology/Mirco-Ros-Car_VM |
| GitHub (MicroROS Board) | https://github.com/YahboomTechnology/MicroROS-Board |
| 3D STEP model (154 MB) | https://drive.google.com/drive/folders/1_xpGqUNXnRPv07u8BFvYqY32JMusL71G |
| Source code + firmware | https://drive.google.com/drive/folders/1mDx8VEdl75yw8wrlYWQkmNEfY_TB5HVl |
| Hardware info + drivers | https://drive.google.com/drive/folders/1klzxonweuEEfFQa3jetL4P3L6vyZWkr4 |
| Instruction manual | https://drive.google.com/drive/folders/1BF-aR7EhsyWKW99geivCo0tjn1nO6wx9 |
| Product page ($199) | https://category.yahboom.net/fr/collections/embedded-series/products/microros-esp32 |

## Files to Download for Simulation

**Must-have:**
1. **3D STEP model** — `microROS-VM.STEP` (154.3 MB) → convert to URDF/MuJoCo XML for simulation
2. **ROS_Source_Code.zip** (101.9 MB) — contains `yahboomcar_description` package with URDF + STL meshes
3. **Samples.zip** (138.6 MB) — ESP32 sample code including motor control, kinematics, sensor reading

**Nice-to-have:**
4. **Factory-Firmware.zip** (2.6 MB) — stock firmware for reference
5. **Hardware info** — schematics, datasheets

## URDF Model

Location in the ROS workspace:
```
/root/yahboomcar_ws/src/yahboomcar_description/urdf/MicroROS.urdf
```

STL mesh files:
```
/root/yahboomcar_ws/src/yahboomcar_description/meshes/base_link.STL
```

Launch command:
```bash
ros2 launch yahboomcar_description display_launch.py
```

### URDF Joint Structure

| Joint | Type | Controls |
|---|---|---|
| `zq_Joint` | continuous | Left front wheel |
| `yq_Joint` | continuous | Right front wheel |
| `yh_Joint` | continuous | Right rear wheel |
| `zh_Joint` | continuous | Left rear wheel |
| `jq1_Joint` | revolute | Camera PTZ servo 1 |
| `jq2_Joint` | revolute | Camera PTZ servo 2 |

Base frame: `base_link`
Footprint transform: `base_footprint` → `base_link` (0, 0, 0.05m vertical offset)

---

## Hardware Specifications

### Main Controller: ESP32-S3

- Dual-core processor
- WiFi + Bluetooth
- MicroROS firmware communicates via WiFi UDP to ROS2 host

### Motors: Yahboom 310 DC Gear Motor with Encoder

| Parameter | Value |
|---|---|
| Type | Permanent magnet brush DC |
| Rated voltage | 7.4V |
| Operating voltage | 11–16V |
| Rated current | ≤ 0.65A |
| Stall current | ≤ 1.4A |
| Speed (before reduction) | 9,000 RPM |
| Gear reduction ratio | 1:20 |
| Output speed (after reduction) | ~450 RPM |
| Rated torque | 0.4 kg·cm |
| Stall torque | ≥ 1.0 kg·cm |
| Encoder type | AB phase incremental Hall |
| Encoder supply voltage | 3.3–5V |
| Magnetic ring lines | 13 |
| Pulses per revolution (4x decoding) | 1,040 (20 × 13 × 4) |
| Output shaft | 3mm D-type |
| Connector | PH2.0 6-pin |

### Power

| Parameter | Value |
|---|---|
| Battery | 7.4V Li-ion (T-type connector) |
| Charger | DC 8.4V |
| Type-C output | 5.1V/5A (Raspberry Pi 5 PD protocol) |

### Sensors

| Sensor | Type | Interface |
|---|---|---|
| IMU | 6-axis (accel + gyro) | I2C (SCL: GPIO39, SDA: GPIO40) |
| Lidar | ORBBEC MS200 TOF | UART (TX: GPIO17, RX: GPIO18) |
| Battery voltage | ADC | GPIO3 |

### Chassis

- Material: aluminum alloy
- Drive type: 4-wheel differential drive
- 4x 310 encoder motors with rubber tires

---

## GPIO Pin Map

| Peripheral | GPIO |
|---|---|
| Motor M1 PWM A/B | GPIO4 / GPIO5 |
| Motor M1 Encoder A/B | GPIO6 / GPIO7 |
| Motor M2 PWM A/B | GPIO15 / GPIO16 |
| Motor M2 Encoder A/B | GPIO47 / GPIO48 |
| Motor M3 PWM A/B | GPIO9 / GPIO10 |
| Motor M3 Encoder A/B | GPIO11 / GPIO12 |
| Motor M4 PWM A/B | GPIO13 / GPIO14 |
| Motor M4 Encoder A/B | GPIO1 / GPIO2 |
| Servo S1 | GPIO8 |
| Servo S2 | GPIO21 |
| IMU I2C SCL/SDA | GPIO39 / GPIO40 |
| IMU Interrupt | GPIO41 |
| Lidar UART TX/RX | GPIO17 / GPIO18 |
| Buzzer | GPIO46 |
| LED indicator | GPIO45 |
| BOOT button | GPIO0 |
| Custom key | GPIO42 |
| Battery ADC | GPIO3 |
| Custom GPIO | GPIO35, GPIO36 |

### Motor Interface Mapping

| Position | Motor | PWM | Encoder |
|---|---|---|---|
| Left front | Motor1 (M1) | GPIO4/5 | GPIO6/7 |
| Left rear | Motor2 (M2) | GPIO15/16 | GPIO47/48 |
| Right front | Motor3 (M3) | GPIO9/10 | GPIO11/12 |
| Right rear | Motor4 (M4) | GPIO13/14 | GPIO1/2 |

---

## Kinematics Model

**Type:** 4-wheel differential drive (skid-steer)

**Parameters:**
- `W` = distance between left and right motor centers
- `L` = distance between front and rear motor centers
- `A = W/2`, `B = L/2`
- `ROBOT_APB = A + B` (used in firmware as combined half-wheelbase)

**Forward kinematics (motor speeds → robot velocity):**
```
Vx = (V_m1 + V_m2 + V_m3 + V_m4) / 4
Vy = 0
Wz = -(V_m1 + V_m2 - V_m3 - V_m4) / (4 * ROBOT_APB)
```

**Inverse kinematics (robot velocity → motor speeds):**
```
V_m1 = Vx - Wz * ROBOT_APB    (left front)
V_m2 = Vx - Wz * ROBOT_APB    (left rear)
V_m3 = Vx + Wz * ROBOT_APB    (right front)
V_m4 = Vx + Wz * ROBOT_APB    (right rear)
```

**Control ranges:**
- Linear velocity `Vx`: [-1.0, 1.0] m/s
- Angular velocity `Wz`: [-5.0, 5.0] rad/s

---

## ROS2 Topics

### Subscribed (control inputs)

| Topic | Message Type | Description |
|---|---|---|
| `/cmd_vel` | `geometry_msgs/msg/Twist` | Velocity commands (linear.x, angular.z) |
| `/buzzer` | | Buzzer on/off |
| `/rgblight` | | RGB light bar control |
| `/servo` | | PTZ servo control |

### Published (sensor outputs)

| Topic | Message Type | Description |
|---|---|---|
| `/vel_raw` | | Raw wheel velocity feedback |
| `/imu/data_raw` | `sensor_msgs/msg/Imu` | 6-axis IMU raw data |
| `/imu/mag` | | Magnetometer data |
| `/voltage` | | Battery voltage |
| `/scan` | `sensor_msgs/msg/LaserScan` | Lidar scan data |
| `/odom` | `nav_msgs/msg/Odometry` | Odometry from wheel encoders |

### Example Commands

```bash
# List all topics
ros2 topic list

# Drive forward at 0.1 m/s
ros2 topic pub -1 /cmd_vel geometry_msgs/msg/Twist \
  "{linear: {x: 0.1, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: 0.0}}"

# Rotate left
ros2 topic pub -1 /cmd_vel geometry_msgs/msg/Twist \
  "{linear: {x: 0.0, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: 1.0}}"

# Echo IMU data
ros2 topic echo /imu/data_raw

# Echo lidar
ros2 topic echo /scan
```

---

## MuJoCo Simulation Parameters (Derived)

These are derived/estimated values for building a MuJoCo model. Refine after downloading the STEP file and measuring exact dimensions.

```xml
<!-- Robot body (estimated from aluminum chassis + battery) -->
<body name="base_link">
  <!-- Estimated mass: ~0.8-1.2 kg total with battery -->
  <!-- Estimated dimensions: ~20cm L × 18cm W × 8cm H -->
</body>

<!-- Wheel parameters (from 310 motor specs) -->
<!-- Wheel radius: ~0.033m (estimated from tire + 3mm shaft) -->
<!-- Max motor torque: 0.098 N·m (1.0 kg·cm stall) -->
<!-- Rated motor torque: 0.039 N·m (0.4 kg·cm) -->
<!-- Max wheel RPM: ~450 (9000/20 gear ratio) -->
<!-- Max wheel angular velocity: ~47.1 rad/s -->
<!-- Encoder resolution: 1040 counts/rev -->

<!-- Kinematic parameters (need exact measurement) -->
<!-- W (wheel track): ~0.18m (estimated) -->
<!-- L (wheelbase): ~0.15m (estimated) -->
```

### TODO: Exact Measurements Needed

After downloading the STEP file, extract:
- [ ] Exact wheel radius (tire outer diameter / 2)
- [ ] Exact wheel track `W` (left-right motor center distance)
- [ ] Exact wheelbase `L` (front-rear motor center distance)
- [ ] Chassis mass (or weigh the physical robot)
- [ ] Lidar mount height and position relative to base_link
- [ ] Camera/PTZ mount position
- [ ] Inertia tensor (can derive from STEP model in CAD)

---

## Context Model Mapping

How this robot maps to Solus entities and relations for the demo:

### Entities

| Name | Entity Type | Description |
|---|---|---|
| ESP32-S3 | ElectricalPart | Main controller, runs MicroROS firmware |
| MicroROS Control Board | ElectricalPart | Custom PCB with motor drivers, IMU, power management |
| 310 Motor (×4) | ElectricalPart | DC gear motors with encoders, 1:20 ratio |
| IMU (6-axis) | ElectricalPart | Accelerometer + gyroscope, I2C bus |
| MS200 Lidar | ElectricalPart | TOF lidar for mapping/navigation |
| 7.4V Battery | ElectricalPart | Li-ion power source |
| Servo PTZ (×2) | ElectricalPart | Camera pan/tilt servos |
| Chassis | MechanicalPart | Aluminum alloy frame |
| Wheels (×4) | MechanicalPart | Rubber tires on motor shafts |
| motor_controller | SoftwareModule | Motor speed control + PID |
| sensor_reader | SoftwareModule | IMU + lidar data acquisition |
| nav_planner | SoftwareModule | Navigation2 path planning |
| teleop_twist | SoftwareModule | Teleoperation via /cmd_vel |
| slam_node | SoftwareModule | Cartographer/Gmapping SLAM |
| /cmd_vel | Interface | Twist velocity commands |
| /odom | Interface | Wheel odometry |
| /imu/data_raw | Interface | Raw IMU readings |
| /scan | Interface | Lidar scan data |
| /vel_raw | Interface | Raw wheel velocities |
| /voltage | Interface | Battery voltage feedback |
| motor_rpm (×4) | RuntimeSignal | Individual motor speed telemetry |
| battery_voltage | RuntimeSignal | Battery level monitoring |
| imu_orientation | RuntimeSignal | Real-time orientation |

### Relations

| Source | Target | Type | Description |
|---|---|---|---|
| 7.4V Battery | MicroROS Control Board | connected_to | Battery powers the board |
| MicroROS Control Board | ESP32-S3 | connected_to | Board hosts the MCU |
| ESP32-S3 | 310 Motor (×4) | drives | PWM control via motor driver |
| ESP32-S3 | IMU | reads_from | I2C bus (GPIO39/40) |
| ESP32-S3 | MS200 Lidar | reads_from | UART (GPIO17/18) |
| ESP32-S3 | Servo PTZ | drives | PWM servo control (GPIO8/21) |
| 310 Motor | Wheels | drives | Shaft coupling to wheels |
| motor_controller | /cmd_vel | subscribes_to | Receives velocity commands |
| motor_controller | /odom | publishes | Publishes odometry |
| motor_controller | /vel_raw | publishes | Publishes raw wheel speeds |
| sensor_reader | /imu/data_raw | publishes | Publishes IMU data |
| sensor_reader | /scan | publishes | Publishes lidar scans |
| teleop_twist | /cmd_vel | publishes | Keyboard/joystick teleop |
| nav_planner | /odom | subscribes_to | Uses odometry for planning |
| nav_planner | /scan | subscribes_to | Uses lidar for obstacle avoidance |
| nav_planner | /imu/data_raw | subscribes_to | Uses IMU for orientation |
| nav_planner | /cmd_vel | publishes | Outputs planned velocity |
| slam_node | /scan | subscribes_to | Lidar input for mapping |
| slam_node | /odom | subscribes_to | Odometry for map alignment |
| motor_controller | ESP32-S3 | depends_on | Runs on the MCU |
| sensor_reader | ESP32-S3 | depends_on | Runs on the MCU |
| motor_controller | 310 Motor | configured_by | PID params for each motor |

#robot #hardware #simulation #demo #reference
