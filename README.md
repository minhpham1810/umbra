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
| N (after a win) | Next level |

Level 1: jump the broken floor. Level 2: ride the moving platform across the chasm.
Open a level directly with `?level=2`. Falling ends the run.
Keyboard controls work without mouse capture. A desktop browser with WebGL
and a keyboard is required; touch controls are not implemented.

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
arrivals; the HUD counts stuck visitors.

The simulation (`packages/engine/src/mansion`) is integer-only on a grid with one
visitor per cell, instead of the navmesh crowds in the design, so it is
deterministic in every browser. The mansion is `games/boo-and-co/src/mansion.json`.
Its quota (140) needs both build kinds: the strategy search's best ghost-only and
trap-only plans reach about 113 scares, mixed plans about 160.

### Balance playtest

```sh
pnpm --silent --filter @umbra/agents playtest games/boo-and-co/src/mansion.json
```

For a mansion file, the Playtester runs `searchStrategy` (also the `search.strategy`
MCP tool): about 600 simulated days across ghost-only, trap-only and mixed plans,
random restarts then hill climbing, with a fixed seed. It reports:

| Bug type | Meaning |
| --- | --- |
| `unwinnable_quota` | No plan found reaches the quota |
| `dominant_strategy` | A single-kind plan beats every plan using the other kind by over 10% |
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
pnpm --silent --filter @umbra/agents mcp
```

Serves the agent tools over stdio: `scene.validate`, `scene.write`, `nav.bake`,
`nav.path`, `sim.run`, `sim.observe`, `search.reach`, `replay.save`. Kiro picks it
up from `.kiro/settings/mcp.json`. Any MCP client can launch the same command.
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
| `unreachable_goal` | `searchTarget` fails to reach the goal (walk, held jump, edge jumps over any number of gaps, platform rides, jump timings) |
| `fall_through` | Walking into an unmarked hole inside the level ends out of bounds in that cell |
| `out_of_bounds` | Same, at the level's edge (for example, jumping a one-block wall) |

Mark intended gaps with `pit` pieces; unmarked holes are reported. Fall findings
save a replay under `UMBRA_REPLAYS_DIR` that reproduces on a fresh run.

With `GEMINI_API_KEY` set, Gemini plans which tests to run and in what order
(model `GEMINI_MODEL`, default `gemini-3.5-flash-lite`; check the free-tier list on
Google's pricing page). Put the key in your shell or in a repo-root `.env`
(git-ignored), for example `GEMINI_API_KEY=...`; shell variables win. Its JSON
plan is schema-checked and may only name goals in the scene. Without a key, or if
the Gemini call fails, every goal and the fall check run. Softlock and
trivial-skip checks are not implemented yet.

## Builder, Fixer and the agent loop

```sh
pnpm --silent --filter @umbra/agents haunt "A crypt corridor: jump a gap, then climb a ledge." level.json
```

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

Bundled samples live in `apps/studio/public/replays/` (a win on each Lantern level
and a Playtester fall-through finding). Regenerate them with
`pnpm --filter @umbra/studio samples`. Replays saved by the Playtester carry the
finding as their `note`, which Studio shows.

## Layout and current scope

| Path | Purpose |
| --- | --- |
| `packages/engine` | Physics, scene schema, replay loop, hashing, navigation |
| `packages/agents` | Typed scene, simulation, replay, and navigation tools |
| `games/lantern` | Playable Three.js level |
| `games/boo-and-co` | Playable haunted-mansion management sim |
| `apps/studio` | Replay viewer |
| `benchmark` | Seed scenes and mutation stub |
| `.kiro` | Specs, steering, and hooks |

Lantern's levels are `games/lantern/src/level.json` and `level-2.json`. The headless test proves a
specific input sequence can win it. The older benchmark scene is separate and
is schema-checked, not claimed to be playable.

Ramps and stairs currently behave as cubes. Moving platforms shuttle along one
axis (`props: { axis, distance, speed }`, validated by the scene schema) on a
tick-based path and carry the player standing on them. The carry is not
collision-checked, so keep walls off platform paths. Navmesh bakes exclude
platforms, and `searchReach` does not wait for them.
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

Rapier is pinned to 0.12.0. Goal collision fixes change simulation hashes from
earlier commits even though the Rapier version is unchanged; regenerate earlier
expected hashes before comparing replays across those commits.
