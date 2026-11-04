import { expect, it } from "vitest";
import { z } from "zod";
import { defineComponent, defineGame, verifyReplay } from "../core/index.js";
import { createInput } from "./input.js";
import { startGame } from "./loop.js";

const Count = defineComponent("count", z.number().int());
const counter = defineGame({
  name: "counter", input: z.number().int(), components: [Count],
  setup: (w) => { w.spawn(Count(0)); },
  systems: [function add(w, n) { for (const [e, v] of w.query(Count)) w.set(e, Count, v + n); }],
  outcome: (w) => (w.first(Count)![1] >= 10 ? "done" : undefined),
});

/** A manual frame clock: frames run when the test advances time. */
function clock() {
  let pending: ((t: number) => void) | undefined;
  let now = 0;
  return {
    requestFrame: (cb: (t: number) => void) => { pending = cb; return 1; },
    cancelFrame: () => { pending = undefined; },
    advance(ms: number) { now += ms; const cb = pending; pending = undefined; cb?.(now); },
  };
}

it("runs fixed ticks from wall time, smooths frames, records inputs and replays them", async () => {
  const c = clock();
  const alphas: number[] = [];
  let outcome: string | undefined;
  const loop = await startGame(counter, null, {
    tickRate: 10, input: (run) => (run.tick % 2 === 0 ? 1 : 2),
    render: (_run, alpha) => alphas.push(alpha), onOutcome: (o) => { outcome = o; },
    requestFrame: c.requestFrame, cancelFrame: c.cancelFrame,
  });
  c.advance(0);    // first frame: starts the clock
  c.advance(250);  // 2.5 ticks of 100 ms
  expect(loop.run.tick).toBe(2);
  expect(alphas.at(-1)).toBeCloseTo(0.5);
  loop.pause();
  c.advance(1000);
  expect(loop.run.tick).toBe(2);
  loop.resume();
  c.advance(0);
  for (let i = 0; i < 10; i++) c.advance(100);
  expect(outcome).toBe("done");
  expect(loop.inputs).toEqual([1, 2, 1, 2, 1, 2, 1]); // 10 reached on the 7th tick
  expect((await verifyReplay(counter, await loop.replay())).ok).toBe(true);
  await loop.restart();
  expect([loop.run.tick, loop.inputs.length]).toEqual([0, 0]);
  loop.stop();
});

it("caps ticks per frame after a long stall", async () => {
  const c = clock();
  const loop = await startGame(counter, null, { tickRate: 100, input: () => 0, render: () => {}, maxTicksPerFrame: 3,
    requestFrame: c.requestFrame, cancelFrame: c.cancelFrame });
  c.advance(0);
  c.advance(60_000);
  expect(loop.run.tick).toBe(3);
  loop.stop();
});

it("tracks held keys and per-tick edges, and clears on blur", () => {
  const target = new EventTarget();
  const input = createInput(target, { preventDefaults: false });
  const key = (type: string, code: string) => target.dispatchEvent(Object.assign(new Event(type), { code }));
  key("keydown", "KeyW");
  key("keyup", "KeyW"); // a tap shorter than a tick
  expect([input.down("KeyW"), input.pressed("KeyW"), input.released("KeyW")]).toEqual([false, true, true]);
  input.endTick();
  expect(input.pressed("KeyW")).toBe(false);
  key("keydown", "Space");
  key("keydown", "Space"); // auto-repeat is not a new press
  input.endTick();
  expect([input.down("Space"), input.pressed("Space")]).toEqual([true, false]);
  target.dispatchEvent(Object.assign(new Event("pointermove"), { offsetX: 10, offsetY: 20, movementX: 3, movementY: -1 }));
  target.dispatchEvent(Object.assign(new Event("pointermove"), { offsetX: 12, offsetY: 21, movementX: 2, movementY: 1 }));
  expect(input.pointer).toMatchObject({ x: 12, y: 21, dx: 5, dy: 0 });
  target.dispatchEvent(new Event("blur"));
  expect([input.down("Space"), input.released("Space")]).toEqual([false, true]);
  input.dispose();
  key("keydown", "KeyA");
  expect(input.down("KeyA")).toBe(false);
});
