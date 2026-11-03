# umbra-engine

A deterministic, headless 3D game engine for AI agents. The same scene and inputs
always give the same run, tick for tick, in Node and in the browser, so every run is a
replay an agent can save, share and check.

- **Physics:** Rapier 3D (pinned to 0.12.0), a kinematic character controller, moving
  platforms, pushable crates, goal sensors.
- **Scenes as data:** JSON kit pieces on a 1 m grid (floor, wall, pit, moving platform,
  crate, …), validated with Zod.
- **Replays and proof:** a fixed 60 Hz step, inputs as integer frames, and a state hash
  after every tick.
- **Navigation:** navmesh baking and paths (recast-navigation).
- **Views that only draw:** Canvas 2D views, and Three.js views from `umbra-engine/three`
  (Three.js is an optional peer dependency).

```sh
npm install umbra-engine
```

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
