/**
 * Agent tool API — the typed surface agents (and Kiro) call.
 * Each function here is served as an MCP tool by src/mcp.ts.
 */
import { validateScene, type Scene } from "@umbra/engine";
import { runSim, createSimulation, navBake, navPath, navDispose, BUTTON, IDLE_FRAME, type RunResult } from "@umbra/engine";
import type { InputFrame } from "@umbra/engine";
import { randomUUID } from "node:crypto";
import type { Replay, SimEvent } from "@umbra/engine";

// ── scene tools ──────────────────────────────────────────────────────────────

export type ValidateResult = { ok: true; scene: Scene } | { ok: false; errors: string[] };

export function sceneValidate(raw: unknown): ValidateResult {
  return validateScene(raw);
}

/** Writes a validated scene as JSON. `path` must stay inside UMBRA_SCENES_DIR (default: cwd). */
export async function sceneWrite(
  path: string,
  scene: Scene,
): Promise<{ version: number; path: string }> {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { resolve, relative, isAbsolute, dirname } = await import("node:path");
  const root = resolve(process.env["UMBRA_SCENES_DIR"] ?? ".");
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !target.endsWith(".json")) {
    throw new Error(`Scene path must be a .json file inside ${root}`);
  }
  const valid = validateScene(scene);
  if (!valid.ok) throw new Error(`Invalid scene: ${valid.errors.join("; ")}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(valid.scene, null, 2), "utf8");
  return { version: valid.scene.version, path: target };
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
  outcome: RunResult["outcome"];
  playerPos: { x: number; y: number; z: number };
  playerVelocity: { x: number; y: number; z: number };
  grounded: boolean;
  /** IDs of goals within 8 metres. */
  nearbyGoals: string[];
  reachedGoals: string[];
}

/** Snapshot the world state after `atTick` ticks (or earlier if the run ends). */
export async function simObserve(
  scene: Scene,
  seed: number,
  inputs: InputFrame[],
  atTick: number,
): Promise<Observation> {
  void seed; // no random systems yet; kept for the replay signature
  const sim = await createSimulation(scene);
  try {
    while (sim.tick < atTick && sim.outcome === "timeout") sim.step(inputs[sim.tick] ?? IDLE_FRAME);
    const pos = sim.position();
    return {
      tick: sim.tick,
      outcome: sim.outcome,
      playerPos: pos,
      playerVelocity: sim.velocity(),
      grounded: sim.grounded,
      nearbyGoals: scene.goals.filter((g) => Math.hypot(g.pos.x + 0.5 - pos.x,
        g.pos.y + 0.5 - pos.y, g.pos.z + 0.5 - pos.z) <= 8).map((g) => g.id),
      reachedGoals: sim.events.flatMap((e) => e.kind === "goal_reached" && e.goalId ? [e.goalId] : []),
    };
  } finally { sim.dispose(); }
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

// ── search tools ─────────────────────────────────────────────────────────────

export interface ReachResult {
  reached: boolean;
  inputs: InputFrame[];
  attempts: number;
}

type Point = { x: number; y: number; z: number };
const CAPSULE_HALF_HEIGHT = 0.7; // matches the player capsule in buildWorld

/**
 * Navmesh + physics reachability search. `budget` is the maximum number of sim runs.
 * Follows the navmesh route (or a straight line when there is none) with closed-loop
 * steering; attempt 0 never jumps, 1 holds jump, later ones jump once at tick 2·(n-2).
 * shortcut: one jump per attempt, so routes needing two separate jumps are missed;
 * upgrade to the edge-launch jump search in the Playtester spec when levels need it.
 * A hit counts only if a fresh runSim of the recorded inputs reproduces it.
 */
export async function searchReach(scene: Scene, goalId: string, budget: number): Promise<ReachResult> {
  const goal = scene.goals.find((g) => g.id === goalId);
  if (!goal) throw new Error(`Unknown goal: ${goalId}`);
  const target = { x: goal.pos.x + 0.5, y: goal.pos.y, z: goal.pos.z + 0.5 };
  const spawn = scene.spawn.pos;
  const { navmeshId } = await navBake(scene);
  let route: Point[];
  try {
    const path = navPath(navmeshId, { ...spawn, y: spawn.y - CAPSULE_HALF_HEIGHT }, target);
    route = path.found ? path.waypoints.slice(1) : [];
  } finally { navDispose(navmeshId); }
  if (!route.length) route = [target];

  let length = 0;
  [spawn, ...route].reduce((a, b) => (length += Math.hypot(b.x - a.x, b.z - a.z), b));
  const maxTicks = Math.ceil((length / 5) * 60 * 2) + 60; // 2x walking time at 5 m/s, plus slack
  const reached = (events: readonly SimEvent[]) => events.some((e) => e.kind === "goal_reached" && e.goalId === goalId);

  let attempts = 0;
  while (attempts < budget) {
    const policy = attempts++;
    const jumpTick = 2 * (policy - 2);
    if (jumpTick >= maxTicks) break; // every single-jump timing has been tried
    const inputs: InputFrame[] = [];
    const sim = await createSimulation(scene);
    try {
      let next = 0;
      while (inputs.length < maxTicks && sim.outcome === "timeout" && !reached(sim.events)) {
        const pos = sim.position();
        let wp = route[next]!;
        if (next < route.length - 1 && Math.hypot(wp.x - pos.x, wp.z - pos.z) < 0.35) wp = route[++next]!;
        const yaw = ((Math.round((Math.atan2(wp.x - pos.x, wp.z - pos.z) / (2 * Math.PI)) * 256) % 256) + 256) % 256;
        const t = inputs.length;
        const jump = policy === 1 || t === jumpTick ? BUTTON.JUMP : 0;
        const frame = { buttons: BUTTON.FORWARD | jump, yaw };
        inputs.push(frame);
        sim.step(frame);
      }
      if (!reached(sim.events)) continue;
    } finally { sim.dispose(); }
    const check = await runSim({ scene, seed: 0, inputs, maxTicks: inputs.length });
    if (reached(check.events)) return { reached: true, inputs, attempts };
  }
  return { reached: false, inputs: [], attempts };
}

export { navBake, navPath, navDispose } from "@umbra/engine";
export type { NavBakeResult, NavPathResult, NavIsland } from "@umbra/engine";
