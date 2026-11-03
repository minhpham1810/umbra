import { expect, it } from "vitest";
import { holeCandidates } from "umbra-agents";
import { matches } from "./detectors.js";
import { MUTATIONS, cleanLevel, lcg, mutate, randomSpec, truthOf } from "./levels.js";

const spec = randomSpec("t", 3);
const clean = cleanLevel(spec);

it("clean levels have no unmarked holes and carry their truth", () => {
  expect(truthOf(clean)).toEqual({ type: "clean" });
  expect(holeCandidates(clean).filter((h) => !h.edge)).toEqual([]);
});

it("is deterministic per seed", () => {
  expect(cleanLevel(randomSpec("t", 3))).toEqual(clean);
  expect(MUTATIONS.map((m) => mutate(spec, m, lcg(1)))).toEqual(MUTATIONS.map((m) => mutate(spec, m, lcg(1))));
});

it("plants each bug where its truth says", () => {
  for (const m of MUTATIONS) {
    const scene = mutate(spec, m, lcg(9));
    const truth = truthOf(scene)!;
    if (m === "missing-tile" && truth.type === "fall_through") {
      expect(scene.pieces.some((p) => p.kind === "floor" && p.pos.x === truth.cell.x && p.pos.z === truth.cell.z)).toBe(false);
      expect(holeCandidates(scene).some((h) => h.x === truth.cell.x && h.z === truth.cell.z)).toBe(true);
    } else if (m === "low-wall" && truth.type === "out_of_bounds") {
      const top = Math.max(...scene.pieces.filter((p) => p.pos.x === truth.cell.x && p.pos.z === truth.cell.z).map((p) => p.pos.y));
      const floorTop = Math.max(...clean.pieces.filter((p) => p.kind === "floor" && p.pos.z === truth.cell.z).map((p) => p.pos.y));
      expect(top - floorTop).toBe(1); // one block above the floor: jumpable
    } else expect(truth).toEqual({ type: "unreachable_goal", goalId: "exit" });
  }
  expect(mutate(spec, "chasm", lcg(9)).pieces.filter((p) => p.kind === "pit").length)
    .toBeGreaterThan(clean.pieces.filter((p) => p.kind === "pit").length);
});

it("matches findings to the planted bug by type and nearby cell", () => {
  const truth = { type: "fall_through", cell: { x: 2, z: 5 } } as const;
  expect(matches({ type: "fall_through", cell: { x: 1, z: 6 } }, truth)).toBe(true);
  expect(matches({ type: "fall_through", cell: { x: 0, z: 5 } }, truth)).toBe(false);
  expect(matches({ type: "out_of_bounds", cell: { x: 2, z: 5 } }, truth)).toBe(false);
  expect(matches({ type: "unreachable_goal", goalId: "exit", cell: { x: 0, z: 0 } }, { type: "clean" })).toBe(false);
});
