"""
AI Tuner — Gemini designs parameter search, backend executes it.

Phase 1: Gemini receives goal + MJCF + params + context graph → returns search strategy
Phase 2: Backend runs N kinematic simulation trials → returns best result
"""

import json
import math
import os
import random
from typing import Optional

from .pid_optimizer import simulate_with_pid, straight_line_score

# Gemini import — optional
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False


SYSTEM_PROMPT = """You are a robotics simulation engineer. Given a MuJoCo MJCF model, the project's context model graph (entities and relations), and an optimization goal, design a parameter search strategy to achieve the goal.

You have two powers:
1. MODIFY THE MODEL: You can change the MJCF XML — friction, mass, actuator kv, damping, body structure, geom sizes, anything. Return the full modified XML.
2. DESIGN THE SEARCH: Define which runtime parameters to search over, their ranges, and a scoring function (as a Python expression) that evaluates trajectory quality. Lower score = better.

The robot is a 4-wheel differential drive car (Elegoo Smart Robot Car V4):
- 4 velocity actuators: act_lf, act_rf, act_lr, act_rr
- Left pair controlled together, right pair controlled together
- Optional PID heading controller: corrects theta error via left/right speed differential

Searchable parameters (you pick which ones and what ranges):
- left_speed: left wheel angular velocity (rad/s). Set to null in fixed_params to use PID mode instead.
- right_speed: right wheel angular velocity (rad/s). Set to null in fixed_params to use PID mode instead.
- pid_kp: proportional gain (used when left_speed/right_speed are null)
- pid_ki: integral gain
- pid_kd: derivative gain
- target_speed: desired forward speed (m/s, used in PID mode)
- initial_theta: starting heading offset (radians)

The scoring function receives a trajectory (list of dicts with keys: x, y, theta, v_linear, v_angular, timestamp) and must return a float. Lower = better. Write it as a Python expression using:
- traj: the full trajectory list
- p: a single point (use in list comprehensions)
- math: the math module is available

Examples:
- Straight line: "sum(abs(p['y']) + abs(p['theta']) for p in traj) / len(traj)"
- Circle radius R: "sum(abs(math.sqrt(p['x']**2 + p['y']**2) - 0.5) for p in traj) / len(traj)"
- Reach target (1,0): "math.sqrt((traj[-1]['x'] - 1.0)**2 + (traj[-1]['y'] - 0.0)**2)"
- Minimize energy: "sum(abs(p['v_angular']) for p in traj) / len(traj)"

Use the context model graph to inform your constraints. For example:
- If a battery entity shows 12V, don't suggest parameters exceeding that
- If a motor driver has max current, constrain actuator forces accordingly
- Reference specific entities in your explanation

Return ONLY valid JSON (no markdown, no explanation outside JSON) with these fields:
- search_space: Dict of {param_name: [min, max]} for parameters to search
- scoring_function: Python expression string (lower = better)
- fixed_params: Dict of parameters to hold constant (not searched)
- new_mjcf: Complete modified MJCF XML string, or null if no changes
- mjcf_changed: boolean
- explanation: What you changed and why
- changes_summary: Array of short bullet strings
- graph_constraints_used: Array of strings noting which graph entities informed constraints"""


def build_graph_summary(graph: dict) -> str:
    """Convert a context model graph dict to a compact text summary for Gemini."""
    entities = graph.get("entities", [])
    relations = graph.get("relations", [])

    if not entities:
        return "No entities in the context model yet."

    lines = ["Entities:"]
    entity_names = {}
    for e in entities:
        eid = e.get("id", "?")
        name = e.get("name", "unnamed")
        etype = e.get("entity_type", "unknown")
        desc = e.get("description", "")
        entity_names[eid] = name
        lines.append(f"- {name} ({etype}): {desc}")

    if relations:
        lines.append("\nRelations:")
        for r in relations:
            src = entity_names.get(r.get("source_entity_id", ""), r.get("source_entity_id", "?"))
            tgt = entity_names.get(r.get("target_entity_id", ""), r.get("target_entity_id", "?"))
            rtype = r.get("relation_type", "related_to")
            lines.append(f"- {src} --{rtype}--> {tgt}")

    return "\n".join(lines)


def parse_gemini_response(raw_text: str) -> Optional[dict]:
    """Parse Gemini's JSON response. Handles markdown code blocks."""
    text = raw_text.strip()

    # Try to extract JSON from markdown code block
    if "```" in text:
        parts = text.split("```")
        for part in parts:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("{"):
                text = part
                break

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        return None

    # Validate required fields
    required = ["search_space", "scoring_function", "fixed_params",
                "new_mjcf", "mjcf_changed", "explanation", "changes_summary"]
    for field in required:
        if field not in result:
            return None

    return result


def execute_search(search_config: dict, n_trials: int = 100,
                   n_steps: int = 200, dt: float = 0.01) -> dict:
    """Execute the parameter search designed by Gemini.

    Runs N trials with random sampling from search_space, scores each
    trajectory using the scoring function, returns the best result.
    """
    search_space = search_config["search_space"]
    scoring_expr = search_config["scoring_function"]
    fixed = search_config.get("fixed_params", {})

    # Compile scoring function
    def score_trajectory(traj: list[dict]) -> float:
        try:
            return float(eval(scoring_expr, {"__builtins__": {}, "math": math,
                                              "traj": traj, "abs": abs, "sum": sum,
                                              "len": len, "min": min, "max": max,
                                              "p": None}))
        except Exception:
            return float("inf")

    # Build baseline params (all fixed, search params at midpoint)
    baseline_params = dict(fixed)
    for param, (lo, hi) in search_space.items():
        baseline_params[param] = (lo + hi) / 2

    # Run baseline simulation
    sim_kwargs = _build_sim_kwargs(baseline_params)
    baseline_traj = simulate_with_pid(**sim_kwargs, n_steps=n_steps, dt=dt)
    baseline_score = score_trajectory(baseline_traj)

    # Run trials
    best_params = dict(baseline_params)
    best_score = baseline_score
    best_traj = baseline_traj

    for _ in range(n_trials):
        # Sample each search parameter uniformly
        trial_params = dict(fixed)
        for param, (lo, hi) in search_space.items():
            trial_params[param] = random.uniform(lo, hi)

        try:
            sim_kwargs = _build_sim_kwargs(trial_params)
            traj = simulate_with_pid(**sim_kwargs, n_steps=n_steps, dt=dt)
            score = score_trajectory(traj)
            if score < best_score:
                best_score = score
                best_params = dict(trial_params)
                best_traj = traj
        except Exception:
            continue  # Skip failed trials

    return {
        "best_params": {k: round(v, 4) if isinstance(v, float) else v
                        for k, v in best_params.items()},
        "best_score": round(best_score, 6),
        "baseline_score": round(baseline_score, 6),
        "best_trajectory": best_traj,
        "baseline_trajectory": baseline_traj,
        "trials_run": n_trials,
    }


def _build_sim_kwargs(params: dict) -> dict:
    """Convert flat params dict to simulate_with_pid kwargs.

    If left_speed/right_speed are None, PID mode is used (kp/ki/kd + target_speed).
    If they are set, direct speed mode with kp=ki=kd=0.
    """
    left = params.get("left_speed")
    right = params.get("right_speed")

    if left is None or right is None:
        # PID mode
        return {
            "kp": params.get("pid_kp", 0),
            "ki": params.get("pid_ki", 0),
            "kd": params.get("pid_kd", 0),
            "target_speed": params.get("target_speed", 1.0),
            "initial_theta": params.get("initial_theta", 0.1),
        }
    else:
        # Direct speed mode — simulate by setting base speed and zero PID
        avg_speed = (left + right) / 2 * 0.0325  # angular to linear
        return {
            "kp": 0, "ki": 0, "kd": 0,
            "target_speed": avg_speed,
            "initial_theta": params.get("initial_theta", 0.0),
        }


async def ai_tune(goal: str, current_mjcf: str, current_params: dict,
                  graph: dict, n_trials: int = 100, n_steps: int = 200) -> dict:
    """Full AI tuning pipeline: Gemini designs search, backend executes it.

    Args:
        goal: Natural language optimization goal
        current_mjcf: Current MJCF XML string
        current_params: Current runtime parameters
        graph: Context model graph dict {entities: [...], relations: [...]}
        n_trials: Number of search trials
        n_steps: Steps per simulation

    Returns:
        Combined result with Gemini's analysis + search results
    """
    graph_summary = build_graph_summary(graph)

    user_prompt = f"""Current MJCF model:
{current_mjcf}

Current parameters:
{json.dumps(current_params, indent=2)}

Project Context Model (entities and relations in this robot system):
{graph_summary}

Use the context model to inform your constraints. For example, if a battery entity
shows 12V capacity, don't suggest parameters that would exceed that. If a motor
driver has a max current rating, constrain actuator forces accordingly.

Optimization goal: {goal}"""

    # Call Gemini
    gemini_response = None
    if GEMINI_AVAILABLE:
        api_key = os.environ.get("GEMINI_API_KEY")
        if api_key:
            try:
                genai.configure(api_key=api_key)
                model = genai.GenerativeModel("gemini-2.5-flash")
                full_prompt = f"{SYSTEM_PROMPT}\n\n{user_prompt}"
                import asyncio
                response = await asyncio.to_thread(model.generate_content, full_prompt)
                gemini_response = parse_gemini_response(response.text)
            except Exception as e:
                print(f"[ai_tuner] Gemini call failed: {e}")

    if not gemini_response:
        # Fallback: default straight-line PID search
        gemini_response = {
            "search_space": {"pid_kp": [0.5, 5.0], "pid_ki": [0.0, 1.0], "pid_kd": [0.0, 0.5]},
            "scoring_function": "sum(abs(p['y']) + abs(p['theta']) for p in traj) / len(traj)",
            "fixed_params": {"left_speed": None, "right_speed": None,
                             "target_speed": 1.0, "initial_theta": 0.1},
            "new_mjcf": None,
            "mjcf_changed": False,
            "explanation": "Gemini unavailable. Using default PID search for straight-line driving.",
            "changes_summary": ["Default: search PID gains kp/ki/kd for heading correction"],
            "graph_constraints_used": [],
        }

    # Execute the search
    search_result = execute_search(gemini_response, n_trials=n_trials, n_steps=n_steps)

    # Combine Gemini's analysis with search results
    return {
        **search_result,
        "new_mjcf": gemini_response.get("new_mjcf"),
        "new_params": search_result["best_params"],
        "mjcf_changed": gemini_response.get("mjcf_changed", False),
        "explanation": gemini_response.get("explanation", ""),
        "changes_summary": gemini_response.get("changes_summary", []),
        "search_space": gemini_response.get("search_space", {}),
        "scoring_function": gemini_response.get("scoring_function", ""),
        "graph_constraints_used": gemini_response.get("graph_constraints_used", []),
    }
