/**
 * Agent tool API — the typed surface agents (and Kiro) call.
 * Each function here is served as an MCP tool by src/mcp.ts.
 */
import { validateScene, type Scene } from "@umbra/engine";
import { runSim, createSimulation, navBake, navPath, navDispose, BUTTON, IDLE_FRAME, MovingPlatformPropsSchema, PLATFORM_HALF_Y, type RunResult } from "@umbra/engine";
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

export type Point = { x: number; y: number; z: number };
const CAPSULE_HALF_HEIGHT = 0.7; // matches the player capsule in buildWorld

export interface TargetResult extends ReachResult {
  /** Whether the navmesh had a route to `approach` (false: steered in a straight line). */
  navRoute: boolean;
}

type RunOutcome = { outcome: RunResult["outcome"]; events: readonly SimEvent[] };

/** One step of a steering program. */
type Step =
  | { go: Point } // walk toward a point
  | { waitFor: number; at: Point } // stand still until platform `waitFor` is within 0.1 m of `at`
  | { ride: number; until: Point }; // stand on platform `ride` until it is within 0.1 m of `until`

const near = (a: Point, b: Point, d: number) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < d;
const yawTo = (from: Point, to: Point) =>
  ((Math.round((Math.atan2(to.x - from.x, to.z - from.z) / (2 * Math.PI)) * 256) % 256) + 256) % 256;

async function navRouteTo(scene: Scene, from: Point, to: Point): Promise<Point[] | undefined> {
  const { navmeshId } = await navBake(scene);
  try {
    const path = navPath(navmeshId, from, to);
    return path.found ? path.waypoints.slice(1) : undefined;
  } finally { navDispose(navmeshId); }
}

/**
 * Navmesh + physics search toward a point. `budget` is the maximum number of sim runs.
 * Follows the navmesh route to `approach` (or a straight line when there is none), then
 * heads for `target`, with closed-loop steering. Attempts, in order: never jump; hold
 * jump; edge jumps (jump whenever the ground `L` m ahead drops away or rises one block,
 * for a few `L`, which crosses any number of gaps); one ride per moving platform;
 * then single jumps at tick 2·k.
 * A run stops as soon as `hit` is true or it ends.
 * shortcut: edge jumps are not combined with platform rides.
 * shortcut: platforms are boarded only at their start cell and ridden once along x or z.
 * A hit counts only if a fresh runSim of the recorded inputs reproduces it.
 */
export async function searchTarget(scene: Scene, approach: Point, target: Point, budget: number,
  hit: (run: RunOutcome) => boolean): Promise<TargetResult> {
  const spawn = scene.spawn.pos;
  const foot = { ...spawn, y: spawn.y - CAPSULE_HALF_HEIGHT };
  const route = await navRouteTo(scene, foot, approach);
  const navRoute = route !== undefined;
  const direct = [...(route ?? [approach]), ...(target !== approach ? [target] : [])];
  const programs: { steps: Step[]; jump: "never" | "hold" | { edge: number } | number }[] = [
    { steps: direct.map((go) => ({ go })), jump: "never" },
    { steps: direct.map((go) => ({ go })), jump: "hold" },
    ...[0.35, 0.6, 0.85].map((edge) => ({ steps: direct.map((go) => ({ go })), jump: { edge } })),
  ];
  // Walking surface height per column (top of its highest solid block).
  const ground = new Map<string, number>();
  for (const p of scene.pieces) {
    if (p.kind === "pit" || p.kind === "moving_platform") continue;
    const k = `${p.pos.x},${p.pos.z}`;
    ground.set(k, Math.max(ground.get(k) ?? -Infinity, p.pos.y + 1));
  }
  const groundAt = (x: number, z: number) => ground.get(`${Math.floor(x)},${Math.floor(z)}`);
  const platforms = scene.pieces.filter((p) => p.kind === "moving_platform")
    .sort((a, b) => a.pos.x - b.pos.x || a.pos.y - b.pos.y || a.pos.z - b.pos.z);
  for (const [i, piece] of platforms.entries()) {
    const { axis, distance } = MovingPlatformPropsSchema.parse(piece.props ?? {});
    if (axis === "y") continue;
    const top = piece.pos.y + 1;
    const start = { x: piece.pos.x + 0.5, y: top - PLATFORM_HALF_Y, z: piece.pos.z + 0.5 };
    const end = { ...start, [axis]: start[axis] + distance };
    const board = { x: start.x, y: top, z: start.z, [axis]: start[axis] - 1 };
    const exit = { x: end.x, y: top, z: end.z, [axis]: end[axis] + 1 };
    const toBoard = await navRouteTo(scene, foot, board);
    if (!toBoard) continue;
    const onward = (await navRouteTo(scene, exit, approach)) ?? [approach];
    programs.push({ jump: "never", steps: [
      ...toBoard.map((go) => ({ go })),
      { waitFor: i, at: start }, { go: { ...start, y: top } }, { ride: i, until: end },
      { go: exit }, ...onward.map((go) => ({ go })), ...(target !== approach ? [{ go: target }] : []),
    ] });
  }

  let attempts = 0;
  for (let k = 0; attempts < budget; k++) {
    const program = programs[k] ?? { steps: programs[0]!.steps, jump: 2 * (k - programs.length) };
    const pathLength = program.steps.reduce((acc, s) => ("go" in s ? { len: acc.len + Math.hypot(s.go.x - acc.at.x, s.go.z - acc.at.z), at: s.go } : acc),
      { len: 0, at: spawn as Point }).len;
    // 2x walking time at 5 m/s plus slack, plus up to two platform round trips per ride.
    const maxTicks = Math.ceil((pathLength / 5) * 60 * 2) + 60 + (program.steps.length - direct.length > 0 ? 1200 : 0);
    if (typeof program.jump === "number" && program.jump >= maxTicks) break; // every single-jump timing tried
    attempts++;
    const inputs: InputFrame[] = [];
    const sim = await createSimulation(scene);
    try {
      let next = 0;
      while (inputs.length < maxTicks && sim.outcome === "timeout" && !hit(sim)) {
        const pos = sim.position();
        let step = program.steps[next]!;
        const last = next === program.steps.length - 1;
        if (!last && "go" in step && Math.hypot(step.go.x - pos.x, step.go.z - pos.z) < 0.35) step = program.steps[++next]!;
        let buttons = 0;
        let yaw = inputs.at(-1)?.yaw ?? 0;
        if ("go" in step) {
          // At the final point, stop: a player walking into a hole then drops straight down.
          if (!(last && Math.hypot(step.go.x - pos.x, step.go.z - pos.z) < 0.2)) buttons = BUTTON.FORWARD;
          yaw = yawTo(pos, step.go);
        } else {
          // Stand still (on the ground or the platform) until the platform reaches the point.
          const plat = sim.platforms()["ride" in step ? step.ride : step.waitFor]!;
          if (near(plat, "ride" in step ? step.until : step.at, 0.1)) next = Math.min(next + 1, program.steps.length - 1);
        }
        const t = inputs.length;
        if (program.jump === "hold" || program.jump === t) buttons |= BUTTON.JUMP;
        if (typeof program.jump === "object" && "go" in step && buttons && sim.grounded) {
          const d = Math.hypot(step.go.x - pos.x, step.go.z - pos.z) || 1;
          const L = program.jump.edge;
          const ahead = groundAt(pos.x + ((step.go.x - pos.x) / d) * L, pos.z + ((step.go.z - pos.z) / d) * L);
          const feet = pos.y - CAPSULE_HALF_HEIGHT;
          // Jump over a drop or up a one-block step; a two-block rise is a wall.
          if (ahead === undefined || ahead < feet - 0.5 || (ahead > feet + 0.5 && ahead < feet + 1.5)) buttons |= BUTTON.JUMP;
        }
        const frame = { buttons, yaw };
        inputs.push(frame);
        sim.step(frame);
      }
      if (!hit(sim)) continue;
    } finally { sim.dispose(); }
    if (hit(await runSim({ scene, seed: 0, inputs, maxTicks: inputs.length }))) return { reached: true, inputs, attempts, navRoute };
  }
  return { reached: false, inputs: [], attempts, navRoute };
}

/** Navmesh + physics reachability search for one goal; see searchTarget. */
export async function searchReach(scene: Scene, goalId: string, budget: number): Promise<ReachResult> {
  const goal = scene.goals.find((g) => g.id === goalId);
  if (!goal) throw new Error(`Unknown goal: ${goalId}`);
  const target = { x: goal.pos.x + 0.5, y: goal.pos.y, z: goal.pos.z + 0.5 };
  const { reached, inputs, attempts } = await searchTarget(scene, target, target, budget,
    (run) => run.events.some((e) => e.kind === "goal_reached" && e.goalId === goalId));
  return { reached, inputs, attempts };
}

export { navBake, navPath, navDispose } from "@umbra/engine";
export type { NavBakeResult, NavPathResult, NavIsland } from "@umbra/engine";
