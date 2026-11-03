// `pnpm --filter @umbra/agents playtest <scene.json>`: prints a JSON playtest report.
// Uses Gemini to plan when GEMINI_API_KEY is set (model: GEMINI_MODEL), else tests everything.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SceneSchema } from "@umbra/engine";
import { DEFAULT_GEMINI_MODEL, geminiGenerate, geminiPlannerWithFallback, loadEnv } from "./gemini.js";
import { playtest } from "./playtester.js";

loadEnv();

const file = process.argv[2];
if (!file) { console.error("usage: playtest <scene.json>"); process.exit(2); }
// pnpm --filter runs from packages/agents; INIT_CWD is where the user ran the command.
const raw: unknown = JSON.parse(await readFile(resolve(process.env["INIT_CWD"] ?? ".", file), "utf8"));
// Boo & Co. mansions have their own balance playtest: `pnpm --filter @umbra/boo-and-co playtest`.
if (typeof raw === "object" && raw !== null && "tiles" in raw) {
  console.error("this is a Boo & Co. mansion; run `pnpm --filter @umbra/boo-and-co playtest <mansion.json>`");
  process.exit(2);
}
const scene = SceneSchema.parse(raw);
const key = process.env["GEMINI_API_KEY"];
const model = process.env["GEMINI_MODEL"] ?? DEFAULT_GEMINI_MODEL;
// The plan only orders tests, so a busy or failing model falls back to testing everything.
const planner = key ? geminiPlannerWithFallback(geminiGenerate(key, model)) : undefined;
console.error(planner ? `planner: gemini (${model})` : "planner: default (set GEMINI_API_KEY to use Gemini)");
const report = await playtest(scene, { saveReplays: true, ...(planner ? { planner } : {}) });
console.log(JSON.stringify({ ...report, findings: report.findings.map(({ inputs: _i, ...f }) => f) }, null, 2));
process.exit(report.findings.length ? 1 : 0);
