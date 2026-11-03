import type { World } from "../ecs/types.js";

/**
 * Deterministic state hash.
 * Combines ECS component data with Rapier's own snapshot hash.
 * IMPORTANT: this must produce the same number in Node and in the browser
 * for the same world state — that is the core determinism guarantee.
 */
export function hashWorld(world: World, rapierSnapshotHash: number, extra: readonly number[] = []): number {
  let h = 2166136261; // FNV-1a 32-bit offset basis

  // Sort entity IDs so insertion order never matters.
  const ids = [...world.entities].sort((a, b) => a - b);

  for (const id of ids) {
    h = fnv32(h, id);
    const comps = world.components.get(id);
    if (!comps) continue;
    // Sort component kinds for the same reason.
    const kinds = [...comps.keys()].sort();
    for (const kind of kinds) {
      const json = JSON.stringify(comps.get(kind));
      for (let i = 0; i < json.length; i++) {
        h = fnv32(h, json.charCodeAt(i));
      }
    }
  }

  // Mix in the physics snapshot hash.
  h = fnv32(h, rapierSnapshotHash);
  // Sim state kept outside the ECS and Rapier (integers; see the caller).
  h = fnv32(h, extra.length);
  for (const v of extra) h = fnv32(h, v);
  // Mix in the tick so equal states at different ticks differ.
  h = fnv32(h, world.tick);

  return h >>> 0; // unsigned 32-bit
}

function fnv32(h: number, v: number): number {
  return Math.imul(h ^ v, 16777619) >>> 0;
}
