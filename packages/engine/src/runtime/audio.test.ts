import { expect, it } from "vitest";
import { createAudio, soundsFor } from "./audio.js";

const ev = (type: string, data: unknown = null) => ({ tick: 1, type, data });

it("maps events to sounds, once per tick", () => {
  const sounds = { coin: "coin.wav", hit: (d: { hard: boolean }) => (d.hard ? "crash.wav" : undefined) };
  expect(soundsFor([ev("coin"), ev("hit", { hard: false }), ev("coin"), ev("hit", { hard: true }), ev("other")], sounds))
    .toEqual(["coin.wav", "crash.wav"]);
});

it("loads each sound once and plays it through the volume", async () => {
  const started: unknown[] = [];
  let resumed = 0;
  const gain = { gain: { value: 1 }, connect() {}, disconnect() {} };
  const ctx = {
    state: "suspended", destination: {}, resume: async () => { resumed++; },
    createGain: () => gain,
    decodeAudioData: async (bytes: ArrayBuffer) => ({ bytes }),
    createBufferSource: () => ({ buffer: null as unknown, connect(to: unknown) { expect(to).toBe(gain); }, start() { started.push(this.buffer); } }),
  };
  const loaded: string[] = [];
  const audio = createAudio({ sounds: { coin: "coin.wav" }, context: ctx as never, volume: 0.5,
    load: async (a) => { loaded.push(a); return new ArrayBuffer(1); } });
  await audio.preload();
  audio.play([ev("coin")]);
  audio.play([ev("coin")]);
  await new Promise((r) => setTimeout(r, 0));
  expect([loaded, started.length, resumed, gain.gain.value]).toEqual([["coin.wav"], 2, 2, 0.5]);
  audio.volume = 3;
  expect(audio.volume).toBe(1);
  audio.dispose();
  audio.playSound("coin.wav");
  await new Promise((r) => setTimeout(r, 0));
  expect(started.length).toBe(2);
});
