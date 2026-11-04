/**
 * Example: Hop, a 2D platformer on the physics2d plugin. Run and jump across the gaps,
 * knock the crates about, and touch the flag. Falling off the bottom loses. Drawn with
 * Sprite components and a Camera2D that follows the player.
 */
import { z } from "zod";
import {
  Camera2D, Character2D, CharacterMove2D, CharacterState2D, Collider2D, Contact2D, RigidBody2D, Sprite, Transform,
  defineComponent, defineGame, physics2d, type World,
} from "../../src/index.js";

export const Hero = defineComponent("hop.hero", z.object({}));
export const Flag = defineComponent("hop.flag", z.object({}));
export const Follow = defineComponent("hop.follow", z.object({}));

/** Per tick: run direction (-1, 0, 1) and whether jump is held. */
export const HopInput = z.object({ x: z.number().int().min(-1).max(1), jump: z.boolean() });
export type HopInput = z.infer<typeof HopInput>;

const DT = 1 / 60, SPEED = 5, JUMP = 8.5, GRAVITY = 24;
const at = (x: number, y: number, z = 0) => Transform({ position: { x, y, z } });

/** A platform from x0 to x1 with its top at y. */
function platform(w: World, x0: number, x1: number, y: number) {
  const half = { x: (x1 - x0) / 2, y: 0.5 };
  w.spawn(at((x0 + x1) / 2, y - 0.5), Collider2D({ shape: { type: "box", half } }),
    Sprite({ shape: { type: "rect", size: { x: half.x * 2, y: 1 } }, color: "#3b4a6b" }));
}

function crate(w: World, x: number, y: number) {
  w.spawn(at(x, y, 1), RigidBody2D({ type: "dynamic" }), Collider2D({ shape: { type: "box", half: { x: 0.4, y: 0.4 } }, density: 0.5 }),
    Sprite({ shape: { type: "rect", size: { x: 0.8, y: 0.8 } }, color: "#b07a45", stroke: { color: "#6e4a28", width: 0.06 }, layer: 1 }));
}

export const hop = defineGame<HopInput, null>({
  name: "hop",
  version: "1",
  input: HopInput,
  components: [Hero, Flag, Follow],
  plugins: [physics2d({ gravity: { x: 0, y: -GRAVITY } })],
  setup(w) {
    platform(w, -3, 6, 0);
    platform(w, 8, 12, 1);       // a gap, then a step up
    platform(w, 13.6, 18, 2);
    platform(w, 20, 28, 0.5);    // a drop to the last stretch
    crate(w, 4, 0.4); crate(w, 22, 0.9); crate(w, 22.1, 1.7);
    w.spawn(at(26.5, 1.5), Flag({}), Collider2D({ shape: { type: "box", half: { x: 0.3, y: 1 } }, sensor: true }),
      Sprite({ shape: { type: "rect", size: { x: 0.6, y: 2 } }, color: "#6fdcb0", layer: 1 }));
    w.spawn(at(0, 1, 2), Hero({}), Character2D({ radius: 0.35, halfHeight: 0.3, snapToGround: 0.1, pushDynamic: true }),
      CharacterState2D({ grounded: false, moved: { x: 0, y: 0 } }),
      Sprite({ shape: { type: "rect", size: { x: 0.7, y: 1.3 } }, color: "#5cc8ff", layer: 2 }));
    w.spawn(at(0, 2), Follow({}), Camera2D({ zoom: 40 }));
  },
  systems: [
    function run(w, input) {
      for (const [e, , state] of w.query(Hero, CharacterState2D)) {
        const vy = (w.get(e, CharacterMove2D)?.y ?? 0) / DT;
        const next = state.grounded ? (input.jump ? JUMP : -1) : Math.max(vy - GRAVITY * DT, -20);
        w.set(e, CharacterMove2D, { x: input.x * SPEED * DT, y: next * DT });
      }
    },
    { name: "camera", phase: "late", run(w) {
      const hero = w.first(Hero, Transform)?.[2].position;
      for (const [, , t] of w.query(Follow, Transform)) if (hero) t.position = { x: hero.x + 3, y: Math.max(hero.y, 1) + 1, z: 0 };
    } },
  ],
  outcome(w) {
    const [hero, , t] = w.first(Hero, Transform)!;
    const [flag] = w.first(Flag)!;
    if (w.events(Contact2D).some((c) => c.started && ((c.a === hero && c.b === flag) || (c.a === flag && c.b === hero)))) return "win";
    return t.position.y < -6 ? "fell" : undefined;
  },
});
