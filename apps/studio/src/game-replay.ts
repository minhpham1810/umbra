/**
 * umbra-replay files for any registered game: re-run with the real engine, keep the
 * world's state after every tick, and check the final hash. Playback then loads those
 * states into the run's world, so the engine's own views draw any tick exactly.
 */
import { GameReplaySchema, createGame, type EmittedEvent, type Game, type World, type WorldState } from "umbra-engine";

export interface GameRecording {
  game: string;
  outcome: string;
  verified: boolean;
  reason: string;
  /** World state at each tick; index 0 is before the first step. */
  states: WorldState[];
  events: EmittedEvent[];
  /** The run's world (its plugins are freed): load a state into it to draw that tick. */
  world: World;
  /** How the game draws: Sprite components (2D), Mesh components (3D), or neither. */
  view: "2d" | "3d" | "none";
}

/** Replay files are untrusted: the format, the game's input schema and its level schema all check them. */
export async function recordGameReplay(games: readonly Game<any, any>[], raw: unknown, maxTicks: number): Promise<GameRecording> {
  const replay = GameReplaySchema.parse(raw);
  const game = games.find((g) => g.name === replay.game);
  if (!game) throw new Error(`Studio has no game "${replay.game}" (it has ${games.map((g) => g.name).join(", ")}); add it to apps/studio/src/games.ts`);
  if (replay.inputs.length > maxTicks) throw new Error(`replay has ${replay.inputs.length} inputs; Studio plays at most ${maxTicks}`);
  const inputs = replay.inputs.map((i) => game.input.parse(i));
  const run = await createGame(game, replay.level, { seed: replay.seed });
  try {
    const states = [run.world.save()];
    const events: EmittedEvent[] = [];
    for (const input of inputs) {
      if (run.outcome !== undefined) break;
      events.push(...run.step(input));
      states.push(run.world.save());
    }
    const verified = run.hash === replay.finalStateHash && run.tick === replay.ticks;
    const stale = replay.gameVersion !== game.version;
    const reason = verified ? `Reproduced exactly · hash ${run.hash}`
      : stale ? `Hash differs (recorded with ${game.name} ${replay.gameVersion ?? "(no version)"}, running ${game.version ?? "(no version)"})`
      : `Hash differs: saved ${replay.finalStateHash}, got ${run.hash} after ${run.tick} of ${replay.ticks} ticks`;
    const has = (name: string) => states.some((s) => (s.components[name]?.length ?? 0) > 0);
    return { game: game.name, outcome: run.outcome ?? "no outcome", verified, reason, states, events, world: run.world,
      view: has("sprite") ? "2d" : has("mesh") ? "3d" : "none" };
  } finally { run.dispose(); }
}
