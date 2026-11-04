/**
 * 3D physics as a core plugin (Rapier, pinned): bodies, colliders and characters are
 * components, so any game opts in with `plugins: [physics3d()]`.
 *
 * Each tick, in the "physics" phase, the plugin:
 *  1. creates, rebuilds or removes Rapier bodies to match the components (ascending entity id);
 *  2. pushes game changes in (a moved Transform, a changed Velocity, kinematic targets);
 *  3. moves characters by their CharacterMove, resolving collisions (grounded, sliding, steps);
 *  4. steps the world once by `dt`;
 *  5. writes Transform, Velocity and CharacterState back, and emits Contact events.
 * Rapier's own state is in the run's hash and checkpoints, so physics games replay exactly.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { z } from "zod";
import { canonicalJson, fnvNumber, fnvStart } from "../core/hash.js";
import { defineComponent, defineEvent, type Entity, type World } from "../core/world.js";
import type { Plugin } from "../core/game.js";
import { initRapier } from "../physics/world.js";
import { IDENTITY, Transform, Vec3 } from "../spatial/transform.js";

const finite = z.number().finite();

export const RigidBody = defineComponent("physics.body", z.object({
  /** fixed: never moves. dynamic: simulated. kinematic: moved by its Transform. */
  type: z.enum(["fixed", "dynamic", "kinematic"]),
  lockRotations: z.boolean().optional(),
  linearDamping: z.number().min(0).optional(),
  angularDamping: z.number().min(0).optional(),
  gravityScale: finite.optional(),
  /** Continuous collision detection, for fast small bodies. */
  ccd: z.boolean().optional(),
}));

export const Shape = z.discriminatedUnion("type", [
  z.object({ type: z.literal("box"), half: Vec3 }),
  z.object({ type: z.literal("sphere"), radius: z.number().positive() }),
  /** Along y: `halfHeight` of the straight part, plus `radius` caps. */
  z.object({ type: z.literal("capsule"), halfHeight: z.number().positive(), radius: z.number().positive() }),
  z.object({ type: z.literal("cylinder"), halfHeight: z.number().positive(), radius: z.number().positive() }),
  /** A triangle mesh (static geometry): xyz triples and index triples. */
  z.object({ type: z.literal("mesh"), vertices: z.array(finite), indices: z.array(z.number().int().min(0)) }),
]).superRefine((m, ctx) => {
  if (m.type === "mesh" && !(m.vertices.length % 3 === 0 && m.indices.length % 3 === 0 && m.indices.every((i) => i < m.vertices.length / 3))) {
    ctx.addIssue({ code: "custom", message: "mesh needs xyz vertex triples and in-range index triples" });
  }
});
export type Shape = z.infer<typeof Shape>;

/** A collider. Without a RigidBody it is fixed in place at its Transform. */
export const Collider = defineComponent("physics.collider", z.object({
  shape: Shape,
  /** Offset from the body's position. */
  offset: Vec3.optional(),
  /** A sensor detects overlaps (Contact events) without blocking. */
  sensor: z.boolean().optional(),
  friction: z.number().min(0).optional(),
  restitution: z.number().min(0).optional(),
  density: z.number().positive().optional(),
  /** Emit Contact events for this solid collider (sensors always do). */
  events: z.boolean().optional(),
}));

/** Velocity of a dynamic body (m/s, rad/s). Physics writes it; set it to change velocity. */
export const Velocity = defineComponent("physics.velocity", z.object({ linear: Vec3, angular: Vec3.optional() }));

/** A collision-resolving character (a capsule moved by CharacterMove each tick). */
export const Character = defineComponent("physics.character", z.object({
  radius: z.number().positive(),
  /** Half-height of the capsule's straight part. */
  halfHeight: z.number().positive(),
  /** Gap kept from surfaces (m). */
  skin: z.number().positive().default(0.01),
  /** Steepest walkable slope, in radians. */
  maxSlope: z.number().min(0).max(1.6).optional(),
  /** Stick to the ground over drops up to this height (m). */
  snapToGround: z.number().min(0).optional(),
  /** Climb steps up to `maxHeight` (m) at least `minWidth` (m) deep. */
  autostep: z.object({ maxHeight: z.number().positive(), minWidth: z.number().positive() }).optional(),
  /** Push dynamic bodies it walks into. */
  pushDynamic: z.boolean().optional(),
}));

/** The movement the game wants this tick (m), including gravity it integrates itself. */
export const CharacterMove = defineComponent("physics.move", Vec3);

/** Written by physics after each tick. */
export const CharacterState = defineComponent("physics.characterState", z.object({ grounded: z.boolean(), moved: Vec3 }));

/** Two colliders started or stopped touching (a is the lower entity id). */
export const Contact = defineEvent("physics.contact", z.object({
  a: z.number().int(), b: z.number().int(), started: z.boolean(), sensor: z.boolean(),
}));

export interface RayHit { entity: Entity; distance: number; point: Vec3 }

/** Physics queries and commands for systems: `physics(world).raycast(...)`. */
export interface PhysicsApi {
  /** Add an impulse (kg·m/s) to a dynamic body, applied in the next step. */
  applyImpulse(e: Entity, impulse: Vec3): void;
  /** Nearest collider hit along a ray (solid colliders; sensors only if asked). */
  raycast(origin: Vec3, direction: Vec3, maxDistance: number, opts?: { includeSensors?: boolean; exclude?: Entity }): RayHit | undefined;
}

const apis = new WeakMap<World, PhysicsApi>();
export function physics(world: World): PhysicsApi {
  const api = apis.get(world);
  if (!api) throw new Error("this game has no physics3d plugin");
  return api;
}

export interface Physics3dOptions {
  gravity?: Vec3;
  /** Seconds per tick (default 1/60). */
  dt?: number;
}

interface Built {
  body: number;
  collider: number;
  /** Canonical JSON of the components the body was built from; a change rebuilds it. */
  key: string;
  /** Transform and Velocity as physics last wrote them, to spot game edits. */
  wroteTransform: string;
  wroteVelocity: string;
}

const vec = (v: RAPIER.Vector) => ({ x: v.x, y: v.y, z: v.z });

/** The 3D physics plugin. */
export function physics3d<I = unknown, L = unknown>(opts: Physics3dOptions = {}): Plugin<I, L> {
  const gravity = opts.gravity ?? { x: 0, y: -9.81, z: 0 };
  const dt = opts.dt ?? 1 / 60;
  return {
    name: "physics3d",
    components: [Transform, RigidBody, Collider, Velocity, Character, CharacterMove, CharacterState],
    events: [Contact],
    async start(world) {
      await initRapier();
      let rw = new RAPIER.World(gravity);
      rw.timestep = dt;
      const events = new RAPIER.EventQueue(true);
      let built = new Map<Entity, Built>();
      const controllers = new Map<Entity, RAPIER.KinematicCharacterController>();
      // Our own collider → entity map: Rapier's userData is not part of its snapshots.
      let byCollider = new Map<number, Entity>();
      const entityOf = (collider: number) => byCollider.get(collider);
      const pendingImpulses: [Entity, Vec3][] = [];

      const controllerFor = (e: Entity, c: z.infer<typeof Character.schema>) => {
        const k = rw.createCharacterController(c.skin);
        k.setUp({ x: 0, y: 1, z: 0 });
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
        const char = world.get(e, Character);
        const rb = world.get(e, RigidBody);
        const col = world.get(e, Collider);
        const desc = char || rb?.type === "kinematic" ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : rb?.type === "dynamic" ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
        desc.setTranslation(t.position.x, t.position.y, t.position.z).setRotation(t.rotation ?? IDENTITY);
        if (rb?.lockRotations) desc.lockRotations();
        if (rb?.linearDamping !== undefined) desc.setLinearDamping(rb.linearDamping);
        if (rb?.angularDamping !== undefined) desc.setAngularDamping(rb.angularDamping);
        if (rb?.gravityScale !== undefined) desc.setGravityScale(rb.gravityScale);
        if (rb?.ccd) desc.setCcdEnabled(true);
        const v = world.get(e, Velocity);
        if (v && rb?.type === "dynamic") { desc.setLinvel(v.linear.x, v.linear.y, v.linear.z); if (v.angular) desc.setAngvel(v.angular); }
        const body = rw.createRigidBody(desc);
        const shape: Shape = char ? { type: "capsule", halfHeight: char.halfHeight, radius: char.radius } : col!.shape;
        const cd = shape.type === "box" ? RAPIER.ColliderDesc.cuboid(shape.half.x, shape.half.y, shape.half.z)
          : shape.type === "sphere" ? RAPIER.ColliderDesc.ball(shape.radius)
          : shape.type === "capsule" ? RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius)
          : shape.type === "cylinder" ? RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius)
          : RAPIER.ColliderDesc.trimesh(new Float32Array(shape.vertices), new Uint32Array(shape.indices));
        if (!char && col) {
          if (col.offset) cd.setTranslation(col.offset.x, col.offset.y, col.offset.z);
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
          if (!world.has(e, Transform) || !(world.has(e, Collider) || world.has(e, Character))) continue;
          want.set(e, canonicalJson([world.get(e, RigidBody) ?? null, world.get(e, Collider) ?? null, world.get(e, Character) ?? null]));
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
            if (body.isKinematic()) {
              body.setNextKinematicTranslation(t.position);
              body.setNextKinematicRotation(t.rotation ?? IDENTITY);
            } else { body.setTranslation(t.position, true); body.setRotation(t.rotation ?? IDENTITY, true); }
          }
          const v = world.get(e, Velocity);
          if (v && body.isDynamic() && canonicalJson(v) !== b.wroteVelocity) {
            body.setLinvel(v.linear, true);
            if (v.angular) body.setAngvel(v.angular, true);
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
          const want = world.get(e, CharacterMove) ?? { x: 0, y: 0, z: 0 };
          const collider = rw.getCollider(b.collider)!;
          // Sensors are filtered by predicate: Rapier 0.12's EXCLUDE_SENSORS flag excludes the wrong colliders.
          k.computeColliderMovement(collider, want, undefined, undefined, (c) => !c.isSensor());
          const moved = vec(k.computedMovement());
          const p = rw.getRigidBody(b.body)!.translation();
          rw.getRigidBody(b.body)!.setNextKinematicTranslation({ x: p.x + moved.x, y: p.y + moved.y, z: p.z + moved.z });
          world.set(e, CharacterState, { grounded: k.computedGrounded(), moved });
        }
      };

      /** 5. Write positions and velocities back; emit contact events. */
      const writeBack = () => {
        for (const [e, b] of [...built].sort((x, y) => x[0] - y[0])) {
          const body = rw.getRigidBody(b.body)!;
          if (!body.isFixed()) {
            const rot = body.rotation();
            const t = { position: vec(body.translation()), rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w } };
            world.set(e, Transform, t);
            b.wroteTransform = canonicalJson(world.get(e, Transform));
          }
          if (body.isDynamic() && world.has(e, Velocity)) {
            world.set(e, Velocity, { linear: vec(body.linvel()), angular: vec(body.angvel()) });
            b.wroteVelocity = canonicalJson(world.get(e, Velocity));
          }
        }
        const contacts: z.infer<typeof Contact.schema>[] = [];
        events.drainCollisionEvents((h1, h2, started) => {
          const a = entityOf(h1), b = entityOf(h2);
          if (a === undefined || b === undefined) return;
          const sensor = rw.getCollider(h1)!.isSensor() || rw.getCollider(h2)!.isSensor();
          contacts.push({ a: Math.min(a, b), b: Math.max(a, b), started, sensor });
        });
        contacts.sort((x, y) => x.a - y.a || x.b - y.b || Number(y.started) - Number(x.started));
        for (const c of contacts) world.emit(Contact, c);
      };

      apis.set(world, {
        applyImpulse(e, impulse) { pendingImpulses.push([e, Vec3.parse(impulse)]); },
        raycast(origin, direction, maxDistance, o = {}) {
          const exclude = o.exclude === undefined ? undefined : built.get(o.exclude);
          // Predicate, not EXCLUDE_SENSORS: in Rapier 0.12 that flag drops dynamic bodies instead.
          const hit = rw.castRay(new RAPIER.Ray(origin, direction), maxDistance, true, undefined, undefined,
            exclude ? rw.getCollider(exclude.collider) : undefined, undefined, (c) => o.includeSensors === true || !c.isSensor());
          if (!hit) return undefined;
          const entity = entityOf(hit.collider.handle);
          if (entity === undefined) return undefined;
          const d = hit.toi;
          return { entity, distance: d, point: { x: origin.x + direction.x * d, y: origin.y + direction.y * d, z: origin.z + direction.z * d } };
        },
      });

      // Bodies for the starting world, so the first hash already covers them.
      sync();
      rw.updateSceneQueries();

      return {
        systems: [{
          name: "physics3d.step",
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
          for (const e of built.keys()) { const c = world.get(e, Character); if (c) controllerFor(e, c); }
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
