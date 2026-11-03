/**
 * Physics world builder.
 *
 * Determinism rules enforced here:
 * - Bodies/colliders created in ascending entity-ID order.
 * - No Math.sin/cos/random — movement directions come from caller via LUT.
 * - Fixed timestep: dt = 1/60 always.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { MovingPlatformPropsSchema, type Scene, type KitPiece } from "../scene/schema.js";
import type { EntityId } from "../ecs/types.js";

export const FIXED_DT = 1 / 60;
export const GRAVITY = { x: 0, y: -20, z: 0 };

export type PhysicsWorld = RAPIER.World;

/** Handle → entity mapping so event callbacks can look up ECS IDs. */
export interface PhysicsHandles {
  playerBody: RAPIER.RigidBodyHandle;
  playerCollider: RAPIER.ColliderHandle;
  /** collider handle → goal entity id for trigger sensors */
  goalSensors: Map<RAPIER.ColliderHandle, EntityId>;
  /** Moving platforms in construction order. */
  platforms: Platform[];
  /** Crate bodies (dynamic, rotation locked) in construction order. */
  crates: RAPIER.RigidBodyHandle[];
}

export interface Platform {
  body: RAPIER.RigidBodyHandle;
  collider: RAPIER.ColliderHandle;
  /** Body centre at tick 0. */
  origin: { x: number; y: number; z: number };
  axis: "x" | "y" | "z";
  distance: number;
  /** Ticks for one leg of the trip (rounded, so always an integer). */
  legTicks: number;
}

/** Platform body centre after `tick` ticks: a triangle wave, from integer tick math only. */
export function platformPosition(p: Platform, tick: number) {
  const phase = tick % (2 * p.legTicks);
  const leg = phase <= p.legTicks ? phase : 2 * p.legTicks - phase;
  return { ...p.origin, [p.axis]: p.origin[p.axis] + (p.distance * leg) / p.legTicks };
}

let rapierReady = false;

/** Call once before any physics. Safe to call multiple times. */
export async function initRapier(): Promise<void> {
  if (rapierReady) return;
  await RAPIER.init();
  rapierReady = true;
}

/**
 * Build a fresh Rapier world from a scene.
 * Pieces are processed in sorted order so construction is deterministic.
 */
export function buildWorld(scene: Scene): { world: PhysicsWorld; handles: PhysicsHandles } {
  const world = new RAPIER.World(GRAVITY);
  world.timestep = FIXED_DT;

  // Sort pieces by (x, y, z) so identical scenes always build in the same order.
  const sorted = [...scene.pieces].sort((a, b) =>
    a.pos.x - b.pos.x || a.pos.y - b.pos.y || a.pos.z - b.pos.z,
  );

  // Solid blocks stacked in one column become one collider: the seams between
  // stacked cuboids give ghost "ground" contacts that let the player climb walls.
  const solid = sorted.filter((p) => SOLID.has(p.kind))
    .sort((a, b) => a.pos.x - b.pos.x || a.pos.z - b.pos.z || a.pos.y - b.pos.y);
  for (let i = 0; i < solid.length;) {
    const { x, y, z } = solid[i]!.pos;
    let top = y;
    for (i++; i < solid.length && solid[i]!.pos.x === x && solid[i]!.pos.z === z && solid[i]!.pos.y <= top + 1; i++) {
      top = Math.max(top, solid[i]!.pos.y);
    }
    const half = (top - y + 1) / 2;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x + HALF, y + half, z + HALF));
    world.createCollider(RAPIER.ColliderDesc.cuboid(HALF, half, HALF), body);
  }
  // Pits have no collider. Platform slabs sit flush with floor tops at the same grid y.
  const platforms: Platform[] = [];
  for (const piece of sorted) {
    if (piece.kind !== "moving_platform") continue;
    const { axis, distance, speed } = MovingPlatformPropsSchema.parse(piece.props ?? {});
    const origin = { x: piece.pos.x + HALF, y: piece.pos.y + 1 - PLATFORM_HALF_Y, z: piece.pos.z + HALF };
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(origin.x, origin.y, origin.z));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(HALF, PLATFORM_HALF_Y, HALF), body);
    platforms.push({ body: body.handle, collider: collider.handle, origin, axis, distance,
      legTicks: Math.max(1, Math.round((distance / speed) / FIXED_DT)) });
  }

  // Crates: dynamic boxes resting on the floor of their cell. Locked rotation keeps pushes predictable.
  const crates: RAPIER.RigidBodyHandle[] = [];
  for (const piece of sorted) {
    if (piece.kind !== "crate") continue;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().lockRotations()
      .setTranslation(piece.pos.x + HALF, piece.pos.y + CRATE_HALF, piece.pos.z + HALF));
    world.createCollider(RAPIER.ColliderDesc.cuboid(CRATE_HALF, CRATE_HALF, CRATE_HALF), body);
    crates.push(body.handle);
  }

  // Goal sensors — one cuboid per goal, kinematic static.
  const goalSensors = new Map<RAPIER.ColliderHandle, EntityId>();
  const sortedGoals = [...scene.goals].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 0; i < sortedGoals.length; i++) {
    const g = sortedGoals[i]!;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(g.pos.x + 0.5, g.pos.y + 0.5, g.pos.z + 0.5));
    const coll = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.45, 0.45, 0.45).setSensor(true)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL),
      body,
    );
    goalSensors.set(coll.handle, scene.goals.indexOf(g) as EntityId);
  }

  // Player — kinematic position-based body + capsule collider.
  const sp = scene.spawn.pos;
  const playerBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(sp.x, sp.y, sp.z),
  );
  const playerCollider = world.createCollider(
    RAPIER.ColliderDesc.capsule(0.4, 0.3),
    playerBody,
  );

  world.updateSceneQueries();

  return { world, handles: { playerBody: playerBody.handle, playerCollider: playerCollider.handle, goalSensors, platforms, crates } };
}

// ── piece geometry ────────────────────────────────────────────────────────────

const HALF = 0.5; // all pieces are 1 m³ blocks
export const PLATFORM_HALF_Y = 0.125;
export const CRATE_HALF = 0.45;
// Ramps and stairs are still placeholder cubes.
const SOLID = new Set<KitPiece["kind"]>(["floor", "wall", "stairs", "ramp"]);
