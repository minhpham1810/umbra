/**
 * search.strategy and the Boo & Co. balance Playtester.
 * Searches build plans for a mansion and reports balance bugs: an unwinnable quota,
 * a dominant build kind (the other kind is never worth buying), and crowd deadlocks.
 */
import { BUILD_KINDS, MansionSchema, buildCatalog, runMansion, type BuildKind, type Mansion, type Placement } from "@umbra/engine";

export interface PlanScore { plan: Placement[]; scares: number; deadlocked: number; spent: number }
type Pool = BuildKind | "mixed";

export interface StrategyResult {
  quotaReachable: boolean;
  best: PlanScore;
  /** Best plan found using only ghosts, only traps, or either. */
  bestByPool: Record<Pool, PlanScore>;
  dominantStrategies: { kind: BuildKind; scares: number; bestWithOther: number; detail: string }[];
  /** Plans that left visitors stuck, best-scoring first (at most 3). */
  deadlocks: PlanScore[];
  runs: number;
}

/** A build kind dominates when its best single-kind plan beats every plan using the other kind by this much. */
const DOMINANCE_MARGIN = 0.1;

export function searchStrategy(raw: Mansion, opts: { budget?: number; seed?: number } = {}): StrategyResult {
  const m = MansionSchema.parse(raw);
  const catalog = buildCatalog(m);
  const budget = Math.max(3, opts.budget ?? 600);
  let rng = (opts.seed ?? 1) >>> 0;
  const rand = (n: number) => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng % n; };
  const floor: { x: number; y: number }[] = [];
  m.tiles.forEach((row, y) => [...row].forEach((c, x) => { if (c === ".") floor.push({ x, y }); }));

  const evaluated: PlanScore[] = [];
  let runs = 0;
  const score = (plan: Placement[]): PlanScore => {
    runs++;
    const r = runMansion(m, plan);
    const s = { plan, scares: r.scares, deadlocked: r.deadlocked, spent: r.spent };
    evaluated.push(s);
    return s;
  };
  const cost = (plan: Placement[]) => plan.reduce((sum, p) => sum + catalog[p.kind].cost, 0);
  const freeCell = (plan: Placement[]) => {
    for (let tries = 0; tries < 50; tries++) {
      const c = floor[rand(floor.length)]!;
      if (!plan.some((p) => p.x === c.x && p.y === c.y)) return c;
    }
    return undefined;
  };
  const kindsOf = (pool: Pool): BuildKind[] => (pool === "mixed" ? [...BUILD_KINDS] : [pool]);
  const randomPlan = (kinds: BuildKind[]) => {
    const plan: Placement[] = [];
    for (;;) {
      const affordable = kinds.filter((k) => cost(plan) + catalog[k].cost <= m.budget);
      const cell = freeCell(plan);
      if (!affordable.length || !cell) return plan;
      plan.push({ kind: affordable[rand(affordable.length)]!, ...cell, tick: 0 });
    }
  };
  const mutate = (plan: Placement[], kinds: BuildKind[]): Placement[] => {
    const next = plan.map((p) => ({ ...p }));
    const op = rand(4);
    const i = rand(Math.max(1, next.length));
    if (op === 0 && next.length) { const c = freeCell(next); if (c) Object.assign(next[i]!, c); }
    else if (op === 1 && next.length && kinds.length > 1) next[i]!.kind = next[i]!.kind === "ghost" ? "trap" : "ghost";
    else if (op === 2 && next.length > 1) next.splice(i, 1);
    else { const k = kinds[rand(kinds.length)]!; const c = freeCell(next); if (c) next.push({ kind: k, ...c, tick: 0 }); }
    return cost(next) <= m.budget ? next : plan;
  };

  const bestByPool = {} as Record<Pool, PlanScore>;
  const pools: Pool[] = ["ghost", "trap", "mixed"];
  for (const [n, pool] of pools.entries()) {
    const kinds = kindsOf(pool);
    const share = Math.floor(budget / 3) + (n < budget % 3 ? 1 : 0);
    let best = score(randomPlan(kinds));
    // 40% random restarts to explore, then hill-climb from the best plan.
    for (let i = 1; i < share; i++) {
      const s = score(i < share * 0.4 ? randomPlan(kinds) : mutate(best.plan, kinds));
      if (s.scares > best.scares || (s.scares === best.scares && s.spent < best.spent)) best = s;
    }
    bestByPool[pool] = best;
  }

  const best = [...evaluated].sort((a, b) => b.scares - a.scares || a.spent - b.spent)[0]!;
  const dominantStrategies: StrategyResult["dominantStrategies"] = [];
  for (const kind of BUILD_KINDS) {
    const other = kind === "ghost" ? "trap" : "ghost";
    const only = bestByPool[kind];
    const withOther = Math.max(0, ...evaluated.filter((s) => s.plan.some((p) => p.kind === other)).map((s) => s.scares));
    if (only.scares >= m.quota && only.scares > withOther * (1 + DOMINANCE_MARGIN)) {
      dominantStrategies.push({ kind, scares: only.scares, bestWithOther: withOther,
        detail: `An all-${kind} plan scores ${only.scares}; no plan using any ${other} beats ${withOther}, so ${other}s are never worth buying.` });
    }
  }
  const deadlocks = evaluated.filter((s) => s.deadlocked > 0).sort((a, b) => b.scares - a.scares).slice(0, 3);
  return { quotaReachable: best.scares >= m.quota, best, bestByPool, dominantStrategies, deadlocks, runs };
}

export type MansionBugType = "unwinnable_quota" | "dominant_strategy" | "crowd_deadlock";
export interface MansionFinding {
  type: MansionBugType;
  detail: string;
  /** Build plan that shows the bug; with the mansion it replays exactly. */
  plan?: Placement[];
  kind?: BuildKind;
}

/** Balance playtest for a Boo & Co. mansion. */
export function playtestMansion(mansion: Mansion, opts: { budget?: number; seed?: number } = {}) {
  const s = searchStrategy(mansion, opts);
  const findings: MansionFinding[] = [];
  if (!s.quotaReachable) {
    findings.push({ type: "unwinnable_quota", plan: s.best.plan,
      detail: `The best of ${s.runs} plans scores ${s.best.scares} scares, short of the quota of ${mansion.quota}.` });
  }
  for (const d of s.dominantStrategies) findings.push({ type: "dominant_strategy", kind: d.kind, plan: s.bestByPool[d.kind].plan, detail: d.detail });
  const jam = s.deadlocks[0];
  if (jam) {
    findings.push({ type: "crowd_deadlock", plan: jam.plan,
      detail: `${jam.deadlocked} visitors end the day stuck with this plan (${s.deadlocks.length >= 3 ? "3 or more" : s.deadlocks.length} plans found).` });
  }
  return { findings, strategy: s };
}
