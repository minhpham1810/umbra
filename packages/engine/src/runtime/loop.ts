/**
 * A real-time loop for a game: fixed ticks from wall-clock time, input sampled once per
 * tick, and a render callback every frame with how far it is into the next tick.
 * Every input is recorded, so any session can be saved and replayed exactly.
 */
import { createGame, recordReplay, type Game, type GameReplay, type GameRun } from "../core/game.js";
import type { EmittedEvent } from "../core/world.js";

export interface LoopOptions<I, L> {
  seed?: number;
  /** Ticks per second (match the game's physics dt; default 60). */
  tickRate?: number;
  /** Called once per tick to build that tick's input (e.g. from an InputState). */
  input(run: GameRun<I, L>): I;
  /** Called after each tick's input has been read (e.g. InputState.endTick). */
  afterTick?(run: GameRun<I, L>, events: EmittedEvent[]): void;
  /** Called every frame; `alpha` (0–1) is how far the frame is between the last two ticks. */
  render(run: GameRun<I, L>, alpha: number): void;
  /** Called once when the run gets an outcome. */
  onOutcome?(outcome: string, run: GameRun<I, L>): void;
  /** At most this many ticks per frame, so a stalled tab does not spiral (default 5). */
  maxTicksPerFrame?: number;
  /** Frame scheduler and clock (default requestAnimationFrame and performance.now). */
  requestFrame?(callback: (time: number) => void): unknown;
  cancelFrame?(handle: unknown): void;
}

export interface GameLoop<I, L> {
  readonly run: GameRun<I, L>;
  /** Inputs of every tick so far, in order. */
  readonly inputs: readonly I[];
  readonly paused: boolean;
  pause(): void;
  resume(): void;
  /** Start again from the level with a fresh run (same seed unless given). */
  restart(seed?: number): Promise<void>;
  /** The session so far as a replay that verifyReplay reproduces. */
  replay(note?: string): Promise<GameReplay>;
  stop(): void;
}

export async function startGame<I, L>(game: Game<I, L>, level: unknown, opts: LoopOptions<I, L>): Promise<GameLoop<I, L>> {
  const dt = 1000 / (opts.tickRate ?? 60);
  const maxTicks = opts.maxTicksPerFrame ?? 5;
  const raf = opts.requestFrame ?? ((cb: (t: number) => void) => requestAnimationFrame(cb));
  const cancel = opts.cancelFrame ?? ((h: unknown) => cancelAnimationFrame(h as number));
  let seed = opts.seed ?? 0;
  let run = await createGame(game, level, { seed });
  let inputs: I[] = [];
  let paused = false, stopped = false, reported = false;
  let last: number | undefined, acc = 0;
  let handle: unknown;

  const frame = (time: number) => {
    if (stopped) return;
    handle = raf(frame);
    if (last === undefined || paused) { last = time; opts.render(run, 1); return; }
    acc += Math.min(time - last, dt * maxTicks);
    last = time;
    while (acc >= dt && run.outcome === undefined) {
      const input = opts.input(run);
      inputs.push(input);
      const events = run.step(input);
      opts.afterTick?.(run, events);
      acc -= dt;
    }
    if (run.outcome !== undefined) {
      acc = 0;
      if (!reported) { reported = true; opts.onOutcome?.(run.outcome, run); }
    }
    opts.render(run, run.outcome === undefined ? acc / dt : 1);
  };
  handle = raf(frame);

  return {
    get run() { return run; },
    get inputs() { return inputs; },
    get paused() { return paused; },
    pause() { paused = true; },
    resume() { paused = false; last = undefined; acc = 0; },
    async restart(s = seed) {
      const next = await createGame(game, level, { seed: s });
      if (stopped) { next.dispose(); return; }
      run.dispose();
      run = next; seed = s; inputs = []; reported = false; last = undefined; acc = 0;
    },
    replay: (note) => recordReplay(game, level, { seed, inputs, ...(note ? { note } : {}) }),
    stop() { stopped = true; cancel(handle); run.dispose(); },
  };
}
