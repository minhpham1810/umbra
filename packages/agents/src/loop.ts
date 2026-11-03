/**
 * The agent loop (design doc "The loop"): Builder writes the level, the Playtester
 * reports findings, the Fixer patches them one at a time, and the loop stops when the
 * level is clean or out of fix attempts. Unresolved findings are returned for a human.
 */
import type { Scene } from "@umbra/engine";
import { buildLevel, type BuildResult } from "./builder.js";
import { fixEvidence, fixFinding, sameFinding, type Edit, type FixEvidence } from "./fixer.js";
import type { Generate } from "./gemini.js";
import { playtest, type Finding, type Planner, type PlaytestOptions } from "./playtester.js";

export interface LoopResult {
  scene: Scene;
  build: Pick<BuildResult, "attempts" | "errors">;
  /** Findings from the first playtest, before any fix. */
  initialFindings: Finding[];
  fixes: { finding: Finding; edits: Edit[]; reason?: string; attempts: number; /** Before/after replays for Studio; absent if building them failed (see evidenceError). */
    evidence?: FixEvidence; evidenceError?: string }[];
  unresolved: Finding[];
}

export async function runLoop(brief: string, generate: Generate,
  opts: { planner?: Planner; maxFixes?: number; playtest?: PlaytestOptions } = {}): Promise<LoopResult> {
  const build = await buildLevel(brief, generate);
  const options = { ...opts.playtest, ...(opts.planner ? { planner: opts.planner } : {}) };
  let scene = build.scene;
  let report = await playtest(scene, options);
  const initialFindings = report.findings;
  const fixes: LoopResult["fixes"] = [];
  const unresolved: Finding[] = [];
  let budget = opts.maxFixes ?? 5;
  // Work through findings one at a time; each accepted fix brings a fresh report.
  const open = () => report.findings.find((f) => !unresolved.some((u) => sameFinding(u, f)));
  for (let finding = open(); finding && budget > 0; finding = open()) {
    budget--;
    const r = await fixFinding(scene, finding, report, generate, { playtest: opts.playtest ?? {} });
    if (r.fixed && r.report) {
      // Evidence is for viewing only; failing to build it must not lose the fix.
      const evidence = await fixEvidence(scene, r.scene, finding, r.edits, r.reason)
        .then((e) => ({ evidence: e }), (e: unknown) => ({ evidenceError: (e as Error).message }));
      fixes.push({ finding, edits: r.edits, ...(r.reason ? { reason: r.reason } : {}), attempts: r.attempts, ...evidence });
      scene = r.scene;
      report = r.report;
    } else unresolved.push(finding);
  }
  for (const f of report.findings) if (!unresolved.some((u) => sameFinding(u, f))) unresolved.push(f);
  return { scene, build: { attempts: build.attempts, errors: build.errors }, initialFindings, fixes, unresolved };
}
