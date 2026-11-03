import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SceneSchema, type Scene } from "@umbra/engine";
import { BLUEPRINT_JSON_SCHEMA, buildLevel, compileBlueprint } from "./builder.js";
import { FIX_JSON_SCHEMA, applyEdits, fixFinding } from "./fixer.js";
import type { Generate } from "./gemini.js";
import { holeCandidates, playtest } from "./playtester.js";
import { runLoop } from "./loop.js";

/** A corridor with a 2-cell pit gap to jump. */
const corridor = {
  name: "Gap test",
  floors: [{ x0: -1, z0: 0, x1: 1, z1: 12 }],
  pits: [{ x0: -1, z0: 5, x1: 1, z1: 6 }],
  spawn: { x: 0, z: 1 },
  exit: { x: 0, z: 11 },
};
/** Replies in order; records prompts and checks each call asks for the right schema. */
function fake(replies: [object, unknown][]): Generate & { prompts: string[] } {
  const prompts: string[] = [];
  const gen = async (prompt: string, schema: object) => {
    prompts.push(prompt);
    const next = replies.shift();
    if (!next) throw new Error("fake model: no more replies");
    expect(schema).toBe(next[0]);
    return typeof next[1] === "string" ? next[1] : JSON.stringify(next[1]);
  };
  return Object.assign(gen, { prompts });
}

it("compiles a blueprint into a closed, playable level", async () => {
  const scene = compileBlueprint(corridor);
  expect(holeCandidates(scene)).toEqual([]); // walls close every edge, corners included
  expect(scene.pieces.filter((p) => p.kind === "pit")).toHaveLength(6);
  expect(scene.spawn.pos).toEqual({ x: 0.5, y: 1.72, z: 1.5 });
  expect(scene.goals[0]).toMatchObject({ id: "exit", pos: { x: 0, y: 1, z: 11 } });
  expect((await playtest(scene)).findings).toEqual([]);
}, 60_000);

it("rejects blueprints with semantic errors", () => {
  expect(() => compileBlueprint({ ...corridor, spawn: { x: 0, z: 5 } })).toThrow("spawn (0, 5) is not on a floor cell");
  expect(() => compileBlueprint({ ...corridor, platforms: [{ x: 0, z: 2, axis: "z", distance: 3, speed: 1 }] }))
    .toThrow("moves through floor");
  expect(() => compileBlueprint({ ...corridor, floors: [{ x0: 3, z0: 0, x1: 1, z1: 1 }] })).toThrow();
});

it("feeds compile errors back to the model until the blueprint is valid", async () => {
  const gen = fake([[BLUEPRINT_JSON_SCHEMA, { ...corridor, exit: { x: 9, z: 9 } }], [BLUEPRINT_JSON_SCHEMA, corridor]]);
  const result = await buildLevel("a corridor with a gap", gen);
  expect(result.attempts).toBe(2);
  expect(gen.prompts[1]).toContain("exit (9, 9) is not on a floor cell");
  await expect(buildLevel("x", fake([[BLUEPRINT_JSON_SCHEMA, "no"], [BLUEPRINT_JSON_SCHEMA, "no"], [BLUEPRINT_JSON_SCHEMA, "no"]])))
    .rejects.toThrow("gave up after 3 attempts");
});

const level1 = SceneSchema.parse(JSON.parse(readFileSync(new URL("../../../games/lantern/src/level.json", import.meta.url), "utf8")));
const holed: Scene = { ...level1, pieces: level1.pieces.filter((p) => !(p.kind === "floor" && p.pos.x === 0 && p.pos.z === 4)) };

it("accepts a fix only when the bug stops reproducing and nothing new breaks", async () => {
  const baseline = await playtest(holed);
  const finding = baseline.findings[0]!;
  const gen = fake([
    [FIX_JSON_SCHEMA, { reason: "wrong cell", edits: [{ op: "add_floor", x: 0, y: 0, z: 9 }] }],
    // Fills the hole but opens a new one elsewhere.
    [FIX_JSON_SCHEMA, { reason: "swap", edits: [{ op: "add_floor", x: 0, y: 0, z: 4 }, { op: "remove", x: 2, y: 0, z: 10 }] }],
    [FIX_JSON_SCHEMA, { reason: "fill the hole", edits: [{ op: "add_floor", x: 0, y: 0, z: 4 }] }],
  ]);
  const r = await fixFinding(holed, finding, baseline, gen);
  expect(r.fixed).toBe(true);
  expect(r.attempts).toBe(3);
  expect(r.feedback[0]).toContain("still reproduces");
  expect(r.feedback[1]).toContain("introduced fall_through at (2,0,10)");
  expect(gen.prompts[2]).toContain("Previous attempts failed");
  expect(r.report!.findings).toEqual([]);
}, 120_000);

it("applies edits and replaces a pit marker when floor fills it", () => {
  const scene = applyEdits(level1, [{ op: "add_floor", x: 0, y: 0, z: 7 }, { op: "remove", x: 4, y: 1, z: 3 }]);
  expect(scene.pieces.some((p) => p.kind === "pit" && p.pos.x === 0 && p.pos.z === 7)).toBe(false);
  expect(scene.pieces.some((p) => p.kind === "floor" && p.pos.x === 0 && p.pos.z === 7)).toBe(true);
  expect(scene.pieces.some((p) => p.pos.x === 4 && p.pos.y === 1 && p.pos.z === 3)).toBe(false);
});

it("runs the loop: build, playtest, fix, clean", async () => {
  // A 5-cell gap is too wide to jump; the Fixer adds a stepping-stone row in the middle.
  const stone = [-1, 0, 1].map((x) => ({ op: "add_floor", x, y: 0, z: 6 }));
  const gen = fake([
    [BLUEPRINT_JSON_SCHEMA, { ...corridor, pits: [{ x0: -1, z0: 4, x1: 1, z1: 8 }] }],
    [FIX_JSON_SCHEMA, { reason: "stepping stone", edits: stone }],
  ]);
  const result = await runLoop("a corridor with a gap", gen, { playtest: { maxRuns: 60 } });
  expect(result.initialFindings).toMatchObject([{ type: "unreachable_goal", goalId: "exit" }]);
  expect(result.fixes).toMatchObject([{ edits: stone, attempts: 1 }]);
  expect(result.unresolved).toEqual([]);
  expect(result.scene.pieces.filter((p) => p.kind === "pit")).toHaveLength(12);
}, 120_000);
