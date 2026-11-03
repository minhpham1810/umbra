/**
 * search.strategy and the balance Playtester, for any build-placement game: place builds
 * of a few kinds on grid cells within a coin budget, run the game, get a score.
 * Reports balance bugs: an unwinnable quota, a dominant build kind (the others are never
 * worth buying), and plans that leave units stuck (crowd deadlocks).
 * A game supplies a PlanGame adapter; Boo & Co.'s is games/boo-and-co/src/sim/balance.ts.
 */

/** One build: a kind on a grid cell. */
export interface Build<K extends string = string> { kind: K; x: number; y: number }

export interface PlanGame<K extends string = string> {
  kinds: readonly K[];
  /** Cells a build may go on. */
  cells: readonly { x: number; y: number }[];
  /** Coins to spend, and the score that wins. */
  budget: number;
  quota: number;
  cost(kind: K): number;
  /** Run a plan to the end. Must be deterministic: the same plan always gives the same result. */
  run(plan: readonly Build<K>[]): { score: number; stuck: number; spent: number };
}

export interface PlanScore<K extends string = string> { plan: Build<K>[]; score: number; stuck: number; spent: number }

export interface StrategyResult<K extends string = string> {
  quotaReachable: boolean;
  best: PlanScore<K>;
  /** Best plan found using only one kind (keyed by kind), or any kinds ("mixed"). */
  bestByPool: Record<string, PlanScore<K>>;
  dominantStrategies: { kind: K; score: number; bestWithOther: number; detail: string }[];
  /** Plans that left units stuck, best-scoring first (at most 3). */
  deadlocks: PlanScore<K>[];
  runs: number;
}

/** A build kind dominates when its best single-kind plan beats every plan using another kind by this much. */
const DOMINANCE_MARGIN = 0.1;

export function searchStrategy<K extends string>(game: PlanGame<K>, opts: { budget?: number; seed?: number } = {}): StrategyResult<K> {
  const budget = Math.max(3, opts.budget ?? 600);
  let rng = (opts.seed ?? 1) >>> 0;
  const rand = (n: number) => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng % n; };

  const evaluated: PlanScore<K>[] = [];
  let runs = 0;
  const score = (plan: Build<K>[]): PlanScore<K> => {
    runs++;
    const s = { plan, ...game.run(plan) };
    evaluated.push(s);
    return s;
  };
  const cost = (plan: Build<K>[]) => plan.reduce((sum, p) => sum + game.cost(p.kind), 0);
  const freeCell = (plan: Build<K>[]) => {
    for (let tries = 0; tries < 50 && game.cells.length; tries++) {
      const c = game.cells[rand(game.cells.length)]!;
      if (!plan.some((p) => p.x === c.x && p.y === c.y)) return c;
    }
    return undefined;
  };
  const randomPlan = (kinds: readonly K[]) => {
    const plan: Build<K>[] = [];
    for (;;) {
      const affordable = kinds.filter((k) => cost(plan) + game.cost(k) <= game.budget);
      const cell = freeCell(plan);
      if (!affordable.length || !cell) return plan;
      plan.push({ kind: affordable[rand(affordable.length)]!, x: cell.x, y: cell.y });
    }
  };
  const mutate = (plan: Build<K>[], kinds: readonly K[]): Build<K>[] => {
    const next = plan.map((p) => ({ ...p }));
    const op = rand(4);
    const i = rand(Math.max(1, next.length));
    if (op === 0 && next.length) { const c = freeCell(next); if (c) Object.assign(next[i]!, c); }
    else if (op === 1 && next.length && kinds.length > 1) {
      const others = kinds.filter((k) => k !== next[i]!.kind);
      next[i]!.kind = others[others.length === 1 ? 0 : rand(others.length)]!;
    } else if (op === 2 && next.length > 1) next.splice(i, 1);
    else { const k = kinds[rand(kinds.length)]!; const c = freeCell(next); if (c) next.push({ kind: k, x: c.x, y: c.y }); }
    return cost(next) <= game.budget ? next : plan;
  };

  const bestByPool: Record<string, PlanScore<K>> = {};
  const pools: [string, readonly K[]][] = [...game.kinds.map((k) => [k, [k]] as [string, K[]]), ["mixed", game.kinds]];
  for (const [n, [pool, kinds]] of pools.entries()) {
    const share = Math.floor(budget / pools.length) + (n < budget % pools.length ? 1 : 0);
    let best = score(randomPlan(kinds));
    // 40% random restarts to explore, then hill-climb from the best plan.
    for (let i = 1; i < share; i++) {
      const s = score(i < share * 0.4 ? randomPlan(kinds) : mutate(best.plan, kinds));
      if (s.score > best.score || (s.score === best.score && s.spent < best.spent)) best = s;
    }
    bestByPool[pool] = best;
  }

  const best = [...evaluated].sort((a, b) => b.score - a.score || a.spent - b.spent)[0]!;
  const dominantStrategies: StrategyResult<K>["dominantStrategies"] = [];
  if (game.kinds.length > 1) {
    for (const kind of game.kinds) {
      const only = bestByPool[kind]!;
      const withOther = Math.max(0, ...evaluated.filter((s) => s.plan.some((p) => p.kind !== kind)).map((s) => s.score));
      if (only.score >= game.quota && only.score > withOther * (1 + DOMINANCE_MARGIN)) {
        dominantStrategies.push({ kind, score: only.score, bestWithOther: withOther,
          detail: `An all-${kind} plan scores ${only.score}; no plan using any other kind beats ${withOther}, so the others are never worth buying.` });
      }
    }
  }
  const deadlocks = evaluated.filter((s) => s.stuck > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  return { quotaReachable: best.score >= game.quota, best, bestByPool, dominantStrategies, deadlocks, runs };
}

export type BalanceBugType = "unwinnable_quota" | "dominant_strategy" | "crowd_deadlock";
export interface BalanceFinding<K extends string = string> {
  type: BalanceBugType;
  detail: string;
  /** Build plan that shows the bug; with the game it replays exactly. */
  plan?: Build<K>[];
  kind?: K;
}

/** Balance playtest: searchStrategy, then its result as findings. */
export function playtestBalance<K extends string>(game: PlanGame<K>, opts: { budget?: number; seed?: number } = {}) {
  const s = searchStrategy(game, opts);
  const findings: BalanceFinding<K>[] = [];
  if (!s.quotaReachable) {
    findings.push({ type: "unwinnable_quota", plan: s.best.plan,
      detail: `The best of ${s.runs} plans scores ${s.best.score}, short of the quota of ${game.quota}.` });
  }
  for (const d of s.dominantStrategies) findings.push({ type: "dominant_strategy", kind: d.kind, plan: s.bestByPool[d.kind]!.plan, detail: d.detail });
  const jam = s.deadlocks[0];
  if (jam) {
    findings.push({ type: "crowd_deadlock", plan: jam.plan,
      detail: `${jam.stuck} units end the run stuck with this plan (${s.deadlocks.length >= 3 ? "3 or more" : s.deadlocks.length} plans found).` });
  }
  return { findings, strategy: s };
}

/** A short summary of a search, for CLIs and the MCP tool. */
export function strategySummary(s: StrategyResult) {
  const brief = (p: PlanScore) => ({ plan: p.plan, score: p.score, stuck: p.stuck });
  return { quotaReachable: s.quotaReachable, bestPlan: brief(s.best),
    bestByPool: Object.fromEntries(Object.entries(s.bestByPool).map(([k, v]) => [k, brief(v)])),
    dominantStrategies: s.dominantStrategies, deadlocks: s.deadlocks.map(brief), runs: s.runs };
}
