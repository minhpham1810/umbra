/**
 * Fixer: proposes a minimal scene edit for one finding. An edit is accepted only if the
 * finding no longer reproduces and a full playtest shows no new findings.
 * There is no add-pit edit, so a hole cannot be "fixed" by labelling it intentional.
 */
import { z } from "zod";
import { validateScene, type KitPiece, type Scene } from "@umbra/engine";
import { parseJson, type Generate } from "./gemini.js";
import { playtest, type Finding, type PlaytestOptions, type PlaytestReport } from "./playtester.js";

const n = z.number().int().min(-64).max(64);
export const EditSchema = z.object({
  op: z.enum(["add_floor", "add_wall", "remove"]),
  x: n, y: z.number().int().min(0).max(8), z: n,
});
export type Edit = z.infer<typeof EditSchema>;
const FixSchema = z.object({ reason: z.string().max(500), edits: z.array(EditSchema).min(1).max(12) });

export const FIX_JSON_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string" },
    edits: { type: "array", items: { type: "object", properties: {
      op: { type: "string", enum: ["add_floor", "add_wall", "remove"] },
      x: { type: "integer" }, y: { type: "integer" }, z: { type: "integer" } }, required: ["op", "x", "y", "z"] } },
  },
  required: ["reason", "edits"],
};

/** Apply edits; `remove` deletes every non-pit piece in that cell. */
export function applyEdits(scene: Scene, edits: Edit[]): Scene {
  let pieces: KitPiece[] = [...scene.pieces];
  for (const e of edits) {
    const here = (p: KitPiece) => p.pos.x === e.x && p.pos.y === e.y && p.pos.z === e.z;
    if (e.op === "remove") pieces = pieces.filter((p) => !(here(p) && p.kind !== "pit"));
    else {
      // A floor filling a pit cell replaces the pit marker.
      if (e.op === "add_floor") pieces = pieces.filter((p) => !(p.kind === "pit" && p.pos.x === e.x && p.pos.z === e.z));
      pieces = pieces.filter((p) => !(here(p) && p.kind !== "pit"));
      pieces.push({ kind: e.op === "add_floor" ? "floor" : "wall", pos: { x: e.x, y: e.y, z: e.z }, rot: 0 });
    }
  }
  const result = validateScene({ ...scene, pieces });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.scene;
}

/** Same bug: same type and goal or cell. */
export const sameFinding = (a: Finding, b: Finding) => a.type === b.type &&
  (a.goalId !== undefined ? a.goalId === b.goalId : a.cell.x === b.cell.x && a.cell.y === b.cell.y && a.cell.z === b.cell.z);

export function fixPrompt(scene: Scene, finding: Finding, feedback: string[]): string {
  const c = finding.cell;
  const nearby = scene.pieces.filter((p) => Math.abs(p.pos.x - c.x) <= 3 && Math.abs(p.pos.z - c.z) <= 3)
    .map((p) => `${p.kind}(${p.pos.x},${p.pos.y},${p.pos.z})`);
  return [
    "You repair bugs in a 3D platformer level on a 1-metre grid. Pieces are 1 m cubes at integer (x,y,z); the player walks on top of a floor block at y and stands at y+1.",
    "Physics: walk 5 m/s; a running jump clears up to 3 cells and climbs 1 block. Walls are two blocks high so the player cannot jump out.",
    "Propose the smallest edit that removes the bug without changing the level's intended challenge.",
    "Edits: add_floor {x,y,z} (replaces a pit there), add_wall {x,y,z}, remove {x,y,z} (removes the piece in that cell).",
    `Bug: ${JSON.stringify({ type: finding.type, goalId: finding.goalId, cell: c, detail: finding.detail })}`,
    `Spawn: ${JSON.stringify(scene.spawn.pos)}. Goals: ${JSON.stringify(scene.goals)}.`,
    `Pieces within 3 cells of the bug: ${nearby.join(" ") || "none"}`,
    ...(feedback.length ? ["Previous attempts failed:", ...feedback.map((f) => `- ${f}`)] : []),
    'Reply with JSON: {"reason": "...", "edits": [...]}.',
  ].join("\n");
}

export interface FixResult {
  fixed: boolean;
  scene: Scene;
  edits: Edit[];
  reason?: string;
  attempts: number;
  /** Playtest of the accepted scene (or the last rejected one). */
  report?: PlaytestReport;
  feedback: string[];
}

export async function fixFinding(scene: Scene, finding: Finding, baseline: PlaytestReport, generate: Generate,
  opts: { maxAttempts?: number; playtest?: PlaytestOptions } = {}): Promise<FixResult> {
  const feedback: string[] = [];
  let report: PlaytestReport | undefined;
  for (let attempt = 1; attempt <= (opts.maxAttempts ?? 3); attempt++) {
    let fix: z.infer<typeof FixSchema>;
    let next: Scene;
    try {
      fix = FixSchema.parse(parseJson(await generate(fixPrompt(scene, finding, feedback.slice(-3)), FIX_JSON_SCHEMA), "fix"));
      next = applyEdits(scene, fix.edits);
    } catch (e) { feedback.push(`Invalid fix: ${(e as Error).message.slice(0, 300)}`); continue; }
    report = await playtest(next, opts.playtest);
    const still = report.findings.some((f) => sameFinding(f, finding));
    const added = report.findings.filter((f) => !baseline.findings.some((b) => sameFinding(f, b)));
    if (!still && !added.length) {
      return { fixed: true, scene: next, edits: fix.edits, reason: fix.reason, attempts: attempt, report, feedback };
    }
    feedback.push(`${JSON.stringify(fix.edits)}: ` + [still ? "the bug still reproduces" : "",
      added.length ? `it introduced ${added.map((f) => `${f.type} at (${f.cell.x},${f.cell.y},${f.cell.z})`).join(", ")}` : ""]
      .filter(Boolean).join(" and "));
  }
  return { fixed: false, scene, edits: [], attempts: opts.maxAttempts ?? 3, ...(report ? { report } : {}), feedback };
}
