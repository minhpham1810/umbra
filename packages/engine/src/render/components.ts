/**
 * What to draw, as presentation components: a renderer reads them with each entity's
 * Transform. They are saved with the world but not hashed, so visual changes never
 * invalidate replays. Spawn them in setup (not from the renderer), so headless and browser
 * runs create the same entities.
 */
import { z } from "zod";
import { defineComponent } from "../core/world.js";
import { Vec3 } from "../spatial/transform.js";

/** "#rrggbb" or 0xrrggbb. */
export const Color = z.union([z.string().regex(/^#[0-9a-f]{6}$/i), z.number().int().min(0).max(0xffffff)]);
export type Color = z.infer<typeof Color>;

const positive = z.number().positive();
export const Geometry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("box"), half: Vec3 }),
  z.object({ type: z.literal("sphere"), radius: positive }),
  z.object({ type: z.literal("capsule"), halfHeight: positive, radius: positive }),
  z.object({ type: z.literal("cylinder"), halfHeight: positive, radius: positive }),
  /** A flat rectangle on the xz plane, facing up. */
  z.object({ type: z.literal("plane"), width: positive, depth: positive }),
  z.object({ type: z.literal("mesh"), vertices: z.array(z.number().finite()), indices: z.array(z.number().int().min(0)) }),
  /** A model loaded by the renderer's asset loader, e.g. a glTF file's path. */
  z.object({ type: z.literal("model"), asset: z.string().min(1) }),
]);
export type Geometry = z.infer<typeof Geometry>;

export const Material = z.object({
  color: Color.default("#cccccc"),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  emissive: Color.optional(),
  emissiveIntensity: z.number().min(0).optional(),
  opacity: z.number().min(0).max(1).optional(),
  wireframe: z.boolean().optional(),
});

/** Something to draw at the entity's Transform. */
export const Mesh = defineComponent("mesh", z.object({
  geometry: Geometry,
  /** Ignored for models, which bring their own materials. */
  material: Material.default({}),
  /** Offset from the Transform, in the entity's frame. */
  offset: Vec3.optional(),
  scale: Vec3.optional(),
  castShadow: z.boolean().optional(),
  receiveShadow: z.boolean().optional(),
  visible: z.boolean().default(true),
}), { presentation: true });

/** A perspective camera at the entity's Transform. The active one with the lowest id draws. */
export const Camera = defineComponent("camera", z.object({
  fov: z.number().min(1).max(179).default(60),
  near: positive.default(0.1),
  far: positive.default(500),
  /** Look at this point instead of using the Transform's rotation. */
  lookAt: Vec3.optional(),
  active: z.boolean().default(true),
}), { presentation: true });

/** A light; directional, point and spot lights sit at the entity's Transform. */
export const Light = defineComponent("light", z.discriminatedUnion("type", [
  z.object({ type: z.literal("ambient"), color: Color.default("#ffffff"), intensity: z.number().min(0).default(1) }),
  z.object({ type: z.literal("hemisphere"), sky: Color.default("#ffffff"), ground: Color.default("#444444"), intensity: z.number().min(0).default(1) }),
  z.object({ type: z.literal("directional"), color: Color.default("#ffffff"), intensity: z.number().min(0).default(1),
    /** Where it shines towards (default the origin). */
    target: Vec3.optional(), castShadow: z.boolean().optional() }),
  z.object({ type: z.literal("point"), color: Color.default("#ffffff"), intensity: z.number().min(0).default(1),
    distance: z.number().min(0).optional(), castShadow: z.boolean().optional() }),
  z.object({ type: z.literal("spot"), color: Color.default("#ffffff"), intensity: z.number().min(0).default(1),
    distance: z.number().min(0).optional(), angle: z.number().positive().max(1.57).default(0.5),
    target: Vec3.optional(), castShadow: z.boolean().optional() }),
]), { presentation: true });

// ── 2D ──────────────────────────────────────────────────────────────────────
// 2D games use the x/y plane (y up) of the same Transform; rotation is the turn about z.

const Size = z.object({ x: positive, y: positive });

/** Something to draw in 2D at the entity's Transform. Higher layers draw on top; ties go by entity id. */
export const Sprite = defineComponent("sprite", z.object({
  shape: z.discriminatedUnion("type", [
    z.object({ type: z.literal("rect"), size: Size }),
    z.object({ type: z.literal("circle"), radius: positive }),
    /** An image asset (loaded by the view's image loader) stretched to `size`; `frame` picks a sprite-sheet cell in pixels. */
    z.object({ type: z.literal("image"), asset: z.string().min(1), size: Size,
      frame: z.object({ x: z.number().min(0), y: z.number().min(0), w: positive, h: positive }).optional() }),
    /** Text `height` world units tall, centred on the Transform. */
    z.object({ type: z.literal("text"), text: z.string(), height: positive, font: z.string().default("system-ui, sans-serif") }),
  ]),
  /** Fill colour for rect, circle and text (images keep their own colours). */
  color: Color.default("#ffffff"),
  /** Outline for rect and circle. */
  stroke: z.object({ color: Color, width: positive }).optional(),
  offset: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
  layer: z.number().int().default(0),
  opacity: z.number().min(0).max(1).default(1),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  visible: z.boolean().default(true),
}), { presentation: true });

/** A 2D camera centred on the entity's Transform: `zoom` is screen pixels per world unit. */
export const Camera2D = defineComponent("camera2d", z.object({
  zoom: positive.default(32),
  active: z.boolean().default(true),
}), { presentation: true });
