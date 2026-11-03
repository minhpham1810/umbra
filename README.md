# Umbra

A TypeScript 3D engine for games and headless agent runs. Rapier owns physics;
the engine's Three.js views (`@umbra/engine/three`, Three.js as an optional peer
dependency) or its Canvas 2D views (`?view=2d`) draw the games.
Browser play and `runSim` use the same fixed 60 Hz loop.

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
| N (after a win) | Next level |

Level 1: jump the broken floor. Level 2: ride the moving platform across the chasm.
Open a level directly with `?level=2`, or a generated one with `?scene=<name>` (see below). Falling ends the run.
Keyboard controls work without mouse capture. A desktop browser with WebGL
and a keyboard is required; touch controls are not implemented.

Add `?view=2d` (for example `?level=2&view=2d`) to play as a side-scroller drawn
by the engine's Canvas 2D view, without WebGL: A / D walk left and right, W or Space
jumps. The simulation is the same, so a 2D run and a 3D run with the same inputs have
the same state hashes. The side view flattens the corridor's width, so it suits
straight corridors like Lantern's; depth cells with holes are drawn fainter.

## Run Boo & Co.

```sh
pnpm --filter @umbra/boo-and-co dev
```

A bright top-down management sim: you run a haunted mansion. Pick a ghost (25
coins, scares one visitor within 2 tiles every half second) or a trap (20 coins,
double scare for whoever steps on it, every 6 seconds) and click floor tiles to
build. Hit the scare quota before the day ends. Mouse only; drag to orbit, scroll
to zoom, Space pauses, and 1×–8× sets the speed. Visitors who get scared enough
flee back to the entrance, and in a one-wide hallway they can jam against new
arrivals; the HUD counts stuck visitors. `?view=2d` draws the mansion with the
engine's flat top-down Canvas 2D view instead of Three.js; clicks build the same way.

The simulation (`games/boo-and-co/src/sim`) is integer-only on a grid with one
visitor per cell, instead of the navmesh crowds in the design, so it is
deterministic in every browser. The mansion is `games/boo-and-co/src/mansion.json`.
Its quota (140) needs both build kinds: the strategy search's best ghost-only and
trap-only plans reach about 113 scares, mixed plans about 160.

### Balance playtest

```sh
pnpm --silent --filter @umbra/boo-and-co playtest [mansion.json]
```

The agents' balance search (`searchStrategy` in `packages/agents/src/strategy.ts`) works
on any build-placement game through a small `PlanGame` adapter: build kinds and costs,
the cells builds may go on, the budget and quota, and a deterministic `run(plan)`. Boo &
Co.'s adapter is `games/boo-and-co/src/sim/balance.ts`. For a mansion (the shipped one by
default) it runs about 600 simulated days across ghost-only, trap-only and mixed plans,
random restarts then hill climbing, with a fixed seed. It reports:

| Bug type | Meaning |
| --- | --- |
| `unwinnable_quota` | No plan found reaches the quota |
| `dominant_strategy` | A single-kind plan beats every plan using another kind by over 10% |
| `crowd_deadlock` | A plan leaves visitors stuck at the end of the day |

Each finding carries the build plan that shows it; the mansion plus the plan replay
exactly. The first run on the shipped mansion found that all-trap plans dominated
(220 scares against 177 for any plan with a ghost); trap cooldown and ghost cost
were rebalanced from that. Mansions can override build stats with `catalog` for
balance mutations.

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
pnpm lint                                        # determinism rules on engine sim code
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

## MCP tools server

```sh
pnpm --silent --filter @umbra/agents mcp       # engine tools
pnpm --silent --filter @umbra/boo-and-co mcp   # the same, plus search.strategy for mansions
```

Serves the agent tools over stdio: `scene.validate`, `scene.write`, `nav.bake`,
`nav.path`, `sim.run`, `sim.observe`, `search.reach`, `replay.save`. A game adds
`search.strategy` by passing its `PlanGame` adapter: `createServer({ strategy })`.
Kiro picks up the Boo & Co. server (all nine tools) from `.kiro/settings/mcp.json`.
Any MCP client can launch the same command.
Inputs are Zod-validated and capped at 18,000 ticks per run and 2,000 sim runs per
search. `scene.write` only writes `.json` files inside `UMBRA_SCENES_DIR`
(default: the working directory); replays go to `UMBRA_REPLAYS_DIR` (default
`./replays`). Navmesh IDs live until the server exits.

## Playtester

```sh
pnpm --silent --filter @umbra/agents playtest games/lantern/src/level-2.json
```

Prints a JSON report and exits 1 when it finds bugs. Each test goal is checked with
the navmesh first and then proved in the simulator:

| Bug type | How it is found |
| --- | --- |
| `unreachable_goal` | `searchTarget` fails to reach the goal (walk, held jump, edge jumps over any number of gaps, platform rides, jump timings). The search is bounded, so this means "no route found", not a proof; there is no replay |
| `fall_through` | Walking into an unmarked hole inside the level ends out of bounds in that cell |
| `out_of_bounds` | Same, at the level's edge (for example, jumping a one-block wall) |

Mark intended gaps with `pit` pieces; unmarked holes are reported. Fall findings
save a replay under `UMBRA_REPLAYS_DIR` that reproduces on a fresh run.

With `GEMINI_API_KEY` set, Gemini plans which tests to run and in what order
(model `GEMINI_MODEL`, default `gemini-3.5-flash-lite`; check the free-tier list on
Google's pricing page). Put the key in your shell or in a repo-root `.env`
(git-ignored), for example `GEMINI_API_KEY=...`; shell variables win. Its JSON
plan is schema-checked and may only name goals in the scene. It only sets the
order: any goal or fall check it leaves out still runs, after its picks. Without a
key, or if the Gemini call fails, the default plan runs. `haunt` uses the same
planner. Softlock and
trivial-skip checks are not implemented yet.

## Builder, Fixer and the agent loop

```sh
pnpm --silent --filter @umbra/agents haunt "A crypt corridor: jump a gap, then climb a ledge." crypt
pnpm --filter @umbra/lantern dev   # then open http://127.0.0.1:5173/?scene=crypt
```

A bare name like `crypt` writes `games/lantern/public/levels/crypt.json`, which
Lantern plays at `?scene=crypt`. A path ending in `.json` writes there instead.

Needs `GEMINI_API_KEY`. The Builder asks Gemini for a small blueprint (floor
rectangles with heights, pits, moving platforms, spawn, exit), compiles it to kit
pieces with a two-high wall ring, and feeds compile errors back until it is valid
(3 attempts). The Playtester then runs, and the Fixer handles each finding: Gemini
proposes up to 12 edits (`add_floor`, `add_wall`, `remove`), and an edit is kept
only if a full playtest no longer reproduces the bug and finds nothing new. There
is no add-pit edit, so a hole cannot be fixed by marking it intended. The CLI
writes the scene, prints the build, fixes and unresolved findings, and exits 1 if
any remain.

## Studio

```sh
pnpm --filter @umbra/studio dev
```

A browser replay viewer. It re-simulates a replay with the real engine, compares
the final state hash with the saved one (a green badge means the run reproduced
exactly), and plays it back in 3D with an orbit camera, the player's path as a
trail, a scrubber, speed control and a clickable event list. Space plays or pauses;
the arrow keys step one tick. Open a replay with the file button, by dropping a JSON
file, or with `?replay=<url>`. Replay files are validated before they run.

**Fix view.** Each fix the agent loop accepts also yields an `umbra-fix` file with
two replays: before and after the Fixer's edit. Studio re-simulates and hash-checks
both, shows Before/After buttons and the edit list, and outlines edited cells
(green added, red removed). A fall replays the same inputs on both scenes, so the
fixed run visibly stays up; an unreachable goal shows the player idle before and a
found route after. `haunt` writes these to `apps/studio/public/fixes/` and prints
each one's `?replay=/fixes/...` query.

Bundled samples live in `apps/studio/public/replays/` (a win on each Lantern level,
a Playtester fall-through finding, and its fix). Regenerate them with
`pnpm --filter @umbra/studio samples`. Replays saved by the Playtester carry the
finding as their `note`, which Studio shows.

## Benchmark

`benchmark/` measures how well a detector finds level bugs: 16 generated Lantern
levels with a verified winning route, and 80 copies each carrying one planted bug
(three kinds of unreachable exit, a missing floor tile, a side wall low enough to
jump). Method and caveats: [`benchmark/README.md`](benchmark/README.md).

```sh
pnpm --filter @umbra/benchmark bench
```

| Detector | Planted bugs found | Clean levels flagged | Median time / level |
| --- | --- | --- | --- |
| Playtester | 80/80 | 0/16 | 4.9 s |
| Random input, 300 runs | 65/80 | 16/16 | 33.3 s |
| Navmesh path only | 48/80 | 16/16 | 0.0 s |

## Rendering

The engine draws but never owns a game's look; every view only reads sim state, so a
run hashes the same however it is drawn.

| Import | Views |
| --- | --- |
| `@umbra/engine` | Canvas 2D: `drawSceneSide` (side view of a kit scene) and `drawGridTop` (top-down tile grid), with `centerView`, `fitView`, `toWorld` |
| `@umbra/engine/three` | Three.js: `kitSceneView` (blocks, pits, platforms, crates, goals; `update()` per frame) and `gridView` (tile boxes with pickable floors) |

Materials, lights, cameras and characters stay in each game: Lantern adds its lantern
light and fog, Studio its trail and Fixer outlines, Boo & Co. its ghosts and visitors.

## Layout and current scope

| Path | Purpose |
| --- | --- |
| `packages/engine` | Physics, scene schema, replay loop, hashing, navigation, 2D and Three.js views |
| `packages/agents` | Typed scene, simulation, replay, and navigation tools |
| `games/lantern` | Playable Three.js level |
| `games/boo-and-co` | Playable haunted-mansion management sim |
| `apps/studio` | Replay viewer |
| `benchmark` | Seeded-bug benchmark: 96 levels with known answers, detector scores |
| `.kiro` | Specs, steering, and hooks |

Lantern's levels are `games/lantern/src/level.json` and `level-2.json`. The headless test proves a
specific input sequence can win it. The older benchmark scene is separate and
is schema-checked, not claimed to be playable.

Ramps and stairs currently behave as cubes. Moving platforms shuttle along one
axis (`props: { axis, distance, speed }`, validated by the scene schema) on a
tick-based path and carry the player standing on them. The carry is not
collision-checked, so keep walls off platform paths. Navmesh bakes exclude
platforms, and `searchReach` does not wait for them.
Crates (`crate`) are dynamic 0.9 m boxes with locked rotation: walking into one pushes
it, and the player can stand on it. Navmesh bakes and `searchReach` ignore crates.
Lantern level 1 has one beside the spawn.
All goal kinds currently behave as collectable sensors, and reaching every goal
wins. Keys, doors, and hazards do not yet have separate rules. The seed argument
is retained for replays but the simulation currently has no random systems.
`searchReach(scene, goalId, budget)` treats `budget` as the maximum number of sim runs.
It follows the navmesh route (or a straight line) and tries, in order: no jump, held
jump, edge jumps (jump when the ground ahead drops away or rises one block, which
crosses any number of gaps), one ride per moving platform, then one jump at each tick
offset. It only reports a route a fresh `runSim` reproduces. Edge jumps are not
combined with platform rides. Stacked solid blocks in one column are merged into a
single collider so the player cannot climb walls on the seams. Boo & Co. replays are not
yet viewable in Studio. Use the targeted Lantern commands above; other apps are still stubs.

Rapier is pinned to 0.12.0. Goal collision fixes and hashing sim state outside Rapier change simulation hashes from
earlier commits even though the Rapier version is unchanged; regenerate earlier
expected hashes before comparing replays across those commits.
