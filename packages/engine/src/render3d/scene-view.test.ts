import { expect, it } from "vitest";
import * as THREE from "three";
import { World } from "../core/world.js";
import { Camera, Light, Mesh } from "../render/components.js";
import { Transform } from "../spatial/transform.js";
import { createSceneView } from "./scene-view.js";

const world = () => new World({ seed: 0, components: [Transform, Mesh, Camera, Light] });
const at = (x: number, y = 0, z = 0) => Transform({ position: { x, y, z } });

it("mirrors meshes, lights and the active camera", () => {
  const w = world();
  const box = w.spawn(at(1), Mesh({ geometry: { type: "box", half: { x: 1, y: 1, z: 1 } }, material: { color: "#ff0000" } }));
  w.spawn(Light({ type: "ambient", intensity: 0.5 }));                       // no Transform needed
  w.spawn(at(0, 5), Light({ type: "directional", target: { x: 0, y: 0, z: 0 } }));
  w.spawn(at(0, 2, -5), Camera({ active: false }));
  const cam = w.spawn(at(0, 3, -8), Camera({ fov: 50, lookAt: { x: 0, y: 0, z: 0 } }));
  const view = createSceneView(w);
  view.setAspect(2);
  view.sync();
  const mesh = view.objectOf(box)!.children[0]!.children[0] as THREE.Mesh;
  expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("ff0000");
  expect(view.scene.children.filter((c) => c instanceof THREE.Light).length).toBe(2);
  expect(view.camera).toBe(view.objectOf(cam));
  expect([view.camera.fov, view.camera.aspect]).toEqual([50, 2]);
  view.dispose();
});

it("draws between the last two ticks", () => {
  const w = world();
  const e = w.spawn(at(0), Mesh({ geometry: { type: "sphere", radius: 1 } }));
  const view = createSceneView(w);
  view.capture();
  w.set(e, Transform, { position: { x: 10, y: 0, z: 0 } });
  view.capture();
  view.sync(0.25);
  expect(view.objectOf(e)!.position.x).toBeCloseTo(2.5);
  view.sync(1);
  expect(view.objectOf(e)!.position.x).toBeCloseTo(10);
  view.dispose();
});

it("rebuilds an object when its components change and removes despawned entities", () => {
  const w = world();
  const e = w.spawn(at(0), Mesh({ geometry: { type: "box", half: { x: 1, y: 1, z: 1 } } }));
  const view = createSceneView(w);
  view.sync();
  const first = view.objectOf(e);
  view.sync();
  expect(view.objectOf(e)).toBe(first); // unchanged: kept
  w.set(e, Mesh, { geometry: { type: "capsule", halfHeight: 0.5, radius: 0.3 } });
  view.sync();
  expect(view.objectOf(e)).not.toBe(first);
  w.despawn(e);
  view.sync();
  expect(view.objectOf(e)).toBeUndefined();
  expect(view.scene.children).toEqual([]);
  view.dispose();
});

it("loads each model once and clones it per entity", async () => {
  const w = world();
  let loads = 0;
  const model = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry()));
  const view = createSceneView(w, { models: async () => { loads++; return model; } });
  const a = w.spawn(at(0), Mesh({ geometry: { type: "model", asset: "crate.glb" } }));
  const b = w.spawn(at(2), Mesh({ geometry: { type: "model", asset: "crate.glb" } }));
  view.sync();
  await new Promise((r) => setTimeout(r, 0));
  expect(loads).toBe(1);
  expect(view.objectOf(a)!.children[0]!.children.length).toBe(1);
  expect(view.objectOf(b)!.children[0]!.children[0]).not.toBe(view.objectOf(a)!.children[0]!.children[0]);
  expect(() => { const v = createSceneView(w); v.sync(); }).toThrow(/no model loader/);
  view.dispose();
});
