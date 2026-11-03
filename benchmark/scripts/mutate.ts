/**
 * Mutation script — plants one known bug per clean level copy.
 *
 * Usage: node --import tsx benchmark/scripts/mutate.ts
 *
 * Mutation types:
 *   gap-too-wide       — widen a floor gap past max jump distance (~2m)
 *   ledge-too-high     — raise a floor tile above reachable jump height (~1.5m)
 *   exit-walled-off    — add a wall piece in front of the exit
 *   pit-under-exit     — replace the exit floor with a pit
 *   platform-too-slow  — slow a moving_platform so the jump can't be timed
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateScene } from "@umbra/engine";

const CLEAN_DIR = new URL("../levels/clean", import.meta.url).pathname;
const OUT_DIR = new URL("../levels/mutated", import.meta.url).pathname;

mkdirSync(OUT_DIR, { recursive: true });

const mutations = [
  "gap-too-wide",
  "ledge-too-high",
  "exit-walled-off",
] as const;

for (const file of readdirSync(CLEAN_DIR).filter((f) => f.endsWith(".json"))) {
  const raw = JSON.parse(readFileSync(join(CLEAN_DIR, file), "utf8"));
  const v = validateScene(raw);
  if (!v.ok) { console.error(`SKIP ${file}: ${v.errors.join(", ")}`); continue; }

  for (const mutation of mutations) {
    const copy = structuredClone(v.scene);
    applyMutation(copy, mutation);
    const outName = file.replace(".json", `--${mutation}.json`);
    writeFileSync(join(OUT_DIR, outName), JSON.stringify({ ...copy, meta: { ...(copy.meta ?? {}), mutation } }, null, 2));
    console.log(`wrote ${outName}`);
  }
}

function applyMutation(scene: ReturnType<typeof validateScene & { ok: true }>["scene"], kind: typeof mutations[number]): void {
  switch (kind) {
    case "gap-too-wide": {
      // Remove the middle floor tile to create a 2-tile gap.
      const mid = Math.floor(scene.pieces.length / 2);
      scene.pieces.splice(mid, 1);
      break;
    }
    case "ledge-too-high": {
      // Raise the last floor tile by 2 — too high to jump.
      const last = scene.pieces.at(-1);
      if (last) last.pos = { ...last.pos, y: last.pos.y + 2 };
      break;
    }
    case "exit-walled-off": {
      // Place a wall on top of the exit goal position.
      const exit = scene.goals.find((g) => g.kind === "exit");
      if (exit) scene.pieces.push({ kind: "wall", pos: exit.pos, rot: 0 });
      break;
    }
  }
}
