import { expect, it } from "vitest";
import * as THREE from "three";
import { SceneSchema } from "../scene/schema.js";
import { gridView, kitSceneView } from "./three.js";

const m = () => new THREE.MeshBasicMaterial();

it("builds a kit scene and moves its platforms and crates", () => {
  const scene = SceneSchema.parse({
    pieces: [
      { kind: "floor", pos: { x: 0, y: 0, z: 0 } }, { kind: "wall", pos: { x: 1, y: 1, z: 0 } }, { kind: "pit", pos: { x: 2, y: 0, z: 0 } },
      { kind: "moving_platform", pos: { x: 3, y: 0, z: 0 } }, { kind: "crate", pos: { x: 0, y: 1, z: 1 } },
    ],
    spawn: { pos: { x: 0.5, y: 1.72, z: 0.5 } }, goals: [{ id: "exit", kind: "exit", pos: { x: 0, y: 1, z: 0 } }],
  });
  const noPit = kitSceneView(scene, { floor: m(), wall: m(), platform: m(), crate: m(), goal: m() });
  expect(noPit.group.children.length).toBe(5); // floor, wall, platform, crate, goal
  const kit = kitSceneView(scene, { floor: m(), wall: m(), platform: m(), crate: m(), goal: m(), pit: m() });
  expect(kit.group.children.length).toBe(6);
  kit.update({ platforms: [{ x: 3.5, y: 0.9, z: 2 }], crates: [{ x: 0.5, y: 1.45, z: 4 }] });
  const at = kit.group.children.map((c) => c.position.toArray());
  expect(at).toContainEqual([3.5, 0.9, 2]);
  expect(at).toContainEqual([0.5, 1.45, 4]);
  kit.dispose();
});

it("lays a tile grid out centred on the origin, with pickable floors", () => {
  const grid = gridView(["#.#", "#E#"], { "#": { material: m(), top: 1.2, bottom: 0 }, ".": { material: m(), top: 0, pickable: true } });
  expect(grid.group.children.length).toBe(5); // E has no kind, so it is skipped
  expect(grid.pickable.map((p) => p.userData)).toEqual([{ x: 1, y: 0, tile: "." }]);
  expect(grid.at(1, 0)).toEqual({ x: 0, z: -0.5 });
  const wall = grid.group.children[0]!;
  expect([wall.position.y, wall.scale.y]).toEqual([0.6, 1.2]);
});
