/**
 * Canvas 2D views of the engine's two sims: a side view of a kit scene (platformers) and
 * a top-down view of a mansion. Drawing only; the sims are untouched, so replays and
 * state hashes are the same whether a game draws in 2D or 3D.
 */
import { CRATE_HALF, PLATFORM_HALF_Y } from "../physics/world.js";
import type { Scene } from "../scene/schema.js";
import type { Build, Mansion } from "../mansion/mansion.js";

/**
 * The slice of CanvasRenderingContext2D the views use, spelled out so the engine still
 * compiles without DOM types (agents run in Node). A real 2D context fits; so does a test fake.
 */
export interface Ctx2D {
  fillStyle: unknown; strokeStyle: unknown; lineWidth: number; globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; fill(): void; stroke(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): { addColorStop(offset: number, color: string): void };
}

/** World to screen: screen = (u, v) × scale + offset. Side views pass v = -y so up is up. */
export interface View2D { scale: number; ox: number; oy: number }

/** A view of `scale` px per metre centred on world (u, v). */
export const centerView = (w: number, h: number, u: number, v: number, scale: number): View2D =>
  ({ scale, ox: w / 2 - u * scale, oy: h / 2 - v * scale });

/** The largest view that fits a cols × rows grid, with `pad` px around it. */
export function fitView(w: number, h: number, cols: number, rows: number, pad = 16): View2D {
  const scale = Math.max(1, Math.min((w - 2 * pad) / cols, (h - 2 * pad) / rows));
  return centerView(w, h, cols / 2, rows / 2, scale);
}

/** Screen pixel back to world (u, v), e.g. to turn a click into a grid cell. */
export const toWorld = (view: View2D, px: number, py: number) =>
  ({ u: (px - view.ox) / view.scale, v: (py - view.oy) / view.scale });

// ── side view of a kit scene ────────────────────────────────────────────────

/** A scene's static blocks seen from the side: the corridor's long axis runs left to right. */
export interface SideLayout {
  /** World axis drawn left to right; the other horizontal axis is depth, flattened. */
  axis: "x" | "z";
  /** Yaw (0–255) that walks toward +axis; +128 walks back. */
  yawRight: number;
  /** One cell per (u, y) column of blocks; `fill` is the share of the corridor's depth that is solid. */
  cells: { u: number; y: number; fill: number; wall: boolean }[];
  goals: { u: number; y: number }[];
}

export function sideLayout(scene: Scene): SideLayout {
  const floor = scene.pieces.filter((p) => p.kind === "floor");
  const span = (k: "x" | "z") => Math.max(...floor.map((p) => p.pos[k])) - Math.min(...floor.map((p) => p.pos[k]));
  const axis = span("z") >= span("x") ? "z" : "x";
  const d = axis === "z" ? "x" : "z";
  const [d0, d1] = [Math.min(...floor.map((p) => p.pos[d])), Math.max(...floor.map((p) => p.pos[d]))];
  const cells = new Map<string, SideLayout["cells"][number]>();
  for (const p of scene.pieces) {
    // Side walls lie outside the floor's depth and would hide everything; holes show as partial fill.
    if (p.kind === "pit" || p.kind === "moving_platform" || p.kind === "crate" || p.pos[d] < d0 || p.pos[d] > d1) continue;
    const key = `${p.pos[axis]},${p.pos.y}`;
    const c = cells.get(key) ?? { u: p.pos[axis], y: p.pos.y, fill: 0, wall: false };
    c.fill += 1 / (d1 - d0 + 1);
    c.wall ||= p.kind === "wall";
    cells.set(key, c);
  }
  return { axis, yawRight: axis === "z" ? 0 : 64, cells: [...cells.values()],
    goals: scene.goals.map((g) => ({ u: g.pos[axis], y: g.pos.y })) };
}

export interface SideFrame {
  player: { x: number; y: number; z: number };
  platforms: readonly { x: number; y: number; z: number }[];
  /** Crate centres; ones off the player's lane are drawn faint, since depth is flattened. */
  crates?: readonly { x: number; y: number; z: number }[];
}

/** Draw a side view (Lantern's palette): blocks, platforms, goals, and the player with a lantern glow. */
export function drawSceneSide(ctx: Ctx2D, size: { w: number; h: number }, layout: SideLayout, frame: SideFrame, view: View2D) {
  const s = view.scale;
  const rect = (u: number, top: number, w: number, h: number) => [u * s + view.ox, -top * s + view.oy, w * s, h * s] as const;
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#080b12";
  ctx.fillRect(0, 0, size.w, size.h);
  for (const c of layout.cells) {
    ctx.globalAlpha = 0.25 + 0.75 * Math.min(1, c.fill);
    ctx.fillStyle = c.wall ? "#343744" : "#555564";
    ctx.fillRect(...rect(c.u, c.y + 1, 1 + 0.5 / s, 1 + 0.5 / s)); // overlap half a pixel so no seams show
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#6a6a7c";
  for (const p of frame.platforms) ctx.fillRect(...rect(p[layout.axis] - 0.5, p.y + PLATFORM_HALF_Y, 1, 2 * PLATFORM_HALF_Y));
  const depth = layout.axis === "z" ? "x" : "z";
  ctx.fillStyle = "#8a6a44";
  for (const c of frame.crates ?? []) {
    ctx.globalAlpha = Math.abs(c[depth] - frame.player[depth]) < CRATE_HALF + 0.3 ? 1 : 0.3;
    ctx.fillRect(...rect(c[layout.axis] - CRATE_HALF, c.y + CRATE_HALF, 2 * CRATE_HALF, 2 * CRATE_HALF));
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#72e5be";
  ctx.lineWidth = Math.max(1, s / 16);
  for (const g of layout.goals) ctx.strokeRect(...rect(g.u, g.y + 1, 1, 1));
  const px = frame.player[layout.axis] * s + view.ox, py = -frame.player.y * s + view.oy;
  const glow = ctx.createRadialGradient(px, py, 0, px, py, 5 * s);
  glow.addColorStop(0, "rgba(255, 195, 108, 0.35)");
  glow.addColorStop(1, "rgba(255, 195, 108, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(px - 5 * s, py - 5 * s, 10 * s, 10 * s);
  ctx.fillStyle = "#c8c4b5";
  ctx.fillRect(...rect(frame.player[layout.axis] - 0.3, frame.player.y + 0.7, 0.6, 1.4)); // capsule(0.4, 0.3)
}

// ── top-down view of a mansion ──────────────────────────────────────────────

export interface MansionFrame {
  /** Visitor positions in cells; may be fractional while a game eases them between tiles. */
  visitors: readonly { x: number; y: number; fear: number; fleeing: boolean }[];
  builds: readonly Pick<Build, "kind" | "x" | "y">[];
  /** Highlight `range` tiles around a hovered cell. */
  hover?: { x: number; y: number; range: number };
}

const TILE = { ".": "#fff3e4", "#": "#c9b3e6", E: "#a8e6cf", X: "#ffd38a" } as const;

/** Draw a mansion from above (Boo & Co.'s palette): tiles, the hover range, builds and visitors. */
export function drawMansionTop(ctx: Ctx2D, size: { w: number; h: number }, mansion: Mansion, frame: MansionFrame, view: View2D) {
  const s = view.scale;
  const at = (x: number, y: number) => [x * s + view.ox, y * s + view.oy] as const;
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fbe9e1";
  ctx.fillRect(0, 0, size.w, size.h);
  mansion.tiles.forEach((row, y) => [...row].forEach((t, x) => {
    ctx.fillStyle = TILE[t as keyof typeof TILE];
    ctx.fillRect(...at(x, y), s + 0.5, s + 0.5); // overlap half a pixel so no seams show
  }));
  if (frame.hover) {
    const { x, y, range } = frame.hover;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#8f7ae6";
    ctx.fillRect(...at(x - range, y - range), (2 * range + 1) * s, (2 * range + 1) * s);
    ctx.globalAlpha = 1;
  }
  const dot = (x: number, y: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(...at(x + 0.5, y + 0.5), r * s, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const b of frame.builds) {
    if (b.kind === "trap") { dot(b.x, b.y, 0.34, "#ef7b8c"); continue; }
    dot(b.x, b.y, 0.32, "#ffffff");
    ctx.strokeStyle = "#8f7ae6";
    ctx.lineWidth = Math.max(1, s / 12);
    ctx.stroke();
  }
  for (const v of frame.visitors) dot(v.x, v.y, 0.22, v.fleeing ? "#ff9fb2" : v.fear > 0 ? "#b9a7f0" : "#7ec8e3");
}
