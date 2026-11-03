/**
 * Studio: load a replay, re-simulate it with the real engine, check the final hash,
 * and play it back in 3D with an orbit camera, a path trail and a scrubber.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { kitSceneView, type KitView } from "@umbra/engine/three";
import { SceneSchema, createSimulation, type InputFrame, type Scene, type SimEvent } from "@umbra/engine";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>("canvas");
const ui = {
  samples: $("#samples"), events: $("#events"), title: $("#title"), note: $("#note"), verify: $("#verify"),
  play: $<HTMLButtonElement>("#play"), scrub: $<HTMLInputElement>("#scrub"), tick: $("#tick"),
  speed: $<HTMLSelectElement>("#speed"), follow: $<HTMLInputElement>("#follow"), file: $<HTMLInputElement>("#file"),
  fix: $("#fix"), before: $<HTMLButtonElement>("#show-before"), after: $<HTMLButtonElement>("#show-after"),
  reason: $("#fix-reason"), edits: $("#edits"),
};
const MAX_TICKS = 60 * 60 * 10;

type V3 = { x: number; y: number; z: number };
interface Loaded {
  title: string; note: string; scene: Scene;
  /** Player and platform positions at each tick; index 0 is before the first step. */
  player: V3[]; platforms: V3[][]; crates: V3[][];
  events: SimEvent[]; outcome: string; verified: boolean; reason: string;
}

/** Replay files are untrusted: validate the scene and inputs before simulating. */
function parseReplay(raw: unknown) {
  if (typeof raw !== "object" || raw === null) throw new Error("not a JSON object");
  const r = raw as Record<string, unknown>;
  const scene = SceneSchema.parse(r["scene"]);
  const inputs = r["inputs"];
  if (!Array.isArray(inputs) || inputs.length > MAX_TICKS) throw new Error(`inputs must be an array of at most ${MAX_TICKS} frames`);
  for (const f of inputs as InputFrame[]) {
    if (!Number.isInteger(f?.buttons) || !Number.isInteger(f?.yaw) || f.buttons < 0 || f.buttons > 255 || f.yaw < 0 || f.yaw > 255) {
      throw new Error("each input needs integer buttons and yaw in 0–255");
    }
  }
  return { scene, inputs: inputs as InputFrame[], hash: typeof r["finalStateHash"] === "number" ? r["finalStateHash"] : undefined,
    rapier: typeof r["rapierVersion"] === "string" ? r["rapierVersion"] : undefined,
    note: typeof r["note"] === "string" ? r["note"] : "" };
}

/** A Fixer edit, as written in an "umbra-fix" evidence file. */
interface EditMark { op: "add_floor" | "add_wall" | "remove"; x: number; y: number; z: number }

function parseEdits(raw: unknown): EditMark[] {
  if (!Array.isArray(raw) || raw.length > 64) throw new Error("edits must be an array of at most 64");
  return raw.map((e: Record<string, unknown>) => {
    if (!["add_floor", "add_wall", "remove"].includes(e?.["op"] as string) || ![e["x"], e["y"], e["z"]].every(Number.isInteger)) {
      throw new Error("each edit needs op add_floor|add_wall|remove and integer x, y, z");
    }
    return e as unknown as EditMark;
  });
}

async function simulate(title: string, raw: unknown): Promise<Loaded> {
  const { scene, inputs, hash, rapier, note } = parseReplay(raw);
  const sim = await createSimulation(scene);
  try {
    const player = [sim.position()];
    const platforms = [sim.platforms()];
    const crates = [sim.crates()];
    for (const frame of inputs) {
      if (sim.outcome !== "timeout") break;
      sim.step(frame);
      player.push(sim.position());
      platforms.push(sim.platforms());
      crates.push(sim.crates());
    }
    const result = sim.result();
    const verified = hash !== undefined && result.finalStateHash === hash;
    const reason = hash === undefined ? "No saved hash to compare"
      : verified ? `Reproduced exactly · hash ${hash}`
      : rapier && rapier !== scene.rapierVersion ? `Hash differs (recorded with Rapier ${rapier})`
      : `Hash differs: saved ${hash}, got ${result.finalStateHash}`;
    return { title, note, scene, player, platforms, crates, events: result.events, outcome: result.outcome, verified, reason };
  } finally { sim.dispose(); }
}

// ── 3D view ────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const view = new THREE.Scene();
view.background = new THREE.Color(0x0d1017);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
view.add(new THREE.HemisphereLight(0xdfe6f5, 0x2a2633, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(8, 20, 6);
view.add(sun);
const mats = {
  floor: new THREE.MeshStandardMaterial({ color: 0x6b6f80, roughness: 0.9 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x3e4252, roughness: 0.9, transparent: true, opacity: 0.55 }),
  platform: new THREE.MeshStandardMaterial({ color: 0x8a7bd8, roughness: 0.6 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.9 }),
  pit: new THREE.MeshBasicMaterial({ color: 0xff7a7a, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
  goal: new THREE.MeshStandardMaterial({ color: 0x6fdcb0, emissive: 0x2a9d74, wireframe: true }),
  player: new THREE.MeshStandardMaterial({ color: 0xffc36c, emissive: 0x6b4a14 }),
  event: new THREE.MeshBasicMaterial({ color: 0xff7a7a }),
};
const playerMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 12), mats.player);
let level = new THREE.Group();
let kit: KitView | undefined;
view.add(playerMesh);

function buildLevel(loaded: Loaded, edits: EditMark[]) {
  view.remove(level);
  // Frees the kit view's geometry too, along with the outlines, trail and event dots.
  level.traverse((o) => { if (o instanceof THREE.Line || o instanceof THREE.Mesh) o.geometry.dispose(); });
  level = new THREE.Group();
  kit = kitSceneView(loaded.scene, mats);
  level.add(kit.group);
  // Outline the cells the Fixer changed: green for added blocks, red for removed ones.
  for (const e of edits) {
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06)),
      new THREE.LineBasicMaterial({ color: e.op === "remove" ? 0xff7a7a : 0x6fdcb0 }));
    outline.position.set(e.x + 0.5, e.y + 0.5, e.z + 0.5);
    level.add(outline);
  }
  // The whole path as a trail, so a run can be read at a glance.
  const trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(loaded.player.map((p) => new THREE.Vector3(p.x, p.y - 0.6, p.z))),
    new THREE.LineBasicMaterial({ color: 0xffc36c, transparent: true, opacity: 0.7 }));
  level.add(trail);
  for (const e of loaded.events) {
    const at = e.pos ?? loaded.player[Math.min(e.tick + 1, loaded.player.length - 1)]!;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), mats.event);
    dot.position.set(at.x, Math.max(at.y, -2), at.z);
    level.add(dot);
  }
  view.add(level);
  // Frame the level from above and behind the spawn.
  const bounds = new THREE.Box3().setFromObject(level);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3()).length();
  controls.target.copy(center);
  camera.position.set(center.x + size * 0.45, center.y + size * 0.6, center.z - size * 0.55);
}

// ── playback ───────────────────────────────────────────────────────────────
let current: Loaded | undefined;
let fix: { before: Loaded; after: Loaded; edits: EditMark[] } | undefined;
let tick = 0;
let playing = false;
let last = performance.now();
let acc = 0;

function show(t: number) {
  if (!current) return;
  tick = Math.max(0, Math.min(t, current.player.length - 1));
  const p = current.player[tick]!;
  playerMesh.position.set(p.x, p.y, p.z);
  kit?.update({ platforms: current.platforms[tick]!, crates: current.crates[tick]! });
  ui.scrub.value = String(tick);
  ui.tick.textContent = `${tick} / ${current.player.length - 1}`;
  if (ui.follow.checked) controls.target.lerp(new THREE.Vector3(p.x, p.y, p.z), 0.2);
}

function setPlaying(on: boolean) {
  if (on && current && tick >= current.player.length - 1) show(0);
  playing = on && !!current;
  ui.play.textContent = playing ? "Pause" : "Play";
  ui.play.setAttribute("aria-label", playing ? "Pause" : "Play");
}

async function load(title: string, raw: unknown) {
  setPlaying(false);
  ui.title.textContent = `Loading ${title}…`;
  let loaded: Loaded;
  try {
    const r = raw as Record<string, unknown> | null;
    if (r?.["kind"] === "umbra-fix") {
      // Fix evidence: the failing run and the fixed run, both re-simulated and hash-checked.
      const edits = parseEdits(r["edits"]);
      fix = { edits, before: await simulate(`${title} · before`, r["before"]), after: await simulate(`${title} · after`, r["after"]) };
      ui.reason.textContent = typeof r["reason"] === "string" ? `Fixer: ${r["reason"].slice(0, 300)}` : "";
      ui.edits.replaceChildren(...edits.map((e) => Object.assign(document.createElement("li"),
        { className: e.op === "remove" ? "remove" : "add", textContent: `${e.op} (${e.x}, ${e.y}, ${e.z})` })));
      loaded = fix.before;
    } else {
      fix = undefined;
      loaded = await simulate(title, raw);
    }
  } catch (e) {
    fix = undefined;
    ui.fix.hidden = true;
    ui.title.textContent = `Could not load ${title}`;
    // Zod errors carry an issues list; show it as "path: message" lines.
    const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
    ui.note.textContent = (issues ? issues.map((i) => `${i.path.join(".") || "replay"}: ${i.message}`).join("; ")
      : String((e as Error).message ?? e)).slice(0, 400);
    ui.verify.textContent = ""; ui.verify.className = "badge";
    return;
  }
  ui.fix.hidden = !fix;
  present(loaded);
}

function present(loaded: Loaded) {
  setPlaying(false);
  current = loaded;
  ui.before.setAttribute("aria-pressed", String(fix?.before === loaded));
  ui.after.setAttribute("aria-pressed", String(fix?.after === loaded));
  ui.title.textContent = `${current.title} · ${current.outcome}`;
  ui.note.textContent = current.note;
  ui.verify.textContent = current.verified ? "✓ " + current.reason : "✗ " + current.reason;
  ui.verify.className = `badge ${current.verified ? "ok" : "bad"}`;
  ui.scrub.max = String(current.player.length - 1);
  ui.events.replaceChildren(...(current.events.length ? current.events.map((e) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `Tick ${e.tick}: ${e.kind.replace(/_/g, " ")}${e.goalId ? ` (${e.goalId})` : ""}`;
    b.addEventListener("click", () => { setPlaying(false); show(e.tick + 1); });
    li.append(b);
    return li;
  }) : [Object.assign(document.createElement("li"), { className: "sub", textContent: "No events." })]));
  buildLevel(current, fix?.edits ?? []);
  show(0);
  setPlaying(true);
}

async function loadUrl(title: string, url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load(title, await res.json());
  } catch (e) { await load(title, { error: String(e) }); }
}

ui.play.addEventListener("click", () => setPlaying(!playing));
ui.before.addEventListener("click", () => { if (fix) present(fix.before); });
ui.after.addEventListener("click", () => { if (fix) present(fix.after); });
ui.scrub.addEventListener("input", () => { setPlaying(false); show(Number(ui.scrub.value)); });
ui.file.addEventListener("change", async () => {
  const f = ui.file.files?.[0];
  if (!f) return;
  try { await load(f.name, JSON.parse(await f.text())); } catch (e) { await load(f.name, { error: String(e) }); }
  ui.file.value = "";
});
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
  if (e.code === "Space") { e.preventDefault(); setPlaying(!playing); }
  if (e.code === "ArrowRight") { setPlaying(false); show(tick + 1); }
  if (e.code === "ArrowLeft") { setPlaying(false); show(tick - 1); }
});
let depth = 0;
window.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; document.body.classList.add("dragging"); });
window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; document.body.classList.remove("dragging"); } });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault(); depth = 0; document.body.classList.remove("dragging");
  const f = e.dataTransfer?.files[0];
  if (!f) return;
  try { await load(f.name, JSON.parse(await f.text())); } catch (err) { await load(f.name, { error: String(err) }); }
});

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas.parentElement!;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement!);
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (playing && current) {
    acc += dt * 60 * Number(ui.speed.value);
    while (acc >= 1) { acc -= 1; show(tick + 1); }
    if (tick >= current.player.length - 1) setPlaying(false);
  } else acc = 0;
  if (current && ui.follow.checked && !playing) show(tick);
  controls.update();
  renderer.render(view, camera);
});

// ── startup: ?replay=<url>, else the bundled samples ───────────────────────
const samples: { file: string; title: string; note: string }[] =
  await fetch(`${import.meta.env.BASE_URL}replays/index.json`).then((r) => r.json()).catch(() => []);
for (const s of samples) {
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.type = "button";
  b.append(s.title, Object.assign(document.createElement("small"), { textContent: s.note }));
  b.addEventListener("click", () => {
    ui.samples.querySelectorAll("button").forEach((x) => x.removeAttribute("aria-current"));
    b.setAttribute("aria-current", "true");
    void loadUrl(s.title, `${import.meta.env.BASE_URL}replays/${s.file}`);
  });
  li.append(b);
  ui.samples.append(li);
}
const param = new URLSearchParams(location.search).get("replay");
if (param) void loadUrl(param.split("/").pop() ?? "replay", param);
else ui.samples.querySelector("button")?.click();
