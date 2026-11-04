import { expect, it } from "vitest";
import { createGame, recordReplay, verifyReplay } from "../../src/index.js";
import { collect, seekCoin, type CollectInput } from "./collect.js";

const level = { w: 8, h: 5, goal: 5 };

it("a coin-seeking player wins, and the session replays exactly", async () => {
  const run = await createGame(collect, level, { seed: 3 });
  const inputs: CollectInput[] = [];
  const events: string[] = [];
  while (run.outcome === undefined && run.tick < 2000) {
    const input = seekCoin(run.world);
    inputs.push(input);
    events.push(...run.step(input).map((e) => e.type));
  }
  expect(run.outcome).toBe("win");
  expect(events.filter((t) => t === "collected")).toHaveLength(5);
  const replay = await recordReplay(collect, level, { seed: 3, inputs });
  expect(replay.finalStateHash).toBe(run.hash);
  expect((await verifyReplay(collect, replay)).ok).toBe(true);
  run.dispose();
});

it("sprites and the score text are presentation: the hash ignores them", async () => {
  const a = await createGame(collect, level, { seed: 1 });
  const b = await createGame(collect, level, { seed: 1 });
  const { Sprite } = await import("../../src/index.js");
  for (const [, s] of b.world.query(Sprite)) s.color = "#000000";
  a.step({ x: 1, y: 0 }); b.step({ x: 1, y: 0 });
  expect(a.hash).toBe(b.hash);
  a.dispose(); b.dispose();
});
