"""Tests for PID controller, straight-line scorer, and optimizer."""

import math


class TestPIDController:
    def test_zero_error_gives_zero_correction(self):
        from apps.backend.src.simulator.pid_optimizer import pid_step
        correction, state = pid_step(error=0.0, prev_error=0.0, integral=0.0,
                                      kp=1.0, ki=0.0, kd=0.0, dt=0.01)
        assert correction == 0.0

    def test_positive_error_gives_positive_correction(self):
        from apps.backend.src.simulator.pid_optimizer import pid_step
        correction, state = pid_step(error=0.5, prev_error=0.0, integral=0.0,
                                      kp=2.0, ki=0.0, kd=0.0, dt=0.01)
        assert correction > 0

    def test_integral_accumulates(self):
        from apps.backend.src.simulator.pid_optimizer import pid_step
        _, state1 = pid_step(error=1.0, prev_error=0.0, integral=0.0,
                              kp=0.0, ki=1.0, kd=0.0, dt=0.01)
        assert state1["integral"] > 0
        _, state2 = pid_step(error=1.0, prev_error=1.0, integral=state1["integral"],
                              kp=0.0, ki=1.0, kd=0.0, dt=0.01)
        assert state2["integral"] > state1["integral"]

    def test_derivative_responds_to_change(self):
        from apps.backend.src.simulator.pid_optimizer import pid_step
        correction, _ = pid_step(error=0.0, prev_error=1.0, integral=0.0,
                                  kp=0.0, ki=0.0, kd=1.0, dt=0.01)
        # Error decreased (1.0 -> 0.0), derivative is negative
        assert correction < 0


class TestSimulateWithPID:
    def test_returns_trajectory(self):
        from apps.backend.src.simulator.pid_optimizer import simulate_with_pid
        traj = simulate_with_pid(kp=1.0, ki=0.0, kd=0.0, target_speed=1.0,
                                  n_steps=100, dt=0.01)
        assert len(traj) == 100
        assert "x" in traj[0]
        assert "y" in traj[0]
        assert "theta" in traj[0]

    def test_good_pid_drives_straighter_than_bad(self):
        from apps.backend.src.simulator.pid_optimizer import simulate_with_pid, straight_line_score
        # Bad PID: no correction at all
        bad_traj = simulate_with_pid(kp=0.0, ki=0.0, kd=0.0, target_speed=1.0,
                                      n_steps=200, dt=0.01, initial_theta=0.1)
        # Good PID: strong proportional correction
        good_traj = simulate_with_pid(kp=3.0, ki=0.1, kd=0.05, target_speed=1.0,
                                       n_steps=200, dt=0.01, initial_theta=0.1)
        bad_score = straight_line_score(bad_traj)
        good_score = straight_line_score(good_traj)
        assert good_score < bad_score  # lower = better

    def test_with_initial_heading_offset(self):
        from apps.backend.src.simulator.pid_optimizer import simulate_with_pid
        traj = simulate_with_pid(kp=2.0, ki=0.0, kd=0.0, target_speed=1.0,
                                  n_steps=100, dt=0.01, initial_theta=0.3)
        # PID should correct back toward theta=0
        assert abs(traj[-1]["theta"]) < 0.3


class TestStraightLineScore:
    def test_perfect_straight_line_scores_zero(self):
        from apps.backend.src.simulator.pid_optimizer import straight_line_score
        traj = [{"x": i * 0.01, "y": 0.0, "theta": 0.0} for i in range(100)]
        score = straight_line_score(traj)
        assert score == 0.0

    def test_drifting_trajectory_scores_higher(self):
        from apps.backend.src.simulator.pid_optimizer import straight_line_score
        traj = [{"x": i * 0.01, "y": i * 0.005, "theta": 0.1} for i in range(100)]
        score = straight_line_score(traj)
        assert score > 0


class TestOptimizer:
    def test_optimize_returns_result(self):
        from apps.backend.src.simulator.pid_optimizer import optimize_pid
        result = optimize_pid(n_trials=20, n_steps=100, dt=0.01, target_speed=1.0)
        assert "best_gains" in result
        assert "best_score" in result
        assert "best_trajectory" in result
        assert "bad_trajectory" in result
        assert "kp" in result["best_gains"]
        assert "ki" in result["best_gains"]
        assert "kd" in result["best_gains"]

    def test_optimized_beats_zero_gains(self):
        from apps.backend.src.simulator.pid_optimizer import optimize_pid, straight_line_score
        result = optimize_pid(n_trials=50, n_steps=200, dt=0.01, target_speed=1.0)
        assert result["best_score"] < result["bad_score"]

    def test_optimizer_respects_bounds(self):
        from apps.backend.src.simulator.pid_optimizer import optimize_pid
        bounds = {"kp": (0.5, 2.0), "ki": (0.0, 0.5), "kd": (0.0, 0.2)}
        result = optimize_pid(n_trials=20, n_steps=100, dt=0.01, target_speed=1.0, bounds=bounds)
        assert 0.5 <= result["best_gains"]["kp"] <= 2.0
        assert 0.0 <= result["best_gains"]["ki"] <= 0.5
        assert 0.0 <= result["best_gains"]["kd"] <= 0.2
