# Spec: engine-core

## Goal
A headless, deterministic 3D simulation that turns `(scene, seed, inputs[]) → outcome + stateHash`.

## Requirements

### Must (v1-launchpad, Nov 20)
- [ ] ECS with integer entity IDs; components are typed records (`transform`, `rigidbody`, `player`, `health`, `trigger`, `goal`).
- [ ] Rapier 3D physics world built from `Scene.pieces` in sorted entity-ID order.
- [ ] Kinematic character controller for the player entity.
- [ ] Fixed timestep: `world.step(1/60)` called exactly once per tick.
- [ ] `InputFrame` consumed every tick: button bitmask + quantized yaw (0–255 LUT).
- [ ] State hash: `hashWorld(world, rapierSnapshotHash)` after every tick.
- [ ] `runSim(opts): Promise<RunResult>` — runs headlessly in Node with the WASM Rapier build.
- [ ] Determinism test: same seed + inputs → same `tickHashes` array, 100 property runs.
- [ ] CI: run every saved replay twice in Node, compare hashes.

### Should (v2-kiroween, Dec 4)
- [x] Sensor colliders as triggers (goal pickup, hazard zones).
- [ ] Moving platform support (kinematic body on a path).
- [x] Out-of-bounds detection (player below `y = -10`).
- [x] Browser hash test via Playwright.

### Could (later)
- [x] Navmesh baking from level geometry.
- [x] Observer API (`simObserve`).

## Acceptance
`pnpm test --filter @umbra/engine` passes, including the fast-check property test.
All `tickHashes` match between two Node runs.
