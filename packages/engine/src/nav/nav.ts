import { init, NavMeshQuery, type NavMesh } from "recast-navigation";
import { generateSoloNavMesh } from "recast-navigation/generators";
import { SceneSchema, Vec3Schema, type Scene } from "../scene/schema.js";

type Point = { x: number; y: number; z: number };
export interface NavIsland { id: number; polygonRefs: number[] }
export interface NavBakeResult { navmeshId: string; islands: NavIsland[] }
export interface NavPathResult { found: boolean; waypoints: Point[] }
const meshes = new Map<string, { mesh: NavMesh; query: NavMeshQuery } | null>();
let nextId = 0;
let ready: Promise<void> | undefined;

/** Static geometry only; paths propose routes, physics proves reachability. */
export async function navBake(raw: Scene): Promise<NavBakeResult> {
  const scene = SceneSchema.parse(raw);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const piece of [...scene.pieces].sort((a, b) =>
    a.pos.x - b.pos.x || a.pos.y - b.pos.y || a.pos.z - b.pos.z)) {
    if (piece.kind === "pit" || piece.kind === "moving_platform" || piece.kind === "crate") continue;
    // Match Rapier's current cuboids, including its placeholder ramps/stairs.
    const base = positions.length / 3;
    const { x, y, z } = piece.pos;
    positions.push(x,y,z, x+1,y,z, x+1,y,z+1, x,y,z+1,
      x,y+1,z, x+1,y+1,z, x+1,y+1,z+1, x,y+1,z+1);
    for (const i of [0,1,2,0,2,3, 4,6,5,4,7,6, 0,4,5,0,5,1,
      3,2,6,3,6,7, 0,3,7,0,7,4, 1,5,6,1,6,2]) indices.push(base+i);
  }
  return navBakeTriangles(positions, indices);
}

/** The walker a navmesh is baked for, in metres. */
export interface NavAgent {
  /** Body radius (default 0.3). */
  radius?: number;
  /** Clearance needed overhead (default 1.4). */
  height?: number;
  /** Highest step it can walk up (default 0.2). */
  climb?: number;
  /** Voxel size: smaller is more exact and slower (default 0.1). */
  cellSize?: number;
}

/** Bake a navmesh from any triangle soup (xyz positions, index triples), for the given walker. */
export async function navBakeTriangles(positions: readonly number[], indices: readonly number[], agent: NavAgent = {}): Promise<NavBakeResult> {
  const navmeshId = `nav-${++nextId}`;
  if (!indices.length) {
    meshes.set(navmeshId, null);
    return { navmeshId, islands: [] };
  }
  const cs = agent.cellSize ?? 0.1;
  await (ready ??= init());
  const result = generateSoloNavMesh([...positions], [...indices], {
    cs, ch: cs,
    walkableHeight: Math.ceil((agent.height ?? 1.4) / cs),
    walkableClimb: Math.floor((agent.climb ?? 0.2) / cs + 1e-9),
    walkableRadius: Math.ceil((agent.radius ?? 0.3) / cs - 1e-9),
    minRegionArea: 0, mergeRegionArea: 0,
  });
  if (!result.success) throw new Error(`Navmesh bake failed: ${result.error}`);
  const mesh = result.navMesh;
  const islands: NavIsland[] = [];
  // A solo mesh has one tile; neis contains one-based polygon neighbours.
  for (let t = 0; t < mesh.getMaxTiles(); t++) {
    const tile = mesh.getTile(t);
    const header = tile.header();
    if (!header) continue;
    const seen = new Set<number>();
    const base = mesh.getPolyRefBase(tile);
    for (let i = 0; i < header.polyCount(); i++) {
      if (seen.has(i)) continue;
      const island: NavIsland = { id: islands.length, polygonRefs: [] };
      const pending = [i];
      seen.add(i);
      while (pending.length) {
        const index = pending.pop()!;
        island.polygonRefs.push(base + index);
        const poly = tile.polys(index);
        for (let edge = 0; edge < poly.vertCount(); edge++) {
          const nei = poly.neis(edge);
          if (nei === 0 || (nei & 0x8000) !== 0 || seen.has(nei - 1)) continue;
          seen.add(nei - 1);
          pending.push(nei - 1);
        }
      }
      islands.push(island);
    }
  }
  meshes.set(navmeshId, { mesh, query: new NavMeshQuery(mesh) });
  return { navmeshId, islands };
}

/** Points use world coordinates on the walkable surface, not capsule centres. */
export function navPath(navmeshId: string, from: Point, to: Point): NavPathResult {
  for (const point of [from, to]) {
    Vec3Schema.parse(point);
    if (!Object.values(point).every(Number.isFinite)) throw new Error("Invalid path point");
  }
  if (!meshes.has(navmeshId)) throw new Error(`Unknown navmesh: ${navmeshId}`);
  const entry = meshes.get(navmeshId);
  const missing: NavPathResult = { found: false, waypoints: [] };
  if (!entry) return missing;
  const halfExtents = { x: 0.5, y: 1, z: 0.5 };
  const end = entry.query.findNearestPoly(to, { halfExtents });
  if (!end.success || !end.nearestRef) return missing;
  const start = entry.query.findNearestPoly(from, { halfExtents });
  if (!start.success || !start.nearestRef) return missing;
  const result = entry.query.computePath(start.nearestPoint, end.nearestPoint, { halfExtents });
  const last = result.path.at(-1);
  // Detour can return success for a partial route to a different island.
  if (!result.success || !last || Math.hypot(last.x - end.nearestPoint.x,
    last.y - end.nearestPoint.y, last.z - end.nearestPoint.z) > 0.05) return missing;
  return { found: true, waypoints: result.path };
}

export function navDispose(navmeshId: string): void {
  const entry = meshes.get(navmeshId);
  entry?.query.destroy();
  entry?.mesh.destroy();
  meshes.delete(navmeshId);
}
