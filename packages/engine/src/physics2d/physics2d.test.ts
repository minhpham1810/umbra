import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { z } from "zod";
import { createGame, defineGame, runGame, type World } from "../core/index.js";
import {
  Character2D, CharacterMove2D, CharacterState2D, Collider2D, Contact2D, RigidBody2D, Velocity2D, physics2d, physics2dOf,
} from "./physics2d.js";
import { Transform } from "../spatial/transform.js";
import { angleZ, rotationZ } from "../spatial/angle.js";

const at = (x: number, y: number, z = 0) => Transform({ position: { x, y, z } });
const ground = (w: World, size = 10) => w.spawn(at(0, -0.5), Collider2D({ shape: { type: "box", half: { x: size, y: 0.5 } } }));
const crate = (w: World, x: number, y: number) => w.spawn(at(x, y), RigidBody2D({ type: "dynamic" }),
  Collider2D({ shape: { type: "box", half: { x: 0.5, y: 0.5 } } }), Velocity2D({ linear: { x: 0, y: 0 } }));

/** Input is the character's walk speed (m/s) and a jump; game code integrates gravity. */
const sandbox = (setup: (w: World) => void) => defineGame({
  name: "sandbox2d",
  input: z.object({ x: z.number(), jump: z.boolean().optional() }).nullable(),
  plugins: [physics2d()],
  setup,
  systems: [function walk(w, input) {
    for (const [e, , state] of w.query(Character2D, CharacterState2D)) {
      const vy = (w.get(e, CharacterMove2D)?.y ?? 0) * 60;
      const fall = state.grounded ? (input?.jump ? 7 : -0.5) : vy - 20 / 60;
      w.set(e, CharacterMove2D, { x: (input?.x ?? 0) / 60, y: fall / 60 });
    }
  }],
});
const hero = (w: World, x = 0) => w.spawn(at(x, 1, 3),
  Character2D({ radius: 0.3, halfHeight: 0.4, snapToGround: 0.1, autostep: { maxHeight: 0.35, minWidth: 0.2 } }),
  CharacterState2D({ grounded: true, moved: { x: 0, y: 0 } }));

describe("bodies", () => {
  it("drops a box onto the ground and tips a tilted one over", async () => {
    let tilted = 0;
    const run = await createGame(sandbox((w) => {
      ground(w); crate(w, -3, 3);
      tilted = crate(w, 3, 1.2);
      w.set(tilted, Transform, { position: { x: 3, y: 1.2, z: 0 }, rotation: rotationZ(0.6) });
    }), null);
    for (let i = 0; i < 240; i++) run.step(null);
    const [, , t] = run.world.first(RigidBody2D, Transform)!;
    expect(t.position.y).toBeCloseTo(0.5, 1);
    expect(Math.abs(run.world.first(Velocity2D)![1].linear.y)).toBeLessThan(0.05);
    // A box on its corner falls flat: a multiple of 90°.
    const a = angleZ(run.world.get(tilted, Transform)!.rotation);
    expect(Math.abs(Math.sin(2 * a))).toBeLessThan(0.05);
    run.dispose();
  });

  it("is deterministic with a pile of boxes and circles (property)", async () => {
    const game = sandbox((w) => {
      ground(w);
      for (let i = 0; i < 4; i++) crate(w, i * 0.3, 1 + i * 1.1);
      w.spawn(at(0.2, 6), RigidBody2D({ type: "dynamic" }), Collider2D({ shape: { type: "circle", radius: 0.4 }, restitution: 0.5 }));
      hero(w, -2);
    });
    await fc.assert(fc.asyncProperty(fc.array(fc.record({ x: fc.integer({ min: -5, max: 5 }), jump: fc.boolean() }), { maxLength: 60 }), async (moves) => {
      const a = await runGame(game, null, { inputs: moves });
      const b = await runGame(game, null, { inputs: moves });
      return a.tickHashes.join() === b.tickHashes.join();
    }), { numRuns: 20 });
  });

  it("applies teleports, velocity edits and impulses, ray casts, and keeps z for draw order", async () => {
    let box = 0;
    const run = await createGame(sandbox((w) => { ground(w); box = crate(w, 0, 0.5); w.set(box, Transform, { position: { x: 0, y: 0.5, z: 7 } }); }), null);
    for (let i = 0; i < 30; i++) run.step(null);
    run.world.set(box, Transform, { position: { x: 3, y: 0.5, z: 7 } });
    run.step(null);
    expect(run.world.get(box, Transform)!.position).toMatchObject({ x: expect.closeTo(3, 2), z: 7 });
    run.world.set(box, Velocity2D, { linear: { x: 0, y: 5 } });
    run.step(null);
    expect(run.world.get(box, Transform)!.position.y).toBeGreaterThan(0.55);
    for (let i = 0; i < 90; i++) run.step(null);
    physics2dOf(run.world).applyImpulse(box, { x: 2, y: 0 });
    run.step(null);
    expect(run.world.get(box, Velocity2D)!.linear.x).toBeGreaterThan(0.5);
    const above = { x: run.world.get(box, Transform)!.position.x, y: 5 };
    expect(physics2dOf(run.world).raycast(above, { x: 0, y: -1 }, 10)).toMatchObject({ entity: box, distance: expect.closeTo(4, 1) });
    run.world.despawn(box);
    run.step(null);
    expect(physics2dOf(run.world).raycast(above, { x: 0, y: -1 }, 10)?.entity).toBe(1);
    run.dispose();
  });

  it("collides with convex shapes and polyline terrain", async () => {
    const run = await createGame(sandbox((w) => {
      w.spawn(at(0, 0), Collider2D({ shape: { type: "polyline", points: [{ x: -10, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }] } }));
      w.spawn(at(-6, 6), RigidBody2D({ type: "dynamic" }), Collider2D({ shape: { type: "convex", points: [{ x: -0.5, y: -0.4 }, { x: 0.5, y: -0.4 }, { x: 0, y: 0.5 }] }, friction: 0 }));
    }), null);
    for (let i = 0; i < 300; i++) run.step(null);
    const [, , t] = run.world.first(RigidBody2D, Transform)!;
    expect(t.position.x).toBeGreaterThan(-1); // slid down the slope
    expect(t.position.y).toBeGreaterThan(0);  // and rests on the flat part, not through it
    expect(t.position.y).toBeLessThan(1);
    run.dispose();
    await expect(createGame(sandbox((w) => {
      w.spawn(at(0, 0), Collider2D({ shape: { type: "convex", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] } }));
    }), null)).rejects.toThrow(/in a line/);
  });
});

describe("characters", () => {
  it("walks, jumps, is stopped by walls, climbs low steps and fires sensors", async () => {
    let coin = 0;
    const game = sandbox((w) => {
      ground(w);
      hero(w);
      w.spawn(at(2, 0.15), Collider2D({ shape: { type: "box", half: { x: 0.5, y: 0.15 } } })); // 0.3 m step
      w.spawn(at(5, 1), Collider2D({ shape: { type: "box", half: { x: 0.2, y: 1 } } }));      // wall
      coin = w.spawn(at(1, 1), Collider2D({ shape: { type: "circle", radius: 0.3 }, sensor: true }));
    });
    const run = await createGame(game, null);
    for (let i = 0; i < 30; i++) run.step(null);
    expect(run.world.first(CharacterState2D)![1].grounded).toBe(true);
    const events = [];
    for (let i = 0; i < 240; i++) events.push(...run.step({ x: 3 }));
    const [, , t] = run.world.first(Character2D, Transform)!;
    expect(t.position.x).toBeGreaterThan(4);  // past the step
    expect(t.position.x).toBeLessThan(4.6);   // not through the wall (4.8 minus radius)
    expect(t.position.z).toBe(3);
    const contacts = events.filter((e) => e.type === Contact2D.name).map((e) => e.data as { b: number; started: boolean; sensor: boolean });
    expect(contacts).toEqual([{ a: 2, b: coin, started: true, sensor: true }, { a: 2, b: coin, started: false, sensor: true }]);
    run.step({ x: 0, jump: true });
    for (let i = 0; i < 10; i++) run.step(null);
    expect(run.world.first(Character2D, Transform)![2].position.y).toBeGreaterThan(1.5);
    run.dispose();
  });
});

it("restores checkpoints exactly", async () => {
  const game = sandbox((w) => { ground(w); hero(w); for (let i = 0; i < 3; i++) crate(w, 1.5, 2 + i * 1.2); });
  const run = await createGame(game, null, { seed: 4 });
  for (let i = 0; i < 20; i++) run.step({ x: 2 });
  const cp = run.save();
  const go = () => Array.from({ length: 100 }, () => (run.step({ x: 2 }), run.hash));
  const first = go();
  run.load(cp);
  expect(go()).toEqual(first);
  run.dispose();
});
