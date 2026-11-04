/**
 * Agent tools for any game made with defineGame: observe a run, search for an outcome,
 * and playtest. A game opts in with an AgentGame: the game, the moves a search may make,
 * and (optionally) a score that says which states look closer to the goal.
 *
 * Searches branch from checkpoints instead of re-running from tick 0, and every route
 * they return is re-run from scratch first, so a found route is a replayable proof.
 */
import { createGame, recordReplay, runGame, type EmittedEvent, type Game, type GameReplay, type GameRun, type World } from "umbra-engine";

// The `any` defaults let one list hold games with different input and level types.
export interface AgentGame<I = any, L = any> {
  game: Game<I, L>;
  /** Inputs a search or playtest may choose between (e.g. each direction, and "no input"). */
  moves: readonly I[];
  /** Higher is closer to the goal outcome. Default: none, so searches explore at random. */
  score?(world: World, level: L): number;
  /** Ticks each chosen move is held (default 1). Larger values search further for the same cost. */
  hold?: number;
  /** Named levels, so tools can take a name instead of the level's data. */
  levels?: Readonly<Record<string, unknown>>;
}

/** A small seeded generator for search choices (separate from the game's own rng). */
const lcg = (seed: number) => {
  let s = seed >>> 0;
  return (n: number) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n; };
};

// ── observe ─────────────────────────────────────────────────────────────────

export interface GameObservation {
  tick: number;
  outcome: string | undefined;
  hash: number;
  /** Live entities with their components (presentation components left out unless asked). */
  entities: { id: number; components: Record<string, unknown> }[];
  resources: Record<string, unknown>;
  /** Events of the last tick. */
  events: EmittedEvent[];
}

/** A run's state as plain JSON. `components` limits which components are listed. */
export function observe(run: GameRun<unknown, unknown>, opts: { events?: EmittedEvent[]; components?: readonly string[]; presentation?: boolean } = {}): GameObservation {
  const state = run.world.save();
  const byEntity = new Map<number, Record<string, unknown>>(state.entities.map((e) => [e, {}]));
  for (const [name, pairs] of Object.entries(state.components).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (opts.components && !opts.components.includes(name)) continue;
    if (!opts.presentation && run.world.componentType(name)?.presentation) continue;
    for (const [e, v] of pairs) byEntity.get(e)![name] = v;
  }
  return {
    tick: run.tick, outcome: run.outcome, hash: run.hash,
    entities: [...byEntity].filter(([, c]) => !opts.components || Object.keys(c).length).map(([id, components]) => ({ id, components })),
    resources: state.resources, events: opts.events ?? [],
  };
}

/** Run a game to `atTick` (or until it ends) and observe it. */
export async function observeAt<I, L>(game: Game<I, L>, level: unknown, opts: { seed?: number; inputs: readonly I[]; atTick: number; components?: readonly string[]; presentation?: boolean }): Promise<GameObservation> {
  const run = await createGame(game, level, { seed: opts.seed ?? 0 });
  try {
    let events: EmittedEvent[] = [];
    while (run.tick < opts.atTick && run.outcome === undefined && run.tick < opts.inputs.length) events = run.step(opts.inputs[run.tick]!);
    return observe(run as GameRun<unknown, unknown>, { ...opts, events });
  } finally { run.dispose(); }
}

// ── search ──────────────────────────────────────────────────────────────────

export interface SearchOptions {
  /** The outcome to reach (default "win"). */
  target?: string;
  seed?: number;
  /** Give up on routes longer than this. Default 3000 ticks. */
  maxTicks?: number;
  /** Ticks simulated in total, across every branch. Default 200 000. */
  budget?: number;
  /** Branches kept after each step (default 8). */
  beam?: number;
}

export interface SearchResult<I> {
  found: boolean;
  target: string;
  /** Inputs from tick 0 that reach the target (re-run from scratch to confirm); empty if not found. */
  inputs: I[];
  /** Outcomes the search ran into, with how often (e.g. { dead: 120 }). */
  otherOutcomes: Record<string, number>;
  simulatedTicks: number;
  /** "budget", "maxTicks" or "exhausted" (no branch left) when not found. */
  stopped?: "budget" | "maxTicks" | "exhausted";
}

/**
 * Beam search for inputs that reach an outcome: from each kept state, try every move
 * (held `hold` ticks) from a checkpoint, keep the `beam` best-scoring new states, repeat.
 * Without a score, ties are broken at random, so it explores. A bounded search failing
 * is not a proof the outcome is unreachable.
 */
export async function searchOutcome<I, L>(entry: AgentGame<I, L>, level: unknown, opts: SearchOptions = {}): Promise<SearchResult<I>> {
  const target = opts.target ?? "win", seed = opts.seed ?? 0;
  const maxTicks = opts.maxTicks ?? 3000, budget = opts.budget ?? 200_000, width = opts.beam ?? 8;
  const hold = Math.max(1, entry.hold ?? 1);
  if (!entry.moves.length) throw new Error(`${entry.game.name}: no moves to search with`);
  const rand = lcg(seed ^ 0x9e3779b9);
  const run = await createGame(entry.game, level, { seed });
  const otherOutcomes: Record<string, number> = {};
  let simulated = 0;
  try {
    let beam = [{ cp: run.save(), inputs: [] as I[] }];
    const seen = new Set<number>([run.hash]);
    for (;;) {
      const next: { cp: ReturnType<typeof run.save>; inputs: I[]; value: number; tie: number }[] = [];
      for (const node of beam) {
        for (const move of entry.moves) {
          if (simulated >= budget) return { found: false, target, inputs: [], otherOutcomes, simulatedTicks: simulated, stopped: "budget" };
          run.load(node.cp);
          const inputs = [...node.inputs];
          for (let k = 0; k < hold && run.outcome === undefined; k++) { run.step(move); inputs.push(move); simulated++; }
          if (run.outcome === target) {
            const check = await runGame(entry.game, level, { seed, inputs });
            if (check.outcome !== target) throw new Error(`${entry.game.name}: a route reached "${target}" from checkpoints but not from scratch; checkpoints do not restore the whole state`);
            return { found: true, target, inputs, otherOutcomes, simulatedTicks: simulated };
          }
          if (run.outcome !== undefined) { otherOutcomes[run.outcome] = (otherOutcomes[run.outcome] ?? 0) + 1; continue; }
          if (seen.has(run.hash)) continue;
          seen.add(run.hash);
          next.push({ cp: run.save(), inputs, value: entry.score?.(run.world, run.level) ?? 0, tie: rand(1 << 30) });
        }
      }
      if (!next.length) return { found: false, target, inputs: [], otherOutcomes, simulatedTicks: simulated, stopped: "exhausted" };
      if (next[0]!.inputs.length >= maxTicks) return { found: false, target, inputs: [], otherOutcomes, simulatedTicks: simulated, stopped: "maxTicks" };
      beam = next.sort((a, b) => b.value - a.value || a.tie - b.tie).slice(0, width);
    }
  } finally { run.dispose(); }
}

// ── playtest ────────────────────────────────────────────────────────────────

export type GameFindingType = "crash" | "nondeterministic" | "checkpoint_mismatch" | "unreachable_outcome";

export interface GameFinding<I = unknown> {
  type: GameFindingType;
  detail: string;
  /** Inputs from tick 0 that show the bug (with the report's seed). */
  inputs?: I[];
  tick?: number;
  outcome?: string;
}

export interface GamePlaytestOptions extends Omit<SearchOptions, "target"> {
  /** Outcomes a player must be able to reach (default ["win"]). */
  expect?: readonly string[];
  /** Random play-throughs that check for crashes, nondeterminism and checkpoint bugs (default 6). */
  fuzzRuns?: number;
  /** Ticks per play-through (default 600). */
  fuzzTicks?: number;
}

export interface GamePlaytestReport<I = unknown> {
  game: string;
  seed: number;
  findings: GameFinding<I>[];
  /** For each expected outcome reached: a replay that proves it. */
  reached: GameReplay[];
  simulatedTicks: number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Playtest any game:
 *  - random play-throughs: a system that throws is a crash; re-running the same inputs
 *    must give the same hashes (else nondeterministic); restoring a mid-run checkpoint
 *    and replaying must give the same hashes (else state lives outside the world);
 *  - a search for each expected outcome (unreachable_outcome if the bounded search fails).
 */
export async function playtestGame<I, L>(entry: AgentGame<I, L>, level: unknown, opts: GamePlaytestOptions = {}): Promise<GamePlaytestReport<I>> {
  const seed = opts.seed ?? 0, runs = opts.fuzzRuns ?? 6, ticks = opts.fuzzTicks ?? 600;
  const hold = Math.max(1, entry.hold ?? 1);
  const findings: GameFinding<I>[] = [];
  const reached: GameReplay[] = [];
  let simulated = 0;
  const found = (t: GameFindingType) => findings.some((f) => f.type === t);

  for (let r = 0; r < runs; r++) {
    const rand = lcg(seed * 7919 + r);
    const inputs: I[] = [];
    while (inputs.length < ticks) { const m = entry.moves[rand(entry.moves.length)]!; for (let k = 0; k < hold; k++) inputs.push(m); }
    inputs.length = ticks;
    const run = await createGame(entry.game, level, { seed });
    const hashes: number[] = [];
    const mid = Math.floor(ticks / 2);
    let cp: ReturnType<typeof run.save> | undefined;
    try {
      for (const input of inputs) {
        if (run.outcome !== undefined) break;
        if (run.tick === mid) cp = run.save();
        try { run.step(input); } catch (e) {
          if (!found("crash")) findings.push({ type: "crash", tick: run.tick, inputs: inputs.slice(0, run.tick + 1), detail: `tick ${run.tick + 1} threw: ${message(e)}` });
          break;
        }
        simulated++;
        hashes.push(run.hash);
      }
      if (cp && !found("checkpoint_mismatch")) {
        run.load(cp);
        for (let t = mid; t < hashes.length; t++) {
          run.step(inputs[t]!);
          simulated++;
          if (run.hash !== hashes[t]) {
            findings.push({ type: "checkpoint_mismatch", tick: t + 1, inputs: inputs.slice(0, t + 1),
              detail: `restoring the checkpoint from tick ${mid} and replaying gave a different state at tick ${t + 1}: some state lives outside the world (closure variables, module state)` });
            break;
          }
        }
      }
    } finally { run.dispose(); }
    if (!found("nondeterministic") && hashes.length) {
      const again = await runGame(entry.game, level, { seed, inputs: inputs.slice(0, hashes.length) }).catch(() => undefined);
      simulated += hashes.length;
      const t = again ? again.tickHashes.findIndex((h, i) => h !== hashes[i]) : -1;
      if (again && t >= 0) {
        findings.push({ type: "nondeterministic", tick: t + 1, inputs: inputs.slice(0, t + 1),
          detail: `the same seed and inputs gave a different state at tick ${t + 1}: something outside world.rng and the inputs decides the game (Math.random, Date.now, iteration order)` });
      }
    }
  }

  for (const target of opts.expect ?? ["win"]) {
    let s: SearchResult<I>;
    try { s = await searchOutcome(entry, level, { ...opts, target, seed }); } catch (e) {
      if (!found("crash")) findings.push({ type: "crash", outcome: target, detail: `searching for "${target}" hit an error: ${message(e)}` });
      continue;
    }
    simulated += s.simulatedTicks;
    if (s.found) reached.push(await recordReplay(entry.game, level, { seed, inputs: s.inputs, note: `reaches "${target}" (found by playtestGame)` }));
    else {
      const others = Object.entries(s.otherOutcomes).map(([o, n]) => `${o} ×${n}`).join(", ");
      findings.push({ type: "unreachable_outcome", outcome: target,
        detail: `no route to "${target}" in ${s.simulatedTicks} simulated ticks (stopped: ${s.stopped}${others ? `; ran into ${others}` : ""}). A bounded search, not a proof.` });
    }
  }
  return { game: entry.game.name, seed, findings, reached, simulatedTicks: simulated };
}
