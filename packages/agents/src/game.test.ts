import { expect, it } from "vitest";
import { defineComponent, defineGame, runGame, verifyReplay, z, type World } from "umbra-engine";
import { observeAt, playtestGame, searchOutcome, type AgentGame } from "./game.js";
import { snake } from "../../engine/examples/snake/snake.js";
import { collect } from "../../engine/examples/collect/collect.js";
import { collectAgent, games, snakeAgent } from "../examples/games.js";

it("finds a winning route by branching from checkpoints, and it replays", async () => {
  const level = { width: 8, height: 8, goal: 4 };
  const r = await searchOutcome(snakeAgent, level, { seed: 5 });
  expect(r.found).toBe(true);
  const p = await playtestGame(collectAgent, { w: 6, h: 4, goal: 3 }, { seed: 2, fuzzRuns: 2 });
  expect(p.findings).toEqual([]);
  expect(p.reached).toHaveLength(1);
  expect((await verifyReplay(collect, p.reached[0])).ok).toBe(true);
});

it("wins every example game, physics included, by search alone", async () => {
  for (const g of games) {
    const level = Object.values(g.levels!)[0];
    const r = await searchOutcome(g, level, { budget: 50_000 });
    expect([g.game.name, r.found]).toEqual([g.game.name, true]);
    expect((await runGame(g.game, level, { inputs: r.inputs })).outcome).toBe("win");
  }
});

it("explores without a score, and reports what it ran into", async () => {
  const { score: _, ...blind } = snakeAgent;
  const r = await searchOutcome(blind, { width: 6, height: 6, goal: 30 }, { budget: 3000 });
  expect(r).toMatchObject({ found: false, stopped: "budget" });
  expect(r.otherOutcomes["dead"]).toBeGreaterThan(0);
});

it("observes a run as plain JSON", async () => {
  const o = await observeAt(collect, { w: 6, h: 4, goal: 3 }, { inputs: [{ x: 1, y: 0 }, { x: 1, y: 0 }], atTick: 2, components: ["player", "transform"] });
  expect(o.tick).toBe(2);
  expect(o.entities).toHaveLength(5); // camera, arena, player, score text, coin all have a Transform
  expect(o.entities.find((e) => e.id === 3)).toEqual({ id: 3, components: { player: { speed: 6 }, transform: { position: { x: 0.2, y: 0, z: 0 } } } });
  expect(o.resources).toEqual({ score: 0 });
});

// Three bugs agents should catch, one per game.
const Step = defineComponent("step", z.number().int());
const buggy = (name: string, run: (w: World, input: number) => void) => ({
  game: defineGame<number>({ name, input: z.number().int(), components: [Step], setup: (w) => { w.spawn(Step(0)); }, systems: [{ name: "bug", run }],
    outcome: (w) => (w.first(Step)![1] >= 50 ? "win" : undefined) }),
  moves: [0, 1, 2],
});
const count = (w: World) => { const [e, n] = w.first(Step)!; w.set(e, Step, n + 1); };

it("catches crashes, nondeterminism and state kept outside the world", async () => {
  const crash = await playtestGame(buggy("crashy", (w, i) => { count(w); if (i === 2 && w.first(Step)![1] > 20) throw new Error("boom"); }), null, { fuzzRuns: 2, fuzzTicks: 40 });
  expect(crash.findings[0]).toMatchObject({ type: "crash", detail: expect.stringMatching(/boom/) });
  expect(crash.findings[0]!.inputs!.at(-1)).toBe(2);

  const noisy = await playtestGame(buggy("noisy", (w) => { const [e, n] = w.first(Step)!; w.set(e, Step, n + (Math.random() < 0.5 ? 1 : 2)); }), null, { fuzzRuns: 1, fuzzTicks: 40 });
  expect(noisy.findings.map((f) => f.type)).toContain("nondeterministic");

  let outside = 0;
  const leaky = await playtestGame(buggy("leaky", (w) => { outside++; if (outside % 7 === 0) count(w); count(w); }), null, { fuzzRuns: 1, fuzzTicks: 40, expect: [] });
  expect(leaky.findings.map((f) => f.type)).toContain("checkpoint_mismatch");

  const ok = await playtestGame(buggy("fine", count), null, { fuzzRuns: 2, fuzzTicks: 40, expect: ["win", "lose"] });
  expect(ok.findings).toEqual([expect.objectContaining({ type: "unreachable_outcome", outcome: "lose" })]);
});
