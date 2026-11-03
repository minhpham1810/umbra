/**
 * Agent tool API — the typed surface agents (and Kiro) call.
 * Each function here will be wrapped as an MCP tool in apps/studio.
 */
import { validateScene, type Scene } from "@umbra/engine";
import { runSim, type RunResult } from "@umbra/engine";
import type { InputFrame } from "@umbra/engine";
import { randomUUID } from "node:crypto";
import type { Replay, SimEvent } from "@umbra/engine";

// ── scene tools ──────────────────────────────────────────────────────────────

export type ValidateResult = { ok: true; scene: Scene } | { ok: false; errors: string[] };

export function sceneValidate(raw: unknown): ValidateResult {
  return validateScene(raw);
}

export async function sceneWrite(
  path: string,
  scene: Scene,
): Promise<{ version: number }> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, JSON.stringify(scene, null, 2), "utf8");
  return { version: scene.version };
}

// ── sim tools ────────────────────────────────────────────────────────────────

export interface SimRunResult {
  outcome: RunResult["outcome"];
  finalStateHash: number;
  events: SimEvent[];
}

export async function simRun(
  scene: Scene,
  seed: number,
  inputs: InputFrame[],
  maxTicks: number,
): Promise<SimRunResult> {
  return runSim({ scene, seed, inputs, maxTicks });
}

export interface Observation {
  tick: number;
  playerPos: { x: number; y: number; z: number };
  playerVelocity: { x: number; y: number; z: number };
  grounded: boolean;
  /** IDs of goals within 8 metres. */
  nearbyGoals: string[];
}

/** Snapshot the world state at a given tick. */
export async function simObserve(
  scene: Scene,
  seed: number,
  inputs: InputFrame[],
  atTick: number,
): Promise<Observation> {
  // TODO: run to atTick and extract ECS observation
  void scene; void seed; void inputs; void atTick;
  return {
    tick: atTick,
    playerPos: { x: 0, y: 1, z: 0 },
    playerVelocity: { x: 0, y: 0, z: 0 },
    grounded: true,
    nearbyGoals: [],
  };
}

// ── replay tool ──────────────────────────────────────────────────────────────

export async function replaySave(
  scene: Scene,
  seed: number,
  inputs: InputFrame[],
): Promise<string> {
  const result = await runSim({ scene, seed, inputs, maxTicks: inputs.length });
  const replay: Replay = {
    id: randomUUID(),
    rapierVersion: scene.rapierVersion,
    scene,
    seed,
    inputs,
    finalStateHash: result.finalStateHash,
    createdAt: new Date().toISOString(),
  };
  const dir = process.env["UMBRA_REPLAYS_DIR"] ?? "./replays";
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/${replay.id}.json`, JSON.stringify(replay, null, 2));
  return replay.id;
}

// ── search tools (stubs) ─────────────────────────────────────────────────────

export interface ReachResult {
  reached: boolean;
  inputs: InputFrame[];
  attempts: number;
}

/** Navmesh + physics reachability search. */
export async function searchReach(
  _scene: Scene,
  _goal: string,
  _budget: number,
): Promise<ReachResult> {
  // TODO: bake navmesh, pathfind, convert to inputs, run sim
  return { reached: false, inputs: [], attempts: 0 };
}

export { navBake, navPath, navDispose } from "@umbra/engine";
export type { NavBakeResult, NavPathResult, NavIsland } from "@umbra/engine";
