// `pnpm --filter @umbra/benchmark bench [detector...]`: score detectors on the benchmark.
// Writes results.json and RESULTS.md next to the levels. Detectors: playtester, random, navmesh.
// Levels run in parallel worker processes (BENCH_JOBS, default: CPU count - 1).
import { fork } from "node:child_process";
import { availableParallelism } from "node:os";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { SceneSchema } from "@umbra/engine";
import { DETECTORS, RUNS, matches, type Detection } from "../src/detectors.js";
import { MUTATIONS, truthOf, type Mutation, type Truth } from "../src/levels.js";

type Name = keyof typeof DETECTORS;
const levels = new URL("../levels/", import.meta.url);
const files = ["clean", "mutated"].flatMap((d) => readdirSync(new URL(`${d}/`, levels))
  .filter((f) => f.startsWith("bench-") && f.endsWith(".json")).sort().map((f) => `${d}/${f}`));
const load = (file: string) => SceneSchema.parse(JSON.parse(readFileSync(new URL(file, levels), "utf8")));

// ── worker: run one detector on the files it is sent ───────────────────────
if (process.env["BENCH_WORKER"]) {
  const detect = DETECTORS[process.env["BENCH_WORKER"] as Name];
  process.on("message", async (file: string) => {
    const start = performance.now();
    const r = await detect(load(file));
    process.send!({ file, ...r, ms: Math.round(performance.now() - start) } satisfies Detection & { file: string });
  });
} else await main();

async function runDetector(name: Name): Promise<Map<string, Detection>> {
  const jobs = Math.max(1, Number(process.env["BENCH_JOBS"]) || availableParallelism() - 1);
  const queue = [...files];
  const out = new Map<string, Detection>();
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, () => new Promise<void>((done, fail) => {
    const child = fork(process.argv[1]!, [], { env: { ...process.env, BENCH_WORKER: name }, execArgv: process.execArgv });
    const next = () => { const f = queue.shift(); if (f) child.send(f); else { child.kill(); done(); } };
    child.on("message", (m: Detection & { file: string }) => {
      const { file, ...d } = m;
      out.set(file, d);
      process.stderr.write(`\r${name}: ${out.size}/${files.length}   `);
      next();
    });
    child.on("exit", (code) => { if (code && queue.length) fail(new Error(`${name} worker exited ${code}`)); });
    next();
  })));
  process.stderr.write("\n");
  return out;
}

interface Score {
  recall: number; detected: number; planted: number;
  byMutation: Record<Mutation, { detected: number; planted: number }>;
  falseAlarmRate: number; cleanFlagged: number; clean: number;
  /** Findings on mutated levels that are not the planted bug. */
  spurious: number;
  msPerLevel: { mean: number; median: number; max: number };
  simRunsPerLevel: number;
  /** Mutated levels whose planted bug was not found, and clean levels with any finding. */
  missed: string[]; falseAlarms: string[];
}

function score(results: Map<string, Detection>): Score {
  const byMutation = Object.fromEntries(MUTATIONS.map((m) => [m, { detected: 0, planted: 0 }])) as Score["byMutation"];
  let detected = 0, planted = 0, clean = 0, cleanFlagged = 0, spurious = 0, simRuns = 0;
  const missed: string[] = [], falseAlarms: string[] = [];
  for (const file of files) {
    const scene = load(file);
    const truth = truthOf(scene) as Truth;
    const r = results.get(file)!;
    simRuns += r.simRuns;
    if (truth.type === "clean") { clean++; if (r.findings.length) { cleanFlagged++; falseAlarms.push(file); } continue; }
    const m = (scene.meta!["benchmark"] as { mutation: Mutation }).mutation;
    const hit = r.findings.some((f) => matches(f, truth));
    planted++; byMutation[m].planted++;
    if (hit) { detected++; byMutation[m].detected++; } else missed.push(file);
    spurious += r.findings.filter((f) => !matches(f, truth)).length;
  }
  const ms = [...results.values()].map((r) => r.ms).sort((a, b) => a - b);
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    recall: round(detected / planted), detected, planted, byMutation,
    falseAlarmRate: round(cleanFlagged / clean), cleanFlagged, clean, spurious,
    msPerLevel: { mean: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length), median: ms[Math.floor(ms.length / 2)]!, max: ms.at(-1)! },
    simRunsPerLevel: Math.round(simRuns / files.length),
    missed, falseAlarms,
  };
}

async function main() {
  const asked = process.argv.slice(2) as Name[];
  const names = asked.length ? asked : (Object.keys(DETECTORS) as Name[]);
  for (const n of names) if (!(n in DETECTORS)) throw new Error(`unknown detector ${n}; use ${Object.keys(DETECTORS).join(", ")}`);
  const resultsFile = new URL("results.json", levels);
  let previous: { scores?: Partial<Record<Name, Score>> } = {};
  try { previous = JSON.parse(readFileSync(resultsFile, "utf8")); } catch { /* first run */ }
  const scores: Partial<Record<Name, Score>> = { ...previous.scores };
  for (const n of names) scores[n] = score(await runDetector(n));
  const results = { levels: files.length, runsPerLevel: RUNS, date: new Date().toISOString().slice(0, 10), scores };
  writeFileSync(resultsFile, JSON.stringify(results, null, 2) + "\n");
  writeFileSync(new URL("RESULTS.md", levels), markdown(results.scores));
  console.log(markdown(results.scores));
}

function markdown(scores: Partial<Record<Name, Score>>): string {
  const rows = Object.entries(scores) as [Name, Score][];
  const pct = (a: number, b: number) => `${a}/${b} (${Math.round((100 * a) / b)}%)`;
  return [
    `| Detector | Recall | False alarms (clean levels) | Spurious findings | ${MUTATIONS.join(" | ")} | Median time / level |`,
    `| --- | --- | --- | --- | ${MUTATIONS.map(() => "---").join(" | ")} | --- |`,
    ...rows.map(([n, s]) => `| ${n} | ${pct(s.detected, s.planted)} | ${pct(s.cleanFlagged, s.clean)} | ${s.spurious} | ` +
      `${MUTATIONS.map((m) => `${s.byMutation[m].detected}/${s.byMutation[m].planted}`).join(" | ")} | ${(s.msPerLevel.median / 1000).toFixed(1)} s |`),
    "",
  ].join("\n");
}
