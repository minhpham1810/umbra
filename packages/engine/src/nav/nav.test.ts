import { expect, it } from "vitest";
import * as engine from "../index.js";
import type { Scene } from "../scene/schema.js";

const floor = (offset: number) => Array.from({ length: 5 }, (_, x) =>
  Array.from({ length: 5 }, (_, z) => ({ kind: "floor" as const,
    pos: { x: x + offset, y: 0, z }, rot: 0 }))).flat();
const scene: Scene = { version: 1, rapierVersion: "0.12.0",
  pieces: [...floor(0), ...floor(10)],
  spawn: { pos: { x: 1.5, y: 1.71, z: 1.5 }, yaw: 0 }, goals: [] };

it("bakes separate islands and rejects partial and distant paths", async () => {
  const { navmeshId, islands } = await engine.navBake(scene);
  try {
    expect(islands).toHaveLength(2);
    expect(engine.navPath(navmeshId, { x: 1, y: 1, z: 1 },
      { x: 4, y: 1, z: 4 }).found).toBe(true);
    expect(engine.navPath(navmeshId, { x: 1, y: 1, z: 1 },
      { x: 11, y: 1, z: 1 })).toEqual({ found: false, waypoints: [] });
    expect(engine.navPath(navmeshId, { x: -100, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 }).found).toBe(false);
  } finally { engine.navDispose(navmeshId); }
  expect(() => engine.navPath(navmeshId, scene.spawn.pos, scene.spawn.pos)).toThrow();
});

it("handles empty geometry without a WASM bake", async () => {
  const { navmeshId, islands } = await engine.navBake({ ...scene, pieces: [] });
  try {
    expect(islands).toEqual([]);
    expect(engine.navPath(navmeshId, scene.spawn.pos, scene.spawn.pos).found).toBe(false);
  } finally { engine.navDispose(navmeshId); }
});
