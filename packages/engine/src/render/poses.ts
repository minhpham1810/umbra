/** Transforms at the last two ticks, so views can draw smoothly between them. */
import type { Entity, World } from "../core/world.js";
import { IDENTITY, Transform, type Quat, type Vec3 } from "../spatial/transform.js";

export interface Pose { position: Vec3; rotation: Quat }

export interface Poses {
  /** Record every Transform after a tick. */
  capture(): void;
  /** An entity's poses at the last two ticks (both its current pose if it is new), or undefined without a Transform. */
  between(e: Entity): [Pose, Pose] | undefined;
  forget(e: Entity): void;
}

export function trackPoses(world: World): Poses {
  const before = new Map<Entity, Pose>(), after = new Map<Entity, Pose>();
  const now = (e: Entity): Pose | undefined => {
    const t = world.get(e, Transform);
    return t && structuredClone({ position: t.position, rotation: t.rotation ?? IDENTITY });
  };
  return {
    capture() {
      for (const e of after.keys()) if (!world.exists(e)) { before.delete(e); after.delete(e); }
      for (const e of world.entities()) {
        const p = now(e);
        if (!p) continue;
        before.set(e, after.get(e) ?? p);
        after.set(e, p);
      }
    },
    between(e) {
      if (!after.has(e)) { const p = now(e); if (!p) return undefined; before.set(e, p); after.set(e, p); }
      return [before.get(e)!, after.get(e)!];
    },
    forget(e) { before.delete(e); after.delete(e); },
  };
}
