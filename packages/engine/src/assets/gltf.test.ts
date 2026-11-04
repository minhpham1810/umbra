import { expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { gltfTriangles } from "./gltf.js";
import { createGame, defineGame } from "../core/game.js";
import { physics3d, physics, Collider } from "../physics3d/index.js";
import { Transform } from "../spatial/transform.js";
import { z } from "zod";

/** A .glb with one quad (indexed, uint16) used by three nodes: moved+rotated, mirrored, and a child. */
function glb(): Uint8Array {
  const pos = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2]);
  const bin = new Uint8Array(pos.byteLength + idx.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const s = Math.SQRT1_2;
  const json = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "floor", mesh: 0, translation: [0, 2, 0], rotation: [0, s, 0, s], children: [2] },
      { name: "mirror", mesh: 0, scale: [-2, 1, 1] },
      { name: "collision", mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-1, 0, -1], max: [1, 0, 1] },
      { bufferView: 1, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }],
    buffers: [{ byteLength: bin.byteLength }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(text.length / 4) * 4, binLen = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen).fill(0x20, 20, 20 + jsonLen);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true);
  v.setUint32(12, jsonLen, true); v.setUint32(16, 0x4e4f534a, true); out.set(text, 20);
  const b = 20 + jsonLen;
  out.fill(0, b + 8);
  v.setUint32(b, binLen, true); v.setUint32(b + 4, 0x004e4942, true); out.set(bin, b + 8);
  return out;
}

/** World-space triangles as Three draws them, sorted, for comparison. */
async function threeTriangles(bytes: Uint8Array): Promise<number[][]> {
  const gltf = await new GLTFLoader().parseAsync(bytes.slice().buffer, "");
  gltf.scene.updateMatrixWorld(true);
  const tris: number[][] = [];
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry as THREE.BufferGeometry, p = g.getAttribute("position"), ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) tris.push(new THREE.Vector3().fromBufferAttribute(p, ix.getX(i)).applyMatrix4(o.matrixWorld).toArray());
  });
  return tris;
}

const round = (n: number) => Math.round(n * 1e5) / 1e5 + 0; // + 0 turns -0 into 0
const corners = (t: { vertices: number[]; indices: number[] }) =>
  t.indices.map((i) => [t.vertices[i * 3]!, t.vertices[i * 3 + 1]!, t.vertices[i * 3 + 2]!].map(round));

it("reads the same triangles Three.js draws, with node transforms", async () => {
  const bytes = glb();
  const ours = gltfTriangles(bytes);
  expect(ours.indices.length).toBe(18); // 3 nodes × 2 triangles
  const sort = (a: number[][]) => a.map((c) => c.join()).sort();
  expect(sort(corners(ours))).toEqual(sort((await threeTriangles(bytes)).map((c) => c.map(round))));
});

it("keeps faces pointing the same way under a mirroring scale", () => {
  const normalY = (t: { vertices: number[]; indices: number[] }, tri: number) => {
    const [a, b, c] = [0, 1, 2].map((k) => t.indices[tri * 3 + k]!).map((i) => new THREE.Vector3().fromArray(t.vertices, i * 3));
    return new THREE.Vector3().crossVectors(b!.clone().sub(a!), c!.clone().sub(a!)).y;
  };
  const t = gltfTriangles(glb());
  for (let tri = 0; tri < 6; tri++) expect(normalY(t, tri)).toBeGreaterThan(0);
});

it("picks one node's subtree and reports what it cannot read", () => {
  const t = gltfTriangles(glb(), { node: "collision" });
  expect(corners(t).every(([, y, z]) => y === 2 && z! <= -4)).toBe(true); // only the node at x = 5 in the floor's turned frame
  expect(() => gltfTriangles(glb(), { node: "nope" })).toThrow(/no node named "nope"/);
  const gltfJson = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "scene.bin", byteLength: 4 }] }));
  expect(() => gltfTriangles(gltfJson)).toThrow(/opts.buffer/);
});

it("gives physics the collider the browser draws", async () => {
  const shape = { type: "mesh" as const, ...gltfTriangles(glb(), { node: "mirror" }) };
  const game = defineGame({
    name: "drop", input: z.null(), plugins: [physics3d()],
    setup(world) { world.spawn(Transform({ position: { x: 0, y: 0, z: 0 } }), Collider({ shape })); },
  });
  const run = await createGame(game, null);
  const hit = physics(run.world).raycast({ x: 1.5, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10);
  expect(hit?.distance).toBeCloseTo(5); // the mirrored quad spans x -2..2 at y = 0
  run.dispose();
});
