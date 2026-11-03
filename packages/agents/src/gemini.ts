/**
 * Gemini-backed Playtester planner. The model only picks and orders test goals;
 * its JSON is validated, and goals not in the scene are rejected.
 */
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { Scene } from "@umbra/engine";
import { TestGoalSchema, defaultPlanner, type Planner, type TestGoal } from "./playtester.js";

// Lite: answered reliably in testing while gemini-3.8-flash returned 503 (high demand).
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/**
 * Sends one prompt, returns the model's text. `schema` is a JSON Schema the model's
 * structured output must follow. Injectable so tests need no network.
 */
export type Generate = (prompt: string, schema: object) => Promise<string>;

/** JSON Schema twin of PlanSchema, so Gemini's structured output returns the right shape. */
const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    goals: {
      type: "array",
      items: {
        type: "object",
        properties: { kind: { type: "string", enum: ["reach", "fall_check"] }, goalId: { type: "string" } },
        required: ["kind"],
      },
    },
  },
  required: ["goals"],
};

export function geminiGenerate(apiKey: string, model = DEFAULT_GEMINI_MODEL, maxOutputTokens = 4096): Generate {
  const ai = new GoogleGenAI({ apiKey });
  return async (prompt, schema) => {
    const res = await ai.models.generateContent({ model, contents: prompt,
      config: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0, maxOutputTokens } });
    if (!res.text) throw new Error("Gemini returned no text");
    return res.text;
  };
}

const PlanSchema = z.object({ goals: z.array(TestGoalSchema).min(1).max(64) });

export function planPrompt(scene: Scene): string {
  const counts: Record<string, number> = {};
  for (const p of scene.pieces) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
  return [
    "You plan playtests for a 3D platformer level. A physics simulator will run each test you list.",
    "Test kinds: {\"kind\":\"reach\",\"goalId\":ID} proves the player can reach a goal;",
    "{\"kind\":\"fall_check\"} walks into every unmarked floor hole to find fall-through bugs.",
    "Order tests from most to least likely to find a bug. Use only goal IDs listed below; any test you omit still runs, last.",
    'Reply with JSON only: {"goals":[...]}.',
    `Level: ${JSON.stringify({ name: scene.meta?.["name"], spawn: scene.spawn.pos, goals: scene.goals, pieceCounts: counts })}`,
  ].join("\n");
}

export function geminiPlanner(generate: Generate): Planner {
  return async (scene) => {
    const plan = PlanSchema.parse(parseJson(await generate(planPrompt(scene), PLAN_JSON_SCHEMA), "plan")).goals;
    const ids = new Set(scene.goals.map((g) => g.id));
    const unknown = plan.filter((g) => g.kind === "reach" && !ids.has(g.goalId));
    if (unknown.length) throw new Error(`Gemini plan names unknown goals: ${JSON.stringify(unknown)}`);
    // The model only orders tests: anything it left out runs after its picks, once each.
    const key = (g: TestGoal) => (g.kind === "reach" ? `reach:${g.goalId}` : g.kind);
    const seen = new Set<string>();
    return [...plan, ...(await defaultPlanner(scene))].filter((g) => {
      if (seen.has(key(g))) return false;
      seen.add(key(g));
      return true;
    });
  };
}

/** geminiPlanner that falls back to the default plan (and says why) if the model call fails. */
export function geminiPlannerWithFallback(generate: Generate, log: (msg: string) => void = console.error): Planner {
  const gemini = geminiPlanner(generate);
  return async (scene) => {
    try { return await gemini(scene); }
    catch (e) { log(`Gemini planning failed, using the default plan: ${(e as Error).message.slice(0, 200)}`); return defaultPlanner(scene); }
  };
}

/** Parse model JSON, naming what was expected in the error. */
export function parseJson(text: string, what: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error(`Gemini ${what} is not JSON: ${text.slice(0, 200)}`); }
}

/** Load the repo-root .env (git-ignored) if there is one; real env vars win. */
export function loadEnv(): void {
  try { process.loadEnvFile(new URL("../../../.env", import.meta.url)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}
