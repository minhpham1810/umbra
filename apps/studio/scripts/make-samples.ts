// `pnpm --filter @umbra/studio samples`: regenerate the bundled sample replays
// (public/replays/*.json + index.json) with the real agents.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SceneSchema, runSim, type InputFrame, type Replay, type Scene } from "umbra-engine";
import { fixEvidence, fixFinding, playtest, playtestGame, searchReach, type AgentGame } from "umbra-agents";
import { collectAgent, roomAgent } from "../../../packages/agents/examples/games.js";

const out = new URL("../public/replays/", import.meta.url);
const level = (f: string) => SceneSchema.parse(JSON.parse(readFileSync(new URL(`../../../games/lantern/src/${f}`, import.meta.url), "utf8")));
const index: { file: string; title: string; note: string }[] = [];

async function save(id: string, title: string, scene: Scene, inputs: InputFrame[], note: string) {
  const { finalStateHash } = await runSim({ scene, seed: 0, inputs, maxTicks: inputs.length });
  const replay: Replay = { id, rapierVersion: scene.rapierVersion, scene, seed: 0, inputs, finalStateHash,
    createdAt: new Date().toISOString(), note };
  writeFileSync(new URL(`${id}.json`, out), JSON.stringify(replay));
  index.push({ file: `${id}.json`, title, note });
  console.log(`wrote ${id}.json (${inputs.length} ticks)`);
}

// Any defineGame game: the generic playtester's proof that a level can be won.
for (const [id, title, agent, level] of [
  ["room-win", "Room: crate and ledge (3D)", roomAgent, null],
  ["collect-win", "Collect: five coins (2D)", collectAgent, collectAgent.levels!["playground"]],
] as [string, string, AgentGame, unknown][]) {
  const report = await playtestGame(agent, level, { fuzzRuns: 2 });
  const replay = report.reached[0];
  if (!replay || report.findings.length) throw new Error(`${id}: ${JSON.stringify(report.findings)}`);
  const note = `playtestGame found no bugs and searched out this win (${replay.ticks} ticks).`;
  writeFileSync(new URL(`${id}.json`, out), JSON.stringify({ ...replay, note }));
  index.push({ file: `${id}.json`, title, note });
  console.log(`wrote ${id}.json (${replay.ticks} ticks)`);
}

for (const [id, title, file, note] of [
  ["lantern-1-win", "Lantern 1: jump the gap", "level.json", "searchReach found a winning route: walk, then jump the broken floor."],
  ["lantern-2-ride", "Lantern 2: ride the ferry", "level-2.json", "searchReach found a route across the chasm using the moving platform."],
] as const) {
  const scene = level(file);
  const r = await searchReach(scene, "exit", 300);
  if (!r.reached) throw new Error(`${id}: exit not reached`);
  await save(id, title, scene, r.inputs, note);
}

// A seeded bug: one floor tile removed. The Playtester's fall check finds it.
const lvl1 = level("level.json");
const holed = { ...lvl1, pieces: lvl1.pieces.filter((p) => !(p.kind === "floor" && p.pos.x === 0 && p.pos.z === 4)),
  meta: { ...lvl1.meta, name: "Lantern 1 with a missing tile" } };
const tmp = mkdtempSync(join(tmpdir(), "umbra-samples-"));
process.env["UMBRA_REPLAYS_DIR"] = tmp;
try {
  const report = await playtest(holed, { planner: async () => [{ kind: "fall_check" }], saveReplays: true });
  const f = report.findings[0];
  if (!f?.replayId) throw new Error("fall-through sample: Playtester found nothing");
  const saved = JSON.parse(readFileSync(join(tmp, `${f.replayId}.json`), "utf8")) as Replay;
  await save("lantern-1-fall-through", "Bug: fall-through", holed, saved.inputs, saved.note ?? f.detail);

  // The same bug fixed. The Fixer's reply is scripted here so samples build without a Gemini key;
  // acceptance (bug gone, nothing new) is still checked by a real playtest.
  const reply = JSON.stringify({ reason: "Fill the missing floor tile.", edits: [{ op: "add_floor", x: 0, y: 0, z: 4 }] });
  const fixed = await fixFinding(holed, f, report, async () => reply);
  if (!fixed.fixed) throw new Error(`fix sample: fix rejected: ${fixed.feedback.join("; ")}`);
  const evidence = await fixEvidence(holed, fixed.scene, f, fixed.edits, fixed.reason);
  writeFileSync(new URL("lantern-1-fix.json", out), JSON.stringify(evidence));
  index.push({ file: "lantern-1-fix.json", title: "Fix: fill the hole", note: "Before and after the Fixer's edit, same inputs." });
  console.log("wrote lantern-1-fix.json");
} finally { rmSync(tmp, { recursive: true, force: true }); }

writeFileSync(new URL("index.json", out), JSON.stringify(index, null, 2) + "\n");
