# Examples

Small complete games on `umbra-engine`, each with tests that play it to a win and check
its replay. Play them in the browser with `pnpm --filter @umbra/playground dev`.

| Example | Shows | Play |
| --- | --- | --- |
| [`snake`](snake) | The core only: components, resources, events, seeded food, a checkpoint search | headless (tests) |
| [`collect`](collect) | 2D: `Sprite`, `Camera2D`, a text label written by a system, sound on an event | `?game=collect` |
| [`room`](room) | 3D physics: a character, a pushable crate, a sensor goal, `Mesh`, lights and a follow camera | the default page |
| [`hop`](hop) | 2D physics: a platformer character, dynamic crates, a sensor flag, falling as an outcome | `?game=hop` |

[`hash-cases.ts`](hash-cases.ts) runs them for the Node-against-browser hash check, and
[`packages/agents/examples/games.ts`](../../agents/examples/games.ts) sets them up for the
agent tools.
