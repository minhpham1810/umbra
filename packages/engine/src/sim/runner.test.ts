import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { runSim } from "./runner.js";
import { IDLE_FRAME } from "../input/types.js";
import type { Scene } from "../scene/schema.js";

const MINIMAL_SCENE: Scene = {
  version: 1,
  rapierVersion: "0.12.0",
  pieces: [{ kind: "floor", pos: { x: 0, y: 0, z: 0 }, rot: 0 }],
  spawn: { pos: { x: 0, y: 1, z: 0 }, yaw: 0 },
  goals: [{ id: "exit", kind: "exit", pos: { x: 2, y: 0, z: 2 } }],
};

describe("determinism", () => {
  it("same seed + inputs → same final hash", async () => {
    const inputs = Array.from({ length: 60 }, () => IDLE_FRAME);
    const a = await runSim({ scene: MINIMAL_SCENE, seed: 42, inputs, maxTicks: 60 });
    const b = await runSim({ scene: MINIMAL_SCENE, seed: 42, inputs, maxTicks: 60 });
    expect(a.finalStateHash).toBe(b.finalStateHash);
    expect(a.tickHashes).toEqual(b.tickHashes);
  });

  it("property: same seed + inputs always give same hash (fast-check)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 2 ** 32 - 1 }),
        fc.array(
          fc.record({ buttons: fc.nat({ max: 63 }), yaw: fc.nat({ max: 255 }) }),
          { maxLength: 20 },
        ),
        async (seed, inputs) => {
          const opts = { scene: MINIMAL_SCENE, seed, inputs, maxTicks: inputs.length || 1 };
          const a = await runSim(opts);
          const b = await runSim(opts);
          return a.finalStateHash === b.finalStateHash;
        },
      ),
      { numRuns: 50 },
    );
  });
});
