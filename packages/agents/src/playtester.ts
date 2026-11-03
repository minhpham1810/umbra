/**
 * Playtester (Lantern): plans test goals, then proves each verdict with physics.
 * The LLM only plans; the navmesh proposes routes and the simulation decides.
 */
import { z } from "zod";
import type { Scene } from "@umbra/engine";
import { replaySave, searchTarget, type Point } from "./tools/api.js";

/** fall_through: an unmarked hole inside the level; out_of_bounds: an escape over its edge. */
export type BugType = "unreachable_goal" | "fall_through" | "out_of_bounds";

export interface Finding {
  type: BugType;
  goalId?: string;
  /** Grid cell the bug is about (the goal cell, or the hole the player fell through). */
  cell: { x: number; y: number; z: number };
  /** Saved replay that reproduces the bug; absent for unreachable goals (nothing to replay). */
  replayId?: string;
  /** Tick count of the reproducing replay. */
  tick?: number;
  /** Did the navmesh have a route? Compared with the physics verdict in the benchmark. */
  navRoute: boolean;
  detail: string;
}

export const TestGoalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reach"), goalId: z.string() }),
  z.object({ kind: z.literal("fall_check") }),
]);
export type TestGoal = z.infer<typeof TestGoalSchema>;
export type Planner = (scene: Scene) => Promise<TestGoal[]>;

export interface PlaytestOptions {
  planner?: Planner;
  /** Max sim runs per reach goal or hole. */
  maxRuns?: number;
  /** Stop starting new test goals after this long. */
  wallClockMs?: number;
  /** Save a replay for each reproducible finding (needs a writable UMBRA_REPLAYS_DIR). */
  saveReplays?: boolean;
}

export interface PlaytestReport {
  plan: TestGoal[];
  findings: Finding[];
  /** Plan entries not run because the wall clock ran out. */
  skipped: TestGoal[];
  simRuns: number;
}

/** Test every goal, then every hole. Used when no LLM is configured. */
export const defaultPlanner: Planner = async (scene) => [
  ...scene.goals.map((g) => ({ kind: "reach" as const, goalId: g.id })),
  { kind: "fall_check" as const },
];

const SOLID = new Set(["floor", "wall", "stairs", "ramp", "moving_platform"]);
const key = (x: number, z: number) => `${x},${z}`;

/**
 * Columns with no solid piece and no pit marker, inside the level's bounds and next to a
 * floor column: places a player can walk into and fall through by accident.
 */
export function holeCandidates(scene: Scene) {
  const solid = new Map<string, number>(); // column → highest solid y
  const pits = new Set<string>();
  for (const p of scene.pieces) {
    const k = key(p.pos.x, p.pos.z);
    if (p.kind === "pit") pits.add(k);
    else if (SOLID.has(p.kind)) solid.set(k, Math.max(solid.get(k) ?? -Infinity, p.pos.y));
  }
  const xs = scene.pieces.map((p) => p.pos.x), zs = scene.pieces.map((p) => p.pos.z);
  const holes: { x: number; z: number; floorY: number; edge: boolean; from: { x: number; z: number } }[] = [];
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (solid.has(key(x, z)) || pits.has(key(x, z))) continue;
      // Approach from the lowest neighbour: a floor rather than a wall top.
      let best: { y: number; x: number; z: number } | undefined;
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const y = solid.get(key(x + dx, z + dz));
        if (y !== undefined && (!best || y < best.y)) best = { y, x: x + dx, z: z + dz };
      }
      if (best) holes.push({ x, z, floorY: best.y + 1, edge: x === x0 || x === x1 || z === z0 || z === z1, from: { x: best.x, z: best.z } });
    }
  }
  return holes;
}

export async function playtest(scene: Scene, opts: PlaytestOptions = {}): Promise<PlaytestReport> {
  const maxRuns = opts.maxRuns ?? 300;
  const deadline = Date.now() + (opts.wallClockMs ?? 120_000);
  const plan = (await (opts.planner ?? defaultPlanner)(scene)).map((g) => TestGoalSchema.parse(g));
  const findings: Finding[] = [];
  const skipped: TestGoal[] = [];
  let simRuns = 0;

  const save = async (inputs: Parameters<typeof replaySave>[2]) =>
    opts.saveReplays ? await replaySave(scene, 0, inputs) : undefined;

  for (const goal of plan) {
    if (Date.now() > deadline) { skipped.push(goal); continue; }
    if (goal.kind === "reach") {
      const g = scene.goals.find((x) => x.id === goal.goalId);
      if (!g) throw new Error(`Plan names unknown goal: ${goal.goalId}`);
      const target = { x: g.pos.x + 0.5, y: g.pos.y, z: g.pos.z + 0.5 };
      const r = await searchTarget(scene, target, target, maxRuns,
        (run) => run.events.some((e) => e.kind === "goal_reached" && e.goalId === g.id));
      simRuns += r.attempts;
      if (!r.reached) {
        findings.push({ type: "unreachable_goal", goalId: g.id, cell: g.pos, navRoute: r.navRoute,
          detail: `No input sequence reached "${g.id}" in ${r.attempts} runs` +
            (r.navRoute ? " although the navmesh has a route." : "; the navmesh has no route either.") });
      }
    } else {
      for (const hole of holeCandidates(scene)) {
        const approach: Point = { x: hole.from.x + 0.5, y: hole.floorY, z: hole.from.z + 0.5 };
        const target: Point = { x: hole.x + 0.5, y: hole.floorY, z: hole.z + 0.5 };
        // Walking in is enough to prove a fall: try the walk, plus one ride per platform
        // (searchTarget's run order) for holes beyond a platform crossing.
        const runs = 2 + scene.pieces.filter((p) => p.kind === "moving_platform").length;
        const r = await searchTarget(scene, approach, target, runs, (run) => run.events.some((e) =>
          e.kind === "out_of_bounds" && e.pos && Math.floor(e.pos.x) === hole.x && Math.floor(e.pos.z) === hole.z));
        simRuns += r.attempts;
        if (r.reached) {
          const replayId = await save(r.inputs);
          findings.push({ type: hole.edge ? "out_of_bounds" : "fall_through", cell: { x: hole.x, y: hole.floorY - 1, z: hole.z },
            navRoute: r.navRoute, tick: r.inputs.length, ...(replayId ? { replayId } : {}),
            detail: hole.edge ? `The player escapes over the level's edge at (${hole.x}, ${hole.z}).`
              : `The player falls out of the level through unmarked hole (${hole.x}, ${hole.z}).` });
        }
      }
    }
  }
  return { plan, findings, skipped, simRuns };
}
