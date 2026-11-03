/**
 * Boo & Co. mansion simulation: a deterministic, integer-only grid sim.
 *
 * Visitors enter at E and walk the shortest path to X, one per cell. Ghosts scare
 * visitors within range; traps scare whoever steps on them. A visitor whose fear
 * reaches their bravery flees back to E at double speed. Visitors never swap cells,
 * so fleeing visitors can jam a one-wide hallway head-on: a crowd deadlock.
 * Win: total scares >= quota when time runs out.
 */
import { z } from "zod";

export const BUILD_KINDS = ["ghost", "trap"] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];
/** cost: coins; range: Chebyshev cells (0 = its own cell); scare: fear added; cooldown: ticks. */
export const CATALOG: Record<BuildKind, { cost: number; range: number; scare: number; cooldown: number }> = {
  // Balanced with searchStrategy: at trap cooldown 180 and ghost cost 30, all-trap plans
  // beat every plan with a ghost (220 vs 177 scares). Now single-kind plans peak near 114
  // and mixed plans reach about 160.
  ghost: { cost: 25, range: 2, scare: 1, cooldown: 30 },
  trap: { cost: 20, range: 0, scare: 2, cooldown: 360 },
};
const BuildStatsSchema = z.object({
  cost: z.number().int().min(0).max(10_000), range: z.number().int().min(0).max(8),
  scare: z.number().int().min(0).max(100), cooldown: z.number().int().min(1).max(36_000),
}).partial();

export const MansionSchema = z.object({
  version: z.number().int().default(1),
  name: z.string().default("Mansion"),
  /** Rows of tiles: '#' wall, '.' floor, 'E' entrance, 'X' exit. */
  tiles: z.array(z.string().regex(/^[#.EX]+$/)).min(3).max(48),
  budget: z.number().int().min(0).max(100_000),
  quota: z.number().int().min(1).max(100_000),
  durationTicks: z.number().int().min(60).max(60 * 60 * 30),
  /** A visitor arrives every `spawnEvery` ticks while the entrance cell is free. */
  spawnEvery: z.number().int().min(10).max(6000).default(120),
  maxVisitors: z.number().int().min(1).max(500).default(60),
  /** Entry fee per admitted visitor, in coins. */
  fee: z.number().int().min(0).max(1000).default(5),
  seed: z.number().int().min(0).max(2 ** 32 - 1).default(1),
  /** Per-mansion overrides of CATALOG build stats (used by balance mutations). */
  catalog: z.object({ ghost: BuildStatsSchema, trap: BuildStatsSchema }).partial().optional(),
}).superRefine((m, ctx) => {
  if (m.tiles.some((r) => r.length !== m.tiles[0]!.length)) ctx.addIssue({ code: "custom", message: "all rows must have the same length", path: ["tiles"] });
  const count = (c: string) => m.tiles.join("").split(c).length - 1;
  if (count("E") !== 1) ctx.addIssue({ code: "custom", message: "exactly one entrance 'E' required", path: ["tiles"] });
  if (count("X") !== 1) ctx.addIssue({ code: "custom", message: "exactly one exit 'X' required", path: ["tiles"] });
});
export type Mansion = z.infer<typeof MansionSchema>;

export const PlacementSchema = z.object({
  kind: z.enum(BUILD_KINDS), x: z.number().int().min(0), y: z.number().int().min(0),
  /** Tick the build appears; placements are applied in (tick, list) order. */
  tick: z.number().int().min(0).default(0),
});
export type Placement = z.infer<typeof PlacementSchema>;
/** A placement as written by callers: `tick` is optional (default 0). */
export type PlacementInput = z.input<typeof PlacementSchema>;

const WALK_EVERY = 15; // ticks per cell (4 cells/s at 60 ticks/s)
const FLEE_EVERY = 8;
const STUCK_TICKS = 300; // a visitor blocked this long counts as deadlocked

export interface Visitor { id: number; x: number; y: number; fear: number; bravery: number; fleeing: boolean; wait: number; moveIn: number }
export interface Build { kind: BuildKind; x: number; y: number; ready: number }
export type MansionEvent =
  | { tick: number; kind: "placed"; build: BuildKind; x: number; y: number }
  | { tick: number; kind: "rejected"; build: BuildKind; x: number; y: number; reason: string }
  | { tick: number; kind: "scare"; visitor: number; by: BuildKind; x: number; y: number; amount: number }
  | { tick: number; kind: "fled" | "exited" | "admitted"; visitor: number }
  | { tick: number; kind: "deadlock"; visitor: number; x: number; y: number };

export interface MansionResult {
  outcome: "win" | "lose";
  scares: number; quota: number; coins: number; spent: number;
  admitted: number; exited: number; fled: number;
  /** Visitors blocked for STUCK_TICKS or more at the end. */
  deadlocked: number;
  events: MansionEvent[];
  finalStateHash: number;
}

export function createMansion(raw: Mansion) {
  const m = MansionSchema.parse(raw);
  const H = m.tiles.length, W = m.tiles[0]!.length;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? "#" : m.tiles[y]![x]!);
  const find = (c: string) => { const i = m.tiles.join("").indexOf(c); return { x: i % W, y: Math.floor(i / W) }; };
  const entrance = find("E"), exit = find("X");

  // Distance fields by BFS in a fixed neighbour order: deterministic shortest paths.
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  function field(goal: { x: number; y: number }): Int32Array {
    const d = new Int32Array(W * H).fill(-1);
    d[goal.y * W + goal.x] = 0;
    const q = [goal];
    for (let i = 0; i < q.length; i++) {
      const c = q[i]!;
      for (const [dx, dy] of DIRS) {
        const nx = c.x + dx, ny = c.y + dy;
        if (at(nx, ny) === "#" || d[ny * W + nx] !== -1) continue;
        d[ny * W + nx] = d[c.y * W + c.x]! + 1;
        q.push({ x: nx, y: ny });
      }
    }
    return d;
  }
  const toExit = field(exit), toEntrance = field(entrance);
  const catalog = buildCatalog(m);
  if (toExit[entrance.y * W + entrance.x] === -1) throw new Error("the exit is not reachable from the entrance");

  let rng = m.seed >>> 0;
  const rand = (n: number) => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng % n; };

  const visitors: Visitor[] = [];
  const builds: Build[] = [];
  const events: MansionEvent[] = [];
  const pending: Placement[] = [];
  const tickHashes: number[] = [];
  let tick = 0, nextId = 1, spawnIn = 0;
  let scares = 0, spent = 0, admitted = 0, exited = 0, fled = 0;

  const occupied = (x: number, y: number) => visitors.some((v) => v.x === x && v.y === y);

  function place(p: Placement): string | undefined {
    const c = catalog[p.kind];
    if (at(p.x, p.y) !== ".") return "builds go on floor tiles";
    if (builds.some((b) => b.x === p.x && b.y === p.y)) return "cell already has a build";
    if (spent + c.cost > m.budget) return `not enough coins (${m.budget - spent} left, costs ${c.cost})`;
    spent += c.cost;
    builds.push({ kind: p.kind, x: p.x, y: p.y, ready: tick });
    return undefined;
  }

  function hash(): number {
    let h = 2166136261;
    const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
    mix(tick); mix(scares); mix(spent); mix(rng);
    for (const v of visitors) { mix(v.id); mix(v.x); mix(v.y); mix(v.fear); mix(v.fleeing ? 1 : 0); mix(v.wait); mix(v.moveIn); }
    for (const b of builds) { mix(b.x); mix(b.y); mix(b.ready); }
    return h >>> 0;
  }

  function step(): void {
    if (tick >= m.durationTicks) return;
    // 1. builds due this tick, in list order
    for (const p of pending.filter((q) => q.tick <= tick)) {
      pending.splice(pending.indexOf(p), 1);
      const reason = place(p);
      events.push(reason ? { tick, kind: "rejected", build: p.kind, x: p.x, y: p.y, reason }
        : { tick, kind: "placed", build: p.kind, x: p.x, y: p.y });
    }
    // 2. arrivals
    if (spawnIn-- <= 0 && admitted < m.maxVisitors && !occupied(entrance.x, entrance.y)) {
      const v = { id: nextId++, ...entrance, fear: 0, bravery: 2 + rand(3), fleeing: false, wait: 0, moveIn: WALK_EVERY };
      visitors.push(v);
      admitted++;
      events.push({ tick, kind: "admitted", visitor: v.id });
      spawnIn = m.spawnEvery;
    }
    // 3. movement, in visitor-id order; no swaps, so head-on meetings block
    for (const v of visitors) {
      if (--v.moveIn > 0) continue;
      const d = v.fleeing ? toEntrance : toExit;
      const here = d[v.y * W + v.x]!;
      // Closest free neighbour that is no farther from the goal; once blocked, also a free
      // sidestep one cell farther, to shuffle around oncoming visitors. A one-wide hallway
      // has no side cells, so head-on visitors block there: a crowd deadlock.
      let best: { x: number; y: number } | undefined;
      let bestD = here + (v.wait > 0 ? 2 : 1);
      for (const [dx, dy] of DIRS) {
        const nx = v.x + dx, ny = v.y + dy;
        // Check the tile first: an out-of-range x would wrap into the next row of `d`.
        if (at(nx, ny) === "#" || occupied(nx, ny)) continue;
        const nd = d[ny * W + nx]!;
        if (nd >= 0 && nd < bestD) { best = { x: nx, y: ny }; bestD = nd; }
      }
      if (best) {
        v.x = best.x; v.y = best.y; v.wait = 0;
        for (const b of builds) {
          if (b.kind === "trap" && b.x === v.x && b.y === v.y && b.ready <= tick) scare(v, b);
        }
      } else {
        v.wait++;
        if (v.wait === Math.ceil(STUCK_TICKS / (v.fleeing ? FLEE_EVERY : WALK_EVERY))) {
          events.push({ tick, kind: "deadlock", visitor: v.id, x: v.x, y: v.y });
        }
      }
      v.moveIn = v.fleeing ? FLEE_EVERY : WALK_EVERY;
    }
    // 4. ghosts scare the nearest visitor in range (lowest id breaks ties)
    for (const b of builds) {
      if (b.kind !== "ghost" || b.ready > tick) continue;
      const c = catalog.ghost;
      const target = visitors.filter((v) => !v.fleeing && Math.max(Math.abs(v.x - b.x), Math.abs(v.y - b.y)) <= c.range)[0];
      if (target) scare(target, b);
    }
    // 5. leaving
    for (let i = visitors.length - 1; i >= 0; i--) {
      const v = visitors[i]!;
      const goal = v.fleeing ? entrance : exit;
      const out = v.x === goal.x && v.y === goal.y;
      if (!out) continue;
      visitors.splice(i, 1);
      if (v.fleeing) { fled++; events.push({ tick, kind: "fled", visitor: v.id }); }
      else { exited++; events.push({ tick, kind: "exited", visitor: v.id }); }
    }
    tickHashes.push(hash());
    tick++;
  }

  function scare(v: Visitor, b: Build) {
    const c = catalog[b.kind];
    v.fear += c.scare;
    scares += c.scare;
    b.ready = tick + c.cooldown;
    events.push({ tick, kind: "scare", visitor: v.id, by: b.kind, x: b.x, y: b.y, amount: c.scare });
    if (!v.fleeing && v.fear >= v.bravery) { v.fleeing = true; v.moveIn = FLEE_EVERY; v.wait = 0; }
  }

  const deadlocked = () => visitors.filter((v) => v.wait * (v.fleeing ? FLEE_EVERY : WALK_EVERY) >= STUCK_TICKS).length;

  return {
    mansion: m, width: W, height: H, entrance, exit, catalog,
    /** Queue a build; it is checked (tile, cell, coins) when its tick comes. */
    place(p: PlacementInput) { pending.push(PlacementSchema.parse(p)); },
    step,
    get tick() { return tick; },
    get done() { return tick >= m.durationTicks; },
    get visitors(): readonly Visitor[] { return visitors; },
    get builds(): readonly Build[] { return builds; },
    get events(): readonly MansionEvent[] { return events; },
    get tickHashes(): readonly number[] { return tickHashes; },
    stats: () => ({ scares, quota: m.quota, coins: m.budget - spent + admitted * m.fee, spent, admitted, exited, fled, deadlocked: deadlocked() }),
    result(): MansionResult {
      return { outcome: scares >= m.quota ? "win" : "lose", scares, quota: m.quota, coins: m.budget - spent + admitted * m.fee,
        spent, admitted, exited, fled, deadlocked: deadlocked(), events: [...events], finalStateHash: tickHashes.at(-1) ?? 0 };
    },
  };
}

/** Build stats for a mansion: CATALOG with the mansion's overrides applied. */
export function buildCatalog(m: Mansion): typeof CATALOG {
  const merge = (kind: BuildKind) => {
    const base = CATALOG[kind], o = m.catalog?.[kind];
    return { cost: o?.cost ?? base.cost, range: o?.range ?? base.range, scare: o?.scare ?? base.scare, cooldown: o?.cooldown ?? base.cooldown };
  };
  return { ghost: merge("ghost"), trap: merge("trap") };
}

/** Run a whole mansion day headlessly with a build plan. */
export function runMansion(mansion: Mansion, placements: PlacementInput[]): MansionResult {
  const sim = createMansion(mansion);
  for (const p of placements) sim.place(p);
  while (!sim.done) sim.step();
  return sim.result();
}
