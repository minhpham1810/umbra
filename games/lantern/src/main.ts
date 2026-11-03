import * as THREE from "three";
import { kitSceneView } from "umbra-engine/three";
import { BUTTON, FIXED_DT, SceneSchema, centerView, createSimulation, drawSceneSide, sideLayout, type Scene, type SideLayout } from "umbra-engine";
import level1 from "./level.json";
import level2 from "./level-2.json";

const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const status = document.querySelector<HTMLElement>("#status")!;
const restart = document.querySelector<HTMLButtonElement>("#restart")!;
const levels = [level1, level2];
const params = new URLSearchParams(location.search);
// ?scene=<name> plays public/levels/<name>.json, e.g. a level written by `haunt`.
const custom = params.get("scene");
const requested = Number(params.get("level"));
const levelIndex = custom ? -1 : Number.isInteger(requested) && requested >= 1 && requested <= levels.length ? requested - 1 : 0;
// ?view=2d draws with the engine's Canvas 2D side view instead of Three.js.
const flat = params.get("view") === "2d";
if (flat) {
  const help = document.querySelectorAll("footer p");
  help[0]!.textContent = "A / D walk · W or Space jump · R restart · N next level";
  help[1]!.textContent = "Side view. Keyboard required.";
}
const hasNext = levelIndex >= 0 && levelIndex + 1 < levels.length;

async function loadLevel() {
  if (!custom) return SceneSchema.parse(levels[levelIndex]);
  if (!/^[\w-]+$/.test(custom)) throw new Error(`bad scene name "${custom}" (letters, digits, - and _ only)`);
  const res = await fetch(`${import.meta.env.BASE_URL}levels/${custom}.json`);
  // Vite answers a missing file with index.html, so check the type as well as the status.
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) throw new Error(`no level at public/levels/${custom}.json`);
  const parsed = SceneSchema.safeParse(await res.json());
  const issue = parsed.error?.issues[0];
  if (!parsed.success) throw new Error(`levels/${custom}.json is not a valid scene: ${issue?.path.join(".")} ${issue?.message}`);
  return parsed.data;
}

type V3 = { x: number; y: number; z: number };

/** What the game loop needs from a view: draw a frame, follow the window size, clean up. */
interface View {
  render(player: THREE.Vector3, platforms: THREE.Vector3[], crates: THREE.Vector3[], yaw: number): void;
  resize(): void;
  dispose(): void;
}

function threeView(level: Scene): View {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080b12);
  scene.fog = new THREE.FogExp2(0x080b12, 0.045);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0x9eafd0, 0x25202a, 1.1));
  const floor = new THREE.MeshStandardMaterial({ color: 0x555564, roughness: 0.95 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x343744, roughness: 0.95 });
  const crateMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.9 });
  const goalMaterial = new THREE.MeshStandardMaterial({ color: 0x72e5be,
    emissive: 0x39cfa0, emissiveIntensity: 2, wireframe: true });
  const kit = kitSceneView(level, { floor, wall, platform: floor, crate: crateMaterial, goal: goalMaterial }, { shadows: true });
  scene.add(kit.group);
  const playerGeometry = new THREE.CapsuleGeometry(0.3, 0.8, 4, 12);
  const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xc8c4b5, roughness: 0.85 });
  const player = new THREE.Mesh(playerGeometry, playerMaterial);
  player.castShadow = true;
  scene.add(player);
  const lantern = new THREE.PointLight(0xffc36c, 35, 14, 2);
  lantern.castShadow = true;
  lantern.shadow.mapSize.set(1024, 1024);
  scene.add(lantern);
  for (const goal of level.goals) {
    const light = new THREE.PointLight(0x72e5be, 12, 8);
    light.position.set(goal.pos.x + 0.5, goal.pos.y + 0.5, goal.pos.z + 0.5);
    scene.add(light);
  }
  const lookAt = new THREE.Vector3();
  return {
    render(position, platforms, crates, yaw) {
      player.position.copy(position);
      kit.update({ platforms, crates });
      const radians = yaw / 256 * Math.PI * 2;
      camera.position.set(position.x - Math.sin(radians) * 4, position.y + 2.6, position.z - Math.cos(radians) * 4);
      lookAt.copy(position); lookAt.y += 0.5;
      camera.lookAt(lookAt);
      lantern.position.copy(position); lantern.position.y += 1.2;
      renderer.render(scene, camera);
    },
    resize() {
      renderer.setSize(innerWidth, innerHeight);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    },
    dispose() {
      renderer.dispose(); kit.dispose(); playerGeometry.dispose();
      floor.dispose(); wall.dispose(); crateMaterial.dispose(); playerMaterial.dispose(); goalMaterial.dispose();
    },
  };
}

/** The engine's Canvas 2D side view: the corridor runs left to right, 12 blocks tall. */
function canvasView(layout: SideLayout): View {
  const ctx = canvas.getContext("2d")!;
  const size = { w: 0, h: 0 };
  return {
    render(player, platforms, crates) {
      const scale = size.h / 12;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      drawSceneSide(ctx, size, layout, { player, platforms, crates }, centerView(size.w, size.h, player[layout.axis], -player.y - 1, scale));
    },
    resize() {
      size.w = innerWidth; size.h = innerHeight;
      canvas.width = Math.round(innerWidth * devicePixelRatio); canvas.height = Math.round(innerHeight * devicePixelRatio);
    },
    dispose() {},
  };
}

async function start() {
  const level = await loadLevel();
  let sim = await createSimulation(level);
  const side = flat ? sideLayout(level) : undefined;
  const view = side ? canvasView(side) : threeView(level);
  let platformsBefore = sim.platforms();
  let platformsNow = platformsBefore;
  let cratesBefore = sim.crates();
  let cratesNow = cratesBefore;
  const keys = new Set<string>();
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let yaw = level.spawn.yaw;
  let accumulator = 0;
  let lastTime = performance.now();
  let resetting = false;
  let closed = false;
  const current = new THREE.Vector3().copy(sim.position());
  const previous = current.clone();
  const shownPlayer = new THREE.Vector3();
  const shownPlatforms = platformsNow.map(() => new THREE.Vector3());
  const shownCrates = cratesNow.map(() => new THREE.Vector3());
  const playingText = custom ? `Generated level "${custom}". Reach the green exit.`
    : levelIndex === 0 ? "Reach the green exit. Jump across the broken floor."
    : "Reach the green exit. Ride the moving platform across the chasm.";
  status.textContent = playingText;

  view.resize();
  window.addEventListener("resize", () => view.resize(), options);
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLButtonElement) return;
    if (["KeyW", "KeyS", "KeyA", "KeyD", "Space", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    }
    if (event.code === "KeyR" && !event.repeat) void reset();
    if (event.code === "KeyN" && !event.repeat && hasNext && sim.outcome === "win") location.search = `?level=${levelIndex + 2}${flat ? "&view=2d" : ""}`;
  }, options);
  window.addEventListener("keyup", (event) => keys.delete(event.code), options);
  window.addEventListener("blur", () => keys.clear(), options);
  document.addEventListener("visibilitychange", () => {
    keys.clear(); accumulator = 0; lastTime = performance.now();
  }, options);
  canvas.addEventListener("click", () => {
    if (flat) return; // the side view steers with A and D, not the mouse
    canvas.requestPointerLock?.()?.catch(() => {
      status.textContent = "Mouse capture unavailable. Use A and D to turn.";
    });
  }, options);
  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement === canvas) yaw = (yaw - event.movementX * 0.15 + 256) % 256;
  }, options);
  restart.addEventListener("click", () => void reset(), options);

  async function reset() {
    if (resetting) return;
    resetting = true;
    restart.disabled = true;
    keys.clear();
    try {
      const next = await createSimulation(level);
      if (closed) { next.dispose(); return; }
      sim.dispose(); sim = next;
      yaw = level.spawn.yaw;
      current.copy(sim.position()); previous.copy(current);
      platformsBefore = platformsNow = sim.platforms();
      cratesBefore = cratesNow = sim.crates();
      accumulator = 0; lastTime = performance.now();
      status.textContent = playingText;
    } catch (error) { status.textContent = `Restart failed: ${String(error)}`; }
    finally { resetting = false; restart.disabled = false; }
  }

  let frame = requestAnimationFrame(function tick(time) {
    frame = requestAnimationFrame(tick);
    const elapsed = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    if (!resetting && !document.hidden && sim.outcome === "timeout") {
      accumulator += elapsed;
      while (accumulator >= FIXED_DT && sim.outcome === "timeout") {
        const left = keys.has("KeyA") || keys.has("ArrowLeft"), right = keys.has("KeyD") || keys.has("ArrowRight");
        let buttons = 0;
        if (side) {
          // Side view: left and right face and walk that way; W or Space jumps.
          if (left !== right) { yaw = right ? side.yawRight : (side.yawRight + 128) % 256; buttons |= BUTTON.FORWARD; }
          if (keys.has("Space") || keys.has("KeyW")) buttons |= BUTTON.JUMP;
        } else {
          if (left) yaw += 2;
          if (right) yaw -= 2;
          yaw = (yaw + 256) % 256;
          if (keys.has("KeyW")) buttons |= BUTTON.FORWARD;
          if (keys.has("KeyS")) buttons |= BUTTON.BACK;
          if (keys.has("Space")) buttons |= BUTTON.JUMP;
        }
        previous.copy(current);
        platformsBefore = platformsNow;
        cratesBefore = cratesNow;
        sim.step({ buttons, yaw: Math.round(yaw) % 256 });
        current.copy(sim.position());
        platformsNow = sim.platforms();
        cratesNow = sim.crates();
        accumulator -= FIXED_DT;
      }
    }
    const alpha = sim.outcome === "timeout" ? accumulator / FIXED_DT : 1;
    shownPlayer.lerpVectors(previous, current, alpha);
    const lerp = (out: THREE.Vector3[], before: V3[], now: V3[]) => out.forEach((p, i) => {
      const a = before[i]!, b = now[i]!;
      p.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
    });
    lerp(shownPlatforms, platformsBefore, platformsNow);
    lerp(shownCrates, cratesBefore, cratesNow);
    if (sim.outcome !== "timeout") {
      const message = sim.outcome !== "win" ? "You fell into the dark. Try again."
        : hasNext ? "You found the exit. Press N for the next level." : "You found the last exit. Play again?";
      if (status.textContent !== message) status.textContent = message;
    }
    view.render(shownPlayer, shownPlatforms, shownCrates, yaw);
  });

  const cleanup = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(frame);
    abort.abort(); sim.dispose(); view.dispose();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
  window.addEventListener("pagehide", cleanup, options);
  import.meta.hot?.dispose(cleanup);
}

start().catch((error: unknown) => {
  status.textContent = `Lantern could not start: ${String(error)}`;
  restart.disabled = true;
  console.error(error);
});
