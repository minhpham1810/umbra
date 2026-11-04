/**
 * Plays the engine's examples in the browser: the same game definitions their headless
 * tests run, drawn by the engine's views and driven by the engine's game loop.
 * The 3D room by default; the 2D collect game at ?game=collect.
 */
import * as THREE from "three";
import { createSceneView, type SceneView } from "umbra-engine/three";
import { createAudio, createInput, startGame } from "umbra-engine/runtime";
import { createSpriteView, type GameRun, type SpriteView } from "umbra-engine";
import { room } from "../../../packages/engine/examples/room/room.js";
import { Collected, collect } from "../../../packages/engine/examples/collect/collect.js";

const canvas = document.querySelector("canvas")!;
const status = document.querySelector<HTMLElement>("#status")!;
const input = createInput(window);
const keys = (...codes: string[]) => codes.some((c) => input.down(c));
const loop = new URLSearchParams(location.search).get("game") === "collect" ? await play2d() : await play3d();

addEventListener("keydown", (e) => {
  if (e.code === "KeyR" && !e.repeat) void loop.restart();
  if (e.code === "KeyP" && !e.repeat) void loop.replay("played in the playground").then((r) => console.log("replay", JSON.stringify(r)));
});

async function play2d() {
  document.querySelector("h1")!.textContent = "Collect · umbra-engine 2D example";
  document.querySelector("#help p")!.textContent = "W A S D or arrows move · R restarts · P saves a replay to the console · ";
  document.querySelector("#help p")!.append(Object.assign(document.createElement("a"), { href: "?", textContent: "3D example" }));
  const ctx = canvas.getContext("2d")!;
  const resize = () => { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; };
  resize();
  addEventListener("resize", resize);
  const audio = createAudio({ sounds: { [Collected.name]: "coin.wav" } });
  void audio.preload();
  let view: SpriteView | undefined, viewOf: GameRun<unknown, unknown> | undefined;
  const playing = "Pick up five coins.";
  status.textContent = playing;
  return startGame(collect, { w: 8, h: 5, goal: 5 }, {
    input: () => ({
      x: Number(keys("KeyD", "ArrowRight")) - Number(keys("KeyA", "ArrowLeft")),
      y: Number(keys("KeyW", "ArrowUp")) - Number(keys("KeyS", "ArrowDown")),
    }),
    afterTick: (_run, events) => { input.endTick(); view?.capture(); audio.play(events); },
    render(run, alpha) {
      if (viewOf !== run) { view = createSpriteView(run.world, ctx, { background: "#e9eef7", pixelRatio: devicePixelRatio }); viewOf = run; status.textContent = playing; }
      view!.draw(alpha);
    },
    onOutcome: () => { status.textContent = "All coins collected. Press R to play again, or P to save the replay."; },
  });
}

async function play3d() {
  document.querySelector("#help p")!.append(" · ", Object.assign(document.createElement("a"), { href: "?game=collect", textContent: "2D example" }));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const resize = () => renderer.setSize(innerWidth, innerHeight, false);
  resize();
  addEventListener("resize", resize);

  let view: SceneView | undefined;
  let viewOf: GameRun<unknown, unknown> | undefined;
  const playing = "Push the crate to the ledge, climb it, and reach the green goal.";
  status.textContent = playing;

  return startGame(room, null, {
    input: () => ({
      // The camera looks along +z, so screen-right is world -x.
      x: Number(input.down("KeyA") || input.down("ArrowLeft")) - Number(input.down("KeyD") || input.down("ArrowRight")),
      z: Number(input.down("KeyW") || input.down("ArrowUp")) - Number(input.down("KeyS") || input.down("ArrowDown")),
      jump: input.down("Space"),
    }),
    afterTick: () => { input.endTick(); view?.capture(); },
    render(run, alpha) {
      if (viewOf !== run) { view?.dispose(); view = createSceneView(run.world, { background: "#e9eef7" }); viewOf = run; status.textContent = playing; }
      view!.setAspect(innerWidth / innerHeight);
      view!.sync(alpha);
      renderer.render(view!.scene, view!.camera);
    },
    onOutcome: () => { status.textContent = "You reached the goal. Press R to play again, or P to save the replay."; },
  });
}
