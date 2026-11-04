# Physics

Physics is a plugin: add `physics3d()` or `physics2d()` to a game's `plugins`, and rigid
bodies, colliders and characters become components. The plugin runs in the `physics`
phase, after your `update` systems, and writes positions back to `Transform`. Rapier's own
state joins the hash and checkpoints, so physics games replay exactly. Both plugins use
Rapier 0.12.0, pinned.

## 3D

```ts
import { Collider, Contact, RigidBody, Transform, Velocity, createGame, defineGame, physics, physics3d, z } from "umbra-engine";

const at = (x: number, y: number, z: number) => Transform({ position: { x, y, z } });
const drop = defineGame({
  name: "drop",
  input: z.null(),
  plugins: [physics3d({ gravity: { x: 0, y: -9.81, z: 0 } })],
  setup(world) {
    world.spawn(at(0, -0.5, 0), Collider({ shape: { type: "box", half: { x: 5, y: 0.5, z: 5 } } }));   // fixed: no RigidBody
    world.spawn(at(0, 3, 0), RigidBody({ type: "dynamic" }), Collider({ shape: { type: "sphere", radius: 0.5 }, events: true }),
      Velocity({ linear: { x: 1, y: 0, z: 0 } }));
  },
});

const run = await createGame(drop, null);
let landed = -1;
for (let i = 0; i < 120; i++) if (run.step(null).some((e) => e.type === Contact.name) && landed < 0) landed = run.tick;
const hit = physics(run.world).raycast({ x: 3, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10);
console.log(landed, run.world.get(2, Transform)!.position.y.toFixed(2), hit?.entity); // lands on tick ~45, rests at 0.50, the ray hits the floor (1)
run.dispose();
```

| Component | Meaning |
| --- | --- |
| `RigidBody` | `fixed`, `dynamic` (simulated) or `kinematic` (moved by its Transform); damping, gravity scale, locked rotations, continuous collision detection |
| `Collider` | Box, sphere, capsule, cylinder or triangle mesh; offset, friction, restitution, density; `sensor: true` detects overlaps without blocking. Without a RigidBody it is fixed in place |
| `Velocity` | A dynamic body's velocity: physics writes it, and setting it changes it |
| `Character`, `CharacterMove`, `CharacterState` | A capsule that resolves collisions: your system sets the move it wants each tick (gravity included), physics writes back where it got and whether it is grounded |
| `Contact` event | Two colliders started or stopped touching (sensors always report; solid colliders with `events: true`) |

`physics(world)` gives systems `applyImpulse(entity, impulse)` and
`raycast(origin, direction, maxDistance)`. Game code may also teleport a body by setting
its `Transform`; the plugin notices and moves the body.

### Characters

The plugin resolves collisions; movement, gravity and jumping stay in your game, which
keeps them yours to tune and deterministic:

```ts
import { Character, CharacterMove, CharacterState, Collider, Transform, createGame, defineGame, physics3d, z } from "umbra-engine";

const DT = 1 / 60, GRAVITY = 20;
const walker = defineGame({
  name: "walker",
  input: z.object({ x: z.number(), z: z.number(), jump: z.boolean() }),
  plugins: [physics3d()],
  setup(world) {
    world.spawn(Transform({ position: { x: 0, y: -0.5, z: 0 } }), Collider({ shape: { type: "box", half: { x: 10, y: 0.5, z: 10 } } }));
    world.spawn(Transform({ position: { x: 0, y: 1, z: 0 } }),
      Character({ radius: 0.3, halfHeight: 0.4, snapToGround: 0.1, autostep: { maxHeight: 0.3, minWidth: 0.2 } }),
      CharacterState({ grounded: false, moved: { x: 0, y: 0, z: 0 } }));
  },
  systems: [function walk(world, input) {
    for (const [e, , state] of world.query(Character, CharacterState)) {
      const vy = (world.get(e, CharacterMove)?.y ?? 0) / DT;           // last tick's vertical speed
      const next = state.grounded ? (input.jump ? 7 : -1) : vy - GRAVITY * DT;
      world.set(e, CharacterMove, { x: input.x * 4 * DT, y: next * DT, z: input.z * 4 * DT });
    }
  }],
});

const run = await createGame(walker, null);
for (let i = 0; i < 60; i++) run.step({ x: 1, z: 0, jump: false });
console.log(run.world.first(Character, Transform)![2].position.x.toFixed(1)); // about 4 m in one second
run.dispose();
```

## 2D

`physics2d()` is the same in the x/y plane, with y up. It shares `Transform`: it reads and
writes the rotation as a turn about z, and leaves z alone, so z can order drawing.
Components carry a `2D` suffix.

```ts
import { Collider2D, RigidBody2D, Transform, angleZ, createGame, defineGame, physics2d, rotationZ, z } from "umbra-engine";

const ramp = defineGame({
  name: "ramp",
  input: z.null(),
  plugins: [physics2d({ gravity: { x: 0, y: -9.81 } })],
  setup(world) {
    // Terrain as a polyline: a slope down to flat ground.
    world.spawn(Transform({ position: { x: 0, y: 0, z: 0 } }),
      Collider2D({ shape: { type: "polyline", points: [{ x: -8, y: 5 }, { x: 0, y: 0 }, { x: 8, y: 0 }] } }));
    world.spawn(Transform({ position: { x: -6, y: 5, z: 0 }, rotation: rotationZ(0.5) }), RigidBody2D({ type: "dynamic" }),
      Collider2D({ shape: { type: "circle", radius: 0.4 } }));
  },
});

const run = await createGame(ramp, null);
for (let i = 0; i < 120; i++) run.step(null);
const t = run.world.get(2, Transform)!;
console.log(t.position.x > -6, angleZ(t.rotation) !== 0.5); // true true: it rolled down the slope
run.dispose();
```

Shapes are `box`, `circle`, `capsule`, `convex` (the hull of some points) and `polyline`.
`Velocity2D`, `Character2D`/`CharacterMove2D`/`CharacterState2D` and `Contact2D` work like
their 3D versions, and `physics2dOf(world)` gives impulses and ray casts. A complete
platformer is [`examples/hop`](../packages/engine/examples/hop).

Use `rotationZ(angle)` and `angleZ(rotation)` for 2D angles in simulation code: they give
the same bits on every JavaScript engine, unlike `Math.sin` and `Math.atan2`
(see [Determinism](determinism.md)).

## Models as colliders

`gltfTriangles(bytes)` reads a .glb or .gltf file's triangles in plain JavaScript, with
node transforms applied, so a headless run collides with exactly the model the browser
draws. Pass `{ node: "collision" }` to use one node's subtree, such as a simplified
collision mesh.

```ts
import { readFile } from "node:fs/promises";
import { Collider, Mesh, Transform, World, gltfTriangles } from "umbra-engine";

// In a real game, read the file before the run and pass the triangles in the level,
// so the level itself records the geometry.
async function levelFromModel(path: string, world: World) {
  const shape = { type: "mesh" as const, ...gltfTriangles(await readFile(path), { node: "collision" }) };
  world.spawn(Transform({ position: { x: 0, y: 0, z: 0 } }), Collider({ shape }), Mesh({ geometry: { type: "model", asset: path } }));
}
console.log(typeof levelFromModel); // function
```

Compressed (Draco, meshopt) and sparse data are rejected rather than read approximately.

## Navigation

`navBakeWorld(world)` bakes a Recast navmesh from a 3D physics game's fixed colliders;
`navPath` finds routes on it:

```ts
import { Collider, Transform, createGame, defineGame, navBakeWorld, navDispose, navPath, physics3d, z } from "umbra-engine";

const rooms = defineGame({
  name: "rooms",
  input: z.null(),
  plugins: [physics3d()],
  setup(world) {
    world.spawn(Transform({ position: { x: 0, y: -0.5, z: 0 } }), Collider({ shape: { type: "box", half: { x: 5, y: 0.5, z: 5 } } }));
    world.spawn(Transform({ position: { x: 0, y: 1, z: 0 } }), Collider({ shape: { type: "box", half: { x: 3, y: 1, z: 0.2 } } })); // a wall with gaps at both ends
  },
});

const run = await createGame(rooms, null);
const { navmeshId } = await navBakeWorld(run.world);
const route = navPath(navmeshId, { x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 3 });
console.log(route.found, route.waypoints.length > 2); // true true: around the wall
navDispose(navmeshId);
run.dispose();
```

`navBakeTriangles(positions, indices, agent)` bakes from any triangles. A navmesh route is
a proposal; only the simulation proves a player can follow it. There is no 2D navmesh yet.
