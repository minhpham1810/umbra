/**
 * Validate every scene JSON in benchmark/levels/.
 * Run:  pnpm tsx scripts/validate-scenes.ts
 * CI:   pnpm --filter umbra-engine validate-scenes
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { validateScene } from "../src/scene/schema.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const DIRS = [
  join(REPO_ROOT, "benchmark/levels/clean"),
  join(REPO_ROOT, "benchmark/levels/mutated"),
].filter(existsSync);

let passed = 0;
let failed = 0;

for (const dir of DIRS) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const path = join(dir, file);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const result = validateScene(raw);
    if (!result.ok) {
      console.error(`INVALID  ${file}`);
      for (const e of result.errors) console.error(`         ${e}`);
      failed++;
    } else {
      console.log(`OK  ${file}`);
      passed++;
    }
  }
}

console.log(`\n${passed} valid, ${failed} invalid`);
if (failed > 0) process.exit(1);
