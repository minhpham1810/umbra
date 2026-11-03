import { expect, it } from "vitest";
import { playtestBalance, searchStrategy } from "@umbra/agents";
import { mansionGame } from "./balance.js";
import { MansionSchema, runMansion } from "./mansion.js";
import raw from "../mansion.json";

const game = MansionSchema.parse(raw);

it("finds no balance bugs in the shipped mansion, and its quota needs mixed builds", () => {
  const { findings, strategy } = playtestBalance(mansionGame(game));
  expect(findings).toEqual([]);
  expect(strategy.quotaReachable).toBe(true);
  expect(strategy.bestByPool["ghost"]!.score).toBeLessThan(game.quota);
  expect(strategy.bestByPool["trap"]!.score).toBeLessThan(game.quota);
  // The best plan reproduces its score on a fresh run.
  expect(runMansion(game, strategy.best.plan).scares).toBe(strategy.best.score);
}, 60_000);

it("reports an unwinnable quota", () => {
  const { findings } = playtestBalance(mansionGame({ ...game, quota: 1000 }), { budget: 150 });
  expect(findings.map((f) => f.type)).toEqual(["unwinnable_quota"]);
});

it("reports a dominant strategy when one trap is far too strong", () => {
  const { findings } = playtestBalance(mansionGame({ ...game, catalog: { trap: { scare: 6 } } }), { budget: 300 });
  expect(findings).toMatchObject([{ type: "dominant_strategy", kind: "trap" }]);
});

it("reports a crowd deadlock in a one-wide hallway, with a plan that reproduces it", () => {
  const hall = MansionSchema.parse({ ...game, name: "Hall", quota: 20, tiles: ["##############", "E............X", "##############"] });
  const { findings } = playtestBalance(mansionGame(hall), { budget: 60 });
  const jam = findings.find((f) => f.type === "crowd_deadlock");
  expect(jam?.plan?.length).toBeGreaterThan(0);
  expect(runMansion(hall, jam!.plan!).deadlocked).toBeGreaterThan(0);
});

it("is deterministic for a given seed", () => {
  const a = searchStrategy(mansionGame(game), { budget: 60, seed: 3 });
  const b = searchStrategy(mansionGame(game), { budget: 60, seed: 3 });
  expect(a.best).toEqual(b.best);
  expect(a.runs).toBe(60);
});
