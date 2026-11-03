// `pnpm --filter @umbra/agents haunt "<brief>" <out.json | name>`: build a level from a brief,
// playtest it, fix what is found, and write the scene. Needs GEMINI_API_KEY (.env works).
// A bare name writes games/lantern/public/levels/<name>.json, playable at Lantern's ?scene=<name>.
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_GEMINI_MODEL, geminiGenerate, geminiPlannerWithFallback, loadEnv } from "./gemini.js";
import { runLoop } from "./loop.js";

loadEnv();
const [brief, out] = process.argv.slice(2);
const name = out && /^[\w-]+$/.test(out) ? out : undefined;
if (!brief || !(name || out?.endsWith(".json"))) { console.error('usage: haunt "<brief>" <out.json | level-name>'); process.exit(2); }
const key = process.env["GEMINI_API_KEY"];
if (!key) { console.error("GEMINI_API_KEY is not set (shell or repo-root .env)"); process.exit(2); }
const model = process.env["GEMINI_MODEL"] ?? DEFAULT_GEMINI_MODEL;
console.error(`model: ${model}`);
const generate = geminiGenerate(key, model);
const result = await runLoop(brief, generate, { planner: geminiPlannerWithFallback(generate) });
// pnpm --filter runs from packages/agents; INIT_CWD is where the user ran the command.
const path = name ? fileURLToPath(new URL(`../../../games/lantern/public/levels/${name}.json`, import.meta.url))
  : resolve(process.env["INIT_CWD"] ?? ".", out!);
await mkdir(dirname(path), { recursive: true });
await writeFile(path, JSON.stringify(result.scene, null, 2) + "\n");
// Each fix's before/after replays go to Studio (apps/studio/public/fixes/).
const base = name ?? basename(path, ".json");
const fixes = await Promise.all(result.fixes.map(async ({ evidence, finding: { inputs: _i, ...finding }, ...fix }, i) => {
  if (!evidence) return { finding, ...fix };
  const file = `${base}-fix-${i + 1}.json`;
  const dest = fileURLToPath(new URL(`../../../apps/studio/public/fixes/${file}`, import.meta.url));
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(evidence) + "\n");
  return { finding, ...fix, studio: `?replay=/fixes/${file}` };
}));
const strip = (fs: typeof result.unresolved) => fs.map(({ inputs: _i, ...f }) => f);
console.log(JSON.stringify({ build: result.build, initialFindings: strip(result.initialFindings), fixes,
  unresolved: strip(result.unresolved), wrote: path }, null, 2));
if (fixes.some((f) => "studio" in f)) console.error("see fixes: pnpm --filter @umbra/studio dev, then add a fix's studio query to its URL (Lantern may hold port 5173)");
if (name) console.error(`play it: pnpm --filter @umbra/lantern dev, then open http://127.0.0.1:5173/?scene=${name}`);
process.exit(result.unresolved.length ? 1 : 0);
