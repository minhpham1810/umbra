import { expect, it } from "vitest";
import { playtestBalance, searchStrategy, type Build, type PlanGame } from "./strategy.js";

/**
 * A toy build game on a 4×4 grid: each build scores `power` per build of its kind, so
 * mixing kinds matters only through the weights. A build on the hallway cell (0, 0)
 * leaves one unit stuck.
 */
function toy(opts: { power?: Record<"a" | "b", number>; quota?: number } = {}): PlanGame<"a" | "b"> {
  const power = opts.power ?? { a: 3, b: 3 };
  const cells = Array.from({ length: 16 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) }));
  return {
    kinds: ["a", "b"], cells, budget: 30, quota: opts.quota ?? 20,
    cost: (k) => (k === "a" ? 10 : 5),
    run: (plan: readonly Build<"a" | "b">[]) => {
      const n = (k: "a" | "b") => plan.filter((p) => p.kind === k).length;
      // Mixing pays: each pair of different kinds adds a bonus.
      const score = n("a") * power.a + n("b") * power.b + 4 * Math.min(n("a"), n("b"));
      return { score, stuck: plan.some((p) => p.x === 0 && p.y === 0) ? 1 : 0, spent: plan.reduce((s, p) => s + (p.kind === "a" ? 10 : 5), 0) };
    },
  };
}

it("finds the best plan and keeps the search deterministic per seed", () => {
  const a = searchStrategy(toy(), { budget: 90, seed: 3 });
  expect(a.runs).toBe(90);
  expect(Object.keys(a.bestByPool).sort()).toEqual(["a", "b", "mixed"]);
  expect(a.best.score).toBeGreaterThanOrEqual(a.bestByPool["b"]!.score);
  expect(searchStrategy(toy(), { budget: 90, seed: 3 }).best).toEqual(a.best);
});

it("reports an unwinnable quota", () => {
  const { findings } = playtestBalance(toy({ quota: 1000 }), { budget: 60 });
  expect(findings.map((f) => f.type)).toContain("unwinnable_quota");
});

it("reports a dominant kind when one build is far too strong", () => {
  const { findings } = playtestBalance(toy({ power: { a: 3, b: 40 } }), { budget: 150 });
  expect(findings).toContainEqual(expect.objectContaining({ type: "dominant_strategy", kind: "b" }));
});

it("reports stuck units with a plan that reproduces them", () => {
  const game = toy();
  const { findings } = playtestBalance(game, { budget: 150 });
  const jam = findings.find((f) => f.type === "crowd_deadlock");
  expect(jam?.plan?.some((p) => p.x === 0 && p.y === 0)).toBe(true);
  expect(game.run(jam!.plan!).stuck).toBe(1);
});
