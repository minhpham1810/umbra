/**
 * Browser-vs-Node determinism check (the Nov 9 go/no-go test).
 *
 * Runs the same scenes and inputs in Node and in headless Chromium and
 * compares every per-tick state hash.
 *
 * Run:  pnpm --filter @umbra/engine browser-hash-check
 * Needs: pnpm --filter @umbra/engine exec playwright install chromium
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { runSim } from "../src/sim/runner.js";
import { SceneSchema, type Scene } from "../src/scene/schema.js";
import type { InputFrame } from "../src/input/types.js";

const ENGINE = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(ENGINE, "../..");
const TICKS = 300;

// Fixed LCG so the browser and Node get identical, varied inputs.
function inputs(seed: number): InputFrame[] {
  let s = seed >>> 0;
  const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
  return Array.from({ length: TICKS }, () => ({ buttons: next() & 31, yaw: next() & 255 }));
}

const scenes: [string, Scene][] = [];
for (const dir of ["games/lantern/src", "benchmark/levels/clean", "benchmark/levels/mutated"].map((d) => join(REPO_ROOT, d)).filter(existsSync)) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    scenes.push([f, SceneSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8")))]);
  }
}
const cases = scenes.flatMap(([name, scene]) => [1, 2, 3].map((seed) => ({ name: `${name}#${seed}`, scene, seed, inputs: inputs(seed) })));

const bundle = await build({
  stdin: { contents: `export { runSim } from "./src/sim/runner.ts";`, resolveDir: ENGINE, loader: "ts" },
  bundle: true, format: "iife", globalName: "Umbra", platform: "browser", write: false,
});

const browser = await chromium.launch();
let failed = 0;
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e));
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const browserHashes = await page.evaluate(async (cs) => {
    // @ts-expect-error Umbra is the IIFE global from the bundle
    const { runSim } = globalThis.Umbra;
    const out: number[][] = [];
    for (const c of cs) out.push((await runSim({ ...c, maxTicks: c.inputs.length })).tickHashes);
    return out;
  }, cases);

  for (const [i, c] of cases.entries()) {
    const node = (await runSim({ ...c, maxTicks: c.inputs.length })).tickHashes;
    const web = browserHashes[i]!;
    const tick = node.findIndex((h, t) => h !== web[t]);
    if (tick !== -1 || node.length !== web.length) {
      console.error(`DIVERGED ${c.name} at tick ${tick === -1 ? Math.min(node.length, web.length) : tick}`);
      failed++;
    } else console.log(`OK       ${c.name}  ${node.length} ticks  hash=${node.at(-1)}`);
  }
} finally { await browser.close(); }

console.log(`\n${cases.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
