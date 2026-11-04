import { expect, it } from "vitest";
import { Transform, createGame, recordReplay, runGame, verifyReplay } from "../../src/index.js";
import { Hero, hop, type HopInput } from "./hop.js";

it("runs and jumps to the flag, and the run replays exactly", async () => {
  // A simple player: run right, and jump when close to a platform's edge (x = 6, 12, 18).
  const run = await createGame(hop, null);
  const inputs: HopInput[] = [];
  while (run.outcome === undefined && run.tick < 900) {
    const x = run.world.first(Hero, Transform)![2].position.x;
    const input = { x: 1, jump: [6, 12, 18].some((edge) => x > edge - 0.7 && x < edge) };
    inputs.push(input);
    run.step(input);
  }
  expect(run.outcome).toBe("win");
  run.dispose();
  const replay = await recordReplay(hop, null, { inputs });
  expect((await verifyReplay(hop, replay)).ok).toBe(true);
});

it("falls into the first gap without jumping", async () => {
  expect((await runGame(hop, null, { inputs: Array.from({ length: 400 }, () => ({ x: 1, jump: false })) })).outcome).toBe("fell");
});
