# Umbra

A TypeScript 3D engine for games and headless agent runs. Rapier owns physics;
Three.js draws Lantern. Browser play and `runSim` use the same fixed 60 Hz loop.

## Run Lantern

Use Node.js 20+ and pnpm (CI uses pnpm 12).

```sh
pnpm install --frozen-lockfile
pnpm --filter @umbra/lantern dev
```

Open the localhost URL Vite prints, usually http://127.0.0.1:5173.
Run these commands from the repository root. Vite resolves the engine source,
so development does not need a package build first.

| Control | Action |
| --- | --- |
| W / S | Walk forward / backward |
| A / D or left / right arrows | Turn |
| Space | Jump |
| Click the world | Capture mouse for looking |
| Esc | Release mouse |
| R or Restart button | Restart the level |

Cross the broken floor and reach the green exit. Falling ends the run.
Keyboard controls work without mouse capture. A desktop browser with WebGL
and a keyboard is required; touch controls are not implemented.

## Build Lantern

```sh
pnpm --filter @umbra/lantern build
pnpm --filter @umbra/lantern exec vite preview --host 127.0.0.1
```

The static game is written to `games/lantern/dist`. The build includes TypeScript
checks. Rapier's embedded WASM makes the initial bundle large; Vite reports a
size warning. No model API, credentials, or backend server is required.

## Checks

```sh
pnpm test
pnpm --filter @umbra/engine typecheck
pnpm --filter @umbra/agents typecheck
pnpm --filter @umbra/lantern typecheck
pnpm --filter @umbra/engine determinism-check
pnpm --filter @umbra/engine validate-scenes
pnpm --filter @umbra/engine exec playwright install chromium   # once
pnpm --filter @umbra/engine browser-hash-check
```

Tests cover schema validation, deterministic replays, goal sensors, interactive
versus headless tick hashes, Lantern's winning jump and losing walk, navigation
islands, missing routes, the agent navigation exports, `simObserve`, and
`searchReach` on Lantern (solvable) and a walled-off copy (unreachable).
`browser-hash-check` runs the same replays in Node and headless Chromium and
compares every tick hash; CI runs it. Browser input and rendering are not yet tested.

Build the libraries before importing their package names from Node:

```sh
pnpm --filter @umbra/engine build
pnpm --filter @umbra/agents build
```

## Navigation API

The engine and agent packages export `navBake`, `navPath`, and `navDispose`.

```ts
import { navBake, navPath, navDispose, SceneSchema } from "@umbra/engine";

const scene = SceneSchema.parse(sceneJson);
const { navmeshId, islands } = await navBake(scene);
try {
  // Points lie on the floor surface, not at the player capsule centre.
  const result = navPath(navmeshId, { x: 1, y: 1, z: 1 }, { x: 4, y: 1, z: 4 });
  console.log(islands, result.found, result.waypoints);
} finally {
  navDispose(navmeshId);
}
```

`islands` lists connected polygon groups (`id`, `polygonRefs`). IDs refer to
in-memory meshes in the current process. Dispose each mesh when done to release
WASM memory. Unknown or disposed IDs throw. Empty scenes return no islands or
route. Invalid scene and point inputs throw.

Recast bakes static cuboids matching the physics world. Pits and moving platforms
are excluded. Routes on separate islands, partial routes, and endpoints outside
the local query extent return `{ found: false, waypoints: [] }`. Points may snap
within 0.5 metres horizontally and 1 metre vertically. Navmesh paths are route
proposals, not proof a player can complete a jump.

## Layout and current scope

| Path | Purpose |
| --- | --- |
| `packages/engine` | Physics, scene schema, replay loop, hashing, navigation |
| `packages/agents` | Typed scene, simulation, replay, and navigation tools |
| `games/lantern` | Playable Three.js level |
| `games/boo-and-co` | Stub for the second game |
| `apps/studio` | Stub for replay viewing |
| `benchmark` | Seed scenes and mutation stub |
| `.kiro` | Specs, steering, and hooks |

Lantern's level is `games/lantern/src/level.json`. The headless test proves a
specific input sequence can win it. The older benchmark scene is separate and
is schema-checked, not claimed to be playable.

Ramps and stairs currently behave as cubes; moving platforms do not move yet.
All goal kinds currently behave as collectable sensors, and reaching every goal
wins. Keys, doors, and hazards do not yet have separate rules. The seed argument
is retained for replays but the simulation currently has no random systems.
`searchReach(scene, goalId, budget)` treats `budget` as the maximum number of sim runs.
It follows the navmesh route (or a straight line), tries no jump, held jump, then
one jump at each tick offset, and only reports a route a fresh `runSim` reproduces.
It cannot yet find routes needing two separate jumps. Stacked solid blocks in one
column are merged into a single collider so the player cannot climb walls on the
seams. The MCP server, `search.strategy`, and the agent loop remain unfinished. Use the targeted Lantern commands above; other apps are still stubs.

Rapier is pinned to 0.12.0. Goal collision fixes change simulation hashes from
earlier commits even though the Rapier version is unchanged; regenerate earlier
expected hashes before comparing replays across those commits.
