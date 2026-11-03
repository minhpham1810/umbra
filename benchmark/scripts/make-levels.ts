// `pnpm --filter @umbra/benchmark levels`: write the seeded-bug benchmark.
//   levels/clean/bench-NN.json        16 levels with a verified winning route
//   levels/solutions/bench-NN.json    that route as a replay (Studio can play it)
//   levels/mutated/bench-NN--<m>.json one planted bug per level per mutation (80)
// Ground truth is in each scene's meta.benchmark.truth.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { makeReplay, searchReach } from "@umbra/agents";
import { MUTATIONS, cleanLevel, lcg, mutate, randomSpec } from "../src/levels.js";

const CLEAN_COUNT = 16;
/** Verification budget: well above the 300 runs detectors get, so "clean" is not decided by the detector's own limits. */
const VERIFY_RUNS = 1000;
const dir = (d: string) => new URL(`../levels/${d}/`, import.meta.url);
for (const d of ["clean", "mutated", "solutions"]) {
  mkdirSync(dir(d), { recursive: true });
  for (const f of readdirSync(dir(d))) if (f.startsWith("bench-")) rmSync(new URL(f, dir(d)));
}
const write = (d: string, name: string, data: unknown) => writeFileSync(new URL(name, dir(d)), JSON.stringify(data) + "\n");

let made = 0;
for (let seed = 1; made < CLEAN_COUNT; seed++) {
  if (seed > 200) throw new Error(`only ${made} clean levels in 200 seeds`);
  const id = `bench-${String(made + 1).padStart(2, "0")}`;
  const spec = randomSpec(id, seed);
  const scene = cleanLevel(spec);
  const win = await searchReach(scene, "exit", VERIFY_RUNS);
  if (!win.reached) { console.log(`seed ${seed}: no route found, skipped`); continue; }
  made++;
  write("clean", `${id}.json`, scene);
  write("solutions", `${id}.json`, await makeReplay(scene, 0, win.inputs, `${id}: winning route (${win.attempts} search runs)`));
  const pick = lcg(seed * 7919);
  for (const m of MUTATIONS) {
    const bad = mutate(spec, m, pick);
    // Unreachable mutations are impossible by construction; the bigger search is a consistency check.
    if (m === "chasm" || m === "ledge" || m === "walled-exit") {
      const r = await searchReach(bad, "exit", VERIFY_RUNS);
      if (r.reached) throw new Error(`${id}--${m}: exit reached in ${r.attempts} runs; the mutation is not a bug`);
    }
    write("mutated", `${id}--${m}.json`, bad);
  }
  console.log(`${id} (seed ${seed}): width ${spec.width}, ${spec.sections.map((s) => s.kind).join(" ")}`);
}
