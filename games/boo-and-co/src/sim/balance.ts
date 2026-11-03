/**
 * Boo & Co.'s adapter for the agents' balance search (search.strategy): builds are
 * ghosts and traps on floor tiles, the score is scares, stuck visitors are deadlocks.
 */
import type { PlanGame } from "@umbra/agents";
import { BUILD_KINDS, MansionSchema, buildCatalog, runMansion, type BuildKind, type Mansion } from "./mansion.js";

export function mansionGame(raw: Mansion): PlanGame<BuildKind> {
  const m = MansionSchema.parse(raw);
  const catalog = buildCatalog(m);
  const cells: { x: number; y: number }[] = [];
  m.tiles.forEach((row, y) => [...row].forEach((c, x) => { if (c === ".") cells.push({ x, y }); }));
  return {
    kinds: BUILD_KINDS, cells, budget: m.budget, quota: m.quota,
    cost: (kind) => catalog[kind].cost,
    run: (plan) => {
      const r = runMansion(m, plan.map((p) => ({ ...p, tick: 0 })));
      return { score: r.scares, stuck: r.deadlocked, spent: r.spent };
    },
  };
}
