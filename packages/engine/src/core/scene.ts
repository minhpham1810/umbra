/**
 * Scene files: a level as a list of entities and their components, in JSON. Entities may
 * start from a prefab (named component defaults); their own components override the
 * prefab's, field by field for object values. Every component is checked by its schema.
 */
import { z } from "zod";
import type { Entity, World } from "./world.js";

export const EntitySceneSchema = z.object({
  format: z.literal("umbra-scene").default("umbra-scene"),
  entities: z.array(z.object({
    prefab: z.string().optional(),
    components: z.record(z.string(), z.unknown()).default({}),
  })),
});
export type EntityScene = z.infer<typeof EntitySceneSchema>;

/** Prefabs: name → component name → default value. */
export type Prefabs = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Spawn every entity of a scene (validated) into the world, in file order; returns their ids. */
export function spawnScene(world: World, raw: unknown, prefabs: Prefabs = {}): Entity[] {
  const scene = EntitySceneSchema.parse(raw);
  // Validate everything before spawning anything, so a bad file leaves the world unchanged.
  const planned = scene.entities.map((entry, i) => {
    const base = entry.prefab === undefined ? {} : prefabs[entry.prefab];
    if (!base) throw new Error(`entities[${i}]: unknown prefab "${entry.prefab}"`);
    const merged: Record<string, unknown> = { ...base };
    for (const [name, v] of Object.entries(entry.components)) merged[name] = isObject(merged[name]) && isObject(v) ? { ...merged[name], ...v } : v;
    return Object.entries(merged).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, value]) => {
      const type = world.componentType(name);
      if (!type) throw new Error(`entities[${i}]: unknown component "${name}"`);
      const parsed = type.schema.safeParse(value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        throw new Error(`entities[${i}].components.${name}${issue.path.length ? "." + issue.path.join(".") : ""}: ${issue.message}`);
      }
      return type(parsed.data);
    });
  });
  return planned.map((entries) => world.spawn(...entries));
}

/** The world's entities as a scene file (no prefabs), e.g. for an editor or an agent to save. */
export function saveScene(world: World): EntityScene {
  const state = world.save();
  const byEntity = new Map<Entity, Record<string, unknown>>(state.entities.map((e) => [e, {}]));
  for (const [name, pairs] of Object.entries(state.components)) for (const [e, v] of pairs) byEntity.get(e)![name] = v;
  return { format: "umbra-scene", entities: [...byEntity.values()].map((components) => ({ components })) };
}
