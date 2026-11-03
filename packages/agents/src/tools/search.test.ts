import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SceneSchema, runSim, type Scene } from "@umbra/engine";
import { searchReach, simObserve } from "./api.js";

const lantern = SceneSchema.parse(JSON.parse(readFileSync(
  new URL("../../../../games/lantern/src/level.json", import.meta.url), "utf8")));

it("finds a replayable route to the Lantern exit across the gap", async () => {
  const result = await searchReach(lantern, "exit", 1000);
  expect(result.reached).toBe(true);
  const replay = await runSim({ scene: lantern, seed: 0, inputs: result.inputs, maxTicks: result.inputs.length });
  expect(replay.outcome).toBe("win");
}, 60_000);

it("reports an exit walled off by 3-high walls as unreachable", async () => {
  const { x, z } = lantern.goals[0]!.pos;
  const walls = [[-1, 0], [1, 0], [0, -1], [0, 1]].flatMap(([dx, dz]) => [1, 2, 3].map((y) =>
    ({ kind: "wall" as const, pos: { x: x + dx!, y, z: z + dz! }, rot: 0 })));
  const walled: Scene = { ...lantern, pieces: [...lantern.pieces, ...walls] };
  const result = await searchReach(walled, "exit", 1000);
  expect(result.reached).toBe(false);
  expect(result.attempts).toBeGreaterThan(2);
}, 120_000);

it("observes the player after walking forward", async () => {
  const inputs = Array.from({ length: 30 }, () => ({ buttons: 1, yaw: 0 }));
  const obs = await simObserve(lantern, 0, inputs, 30);
  expect(obs.tick).toBe(30);
  expect(obs.grounded).toBe(true);
  expect(obs.playerPos.z).toBeGreaterThan(lantern.spawn.pos.z + 2);
  expect(obs.playerVelocity.z).toBeCloseTo(5, 0);
  expect(obs.reachedGoals).toEqual([]);
});

it("rejects an unknown goal", async () => {
  await expect(searchReach(lantern, "nope", 10)).rejects.toThrow("Unknown goal");
});
