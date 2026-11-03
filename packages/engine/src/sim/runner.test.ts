import { describe, it, expect, beforeAll } from "vitest";
import fc from "fast-check";
import { runSim, createSimulation } from "./runner.js";
import { initRapier } from "../physics/world.js";
import { BUTTON, IDLE_FRAME } from "../input/types.js";
import type { InputFrame, Scene } from "../index.js";

/** A flat floor with an exit at (4, 0, 0). */
const FLAT_SCENE: Scene = {
  version: 1,
  rapierVersion: "0.12.0",
  pieces: [
    // 5-wide floor in x, centered at z=2 (player starts at z=0, walks +x)
    ...Array.from({ length: 5 }, (_, x) =>
      Array.from({ length: 5 }, (_, z) => ({ kind: "floor" as const, pos: { x, y: 0, z: z - 2 }, rot: 0 }))
    ).flat(),
    // Walls on all four sides to keep the player from falling off.
    ...Array.from({ length: 5 }, (_, i) => [
      { kind: "wall" as const, pos: { x: i, y: 0, z: -3 }, rot: 0 },
      { kind: "wall" as const, pos: { x: i, y: 0, z: 3 }, rot: 0 },
      { kind: "wall" as const, pos: { x: -1, y: 0, z: i - 2 }, rot: 0 },
      { kind: "wall" as const, pos: { x: 5, y: 0, z: i - 2 }, rot: 0 },
    ]).flat(),
  ],
  spawn: { pos: { x: 0, y: 1.5, z: 0 }, yaw: 0 },
  goals: [{ id: "exit", kind: "exit", pos: { x: 4, y: 0, z: 0 } }],
};

/** A scene with no floor — player falls immediately. */
const PITFALL_SCENE: Scene = {
  version: 1,
  rapierVersion: "0.12.0",
  pieces: [],
  spawn: { pos: { x: 0, y: 1, z: 0 }, yaw: 0 },
  goals: [{ id: "exit", kind: "exit", pos: { x: 5, y: 0, z: 0 } }],
};

beforeAll(async () => {
  await initRapier();
});

describe("determinism", () => {
  it("same seed + inputs → same final hash", async () => {
    const inputs = Array.from({ length: 60 }, () => IDLE_FRAME);
    const a = await runSim({ scene: FLAT_SCENE, seed: 42, inputs, maxTicks: 60 });
    const b = await runSim({ scene: FLAT_SCENE, seed: 42, inputs, maxTicks: 60 });
    expect(a.finalStateHash).toBe(b.finalStateHash);
    expect(a.tickHashes).toEqual(b.tickHashes);
  });

  it("property: same seed + inputs always give same hash", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 2 ** 32 - 1 }),
        fc.array(
          fc.record({ buttons: fc.nat({ max: 63 }), yaw: fc.nat({ max: 255 }) }),
          { maxLength: 30 },
        ),
        async (seed, inputs) => {
          const opts = { scene: FLAT_SCENE, seed, inputs, maxTicks: inputs.length || 1 };
          const a = await runSim(opts);
          const b = await runSim(opts);
          return a.finalStateHash === b.finalStateHash;
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe("outcomes", () => {
  it("player falls through a pitfall → out_of_bounds", async () => {
    // Just idle — no floor, player drops.
    const inputs: InputFrame[] = Array.from({ length: 200 }, () => IDLE_FRAME);
    const result = await runSim({ scene: PITFALL_SCENE, seed: 1, inputs, maxTicks: 200 });
    expect(result.outcome).toBe("out_of_bounds");
    expect(result.events.some((e) => e.kind === "out_of_bounds")).toBe(true);
  });

  it("player walking forward on a walled arena — no crash, deterministic outcome", async () => {
    const inputs: InputFrame[] = Array.from({ length: 120 }, () => ({
      buttons: BUTTON.FORWARD,
      yaw: 64, // ~east, toward x=4
    }));
    const a = await runSim({ scene: FLAT_SCENE, seed: 1, inputs, maxTicks: 120 });
    const b = await runSim({ scene: FLAT_SCENE, seed: 1, inputs, maxTicks: 120 });
    // Same outcome both times (determinism) and not an out_of_bounds (walled arena).
    expect(a.outcome).toBe(b.outcome);
    expect(a.outcome).not.toBe("out_of_bounds");
    expect(a.finalStateHash).toBe(b.finalStateHash);
  });
});

// A reachable sensor must report its original ID after construction is sorted.
it("reaches goals in scene order and wins", async () => {
  const scene: Scene = { ...FLAT_SCENE,
    spawn: { pos: { x: 1.5, y: 1.71, z: 0.5 }, yaw: 64 },
    goals: [
      { id: "z-first", kind: "key", pos: { x: 2, y: 1, z: 0 } },
      { id: "a-last", kind: "exit", pos: { x: 4, y: 1, z: 0 } },
    ],
  };
  const result = await runSim({ scene, seed: 1, maxTicks: 60,
    inputs: Array.from({ length: 60 }, () => ({ buttons: BUTTON.FORWARD, yaw: 64 })),
  });
  expect(result.outcome).toBe("win");
  expect(result.events.map(e => e.goalId)).toEqual(["z-first", "a-last"]);
});

it("interactive ticks match headless replay hashes", async () => {
  const inputs = Array.from({ length: 60 }, (_, i) => ({
    buttons: i < 25 ? BUTTON.JUMP | BUTTON.FORWARD : BUTTON.RIGHT, yaw: 32,
  }));
  const sim = await createSimulation(FLAT_SCENE);
  try {
    for (const frame of inputs) sim.step(frame);
    const result = await runSim({ scene: FLAT_SCENE, seed: 1, inputs, maxTicks: 60 });
    expect(sim.result()).toEqual(result);
    expect(sim.position().x).toBeGreaterThan(0);
  } finally { sim.dispose(); }
});

it("Lantern level can be won with a jump across the gap", async () => {
  const { readFileSync } = await import("node:fs");
  const { SceneSchema } = await import("../scene/schema.js");
  const scene = SceneSchema.parse(JSON.parse(readFileSync(
    new URL("../../../../games/lantern/src/level.json", import.meta.url), "utf8")));
  const inputs = Array.from({ length: 180 }, (_, i) => ({
    buttons: BUTTON.FORWARD | (i === 58 ? BUTTON.JUMP : 0), yaw: 0,
  }));
  const result = await runSim({ scene, seed: 1, inputs, maxTicks: inputs.length });
  expect(result.outcome).toBe("win");
  const walking = await runSim({ scene, seed: 1, inputs: inputs.map(() =>
    ({ buttons: BUTTON.FORWARD, yaw: 0 })), maxTicks: inputs.length });
  expect(walking.outcome).toBe("out_of_bounds");
});
