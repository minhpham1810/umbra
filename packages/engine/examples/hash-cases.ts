// Core examples for the browser-vs-Node hash check:
// `pnpm --filter umbra-engine browser-hash-check --with packages/engine/examples/hash-cases.ts`.
import { runGame } from "../src/index.js";
import { snake, type SnakeInput } from "./snake/snake.js";

const turns: SnakeInput[] = ["down", null, null, "right", null, "up", null, null, null, "right", "down", null, "left"];
const level = { width: 12, height: 12, goal: 50 };

export const cases = [1, 2, 3].map((seed) => ({
  name: `examples/snake seed ${seed}`,
  run: async () => (await runGame(snake, level, { seed, inputs: turns })).finalStateHash,
}));
