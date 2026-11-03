/**
 * Headless simulation runner.
 *
 * This module is the determinism boundary: nothing that reaches Rapier
 * may come from Math.random, Date, or any non-integer computation outside
 * the YAW_SIN/YAW_COS LUT.  The ESLint determinism rules enforce this.
 */
import type { InputFrame } from "../input/types.js";
import type { Scene } from "../scene/schema.js";
import type { SimEvent, SimOutcome } from "../replay/types.js";
import { createWorld } from "../ecs/types.js";
import { hashWorld } from "../hash/state.js";

export interface RunResult {
  outcome: SimOutcome;
  finalStateHash: number;
  events: SimEvent[];
  /** Hashes at every tick — used by the determinism test. */
  tickHashes: number[];
}

export interface RunOptions {
  scene: Scene;
  seed: number;
  inputs: InputFrame[];
  maxTicks: number;
}

/**
 * Run the simulation headlessly and return the outcome.
 *
 * TODO: initialise Rapier world from scene.pieces, step 60 ticks/s,
 * consume one InputFrame per tick, hash every tick.
 * Keeping this as a stub until Rapier WASM loads cleanly in the test harness.
 */
export async function runSim(opts: RunOptions): Promise<RunResult> {
  const world = createWorld();
  const events: SimEvent[] = [];
  const tickHashes: number[] = [];

  for (let tick = 0; tick < opts.maxTicks; tick++) {
    world.tick = tick;
    // TODO: apply inputs[tick] via character controller
    // TODO: world.step() with fixed dt = 1/60
    // TODO: evaluate goal and bounds sensors -> push events
    const hash = hashWorld(world, /* rapierSnapshotHash */ 0);
    tickHashes.push(hash);

    if (tick >= opts.inputs.length) break;
  }

  return {
    outcome: "timeout",
    finalStateHash: tickHashes.at(-1) ?? 0,
    events,
    tickHashes,
  };
}
