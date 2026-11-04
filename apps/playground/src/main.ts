/**
 * Plays the engine's room example in the browser: the same game definition its headless
 * tests run, drawn by the engine's Three.js scene view, driven by the engine's game loop.
 */
import * as THREE from "three";
import { createSceneView, type SceneView } from "umbra-engine/three";
import { createInput, startGame } from "umbra-engine/runtime";
import type { GameRun } from "umbra-engine";
import { room } from "../../../packages/engine/examples/room/room.js";

const canvas = document.querySelector("canvas")!;
const status = document.querySelector<HTMLElement>("#status")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const resize = () => renderer.setSize(innerWidth, innerHeight, false);
resize();
addEventListener("resize", resize);

const input = createInput(window);
let view: SceneView | undefined;
let viewOf: GameRun<unknown, unknown> | undefined;
const playing = "Push the crate to the ledge, climb it, and reach the green goal.";
status.textContent = playing;

const loop = await startGame(room, null, {
  input: () => ({
    // The camera looks along +z, so screen-right is world -x.
    x: Number(input.down("KeyA") || input.down("ArrowLeft")) - Number(input.down("KeyD") || input.down("ArrowRight")),
    z: Number(input.down("KeyW") || input.down("ArrowUp")) - Number(input.down("KeyS") || input.down("ArrowDown")),
    jump: input.down("Space"),
  }),
  afterTick: () => { input.endTick(); view?.capture(); },
  render(run, alpha) {
    if (viewOf !== run) { view?.dispose(); view = createSceneView(run.world, { background: "#e9eef7" }); viewOf = run; }
    view!.setAspect(innerWidth / innerHeight);
    view!.sync(alpha);
    renderer.render(view!.scene, view!.camera);
  },
  onOutcome: () => { status.textContent = "You reached the goal. Press R to play again, or P to save the replay."; },
});

addEventListener("keydown", (e) => {
  if (e.code === "KeyR" && !e.repeat) void loop.restart().then(() => { status.textContent = playing; });
  if (e.code === "KeyP" && !e.repeat) void loop.replay("played in the playground").then((r) => console.log("replay", JSON.stringify(r)));
});
