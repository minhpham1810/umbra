import * as THREE from "three";
import { BUTTON, FIXED_DT, SceneSchema, createSimulation } from "@umbra/engine";
import level1 from "./level.json";
import level2 from "./level-2.json";

const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const status = document.querySelector<HTMLElement>("#status")!;
const restart = document.querySelector<HTMLButtonElement>("#restart")!;
const levels = [level1, level2];
const requested = Number(new URLSearchParams(location.search).get("level"));
const levelIndex = Number.isInteger(requested) && requested >= 1 && requested <= levels.length ? requested - 1 : 0;
const level = SceneSchema.parse(levels[levelIndex]);
const hasNext = levelIndex + 1 < levels.length;

async function start() {
  let sim = await createSimulation(level);
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
  const box = new THREE.BoxGeometry(1, 1, 1);
  const floor = new THREE.MeshStandardMaterial({ color: 0x555564, roughness: 0.95 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x343744, roughness: 0.95 });
  for (const piece of level.pieces) {
    if (piece.kind === "pit" || piece.kind === "moving_platform") continue;
    const mesh = new THREE.Mesh(box, piece.kind === "wall" ? wall : floor);
    mesh.position.set(piece.pos.x + 0.5, piece.pos.y + 0.5, piece.pos.z + 0.5);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
  }
  // One mesh per platform, in the order sim.platforms() reports them.
  const platformMeshes = sim.platforms().map(() => {
    const mesh = new THREE.Mesh(box, floor);
    mesh.scale.y = 0.25;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  });
  let platformsBefore = sim.platforms();
  let platformsNow = platformsBefore;
  const playerGeometry = new THREE.CapsuleGeometry(0.3, 0.8, 4, 12);
  const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xc8c4b5, roughness: 0.85 });
  const player = new THREE.Mesh(playerGeometry, playerMaterial);
  player.castShadow = true;
  scene.add(player);
  const lantern = new THREE.PointLight(0xffc36c, 35, 14, 2);
  lantern.castShadow = true;
  lantern.shadow.mapSize.set(1024, 1024);
  scene.add(lantern);
  const goalMaterial = new THREE.MeshStandardMaterial({ color: 0x72e5be,
    emissive: 0x39cfa0, emissiveIntensity: 2, wireframe: true });
  for (const goal of level.goals) {
    const marker = new THREE.Mesh(box, goalMaterial);
    marker.position.set(goal.pos.x + 0.5, goal.pos.y + 0.5, goal.pos.z + 0.5);
    scene.add(marker);
    const light = new THREE.PointLight(0x72e5be, 12, 8);
    light.position.copy(marker.position);
    scene.add(light);
  }
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
  const lookAt = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const playingText = levelIndex === 0 ? "Reach the green exit. Jump across the broken floor."
    : "Reach the green exit. Ride the moving platform across the chasm.";
  status.textContent = playingText;

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize, options);
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLButtonElement) return;
    if (["KeyW", "KeyS", "KeyA", "KeyD", "Space", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    }
    if (event.code === "KeyR" && !event.repeat) void reset();
    if (event.code === "KeyN" && !event.repeat && hasNext && sim.outcome === "win") location.search = `?level=${levelIndex + 2}`;
  }, options);
  window.addEventListener("keyup", (event) => keys.delete(event.code), options);
  window.addEventListener("blur", () => keys.clear(), options);
  document.addEventListener("visibilitychange", () => {
    keys.clear(); accumulator = 0; lastTime = performance.now();
  }, options);
  canvas.addEventListener("click", () => {
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
      accumulator = 0; lastTime = performance.now();
      status.textContent = playingText;
    } catch (error) { status.textContent = `Restart failed: ${String(error)}`; }
    finally { resetting = false; restart.disabled = false; }
  }

  renderer.setAnimationLoop((time) => {
    const elapsed = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    if (!resetting && !document.hidden && sim.outcome === "timeout") {
      accumulator += elapsed;
      while (accumulator >= FIXED_DT && sim.outcome === "timeout") {
        if (keys.has("KeyA") || keys.has("ArrowLeft")) yaw += 2;
        if (keys.has("KeyD") || keys.has("ArrowRight")) yaw -= 2;
        yaw = (yaw + 256) % 256;
        let buttons = 0;
        if (keys.has("KeyW")) buttons |= BUTTON.FORWARD;
        if (keys.has("KeyS")) buttons |= BUTTON.BACK;
        if (keys.has("Space")) buttons |= BUTTON.JUMP;
        previous.copy(current);
        platformsBefore = platformsNow;
        sim.step({ buttons, yaw: Math.round(yaw) % 256 });
        current.copy(sim.position());
        platformsNow = sim.platforms();
        accumulator -= FIXED_DT;
      }
    }
    const alpha = sim.outcome === "timeout" ? accumulator / FIXED_DT : 1;
    player.position.lerpVectors(previous, current, alpha);
    platformMeshes.forEach((mesh, i) => {
      const a = platformsBefore[i]!, b = platformsNow[i]!;
      mesh.position.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
    });
    const radians = yaw / 256 * Math.PI * 2;
    cameraTarget.set(player.position.x - Math.sin(radians) * 4,
      player.position.y + 2.6, player.position.z - Math.cos(radians) * 4);
    camera.position.copy(cameraTarget);
    lookAt.copy(player.position); lookAt.y += 0.5;
    camera.lookAt(lookAt);
    lantern.position.copy(player.position); lantern.position.y += 1.2;
    if (sim.outcome !== "timeout") {
      const message = sim.outcome !== "win" ? "You fell into the dark. Try again."
        : hasNext ? "You found the exit. Press N for the next level." : "You found the last exit. Play again?";
      if (status.textContent !== message) status.textContent = message;
    }
    renderer.render(scene, camera);
  });

  const cleanup = () => {
    if (closed) return;
    closed = true;
    renderer.setAnimationLoop(null);
    abort.abort(); sim.dispose(); renderer.dispose();
    box.dispose(); playerGeometry.dispose();
    floor.dispose(); wall.dispose(); playerMaterial.dispose(); goalMaterial.dispose();
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
