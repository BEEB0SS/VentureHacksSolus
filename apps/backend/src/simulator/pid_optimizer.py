"""
PID Optimizer — Finds optimal PID gains for straight-line driving.

Demo flow: bad gains (no correction) -> random search -> good gains (straight line).
Uses differential drive kinematics directly (no MuJoCo dependency).
"""

import math
import random


def pid_step(error: float, prev_error: float, integral: float,
             kp: float, ki: float, kd: float, dt: float) -> tuple[float, dict]:
    """Single PID computation. Returns (correction, new_state)."""
    integral += error * dt
    derivative = (error - prev_error) / dt if dt > 0 else 0.0
    correction = kp * error + ki * integral + kd * derivative
    return correction, {"integral": integral, "prev_error": error}


def simulate_with_pid(kp: float, ki: float, kd: float,
                       target_speed: float = 1.0, n_steps: int = 200,
                       dt: float = 0.01, initial_theta: float = 0.1,
                       wheel_base: float = 0.17, wheel_radius: float = 0.0325) -> list[dict]:
    """Run a differential drive simulation with PID heading correction.

    The robot tries to drive straight (target heading = 0). The PID controller
    adjusts the left/right wheel speed difference to correct heading error.
    An initial_theta offset simulates the car starting slightly off-course.

    Returns a trajectory: list of {x, y, theta, v_linear, v_angular, timestamp}.
    """
    x, y, theta = 0.0, 0.0, initial_theta
    integral, prev_error = 0.0, 0.0
    trajectory = []

    for step in range(n_steps):
        # Heading error: how far from theta=0 (straight ahead)
        error = -theta  # negative because positive theta means drifting left, need right correction

        # PID correction -> steering adjustment
        correction, state = pid_step(error, prev_error, integral, kp, ki, kd, dt)
        integral = state["integral"]
        prev_error = state["prev_error"]

        # Convert to wheel speeds: base speed +/- steering correction
        # Correction > 0 means turn right (slow left, speed up right)
        base_angular_speed = target_speed / wheel_radius
        # Constant steering bias — simulates a slightly stronger left motor.
        # Without PID correction, this makes the heading drift increase over time.
        # Good PID counteracts it; bad PID lets it compound.
        steering_bias = 0.3
        left_speed = base_angular_speed - steering_bias - correction
        right_speed = base_angular_speed + steering_bias + correction

        # Differential drive kinematics
        v_left = left_speed * wheel_radius
        v_right = right_speed * wheel_radius
        v_linear = (v_left + v_right) / 2.0
        v_angular = (v_right - v_left) / wheel_base

        x += v_linear * math.cos(theta) * dt
        y += v_linear * math.sin(theta) * dt
        theta += v_angular * dt

        trajectory.append({
            "x": round(x, 6),
            "y": round(y, 6),
            "theta": round(theta, 6),
            "v_linear": round(v_linear, 6),
            "v_angular": round(v_angular, 6),
            "timestamp": round((step + 1) * dt, 6),
        })

    return trajectory


def straight_line_score(trajectory: list[dict]) -> float:
    """Score a trajectory for straight-line driving. Lower = better.

    Penalizes: lateral drift (y deviation) + heading error (theta deviation).
    Uses mean absolute values so the score is interpretable.
    """
    if not trajectory:
        return float("inf")
    total_y = sum(abs(p["y"]) for p in trajectory)
    total_theta = sum(abs(p["theta"]) for p in trajectory)
    n = len(trajectory)
    return total_y / n + total_theta / n


def optimize_pid(n_trials: int = 100, n_steps: int = 200, dt: float = 0.01,
                  target_speed: float = 1.0, initial_theta: float = 0.1,
                  bounds: dict | None = None) -> dict:
    """Find optimal PID gains via random search.

    Runs n_trials simulations with random PID gains, each scored on
    straight-line driving quality. Returns the best gains + trajectories
    for before/after comparison.

    Args:
        n_trials: Number of random PID candidates to try
        n_steps: Steps per simulation
        dt: Time step
        target_speed: Target forward speed (m/s)
        initial_theta: Starting heading offset (radians) -- simulates misalignment
        bounds: Dict of {param_name: (min, max)} for each PID gain

    Returns:
        {best_gains, best_score, best_trajectory, bad_gains, bad_score, bad_trajectory, trials_run}
    """
    if bounds is None:
        bounds = {"kp": (0.5, 5.0), "ki": (0.0, 1.0), "kd": (0.0, 0.5)}

    # First: generate the "bad" baseline (zero gains = no correction)
    bad_gains = {"kp": 0.0, "ki": 0.0, "kd": 0.0}
    bad_traj = simulate_with_pid(**bad_gains, target_speed=target_speed,
                                  n_steps=n_steps, dt=dt, initial_theta=initial_theta)
    bad_score = straight_line_score(bad_traj)

    # Random search
    best_gains = dict(bad_gains)
    best_score = bad_score
    best_traj = bad_traj

    for _ in range(n_trials):
        candidate = {
            "kp": random.uniform(*bounds["kp"]),
            "ki": random.uniform(*bounds["ki"]),
            "kd": random.uniform(*bounds["kd"]),
        }
        traj = simulate_with_pid(**candidate, target_speed=target_speed,
                                  n_steps=n_steps, dt=dt, initial_theta=initial_theta)
        score = straight_line_score(traj)
        if score < best_score:
            best_score = score
            best_gains = candidate
            best_traj = traj

    return {
        "best_gains": {k: round(v, 4) for k, v in best_gains.items()},
        "best_score": round(best_score, 6),
        "best_trajectory": best_traj,
        "bad_gains": bad_gains,
        "bad_score": round(bad_score, 6),
        "bad_trajectory": bad_traj,
        "trials_run": n_trials,
    }
