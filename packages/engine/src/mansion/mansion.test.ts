import { expect, it } from "vitest";
import fc from "fast-check";
import { MansionSchema, createMansion, runMansion, type Mansion, type Placement } from "./mansion.js";

const base = { budget: 200, quota: 10, durationTicks: 60 * 60, spawnEvery: 90, maxVisitors: 20 };
const narrow: Mansion = MansionSchema.parse({ ...base, name: "Narrow", tiles: ["##############", "E............X", "##############"] });
const wide: Mansion = MansionSchema.parse({ ...base, name: "Wide", tiles: [
  "##############", "#............#", "E............X", "#............#", "##############"] });

it("validates mansions", () => {
  expect(MansionSchema.safeParse({ ...base, tiles: ["###", "#.#", "###"] }).success).toBe(false); // no E or X
  expect(() => createMansion(MansionSchema.parse({ ...base, tiles: ["#####", "E#..X", "#####"] }))).toThrow("not reachable");
});

it("visitors walk through an empty mansion and nobody is scared", () => {
  const r = runMansion(wide, []);
  expect(r.admitted).toBe(20);
  expect(r.exited).toBe(20);
  expect(r.scares).toBe(0);
  expect(r.outcome).toBe("lose");
  expect(r.coins).toBe(200 + 20 * 5);
});

it("ghosts and traps scare visitors, and scared visitors flee", () => {
  const plan: Placement[] = [{ kind: "ghost", x: 4, y: 1, tick: 0 }, { kind: "ghost", x: 9, y: 3, tick: 0 }, { kind: "trap", x: 6, y: 2, tick: 0 }];
  const r = runMansion(wide, plan);
  expect(r.spent).toBe(80);
  expect(r.scares).toBeGreaterThanOrEqual(10);
  expect(r.outcome).toBe("win");
  expect(r.fled).toBeGreaterThan(0);
  expect(r.deadlocked).toBe(0);
});

it("rejects builds off the floor, on a taken cell, or over budget", () => {
  const sim = createMansion({ ...wide, budget: 50 });
  for (const p of [{ kind: "ghost", x: 0, y: 0 }, { kind: "ghost", x: 3, y: 1 }, { kind: "trap", x: 3, y: 1 }, { kind: "ghost", x: 5, y: 1 }] as const) sim.place(p);
  sim.step();
  expect(sim.events.filter((e) => e.kind === "rejected").map((e) => e.kind === "rejected" && e.reason)).toEqual([
    "builds go on floor tiles", "cell already has a build", "not enough coins (20 left, costs 30)"]);
  expect(sim.stats().spent).toBe(30);
});

it("a ghost in a one-wide hallway causes a crowd deadlock; a wide hall does not", () => {
  const ghost: Placement[] = [{ kind: "ghost", x: 7, y: 1, tick: 0 }];
  const jam = runMansion(narrow, ghost);
  expect(jam.deadlocked).toBeGreaterThan(0);
  expect(jam.events.some((e) => e.kind === "deadlock")).toBe(true);
  expect(runMansion(wide, [{ kind: "ghost", x: 7, y: 2, tick: 0 }]).deadlocked).toBe(0);
});

it("property: same mansion and plan always give the same hashes", () => {
  const placement = fc.record({ kind: fc.constantFrom("ghost" as const, "trap" as const),
    x: fc.integer({ min: 0, max: 13 }), y: fc.integer({ min: 0, max: 4 }), tick: fc.integer({ min: 0, max: 600 }) });
  fc.assert(fc.property(fc.array(placement, { maxLength: 8 }), fc.nat({ max: 1000 }), (plan, seed) => {
    const m = { ...wide, seed, durationTicks: 1200 };
    const a = createMansion(m), b = createMansion(m);
    for (const p of plan) { a.place(p); b.place(p); }
    while (!a.done) { a.step(); b.step(); }
    return a.tickHashes.join() === b.tickHashes.join();
  }), { numRuns: 25 });
});
