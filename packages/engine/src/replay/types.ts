import type { InputFrame } from "../input/types.js";
import type { Scene } from "../scene/schema.js";

/**
 * A replay is everything needed to reproduce a run exactly.
 * Pin the Rapier version because upgrading it invalidates saved replays.
 */
export interface Replay {
  id: string;
  rapierVersion: string;
  scene: Scene;
  seed: number;
  inputs: InputFrame[];
  /** State hash after the final tick — used to verify reproduction. */
  finalStateHash: number;
  createdAt: string; // ISO-8601
  /** What this replay shows, e.g. a Playtester finding. */
  note?: string;
}

/** Outcome codes the simulator reports. */
export type SimOutcome =
  | "win"
  | "lose"
  | "timeout"
  | "out_of_bounds"
  | "clipped"; // inside geometry

export interface SimEvent {
  tick: number;
  kind: "goal_reached" | "player_died" | "trigger_entered" | "out_of_bounds";
  goalId?: string;
  pos?: { x: number; y: number; z: number };
}
