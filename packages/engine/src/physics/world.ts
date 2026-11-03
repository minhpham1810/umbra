/**
 * Physics world builder.
 *
 * Determinism rules enforced here:
 * - Bodies/colliders created in ascending entity-ID order.
 * - No Math.sin/cos/random — movement directions come from caller via LUT.
 * - Fixed timestep: dt = 1/60 always.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import type { Scene, KitPiece } from "../scene/schema.js";
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
  for (const piece of sorted) {
    if (!SOLID.has(piece.kind)) addPiece(world, piece);
  }

  // Goal sensors — one cuboid per goal, kinematic static.
  const goalSensors = new Map<RAPIER.ColliderHandle, EntityId>();
  const sortedGoals = [...scene.goals].sort((a, b) => a.id.localeCompare(b.id));
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

  return { world, handles: { playerBody: playerBody.handle, playerCollider: playerCollider.handle, goalSensors } };
}

// ── piece geometry ────────────────────────────────────────────────────────────

const HALF = 0.5; // all pieces are 1 m³ blocks
// Ramps and stairs are still placeholder cubes.
const SOLID = new Set<KitPiece["kind"]>(["floor", "wall", "stairs", "ramp"]);

/** Non-solid pieces; solid blocks are merged into columns in buildWorld. */
function addPiece(world: PhysicsWorld, piece: KitPiece): void {
  switch (piece.kind) {
    case "pit":
      // Pits are gaps — no collider; out-of-bounds check handles falling.
      break;
    case "moving_platform": {
      const speed: number = typeof piece.props?.["speed"] === "number" ? (piece.props["speed"] as number) : 1;
      // Store speed on the body's user data so the tick loop can move it.
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(piece.pos.x + HALF, piece.pos.y + HALF, piece.pos.z + HALF)
          .setUserData({ speed, origin: { ...piece.pos } }),
      );
      world.createCollider(RAPIER.ColliderDesc.cuboid(HALF, HALF * 0.25, HALF), body);
      break;
    }
  }
}
