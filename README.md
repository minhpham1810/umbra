# Umbra

[![npm: umbra-engine](https://img.shields.io/npm/v/umbra-engine?label=umbra-engine)](https://www.npmjs.com/package/umbra-engine)
[![npm: umbra-agents](https://img.shields.io/npm/v/umbra-agents?label=umbra-agents)](https://www.npmjs.com/package/umbra-agents)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A deterministic TypeScript 2D and 3D game engine built for AI agents.** Every run is
reproducible tick for tick, in Node and in the browser, so agents can build levels,
play them headlessly and report each bug with a replay that proves it.

**Docs site: [minhpham1810.github.io/umbra](https://minhpham1810.github.io/umbra/)**, with the
[playground](https://minhpham1810.github.io/umbra/playground/) and
[Studio](https://minhpham1810.github.io/umbra/studio/) live in your browser.

New here? Start with the [guides](docs/README.md): [getting started](docs/getting-started.md),
[the browser](docs/browser.md), [physics](docs/physics.md), [agents](docs/agents.md) and
[determinism](docs/determinism.md). Every code example in them runs in the test suite.

> Invisible players haunt your game overnight; in the morning you get a list of bugs,
> each with a replay.

Umbra pairs the engine with an agent loop: a **Builder** turns a design brief into a
level, a **Playtester** hunts for unreachable goals and holes in the floor, and a
**Fixer** repairs what it finds with small, verified edits. Two deliberately opposite
games run on the same engine: **Lantern**, a dark third-person platformer, and
**Boo & Co.**, a bright top-down haunted-mansion management sim.

## Contents

- [Guides](docs/README.md)
- [Highlights](#highlights)
- [Install](#install)
- [Quick start](#quick-start)
- [Repository layout](#repository-layout)
- [Running the games](#running-the-games)
- [Agents](#agents)
- [Studio](#studio)
- [Benchmark](#benchmark)
- [How determinism is enforced](#how-determinism-is-enforced)
- [Rendering, runtime and navigation](#rendering-runtime-and-navigation)
- [Development](#development)
- [Current limitations](#current-limitations)
- [Related work](#related-work)
- [License](#license)

## Highlights

- **Deterministic by construction.** A fixed 60 Hz step, inputs as integer frames,
  sorted body construction and a state hash after every tick. CI replays every saved
  run twice and compares Node against headless Chromium.
- **Headless first.** The simulation runs in Node with Rapier's WebAssembly build, so
  agents never need a browser.
- **Generic core.** Entities, components with schemas, systems in ordered phases,
  seeded randomness, events, checkpoints, replays and scene files: any game's rules are
  plain systems, and optional modules (physics, navigation, rendering) plug in.
- **Levels as data.** Scene files list entities and prefabs as JSON, checked by each
  component's schema, so agents edit structure, not code.
- **Agent tools.** Route search, navmesh queries, structured observations, replays,
  and a Playtester, Builder and Fixer, all exposed through an MCP server.
- **Measured, not claimed.** On a benchmark of 96 levels with planted bugs, the
  Playtester finds 80 of 80 with no false alarms (see [Benchmark](#benchmark)).
- **Views that only draw.** Canvas 2D sprites, Three.js meshes and glTF models, and
  event-driven sounds read simulation state and never write it, so a run hashes the
  same however it is drawn.

## Install

```sh
npm install umbra-engine              # the engine
npm install umbra-agents umbra-engine # agent tools and the MCP server
npm install three                     # optional: only for umbra-engine/three
```

Requires Node.js 20 or later. Both packages are ES modules with TypeScript types.

## Quick start

### Define a game

A game is components (plain data with a schema), a per-tick input, a setup and a list of
systems. The engine runs one fixed tick per input and hashes the whole state after each.

```ts
import { defineComponent, defineGame, runGame, z } from "umbra-engine";

const Position = defineComponent("position", z.number().int());
const Speed = defineComponent("speed", z.number().int().min(1));

// A race: runners start at random speeds; each tick's input may boost one of them.
const race = defineGame({
  name: "race",
  input: z.number().int().min(0).nullable(),            // which runner to boost, or null
  level: z.object({ runners: z.number().int().min(2), finish: z.number().int() }),
  components: [Position, Speed],
  setup(world, level) {
    for (let i = 0; i < level.runners; i++) world.spawn(Position(0), Speed(1 + world.rng.int(3)));
  },
  systems: [
    function boost(world, pick) {
      const runner = pick === null ? undefined : world.entities()[pick];
      if (runner !== undefined) world.set(runner, Speed, world.get(runner, Speed)! + 1);
    },
    function move(world) {
      for (const [runner, x, speed] of world.query(Position, Speed)) world.set(runner, Position, x + speed);
    },
  ],
  outcome: (world, level) => ([...world.query(Position)].some(([, x]) => x >= level.finish) ? "finished" : undefined),
});

const result = await runGame(race, { runners: 3, finish: 30 }, { seed: 7, inputs: [0, null, 0, null, 0, null, 0, null, 0, null] });
console.log(result.outcome, result.ticks, result.finalStateHash); // the same on every machine
```

`createGame` gives a run you step yourself, with `save()` and `load()` checkpoints for
branching searches; `recordReplay` and `verifyReplay` save a run and prove it reproduces;
`spawnScene` loads a level file of entities and prefabs. A complete example game is in
[`packages/engine/examples/snake`](packages/engine/examples/snake).

### Add 3D physics

`physics3d()` is a plugin: rigid bodies, colliders and characters become components, and
Rapier's state joins the hash and checkpoints. The plugin resolves collisions; movement,
gravity and jumping for a character stay in your game's systems.

```ts
import { Character, CharacterMove, CharacterState, Collider, Contact, Transform, defineGame, physics3d, z } from "umbra-engine";

const walker = defineGame({
  name: "walker",
  input: z.object({ x: z.number(), z: z.number() }),
  plugins: [physics3d({ gravity: { x: 0, y: -20, z: 0 } })],
  setup(world) {
    world.spawn(Transform({ position: { x: 0, y: -0.5, z: 0 } }), Collider({ shape: { type: "box", half: { x: 10, y: 0.5, z: 10 } } }));
    world.spawn(Transform({ position: { x: 0, y: 1, z: 4 } }), Collider({ shape: { type: "sphere", radius: 0.5 }, sensor: true }));
    world.spawn(Transform({ position: { x: 0, y: 1, z: 0 } }), Character({ radius: 0.3, halfHeight: 0.4 }),
      CharacterState({ grounded: false, moved: { x: 0, y: 0, z: 0 } }));
  },
  systems: [function walk(world, input) {
    for (const [e] of world.query(Character)) world.set(e, CharacterMove, { x: input.x / 60, y: -0.05, z: input.z / 60 });
  }],
  outcome: (world) => (world.events(Contact).some((c) => c.sensor && c.started) ? "reached" : undefined),
});
```

Shapes are boxes, spheres, capsules, cylinders and triangle meshes; bodies are fixed,
dynamic or kinematic. `physics(world)` gives systems impulses and ray casts, and
`navBakeWorld(world)` bakes a navmesh from the fixed colliders. A complete example is in
[`packages/engine/examples/room`](packages/engine/examples/room).

### Add 2D physics

`physics2d()` is the same plugin in the x/y plane (Rapier 2D, also pinned to 0.12.0): it
shares `Transform`, reads and writes its rotation as a turn about z, and leaves its z alone
for draw order. Components carry a `2D` suffix:

```ts
import { Character2D, CharacterMove2D, CharacterState2D, Collider2D, RigidBody2D, Transform, defineGame, physics2d, rotationZ, z } from "umbra-engine";

const pile = defineGame({
  name: "pile",
  input: z.object({ x: z.number() }),
  plugins: [physics2d({ gravity: { x: 0, y: -20 } })],
  setup(world) {
    world.spawn(Transform({ position: { x: 0, y: 0, z: 0 } }),
      Collider2D({ shape: { type: "polyline", points: [{ x: -10, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }] } }));
    world.spawn(Transform({ position: { x: -5, y: 6, z: 0 }, rotation: rotationZ(0.4) }), RigidBody2D({ type: "dynamic" }),
      Collider2D({ shape: { type: "box", half: { x: 0.5, y: 0.5 } } }));
    world.spawn(Transform({ position: { x: 2, y: 1, z: 0 } }), Character2D({ radius: 0.3, halfHeight: 0.4 }),
      CharacterState2D({ grounded: false, moved: { x: 0, y: 0 } }));
  },
  systems: [function walk(world, input) {
    for (const [e] of world.query(Character2D)) world.set(e, CharacterMove2D, { x: input.x / 60, y: -0.05 });
  }],
});
```

Shapes are boxes, circles, capsules, convex hulls and polylines (terrain). `physics2dOf(world)`
gives systems impulses and ray casts; `Contact2D` events report touches. `rotationZ(angle)` and
`angleZ(rotation)` convert 2D angles exactly, the same on every JavaScript engine
(`Math.sin` and friends are not, so the determinism lint bans them in simulation code).
A complete example is [`packages/engine/examples/hop`](packages/engine/examples/hop), playable
in the playground at `?game=hop`.

### Kit-scene platformer runtime

The engine also ships the 3D platformer runtime that Lantern uses (to be rebuilt on the
core as optional physics and character modules). Run a level headlessly:

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

Let an agent find the route and playtest the level:

```ts
import { playtest, searchReach } from "umbra-agents";

const route = await searchReach(scene, "exit", 50); // budget: at most 50 simulation runs
const report = await playtest(scene, { maxRuns: 100 });
console.log(route.reached, report.findings);        // the corridor has no walls: out_of_bounds
```

For a real-time game loop, `createSimulation(scene)` returns a simulation you `step()`
once per fixed tick and read with `position()`, `platforms()` and `crates()`. Package
documentation: [`umbra-engine`](packages/engine/README.md) and
[`umbra-agents`](packages/agents/README.md).

## Repository layout

| Path | Contents |
| --- | --- |
| [`packages/engine`](packages/engine) | `umbra-engine`: the core, 2D and 3D physics, views, browser runtime, navigation; [examples](packages/engine/examples) |
| [`docs`](docs) | Guides, with examples that run in the test suite |
| [`apps/playground`](apps/playground) | The engine's examples, playable in the browser |
| [`packages/agents`](packages/agents) | `umbra-agents`: Playtester, Builder, Fixer, route and balance search, MCP server |
| [`games/lantern`](games/lantern) | Lantern, a third-person platformer |
| [`games/boo-and-co`](games/boo-and-co) | Boo & Co., a haunted-mansion management sim with its own simulation |
| [`apps/studio`](apps/studio) | Studio, a browser replay viewer |
| [`benchmark`](benchmark) | Seeded-bug benchmark: 96 levels with known answers, and detector scores |
| [`.kiro`](.kiro) | Kiro specs, steering documents and hooks |

## Running the games

Prerequisites: Node.js 20+ and pnpm (CI uses pnpm 12). From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @umbra/lantern dev      # or @umbra/boo-and-co, @umbra/studio
```

Open the URL Vite prints (usually http://127.0.0.1:5173). Vite resolves the engine
from source, so no package build is needed during development.

### Lantern

Reach the green exit in near-total darkness, lit only by your lantern. Level 1 crosses
a broken floor; level 2 rides a moving platform across a chasm.

| Control | Action |
| --- | --- |
| W / S | Walk forward / backward |
| A / D or arrow keys | Turn |
| Space | Jump |
| Click / Esc | Capture / release the mouse for looking |
| R | Restart |
| N (after a win) | Next level |

URL options: `?level=2` opens a level directly, `?scene=<name>` plays a generated level
from `games/lantern/public/levels/`, and `?view=2d` switches to a side-scrolling Canvas
2D view (A / D walk, W or Space jumps) that needs no WebGL. A desktop browser and a
keyboard are required.

### Boo & Co.

Run a haunted mansion and hit the scare quota before the day ends. Place ghosts (25
coins; each scares one visitor within 2 tiles every half second) and traps (20 coins; a
double scare for whoever steps on one, every 6 seconds). Visitors who are scared enough
flee, and in a one-wide hallway they can jam against new arrivals.

The game is mouse only: click a floor tile to build, drag to orbit, scroll to zoom.
Space pauses and the 1×–8× buttons set the speed. `?view=2d` draws the mansion as a
flat top-down grid.

The mansion simulation lives in the game (`games/boo-and-co/src/sim`), not the engine.
It uses integers only, on a grid with one visitor per cell, so it is deterministic in
every browser.

### Building for production

```sh
pnpm --filter @umbra/lantern build    # output: games/lantern/dist
pnpm --filter @umbra/lantern exec vite preview --host 127.0.0.1
```

The games are static sites with no backend. Rapier's embedded WebAssembly makes the
first bundle large, so Vite prints a chunk-size warning.

## Agents

The language model never steers the player frame by frame. It sets goals and reads
results; searches propose routes and the simulation decides whether they work.

### Any game

Every tool below works on a game made with `defineGame`, through a small `AgentGame`:
the moves a search may make, and optionally a score saying which states look closer to
winning ([`packages/agents/examples/games.ts`](packages/agents/examples/games.ts) sets up
the engine's snake, collect and room examples).

```ts
import { playtestGame, searchOutcome, type AgentGame } from "umbra-agents";

const agent: AgentGame<CollectInput> = {
  game: collect,
  moves: [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }],
  hold: 6,                                                // ticks per move
  score: (world) => world.resource(Score),                // higher is closer to "win"
};
const route = await searchOutcome(agent, level, { target: "win" });   // inputs that win, re-run from scratch
const report = await playtestGame(agent, level);                       // findings, plus a replay per reached outcome
```

`searchOutcome` is a beam search that branches from checkpoints instead of re-running from
tick 0; without a score it explores at random. `playtestGame` reports:

| Finding | How it is found |
| --- | --- |
| `crash` | A system throws during random play; the inputs up to that tick reproduce it |
| `nondeterministic` | The same seed and inputs give a different state hash (for example `Math.random` or `Date.now` in a system) |
| `checkpoint_mismatch` | Restoring a mid-run checkpoint and replaying diverges: some state lives outside the world |
| `unreachable_outcome` | The bounded search finds no route to an expected outcome (no proof of impossibility) |

The rest of this section covers the tools built for the kit-scene platformer (Lantern) and
for build-placement games (Boo & Co.), which predate the generic core.

### Playtester

```sh
pnpm --silent --filter umbra-agents playtest games/lantern/src/level-2.json
```

The Playtester prints a JSON report and exits with code 1 when it finds bugs. Each test
goal is checked against the navmesh first, then proved in the simulator.

| Bug type | How it is found |
| --- | --- |
| `unreachable_goal` | Route search fails within its budget (walking, held jumps, edge jumps across gaps, platform rides, timed jumps). The search is bounded, so this means "no route found", not proof of impossibility |
| `fall_through` | Walking into an unmarked hole inside the level ends out of bounds |
| `out_of_bounds` | The same at the level's edge, for example over a low outer wall |

Mark intended gaps with `pit` pieces; unmarked holes are reported. Every fall finding
saves a replay that reproduces it on a fresh run.

### Builder, Fixer and the agent loop

```sh
pnpm --silent --filter umbra-agents haunt "A crypt corridor: jump a gap, then climb a ledge." crypt
pnpm --filter @umbra/lantern dev   # then open http://127.0.0.1:5173/?scene=crypt
```

The Builder asks the model for a small blueprint (floor rectangles with heights, pits,
moving platforms, spawn and exit) and compiles it into kit pieces, retrying on errors.
The Playtester then runs, and the Fixer proposes up to 12 edits per finding
(`add_floor`, `add_wall`, `remove`). An edit is kept only if a full playtest no longer
reproduces the bug and finds nothing new. Each accepted fix also produces a before and
after replay for Studio.

### Balance search

```sh
pnpm --silent --filter @umbra/boo-and-co playtest [mansion.json]
```

`searchStrategy` works on any build-placement game through a small `PlanGame` adapter:
build kinds and costs, valid cells, budget, quota and a deterministic `run(plan)`. It
combines random restarts with hill climbing under a fixed seed, and reports:

| Bug type | Meaning |
| --- | --- |
| `unwinnable_quota` | No plan found reaches the quota |
| `dominant_strategy` | A single-kind plan beats every plan using another kind by more than 10% |
| `crowd_deadlock` | A plan leaves units stuck at the end of the run |

Its first run on the shipped mansion found that all-trap plans dominated (220 scares
against 177), and the build stats were rebalanced from that result.

### Language model

The Builder, the Fixer and the Playtester's test planning use Gemini. Set
`GEMINI_API_KEY` in the environment or in a `.env` file in the directory you run from
(git-ignored in this repository); `GEMINI_MODEL` selects the model (default
`gemini-3.5-flash-lite`). Without a key, the Playtester still runs its full default
plan: the model only orders the tests and cannot skip any.

### MCP server

```sh
npx umbra-mcp --games ./agent-games.js         # from the npm package; the module exports a list of AgentGame
pnpm --silent --filter umbra-agents mcp --games examples/games.ts   # in this repository, the example games
pnpm --silent --filter @umbra/boo-and-co mcp   # in this repository, with search.strategy for mansions
```

| Tool | Purpose |
| --- | --- |
| `game.list` | The registered games, their named levels and search moves |
| `game.run`, `game.observe` | Run any game with one input per tick; get its entities, components, resources and events at a tick |
| `game.search`, `game.playtest` | Search for an outcome; playtest a level (findings above) |
| `game.replay.verify` | Check an `umbra-replay` file reproduces its final hash |
| `scene.validate`, `scene.write` | Check a scene against the schema; write it inside `UMBRA_SCENES_DIR` |
| `sim.run`, `sim.observe` | Run the simulation; get a structured observation at a given tick |
| `nav.bake`, `nav.path` | Bake a navmesh; query a route |
| `search.reach` | Search for inputs that reach a goal |
| `search.strategy` | Search build plans, when a game registers a `PlanGame` with `createServer({ strategy })` |
| `replay.save` | Run and save a replay to `UMBRA_REPLAYS_DIR` |

Inputs are Zod-validated (game inputs and levels by each game's own schemas) and capped
at 18,000 ticks per run and 2,000 simulation runs per kit search. Kiro loads the server from [`.kiro/settings/mcp.json`](.kiro/settings/mcp.json).

## Studio

```sh
pnpm --filter @umbra/studio dev
```

Studio re-simulates a replay with the real engine, checks its final state hash against
the saved one (a green badge means it reproduced exactly), and plays it back with a
scrubber, a clickable event list and the game's resources at each tick.

`umbra-replay` files (from `recordReplay`, `loop.replay()` or `playtestGame`) play for any
game listed in [`apps/studio/src/games.ts`](apps/studio/src/games.ts), drawn by the
engine's own views: Three.js for games with `Mesh` components (Follow uses the game's
camera; untick it to orbit), Canvas 2D for games with `Sprite` components. Add your game
to that list to view its replays. Kit-scene replays (Lantern) play in 3D with an orbit
camera and a path trail.

For the Fixer's output, Studio switches between the **before** and **after** runs, lists
the edits and outlines the changed cells (green for added, red for removed). Open a
replay with the file button, by dropping a JSON file, or with `?replay=<url>`. Bundled
samples are in `apps/studio/public/replays/`; regenerate them with
`pnpm --filter @umbra/studio samples`.

## Benchmark

The benchmark measures bug detection against known answers: 16 generated Lantern
levels, each with a verified winning route, and 80 copies that each carry one planted
bug (three kinds of unreachable exit, a missing floor tile, and a side wall low enough
to jump).

```sh
pnpm --filter @umbra/benchmark bench
```

| Detector | Planted bugs found | Clean levels flagged | Median time per level |
| --- | --- | --- | --- |
| **Playtester** | **80 / 80** | **0 / 16** | 4.9 s |
| Random input (300 runs) | 65 / 80 | 16 / 16 | 33.3 s |
| Navmesh path only | 48 / 80 | 16 / 16 | < 0.1 s |

The Playtester was tuned after a first run on this set, and the levels are generated
straight corridors, so expect lower scores on new kinds of level. The method, mutations
and caveats are in [`benchmark/README.md`](benchmark/README.md).

## How determinism is enforced

| Rule | Enforcement |
| --- | --- |
| One pinned physics version | Rapier `0.12.0`, exact in the lockfile; replays record the version |
| Fixed timestep | `world.step()` is called exactly once per tick, at 1/60 s |
| Same construction order | Bodies and colliders are created in sorted order |
| No platform-dependent math in physics | Movement uses an integer yaw (0–255) lookup table; ESLint bans `Math.sin`, `Math.random`, `Date` and similar in simulation code |
| Proof every tick | The state hash combines entity state, a Rapier snapshot hash and the simulation's own state |
| Checked in CI | A 100-run property test, every saved replay run twice against its stored hash, and Node compared with headless Chromium on every scene |

Rules for game code and how to debug a divergence: [docs/determinism.md](docs/determinism.md).
Engine-internal rules: [`.kiro/steering/determinism.md`](.kiro/steering/determinism.md).

## Rendering, runtime and navigation

What to draw is data: `Mesh`, `Camera` and `Light` (3D) and `Sprite` and `Camera2D` (2D)
are **presentation components**,
spawned in `setup` like any other and saved with the world, but left out of the state
hash, so changing a colour never invalidates a replay. Renderers only read the world.

```ts
import { createSceneView } from "umbra-engine/three";
import { createInput, startGame } from "umbra-engine/runtime";

const input = createInput(window);
let view: ReturnType<typeof createSceneView> | undefined;
const loop = await startGame(myGame, level, {
  input: () => ({ jump: input.pressed("Space") }),        // sampled once per fixed tick
  afterTick: () => { input.endTick(); view?.capture(); },
  render(run, alpha) {                                     // every frame, alpha = 0–1 between ticks
    view ??= createSceneView(run.world);
    view.setAspect(innerWidth / innerHeight);
    view.sync(alpha);
    renderer.render(view.scene, view.camera);              // a THREE.WebGLRenderer
  },
});
const replay = await loop.replay();                        // the session so far, replayable anywhere
```

| Import | Contents |
| --- | --- |
| `umbra-engine` | Components `Transform`, `Mesh`, `Camera`, `Light`, `Sprite`, `Camera2D` (built into every game); `createSpriteView(world, ctx)`: a Canvas 2D view of sprites (rectangles, circles, images with sprite-sheet frames, text) by layer, smoothed between ticks; `gltfTriangles(bytes)`: a model's triangles, for colliders and navmeshes; kit-scene views `drawSceneSide` and `drawGridTop` |
| `umbra-engine/three` | `createSceneView(world)`: a Three.js scene mirroring meshes, cameras and lights, smoothed between ticks; `gltfModels({ path })`: glTF loading for `{ type: "model" }` meshes; kit-scene helpers `kitSceneView` and `gridView` |
| `umbra-engine/runtime` | `startGame`: a fixed-tick browser loop that samples input per tick, records every input, and can pause, restart and export a replay; `createInput`: keys, mouse, pointer and gamepad state with per-tick edges; `createAudio({ sounds })`: Web Audio sounds triggered by event names |

2D games use the same Transform's x and y (y up), and its turn about z:

```ts
import { createSpriteView } from "umbra-engine";
import { createAudio } from "umbra-engine/runtime";

// In setup: world.spawn(Transform({ position: { x: 0, y: 0, z: 0 } }), Sprite({ shape: { type: "circle", radius: 0.4 }, color: "#f5b301" }));
const view = createSpriteView(run.world, canvas.getContext("2d")!, { pixelRatio: devicePixelRatio });
const audio = createAudio({ sounds: { collected: "coin.wav", hit: (d) => (d.hard ? "crash.wav" : undefined) } });
// afterTick: (run, events) => { view.capture(); audio.play(events); }   render: (run, alpha) => view.draw(alpha)
```

A model drawn in the browser and the collider physics uses come from the same file, so
headless runs collide with exactly what players see:

```ts
const bytes = await readFile("level.glb");               // or (await fetch(url)).arrayBuffer() in a browser
world.spawn(Transform({ position: { x: 0, y: 0, z: 0 } }),
  Mesh({ geometry: { type: "model", asset: "level.glb" } }),          // drawn by gltfModels()
  Collider({ shape: { type: "mesh", ...gltfTriangles(bytes, { node: "collision" }) } }));
```

`gltfTriangles` applies node transforms and reads .glb or .gltf files, optionally just one
node's subtree (such as a simplified collision mesh); compressed (Draco, meshopt) and
sparse data are rejected rather than read approximately. Read the bytes before the run
starts and pass the triangles in the level, so the level itself records the geometry.

`apps/playground` plays the 3D room example and, at `?game=collect` and `?game=hop`, the 2D
collect and hop examples this way (`pnpm --filter @umbra/playground dev`); replays recorded there reproduce exactly
when verified in Node.

Navigation bakes a Recast navmesh: `navBakeWorld(world, agent)` from a physics game's fixed
colliders, `navBakeTriangles(positions, indices, agent)` from any triangles, or
`navBake(scene)` from a kit scene's static blocks:

```ts
import { navBake, navDispose, navPath } from "umbra-engine";

const { navmeshId, islands } = await navBake(scene);
try {
  // Points lie on the floor surface, not at the player capsule's centre.
  const { found, waypoints } = navPath(navmeshId, { x: 0.5, y: 1, z: 0.5 }, { x: 0.5, y: 1, z: 9.5 });
  console.log(islands.length, found, waypoints);
} finally {
  navDispose(navmeshId); // frees WebAssembly memory
}
```

Pits, moving platforms and crates are excluded from the bake. Separate islands, partial
routes and points outside the query extent return `{ found: false, waypoints: [] }`.
A navmesh route is a proposal; only the simulation proves a player can follow it.

## Development

```sh
pnpm test                                        # all unit tests
pnpm lint                                        # includes the determinism rules
pnpm typecheck
pnpm --filter umbra-engine determinism-check     # every scene and saved replay, run twice
pnpm --filter umbra-engine validate-scenes
pnpm --filter umbra-engine exec playwright install chromium   # once
pnpm --filter umbra-engine browser-hash-check --with packages/engine/examples/hash-cases.ts --with games/boo-and-co/src/sim/hash-cases.ts
```

### Publishing

Bump the version in `packages/engine/package.json` and `packages/agents/package.json`,
merge to `main`, then publish the engine first:

```sh
cd packages/engine && pnpm pack && npm publish umbra-engine-<version>.tgz --access public
cd ../agents && pnpm pack && npm publish umbra-agents-<version>.tgz --access public
```

`pnpm pack` replaces the internal `workspace:^` dependency with the real version range.
A published version number can never be reused.

## Current limitations

Engine:

- No 2D navmesh yet (`navBakeWorld` is 3D only), no joints, and characters are not
  carried by moving platforms.
- glTF colliders read uncompressed triangle data only (no Draco or meshopt).
- Sounds are not positional.

Demos and their tools (Lantern and Boo & Co. still run on the older kit-scene runtime and
their own simulation, until they are ported to the core):

- Ramps and stairs behave as cubes; keys, doors and hazards behave as plain pickups.
- The kit Playtester does not yet detect softlocks or trivial skips.
- Moving-platform carries are not collision-checked, so keep walls off platform paths.
  Navmesh bakes and route search ignore platforms and crates.
- Changes to hashed state alter hashes between commits even with the same Rapier
  version; regenerate expected hashes before comparing replays across such changes.

## Related work

LLM agents that test games already exist in research. [TITAN](https://arxiv.org/abs/2509.22170v1)
tests large commercial MMORPGs from the outside, and
[MIMIC-Py](https://conf.researchr.org/details/fse-2026/fse-2026-demonstrations/16/MIMIC-Py-An-Extensible-Tool-for-Personality-Driven-Automated-Game-Testing-with-Large)
offers personality-driven test agents as a reusable tool. Umbra takes a different
approach: determinism, headless runs and agent tools are part of the engine itself, so
every finding is an exact replay, and agents can build and fix levels as well as test
them.

## License

[MIT](LICENSE) © 2026 Minh Pham
