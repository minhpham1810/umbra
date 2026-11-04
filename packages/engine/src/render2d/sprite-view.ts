/**
 * A Canvas 2D view of a world's Sprite and Camera2D components: the 2D counterpart of the
 * Three.js scene view. World y points up; a Transform's turn about z rotates its sprite.
 *
 * Call capture() after each tick and draw(alpha) each frame: sprites are drawn between the
 * last two ticks, so motion is smooth at any frame rate. The view only reads the world.
 */
import type { Entity, World } from "../core/world.js";
import { Camera2D, Sprite } from "../render/components.js";
import { trackPoses, type Pose } from "../render/poses.js";
import { Transform } from "../spatial/transform.js";

/** The slice of CanvasRenderingContext2D the view uses (so the engine compiles without DOM types). */
export interface SpriteCtx {
  readonly canvas: { width: number; height: number };
  fillStyle: unknown; strokeStyle: unknown; lineWidth: number; globalAlpha: number;
  font: string; textAlign: string; textBaseline: string;
  save(): void; restore(): void;
  translate(x: number, y: number): void; rotate(angle: number): void; scale(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; arc(x: number, y: number, r: number, start: number, end: number): void; fill(): void; stroke(): void;
  fillText(text: string, x: number, y: number): void;
  drawImage(image: never, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
}

/** An image the context can draw, with its pixel size. */
export interface SpriteImage { width: number; height: number }

export interface SpriteViewOptions {
  /** Loads image assets. Default: an HTML Image from the asset's URL (in a browser). */
  images?(asset: string): Promise<SpriteImage>;
  /** Canvas fill before drawing; default transparent. */
  background?: string;
  /** Zoom (pixels per world unit) when no entity has an active Camera2D. Default 32. */
  zoom?: number;
  /** Multiplies every zoom, e.g. devicePixelRatio when the canvas is sized in device pixels. */
  pixelRatio?: number;
}

export interface SpriteView {
  /** Record transforms after a tick, for smoothing. */
  capture(): void;
  /** Draw the world between the last two ticks (alpha 0 = previous, 1 = latest). */
  draw(alpha?: number): void;
  /** Canvas pixel → world point, using the camera of the last draw (e.g. for clicks). */
  toWorld(px: number, py: number): { x: number; y: number };
  dispose(): void;
}

const css = (c: string | number) => (typeof c === "number" ? `#${c.toString(16).padStart(6, "0")}` : c);
/** The turn about z of a quaternion (exact for 2D rotations). */
const angleOf = (p: Pose) => 2 * Math.atan2(p.rotation.z, p.rotation.w);
const lerpAngle = (a: number, b: number, t: number) => {
  const d = ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * t;
};

export function createSpriteView(world: World, ctx: SpriteCtx, opts: SpriteViewOptions = {}): SpriteView {
  const poses = trackPoses(world);
  const load = opts.images ?? ((asset: string) => {
    const Img = (globalThis as { Image?: new () => SpriteImage & { src: string; decode(): Promise<void> } }).Image;
    if (!Img) return Promise.reject(new Error(`no image loader for "${asset}": pass opts.images`));
    const img = new Img();
    img.src = asset;
    return img.decode().then(() => img);
  });
  const images = new Map<string, SpriteImage | "loading" | "failed">();
  const image = (asset: string) => {
    const got = images.get(asset);
    if (got === undefined) {
      images.set(asset, "loading");
      load(asset).then((img) => images.set(asset, img), (err: unknown) => {
        images.set(asset, "failed");
        console.error(`image "${asset}" failed to load:`, err);
      });
    }
    return typeof got === "object" ? got : undefined;
  };
  const ratio = opts.pixelRatio ?? 1;
  let cam = { x: 0, y: 0, zoom: (opts.zoom ?? 32) * ratio };

  const at = (e: Entity, t: number) => {
    const ab = poses.between(e);
    if (!ab) return undefined;
    const [a, b] = ab;
    return { x: a.position.x + (b.position.x - a.position.x) * t, y: a.position.y + (b.position.y - a.position.y) * t, angle: lerpAngle(angleOf(a), angleOf(b), t) };
  };

  return {
    capture: poses.capture,
    draw(alpha = 1) {
      const t = Math.min(1, Math.max(0, alpha));
      const { width: W, height: H } = ctx.canvas;
      cam = { x: 0, y: 0, zoom: (opts.zoom ?? 32) * ratio };
      for (const [e, c] of world.query(Camera2D, Transform)) {
        if (!c.active) continue;
        const p = at(e, t)!;
        cam = { x: p.x, y: p.y, zoom: c.zoom * ratio };
        break;
      }
      ctx.save();
      ctx.globalAlpha = 1;
      if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, W, H); } else ctx.clearRect(0, 0, W, H);
      const z = cam.zoom;
      const list = [...world.query(Sprite, Transform)].filter(([, s]) => s.visible).sort(([a, s], [b, r]) => s.layer - r.layer || a - b);
      for (const [e, s] of list) {
        const p = at(e, t)!;
        ctx.save();
        ctx.translate(W / 2 + (p.x - cam.x) * z, H / 2 - (p.y - cam.y) * z);
        ctx.rotate(-p.angle);
        if (s.offset) ctx.translate(s.offset.x * z, -s.offset.y * z);
        if (s.flipX || s.flipY) ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
        ctx.globalAlpha = s.opacity;
        ctx.fillStyle = css(s.color);
        const outline = s.stroke && ((draw: () => void) => { ctx.strokeStyle = css(s.stroke!.color); ctx.lineWidth = s.stroke!.width * z; draw(); });
        const sh = s.shape;
        if (sh.type === "rect") {
          const w = sh.size.x * z, h = sh.size.y * z;
          ctx.fillRect(-w / 2, -h / 2, w, h);
          outline?.(() => ctx.strokeRect(-w / 2, -h / 2, w, h));
        } else if (sh.type === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, sh.radius * z, 0, 2 * Math.PI);
          ctx.fill();
          outline?.(() => ctx.stroke());
        } else if (sh.type === "image") {
          const img = image(sh.asset);
          const f = sh.frame ?? (img && { x: 0, y: 0, w: img.width, h: img.height });
          const w = sh.size.x * z, h = sh.size.y * z;
          if (img && f) ctx.drawImage(img as never, f.x, f.y, f.w, f.h, -w / 2, -h / 2, w, h);
        } else {
          ctx.font = `${sh.height * z}px ${sh.font}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(sh.text, 0, 0);
        }
        ctx.restore();
      }
      ctx.restore();
    },
    toWorld(px, py) {
      const { width: W, height: H } = ctx.canvas;
      return { x: cam.x + (px - W / 2) / cam.zoom, y: cam.y - (py - H / 2) / cam.zoom };
    },
    dispose() { images.clear(); },
  };
}
