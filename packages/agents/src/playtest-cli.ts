// `pnpm --filter @umbra/agents playtest <scene.json>`: prints a JSON playtest report.
// Uses Gemini to plan when GEMINI_API_KEY is set (model: GEMINI_MODEL), else tests everything.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SceneSchema } from "@umbra/engine";
import { DEFAULT_GEMINI_MODEL, geminiGenerate, geminiPlanner } from "./gemini.js";
import { defaultPlanner, playtest, type Planner } from "./playtester.js";

// Load the repo-root .env (git-ignored) if there is one; real env vars win.
try { process.loadEnvFile(new URL("../../../.env", import.meta.url)); }
catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }

const file = process.argv[2];
if (!file) { console.error("usage: playtest <scene.json>"); process.exit(2); }
// pnpm --filter runs from packages/agents; INIT_CWD is where the user ran the command.
const scene = SceneSchema.parse(JSON.parse(await readFile(resolve(process.env["INIT_CWD"] ?? ".", file), "utf8")));
const key = process.env["GEMINI_API_KEY"];
const model = process.env["GEMINI_MODEL"] ?? DEFAULT_GEMINI_MODEL;
const gemini = key ? geminiPlanner(geminiGenerate(key, model)) : undefined;
// The plan only orders tests, so a busy or failing model falls back to testing everything.
const planner: Planner | undefined = gemini && (async (s) => {
  try { return await gemini(s); }
  catch (e) { console.error(`Gemini planning failed, using the default plan: ${(e as Error).message.slice(0, 200)}`); return defaultPlanner(s); }
});
console.error(planner ? `planner: gemini (${model})` : "planner: default (set GEMINI_API_KEY to use Gemini)");
const report = await playtest(scene, { saveReplays: true, ...(planner ? { planner } : {}) });
console.log(JSON.stringify(report, null, 2));
process.exit(report.findings.length ? 1 : 0);
