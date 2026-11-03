import { describe, it, expect } from "vitest";
import { validateScene } from "./schema.js";

describe("validateScene", () => {
  it("accepts a valid minimal scene", () => {
    const result = validateScene({
      pieces: [{ kind: "floor", pos: { x: 0, y: 0, z: 0 } }],
      spawn: { pos: { x: 0, y: 1, z: 0 } },
      goals: [{ id: "exit", kind: "exit", pos: { x: 2, y: 0, z: 2 } }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a scene with an unknown piece kind", () => {
    const result = validateScene({
      pieces: [{ kind: "teleporter", pos: { x: 0, y: 0, z: 0 } }],
      spawn: { pos: { x: 0, y: 1, z: 0 } },
      goals: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects non-integer grid positions", () => {
    const result = validateScene({
      pieces: [{ kind: "floor", pos: { x: 0.5, y: 0, z: 0 } }],
      spawn: { pos: { x: 0, y: 1, z: 0 } },
      goals: [],
    });
    expect(result.ok).toBe(false);
  });
});
