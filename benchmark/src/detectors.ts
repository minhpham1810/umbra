/**
 * Detectors compared on the benchmark. Each takes a scene and returns findings in the
 * Playtester's shape, so one scorer covers all three.
 */
import { BUTTON, navBake, navDispose, navPath, runSim, type InputFrame, type Scene } from "umbra-engine";
import { playtest, type BugType } from "umbra-agents";
import { lcg, type Truth } from "./levels.js";

export interface Found { type: BugType; goalId?: string; cell: { x: number; z: number } }
export interface Detection { findings: Found[]; simRuns: number; ms: number }
export type Detector = (scene: Scene) => Promise<Omit<Detection, "ms">>;

/** Runs per level for the search-based detectors (the Playtester's default). */
export const RUNS = 300;

export const playtester: Detector = async (scene) => {
  const r = await playtest(scene, { maxRuns: RUNS });
  return { findings: r.findings.map((f) => ({ type: f.type, ...(f.goalId ? { goalId: f.goalId } : {}), cell: { x: f.cell.x, z: f.cell.z } })), simRuns: r.simRuns };
};

/**
 * A random agent: each run holds a random heading and button mix for half a second at a
 * time. It reports the exit unreachable if no run reaches it, and a bug for every cell it
 * fell out of that is not a marked pit (outside the floor's bounds: out_of_bounds).
 */
export const randomAgent: Detector = async (scene) => {
  const rand = lcg(0x5eed);
  const pits = new Set(scene.pieces.filter((p) => p.kind === "pit").map((p) => `${p.pos.x},${p.pos.z}`));
  const floor = scene.pieces.filter((p) => p.kind === "floor");
  const [x0, x1] = [Math.min(...floor.map((p) => p.pos.x)), Math.max(...floor.map((p) => p.pos.x))];
  const [z0, z1] = [Math.min(...floor.map((p) => p.pos.z)), Math.max(...floor.map((p) => p.pos.z))];
  const falls = new Map<string, Found>();
  let reached = false;
  for (let run = 0; run < RUNS; run++) {
    const inputs: InputFrame[] = [];
    while (inputs.length < 900) {
      const frame = { yaw: rand(256), buttons: (rand(10) < 8 ? BUTTON.FORWARD : 0) | (rand(10) < 3 ? BUTTON.JUMP : 0) };
      for (let t = 0; t < 30; t++) inputs.push(frame);
    }
    const r = await runSim({ scene, seed: 0, inputs, maxTicks: inputs.length });
    if (r.events.some((e) => e.kind === "goal_reached" && e.goalId === "exit")) reached = true;
    const out = r.events.find((e) => e.kind === "out_of_bounds");
    if (out?.pos) {
      const x = Math.floor(out.pos.x), z = Math.floor(out.pos.z);
      if (pits.has(`${x},${z}`)) continue;
      const type = x < x0 || x > x1 || z < z0 || z > z1 ? "out_of_bounds" : "fall_through";
      falls.set(`${x},${z}`, { type, cell: { x, z } });
    }
  }
  const findings = [...falls.values()];
  if (!reached) findings.unshift({ type: "unreachable_goal", goalId: "exit", cell: { x: 0, z: 0 } });
  return { findings, simRuns: RUNS };
};

/** Navmesh only: the exit is unreachable when there is no walkable path. Cannot see holes. */
export const navmeshOnly: Detector = async (scene) => {
  const { navmeshId } = await navBake(scene);
  try {
    const goal = scene.goals.find((g) => g.id === "exit")!;
    const from = { x: scene.spawn.pos.x, y: scene.spawn.pos.y - 0.72, z: scene.spawn.pos.z };
    const path = navPath(navmeshId, from, { x: goal.pos.x + 0.5, y: goal.pos.y, z: goal.pos.z + 0.5 });
    return { findings: path.found ? [] : [{ type: "unreachable_goal", goalId: "exit", cell: { x: goal.pos.x, z: goal.pos.z } }], simRuns: 0 };
  } finally { navDispose(navmeshId); }
};

export const DETECTORS = { playtester, random: randomAgent, navmesh: navmeshOnly } as const;

/** Does a finding match the planted bug? Falls match within one cell. */
export function matches(f: Found, truth: Truth): boolean {
  if (truth.type === "clean" || f.type !== truth.type) return false;
  if (truth.type === "unreachable_goal") return f.goalId === truth.goalId;
  return Math.max(Math.abs(f.cell.x - truth.cell.x), Math.abs(f.cell.z - truth.cell.z)) <= 1;
}
