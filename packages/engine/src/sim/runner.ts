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
import { createWorld, addComponent, mkEntity } from "../ecs/types.js";
import { hashWorld } from "../hash/state.js";
import { initRapier, buildWorld, FIXED_DT } from "../physics/world.js";

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

export async function runSim(opts: RunOptions): Promise<RunResult> {
  await initRapier();

  const { world: physWorld, handles } = buildWorld(opts.scene);
  const ecsWorld = createWorld();
  const events: SimEvent[] = [];
  const tickHashes: number[] = [];

  // Track which goals are reached (by index).
  const goalsReached = new Set<number>();
  const totalGoals = opts.scene.goals.length;

  // Simple grounded state — we use the character controller's result.
  let grounded = true;
  let verticalVelocity = 0; // integer-only, in m/s

  const playerBody = physWorld.getRigidBody(handles.playerBody)!;
  const charCtrl = physWorld.createCharacterController(0.01);
  charCtrl.setApplyImpulsesToDynamicBodies(false);
  charCtrl.enableSnapToGround(0.1);

  const eventQueue = new RAPIER.EventQueue(true);

  let outcome: SimOutcome = "timeout";

  const maxTicks = Math.min(opts.maxTicks, opts.inputs.length > 0 ? opts.inputs.length : opts.maxTicks);

  for (let tick = 0; tick < maxTicks; tick++) {
    ecsWorld.tick = tick;

    // ── 1. consume input ─────────────────────────────────────────────────────
    const frame: InputFrame = opts.inputs[tick] ?? { buttons: 0, yaw: 0 };

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

    // ── 2. character controller move ─────────────────────────────────────────
    const playerCollider = physWorld.getCollider(handles.playerCollider)!;
    charCtrl.computeColliderMovement(playerCollider, { x: moveX, y: moveY, z: moveZ });
    const computed = charCtrl.computedMovement();

    grounded = charCtrl.computedGrounded();
    if (grounded) verticalVelocity = Math.min(0, verticalVelocity);

    const pos = playerBody.translation();
    playerBody.setNextKinematicTranslation({
      x: pos.x + computed.x,
      y: pos.y + computed.y,
      z: pos.z + computed.z,
    });

    // ── 3. step physics ───────────────────────────────────────────────────────
    physWorld.step(eventQueue);

    // ── 4. collision events → goal checks ────────────────────────────────────
    eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      for (const [sensorHandle, goalIdx] of handles.goalSensors) {
        if (h1 === sensorHandle || h2 === sensorHandle) {
          const gi = goalIdx as unknown as number;
          if (!goalsReached.has(gi)) {
            goalsReached.add(gi);
            const goal = opts.scene.goals[gi];
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
      tickHashes.push(hashWorld(ecsWorld, snapshotHash(physWorld)));
      break;
    }

    // ── 6. win check ──────────────────────────────────────────────────────────
    if (goalsReached.size === totalGoals && totalGoals > 0) {
      outcome = "win";
      tickHashes.push(hashWorld(ecsWorld, snapshotHash(physWorld)));
      break;
    }

    // ── 7. hash ───────────────────────────────────────────────────────────────
    tickHashes.push(hashWorld(ecsWorld, snapshotHash(physWorld)));
  }

  // Cleanup WASM memory.
  charCtrl.free();
  eventQueue.free();
  physWorld.free();

  return {
    outcome,
    finalStateHash: tickHashes.at(-1) ?? 0,
    events,
    tickHashes,
  };
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
