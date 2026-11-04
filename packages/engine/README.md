# umbra-engine

A deterministic 2D and 3D game engine in TypeScript, built for AI agents. The same level,
seed and inputs always give the same run, tick for tick, in Node and in every browser, so
every run is a replay an agent can save, share and check.

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

## What is in it

| Import | Contents |
| --- | --- |
| `umbra-engine` | **Core:** `defineGame`, components with Zod schemas, resources, events, systems in phases, a seeded RNG, `runGame` / `createGame`, checkpoints, replays (`recordReplay` / `verifyReplay`), scene files with prefabs. **Physics:** `physics3d()` and `physics2d()` plugins (Rapier 0.12.0, pinned): bodies, colliders, characters, sensors, ray casts, all hashed and checkpointed. **Data to draw:** `Mesh`, `Camera`, `Light`, `Sprite`, `Camera2D` presentation components (saved, never hashed), and `createSpriteView` for Canvas 2D. **Assets:** `gltfTriangles` for colliders from glTF models. **Navigation:** Recast navmeshes and paths. **Exact 2D angles:** `rotationZ`, `angleZ` |
| `umbra-engine/three` | `createSceneView`: a Three.js scene mirroring the world, smoothed between ticks; `gltfModels` for model loading. Three.js is an optional peer dependency |
| `umbra-engine/runtime` | `startGame`: a fixed-tick browser loop that records every input and exports replays; `createInput`: keys, mouse, pointer and gamepads; `createAudio`: sounds triggered by events |

## Guides

- [Getting started](https://github.com/minhpham1810/umbra/blob/main/docs/getting-started.md)
- [In the browser](https://github.com/minhpham1810/umbra/blob/main/docs/browser.md)
- [Physics](https://github.com/minhpham1810/umbra/blob/main/docs/physics.md)
- [Agents](https://github.com/minhpham1810/umbra/blob/main/docs/agents.md), with [`umbra-agents`](https://www.npmjs.com/package/umbra-agents): search, playtesting and an MCP server for any game
- [Determinism](https://github.com/minhpham1810/umbra/blob/main/docs/determinism.md)
- [Examples](https://github.com/minhpham1810/umbra/tree/main/packages/engine/examples): snake, collect (2D), room (3D physics), hop (2D physics)

## Kit-scene runtime

The package also still contains the older platformer runtime that the Lantern demo uses
(`SceneSchema`, `runSim`, `createSimulation`, `kitSceneView`). It will be rebuilt on the
core when Lantern is ported; new games should use `defineGame`.

```ts
import { BUTTON, SceneSchema, runSim } from "umbra-engine";

const scene = SceneSchema.parse({
  pieces: Array.from({ length: 10 }, (_, z) => ({ kind: "floor", pos: { x: 0, y: 0, z } })),
  spawn: { pos: { x: 0.5, y: 1.72, z: 0.5 } },
  goals: [{ id: "exit", kind: "exit", pos: { x: 0, y: 1, z: 9 } }],
});
const inputs = Array.from({ length: 180 }, () => ({ buttons: BUTTON.FORWARD, yaw: 0 }));
const run = await runSim({ scene, seed: 0, inputs, maxTicks: inputs.length });
console.log(run.outcome); // "win"
```

MIT licensed.
