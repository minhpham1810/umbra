/**
 * 2D physics as a core plugin (Rapier 2D, pinned): the x/y plane of the shared Transform,
 * y up, rotation as a turn about z. Any game opts in with `plugins: [physics2d()]`.
 *
 * Each tick, in the "physics" phase, the plugin works like physics3d:
 *  1. creates, rebuilds or removes bodies to match the components (ascending entity id);
 *  2. pushes game changes in (a moved Transform, a changed Velocity2D, kinematic targets);
 *  3. moves characters by their CharacterMove2D, resolving collisions;
 *  4. steps the world once by `dt`;
 *  5. writes Transform, Velocity2D and CharacterState2D back, and emits Contact2D events.
 * A Transform's z is kept as it is (use it for draw order). Rapier's state is in the run's
 * hash and checkpoints, so 2D physics games replay exactly.
 */
import RAPIER from "@dimforge/rapier2d-compat";
import { z } from "zod";
import { canonicalJson, fnvNumber, fnvStart } from "../core/hash.js";
import { defineComponent, defineEvent, type Entity, type World } from "../core/world.js";
import type { Plugin } from "../core/game.js";
import { Transform } from "../spatial/transform.js";
import { angleZ as angleOf, rotationZ } from "../spatial/angle.js";

const finite = z.number().finite();
export const Vec2 = z.object({ x: finite, y: finite });
export type Vec2 = z.infer<typeof Vec2>;

export const RigidBody2D = defineComponent("physics2d.body", z.object({
  /** fixed: never moves. dynamic: simulated. kinematic: moved by its Transform. */
  type: z.enum(["fixed", "dynamic", "kinematic"]),
  lockRotations: z.boolean().optional(),
  linearDamping: z.number().min(0).optional(),
  angularDamping: z.number().min(0).optional(),
  gravityScale: finite.optional(),
  /** Continuous collision detection, for fast small bodies. */
  ccd: z.boolean().optional(),
}));

export const Shape2D = z.discriminatedUnion("type", [
  z.object({ type: z.literal("box"), half: Vec2 }),
  z.object({ type: z.literal("circle"), radius: z.number().positive() }),
  /** Along y: `halfHeight` of the straight part, plus `radius` caps. */
  z.object({ type: z.literal("capsule"), halfHeight: z.number().positive(), radius: z.number().positive() }),
  /** The convex hull of these points (at least 3, not all in a line). */
  z.object({ type: z.literal("convex"), points: z.array(Vec2).min(3) }),
  /** Connected line segments, e.g. terrain: one-sided walls are fine. */
  z.object({ type: z.literal("polyline"), points: z.array(Vec2).min(2) }),
]).superRefine((s, ctx) => {
  if (s.type !== "convex") return;
  const [p, q] = [s.points[0]!, s.points[1]!];
  if (s.points.every((r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) === 0)) {
    ctx.addIssue({ code: "custom", message: "convex shape points are all in a line" });
  }
});
export type Shape2D = z.infer<typeof Shape2D>;

/** A 2D collider. Without a RigidBody2D it is fixed in place at its Transform. */
export const Collider2D = defineComponent("physics2d.collider", z.object({
  shape: Shape2D,
  /** Offset from the body's position. */
  offset: Vec2.optional(),
  /** A sensor detects overlaps (Contact2D events) without blocking. */
  sensor: z.boolean().optional(),
  friction: z.number().min(0).optional(),
  restitution: z.number().min(0).optional(),
  density: z.number().positive().optional(),
  /** Emit Contact2D events for this solid collider (sensors always do). */
  events: z.boolean().optional(),
}));

/** Velocity of a dynamic body (m/s; rad/s about z). Physics writes it; set it to change velocity. */
export const Velocity2D = defineComponent("physics2d.velocity", z.object({ linear: Vec2, angular: finite.optional() }));

/** A collision-resolving 2D character (an upright capsule moved by CharacterMove2D each tick). */
export const Character2D = defineComponent("physics2d.character", z.object({
  radius: z.number().positive(),
  /** Half-height of the capsule's straight part. */
  halfHeight: z.number().positive(),
  /** Gap kept from surfaces (m). */
  skin: z.number().positive().default(0.01),
  /** Steepest walkable slope, in radians. */
  maxSlope: z.number().min(0).max(1.6).optional(),
  /** Stick to the ground over drops up to this height (m). */
  snapToGround: z.number().min(0).optional(),
  /** Climb steps up to `maxHeight` (m) at least `minWidth` (m) wide. */
  autostep: z.object({ maxHeight: z.number().positive(), minWidth: z.number().positive() }).optional(),
  /** Push dynamic bodies it walks into. */
  pushDynamic: z.boolean().optional(),
}));

/** The movement the game wants this tick (m), including gravity it integrates itself. */
export const CharacterMove2D = defineComponent("physics2d.move", Vec2);

/** Written by physics after each tick. */
export const CharacterState2D = defineComponent("physics2d.characterState", z.object({ grounded: z.boolean(), moved: Vec2 }));

/** Two colliders started or stopped touching (a is the lower entity id). */
export const Contact2D = defineEvent("physics2d.contact", z.object({
  a: z.number().int(), b: z.number().int(), started: z.boolean(), sensor: z.boolean(),
}));

export interface RayHit2D { entity: Entity; distance: number; point: Vec2 }

/** 2D physics queries and commands for systems: `physics2d(world).raycast(...)`. */
export interface Physics2dApi {
  /** Add an impulse (kg·m/s) to a dynamic body, applied in the next step. */
  applyImpulse(e: Entity, impulse: Vec2): void;
  /** Nearest collider hit along a ray (solid colliders; sensors only if asked). */
  raycast(origin: Vec2, direction: Vec2, maxDistance: number, opts?: { includeSensors?: boolean; exclude?: Entity }): RayHit2D | undefined;
}

const apis = new WeakMap<World, Physics2dApi>();
/** The 2D physics API of a world whose game uses the physics2d plugin. */
export function physics2dOf(world: World): Physics2dApi {
  const api = apis.get(world);
  if (!api) throw new Error("this game has no physics2d plugin");
  return api;
}

export interface Physics2dOptions {
  gravity?: Vec2;
  /** Seconds per tick (default 1/60). */
  dt?: number;
}

interface Built { body: number; collider: number; key: string; wroteTransform: string; wroteVelocity: string }

let ready: Promise<void> | undefined;
const vec = (v: RAPIER.Vector): Vec2 => ({ x: v.x, y: v.y });
const flat = (ps: readonly Vec2[]) => new Float32Array(ps.flatMap((p) => [p.x, p.y]));

/** The 2D physics plugin. */
export function physics2d<I = unknown, L = unknown>(opts: Physics2dOptions = {}): Plugin<I, L> {
  const gravity = opts.gravity ?? { x: 0, y: -9.81 };
  const dt = opts.dt ?? 1 / 60;
  return {
    name: "physics2d",
    components: [Transform, RigidBody2D, Collider2D, Velocity2D, Character2D, CharacterMove2D, CharacterState2D],
    events: [Contact2D],
    async start(world) {
      await (ready ??= RAPIER.init());
      let rw = new RAPIER.World(gravity);
      rw.timestep = dt;
      const events = new RAPIER.EventQueue(true);
      let built = new Map<Entity, Built>();
      const controllers = new Map<Entity, RAPIER.KinematicCharacterController>();
      // Our own collider → entity map: Rapier's userData is not part of its snapshots.
      let byCollider = new Map<number, Entity>();
      const entityOf = (collider: number) => byCollider.get(collider);
      const pendingImpulses: [Entity, Vec2][] = [];

      const controllerFor = (e: Entity, c: z.infer<typeof Character2D.schema>) => {
        const k = rw.createCharacterController(c.skin);
        k.setUp({ x: 0, y: 1 });
        k.setApplyImpulsesToDynamicBodies(c.pushDynamic === true);
        if (c.maxSlope !== undefined) { k.setMaxSlopeClimbAngle(c.maxSlope); k.setMinSlopeSlideAngle(c.maxSlope); }
        if (c.snapToGround !== undefined) k.enableSnapToGround(c.snapToGround);
        if (c.autostep) k.enableAutostep(c.autostep.maxHeight, c.autostep.minWidth, false);
        controllers.set(e, k);
      };

      const destroy = (e: Entity) => {
        const b = built.get(e);
        if (!b) return;
        const body = rw.getRigidBody(b.body);
        if (body) rw.removeRigidBody(body);
        byCollider.delete(b.collider);
        const k = controllers.get(e);
        if (k) { rw.removeCharacterController(k); controllers.delete(e); }
        built.delete(e);
      };

      const build = (e: Entity, key: string) => {
        const t = world.get(e, Transform)!;
        const char = world.get(e, Character2D);
        const rb = world.get(e, RigidBody2D);
        const col = world.get(e, Collider2D);
        const desc = char || rb?.type === "kinematic" ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : rb?.type === "dynamic" ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
        desc.setTranslation(t.position.x, t.position.y).setRotation(angleOf(t.rotation));
        if (rb?.lockRotations) desc.lockRotations();
        if (rb?.linearDamping !== undefined) desc.setLinearDamping(rb.linearDamping);
        if (rb?.angularDamping !== undefined) desc.setAngularDamping(rb.angularDamping);
        if (rb?.gravityScale !== undefined) desc.setGravityScale(rb.gravityScale);
        if (rb?.ccd) desc.setCcdEnabled(true);
        const v = world.get(e, Velocity2D);
        if (v && rb?.type === "dynamic") { desc.setLinvel(v.linear.x, v.linear.y); if (v.angular !== undefined) desc.setAngvel(v.angular); }
        const body = rw.createRigidBody(desc);
        const shape: Shape2D = char ? { type: "capsule", halfHeight: char.halfHeight, radius: char.radius } : col!.shape;
        const cd = shape.type === "box" ? RAPIER.ColliderDesc.cuboid(shape.half.x, shape.half.y)
          : shape.type === "circle" ? RAPIER.ColliderDesc.ball(shape.radius)
          : shape.type === "capsule" ? RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius)
          : shape.type === "convex" ? RAPIER.ColliderDesc.convexHull(flat(shape.points))
          : RAPIER.ColliderDesc.polyline(flat(shape.points));
        if (!cd) throw new Error(`entity ${e}: Rapier could not build the convex hull`);
        if (!char && col) {
          if (col.offset) cd.setTranslation(col.offset.x, col.offset.y);
          if (col.sensor) cd.setSensor(true);
          if (col.friction !== undefined) cd.setFriction(col.friction);
          if (col.restitution !== undefined) cd.setRestitution(col.restitution);
          if (col.density !== undefined) cd.setDensity(col.density);
          if (col.sensor || col.events) {
            cd.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
            // Sensors must see kinematic characters and fixed bodies too.
            cd.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
          }
        }
        const collider = rw.createCollider(cd, body);
        byCollider.set(collider.handle, e);
        if (char) controllerFor(e, char);
        built.set(e, { body: body.handle, collider: collider.handle, key, wroteTransform: canonicalJson(t), wroteVelocity: canonicalJson(v ?? null) });
      };

      /** 1. Match Rapier to the components, in ascending entity order. */
      const sync = () => {
        const want = new Map<Entity, string>();
        for (const e of world.entities()) {
          if (!world.has(e, Transform) || !(world.has(e, Collider2D) || world.has(e, Character2D))) continue;
          want.set(e, canonicalJson([world.get(e, RigidBody2D) ?? null, world.get(e, Collider2D) ?? null, world.get(e, Character2D) ?? null]));
        }
        for (const e of [...built.keys()].sort((a, b) => a - b)) if (want.get(e) !== built.get(e)!.key) destroy(e);
        let changed = false;
        for (const [e, key] of want) if (!built.has(e)) { build(e, key); changed = true; }
        return changed;
      };

      /** 2. Push game edits: teleports, velocity changes, kinematic targets, impulses. */
      const pushIn = () => {
        for (const [e, b] of [...built].sort((x, y) => x[0] - y[0])) {
          const body = rw.getRigidBody(b.body)!;
          const t = world.get(e, Transform)!;
          if (canonicalJson(t) !== b.wroteTransform) {
            const at = { x: t.position.x, y: t.position.y };
            if (body.isKinematic()) { body.setNextKinematicTranslation(at); body.setNextKinematicRotation(angleOf(t.rotation)); }
            else { body.setTranslation(at, true); body.setRotation(angleOf(t.rotation), true); }
          }
          const v = world.get(e, Velocity2D);
          if (v && body.isDynamic() && canonicalJson(v) !== b.wroteVelocity) {
            body.setLinvel(v.linear, true);
            if (v.angular !== undefined) body.setAngvel(v.angular, true);
          }
        }
        for (const [e, impulse] of pendingImpulses.splice(0)) {
          const b = built.get(e);
          const body = b && rw.getRigidBody(b.body);
          if (body?.isDynamic()) body.applyImpulse(impulse, true);
        }
      };

      /** 3. Characters: resolve each one's desired move against the world. */
      const moveCharacters = () => {
        for (const e of [...controllers.keys()].sort((a, b) => a - b)) {
          const k = controllers.get(e)!;
          const b = built.get(e)!;
          const want = world.get(e, CharacterMove2D) ?? { x: 0, y: 0 };
          // Sensors are filtered by predicate: Rapier 0.12's EXCLUDE_SENSORS flag excludes the wrong colliders.
          k.computeColliderMovement(rw.getCollider(b.collider)!, want, undefined, undefined, (c) => !c.isSensor());
          const moved = vec(k.computedMovement());
          const body = rw.getRigidBody(b.body)!;
          const p = body.translation();
          body.setNextKinematicTranslation({ x: p.x + moved.x, y: p.y + moved.y });
          world.set(e, CharacterState2D, { grounded: k.computedGrounded(), moved });
        }
      };

      /** 5. Write positions and velocities back; emit contact events. */
      const writeBack = () => {
        for (const [e, b] of [...built].sort((x, y) => x[0] - y[0])) {
          const body = rw.getRigidBody(b.body)!;
          if (!body.isFixed()) {
            const p = body.translation(), a = body.rotation();
            const z0 = world.get(e, Transform)!.position.z;
            world.set(e, Transform, { position: { x: p.x, y: p.y, z: z0 }, rotation: rotationZ(a) });
            b.wroteTransform = canonicalJson(world.get(e, Transform));
          }
          if (body.isDynamic() && world.has(e, Velocity2D)) {
            world.set(e, Velocity2D, { linear: vec(body.linvel()), angular: body.angvel() });
            b.wroteVelocity = canonicalJson(world.get(e, Velocity2D));
          }
        }
        const contacts: z.infer<typeof Contact2D.schema>[] = [];
        events.drainCollisionEvents((h1, h2, started) => {
          const a = entityOf(h1), b = entityOf(h2);
          if (a === undefined || b === undefined) return;
          const sensor = rw.getCollider(h1)!.isSensor() || rw.getCollider(h2)!.isSensor();
          contacts.push({ a: Math.min(a, b), b: Math.max(a, b), started, sensor });
        });
        contacts.sort((x, y) => x.a - y.a || x.b - y.b || Number(y.started) - Number(x.started));
        for (const c of contacts) world.emit(Contact2D, c);
      };

      apis.set(world, {
        applyImpulse(e, impulse) { pendingImpulses.push([e, Vec2.parse(impulse)]); },
        raycast(origin, direction, maxDistance, o = {}) {
          const exclude = o.exclude === undefined ? undefined : built.get(o.exclude);
          // Predicate, not EXCLUDE_SENSORS: in Rapier 0.12 that flag drops dynamic bodies instead.
          const hit = rw.castRay(new RAPIER.Ray(origin, direction), maxDistance, true, undefined, undefined,
            exclude ? rw.getCollider(exclude.collider) : undefined, undefined, (c) => o.includeSensors === true || !c.isSensor());
          if (!hit) return undefined;
          const entity = entityOf(hit.collider.handle);
          if (entity === undefined) return undefined;
          const d = hit.toi;
          return { entity, distance: d, point: { x: origin.x + direction.x * d, y: origin.y + direction.y * d } };
        },
      });

      // Bodies for the starting world, so the first hash already covers them.
      sync();
      rw.updateSceneQueries();

      return {
        systems: [{
          name: "physics2d.step",
          phase: "physics",
          run() {
            if (sync()) rw.updateSceneQueries();
            pushIn();
            moveCharacters();
            rw.step(events);
            // Rapier updates its query structures before moving bodies; refresh so ray casts see this tick.
            rw.updateSceneQueries();
            writeBack();
          },
        }],
        hash() {
          let h = fnvStart();
          const bytes = rw.takeSnapshot();
          for (let i = 0; i < bytes.length; i++) h = fnvNumber(h, bytes[i]!);
          return h;
        },
        save: () => ({ snapshot: rw.takeSnapshot(), built: [...built].map(([e, b]) => [e, { ...b }]) }),
        load(state) {
          const s = state as { snapshot: Uint8Array; built: [Entity, Built][] };
          for (const k of controllers.values()) rw.removeCharacterController(k);
          controllers.clear();
          rw.free();
          rw = RAPIER.World.restoreSnapshot(s.snapshot);
          rw.timestep = dt;
          built = new Map(s.built.map(([e, b]) => [e, { ...b }]));
          byCollider = new Map([...built].map(([e, b]) => [b.collider, e]));
          for (const e of built.keys()) { const c = world.get(e, Character2D); if (c) controllerFor(e, c); }
          pendingImpulses.length = 0;
          events.drainCollisionEvents(() => {});
          rw.updateSceneQueries();
        },
        dispose() {
          apis.delete(world);
          for (const k of controllers.values()) rw.removeCharacterController(k);
          events.free();
          rw.free();
        },
      };
    },
  };
}
