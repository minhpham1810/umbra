# In the browser

The simulation never knows it is in a browser. What you see and hear is **presentation**:
components that renderers and audio read, saved with the world but left out of the state
hash, so changing a colour or a sound never invalidates a replay. Spawn them in `setup`
like any other component, so headless and browser runs create the same entities.

| Component | Draws |
| --- | --- |
| `Mesh` | A box, sphere, capsule, cylinder, plane, triangle mesh or glTF model at the entity's `Transform` |
| `Camera`, `Light` | A perspective camera (the active one with the lowest id draws); ambient, hemisphere, directional, point and spot lights |
| `Sprite` | A 2D rectangle, circle, image (with sprite-sheet frames) or text, by layer |
| `Camera2D` | A 2D camera centred on its `Transform`, `zoom` pixels per world unit |

All six are built into every game. Systems may write them (a score label, an animation
frame); simulation logic must not read them.

```ts
import { Camera, Light, Mesh, Sprite, Transform, World } from "umbra-engine";

const world = new World({ seed: 0, components: [Transform, Mesh, Camera, Light, Sprite] });
const at = (x: number, y: number, z: number) => Transform({ position: { x, y, z } });
world.spawn(at(0, 0.5, 0), Mesh({ geometry: { type: "box", half: { x: 0.5, y: 0.5, z: 0.5 } }, material: { color: "#e8a33d" }, castShadow: true }));
world.spawn(at(0, 3, -6), Camera({ fov: 50, lookAt: { x: 0, y: 0, z: 0 } }));
world.spawn(Light({ type: "hemisphere", intensity: 1.2 }));
world.spawn(at(5, 10, 5), Light({ type: "directional", castShadow: true }));
const before = world.hash();
world.get(1, Mesh)!.material.color = "#ff0000"; // presentation: the hash does not change
console.log(world.hash() === before); // true
```

## The game loop

`startGame` from `umbra-engine/runtime` runs fixed ticks from wall-clock time: it samples
your input once per tick, steps the game, and calls `render` every frame with `alpha`, how
far the frame is between the last two ticks. Every input is recorded, so `loop.replay()`
returns the session as a replay that reproduces exactly anywhere.

```ts browser
import * as THREE from "three";
import { createSceneView } from "umbra-engine/three";
import { createInput, startGame } from "umbra-engine/runtime";

const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector("canvas")! });
const input = createInput(window);           // keys, mouse, pointer, gamepads
let view: ReturnType<typeof createSceneView> | undefined;

const loop = await startGame(myGame, level, {
  input: () => ({ x: Number(input.down("KeyD")) - Number(input.down("KeyA")), jump: input.pressed("Space") }),
  afterTick: () => { input.endTick(); view?.capture(); },
  render(run, alpha) {
    view ??= createSceneView(run.world, { background: "#e9eef7" });
    view.setAspect(innerWidth / innerHeight);
    view.sync(alpha);                          // objects drawn between the last two ticks
    renderer.render(view.scene, view.camera);
  },
  onOutcome: (outcome) => console.log(outcome),
});
// loop.pause(), loop.resume(), loop.restart(), await loop.replay()
```

`input.pressed(code)` is true for one tick after a key goes down, even when the press was
shorter than a tick; `down` is held state. Codes are `KeyboardEvent.code` values
(`"KeyW"`, `"Space"`, `"ArrowLeft"`) and `"Mouse0"`–`"Mouse2"`.

## 2D

`createSpriteView(world, ctx)` draws `Sprite` components on a canvas, by layer, with y up
and the `Transform`'s turn about z as rotation. It needs no Three.js.

```ts browser
import { createSpriteView } from "umbra-engine";

const canvas = document.querySelector("canvas")!;
canvas.width = innerWidth * devicePixelRatio;
canvas.height = innerHeight * devicePixelRatio;
const sprites = createSpriteView(run.world, canvas.getContext("2d")!, { pixelRatio: devicePixelRatio });
// afterTick: sprites.capture()      render: sprites.draw(alpha)
canvas.addEventListener("click", (e) => console.log(sprites.toWorld(e.offsetX * devicePixelRatio, e.offsetY * devicePixelRatio)));
```

Images load from the asset's URL by default; pass `images: (asset) => …` to load them
another way. A sprite-sheet cell is `frame: { x, y, w, h }` in pixels, so animating is a
system that changes `frame`.

## Models

A `Mesh` with `geometry: { type: "model", asset: "tree.glb" }` draws a glTF model once the
scene view has a loader:

```ts browser
import { createSceneView, gltfModels } from "umbra-engine/three";

const view = createSceneView(run.world, { models: gltfModels({ path: "/models/" }) });
```

Colliders made from the same file are in [Physics](physics.md#models-as-colliders).

## Sound

`createAudio` plays sounds for event names. Sound is presentation too: it reads events and
never changes the game.

```ts browser
import { createAudio } from "umbra-engine/runtime";

const audio = createAudio({ sounds: {
  coin: "sounds/coin.wav",
  hit: (data: { hard: boolean }) => (data.hard ? "sounds/crash.wav" : undefined),
} });
await audio.preload();
// afterTick: (run, events) => audio.play(events)     (each sound at most once per tick)
```

Browsers keep audio silent until the page has had a click or key press; `createAudio`
resumes as soon as it is allowed.

## The playground

[the playground](https://minhpham1810.github.io/umbra/playground/) ([source](https://github.com/minhpham1810/umbra/tree/main/apps/playground)) wires all of this up for the engine's examples:
`pnpm --filter @umbra/playground dev`, then the room (3D), `?game=collect` (2D, with sound)
and `?game=hop` (2D physics). Press P to print the session's replay.
