// `pnpm --filter @umbra/agents playtest <scene.json>`: prints a JSON playtest report.
// Uses Gemini to plan when GEMINI_API_KEY is set (model: GEMINI_MODEL), else tests everything.
import { readFile } from "node:fs/promises";
import { SceneSchema } from "@umbra/engine";
import { DEFAULT_GEMINI_MODEL, geminiGenerate, geminiPlanner } from "./gemini.js";
import { playtest } from "./playtester.js";

const file = process.argv[2];
if (!file) { console.error("usage: playtest <scene.json>"); process.exit(2); }
const scene = SceneSchema.parse(JSON.parse(await readFile(file, "utf8")));
const key = process.env["GEMINI_API_KEY"];
const planner = key ? geminiPlanner(geminiGenerate(key, process.env["GEMINI_MODEL"] ?? DEFAULT_GEMINI_MODEL)) : undefined;
console.error(planner ? "planner: gemini" : "planner: default (set GEMINI_API_KEY to use Gemini)");
const report = await playtest(scene, { saveReplays: true, ...(planner ? { planner } : {}) });
console.log(JSON.stringify(report, null, 2));
process.exit(report.findings.length ? 1 : 0);
