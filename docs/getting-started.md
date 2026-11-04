# Getting started

Umbra games are plain data plus systems. A game definition says what a level and an input
look like, which components exist, how to build the starting world, which systems run each
tick and when the game ends. The engine runs it one fixed tick at a time and hashes the
state after every tick, so the same level, seed and inputs always give the same run, in
Node and in every browser.

```sh
npm install umbra-engine
```

## Your first game

A dodge game: the player moves left and right along a line, rocks fall from random
columns, and surviving 300 ticks wins.

```ts
import { defineComponent, defineEvent, defineGame, defineResource, runGame, z } from "umbra-engine";

// Components: named data on entities, checked by a Zod schema whenever they are set.
const Player = defineComponent("player", z.object({ x: z.number().int() }));
const Rock = defineComponent("rock", z.object({ x: z.number().int(), y: z.number().int() }));
// A resource: one value per world.
const Dodged = defineResource("dodged", z.number().int(), () => 0);
// An event: data a system emits during a tick, for later systems and the caller.
const Hit = defineEvent("hit", z.object({ x: z.number().int() }));

const dodge = defineGame({
  name: "dodge",
  version: "1",
  // Every tick gets one input. It is validated, so agents can send it safely.
  input: z.enum(["left", "right", "stay"]),
  level: z.object({ width: z.number().int().min(3), survive: z.number().int().min(1) }),
  components: [Player, Rock],
  resources: [Dodged],
  events: [Hit],
  setup(world, level) {
    world.spawn(Player({ x: Math.floor(level.width / 2) }));
  },
  systems: [
    function move(world, input, level) {
      for (const [, p] of world.query(Player)) {
        p.x = Math.min(level.width - 1, Math.max(0, p.x + (input === "left" ? -1 : input === "right" ? 1 : 0)));
      }
    },
    function rocks(world, _input, level) {
      for (const [e, r] of world.query(Rock)) {
        r.y -= 1;
        if (r.y < 0) { world.despawn(e); world.setResource(Dodged, world.resource(Dodged) + 1); }
      }
      // world.rng is the only randomness a game may use: seeded, and part of the hash.
      if (world.tick % 4 === 0) world.spawn(Rock({ x: world.rng.int(level.width), y: 8 }));
    },
    function collide(world) {
      const [, p] = world.first(Player)!;
      for (const [, r] of world.query(Rock)) if (r.y === 0 && r.x === p.x) world.emit(Hit, { x: r.x });
    },
  ],
  // After each tick: a string ends the run.
  outcome(world, level) {
    if (world.events(Hit).length) return "lose";
    return world.tick >= level.survive ? "win" : undefined;
  },
});

const level = { width: 5, survive: 300 };
const r = await runGame(dodge, level, { seed: 7, inputs: Array(300).fill("stay") });
console.log(r.outcome, r.ticks, r.finalStateHash); // standing still gets hit, on the same tick every time
```

The pieces:

| Piece | What it is |
| --- | --- |
| Entity | An integer id, from 1 up, never reused |
| Component | Named, schema-checked data on an entity. `world.get` returns the stored value, which systems may change in place |
| Resource | One value per world: a score, a clock, settings |
| Event | Emitted by a system during a tick; later systems read it with `world.events(type)`, and `step` returns them |
| System | A function run every tick. Systems run in phase order (`input`, `update`, `physics`, `late`), then in the order listed |
| Outcome | Checked after each tick; any string ends the run |
| Plugin | An optional module (2D or 3D physics) that adds components, systems and its own hashed state |

## Running a game

`runGame` plays a list of inputs headlessly. `createGame` gives you a run to step yourself,
which is what agents, tests and the browser loop do:

```ts
import { createGame, defineComponent, defineGame, z } from "umbra-engine";

const Count = defineComponent("count", z.number().int());
const counter = defineGame({
  name: "counter",
  input: z.number().int(),
  components: [Count],
  setup: (w) => { w.spawn(Count(0)); },
  systems: [function add(w, n) { const [e, c] = w.first(Count)!; w.set(e, Count, c + n); }],
  outcome: (w) => (w.first(Count)![1] >= 10 ? "win" : undefined),
});

const run = await createGame(counter, null, { seed: 0 });
run.step(4);
const checkpoint = run.save();   // the whole state: world, plugins, outcome
run.step(6);
console.log(run.outcome);        // "win"
run.load(checkpoint);            // back to tick 1, exactly (the hash is checked)
run.step(1);
console.log(run.tick, run.outcome, run.world.first(Count)![1]); // 2 undefined 5
run.dispose();
```

Checkpoints are what make search cheap: an agent saves once and tries many branches from
there instead of re-running from tick 0.

## Replays

A replay is the level, the seed and the inputs, plus the hash they must reproduce.
`verifyReplay` re-runs one (replay files are untrusted, so it validates them first):

```ts
import { defineGame, defineResource, recordReplay, verifyReplay, z } from "umbra-engine";

const Heads = defineResource("heads", z.number().int(), () => 0);
const coin = defineGame({
  name: "coin-flips",
  input: z.null(),
  resources: [Heads],
  systems: [function flip(w) { if (w.rng.chance(0.5)) w.setResource(Heads, w.resource(Heads) + 1); }],
  outcome: (w) => (w.tick >= 20 ? "done" : undefined),
});

const replay = await recordReplay(coin, null, { seed: 42, inputs: Array(20).fill(null) });
console.log(JSON.stringify(replay).length < 500, (await verifyReplay(coin, replay)).reason); // "reproduced exactly · hash …"
```

Bump the game's `version` when a change alters runs; `verifyReplay` then tells a stale
replay apart from a broken one. [Studio](../apps/studio) plays replays back with a scrubber.

## Scene files

Levels can be data too: a scene file lists entities and their components as JSON, with
prefabs for shared defaults. Every component is checked by its schema, and a bad file
leaves the world unchanged:

```ts
import { World, defineComponent, saveScene, spawnScene, z } from "umbra-engine";

const Hp = defineComponent("hp", z.number().int().min(0));
const Pos = defineComponent("pos", z.object({ x: z.number(), y: z.number() }));
const world = new World({ seed: 0, components: [Hp, Pos] });

spawnScene(world, {
  entities: [
    { prefab: "goblin", components: { pos: { x: 3 } } },  // y comes from the prefab
    { components: { hp: 1, pos: { x: 0, y: 0 } } },
  ],
}, { goblin: { hp: 5, pos: { x: 0, y: 2 } } });

console.log(world.get(1, Pos), saveScene(world).entities.length); // { x: 3, y: 2 } 2
```

## What to read next

- [In the browser](browser.md): the game loop, input, 3D and 2D drawing, models, sound.
- [Physics](physics.md): 3D and 2D bodies, characters, sensors, navigation.
- [Agents](agents.md): search, playtesting and MCP tools for your game.
- [Determinism](determinism.md): the rules that keep replays exact, and how to debug a divergence.
- [Examples](../packages/engine/examples): snake, collect, room and hop, each with tests.
