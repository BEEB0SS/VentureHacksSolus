"""
Solus MuJoCo Simulator — Differential drive physics stub.

Uses differential drive kinematics to simulate robot motion. No real MuJoCo required.
Given left/right wheel angular speeds (rad/s) + wheel_radius, computes x, y, theta over time.
Supports parameter management, step simulation, and comparison with runtime data.
"""

import math
from typing import Optional


class MuJoCoSimulator:
    """Physics simulator using differential drive kinematics."""

    def __init__(self):
        self.parameters: dict = {
            "wheel_radius": 0.05,  # meters
            "wheel_base": 0.3,     # meters (distance between wheels)
            "motor_torque": 0.5,   # Nm
            "friction": 0.1,       # coefficient
        }
        self._trajectory: list[dict] = []
        self._position = {"x": 0.0, "y": 0.0, "theta": 0.0}

    def set_parameter(self, name: str, value: float) -> None:
        """Set a simulation parameter."""
        self.parameters[name] = value

    def get_state(self) -> dict:
        """Get the current simulator state."""
        return {
            "parameters": dict(self.parameters),
            "trajectory": list(self._trajectory),
            "position": dict(self._position),
        }

    def run_steps(
        self,
        n_steps: int,
        left_speed: float,
        right_speed: float,
        dt: float = 0.01,
    ) -> list[dict]:
        """Run n_steps of differential drive simulation.

        Args:
            n_steps: Number of simulation steps
            left_speed: Left wheel angular speed (rad/s)
            right_speed: Right wheel angular speed (rad/s)
            dt: Time step in seconds

        Returns:
            List of trajectory points with x, y, theta, v_linear, v_angular, timestamp
        """
        wheel_base = self.parameters["wheel_base"]
        wheel_radius = self.parameters["wheel_radius"]
        x = self._position["x"]
        y = self._position["y"]
        theta = self._position["theta"]

        trajectory = []
        time = 0.0

        for _ in range(n_steps):
            # Convert angular wheel speeds (rad/s) to linear using wheel_radius
            v_left_linear = left_speed * wheel_radius
            v_right_linear = right_speed * wheel_radius
            # Differential drive kinematics
            v_linear = (v_left_linear + v_right_linear) / 2.0
            v_angular = (v_right_linear - v_left_linear) / wheel_base

            # Update position
            x += v_linear * math.cos(theta) * dt
            y += v_linear * math.sin(theta) * dt
            theta += v_angular * dt
            time += dt

            trajectory.append({
                "x": x,
                "y": y,
                "theta": theta,
                "v_linear": v_linear,
                "v_angular": v_angular,
                "timestamp": round(time, 6),
            })

        # Update stored position
        self._position = {"x": x, "y": y, "theta": theta}
        self._trajectory.extend(trajectory)
        return trajectory

    def compare_with_runtime(
        self,
        sim_data: list[dict],
        runtime_data: list[dict],
        threshold: float = 0.01,
    ) -> list[dict]:
        """Compare simulation results with runtime observations.

        Both sim_data and runtime_data are lists of {"signal": str, "value": float}.
        Returns discrepancies where the absolute difference exceeds threshold.
        """
        runtime_map = {item["signal"]: item["value"] for item in runtime_data}

        discrepancies = []
        for sim_item in sim_data:
            signal = sim_item["signal"]
            if signal not in runtime_map:
                continue
            sim_val = sim_item["value"]
            runtime_val = runtime_map[signal]
            delta = abs(sim_val - runtime_val)
            if delta > threshold:
                discrepancies.append({
                    "signal": signal,
                    "simulated": sim_val,
                    "observed": runtime_val,
                    "delta": round(delta, 6),
                })

        return discrepancies
