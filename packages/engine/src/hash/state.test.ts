import { expect, it } from "vitest";
import { createWorld } from "../ecs/types.js";
import { hashWorld } from "./state.js";

it("sim state outside the ECS and Rapier changes the hash", () => {
  const w = createWorld();
  const base = hashWorld(w, 123, [0, -1, 1]);
  expect(hashWorld(w, 123, [0, -1, 1])).toBe(base);
  expect(hashWorld(w, 123, [-133, -1, 1])).not.toBe(base); // vertical velocity
  expect(hashWorld(w, 123, [0, 0, 1])).not.toBe(base); // riding platform 0
  expect(hashWorld(w, 123, [0, -1, 1, 0])).not.toBe(base); // goal 0 reached
});
