import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MansionSchema, runMansion } from "@umbra/engine";
import { playtestMansion, searchStrategy } from "./strategy.js";

const game = MansionSchema.parse(JSON.parse(readFileSync(new URL("../../../games/boo-and-co/src/mansion.json", import.meta.url), "utf8")));

it("finds no balance bugs in the shipped mansion, and its quota needs mixed builds", () => {
  const { findings, strategy } = playtestMansion(game);
  expect(findings).toEqual([]);
  expect(strategy.quotaReachable).toBe(true);
  expect(strategy.bestByPool.ghost.scares).toBeLessThan(game.quota);
  expect(strategy.bestByPool.trap.scares).toBeLessThan(game.quota);
  // The best plan reproduces its score on a fresh run.
  expect(runMansion(game, strategy.best.plan).scares).toBe(strategy.best.scares);
}, 60_000);

it("reports an unwinnable quota", () => {
  const { findings } = playtestMansion({ ...game, quota: 1000 }, { budget: 150 });
  expect(findings.map((f) => f.type)).toEqual(["unwinnable_quota"]);
});

it("reports a dominant strategy when one trap is far too strong", () => {
  const { findings } = playtestMansion({ ...game, catalog: { trap: { scare: 6 } } }, { budget: 300 });
  expect(findings).toMatchObject([{ type: "dominant_strategy", kind: "trap" }]);
});

it("reports a crowd deadlock in a one-wide hallway, with a plan that reproduces it", () => {
  const hall = MansionSchema.parse({ ...game, name: "Hall", quota: 20, tiles: ["##############", "E............X", "##############"] });
  const { findings } = playtestMansion(hall, { budget: 60 });
  const jam = findings.find((f) => f.type === "crowd_deadlock");
  expect(jam?.plan?.length).toBeGreaterThan(0);
  expect(runMansion(hall, jam!.plan!).deadlocked).toBeGreaterThan(0);
});

it("is deterministic for a given seed", () => {
  const a = searchStrategy(game, { budget: 60, seed: 3 });
  const b = searchStrategy(game, { budget: 60, seed: 3 });
  expect(a.best).toEqual(b.best);
  expect(a.runs).toBe(60);
});
