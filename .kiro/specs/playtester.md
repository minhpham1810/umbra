# Spec: playtester

## Goal
An agent that hunts for unreachable goals, softlocks, fall-throughs and trivial skips in a Lantern level, and reports each finding with a replay.

## Algorithm (Lantern)

1. **Cheap check:** `nav.bake` → `nav.path` per goal. Goals on a separate island are marked *possibly unreachable*.
2. **Physics proof:** convert waypoints to `InputFrame[]` → `sim.run`. If the goal is still unreachable, flag as a bug.
3. **Jump search:** for goals with no navmesh route, try launch points along island edges with a grid of jump directions and hold times.
4. **Fall/clip check:** random rollouts near walls and edges, look for `out_of_bounds` or `clipped` outcome.
5. A finding is accepted only when its replay reproduces on a fresh `sim.run` with the same seed + inputs.

## Bug types
- `unreachable_goal`
- `softlock`
- `fall_through`
- `out_of_bounds`
- `trivial_skip`

## Requirements (v2-kiroween)
- [x] LLM plans test goals from scene goals list (Gemini, `GEMINI_API_KEY`; default plan without a key).
- [x] Navmesh check runs first (cheap); its verdict is kept on each finding as `navRoute`.
- [x] Physics proof confirms or clears navmesh verdict.
- [x] Each finding includes: bug type, goal ID, replay ID, tick of failure (no replay for unreachable goals).
- [x] Budget parameters: maxRuns, wallClockMs, Gemini maxOutputTokens; ticks per run scale with route length.

## Acceptance
On the seeded-bug benchmark: detection recall ≥ 0.8, false alarm rate ≤ 0.1.
