/**
 * Determinism double-run check.
 *
 * For every scene in benchmark/levels/clean/ and benchmark/levels/mutated/
 * (when it exists), run the simulation twice with the same seed and idle
 * inputs, then assert the tickHashes arrays are identical.
 *
 * Run:  pnpm tsx scripts/determinism-check.ts
 * CI:   pnpm --filter @umbra/engine determinism-check
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { initRapier } from "../src/physics/world.js";
import { runSim } from "../src/sim/runner.js";
import { validateScene } from "../src/scene/schema.js";
import { IDLE_FRAME } from "../src/input/types.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const DIRS = [
  join(REPO_ROOT, "benchmark/levels/clean"),
  join(REPO_ROOT, "benchmark/levels/mutated"),
].filter(existsSync);

await initRapier();

let passed = 0;
let failed = 0;

for (const dir of DIRS) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const path = join(dir, file);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const v = validateScene(raw);
    if (!v.ok) {
      console.error(`INVALID  ${file}: ${v.errors.join(", ")}`);
      failed++;
      continue;
    }
    const scene = v.scene;
    const inputs = Array.from({ length: 120 }, () => IDLE_FRAME);
    const opts = { scene, seed: 0, inputs, maxTicks: 120 };
    const a = await runSim(opts);
    const b = await runSim(opts);
    if (a.finalStateHash !== b.finalStateHash) {
      console.error(`DIVERGED ${file}: run1=${a.finalStateHash} run2=${b.finalStateHash}`);
      failed++;
    } else {
      console.log(`OK       ${file}  hash=${a.finalStateHash}`);
      passed++;
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
