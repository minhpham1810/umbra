/**
 * Gemini-backed Playtester planner. The model only picks and orders test goals;
 * its JSON is validated, and goals not in the scene are rejected.
 */
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { Scene } from "@umbra/engine";
import { TestGoalSchema, type Planner } from "./playtester.js";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/** Sends one prompt, returns the model's text. Injectable so tests need no network. */
export type Generate = (prompt: string) => Promise<string>;

export function geminiGenerate(apiKey: string, model = DEFAULT_GEMINI_MODEL, maxOutputTokens = 1024): Generate {
  const ai = new GoogleGenAI({ apiKey });
  return async (prompt) => {
    const res = await ai.models.generateContent({ model, contents: prompt,
      config: { responseMimeType: "application/json", temperature: 0, maxOutputTokens } });
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
    "Order tests from most to least likely to find a bug. Use only goal IDs listed below.",
    'Reply with JSON only: {"goals":[...]}.',
    `Level: ${JSON.stringify({ name: scene.meta?.["name"], spawn: scene.spawn.pos, goals: scene.goals, pieceCounts: counts })}`,
  ].join("\n");
}

export function geminiPlanner(generate: Generate): Planner {
  return async (scene) => {
    const text = await generate(planPrompt(scene));
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error(`Gemini plan is not JSON: ${text.slice(0, 200)}`); }
    const plan = PlanSchema.parse(raw).goals;
    const ids = new Set(scene.goals.map((g) => g.id));
    const unknown = plan.filter((g) => g.kind === "reach" && !ids.has(g.goalId));
    if (unknown.length) throw new Error(`Gemini plan names unknown goals: ${JSON.stringify(unknown)}`);
    return plan;
  };
}
