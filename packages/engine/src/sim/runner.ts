/**
 * Headless simulation runner — determinism boundary.
 *
 * Rules (also checked by ESLint determinism rules):
 * - Math.sin / Math.cos / Math.random / Date never reach Rapier.
 * - world.step() is called exactly once per tick with dt = FIXED_DT.
 * - Bodies are built in sorted order by buildWorld().
 * - State hashed after every step.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import type { InputFrame } from "../input/types.js";
import { BUTTON, YAW_SIN, YAW_COS } from "../input/types.js";
import type { Scene } from "../scene/schema.js";
import type { SimEvent, SimOutcome } from "../replay/types.js";
import { createWorld } from "../ecs/types.js";
import { hashWorld } from "../hash/state.js";
import { initRapier, buildWorld, platformPosition, FIXED_DT, PLATFORM_HALF_Y } from "../physics/world.js";

export interface RunResult {
  outcome: SimOutcome;
  finalStateHash: number;
  events: SimEvent[];
  /** Per-tick state hashes — used by determinism tests. */
  tickHashes: number[];
}

export interface RunOptions {
  scene: Scene;
  seed: number;
  inputs: InputFrame[];
  maxTicks: number;
}

const OUT_OF_BOUNDS_Y = -10;
const PLAYER_SPEED = 5; // m/s — integer-friendly, no float constants into Rapier
const JUMP_IMPULSE = 8; // m/s initial vy
const CAPSULE_HALF_HEIGHT = 0.7; // capsule(0.4, 0.3) in buildWorld

export async function createSimulation(scene: Scene) {
  await initRapier();

  const { world: physWorld, handles } = buildWorld(scene);
  const ecsWorld = createWorld();
  const events: SimEvent[] = [];
  const tickHashes: number[] = [];

  // Track which goals are reached (by index).
  const goalsReached = new Set<number>();
  const totalGoals = scene.goals.length;

  // Simple grounded state — we use the character controller's result.
  let grounded = true;
  let verticalVelocity = 0; // integer-only, in m/s
  let lastMove = { x: 0, y: 0, z: 0 };
  let riding = -1; // index of the platform the player stood on after the last tick

  // Everything that changes future ticks must be in the hash, not just the ECS and Rapier.
  const stateHash = () => hashWorld(ecsWorld, snapshotHash(physWorld), [
    Math.round(verticalVelocity * 1000), riding, grounded ? 1 : 0, ...[...goalsReached].sort((a, b) => a - b)]);

  const playerBody = physWorld.getRigidBody(handles.playerBody)!;
  const charCtrl = physWorld.createCharacterController(0.01);
  charCtrl.setApplyImpulsesToDynamicBodies(false);
  charCtrl.enableSnapToGround(0.1);

  const eventQueue = new RAPIER.EventQueue(true);

  let outcome: SimOutcome = "timeout";

  let tick = 0;
  let disposed = false;
  function step(frame: InputFrame): void {
    if (disposed) throw new Error("Simulation is disposed");
    if (outcome !== "timeout") return;
    ecsWorld.tick = tick;

    // Movement direction from LUT — no Math.sin/cos here.
    const sinYaw = YAW_SIN[frame.yaw] ?? 0;
    const cosYaw = YAW_COS[frame.yaw] ?? 0;

    const fwd = (frame.buttons & BUTTON.FORWARD) !== 0 ? 1 : 0;
    const back = (frame.buttons & BUTTON.BACK) !== 0 ? 1 : 0;
    const left = (frame.buttons & BUTTON.LEFT) !== 0 ? 1 : 0;
    const right = (frame.buttons & BUTTON.RIGHT) !== 0 ? 1 : 0;
    const jump = (frame.buttons & BUTTON.JUMP) !== 0 ? 1 : 0;

    const moveX = ((fwd - back) * sinYaw + (right - left) * cosYaw) * PLAYER_SPEED * FIXED_DT;
    const moveZ = ((fwd - back) * cosYaw - (right - left) * sinYaw) * PLAYER_SPEED * FIXED_DT;

    // Vertical: jump only when grounded; gravity always applied.
    if (jump === 1 && grounded) {
      verticalVelocity = JUMP_IMPULSE;
    }
    verticalVelocity = Math.round((verticalVelocity - 20 * FIXED_DT) * 1000) / 1000;
    const moveY = verticalVelocity * FIXED_DT;

    // ── 1. platforms: move to their tick+1 positions, carry the rider ───────
    let carry = { x: 0, y: 0, z: 0 };
    for (const [i, p] of handles.platforms.entries()) {
      const now = platformPosition(p, tick);
      const next = platformPosition(p, tick + 1);
      // Teleport, not setNextKinematicTranslation: a body velocity makes Rapier's controller
      // add its own, inconsistent platform friction on top of the carry below.
      physWorld.getRigidBody(p.body)!.setTranslation(next, true);
      if (i === riding) carry = { x: next.x - now.x, y: next.y - now.y, z: next.z - now.z };
    }

    // ── 2. character controller move ─────────────────────────────────────────
    const playerCollider = physWorld.getCollider(handles.playerCollider)!;
    if (handles.platforms.length) {
      // The rider moves rigidly with its platform before its own move.
      // shortcut: the carry is not collision-checked, so a platform can push its rider
      // into a wall; sweep it through the controller if levels put walls on platform paths.
      const p = playerBody.translation();
      playerBody.setTranslation({ x: p.x + carry.x, y: p.y + carry.y, z: p.z + carry.z }, true);
      // Scene queries only refresh inside step(); the controller must see the moved bodies.
      physWorld.updateSceneQueries();
    }
    charCtrl.computeColliderMovement(playerCollider, { x: moveX, y: moveY, z: moveZ }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (collider) => !collider.isSensor());
    const computed = charCtrl.computedMovement();

    grounded = charCtrl.computedGrounded();
    if (grounded) verticalVelocity = Math.min(0, verticalVelocity);

    lastMove = { x: computed.x + carry.x, y: computed.y + carry.y, z: computed.z + carry.z };
    const pos = playerBody.translation();
    playerBody.setNextKinematicTranslation({
      x: pos.x + computed.x,
      y: pos.y + computed.y,
      z: pos.z + computed.z,
    });

    // ── 3. step physics ───────────────────────────────────────────────────────
    physWorld.step(eventQueue);

    const after = playerBody.translation();
    riding = grounded ? handles.platforms.findIndex((p) => {
      const c = platformPosition(p, tick + 1);
      return Math.abs(after.x - c.x) < 0.7 && Math.abs(after.z - c.z) < 0.7 &&
        Math.abs(after.y - CAPSULE_HALF_HEIGHT - (c.y + PLATFORM_HALF_Y)) < 0.1;
    }) : -1;

    // ── 4. collision events → goal checks ────────────────────────────────────
    eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started || (h1 !== handles.playerCollider && h2 !== handles.playerCollider)) return;
      for (const [sensorHandle, goalIdx] of handles.goalSensors) {
        if (h1 === sensorHandle || h2 === sensorHandle) {
          const gi = goalIdx as unknown as number;
          if (!goalsReached.has(gi)) {
            goalsReached.add(gi);
            const goal = scene.goals[gi];
            events.push({ tick, kind: "goal_reached", ...(goal?.id !== undefined ? { goalId: goal.id } : {}) });
          }
        }
      }
    });

    // ── 5. bounds check ───────────────────────────────────────────────────────
    const finalPos = playerBody.translation();
    if (finalPos.y < OUT_OF_BOUNDS_Y) {
      events.push({ tick, kind: "out_of_bounds", pos: { x: finalPos.x, y: finalPos.y, z: finalPos.z } });
      outcome = "out_of_bounds";
      tickHashes.push(stateHash());
      tick++;
      return;
    }

    // ── 6. win check ──────────────────────────────────────────────────────────
    if (goalsReached.size === totalGoals && totalGoals > 0) {
      outcome = "win";
      tickHashes.push(stateHash());
      tick++;
      return;
    }

    // ── 7. hash ───────────────────────────────────────────────────────────────
    tickHashes.push(stateHash());
    tick++;
  }

  return {
    step,
    position: () => ({ ...playerBody.translation() }),
    /** Movement applied on the last tick, in m/s. */
    velocity: () => ({ x: lastMove.x / FIXED_DT, y: lastMove.y / FIXED_DT, z: lastMove.z / FIXED_DT }),
    get grounded() { return grounded; },
    get tick() { return tick; },
    get events(): readonly SimEvent[] { return events; },
    /** Platform body centres, in scene construction order. */
    platforms: () => handles.platforms.map((p) => platformPosition(p, tick)),
    get outcome() { return outcome; },
    result: (): RunResult => ({ outcome, finalStateHash: tickHashes.at(-1) ?? 0,
      events: [...events], tickHashes: [...tickHashes] }),
    dispose() {
      if (disposed) return;
      disposed = true;
      charCtrl.free();
      eventQueue.free();
      physWorld.free();
    },
  };
}

export async function runSim(opts: RunOptions): Promise<RunResult> {
  const sim = await createSimulation(opts.scene);
  try {
    const maxTicks = Math.min(opts.maxTicks, opts.inputs.length || opts.maxTicks);
    for (let tick = 0; tick < maxTicks && sim.outcome === "timeout"; tick++) {
      sim.step(opts.inputs[tick] ?? { buttons: 0, yaw: 0 });
    }
    return sim.result();
  } finally { sim.dispose(); }
}

/**
 * Hash Rapier's own snapshot bytes with FNV-1a.
 * takeSnapshot() is the only source of Rapier internal state we read.
 */
function snapshotHash(world: RAPIER.World): number {
  const bytes = world.takeSnapshot();
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ (bytes[i] ?? 0), 16777619) >>> 0;
  }
  return h;
}
