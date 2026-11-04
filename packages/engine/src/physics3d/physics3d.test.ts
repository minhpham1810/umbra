import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { z } from "zod";
import { createGame, defineGame, runGame, type World } from "../core/index.js";
import { navPath } from "../nav/nav.js";
import {
  Character, CharacterMove, CharacterState, Collider, Contact, RigidBody, Transform, Velocity, navBakeWorld, physics, physics3d,
} from "./index.js";

const floor = (w: World, size = 10) =>
  w.spawn(Transform({ position: { x: 0, y: -0.5, z: 0 } }), Collider({ shape: { type: "box", half: { x: size, y: 0.5, z: size } } }));
const crate = (w: World, y: number) => w.spawn(Transform({ position: { x: 0, y, z: 0 } }), RigidBody({ type: "dynamic" }),
  Collider({ shape: { type: "box", half: { x: 0.5, y: 0.5, z: 0.5 } } }), Velocity({ linear: { x: 0, y: 0, z: 0 } }));

/** A sandbox game: input is the character's desired move per tick (game code integrates gravity). */
const sandbox = (setup: (w: World) => void) => defineGame({
  name: "sandbox",
  input: z.object({ x: z.number(), z: z.number(), jump: z.boolean().optional() }).nullable(),
  plugins: [physics3d()],
  setup,
  systems: [function walk(w, input) {
    for (const [e, , state] of w.query(Character, CharacterState)) {
      const vy = (w.get(e, CharacterMove)?.y ?? 0) / (1 / 60);
      const fall = state.grounded ? (input?.jump ? 6 : -0.5) : vy - 20 / 60;
      w.set(e, CharacterMove, { x: (input?.x ?? 0) / 60, y: fall / 60, z: (input?.z ?? 0) / 60 });
    }
  }],
});
const hero = (w: World, x = 0, z = 0) => w.spawn(Transform({ position: { x, y: 1.0, z } }),
  Character({ radius: 0.3, halfHeight: 0.4, skin: 0.01, snapToGround: 0.1, autostep: { maxHeight: 0.35, minWidth: 0.2 } }),
  CharacterState({ grounded: true, moved: { x: 0, y: 0, z: 0 } }));

describe("bodies", () => {
  it("drops a box onto the floor, where it comes to rest", async () => {
    const run = await createGame(sandbox((w) => { floor(w); crate(w, 3); }), null);
    for (let i = 0; i < 180; i++) run.step(null);
    const [, , t] = run.world.first(RigidBody, Transform)!;
    expect(t.position.y).toBeCloseTo(0.5, 1);
    expect(Math.abs(run.world.first(Velocity)![1].linear.y)).toBeLessThan(0.05);
    run.dispose();
  });

  it("is deterministic with stacked dynamic bodies (property)", async () => {
    const game = sandbox((w) => { floor(w); for (let i = 0; i < 4; i++) crate(w, 1 + i * 1.1); });
    await fc.assert(fc.asyncProperty(fc.array(fc.record({ x: fc.integer({ min: -5, max: 5 }), z: fc.integer({ min: -5, max: 5 }) }), { maxLength: 60 }), async (moves) => {
      const a = await runGame(game, null, { inputs: moves });
      const b = await runGame(game, null, { inputs: moves });
      return a.tickHashes.join() === b.tickHashes.join();
    }), { numRuns: 20 });
  });

  it("applies teleports, velocity edits and impulses from game code, and removes despawned bodies", async () => {
    let box = 0;
    const run = await createGame(sandbox((w) => { floor(w); box = crate(w, 0.5); }), null);
    for (let i = 0; i < 30; i++) run.step(null);
    run.world.set(box, Transform, { position: { x: 3, y: 0.5, z: 0 } });
    run.step(null);
    expect(run.world.get(box, Transform)!.position.x).toBeCloseTo(3, 2);
    run.world.set(box, Velocity, { linear: { x: 0, y: 5, z: 0 } });
    run.step(null);
    expect(run.world.get(box, Transform)!.position.y).toBeGreaterThan(0.55);
    for (let i = 0; i < 90; i++) run.step(null);
    physics(run.world).applyImpulse(box, { x: 2, y: 0, z: 0 });
    run.step(null);
    expect(run.world.get(box, Velocity)!.linear.x).toBeGreaterThan(0.5);
    const above = { ...run.world.get(box, Transform)!.position, y: 5 };
    expect(physics(run.world).raycast(above, { x: 0, y: -1, z: 0 }, 10)?.entity).toBe(box);
    run.world.despawn(box);
    run.step(null);
    expect(physics(run.world).raycast(above, { x: 0, y: -1, z: 0 }, 10)?.entity).toBe(1); // the floor below
    run.dispose();
  });
});

describe("characters", () => {
  it("walks, stays grounded, is stopped by walls and climbs low steps", async () => {
    const game = sandbox((w) => {
      floor(w);
      hero(w);
      w.spawn(Transform({ position: { x: 0, y: 0.15, z: 2 } }), Collider({ shape: { type: "box", half: { x: 1, y: 0.15, z: 0.5 } } })); // 0.3 m step
      w.spawn(Transform({ position: { x: 0, y: 1, z: 5 } }), Collider({ shape: { type: "box", half: { x: 3, y: 1, z: 0.2 } } }));   // wall
    });
    const run = await createGame(game, null);
    for (let i = 0; i < 30; i++) run.step(null);
    expect(run.world.first(CharacterState)![1].grounded).toBe(true);
    for (let i = 0; i < 240; i++) run.step({ x: 0, z: 3 });
    const [, , t] = run.world.first(Character, Transform)!;
    expect(t.position.z).toBeGreaterThan(4); // past the step
    expect(t.position.z).toBeLessThan(4.6);  // but not through the wall (z 4.8 minus radius)
    run.dispose();
  });

  it("reports sensor enter and exit as Contact events", async () => {
    let goal = 0;
    const game = sandbox((w) => {
      floor(w);
      hero(w);
      goal = w.spawn(Transform({ position: { x: 0, y: 1, z: 3 } }), Collider({ shape: { type: "box", half: { x: 0.5, y: 1, z: 0.5 } }, sensor: true }));
    });
    const r = await runGame(game, null, { inputs: Array.from({ length: 150 }, () => ({ x: 0, z: 3 })) });
    const contacts = r.events.filter((e) => e.type === Contact.name).map((e) => e.data as { b: number; started: boolean; sensor: boolean });
    expect(contacts.map((c) => c.started)).toEqual([true, false]);
    expect(contacts.every((c) => c.sensor && c.b === goal)).toBe(true);
  });
});

it("restores checkpoints exactly, including contacts after the restore", async () => {
  const game = sandbox((w) => {
    floor(w); hero(w);
    for (let i = 0; i < 3; i++) crate(w, 2 + i * 1.2);
    w.spawn(Transform({ position: { x: 0, y: 1, z: 3 } }), Collider({ shape: { type: "box", half: { x: 0.5, y: 1, z: 0.5 } }, sensor: true }));
  });
  const run = await createGame(game, null, { seed: 4 });
  for (let i = 0; i < 20; i++) run.step({ x: 0, z: 2 });
  const cp = run.save();
  const go = () => {
    const out: string[] = [];
    for (let i = 0; i < 100; i++) out.push(`${run.hash}:${run.step({ x: 0, z: 2 }).length}`);
    return out;
  };
  const first = go();
  run.load(cp);
  expect(go()).toEqual(first);
  expect(first.some((s) => !s.endsWith(":0"))).toBe(true); // contacts happened in the compared stretch
  run.dispose();
});

it("bakes a navmesh from fixed colliders, with walls as obstacles", async () => {
  const run = await createGame(sandbox((w) => {
    floor(w, 5);
    w.spawn(Transform({ position: { x: 0, y: 1, z: 0 } }), Collider({ shape: { type: "box", half: { x: 5, y: 1, z: 0.2 } } })); // full-width wall
    crate(w, 3); // dynamic: ignored
  }), null);
  const { navmeshId, islands } = await navBakeWorld(run.world);
  expect(islands.length).toBe(2); // the wall splits the floor
  expect(navPath(navmeshId, { x: 0, y: 0, z: -3 }, { x: 2, y: 0, z: -1 }).found).toBe(true);
  expect(navPath(navmeshId, { x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 3 }).found).toBe(false);
  run.dispose();
});
