# Hook: on-scene-save

**Trigger:** any `*.json` file saved under `games/` or `benchmark/`

**Actions:**
1. Run `scene.validate` on the saved file.
2. If valid and Playtester is available, run the quick test suite (`searchReach` on every goal, navmesh only, no physics proof).
3. Report: valid/invalid + any failed goals.

This catches broken scene edits before they enter the benchmark.
