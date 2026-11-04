/**
 * Plays the engine's examples in the browser: the same game definitions their headless
 * tests run, drawn by the engine's views and driven by the engine's game loop.
 * The 3D room by default; ?game=collect (2D) and ?game=hop (2D physics).
 */
import * as THREE from "three";
import { createSceneView, type SceneView } from "umbra-engine/three";
import { createAudio, createInput, startGame, type LoopOptions } from "umbra-engine/runtime";
import { createSpriteView, type Game, type GameRun, type SpriteView } from "umbra-engine";
import { room } from "../../../packages/engine/examples/room/room.js";
import { Collected, collect } from "../../../packages/engine/examples/collect/collect.js";
import { hop } from "../../../packages/engine/examples/hop/hop.js";

const canvas = document.querySelector("canvas")!;
const status = document.querySelector<HTMLElement>("#status")!;
const input = createInput(window);
const keys = (...codes: string[]) => codes.some((c) => input.down(c));
const axis = (minus: string[], plus: string[]) => Number(keys(...plus)) - Number(keys(...minus));
const which = new URLSearchParams(location.search).get("game");

const links = document.createDocumentFragment();
for (const [q, label] of [["?", "3D room"], ["?game=collect", "2D collect"], ["?game=hop", "2D physics hop"]] as const) {
  links.append(" · ", Object.assign(document.createElement("a"), { href: q, textContent: label }));
}

const loop = which === "collect"
  ? await play2d(collect, { w: 8, h: 5, goal: 5 }, {
    title: "Collect · umbra-engine 2D example", help: "W A S D or arrows move", playing: "Pick up five coins.",
    done: "All coins collected.", sounds: { [Collected.name]: "coin.wav" },
    input: () => ({ x: axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]), y: axis(["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"]) }),
  })
  : which === "hop"
  ? await play2d(hop, null, {
    title: "Hop · umbra-engine 2D physics example", help: "A D or arrows run · Space or W jumps", playing: "Jump the gaps and touch the green flag.",
    done: "", outcomes: { win: "You reached the flag.", fell: "You fell." },
    input: () => ({ x: axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]), jump: keys("Space", "KeyW", "ArrowUp") }),
  })
  : await play3d();
document.querySelector("#help p")!.append(links);

addEventListener("keydown", (e) => {
  if (e.code === "KeyR" && !e.repeat) void loop.restart();
  if (e.code === "KeyP" && !e.repeat) void loop.replay("played in the playground").then((r) => console.log("replay", JSON.stringify(r)));
});

/** A 2D game drawn by the engine's sprite view, with sounds for its events. */
async function play2d<I, L>(game: Game<I, L>, level: L, o: {
  title: string; help: string; playing: string; done: string; outcomes?: Record<string, string>;
  sounds?: Record<string, string>; input: LoopOptions<I, L>["input"];
}) {
  document.querySelector("h1")!.textContent = o.title;
  document.querySelector("#help p")!.textContent = `${o.help} · R restarts · P saves a replay to the console`;
  const ctx = canvas.getContext("2d")!;
  const resize = () => { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; };
  resize();
  addEventListener("resize", resize);
  const audio = o.sounds && createAudio({ sounds: o.sounds });
  void audio?.preload();
  let view: SpriteView | undefined, viewOf: GameRun<I, L> | undefined;
  status.textContent = o.playing;
  return startGame(game, level, {
    input: o.input,
    afterTick: (_run, events) => { input.endTick(); view?.capture(); audio?.play(events); },
    render(run, alpha) {
      if (viewOf !== run) { view = createSpriteView(run.world, ctx, { background: "#e9eef7", pixelRatio: devicePixelRatio }); viewOf = run; status.textContent = o.playing; }
      view!.draw(alpha);
    },
    onOutcome: (outcome) => { status.textContent = `${o.outcomes?.[outcome] ?? o.done} Press R to play again, or P to save the replay.`; },
  });
}

async function play3d() {
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
