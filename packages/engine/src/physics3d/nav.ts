/**
 * Navmeshes from a physics world: every fixed collider becomes walkable or blocking
 * geometry. Boxes and meshes are exact; spheres, capsules and cylinders use their boxes.
 */
import { navBakeTriangles, type NavAgent, type NavBakeResult } from "../nav/nav.js";
import type { World } from "../core/world.js";
import { Collider, RigidBody, Transform, type Quat, type Vec3 } from "./physics3d.js";

/** Rotate v by unit quaternion q. */
function rotate(v: Vec3, q: Quat): Vec3 {
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + (q.y * tz - q.z * ty), y: v.y + q.w * ty + (q.z * tx - q.x * tz), z: v.z + q.w * tz + (q.x * ty - q.y * tx) };
}

const BOX_INDICES = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2];

/** Bake a navmesh from the world's fixed colliders (no RigidBody, or a fixed one), for `agent`. */
export function navBakeWorld(world: World, agent: NavAgent = {}): Promise<NavBakeResult> {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [e, t, c] of world.query(Transform, Collider)) {
    const body = world.get(e, RigidBody);
    if ((body && body.type !== "fixed") || c.sensor) continue;
    const q = t.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
    const place = (local: Vec3) => {
      const o = c.offset ?? { x: 0, y: 0, z: 0 };
      const p = rotate({ x: local.x + o.x, y: local.y + o.y, z: local.z + o.z }, q);
      positions.push(t.position.x + p.x, t.position.y + p.y, t.position.z + p.z);
    };
    const base = positions.length / 3;
    const s = c.shape;
    if (s.type === "mesh") {
      for (let i = 0; i < s.vertices.length; i += 3) place({ x: s.vertices[i]!, y: s.vertices[i + 1]!, z: s.vertices[i + 2]! });
      for (const i of s.indices) indices.push(base + i);
      continue;
    }
    const h = s.type === "box" ? s.half : s.type === "sphere" ? { x: s.radius, y: s.radius, z: s.radius }
      : { x: s.radius, y: s.halfHeight + (s.type === "capsule" ? s.radius : 0), z: s.radius };
    for (const [x, y, z] of [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] as const) {
      place({ x: x * h.x, y: y * h.y, z: z * h.z });
    }
    for (const i of BOX_INDICES) indices.push(base + i);
  }
  return navBakeTriangles(positions, indices, agent);
}
