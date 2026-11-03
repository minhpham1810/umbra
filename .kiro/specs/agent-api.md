# Spec: agent-api

## Goal
A typed Node API (also served as an MCP server) that lets agents — and Kiro — drive the engine without touching the browser.

## Tools

| Tool | Signature | Status |
|---|---|---|
| `scene.validate` | `(raw) → {ok, errors[]}` | ✅ implemented |
| `scene.write` | `(path, scene) → {version}` | ✅ implemented |
| `sim.run` | `(scene, seed, inputs[], maxTicks) → {outcome, hash, events[]}` | ✅ implemented |
| `sim.observe` | `(scene, seed, inputs[], atTick) → Observation` | ✅ implemented |
| `nav.bake` | `(scene) → {navmeshId, islands[]}` | ✅ implemented |
| `nav.path` | `(navmeshId, from, to) → {found, waypoints[]}` | ✅ implemented |
| `search.reach` | `(scene, goal, budget) → {reached, inputs[], attempts}` | ✅ implemented (budget = max sim runs; edge jumps cross multiple gaps) |
| `search.strategy` | `(mansion, budget) → {quotaReachable, bestPlan, bestByPool, dominantStrategies, deadlocks}` | ✅ implemented |
| `replay.save` | `(scene, seed, inputs[]) → replayId` | ✅ implemented |

## Requirements

### Must (v2-kiroween)
- [x] `sim.run` calls real Rapier — not the stub.
- [x] `sim.observe` returns real ECS state.
- [x] `nav.bake` bakes a navmesh with recast-navigation.
- [x] `nav.path` returns waypoints or `{found: false}`.
- [x] `search.reach` converts waypoints to `InputFrame[]` and runs the sim.
- [x] MCP server wraps every tool with Zod input validation (`pnpm --filter @umbra/agents mcp`).

## Acceptance
`searchReach(scene, "exit", 1000)` finds a route on a solvable level.
`searchReach(scene, "exit", 1000).reached === false` on a level with the exit walled off.
