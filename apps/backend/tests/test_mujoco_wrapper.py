"""Tests for the MuJoCo simulator stub — differential drive kinematics."""

import sys, os
import math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))


class TestSimulatorInit:
    def test_create_simulator(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        assert sim.parameters["wheel_radius"] == 0.05
        assert sim.parameters["wheel_base"] == 0.3
        assert sim.parameters["motor_torque"] == 0.5
        assert sim.parameters["friction"] == 0.1

    def test_set_parameter(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim.set_parameter("wheel_radius", 0.1)
        assert sim.parameters["wheel_radius"] == 0.1

    def test_set_parameter_unknown_key(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim.set_parameter("new_param", 42)
        assert sim.parameters["new_param"] == 42

    def test_get_state(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        state = sim.get_state()
        assert "parameters" in state
        assert "trajectory" in state
        assert "position" in state
        assert state["position"] == {"x": 0.0, "y": 0.0, "theta": 0.0}


class TestSimulatorRun:
    def test_run_steps_straight(self):
        """Equal wheel speeds should produce straight-line motion."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        # wheel_radius=0.05, so linear speed = 1.0 * 0.05 = 0.05 m/s
        trajectory = sim.run_steps(
            n_steps=100,
            left_speed=1.0,
            right_speed=1.0,
            dt=0.01,
        )
        assert len(trajectory) == 100
        final = trajectory[-1]
        assert final["x"] > 0
        assert abs(final["y"]) < 0.001
        assert abs(final["theta"]) < 0.001

    def test_run_steps_turning(self):
        """Different wheel speeds should produce a turn."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        trajectory = sim.run_steps(
            n_steps=100,
            left_speed=0.5,
            right_speed=1.0,
            dt=0.01,
        )
        final = trajectory[-1]
        assert abs(final["theta"]) > 0.01

    def test_run_steps_stationary(self):
        """Zero wheel speeds should produce no motion."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        trajectory = sim.run_steps(n_steps=10, left_speed=0.0, right_speed=0.0, dt=0.01)
        for point in trajectory:
            assert point["x"] == 0.0
            assert point["y"] == 0.0
            assert point["theta"] == 0.0

    def test_run_steps_stores_trajectory(self):
        """Trajectory should be stored in simulator state."""
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim.run_steps(n_steps=50, left_speed=1.0, right_speed=1.0, dt=0.01)
        state = sim.get_state()
        assert len(state["trajectory"]) == 50

    def test_trajectory_point_has_all_fields(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        trajectory = sim.run_steps(n_steps=1, left_speed=1.0, right_speed=1.0, dt=0.01)
        point = trajectory[0]
        assert "x" in point
        assert "y" in point
        assert "theta" in point
        assert "v_linear" in point
        assert "v_angular" in point
        assert "timestamp" in point


class TestSimulatorCompare:
    def test_compare_with_runtime_no_discrepancy(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim_data = [{"signal": "turn_radius", "value": 15.0}, {"signal": "speed", "value": 0.5}]
        runtime_data = [{"signal": "turn_radius", "value": 15.0}, {"signal": "speed", "value": 0.5}]
        discrepancies = sim.compare_with_runtime(sim_data, runtime_data)
        assert len(discrepancies) == 0

    def test_compare_with_runtime_has_discrepancy(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim_data = [{"signal": "turn_radius", "value": 15.0}, {"signal": "speed", "value": 0.5}]
        runtime_data = [{"signal": "turn_radius", "value": 22.0}, {"signal": "speed", "value": 0.5}]
        discrepancies = sim.compare_with_runtime(sim_data, runtime_data)
        assert len(discrepancies) == 1
        d = discrepancies[0]
        assert d["signal"] == "turn_radius"
        assert d["simulated"] == 15.0
        assert d["observed"] == 22.0
        assert d["delta"] == 7.0

    def test_compare_with_runtime_threshold(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim_data = [{"signal": "speed", "value": 0.500}]
        runtime_data = [{"signal": "speed", "value": 0.501}]
        discrepancies = sim.compare_with_runtime(sim_data, runtime_data, threshold=0.01)
        assert len(discrepancies) == 0

    def test_compare_with_runtime_mismatched_signals(self):
        from apps.backend.src.simulator.mujoco_wrapper import MuJoCoSimulator
        sim = MuJoCoSimulator()
        sim_data = [{"signal": "turn_radius", "value": 15.0}]
        runtime_data = [{"signal": "speed", "value": 0.5}]
        discrepancies = sim.compare_with_runtime(sim_data, runtime_data)
        assert len(discrepancies) == 0
