// Core examples for the browser-vs-Node hash check:
// `pnpm --filter umbra-engine browser-hash-check --with packages/engine/examples/hash-cases.ts`.
import { runGame } from "../src/index.js";
import { snake, type SnakeInput } from "./snake/snake.js";
import { room, type RoomInput } from "./room/room.js";
import { collect, type CollectInput } from "./collect/collect.js";

const turns: SnakeInput[] = ["down", null, null, "right", null, "up", null, null, null, "right", "down", null, "left"];
const level = { width: 12, height: 12, goal: 50 };

// The room's route, plus pseudo-random wandering, through physics with a pushed crate.
const hold = (n: number, i: Partial<RoomInput>): RoomInput[] => Array.from({ length: n }, () => ({ x: 0, z: 0, jump: false, ...i }));
const route = [...hold(70, { z: 1 }), ...hold(10, { z: 1, jump: true }), ...hold(60, { z: 1 }), ...hold(10, { z: 1, jump: true }), ...hold(60, { z: 1 })];
let s = 7;
const wander: RoomInput[] = Array.from({ length: 400 }, () => {
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  return { x: (s % 3) - 1, z: ((s >>> 8) % 3) - 1, jump: ((s >>> 16) & 7) === 0 };
});

export const cases = [
  ...[1, 2, 3].map((seed) => ({
    name: `examples/snake seed ${seed}`,
    run: async () => (await runGame(snake, level, { seed, inputs: turns })).finalStateHash,
  })),
  { name: "examples/room route", run: async () => (await runGame(room, null, { inputs: route })).finalStateHash },
  { name: "examples/room wander", run: async () => (await runGame(room, null, { inputs: wander })).finalStateHash },
  { name: "examples/collect wander", run: async () => (await runGame(collect, { w: 8, h: 5, goal: 50 }, { seed: 4, inputs: wander.map((i): CollectInput => ({ x: i.x, y: i.z })) })).finalStateHash },
];
