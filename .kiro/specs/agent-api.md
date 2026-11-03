# Spec: agent-api

## Goal
A typed Node API (also served as an MCP server) that lets agents — and Kiro — drive the engine without touching the browser.

## Tools

| Tool | Signature | Status |
|---|---|---|
| `scene.validate` | `(raw) → {ok, errors[]}` | ✅ implemented |
| `scene.write` | `(path, scene) → {version}` | ✅ implemented |
| `sim.run` | `(scene, seed, inputs[], maxTicks) → {outcome, hash, events[]}` | stub |
| `sim.observe` | `(scene, seed, inputs[], atTick) → Observation` | stub |
| `nav.bake` | `(scene) → {navmeshId, islands[]}` | not started |
| `nav.path` | `(navmeshId, from, to) → {found, waypoints[]}` | not started |
| `search.reach` | `(scene, goal, budget) → {reached, inputs[], attempts}` | stub |
| `search.strategy` | `(mansionScene, budget) → strategy` | not started |
| `replay.save` | `(scene, seed, inputs[]) → replayId` | ✅ implemented |

## Requirements

### Must (v2-kiroween)
- [ ] `sim.run` calls real Rapier — not the stub.
- [ ] `sim.observe` returns real ECS state.
- [ ] `nav.bake` bakes a navmesh with recast-navigation.
- [ ] `nav.path` returns waypoints or `{found: false}`.
- [ ] `search.reach` converts waypoints to `InputFrame[]` and runs the sim.
- [ ] MCP server wraps every tool with Zod input validation.

## Acceptance
`searchReach(scene, "exit", 1000)` finds a route on a solvable level.
`searchReach(scene, "exit", 1000).reached === false` on a level with the exit walled off.
