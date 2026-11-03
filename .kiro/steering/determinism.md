# Umbra — Determinism Rules

These are hard constraints. Breaking any one of them can cause replays to diverge between Node and the browser.

1. **Pin Rapier.** `@dimforge/rapier3d` is locked to one exact version in `pnpm-lock.yaml`. Never change it without a new benchmark run and a `rapierVersion` bump in all saved scenes.

2. **Sorted construction order.** Bodies, colliders and joints are created and removed in ascending entity-ID order every run. The `buildPhysicsWorld` function must sort before iterating.

3. **No browser math into physics.** `Math.sin`, `Math.cos`, `Math.random`, `Date.now`, `performance.now` — none of these may produce a value that flows into Rapier. Movement directions come from the `YAW_SIN`/`YAW_COS` LUT (`src/input/types.ts`), computed once at module load.

4. **Fixed timestep.** `world.step()` is called exactly once per tick with `dt = 1/60`. Never call it with a variable dt.

5. **State hash every tick.** `hashWorld(world, rapierSnapshotHash)` is called after every step and stored in `tickHashes`. CI runs every replay twice in Node and once in a headless browser, then compares all hashes.

6. **Integer game logic.** Health, keys, timers, counters — all integers in ECS. Only positions and velocities live in Rapier.

## ESLint enforcement (TODO: wire up)

`src/sim/` and `src/physics/` ban:
- `Math.random`, `Math.sin`, `Math.cos`, `Math.tan`, `Date`, `performance`
- Unsorted iteration over `Map` or `Set` without an explicit sort

These rules are in `.eslintrc.determinism.js` (TODO).
