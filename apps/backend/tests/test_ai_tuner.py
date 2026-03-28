"""Tests for the AI tuner — search execution with mock Gemini responses."""

import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))


class TestSearchExecution:
    def test_execute_search_straight_line(self):
        from apps.backend.src.simulator.ai_tuner import execute_search

        # Mock Gemini response: search PID gains for straight-line driving
        search_config = {
            "search_space": {
                "pid_kp": [0.5, 5.0],
                "pid_ki": [0.0, 1.0],
                "pid_kd": [0.0, 0.5],
            },
            "scoring_function": "sum(abs(p['y']) + abs(p['theta']) for p in traj) / len(traj)",
            "fixed_params": {
                "left_speed": None,
                "right_speed": None,
                "target_speed": 1.0,
                "initial_theta": 0.1,
            },
            "new_mjcf": None,
            "mjcf_changed": False,
        }

        result = execute_search(search_config, n_trials=20, n_steps=100)

        assert "best_params" in result
        assert "best_score" in result
        assert "baseline_score" in result
        assert "best_trajectory" in result
        assert "baseline_trajectory" in result
        assert "trials_run" in result
        assert result["trials_run"] == 20
        assert result["best_score"] <= result["baseline_score"]
        assert len(result["best_trajectory"]) == 100

    def test_execute_search_with_fixed_speeds(self):
        from apps.backend.src.simulator.ai_tuner import execute_search

        search_config = {
            "search_space": {
                "left_speed": [2.0, 10.0],
            },
            "scoring_function": "abs(traj[-1]['x'] - 1.0)",
            "fixed_params": {
                "right_speed": 8.0,
                "pid_kp": 0.0,
                "pid_ki": 0.0,
                "pid_kd": 0.0,
                "target_speed": 1.0,
                "initial_theta": 0.0,
            },
            "new_mjcf": None,
            "mjcf_changed": False,
        }

        result = execute_search(search_config, n_trials=10, n_steps=50)
        assert result["best_score"] >= 0
        assert "left_speed" in result["best_params"]

    def test_bad_scoring_function_skips_trial(self):
        from apps.backend.src.simulator.ai_tuner import execute_search

        search_config = {
            "search_space": {"pid_kp": [0.1, 1.0]},
            "scoring_function": "1 / 0",  # will throw ZeroDivisionError
            "fixed_params": {
                "left_speed": None, "right_speed": None,
                "pid_ki": 0.0, "pid_kd": 0.0,
                "target_speed": 1.0, "initial_theta": 0.1,
            },
            "new_mjcf": None,
            "mjcf_changed": False,
        }

        result = execute_search(search_config, n_trials=5, n_steps=50)
        # Should not crash — bad trials are skipped, baseline used as fallback
        assert "best_score" in result


class TestBuildGraphSummary:
    def test_build_graph_summary_from_dict(self):
        from apps.backend.src.simulator.ai_tuner import build_graph_summary

        graph = {
            "entities": [
                {"name": "DRV8825", "entity_type": "electrical_part", "description": "Motor driver, max 2.5A"},
                {"name": "NEMA17", "entity_type": "mechanical_part", "description": "Stepper motor, 0.44Nm"},
            ],
            "relations": [
                {"source_entity_id": "e1", "target_entity_id": "e2", "relation_type": "drives"},
            ],
        }

        summary = build_graph_summary(graph)
        assert "DRV8825" in summary
        assert "NEMA17" in summary
        assert "drives" in summary
        assert isinstance(summary, str)

    def test_build_graph_summary_empty(self):
        from apps.backend.src.simulator.ai_tuner import build_graph_summary

        summary = build_graph_summary({"entities": [], "relations": []})
        assert "No entities" in summary or len(summary) > 0


class TestParseGeminiResponse:
    def test_parse_valid_json(self):
        from apps.backend.src.simulator.ai_tuner import parse_gemini_response

        raw = '''{
            "search_space": {"pid_kp": [0.5, 5.0]},
            "scoring_function": "sum(abs(p['y']) for p in traj) / len(traj)",
            "fixed_params": {"target_speed": 1.0},
            "new_mjcf": null,
            "mjcf_changed": false,
            "explanation": "Tuning PID for straight line",
            "changes_summary": ["Search kp 0.5-5.0"],
            "graph_constraints_used": ["DRV8825 max 2.5A"]
        }'''

        result = parse_gemini_response(raw)
        assert result["search_space"]["pid_kp"] == [0.5, 5.0]
        assert result["explanation"] == "Tuning PID for straight line"

    def test_parse_json_from_markdown_block(self):
        from apps.backend.src.simulator.ai_tuner import parse_gemini_response

        raw = '''Here is my analysis:
```json
{
    "search_space": {"pid_kp": [1.0, 3.0]},
    "scoring_function": "sum(abs(p['theta']) for p in traj) / len(traj)",
    "fixed_params": {},
    "new_mjcf": null,
    "mjcf_changed": false,
    "explanation": "test",
    "changes_summary": [],
    "graph_constraints_used": []
}
```'''

        result = parse_gemini_response(raw)
        assert result["search_space"]["pid_kp"] == [1.0, 3.0]

    def test_parse_invalid_json_returns_none(self):
        from apps.backend.src.simulator.ai_tuner import parse_gemini_response

        result = parse_gemini_response("this is not json at all")
        assert result is None
