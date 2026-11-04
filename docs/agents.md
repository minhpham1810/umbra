# Agents

[`umbra-agents`](https://www.npmjs.com/package/umbra-agents) plays and tests any game made
with `defineGame`. Because runs are deterministic and checkpoints restore exactly, an agent
can branch from any state, and every result comes with inputs that reproduce it.

```sh
npm install umbra-agents umbra-engine
```

## Describe your game to agents

An `AgentGame` is the game, the moves a search may make, and optionally a score that says
which states look closer to winning. `hold` repeats each move for a few ticks, so searches
reach further for the same cost.

```ts
import { defineComponent, defineGame, z } from "umbra-engine";
import { playtestGame, searchOutcome, type AgentGame } from "umbra-agents";

const Pos = defineComponent("pos", z.object({ x: z.number().int(), y: z.number().int() }));
const Input = z.object({ dx: z.number().int().min(-1).max(1), dy: z.number().int().min(-1).max(1) });

// Walk a 10×10 grid from (0, 0) to (9, 9), avoiding the wall at x = 5 except at y = 8.
const maze = defineGame({
  name: "maze",
  input: Input,
  components: [Pos],
  setup: (w) => { w.spawn(Pos({ x: 0, y: 0 })); },
  systems: [function move(w, i) {
    const [e, p] = w.first(Pos)!;
    const next = { x: Math.min(9, Math.max(0, p.x + i.dx)), y: Math.min(9, Math.max(0, p.y + i.dy)) };
    if (next.x !== 5 || next.y === 8) w.set(e, Pos, next);
  }],
  outcome: (w) => { const [, p] = w.first(Pos)!; return p.x === 9 && p.y === 9 ? "win" : w.tick >= 200 ? "timeout" : undefined; },
});

const agent: AgentGame<z.infer<typeof Input>> = {
  game: maze,
  moves: [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }],
  score: (w) => { const [, p] = w.first(Pos)!; return p.x + p.y; },
};

const route = await searchOutcome(agent, null, { target: "win" });
console.log(route.found, route.inputs.length);         // true, and a short route through the gap

const report = await playtestGame(agent, null, { expect: ["win"] });
console.log(report.findings, report.reached.length);   // [] 1: no bugs, and a replay that proves the win
```

`searchOutcome` is a beam search: from each kept state it tries every move from a
checkpoint, keeps the best-scoring new states (`beam`, default 8) and repeats. Without a
score it explores at random. Routes are re-run from scratch before they are returned, so a
found route is a proof. A failed search is bounded, not a proof that the outcome is
impossible.

## Playtesting

`playtestGame` plays a level at random a few times, then searches for each expected
outcome, and reports:

| Finding | Meaning |
| --- | --- |
| `crash` | A system threw. `inputs` reproduce it |
| `nondeterministic` | The same seed and inputs gave a different state: something other than `world.rng` and the inputs decides the game |
| `checkpoint_mismatch` | Restoring a checkpoint and replaying diverged: some state lives outside the world (a closure variable, module state) |
| `unreachable_outcome` | No route to an expected outcome within the budget |

```ts
import { defineComponent, defineGame, z } from "umbra-engine";
import { playtestGame } from "umbra-agents";

const N = defineComponent("n", z.number());
let calls = 0; // state outside the world: checkpoints cannot restore it
const leaky = defineGame({
  name: "leaky",
  input: z.number().int(),
  components: [N],
  setup: (w) => { w.spawn(N(0)); },
  systems: [function add(w, i) { calls++; const [e, n] = w.first(N)!; w.set(e, N, n + i + (calls % 7 === 0 ? 1 : 0)); }],
});

const report = await playtestGame({ game: leaky, moves: [0, 1] }, null, { expect: [], fuzzRuns: 2, fuzzTicks: 50 });
console.log(report.findings.map((f) => f.type)); // [ "checkpoint_mismatch", "nondeterministic" ]
```

## Looking at a run

`observeAt` runs to a tick and returns the state as plain JSON, the form a language model
reads best:

```ts
import { defineComponent, defineGame, z } from "umbra-engine";
import { observeAt } from "umbra-agents";

const Hp = defineComponent("hp", z.number().int());
const fight = defineGame({ name: "fight", input: z.number().int(), components: [Hp],
  setup: (w) => { w.spawn(Hp(10)); w.spawn(Hp(8)); },
  systems: [function hit(w, target) { const hp = w.get(target, Hp); if (hp !== undefined) w.set(target, Hp, hp - 3); }] });

const o = await observeAt(fight, null, { inputs: [1, 2, 2], atTick: 3 });
console.log(JSON.stringify(o.entities)); // [{"id":1,"components":{"hp":7}},{"id":2,"components":{"hp":2}}]
```

## MCP

`umbra-mcp --games <module>` serves the tools over stdio for any MCP client (Claude, Kiro,
Cursor). The module exports a list of `AgentGame` as `games` or as its default export:

```sh
npx umbra-mcp --games ./agent-games.js
```

| Tool | Does |
| --- | --- |
| `game.list` | The games, their named levels and search moves |
| `game.run` | Run inputs; returns outcome, ticks, final hash and events |
| `game.observe` | The state at a tick, as JSON |
| `game.search` | Find inputs that reach an outcome |
| `game.playtest` | The playtest above |
| `game.replay.verify` | Check a replay reproduces its hash |

Levels and inputs are checked by each game's own schemas; a string level names one of the
game's `levels`. In code, `createServer({ games })` returns the server.
[`packages/agents/examples/games.ts`](../packages/agents/examples/games.ts) sets up the
engine's examples, and `pnpm --filter umbra-agents mcp --games examples/games.ts` serves
them in this repository.

## Studio

[Studio](../apps/studio) opens replay files (`recordReplay`, `loop.replay()`, the
playtester's `reached` replays), re-runs them, checks the hash and plays them back with a
scrubber, the event list and the game's resources at each tick. Add your game to
[`apps/studio/src/games.ts`](../apps/studio/src/games.ts) to view its replays.
