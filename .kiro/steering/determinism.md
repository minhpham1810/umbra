# Umbra — Determinism Rules

These are hard constraints. Breaking any one of them can cause replays to diverge between Node and the browser.
The rules for game code on the generic core (`defineGame`) are in [docs/determinism.md](../../docs/determinism.md):
randomness from `world.rng` only, no clocks, no engine-dependent math (`rotationZ`/`angleZ` for 2D angles),
all state in the world, sorted iteration, presentation components never read by simulation.
The rules below are for the engine itself and the kit-scene runtime.

1. **Pin Rapier.** `@dimforge/rapier3d-compat` and `@dimforge/rapier2d-compat` are locked to one exact version in `pnpm-lock.yaml`. Never change it without a new benchmark run and a `rapierVersion` bump in all saved scenes.

2. **Sorted construction order.** Bodies, colliders and joints are created and removed in ascending entity-ID order every run. The `buildPhysicsWorld` function must sort before iterating.

3. **No browser math into physics.** `Math.sin`, `Math.cos`, `Math.random`, `Date.now`, `performance.now` — none of these may produce a value that flows into Rapier. Movement directions come from the `YAW_SIN`/`YAW_COS` LUT (`src/input/types.ts`), computed once at module load.

4. **Fixed timestep.** `world.step()` is called exactly once per tick with `dt = 1/60`. Never call it with a variable dt.

5. **State hash every tick.** `hashWorld(world, rapierSnapshotHash, extra)` is called after every step and stored in `tickHashes`. `extra` holds sim state kept outside the ECS and Rapier (vertical velocity, riding platform, grounded, reached goals); any new state that affects later ticks must be added there. CI runs every replay twice in Node and once in a headless browser, then compares all hashes.

6. **Integer game logic.** Health, keys, timers, counters — all integers in ECS. Only positions and velocities live in Rapier.

## ESLint enforcement

`pnpm lint` (root `eslint.config.mjs`) bans these in `packages/engine/src/{core,physics3d,physics2d,spatial,sim,physics,hash,ecs,input}` and `games/boo-and-co/src/sim`:
- `Math.random`, `Math.sin`, `Math.cos`, `Math.tan`, `Math.atan2`, `Math.exp`, `Math.log`, `Math.pow` and friends (results differ between JS engines)
- `Date`, `performance`

The yaw LUT is built from + − × ÷ only, so it is bit-identical in every engine.
Unsorted `Map`/`Set` iteration is not linted; sort before iterating. Do not sort with `localeCompare`.
