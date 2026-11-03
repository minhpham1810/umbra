/**
 * Boo & Co.: run a haunted mansion. Place ghosts and traps to hit the scare quota
 * before the day ends. The simulation is the engine's deterministic mansion sim;
 * this file only draws it and turns clicks into placements.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MansionSchema, buildCatalog, createMansion, type BuildKind } from "@umbra/engine";
import rawMansion from "./mansion.json";

const mansion = MansionSchema.parse(rawMansion);
const CATALOG = buildCatalog(mansion); // build stats with this mansion's overrides
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = document.querySelector("canvas")!;
const TICKS_PER_SECOND = 60;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfbe9e1);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.42; // stay overhead
scene.add(new THREE.HemisphereLight(0xfff6ee, 0xd9c6e8, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-8, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 });
scene.add(sun);

const W = mansion.tiles[0]!.length, H = mansion.tiles.length;
const cx = (x: number) => x - W / 2 + 0.5, cz = (y: number) => y - H / 2 + 0.5;
const box = new THREE.BoxGeometry(1, 1, 1);
const tileMat = {
  ".": new THREE.MeshStandardMaterial({ color: 0xfff3e4, roughness: 0.9 }),
  "#": new THREE.MeshStandardMaterial({ color: 0xc9b3e6, roughness: 0.8 }),
  E: new THREE.MeshStandardMaterial({ color: 0xa8e6cf, roughness: 0.8 }),
  X: new THREE.MeshStandardMaterial({ color: 0xffd38a, roughness: 0.8 }),
};
const floorTiles: THREE.Mesh[] = [];
mansion.tiles.forEach((row, y) => [...row].forEach((c, x) => {
  const mesh = new THREE.Mesh(box, tileMat[c as keyof typeof tileMat]);
  const wall = c === "#";
  mesh.scale.set(1, wall ? 1.2 : 0.2, 1);
  mesh.position.set(cx(x), wall ? 0.6 : -0.1, cz(y));
  mesh.castShadow = wall; mesh.receiveShadow = true;
  mesh.userData = { x, y, tile: c };
  if (!wall) floorTiles.push(mesh);
  scene.add(mesh);
}));
camera.position.set(0, 18, 11);
controls.target.set(0, 0, 0);

const visitorGeo = new THREE.CapsuleGeometry(0.22, 0.35, 4, 10);
const ghostGeo = new THREE.SphereGeometry(0.32, 20, 14);
const trapGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.08, 20);
const buildMat = {
  ghost: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x8f7ae6, emissiveIntensity: 0.35, transparent: true, opacity: 0.9 }),
  trap: new THREE.MeshStandardMaterial({ color: 0xef7b8c, roughness: 0.6 }),
};
const rangeRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x8f7ae6, transparent: true, opacity: 0.18 }));
rangeRing.rotation.x = -Math.PI / 2;
rangeRing.visible = false;
scene.add(rangeRing);

// ── state ──────────────────────────────────────────────────────────────────
let sim = createMansion(mansion);
let tool: BuildKind = "ghost";
let speed = 1;
let paused = false;
let acc = 0;
let last = performance.now();
let seenEvents = 0;
const visitorMeshes = new Map<number, THREE.Mesh>();
const buildMeshes: THREE.Mesh[] = [];
/** Cells with a build queued this tick but not yet applied by the sim. */
const queued = new Set<string>();

function hint(text: string) { $("hint").textContent = text; }

function reset() {
  sim = createMansion(mansion);
  for (const m of [...visitorMeshes.values(), ...buildMeshes]) scene.remove(m);
  visitorMeshes.clear(); buildMeshes.length = 0; queued.clear();
  seenEvents = 0; acc = 0; paused = false;
  $("pause").textContent = "Pause";
  $("end").style.display = "none";
  hint("Pick a ghost or trap, then click a floor tile.");
}

// ── input ──────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function cellAt(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  return ray.intersectObjects(floorTiles)[0]?.object.userData as { x: number; y: number; tile: string } | undefined;
}
let down: { x: number; y: number } | undefined;
canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("pointermove", (e) => {
  const c = cellAt(e);
  rangeRing.visible = !!c && c.tile === ".";
  if (c) {
    const size = CATALOG[tool].range * 2 + 1;
    rangeRing.scale.set(size, size, 1);
    rangeRing.position.set(cx(c.x), 0.02, cz(c.y));
  }
});
canvas.addEventListener("pointerup", (e) => {
  // A drag orbits the camera; only a click builds.
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || sim.done) return;
  const c = cellAt(e);
  if (!c) return;
  if (c.tile !== ".") return hint("Builds go on floor tiles, not doors.");
  const key = `${c.x},${c.y}`;
  if (queued.has(key) || sim.builds.some((b) => b.x === c.x && b.y === c.y)) return hint("That tile already has a build.");
  const left = mansion.budget - sim.stats().spent;
  if (CATALOG[tool].cost > left) return hint(`Not enough coins: ${tool} costs ${CATALOG[tool].cost}, you have ${left}.`);
  sim.place({ kind: tool, x: c.x, y: c.y, tick: sim.tick });
  queued.add(key);
  if (paused) sim.step(); // apply it now so the build shows while paused
});
for (const kind of ["ghost", "trap"] as const) {
  $(`tool-${kind}`).textContent = `${kind === "ghost" ? "Ghost" : "Trap"} · ${CATALOG[kind].cost}`;
  $(`tool-${kind}`).addEventListener("click", () => {
    tool = kind;
    $("tool-ghost").setAttribute("aria-pressed", String(kind === "ghost"));
    $("tool-trap").setAttribute("aria-pressed", String(kind === "trap"));
    const c = CATALOG[kind];
    hint(kind === "ghost" ? `Ghosts scare one visitor within ${c.range} tiles, every ${c.cooldown / 60} s.`
      : `Traps give a ${c.scare}× scare to whoever steps on them, every ${c.cooldown / 60} s.`);
  });
}
$("pause").addEventListener("click", () => { paused = !paused; $("pause").textContent = paused ? "Resume" : "Pause"; });
document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => b.addEventListener("click", () => {
  speed = Number(b.dataset["speed"]);
  document.querySelectorAll("[data-speed]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));
$("restart").addEventListener("click", reset);
$("again").addEventListener("click", reset);
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); $("pause").click(); }
});

// ── drawing ────────────────────────────────────────────────────────────────
function sync(dt: number, time: number) {
  for (const b of sim.builds.slice(buildMeshes.length)) {
    const m = new THREE.Mesh(b.kind === "ghost" ? ghostGeo : trapGeo, buildMat[b.kind]);
    m.position.set(cx(b.x), b.kind === "ghost" ? 0.7 : 0.04, cz(b.y));
    m.castShadow = true;
    m.userData = { kind: b.kind };
    buildMeshes.push(m);
    scene.add(m);
  }
  queued.clear(); // queued builds are applied on the next sim step, before this runs again
  buildMeshes.forEach((m, i) => { if (m.userData["kind"] === "ghost") m.position.y = 0.7 + 0.08 * Math.sin(time * 2 + i); });
  const alive = new Set<number>();
  for (const v of sim.visitors) {
    alive.add(v.id);
    let m = visitorMeshes.get(v.id);
    if (!m) {
      m = new THREE.Mesh(visitorGeo, new THREE.MeshStandardMaterial({ color: 0x7ec8e3 }));
      m.position.set(cx(v.x), 0.35, cz(v.y));
      m.castShadow = true;
      visitorMeshes.set(v.id, m);
      scene.add(m);
    }
    // Ease toward the sim's cell; the sim moves visitors one whole tile at a time.
    const k = 1 - Math.exp(-dt * 12 * Math.max(1, speed / 2));
    m.position.x += (cx(v.x) - m.position.x) * k;
    m.position.z += (cz(v.y) - m.position.z) * k;
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.color.set(v.fleeing ? 0xff9fb2 : v.fear > 0 ? 0xb9a7f0 : 0x7ec8e3);
  }
  for (const [id, m] of visitorMeshes) {
    if (!alive.has(id)) { scene.remove(m); (m.material as THREE.Material).dispose(); visitorMeshes.delete(id); }
  }
  const s = sim.stats();
  const secs = Math.ceil((mansion.durationTicks - sim.tick) / TICKS_PER_SECOND);
  $("scares").textContent = `${s.scares} / ${s.quota}`;
  ($("quota") as HTMLMeterElement).value = Math.min(1, s.scares / s.quota);
  $("coins").textContent = String(mansion.budget - s.spent);
  $("time").textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  $("visitors").textContent = `${sim.visitors.length} / ${s.fled} / ${s.exited}`;
  $("stuck").textContent = String(s.deadlocked);
  for (const e of sim.events.slice(seenEvents)) {
    if (e.kind === "deadlock") hint("A visitor is stuck: scared guests are jammed against new arrivals.");
    if (e.kind === "rejected") hint(`Build rejected: ${e.reason}.`);
  }
  seenEvents = sim.events.length;
  if (sim.done && $("end").style.display !== "block") {
    const r = sim.result();
    $("end-title").textContent = r.outcome === "win" ? "Spooktacular!" : "Not scary enough";
    $("end-text").textContent = `${r.scares} scares out of a quota of ${r.quota}. ${r.fled} visitors fled, ${r.exited} walked out unimpressed` +
      (r.deadlocked ? `, and ${r.deadlocked} got stuck.` : ".");
    $("end").style.display = "block";
    $<HTMLButtonElement>("again").focus();
  }
}

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener("resize", resize);
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!paused && !sim.done) {
    acc += dt * TICKS_PER_SECOND * speed;
    while (acc >= 1 && !sim.done) { sim.step(); acc -= 1; }
  }
  sync(dt, now / 1000);
  controls.update();
  renderer.render(scene, camera);
});
