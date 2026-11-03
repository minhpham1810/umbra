import { expect, it } from "vitest";
import { createGame, recordReplay, runGame, verifyReplay } from "../../src/index.js";
import { Body, Eaten, Food, snake, type SnakeInput } from "./snake.js";

const level = { width: 8, height: 8, goal: 3 };

it("dies at the wall when it never turns", async () => {
  const r = await runGame(snake, level, { seed: 1, inputs: Array<SnakeInput>(20).fill(null) });
  expect(r.outcome).toBe("dead");
  expect(r.ticks).toBe(6); // head starts at x=2 on an 8-wide board
});

it("places the same food for the same seed, and different food for another seed", async () => {
  const food = async (seed: number) => {
    const run = await createGame(snake, level, { seed });
    const f = run.world.first(Food)![1];
    run.dispose();
    return f;
  };
  expect(await food(3)).toEqual(await food(3));
  const seen = new Set(await Promise.all([1, 2, 3, 4, 5, 6].map(async (s) => JSON.stringify(await food(s)))));
  expect(seen.size).toBeGreaterThan(1);
});

/**
 * What an agent does with checkpoints: branch from the current state, try each move a few
 * ticks ahead, keep the best, and never re-run from tick 0.
 */
async function greedyWin(seed: number) {
  const run = await createGame(snake, level, { seed });
  const moves: SnakeInput[] = [];
  const score = () => {
    if (run.outcome === "win") return 1e6;
    if (run.outcome === "dead") return -1e6;
    const [, body] = run.world.first(Body)!;
    const [, food] = run.world.first(Food)!;
    return run.world.resource(Eaten) * 100 - Math.abs(body.cells[0]!.x - food.x) - Math.abs(body.cells[0]!.y - food.y);
  };
  while (run.outcome === undefined && moves.length < 200) {
    const here = run.save();
    let best: { move: SnakeInput; value: number } | undefined;
    for (const move of ["up", "down", "left", "right", null] as const) {
      run.load(here);
      run.step(move);
      const value = score();
      if (!best || value > best.value) best = { move, value };
    }
    run.load(here);
    run.step(best!.move);
    moves.push(best!.move);
  }
  const outcome = run.outcome;
  run.dispose();
  return { outcome, moves };
}

it("lets a search branch from checkpoints, and its route replays exactly", async () => {
  const { outcome, moves } = await greedyWin(11);
  expect(outcome).toBe("win");
  const replay = await recordReplay(snake, level, { seed: 11, inputs: moves });
  expect(await verifyReplay(snake, replay)).toMatchObject({ ok: true });
  expect((await runGame(snake, level, { seed: 11, inputs: moves })).outcome).toBe("win");
});
