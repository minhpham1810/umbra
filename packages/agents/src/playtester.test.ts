import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SceneSchema, runSim, type Scene } from "umbra-engine";
import { defaultPlanner, holeCandidates, playtest } from "./playtester.js";
import { geminiPlanner, geminiPlannerWithFallback } from "./gemini.js";

const load = (f: string) => SceneSchema.parse(JSON.parse(readFileSync(
  new URL(`../../../games/lantern/src/${f}`, import.meta.url), "utf8")));
const level1 = load("level.json");
const level2 = load("level-2.json");

it("finds no bugs in the clean Lantern levels", async () => {
  expect(holeCandidates(level1)).toEqual([]); // the gap is marked as pits
  for (const level of [level1, level2]) {
    const report = await playtest(level);
    expect(report.findings).toEqual([]);
    expect(report.skipped).toEqual([]);
  }
}, 120_000);

it("reports a walled-off exit as unreachable, with the navmesh verdict", async () => {
  const { x, z } = level1.goals[0]!.pos;
  const walls = [[-1, 0], [1, 0], [0, -1], [0, 1]].flatMap(([dx, dz]) => [1, 2, 3].map((y) =>
    ({ kind: "wall" as const, pos: { x: x + dx!, y, z: z + dz! }, rot: 0 })));
  const report = await playtest({ ...level1, pieces: [...level1.pieces, ...walls] }, { maxRuns: 20 });
  expect(report.findings).toMatchObject([{ type: "unreachable_goal", goalId: "exit", navRoute: false }]);
}, 120_000);

it("finds a missing floor tile and saves a replay that reproduces the fall", async () => {
  const holed: Scene = { ...level1, pieces: level1.pieces.filter((p) =>
    !(p.kind === "floor" && p.pos.x === 0 && p.pos.z === 4)) };
  process.env["UMBRA_REPLAYS_DIR"] = await mkdtemp(join(tmpdir(), "umbra-replays-"));
  try {
    const report = await playtest(holed, { saveReplays: true });
    expect(report.findings).toMatchObject([{ type: "fall_through", cell: { x: 0, y: 0, z: 4 } }]);
    const replay = JSON.parse(await readFile(join(process.env["UMBRA_REPLAYS_DIR"]!, `${report.findings[0]!.replayId}.json`), "utf8"));
    const rerun = await runSim({ scene: replay.scene, seed: replay.seed, inputs: replay.inputs, maxTicks: replay.inputs.length });
    expect(rerun.outcome).toBe("out_of_bounds");
    expect(rerun.finalStateHash).toBe(replay.finalStateHash);
  } finally { delete process.env["UMBRA_REPLAYS_DIR"]; }
}, 120_000);

it("uses a validated Gemini plan and rejects bad ones", async () => {
  const prompts: string[] = [];
  const planner = geminiPlanner(async (p) => (prompts.push(p), '{"goals":[{"kind":"reach","goalId":"exit"}]}'));
  const report = await playtest(level1, { planner });
  // The model left out the fall check; it still runs, after the model's picks.
  expect(report.plan).toEqual([{ kind: "reach", goalId: "exit" }, { kind: "fall_check" }]);
  expect(prompts[0]).toContain('"id":"exit"');
  const reordered = await geminiPlanner(async () => '{"goals":[{"kind":"fall_check"},{"kind":"fall_check"}]}')(level1);
  expect(reordered).toEqual([{ kind: "fall_check" }, { kind: "reach", goalId: "exit" }]);
  const logs: string[] = [];
  const fallback = await geminiPlannerWithFallback(async () => { throw new Error("503"); }, (m) => logs.push(m))(level1);
  expect(fallback).toEqual(await defaultPlanner(level1));
  expect(logs[0]).toContain("503");
  await expect(playtest(level1, { planner: geminiPlanner(async () => '{"goals":[{"kind":"reach","goalId":"ghost"}]}') }))
    .rejects.toThrow("unknown goals");
  await expect(playtest(level1, { planner: geminiPlanner(async () => "sure! here is a plan") })).rejects.toThrow("not JSON");
}, 60_000);

it("skips plan entries once the wall clock runs out", async () => {
  const report = await playtest(level1, { wallClockMs: -1 });
  expect(report.findings).toEqual([]);
  expect(report.skipped.length).toBe(2);
});

it("reports escapes over one-block walls as out_of_bounds", async () => {
  const low: Scene = { ...level2, pieces: level2.pieces.filter((p) => !(p.kind === "wall" && p.pos.y === 2)) };
  const report = await playtest(low, { planner: async () => [{ kind: "fall_check" }] });
  expect(report.findings.length).toBeGreaterThan(0);
  expect(report.findings.every((f) => f.type === "out_of_bounds")).toBe(true);
}, 120_000);
