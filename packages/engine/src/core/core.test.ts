import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { z } from "zod";
import {
  createGame, createRng, defineComponent, defineEvent, defineGame, defineResource, recordReplay, runGame,
  saveScene, spawnScene, verifyReplay, World, canonicalJson, type Plugin,
} from "./index.js";

const Pos = defineComponent("pos", z.object({ x: z.number().int(), y: z.number().int() }));
const Hp = defineComponent("hp", z.number().int().min(0));
const Score = defineResource("score", z.number().int(), () => 0);
const Hit = defineEvent("hit", z.object({ target: z.number().int() }));
const world = (seed = 1) => new World({ seed, components: [Pos, Hp], resources: [Score], events: [Hit] });

describe("rng", () => {
  it("repeats per seed, differs across seeds, and stays in range", () => {
    const seq = (s: number) => { const r = createRng(s); return Array.from({ length: 20 }, () => r.int(1000)); };
    expect(seq(5)).toEqual(seq(5));
    expect(seq(5)).not.toEqual(seq(6));
    const r = createRng(9);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(-3, 3);
      expect(Number.isInteger(v) && v >= -3 && v <= 3).toBe(true);
    }
    expect(() => r.int(0)).toThrow();
  });

  it("resumes from a saved state", () => {
    const a = createRng(3); a.int(10); const s = a.state();
    const next = a.int(1_000_000);
    const b = createRng(99); b.setState(s);
    expect(b.int(1_000_000)).toBe(next);
  });
});

describe("world", () => {
  it("queries in ascending entity order and validates on set", () => {
    const w = world();
    const a = w.spawn(Pos({ x: 1, y: 1 }), Hp(3));
    const b = w.spawn(Hp(5));
    const c = w.spawn(Pos({ x: 2, y: 0 }), Hp(1));
    expect([...w.query(Hp)].map(([e]) => e)).toEqual([a, b, c]);
    expect([...w.query(Pos, Hp)]).toEqual([[a, { x: 1, y: 1 }, 3], [c, { x: 2, y: 0 }, 1]]);
    expect(w.first(Pos, Hp)).toEqual([a, { x: 1, y: 1 }, 3]);
    expect(() => w.set(a, Hp, -1)).toThrow();
    w.despawn(b);
    expect(w.exists(b)).toBe(false);
    expect(w.spawn()).toBe(c + 1); // ids are never reused
  });

  it("rejects components, resources and events it was not given", () => {
    const Other = defineComponent("other", z.number());
    const w = world();
    expect(() => w.spawn(Other(1))).toThrow(/not registered/);
    expect(() => new World({ seed: 0, components: [Pos, defineComponent("pos", z.number())] })).toThrow(/two different/);
    expect(() => w.emit(defineEvent("nope", z.number()), 1)).toThrow(/not registered/);
  });

  it("hashes state, not key order or history", () => {
    const a = world(), b = world();
    a.spawn(Pos({ x: 1, y: 2 }));
    b.spawn(Pos({ y: 2, x: 1 } as { x: number; y: number }));
    expect(a.hash()).toBe(b.hash());
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    a.get(1, Pos)!.x = 9; // in-place mutation counts
    expect(a.hash()).not.toBe(b.hash());
    a.setResource(Score, 1);
    const before = a.hash();
    a.rng.int(5); // rng state counts too
    expect(a.hash()).not.toBe(before);
  });

  it("saves and loads a deep copy, including entities without components", () => {
    const w = world();
    w.spawn(Pos({ x: 1, y: 1 }));
    const bare = w.spawn();
    w.setResource(Score, 4);
    const saved = w.save();
    const h = w.hash();
    w.get(1, Pos)!.x = 50; w.despawn(bare); w.setResource(Score, 0); w.rng.int(9);
    w.load(saved);
    expect(w.hash()).toBe(h);
    expect(w.exists(bare)).toBe(true);
    w.get(1, Pos)!.x = 7;
    expect(saved.components["pos"]![0]![1]).toEqual({ x: 1, y: 1 }); // the save is not aliased
  });
});

// A small game: units walk right one cell per tick; the "attack" input damages a random unit.
const walkers = defineGame({
  name: "walkers",
  version: "1",
  input: z.object({ attack: z.boolean() }),
  level: z.object({ units: z.number().int().min(1).max(20) }),
  components: [Pos, Hp], resources: [Score], events: [Hit],
  setup(w, level) { for (let i = 0; i < level.units; i++) w.spawn(Pos({ x: 0, y: i }), Hp(3)); },
  systems: [
    function walk(w) { for (const [, p] of w.query(Pos)) p.x++; },
    function attack(w, input) {
      if (!input.attack) return;
      const targets = [...w.query(Hp)].map(([e]) => e);
      const t = w.rng.pick(targets);
      if (t === undefined) return;
      const hp = w.get(t, Hp)! - 1;
      if (hp === 0) { w.despawn(t); w.setResource(Score, w.resource(Score) + 1); } else w.set(t, Hp, hp);
      w.emit(Hit, { target: t });
    },
  ],
  outcome: (w) => ([...w.query(Hp)].length === 0 ? "cleared" : w.tick >= 50 ? "timeout" : undefined),
});
const attacks = (n: number, every = 1) => Array.from({ length: n }, (_, i) => ({ attack: i % every === 0 }));

describe("games", () => {
  it("runs the same way every time (property)", async () => {
    await fc.assert(fc.asyncProperty(fc.nat({ max: 2 ** 32 - 1 }), fc.array(fc.boolean(), { maxLength: 40 }), async (seed, xs) => {
      const inputs = xs.map((attack) => ({ attack }));
      const a = await runGame(walkers, { units: 4 }, { seed, inputs });
      const b = await runGame(walkers, { units: 4 }, { seed, inputs });
      return a.finalStateHash === b.finalStateHash && a.tickHashes.join() === b.tickHashes.join();
    }), { numRuns: 100 });
  });

  it("stops at an outcome, records events by tick, and validates inputs and levels", async () => {
    const r = await runGame(walkers, { units: 2 }, { seed: 1, inputs: attacks(100) });
    expect(r.outcome).toBe("cleared");
    expect(r.ticks).toBe(6); // 2 units × 3 hp, one hit per tick
    expect(r.events.map((e) => e.tick)).toEqual([0, 1, 2, 3, 4, 5]);
    const run = await createGame(walkers, { units: 1 });
    expect(() => run.step({ attack: "yes" } as unknown as { attack: boolean })).toThrow();
    await expect(createGame(walkers, { units: 0 })).rejects.toThrow();
    run.dispose();
  });

  it("restores a checkpoint and continues exactly as before", async () => {
    const run = await createGame(walkers, { units: 5 }, { seed: 42 });
    for (let i = 0; i < 4; i++) run.step({ attack: true });
    const cp = run.save();
    const after = [];
    for (let i = 0; i < 6; i++) { run.step({ attack: true }); after.push(run.hash); }
    run.load(cp);
    const again = [];
    for (let i = 0; i < 6; i++) { run.step({ attack: true }); again.push(run.hash); }
    expect(again).toEqual(after);
    run.dispose();
  });

  it("records replays that verify, and catches tampering", async () => {
    const replay = await recordReplay(walkers, { units: 3 }, { seed: 7, inputs: attacks(20, 2), note: "demo" });
    expect(replay.ticks).toBe(17); // 9 hits needed, one every other tick: the last on tick 16
    expect((await verifyReplay(walkers, replay)).ok).toBe(true);
    const tampered = { ...replay, inputs: replay.inputs.map(() => ({ attack: false })) };
    expect((await verifyReplay(walkers, tampered)).ok).toBe(false);
    await expect(verifyReplay(walkers, { ...replay, game: "other" })).rejects.toThrow(/not "walkers"/);
    expect(JSON.parse(JSON.stringify(replay))).toEqual(replay); // plain JSON
  });

  it("orders systems by phase, plugins first, and includes plugin state in hash and checkpoints", async () => {
    const order: string[] = [];
    let counter = 0;
    const plugin: Plugin<{ attack: boolean }, { units: number }> = {
      name: "counter",
      start: () => ({
        systems: [{ name: "count", phase: "physics", run: () => { order.push("plugin:physics"); counter++; } },
          { name: "early", phase: "input", run: () => order.push("plugin:input") }],
        hash: () => counter,
        save: () => counter,
        load: (s) => { counter = s as number; },
      }),
    };
    const game = defineGame({ ...walkers, name: "phased", plugins: [plugin],
      systems: [{ name: "late", phase: "late", run: () => order.push("game:late") }, function upd() { order.push("game:update"); }] });
    const run = await createGame(game, { units: 1 });
    const h0 = run.hash;
    run.step({ attack: false });
    expect(order).toEqual(["plugin:input", "game:update", "plugin:physics", "game:late"]);
    const cp = run.save();
    run.step({ attack: false });
    run.load(cp);
    expect(counter).toBe(1);
    expect(run.hash).not.toBe(h0);
    run.dispose();
    // Minified builds strip or reuse function names; systems still run.
    const ran: number[] = [];
    const anon = await createGame(defineGame({ ...walkers, name: "anon", systems: [() => { ran.push(1); }, Object.defineProperty(() => { ran.push(2); }, "name", { value: "" })] }), { units: 1 });
    anon.step({ attack: false });
    expect(ran).toEqual([1, 2]);
    anon.dispose();
    expect(() => defineGame({ ...walkers, systems: [{ name: "x", phase: "later" as never, run() {} }] })).toThrow(/unknown phase/);
  });
});

describe("scenes", () => {
  it("spawns from prefabs with per-field overrides, and saves back", () => {
    const w = world();
    const ids = spawnScene(w, { entities: [
      { prefab: "soldier", components: { pos: { x: 5 } } },
      { components: { hp: 1 } },
    ] }, { soldier: { pos: { x: 0, y: 2 }, hp: 3 } });
    expect(ids).toEqual([1, 2]);
    expect(w.get(1, Pos)).toEqual({ x: 5, y: 2 });
    expect(saveScene(w)).toEqual({ format: "umbra-scene", entities: [{ components: { hp: 3, pos: { x: 5, y: 2 } } }, { components: { hp: 1 } }] });
    const copy = world();
    spawnScene(copy, saveScene(w));
    expect(copy.hash()).toBe(w.hash());
  });

  it("names the bad field and spawns nothing when a scene is invalid", () => {
    const w = world();
    expect(() => spawnScene(w, { entities: [{ components: { hp: 1 } }, { components: { pos: { x: "a", y: 0 } } }] }))
      .toThrow("entities[1].components.pos.x");
    expect(() => spawnScene(w, { entities: [{ prefab: "ghost" }] })).toThrow(/unknown prefab/);
    expect(() => spawnScene(w, { entities: [{ components: { mana: 1 } }] })).toThrow(/unknown component "mana"/);
    expect(w.entities()).toEqual([]);
  });
});

it("lets the outcome read the tick's events", async () => {
  const Rang = defineEvent("rang", z.null());
  const bell = defineGame({ name: "bell", input: z.boolean(), events: [Rang],
    systems: [function ring(w, on) { if (on) w.emit(Rang, null); }],
    outcome: (w) => (w.events(Rang).length ? "rang" : undefined) });
  const r = await runGame(bell, null, { inputs: [false, false, true, false] });
  expect([r.outcome, r.ticks, r.events.length]).toEqual(["rang", 3, 1]);
});

it("leaves presentation components out of the hash but keeps them in saves", () => {
  const Look = defineComponent("look", z.object({ color: z.string() }), { presentation: true });
  const w = new World({ seed: 0, components: [Pos, Look] });
  const e = w.spawn(Pos({ x: 0, y: 0 }), Look({ color: "red" }));
  const h = w.hash();
  w.set(e, Look, { color: "blue" });
  expect(w.hash()).toBe(h);
  const saved = w.save();
  w.set(e, Look, { color: "green" });
  w.load(saved);
  expect(w.get(e, Look)).toEqual({ color: "blue" });
});
