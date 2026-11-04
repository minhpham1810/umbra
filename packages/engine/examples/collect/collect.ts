/**
 * Example: Collect, a 2D game on the core only. Move the square to pick up coins; each new
 * coin appears where the seeded rng puts it. Drawn with Sprite components (presentation,
 * so they never change the hash) and plays a sound on the Collected event.
 */
import { z } from "zod";
import { Camera2D, Sprite, Transform, defineComponent, defineEvent, defineGame, defineResource, type World } from "../../src/index.js";

export const Player = defineComponent("player", z.object({ speed: z.number().positive() }));
export const Coin = defineComponent("coin", z.object({}));
export const Score = defineResource("score", z.number().int().min(0), () => 0);
export const Collected = defineEvent("collected", z.object({ x: z.number(), y: z.number() }));

export const CollectLevel = z.object({
  /** Arena half-size: the playfield is [-w, w] × [-h, h]. */
  w: z.number().int().min(2).max(50),
  h: z.number().int().min(2).max(50),
  goal: z.number().int().min(1),
});
export type CollectLevel = z.infer<typeof CollectLevel>;

/** Per tick: which way to move, each axis -1, 0 or 1. */
export const CollectInput = z.object({ x: z.number().int().min(-1).max(1), y: z.number().int().min(-1).max(1) });
export type CollectInput = z.infer<typeof CollectInput>;

const DT = 1 / 60;
const at = (x: number, y: number) => Transform({ position: { x, y, z: 0 } });

function spawnCoin(world: World, level: CollectLevel) {
  // Whole-cell positions from integer rng draws, so the numbers are exact everywhere.
  world.spawn(at(world.rng.range(1 - level.w, level.w - 1), world.rng.range(1 - level.h, level.h - 1)), Coin({}),
    Sprite({ shape: { type: "circle", radius: 0.35 }, color: "#f5b301", stroke: { color: "#b07d00", width: 0.08 } }));
}

export const collect = defineGame<CollectInput, CollectLevel>({
  name: "collect",
  version: "1",
  input: CollectInput,
  level: CollectLevel,
  components: [Player, Coin],
  resources: [Score],
  events: [Collected],
  setup(world, level) {
    world.spawn(at(0, 0), Camera2D({ zoom: 40 }));
    world.spawn(at(0, 0), Sprite({ shape: { type: "rect", size: { x: level.w * 2, y: level.h * 2 } }, color: "#1d2433", layer: -1 }));
    world.spawn(at(0, 0), Player({ speed: 6 }), Sprite({ shape: { type: "rect", size: { x: 0.8, y: 0.8 } }, color: "#5cc8ff", layer: 1 }));
    world.spawn(at(0, level.h + 0.8), Sprite({ shape: { type: "text", text: "", height: 0.8 }, color: "#1d2433" }));
    spawnCoin(world, level);
  },
  systems: [
    function move(world, input, level) {
      const diag = input.x !== 0 && input.y !== 0 ? Math.SQRT1_2 : 1;
      for (const [, p, t] of world.query(Player, Transform)) {
        t.position.x = Math.min(level.w - 0.4, Math.max(0.4 - level.w, t.position.x + input.x * diag * p.speed * DT));
        t.position.y = Math.min(level.h - 0.4, Math.max(0.4 - level.h, t.position.y + input.y * diag * p.speed * DT));
      }
    },
    function pickUp(world, _input, level) {
      const [, , me] = world.first(Player, Transform)!;
      for (const [e, , c] of world.query(Coin, Transform)) {
        const dx = c.position.x - me.position.x, dy = c.position.y - me.position.y;
        if (dx * dx + dy * dy > 0.6 * 0.6) continue;
        world.despawn(e);
        world.setResource(Score, world.resource(Score) + 1);
        world.emit(Collected, { x: c.position.x, y: c.position.y });
        if (world.resource(Score) < level.goal) spawnCoin(world, level);
      }
    },
    { name: "hud", phase: "late", run(world, _input, level) {
      for (const [, s] of world.query(Sprite)) if (s.shape.type === "text") s.shape.text = `${world.resource(Score)} / ${level.goal}`;
    } },
  ],
  outcome: (world, level) => (world.resource(Score) >= level.goal ? "win" : undefined),
});

/** A simple player for tests and demos: head straight for the nearest coin. */
export function seekCoin(world: World): CollectInput {
  const [, , me] = world.first(Player, Transform)!;
  const coin = world.first(Coin, Transform);
  if (!coin) return { x: 0, y: 0 };
  const d = (v: number) => (v > 0.1 ? 1 : v < -0.1 ? -1 : 0);
  return { x: d(coin[2].position.x - me.position.x), y: d(coin[2].position.y - me.position.y) };
}
