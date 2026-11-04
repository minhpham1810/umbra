/**
 * Games: a definition (level format, input format, components, systems, outcome) and
 * runs of it. A run advances one fixed tick per step(input); after every tick it hashes
 * the world (and each plugin's own state), so two runs with the same level, seed and
 * inputs can be compared tick by tick, on any machine.
 */
import { z } from "zod";
import { fnvNumber, fnvStart } from "./hash.js";
import { World, type ComponentType, type EmittedEvent, type EventType, type ResourceType, type WorldState } from "./world.js";

/**
 * Systems run in phase order, then in the order they are listed:
 * game systems default to "update"; plugins use the others (e.g. physics in "physics").
 */
export const PHASES = ["input", "update", "physics", "late"] as const;
export type Phase = (typeof PHASES)[number];

export interface System<I = unknown, L = unknown> {
  name: string;
  phase?: Phase;
  run(world: World, input: I, level: L): void;
}
/** A system, or a plain function (its name is the function's name). */
export type SystemLike<I = unknown, L = unknown> = System<I, L> | ((world: World, input: I, level: L) => void);

/** A plugin's state for one run: its systems, plus how to hash, save and free that state. */
export interface PluginRun<I = unknown, L = unknown> {
  systems?: SystemLike<I, L>[];
  /** Hash of state the plugin keeps outside the world (e.g. a physics engine). */
  hash?(): number;
  save?(): unknown;
  load?(state: unknown): void;
  dispose?(): void;
}

/** An optional module (physics, navigation, …) a game opts into. */
export interface Plugin<I = unknown, L = unknown> {
  name: string;
  components?: readonly ComponentType[];
  resources?: readonly ResourceType[];
  events?: readonly EventType[];
  /** Called once per run, after the game's setup; may be async (e.g. loading WebAssembly). */
  start(world: World, level: L): PluginRun<I, L> | Promise<PluginRun<I, L>>;
}

export interface GameDefinition<I, L> {
  name: string;
  /** Bump when a change alters runs, so old replays are recognised as stale. */
  version?: string;
  /** Validates the input given to each tick (inputs are a trust boundary: agents send them). */
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  /** Validates the level a run starts from. Default: any value. */
  level?: z.ZodType<L, z.ZodTypeDef, unknown>;
  components?: readonly ComponentType[];
  resources?: readonly ResourceType[];
  events?: readonly EventType[];
  plugins?: readonly Plugin<I, L>[];
  /** Build the starting world from the level. */
  setup?(world: World, level: L): void;
  systems?: readonly SystemLike<I, L>[];
  /** After each tick (it can read that tick's events): a result ("win", "lose", …) ends the run; undefined keeps going. */
  outcome?(world: World, level: L): string | undefined;
}

export type Game<I, L> = Readonly<GameDefinition<I, L>> & { readonly kind: "game" };

/** Define a game. Checks names up front so mistakes fail at load, not mid-run. */
export function defineGame<I, L = unknown>(def: GameDefinition<I, L>): Game<I, L> {
  if (!def.name) throw new Error("a game needs a name");
  const names = new Set<string>();
  for (const s of def.systems ?? []) {
    const n = systemOf(s).name;
    if (names.has(n)) throw new Error(`game "${def.name}" lists two systems named "${n}"`);
    names.add(n);
  }
  return Object.freeze({ ...def, kind: "game" as const });
}

function systemOf<I, L>(s: SystemLike<I, L>): System<I, L> {
  if (typeof s !== "function") {
    if (s.phase && !PHASES.includes(s.phase)) throw new Error(`system "${s.name}" has unknown phase "${s.phase}"`);
    return s;
  }
  if (!s.name) throw new Error("a system function needs a name: use a named function or { name, run }");
  return { name: s.name, run: s };
}

/** Everything needed to resume a run exactly: the world, each plugin's state, the outcome. */
export interface Checkpoint { world: WorldState; plugins: Record<string, unknown>; outcome: string | undefined; hash: number }

export interface GameRun<I, L> {
  readonly world: World;
  readonly level: L;
  /** Advance one tick. Does nothing once the run has an outcome. Returns that tick's events. */
  step(input: I): EmittedEvent[];
  /** Hash after the last tick (or of the starting state). */
  readonly hash: number;
  readonly outcome: string | undefined;
  readonly tick: number;
  save(): Checkpoint;
  load(checkpoint: Checkpoint): void;
  dispose(): void;
}

/** Start a run of `game` on `level`. */
export async function createGame<I, L>(game: Game<I, L>, rawLevel: unknown, opts: { seed?: number } = {}): Promise<GameRun<I, L>> {
  const level = (game.level ? game.level.parse(rawLevel) : rawLevel) as L;
  const plugins = game.plugins ?? [];
  const world = new World({
    seed: opts.seed ?? 0,
    components: [...plugins.flatMap((p) => p.components ?? []), ...(game.components ?? [])],
    resources: [...plugins.flatMap((p) => p.resources ?? []), ...(game.resources ?? [])],
    events: [...plugins.flatMap((p) => p.events ?? []), ...(game.events ?? [])],
  });
  game.setup?.(world, level);
  const runs: [string, PluginRun<I, L>][] = [];
  try {
    for (const p of plugins) runs.push([p.name, await p.start(world, level)]);
  } catch (e) { for (const [, r] of runs) r.dispose?.(); throw e; }

  // Phase order, then plugins' systems before the game's within a phase.
  const all = [...runs.flatMap(([, r]) => (r.systems ?? []).map(systemOf)), ...(game.systems ?? []).map(systemOf)];
  const ordered = PHASES.flatMap((ph) => all.filter((s) => (s.phase ?? "update") === ph));
  world.takeEvents(); // events from setup belong to no tick

  const hashNow = () => {
    let h = fnvNumber(fnvStart(), world.hash());
    for (const [, r] of runs) h = fnvNumber(h, r.hash?.() ?? 0);
    return h >>> 0;
  };
  let hash = hashNow();
  let outcome: string | undefined;
  let disposed = false;
  const live = () => { if (disposed) throw new Error("this run is disposed"); };

  return {
    world, level,
    step(raw) {
      live();
      if (outcome !== undefined) return [];
      const input = game.input.parse(raw);
      for (const s of ordered) s.run(world, input, level);
      world.tick++;
      outcome = game.outcome?.(world, level); // may read this tick's events with world.events()
      const events = world.takeEvents();
      hash = hashNow();
      return events;
    },
    get hash() { return hash; },
    get outcome() { return outcome; },
    get tick() { return world.tick; },
    save() {
      live();
      return { world: world.save(), plugins: Object.fromEntries(runs.map(([n, r]) => [n, r.save?.()])), outcome, hash };
    },
    load(cp) {
      live();
      world.load(cp.world);
      for (const [n, r] of runs) r.load?.(cp.plugins[n]);
      outcome = cp.outcome;
      hash = hashNow();
      if (hash !== cp.hash) throw new Error(`checkpoint did not restore exactly: hash ${hash}, saved ${cp.hash}`);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [, r] of runs) r.dispose?.();
    },
  };
}

export interface GameResult {
  /** The game's outcome, or undefined if the inputs ran out first. */
  outcome: string | undefined;
  ticks: number;
  finalStateHash: number;
  tickHashes: number[];
  events: EmittedEvent[];
}

/** Run a game headlessly over a list of inputs (one per tick) and report what happened. */
export async function runGame<I, L>(game: Game<I, L>, level: unknown, opts: { seed?: number; inputs: readonly I[] }): Promise<GameResult> {
  const run = await createGame(game, level, opts);
  try {
    const tickHashes: number[] = [];
    const events: EmittedEvent[] = [];
    for (const input of opts.inputs) {
      if (run.outcome !== undefined) break;
      events.push(...run.step(input));
      tickHashes.push(run.hash);
    }
    return { outcome: run.outcome, ticks: run.tick, finalStateHash: run.hash, tickHashes, events };
  } finally { run.dispose(); }
}

// ── replays ─────────────────────────────────────────────────────────────────

export const GameReplaySchema = z.object({
  format: z.literal("umbra-replay"),
  version: z.literal(1),
  game: z.string(),
  gameVersion: z.string().optional(),
  seed: z.number().int().min(0).max(2 ** 32 - 1),
  level: z.unknown(),
  inputs: z.array(z.unknown()),
  ticks: z.number().int().min(0),
  finalStateHash: z.number().int(),
  note: z.string().optional(),
});
export type GameReplay = z.infer<typeof GameReplaySchema>;

/** Run and record a replay: the level, seed and inputs, plus the hash they must reproduce. */
export async function recordReplay<I, L>(game: Game<I, L>, level: unknown, opts: { seed?: number; inputs: readonly I[]; note?: string }): Promise<GameReplay> {
  const r = await runGame(game, level, opts);
  return {
    format: "umbra-replay", version: 1, game: game.name, ...(game.version ? { gameVersion: game.version } : {}),
    seed: opts.seed ?? 0, level, inputs: opts.inputs.slice(0, r.ticks), ticks: r.ticks, finalStateHash: r.finalStateHash,
    ...(opts.note ? { note: opts.note } : {}),
  };
}

/** Re-run a replay (untrusted input) and check it reproduces its saved hash. */
export async function verifyReplay<I, L>(game: Game<I, L>, raw: unknown): Promise<{ ok: boolean; reason: string; result: GameResult }> {
  const replay = GameReplaySchema.parse(raw);
  if (replay.game !== game.name) throw new Error(`replay is for game "${replay.game}", not "${game.name}"`);
  const inputs = replay.inputs.map((i) => game.input.parse(i));
  const result = await runGame(game, replay.level, { seed: replay.seed, inputs });
  const stale = replay.gameVersion !== game.version;
  const ok = result.finalStateHash === replay.finalStateHash && result.ticks === replay.ticks;
  const reason = ok ? `reproduced exactly · hash ${result.finalStateHash}`
    : stale ? `hash differs: recorded with ${replay.game} ${replay.gameVersion ?? "(no version)"}, running ${game.version ?? "(no version)"}`
    : `hash differs: saved ${replay.finalStateHash}, got ${result.finalStateHash} after ${result.ticks} of ${replay.ticks} ticks`;
  return { ok, reason, result };
}
