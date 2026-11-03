// `pnpm --filter @umbra/agents haunt "<brief>" <out.json>`: build a level from a brief,
// playtest it, fix what is found, and write the scene. Needs GEMINI_API_KEY (.env works).
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_GEMINI_MODEL, geminiGenerate, loadEnv } from "./gemini.js";
import { runLoop } from "./loop.js";

loadEnv();
const [brief, out] = process.argv.slice(2);
if (!brief || !out?.endsWith(".json")) { console.error('usage: haunt "<brief>" <out.json>'); process.exit(2); }
const key = process.env["GEMINI_API_KEY"];
if (!key) { console.error("GEMINI_API_KEY is not set (shell or repo-root .env)"); process.exit(2); }
const model = process.env["GEMINI_MODEL"] ?? DEFAULT_GEMINI_MODEL;
console.error(`model: ${model}`);
const result = await runLoop(brief, geminiGenerate(key, model));
// pnpm --filter runs from packages/agents; INIT_CWD is where the user ran the command.
const path = resolve(process.env["INIT_CWD"] ?? ".", out);
await writeFile(path, JSON.stringify(result.scene, null, 2) + "\n");
const { scene: _scene, ...summary } = result;
console.log(JSON.stringify({ ...summary, wrote: path }, null, 2));
process.exit(result.unresolved.length ? 1 : 0);
