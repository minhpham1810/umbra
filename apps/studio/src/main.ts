/**
 * Studio: load a replay, re-simulate it with the real engine, check the final hash,
 * and play it back with a scrubber. Two formats:
 *  - "umbra-replay" files of any game in ./games.ts, drawn by the engine's own 3D or 2D view;
 *  - kit-scene replays and Fixer evidence (Lantern), with an orbit camera and a path trail.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createSceneView, kitSceneView, type KitView } from "umbra-engine/three";
import { SceneSchema, createSimulation, createSpriteView, type InputFrame, type Scene, type SimEvent } from "umbra-engine";
import { games } from "./games.js";
import { recordGameReplay } from "./game-replay.js";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>("#canvas3d");
const canvas2d = $<HTMLCanvasElement>("#canvas2d");
const ui = {
  samples: $("#samples"), events: $("#events"), title: $("#title"), note: $("#note"), verify: $("#verify"),
  play: $<HTMLButtonElement>("#play"), scrub: $<HTMLInputElement>("#scrub"), tick: $("#tick"),
  speed: $<HTMLSelectElement>("#speed"), follow: $<HTMLInputElement>("#follow"), file: $<HTMLInputElement>("#file"),
  fix: $("#fix"), before: $<HTMLButtonElement>("#show-before"), after: $<HTMLButtonElement>("#show-after"),
  reason: $("#fix-reason"), edits: $("#edits"), state: $("#state"),
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
  frameObject(level);
}

// ── playback ───────────────────────────────────────────────────────────────

/** A loaded run, whatever its format: what the scrubber, event list and badge need. */
interface Shown {
  title: string; note: string; outcome: string; verified: boolean; reason: string;
  /** Index of the last tick. */
  last: number;
  events: { tick: number; label: string }[];
  /** Draw tick `t` (0 = before the first step). */
  show(t: number): void;
  /** Render a frame; `follow` tracks the player, or uses the game's own camera. */
  frame(follow: boolean): void;
  /** Text for the state panel at tick `t`. */
  state(t: number): string;
  dispose(): void;
}

function kitShown(loaded: Loaded, edits: EditMark[]): Shown {
  buildLevel(loaded, edits);
  playerMesh.visible = true;
  return {
    ...loaded, last: loaded.player.length - 1,
    events: loaded.events.map((e) => ({ tick: e.tick + 1, label: `Tick ${e.tick}: ${e.kind.replace(/_/g, " ")}${e.goalId ? ` (${e.goalId})` : ""}` })),
    show(t) {
      const p = loaded.player[t]!;
      playerMesh.position.set(p.x, p.y, p.z);
      kit?.update({ platforms: loaded.platforms[t]!, crates: loaded.crates[t]! });
    },
    frame(follow) {
      const p = loaded.player[tick]!;
      if (follow) controls.target.lerp(new THREE.Vector3(p.x, p.y, p.z), 0.2);
      controls.update();
      renderer.render(view, camera);
    },
    state(t) { const p = loaded.player[t]!; return `player ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`; },
    dispose() {},
  };
}

/** Any game's replay, drawn by the engine's own views from the recorded world states. */
async function gameShown(title: string, raw: unknown): Promise<Shown> {
  const rec = await recordGameReplay(games, raw, MAX_TICKS);
  const note = typeof (raw as { note?: unknown }).note === "string" ? (raw as { note: string }).note : "";
  const states = rec.states;
  const show = (t: number) => rec.world.load(states[t]!);
  const base = {
    title: `${title} · ${rec.game}`, note, outcome: rec.outcome, verified: rec.verified, reason: rec.reason, last: states.length - 1,
    events: rec.events.map((e) => {
      const data = e.data === null || e.data === undefined ? "" : ` ${JSON.stringify(e.data)}`;
      return { tick: e.tick + 1, label: `Tick ${e.tick}: ${e.type}${data.length > 48 ? data.slice(0, 47) + "…" : data}` };
    }),
    state: (t: number) => {
      const s = states[t]!;
      return JSON.stringify({ tick: s.tick, entities: s.entities.length, resources: s.resources }, null, 2).slice(0, 2000);
    },
  };
  setCanvas(rec.view === "2d" ? "2d" : "3d");
  if (rec.view === "2d") {
    const ctx = canvas2d.getContext("2d")!;
    const sprites = createSpriteView(rec.world, ctx, { background: "#0d1017", pixelRatio: devicePixelRatio });
    return { ...base, show: (t) => { show(t); sprites.capture(); }, frame: () => sprites.draw(1), dispose: () => sprites.dispose() };
  }
  show(0);
  const scene = createSceneView(rec.world, { background: 0x0d1017, fallbackCamera: camera });
  // Games without lights would draw black; give them Studio's.
  if (!states.some((s) => s.components["light"]?.length)) scene.scene.add(new THREE.HemisphereLight(0xdfe6f5, 0x2a2633, 1.6));
  scene.sync(1);
  frameObject(scene.scene);
  return {
    ...base,
    show: (t) => { show(t); scene.capture(); },
    frame(follow) {
      scene.setAspect(camera.aspect);
      scene.sync(1);
      // Follow: the game's own active camera, when it has one; otherwise the orbit camera.
      const cam = follow ? scene.camera : camera;
      controls.update();
      renderer.render(scene.scene, cam);
    },
    dispose: () => scene.dispose(),
  };
}

function setCanvas(which: "2d" | "3d") {
  canvas.hidden = which !== "3d";
  canvas2d.hidden = which !== "2d";
  playerMesh.visible = false;
}

/** Point the orbit camera at an object from above and behind. */
function frameObject(o: THREE.Object3D) {
  const bounds = new THREE.Box3().setFromObject(o);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = Math.max(bounds.getSize(new THREE.Vector3()).length(), 4);
  controls.target.copy(center);
  camera.position.set(center.x + size * 0.45, center.y + size * 0.6, center.z - size * 0.55);
}

let current: Shown | undefined;
let fix: { before: Loaded; after: Loaded; edits: EditMark[] } | undefined;
let tick = 0;
let playing = false;
let last = performance.now();
let acc = 0;

function show(t: number) {
  if (!current) return;
  tick = Math.max(0, Math.min(t, current.last));
  current.show(tick);
  ui.scrub.value = String(tick);
  ui.tick.textContent = `${tick} / ${current.last}`;
  ui.state.textContent = current.state(tick);
}

function setPlaying(on: boolean) {
  if (on && current && tick >= current.last) show(0);
  playing = on && !!current;
  ui.play.textContent = playing ? "Pause" : "Play";
  ui.play.setAttribute("aria-label", playing ? "Pause" : "Play");
}

async function load(title: string, raw: unknown) {
  setPlaying(false);
  ui.title.textContent = `Loading ${title}…`;
  let next: Shown;
  try {
    const r = raw as Record<string, unknown> | null;
    if (r?.["format"] === "umbra-replay") {
      fix = undefined;
      next = await gameShown(title, raw);
    } else if (r?.["kind"] === "umbra-fix") {
      // Fix evidence: the failing run and the fixed run, both re-simulated and hash-checked.
      const edits = parseEdits(r["edits"]);
      fix = { edits, before: await simulate(`${title} · before`, r["before"]), after: await simulate(`${title} · after`, r["after"]) };
      ui.reason.textContent = typeof r["reason"] === "string" ? `Fixer: ${r["reason"].slice(0, 300)}` : "";
      ui.edits.replaceChildren(...edits.map((e) => Object.assign(document.createElement("li"),
        { className: e.op === "remove" ? "remove" : "add", textContent: `${e.op} (${e.x}, ${e.y}, ${e.z})` })));
      setCanvas("3d");
      next = kitShown(fix.before, edits);
    } else {
      fix = undefined;
      const loaded = await simulate(title, raw);
      setCanvas("3d");
      next = kitShown(loaded, []);
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
  present(next);
}

function present(next: Shown) {
  setPlaying(false);
  current?.dispose();
  current = next;
  ui.before.setAttribute("aria-pressed", String(fix?.before.title === next.title));
  ui.after.setAttribute("aria-pressed", String(fix?.after.title === next.title));
  ui.title.textContent = `${current.title} · ${current.outcome}`;
  ui.note.textContent = current.note;
  ui.verify.textContent = current.verified ? "✓ " + current.reason : "✗ " + current.reason;
  ui.verify.className = `badge ${current.verified ? "ok" : "bad"}`;
  ui.scrub.max = String(current.last);
  ui.events.replaceChildren(...(current.events.length ? current.events.slice(0, 500).map((e) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = e.label;
    b.addEventListener("click", () => { setPlaying(false); show(e.tick); });
    li.append(b);
    return li;
  }) : [Object.assign(document.createElement("li"), { className: "sub", textContent: "No events." })]));
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
ui.before.addEventListener("click", () => { if (fix) present(kitShown(fix.before, fix.edits)); });
ui.after.addEventListener("click", () => { if (fix) present(kitShown(fix.after, fix.edits)); });
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
  canvas2d.width = w * devicePixelRatio;
  canvas2d.height = h * devicePixelRatio;
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
    if (tick >= current.last) setPlaying(false);
  } else acc = 0;
  if (current) current.frame(ui.follow.checked);
  else { controls.update(); renderer.render(view, camera); }
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
