/**
 * Three.js views, imported from "umbra-engine/three" (three is an optional peer
 * dependency, so the core engine still runs headless without it). Like the 2D views they
 * only draw: the sims are untouched, so state hashes are the same however a game draws.
 * Materials belong to the caller; dispose() frees only the geometry these views made.
 */
import * as THREE from "three";
import { CRATE_HALF, PLATFORM_HALF_Y } from "../physics/world.js";
import type { Scene } from "../scene/schema.js";

type V3 = { x: number; y: number; z: number };

// ── kit scene ───────────────────────────────────────────────────────────────

export interface KitMaterials {
  floor: THREE.Material; wall: THREE.Material; platform: THREE.Material; crate: THREE.Material; goal: THREE.Material;
  /** Pits are drawn as a flat marker only when given a material. */
  pit?: THREE.Material;
}

export interface KitView {
  group: THREE.Group;
  /** Move platforms and crates, e.g. to `sim.platforms()` and `sim.crates()` (same order). */
  update(frame: { platforms: readonly V3[]; crates: readonly V3[] }): void;
  dispose(): void;
}

/** Meshes for a kit scene: blocks, pits, moving platforms, crates and goal markers. */
export function kitSceneView(scene: Scene, mats: KitMaterials, opts: { shadows?: boolean } = {}): KitView {
  const group = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const add = (geometry: THREE.BufferGeometry, mat: THREE.Material, shadows = opts.shadows) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = mesh.receiveShadow = shadows === true;
    group.add(mesh);
    return mesh;
  };
  let platformCount = 0, crateCount = 0;
  for (const p of scene.pieces) {
    if (p.kind === "moving_platform") { platformCount++; continue; }
    if (p.kind === "crate") { crateCount++; continue; }
    if (p.kind === "pit") {
      if (!mats.pit) continue;
      const m = add(plane, mats.pit, false);
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.pos.x + 0.5, p.pos.y + 1.01, p.pos.z + 0.5);
      continue;
    }
    add(box, p.kind === "wall" ? mats.wall : mats.floor).position.set(p.pos.x + 0.5, p.pos.y + 0.5, p.pos.z + 0.5);
  }
  const platforms = Array.from({ length: platformCount }, () => {
    const m = add(box, mats.platform);
    m.scale.y = 2 * PLATFORM_HALF_Y;
    return m;
  });
  const crates = Array.from({ length: crateCount }, () => {
    const m = add(box, mats.crate);
    m.scale.setScalar(2 * CRATE_HALF);
    return m;
  });
  for (const g of scene.goals) add(box, mats.goal, false).position.set(g.pos.x + 0.5, g.pos.y + 0.5, g.pos.z + 0.5);
  return {
    group,
    update(frame) {
      frame.platforms.forEach((p, i) => platforms[i]?.position.set(p.x, p.y, p.z));
      frame.crates.forEach((c, i) => crates[i]?.position.set(c.x, c.y, c.z));
    },
    dispose() { box.dispose(); plane.dispose(); },
  };
}

// ── tile grid ───────────────────────────────────────────────────────────────

/** How to draw one tile character: a box from `bottom` (default top - 0.2) up to `top`. */
export interface GridTile { material: THREE.Material; top: number; bottom?: number; pickable?: boolean }

export interface GridView {
  group: THREE.Group;
  /** Meshes of pickable tiles, for raycasting; each has userData { x, y, tile }. */
  pickable: THREE.Mesh[];
  /** World centre of tile (x, y): the grid is centred on the origin, rows run along +z. */
  at(x: number, y: number): { x: number; z: number };
  dispose(): void;
}

/** Boxes for a tile grid (one character per tile); unknown characters are skipped. */
export function gridView(tiles: readonly string[], kinds: Readonly<Record<string, GridTile>>, opts: { shadows?: boolean } = {}): GridView {
  const group = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const W = Math.max(...tiles.map((r) => r.length)), H = tiles.length;
  const at = (x: number, y: number) => ({ x: x - W / 2 + 0.5, z: y - H / 2 + 0.5 });
  const pickable: THREE.Mesh[] = [];
  tiles.forEach((row, y) => [...row].forEach((tile, x) => {
    const k = kinds[tile];
    if (!k) return;
    const bottom = k.bottom ?? k.top - 0.2;
    const mesh = new THREE.Mesh(box, k.material);
    mesh.scale.set(1, k.top - bottom, 1);
    const c = at(x, y);
    mesh.position.set(c.x, (k.top + bottom) / 2, c.z);
    mesh.castShadow = opts.shadows === true && k.top > 0;
    mesh.receiveShadow = opts.shadows === true;
    mesh.userData = { x, y, tile };
    if (k.pickable) pickable.push(mesh);
    group.add(mesh);
  }));
  return { group, pickable, at, dispose() { box.dispose(); } };
}

export * from "./scene-view.js";
export * from "./gltf-models.js";
