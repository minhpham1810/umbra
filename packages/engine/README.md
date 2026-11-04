# umbra-engine

A deterministic, headless 3D game engine for AI agents. The same scene and inputs
always give the same run, tick for tick, in Node and in the browser, so every run is a
replay an agent can save, share and check.

- **Generic core:** `defineGame` with components (Zod schemas), systems in ordered
  phases, a game-defined input, events, resources and a seeded RNG; `runGame`,
  checkpoints (`save` / `load`), replays (`recordReplay` / `verifyReplay`) and scene
  files with prefabs (`spawnScene`). See the example in the repository's
  `packages/engine/examples/snake`.
- **3D physics plugin:** `plugins: [physics3d()]` makes rigid bodies (fixed, dynamic,
  kinematic), colliders (box, sphere, capsule, cylinder, mesh, sensors) and a
  collision-resolving character into components, with Contact events, impulses, ray
  casts and `navBakeWorld`. Rapier (pinned to 0.12.0) state is hashed and checkpointed.
  See `packages/engine/examples/room`.
- **Scenes as data:** JSON kit pieces on a 1 m grid (floor, wall, pit, moving platform,
  crate, …), validated with Zod.
- **Replays and proof:** a fixed 60 Hz step, inputs as integer frames, and a state hash
  after every tick.
- **Navigation:** navmesh baking and paths (recast-navigation).
- **Rendering:** `Mesh`, `Camera` and `Light` presentation components (saved, never
  hashed), drawn by `createSceneView` from `umbra-engine/three` with smoothing between
  ticks (Three.js is an optional peer dependency); Canvas 2D views as well.
- **Browser runtime:** `startGame` and `createInput` from `umbra-engine/runtime`: a
  fixed-tick loop with per-tick input sampling, pause and restart, and replay export.

```sh
npm install umbra-engine
```

```ts
import { defineComponent, defineGame, runGame, z } from "umbra-engine";

const Counter = defineComponent("counter", z.number().int());

// Each tick's input is added to every counter; reaching 10 wins.
const adder = defineGame({
  name: "adder",
  input: z.number().int(),
  components: [Counter],
  setup: (world) => { world.spawn(Counter(0)); },
  systems: [function add(world, n) { for (const [e, v] of world.query(Counter)) world.set(e, Counter, v + n); }],
  outcome: (world) => (world.first(Counter)![1] >= 10 ? "win" : undefined),
});

const r = await runGame(adder, null, { seed: 0, inputs: [3, 3, 3, 3] });
console.log(r.outcome, r.ticks, r.finalStateHash); // "win" 4, and the same hash everywhere
```

The kit-scene platformer runtime (used by the Lantern demo) runs a level headlessly:

```ts
import { BUTTON, SceneSchema, runSim } from "umbra-engine";

// A 1-wide corridor with the exit at the far end.
const scene = SceneSchema.parse({
  pieces: Array.from({ length: 10 }, (_, z) => ({ kind: "floor", pos: { x: 0, y: 0, z } })),
  spawn: { pos: { x: 0.5, y: 1.72, z: 0.5 } },
  goals: [{ id: "exit", kind: "exit", pos: { x: 0, y: 1, z: 9 } }],
});

// Hold forward for three seconds (yaw 0 faces +z).
const inputs = Array.from({ length: 180 }, () => ({ buttons: BUTTON.FORWARD, yaw: 0 }));
const run = await runSim({ scene, seed: 0, inputs, maxTicks: inputs.length });
console.log(run.outcome, run.finalStateHash); // "win", and the same hash on every machine
```

For a game loop, `createSimulation(scene)` returns a sim you `step(frame)` once per
fixed tick and read with `position()`, `platforms()` and `crates()`. Draw it with
`kitSceneView` from `umbra-engine/three`, or `drawSceneSide` on a 2D canvas.

The agent tools (Playtester, route search, MCP server) are in
[`umbra-agents`](https://www.npmjs.com/package/umbra-agents). Docs, the two demo games
and the determinism rules: [github.com/minhpham1810/umbra](https://github.com/minhpham1810/umbra).

MIT licensed.
