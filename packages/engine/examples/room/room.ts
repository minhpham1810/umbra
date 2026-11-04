/**
 * Example: a 3D room on the core plus the physics3d plugin. Walk, jump and push a crate
 * to reach the goal. Movement, gravity and jumping are game code: the plugin only
 * resolves collisions, so another game can have entirely different movement.
 */
import {
  Camera, Character, CharacterMove, CharacterState, Collider, Contact, Light, Mesh, RigidBody, Transform, Velocity,
  defineComponent, defineGame, physics3d, z, type World,
} from "../../src/index.js";

/** Marks the goal sensor. */
export const Goal = defineComponent("room.goal", z.object({}));
/** The player's vertical speed (m/s), kept by game code. */
export const Fall = defineComponent("room.fall", z.number());
/** Marks the camera that follows the player. */
export const Follow = defineComponent("room.follow", z.object({}));

export const RoomInput = z.object({
  /** Walk direction on the floor, each component -1, 0 or 1. */
  x: z.number().int().min(-1).max(1),
  z: z.number().int().min(-1).max(1),
  jump: z.boolean(),
});
export type RoomInput = z.infer<typeof RoomInput>;

const WALK = 4, JUMP = 6, GRAVITY = 20, DT = 1 / 60;
const box = (w: World, x: number, y: number, zz: number, hx: number, hy: number, hz: number, color: string) =>
  w.spawn(Transform({ position: { x, y, z: zz } }), Collider({ shape: { type: "box", half: { x: hx, y: hy, z: hz } } }),
    Mesh({ geometry: { type: "box", half: { x: hx, y: hy, z: hz } }, material: { color, roughness: 0.9 }, receiveShadow: true, castShadow: true }));

export const room = defineGame<RoomInput, null>({
  name: "room",
  version: "1",
  input: RoomInput,
  components: [Goal, Fall, Follow],
  plugins: [physics3d({ gravity: { x: 0, y: -GRAVITY, z: 0 }, dt: DT })],
  setup(w) {
    box(w, 0, -0.5, 0, 6, 0.5, 6, "#d9d4c7");          // floor
    box(w, 0, 1.5, 6.2, 6, 2, 0.2, "#9aa3b5");         // back wall
    box(w, 0, 0.6, 4.5, 6, 0.6, 1.5, "#b8b0a0");       // a 1.2 m ledge: too high to jump, fine from the crate
    w.spawn(Transform({ position: { x: 0, y: 0.4, z: 1.5 } }), RigidBody({ type: "dynamic", lockRotations: true }),
      Collider({ shape: { type: "box", half: { x: 0.4, y: 0.4, z: 0.4 } }, friction: 0.3 }), Velocity({ linear: { x: 0, y: 0, z: 0 } }),
      Mesh({ geometry: { type: "box", half: { x: 0.4, y: 0.4, z: 0.4 } }, material: { color: "#b07a3c" }, castShadow: true, receiveShadow: true }));
    w.spawn(Transform({ position: { x: 0, y: 1.7, z: 4.5 } }), Collider({ shape: { type: "box", half: { x: 0.4, y: 0.5, z: 0.4 } }, sensor: true }), Goal({}),
      Mesh({ geometry: { type: "box", half: { x: 0.4, y: 0.5, z: 0.4 } }, material: { color: "#3ccf91", emissive: "#1f8a5c", opacity: 0.6 } }));
    w.spawn(Transform({ position: { x: 0, y: 0.75, z: -2 } }), Fall(0),
      Character({ radius: 0.3, halfHeight: 0.4, skin: 0.01, snapToGround: 0.1, pushDynamic: true }),
      CharacterState({ grounded: false, moved: { x: 0, y: 0, z: 0 } }),
      Mesh({ geometry: { type: "capsule", halfHeight: 0.4, radius: 0.3 }, material: { color: "#4f7cff" }, castShadow: true }));
    w.spawn(Light({ type: "hemisphere", sky: "#f3f6ff", ground: "#6b6355", intensity: 1.2 }));
    w.spawn(Transform({ position: { x: -4, y: 9, z: -5 } }), Light({ type: "directional", intensity: 1.6, castShadow: true }));
    w.spawn(Transform({ position: { x: 0, y: 4, z: -8 } }), Camera({ fov: 55, lookAt: { x: 0, y: 1, z: 0 } }), Follow({}));
  },
  systems: [function move(w, input) {
    for (const [e, fall, state] of w.query(Fall, CharacterState)) {
      let vy = state.grounded ? (input.jump ? JUMP : 0) : fall - GRAVITY * DT;
      if (state.grounded && !input.jump) vy = -1; // keep contact with the ground
      w.set(e, Fall, vy);
      w.set(e, CharacterMove, { x: input.x * WALK * DT, y: vy * DT, z: input.z * WALK * DT });
    }
  }, {
    // Presentation only: keeps the camera behind the player. It reads the player's position
    // (simulation state) and writes camera data, so it cannot change how the game plays.
    name: "follow-camera", phase: "late",
    run(w) {
      const player = w.first(Fall, Transform)?.[2].position;
      if (!player) return;
      for (const [e, cam] of w.query(Follow, Camera)) {
        w.set(e, Transform, { position: { x: player.x, y: player.y + 3.2, z: player.z - 6 } });
        w.set(e, Camera, { ...cam, lookAt: { x: player.x, y: player.y + 0.5, z: player.z + 1.5 } });
      }
    },
  }],
  outcome(w) {
    const goal = w.first(Goal)?.[0];
    return w.events(Contact).some((c) => c.started && (c.a === goal || c.b === goal)) ? "win" : undefined;
  },
});
