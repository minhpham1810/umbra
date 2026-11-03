/**
 * Builder: turns a design brief into a Lantern scene. Gemini writes a small blueprint
 * (floor rectangles, pits, platforms, spawn, exit); compileBlueprint snaps it to kit
 * pieces and closes the level with a two-high wall ring. Errors go back to the model.
 */
import { z } from "zod";
import { validateScene, type KitPiece, type Scene } from "@umbra/engine";
import { parseJson, type Generate } from "./gemini.js";

const coord = z.number().int().min(-48).max(48);
const Rect = z.object({ x0: coord, z0: coord, x1: coord, z1: coord })
  .refine((r) => r.x0 <= r.x1 && r.z0 <= r.z1, "x0 <= x1 and z0 <= z1 required");

export const BlueprintSchema = z.object({
  name: z.string().min(1).max(80),
  floors: z.array(z.object({ x0: coord, z0: coord, x1: coord, z1: coord, y: z.number().int().min(0).max(6).default(0) })
    .refine((r) => r.x0 <= r.x1 && r.z0 <= r.z1, "x0 <= x1 and z0 <= z1 required")).min(1).max(32),
  pits: z.array(Rect).max(32).default([]),
  platforms: z.array(z.object({ x: coord, z: coord, y: z.number().int().min(0).max(6).default(0),
    axis: z.enum(["x", "z"]), distance: z.number().int().min(1).max(16), speed: z.number().min(0.5).max(5) })).max(8).default([]),
  spawn: z.object({ x: coord, z: coord }),
  exit: z.object({ x: coord, z: coord }),
});
export type Blueprint = z.infer<typeof BlueprintSchema>;

const intProp = { type: "integer" };
const rectProps = { x0: intProp, z0: intProp, x1: intProp, z1: intProp };
const cell = { type: "object", properties: { x: intProp, z: intProp }, required: ["x", "z"] };
export const BLUEPRINT_JSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    floors: { type: "array", items: { type: "object", properties: { ...rectProps, y: intProp }, required: ["x0", "z0", "x1", "z1"] } },
    pits: { type: "array", items: { type: "object", properties: rectProps, required: ["x0", "z0", "x1", "z1"] } },
    platforms: { type: "array", items: { type: "object", properties: { x: intProp, z: intProp, y: intProp,
      axis: { type: "string", enum: ["x", "z"] }, distance: intProp, speed: { type: "number" } },
    required: ["x", "z", "axis", "distance", "speed"] } },
    spawn: cell,
    exit: cell,
  },
  required: ["name", "floors", "spawn", "exit"],
};

const MAX_CELLS = 2000;
const key = (x: number, z: number) => `${x},${z}`;

/** Snap a blueprint to kit pieces. Throws with a readable message on semantic errors. */
export function compileBlueprint(raw: unknown): Scene {
  const bp = BlueprintSchema.parse(raw);
  const floor = new Map<string, number>(); // column → floor top block y; later rects win
  const cells = (r: { x0: number; z0: number; x1: number; z1: number }) => {
    const out: [number, number][] = [];
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) out.push([x, z]);
    return out;
  };
  for (const r of bp.floors) for (const [x, z] of cells(r)) floor.set(key(x, z), r.y);
  if (floor.size > MAX_CELLS) throw new Error(`Level too large: ${floor.size} floor cells (max ${MAX_CELLS})`);
  const pit = new Set<string>();
  for (const r of bp.pits) for (const [x, z] of cells(r)) { floor.delete(key(x, z)); pit.add(key(x, z)); }
  // A platform's path is open air the level owns, like a pit.
  for (const p of bp.platforms) {
    for (let d = 0; d <= p.distance; d++) {
      const k = p.axis === "x" ? key(p.x + d, p.z) : key(p.x, p.z + d);
      if (floor.has(k)) throw new Error(`Platform at (${p.x}, ${p.z}) moves through floor cell ${k}; put pits under its path`);
      pit.add(k);
    }
  }
  const at = (name: string, c: { x: number; z: number }) => {
    const y = floor.get(key(c.x, c.z));
    if (y === undefined) throw new Error(`${name} (${c.x}, ${c.z}) is not on a floor cell`);
    return y;
  };
  const spawnY = at("spawn", bp.spawn);
  const exitY = at("exit", bp.exit);

  const pieces: KitPiece[] = [];
  for (const [k, top] of floor) {
    const [x, z] = k.split(",").map(Number) as [number, number];
    for (let y = 0; y <= top; y++) pieces.push({ kind: "floor", pos: { x, y, z }, rot: 0 });
  }
  for (const k of pit) {
    const [x, z] = k.split(",").map(Number) as [number, number];
    pieces.push({ kind: "pit", pos: { x, y: 0, z }, rot: 0 });
  }
  for (const p of bp.platforms) {
    pieces.push({ kind: "moving_platform", pos: { x: p.x, y: p.y, z: p.z }, rot: 0,
      props: { axis: p.axis, distance: p.distance, speed: p.speed } });
  }
  // Two blocks above the highest floor: a jump peaks about 1.6 m.
  const wallTop = Math.max(...floor.values()) + 2;
  const inside = new Set([...floor.keys(), ...pit]);
  const ring = new Set<string>();
  for (const k of inside) {
    const [x, z] = k.split(",").map(Number) as [number, number];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!inside.has(key(x + dx, z + dz))) ring.add(key(x + dx, z + dz));
    }
  }
  for (const k of ring) {
    const [x, z] = k.split(",").map(Number) as [number, number];
    for (let y = 1; y <= wallTop; y++) pieces.push({ kind: "wall", pos: { x, y, z }, rot: 0 });
  }
  const result = validateScene({
    version: 1, pieces,
    spawn: { pos: { x: bp.spawn.x + 0.5, y: spawnY + 1.72, z: bp.spawn.z + 0.5 }, yaw: 0 },
    goals: [{ id: "exit", kind: "exit", pos: { x: bp.exit.x, y: exitY + 1, z: bp.exit.z } }],
    meta: { name: bp.name, builtBy: "builder" },
  });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.scene;
}

export function buildPrompt(brief: string, errors: string[]): string {
  return [
    "You design levels for Lantern, a dark third-person 3D platformer, on a 1-metre grid (x and z are integers).",
    "Write a blueprint as JSON:",
    "- floors: rectangles {x0,z0,x1,z1,y} of walkable floor (inclusive). y is the floor height in blocks (0 = ground); later rectangles overwrite earlier ones.",
    "- pits: rectangles of intentional void the player can fall into. Every gap in the floor must be a pit.",
    "- platforms: {x,z,y,axis,distance,speed} moving platforms that shuttle `distance` cells along axis x or z and back at `speed` m/s. Their path must be pits, not floor; the player boards from the floor cell just before (x,z) and steps off at the cell just past the far end.",
    "- spawn and exit: {x,z} floor cells.",
    "Walls are added automatically around the level. Physics: the player walks at 5 m/s; a running jump clears a gap of up to 3 cells and climbs 1 block; it cannot climb 2 blocks.",
    "Keep levels under 30 cells in each direction. Make the brief's challenge actually required to reach the exit.",
    ...(errors.length ? ["Your previous blueprint was rejected. Fix these errors:", ...errors.map((e) => `- ${e}`)] : []),
    `Brief: ${brief}`,
  ].join("\n");
}

export interface BuildResult { scene: Scene; blueprint: Blueprint; attempts: number; errors: string[] }

/** Ask for a blueprint until it compiles to a valid scene, feeding errors back each time. */
export async function buildLevel(brief: string, generate: Generate, maxAttempts = 3): Promise<BuildResult> {
  const errors: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = parseJson(await generate(buildPrompt(brief, errors.slice(-3)), BLUEPRINT_JSON_SCHEMA), "blueprint");
      const scene = compileBlueprint(raw);
      return { scene, blueprint: BlueprintSchema.parse(raw), attempts: attempt, errors };
    } catch (e) {
      errors.push(e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (e as Error).message);
    }
  }
  throw new Error(`Builder gave up after ${maxAttempts} attempts: ${errors.join(" | ")}`);
}
