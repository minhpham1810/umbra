/**
 * Seeded-bug benchmark levels. A level is a spec (a straight corridor of sections),
 * compiled through the Builder's blueprint compiler. Each mutation plants exactly one
 * bug whose type and location are known by construction (see `Truth`).
 *
 * Physics limits the mutations rely on (runner.ts): walk 5 m/s, jump impulse 8 m/s,
 * gravity 20 m/s² → peak 1.6 m, about 4 m of air travel.
 */
import { compileBlueprint, type Blueprint } from "umbra-agents";
import type { KitPiece, Scene } from "umbra-engine";

export type Section =
  | { kind: "flat"; len: number }
  | { kind: "step"; dy: 1 | -1 }
  | { kind: "gap"; len: number }
  | { kind: "ferry" };

export interface Spec { id: string; width: number; sections: Section[] }

export const MUTATIONS = ["chasm", "ledge", "walled-exit", "missing-tile", "low-wall"] as const;
export type Mutation = (typeof MUTATIONS)[number];

/** The planted bug. A finding matches when its type agrees and (for falls) its cell is within 1 of `cell`. */
export type Truth =
  | { type: "clean" }
  | { type: "unreachable_goal"; goalId: "exit" }
  | { type: "fall_through" | "out_of_bounds"; cell: { x: number; z: number } };

const LANDING = 3;
/** Six cells is 6 m: past the ~4 m a running jump covers, even counting the capsule's 0.3 m radius. */
const CHASM = 6;
/** Three blocks up: the jump peaks at 1.6 m. */
const LEDGE = 3;

export function lcg(seed: number) {
  let s = seed >>> 0;
  return (n: number) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n; };
}

/** A random clean-candidate spec: 4–7 sections, y kept in 0..3 so a ledge mutation stays in range. */
export function randomSpec(id: string, seed: number): Spec {
  const rand = lcg(seed);
  const width = 1 + rand(3);
  const sections: Section[] = [];
  let y = 0;
  const count = 4 + rand(4);
  for (let i = 0; i < count; i++) {
    const r = rand(10);
    if (r < 3) sections.push({ kind: "flat", len: 2 + rand(4) });
    else if (r < 6) {
      const dy = y >= 3 ? -1 : y <= 0 ? 1 : rand(2) ? 1 : -1;
      y += dy;
      sections.push({ kind: "step", dy });
    } else if (r < 9) sections.push({ kind: "gap", len: 1 + rand(2) });
    else sections.push({ kind: "ferry" });
  }
  return { id, width, sections };
}

/** Where things land in the compiled level, for mutations to aim at. */
interface Layout {
  bp: Blueprint;
  /** Floor cells per flat run (not landings next to gaps), with their top y. */
  flats: { x: number; z: number; y: number }[][];
  exit: { x: number; z: number; y: number };
}

export function layout(spec: Spec, extra: { chasmAfter?: number; ledgeAfter?: number } = {}): Layout {
  const w = spec.width, cx = Math.floor((w - 1) / 2);
  const bp: Blueprint = { name: spec.id, floors: [], pits: [], platforms: [], spawn: { x: cx, z: 1 }, exit: { x: cx, z: 0 } };
  const flats: Layout["flats"] = [];
  let z = 0, y = 0;
  const floor = (len: number, flat: boolean) => {
    bp.floors.push({ x0: 0, z0: z, x1: w - 1, z1: z + len - 1, y });
    if (flat) {
      const run: { x: number; z: number; y: number }[] = [];
      for (let dz = 0; dz < len; dz++) for (let x = 0; x < w; x++) run.push({ x, z: z + dz, y });
      flats.push(run);
    }
    z += len;
  };
  const pit = (len: number) => { bp.pits.push({ x0: 0, z0: z, x1: w - 1, z1: z + len - 1 }); z += len; };
  floor(3, true); // spawn run
  spec.sections.forEach((s, i) => {
    if (s.kind === "flat") floor(s.len, true);
    else if (s.kind === "step") { y += s.dy; floor(LANDING, false); }
    else if (s.kind === "gap") { pit(s.len); floor(LANDING, false); }
    else {
      // Level 2's ferry: a 6-cell chasm and a platform riding 5 cells along it.
      bp.platforms.push({ x: cx, z, y, axis: "z", distance: 5, speed: 1.5 });
      pit(6); floor(LANDING, false);
    }
    if (extra.ledgeAfter === i) { y += LEDGE; floor(LANDING, false); }
    if (extra.chasmAfter === i) { pit(CHASM); floor(LANDING, false); }
  });
  floor(3, false); // exit run
  bp.exit = { x: cx, z: z - 2 };
  return { bp, flats, exit: { x: cx, z: z - 2, y } };
}

const withMeta = (scene: Scene, meta: Record<string, unknown>): Scene => ({ ...scene, meta: { ...scene.meta, ...meta } });

export function cleanLevel(spec: Spec): Scene {
  return withMeta(compileBlueprint(layout(spec).bp), { benchmark: { truth: { type: "clean" } satisfies Truth, spec } });
}

/** Plant one bug. `pick` chooses among valid spots so mutations vary across levels. */
export function mutate(spec: Spec, mutation: Mutation, pick: (n: number) => number): Scene {
  const mid = Math.floor(spec.sections.length / 2);
  let scene: Scene;
  let truth: Truth;
  if (mutation === "chasm" || mutation === "ledge") {
    const after = mid - 1 + pick(2);
    scene = compileBlueprint(layout(spec, mutation === "chasm" ? { chasmAfter: after } : { ledgeAfter: after }).bp);
    truth = { type: "unreachable_goal", goalId: "exit" };
  } else {
    const { bp, flats, exit } = layout(spec);
    scene = compileBlueprint(bp);
    const runs = flats.slice(1).filter((r) => r.length >= 2); // skip the spawn run
    const run = runs.length ? runs[pick(runs.length)]! : flats[0]!;
    if (mutation === "walled-exit") {
      // Three-high walls on every floor cell around the exit, diagonals included.
      const add: KitPiece[] = [];
      for (const p of scene.pieces) {
        if (p.kind !== "floor" || Math.max(Math.abs(p.pos.x - exit.x), Math.abs(p.pos.z - exit.z)) !== 1) continue;
        if (scene.pieces.some((q) => q.kind === "floor" && q.pos.x === p.pos.x && q.pos.z === p.pos.z && q.pos.y > p.pos.y)) continue;
        for (let dy = 1; dy <= 3; dy++) add.push({ kind: "wall", pos: { x: p.pos.x, y: p.pos.y + dy, z: p.pos.z }, rot: 0 });
      }
      scene = { ...scene, pieces: [...scene.pieces, ...add] };
      truth = { type: "unreachable_goal", goalId: "exit" };
    } else if (mutation === "missing-tile") {
      const c = run[pick(run.length)]!;
      scene = { ...scene, pieces: scene.pieces.filter((p) => !(p.kind === "floor" && p.pos.x === c.x && p.pos.z === c.z)) };
      truth = { type: "fall_through", cell: { x: c.x, z: c.z } };
    } else {
      // Cut a side wall down to one block above the floor; beyond it is open air.
      const c = run[pick(run.length)]!;
      const wx = pick(2) ? -1 : spec.width;
      scene = { ...scene, pieces: scene.pieces.filter((p) => !(p.kind === "wall" && p.pos.x === wx && p.pos.z === c.z && p.pos.y > c.y + 1)) };
      truth = { type: "out_of_bounds", cell: { x: wx, z: c.z } };
    }
  }
  return withMeta({ ...scene, meta: { ...scene.meta, name: `${spec.id} · ${mutation}` } }, { benchmark: { truth, spec, mutation } });
}

export const truthOf = (scene: Scene): Truth | undefined =>
  (scene.meta?.["benchmark"] as { truth?: Truth } | undefined)?.truth;
