import { z } from "zod";

/** Kit pieces that snap to a 1-metre grid. */
export const KitPieceKindSchema = z.enum([
  "floor",
  "wall",
  "stairs",
  "ramp",
  "pit",
  "moving_platform",
]);

export const Vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const GridPosSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});

export const KitPieceSchema = z.object({
  kind: KitPieceKindSchema,
  pos: GridPosSchema,
  /** Rotation in 90-degree steps (0–3). */
  rot: z.number().int().min(0).max(3).default(0),
  /** Optional per-piece properties (e.g. platform speed). */
  props: z.record(z.string(), z.unknown()).optional(),
});

export const SpawnSchema = z.object({
  pos: Vec3Schema,
  yaw: z.number().int().min(0).max(255).default(0),
});

export const GoalSchema = z.object({
  id: z.string(),
  kind: z.enum(["exit", "key", "door", "hazard"]),
  pos: GridPosSchema,
});

export const SceneSchema = z.object({
  /** Schema version — bump when the format changes. */
  version: z.number().int().default(1),
  /** Rapier version this scene was authored against. */
  rapierVersion: z.string().default("0.12.0"),
  pieces: z.array(KitPieceSchema),
  spawn: SpawnSchema,
  goals: z.array(GoalSchema),
  /** Optional free-form metadata (game name, designer notes). */
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type Scene = z.infer<typeof SceneSchema>;
export type KitPieceKind = z.infer<typeof KitPieceKindSchema>;
export type KitPiece = z.infer<typeof KitPieceSchema>;
export type Goal = z.infer<typeof GoalSchema>;

/** Validate a scene and return errors, or null if valid. */
export function validateScene(raw: unknown): { ok: true; scene: Scene } | { ok: false; errors: string[] } {
  const result = SceneSchema.safeParse(raw);
  if (result.success) return { ok: true, scene: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
