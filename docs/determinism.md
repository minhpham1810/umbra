# Determinism

A run is decided by three things: the level, the seed and the inputs. Everything else must
be derived from them, the same way on every machine and every JavaScript engine. The
engine checks this after every tick with a state hash, so a broken rule shows up as a
replay that no longer reproduces.

## Rules for game code

1. **Randomness comes from `world.rng`.** It is seeded from the run's seed and its state is
   hashed and checkpointed. Never `Math.random()`.
2. **No clocks.** `Date.now()` and `performance.now()` differ between runs. Count ticks
   instead (`world.tick`, at a fixed rate).
3. **No engine-dependent math.** `Math.sin`, `cos`, `tan`, `atan2`, `exp`, `log`, `pow` and
   their relatives (including `Math.hypot` and `Math.cbrt`) may differ in the last bit
   between Chrome, Firefox, Safari and Node. Basic arithmetic (`+ − × ÷`), `Math.sqrt`,
   `abs`, `min`, `max`, `floor`, `ceil`, `round` and `trunc` are exact everywhere. For 2D
   rotations use `rotationZ(angle)` and `angleZ(rotation)`, which use only those.
4. **All state lives in the world.** Components, resources and plugin state are hashed and
   checkpointed; a variable in a closure or a module is neither. If a system needs memory,
   give it a resource.
5. **Order what you iterate.** `world.query` and `world.entities()` are in ascending id
   order. If you keep your own `Map` or `Set`, sort before iterating results into the world,
   and never sort with `localeCompare` (it depends on the locale).
6. **Presentation is one-way.** Systems may write `Mesh`, `Sprite`, `Camera` and other
   presentation components, but must not read them to decide anything: they are not hashed.
7. **Bump `version`** when you change a game in a way that alters runs, so old replays are
   reported as stale rather than broken.

## What the engine guarantees

| | |
| --- | --- |
| Fixed step | One `step(input)` is one tick; physics steps exactly once per tick at a fixed `dt` |
| Ordered construction | Physics bodies are built, rebuilt and removed in ascending entity order |
| Pinned physics | Rapier 2D and 3D are pinned to 0.12.0 in the lockfile |
| Validated inputs | Every input, level, component and replay is checked by its schema |
| A hash per tick | The world (tick, ids, rng, components, resources) and each plugin's state, after every tick |
| Exact checkpoints | `load` re-hashes and throws if the state did not restore exactly |

## How this repository checks it

- **Lint.** `pnpm lint` bans `Math.random`, `Math.sin` and friends, `Date` and `performance`
  in the engine's simulation code (`core`, `physics2d`, `physics3d`, `spatial`, and the
  kit-scene runtime) and in Boo & Co.'s simulation. Add your own game's simulation folder to
  the same rule in [`eslint.config.mjs`](https://github.com/minhpham1810/umbra/blob/main/eslint.config.mjs).
- **Property tests.** Random input sequences run twice must give identical hashes.
- **Saved replays.** `pnpm --filter umbra-engine determinism-check` re-runs every saved
  replay twice and compares against its stored hash.
- **Node against a browser.** `browser-hash-check` runs the same cases in Node and headless
  Chromium and compares every hash.
- **Agents.** `playtestGame` reports `nondeterministic` and `checkpoint_mismatch` findings
  with the inputs that show them (see [Agents](agents.md)).

## Debugging a divergence

When a replay stops reproducing:

1. Run it twice in the same process. If those differ, something non-deterministic is in
   the game: `playtestGame` finds the first tick where two runs differ.
2. If two runs agree with each other but not with the saved hash, the game changed since
   the replay was recorded. Bump `version` if the change was intended.
3. If Node and the browser differ, look for engine-dependent math or locale-dependent code.
4. Compare `tickHashes` from `runGame` to find the first differing tick, then
   `observeAt` that tick in both runs and diff the JSON.

```ts
import { defineGame, defineResource, runGame, z } from "umbra-engine";

const Total = defineResource("total", z.number(), () => 0);
const flaky = defineGame({
  name: "flaky",
  input: z.null(),
  resources: [Total],
  // Math.random breaks rule 1: two runs of the same replay disagree.
  systems: [function add(w) { w.setResource(Total, w.resource(Total) + (Math.random() < 0.5 ? 1 : 2)); }],
});

const inputs = Array(50).fill(null);
const [a, b] = [await runGame(flaky, null, { inputs }), await runGame(flaky, null, { inputs })];
const first = a.tickHashes.findIndex((h, i) => h !== b.tickHashes[i]);
console.log(first >= 0); // true: the runs part ways at tick first + 1
```
