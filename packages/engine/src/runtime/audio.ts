/**
 * Sounds triggered by game events. Map event names to sound assets, and call play() with
 * each tick's events (e.g. from the loop's afterTick). Sound is presentation: it reads
 * events and never changes the game, so replays stay exact with or without it.
 */
import type { EmittedEvent } from "../core/world.js";

/** Event name → sound asset, or a function choosing one from the event's data (undefined = silent). */
// The `any` lets each entry take its own event's data type.
export type SoundMap = Readonly<Record<string, string | ((data: any) => string | undefined)>>;

/** The assets a tick's events trigger, in event order, each once (ten coins in one tick make one sound). */
export function soundsFor(events: readonly EmittedEvent[], sounds: SoundMap): string[] {
  const out = new Set<string>();
  for (const e of events) {
    const s = sounds[e.type];
    const asset = typeof s === "function" ? s(e.data) : s;
    if (asset) out.add(asset);
  }
  return [...out];
}

export interface AudioOptions {
  sounds: SoundMap;
  /** Fetches an asset's bytes (default: fetch its URL). */
  load?(asset: string): Promise<ArrayBuffer>;
  /** Default: a new AudioContext, closed on dispose. */
  context?: BaseAudioContext;
  /** 0–1, default 1. */
  volume?: number;
}

export interface GameAudio {
  /** Play the sounds a tick's events trigger. */
  play(events: readonly EmittedEvent[]): void;
  /** Play one asset now. */
  playSound(asset: string): void;
  /** Load every asset named in the map, so first plays are not late. */
  preload(): Promise<void>;
  volume: number;
  dispose(): void;
}

export function createAudio(opts: AudioOptions): GameAudio {
  const own = !opts.context;
  const ctx = opts.context ?? new AudioContext();
  const load = opts.load ?? (async (asset: string) => {
    const res = await fetch(asset);
    if (!res.ok) throw new Error(`sound "${asset}": HTTP ${res.status}`);
    return res.arrayBuffer();
  });
  const gain = ctx.createGain();
  gain.gain.value = opts.volume ?? 1;
  gain.connect(ctx.destination);
  const buffers = new Map<string, Promise<AudioBuffer>>();
  let disposed = false;
  const buffer = (asset: string) => {
    let p = buffers.get(asset);
    if (!p) {
      p = load(asset).then((bytes) => ctx.decodeAudioData(bytes));
      p.catch((err: unknown) => console.error(`sound "${asset}" failed to load:`, err));
      buffers.set(asset, p);
    }
    return p;
  };
  const audio: GameAudio = {
    play(events) { for (const a of soundsFor(events, opts.sounds)) audio.playSound(a); },
    playSound(asset) {
      if (disposed) return;
      // Browsers start audio suspended until the page has had a click or key press.
      if (ctx.state === "suspended" && "resume" in ctx) void (ctx as AudioContext).resume();
      buffer(asset).then((b) => {
        if (disposed) return;
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(gain);
        src.start();
      }, () => {});
    },
    async preload() {
      await Promise.all(Object.values(opts.sounds).filter((s): s is string => typeof s === "string").map(buffer));
    },
    get volume() { return gain.gain.value; },
    set volume(v) { gain.gain.value = Math.min(1, Math.max(0, v)); },
    dispose() {
      disposed = true;
      gain.disconnect();
      if (own) void (ctx as AudioContext).close();
    },
  };
  return audio;
}
