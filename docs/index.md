---
layout: home
hero:
  name: Umbra
  text: A deterministic game engine for AI agents
  image:
    src: /favicon.svg
    alt: Umbra
  tagline: 2D and 3D games in TypeScript. The same level, seed and inputs give the same run, tick for tick, in Node and in every browser, so every run is a replay an agent can save, share and check.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Play the examples
      link: https://minhpham1810.github.io/umbra/playground/
    - theme: alt
      text: GitHub
      link: https://github.com/minhpham1810/umbra
features:
  - title: Games as data and systems
    details: Components with Zod schemas, resources, events, systems in phases and a seeded RNG. Levels, inputs and replays are validated JSON.
  - title: Proof every tick
    details: A state hash after every tick, exact checkpoints, and replays that reproduce in Node and in Chrome, Firefox and Safari.
  - title: 2D and 3D physics
    details: Rapier plugins for both, with characters, sensors and ray casts, all hashed and checkpointed. glTF models become colliders headlessly.
  - title: Agents that play your game
    details: Beam search from checkpoints, a playtester that finds crashes, nondeterminism and unreachable outcomes, and an MCP server for any game.
  - title: Draw it any way
    details: Mesh, Sprite, Camera and Light components that are saved but never hashed, drawn by Three.js or Canvas 2D, with a fixed-tick browser loop and event sounds.
  - title: Replays you can watch
    details: Studio re-runs any replay, checks its hash and scrubs through it tick by tick.
---

## Five minutes

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

Then read [Getting started](/getting-started), or open the [playground](https://minhpham1810.github.io/umbra/playground/)
to play the 3D room, the 2D collect game and the 2D physics platformer in your browser.
