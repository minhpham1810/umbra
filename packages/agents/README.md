# umbra-agents

Agent tools for [`umbra-engine`](https://www.npmjs.com/package/umbra-engine): agents
build, play and break levels through typed tools, and every bug comes with a replay.

- **Any game:** `searchOutcome(agent, level)` finds inputs that reach an outcome by beam
  search from checkpoints, and `playtestGame(agent, level)` reports crashes,
  nondeterminism, state kept outside the world, and unreachable outcomes, for any game
  made with `defineGame`. An `AgentGame` lists the game, its moves and an optional score.
- **Kit-scene Playtester:** finds unreachable goals, fall-throughs and out-of-bounds escapes in a
  kit scene. A navmesh check runs first, then a physics proof; each finding reproduces
  on a fresh run.
- **Route search:** `searchReach(scene, goalId, budget)` looks for inputs that reach a
  goal (navmesh route, edge jumps, platform rides, timed jumps).
- **Builder and Fixer:** turn a brief into a level and repair findings with small,
  verified edits (Gemini, via `GEMINI_API_KEY`).
- **Balance search:** `searchStrategy(game)` for any build-placement game, through a
  small `PlanGame` adapter.
- **MCP server:** the same tools for any MCP client.

```sh
npm install umbra-agents umbra-engine
```

```ts
import { SceneSchema } from "umbra-engine";
import { playtest, searchReach } from "umbra-agents";

const scene = SceneSchema.parse({
  pieces: Array.from({ length: 10 }, (_, z) => ({ kind: "floor", pos: { x: 0, y: 0, z } })),
  spawn: { pos: { x: 0.5, y: 1.72, z: 0.5 } },
  goals: [{ id: "exit", kind: "exit", pos: { x: 0, y: 1, z: 9 } }],
});

const route = await searchReach(scene, "exit", 50);
console.log(route.reached, route.inputs.length); // true, and the winning inputs

const report = await playtest(scene, { maxRuns: 100 });
console.log(report.findings); // this corridor has no walls: out_of_bounds findings at its edges
```

Run the MCP server over stdio with `npx umbra-mcp`; `npx umbra-mcp --games ./agent-games.js`
adds the `game.*` tools (run, observe, search, playtest, verify a replay) for the games that
module exports. In code: `createServer({ games })`, and `createServer({ strategy })` for
`search.strategy`.

Docs and examples: [github.com/minhpham1810/umbra](https://github.com/minhpham1810/umbra). MIT licensed.
