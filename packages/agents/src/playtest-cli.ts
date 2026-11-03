// `pnpm --filter @umbra/agents playtest <scene.json>`: prints a JSON playtest report.
// Uses Gemini to plan when GEMINI_API_KEY is set (model: GEMINI_MODEL), else tests everything.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SceneSchema } from "@umbra/engine";
import { DEFAULT_GEMINI_MODEL, geminiGenerate, geminiPlanner, loadEnv } from "./gemini.js";
import { defaultPlanner, playtest, type Planner } from "./playtester.js";
import { MansionSchema } from "@umbra/engine";
import { playtestMansion } from "./strategy.js";

loadEnv();

const file = process.argv[2];
if (!file) { console.error("usage: playtest <scene.json>"); process.exit(2); }
// pnpm --filter runs from packages/agents; INIT_CWD is where the user ran the command.
const raw: unknown = JSON.parse(await readFile(resolve(process.env["INIT_CWD"] ?? ".", file), "utf8"));
// A Boo & Co. mansion (it has tiles) gets the balance playtest instead.
if (typeof raw === "object" && raw !== null && "tiles" in raw) {
  const { findings, strategy } = playtestMansion(MansionSchema.parse(raw));
  console.log(JSON.stringify({ findings, best: { scares: strategy.best.scares, plan: strategy.best.plan },
    bestByPool: Object.fromEntries(Object.entries(strategy.bestByPool).map(([k, v]) => [k, v.scares])), runs: strategy.runs }, null, 2));
  process.exit(findings.length ? 1 : 0);
}
const scene = SceneSchema.parse(raw);
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
