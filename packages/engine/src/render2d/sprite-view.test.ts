import { expect, it } from "vitest";
import { World } from "../core/world.js";
import { Camera2D, Sprite } from "../render/components.js";
import { Transform } from "../spatial/transform.js";
import { createSpriteView, type SpriteCtx } from "./sprite-view.js";

/** A fake context that tracks translate/rotate and records what it draws, in canvas pixels. */
function fakeCtx(width = 200, height = 100) {
  const calls: { op: string; x: number; y: number; angle: number; args: unknown[]; fill: unknown; alpha: number }[] = [];
  const stack: [number, number, number][] = [];
  let x = 0, y = 0, angle = 0;
  const rec = (op: string) => (...args: unknown[]) => calls.push({ op, x, y, angle, args, fill: ctx.fillStyle, alpha: ctx.globalAlpha });
  const ctx: SpriteCtx = {
    canvas: { width, height }, fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, font: "", textAlign: "", textBaseline: "",
    save: () => stack.push([x, y, angle]), restore: () => { [x, y, angle] = stack.pop()!; },
    translate: (dx, dy) => { x += dx * Math.cos(angle) - dy * Math.sin(angle); y += dx * Math.sin(angle) + dy * Math.cos(angle); },
    rotate: (a) => { angle += a; }, scale: () => {},
    fillRect: rec("fillRect"), strokeRect: rec("strokeRect"), clearRect: rec("clearRect"), beginPath: () => {},
    arc: rec("arc"), fill: () => {}, stroke: () => {}, fillText: rec("fillText"), drawImage: rec("drawImage"),
  };
  return { ctx, calls };
}

const world = () => new World({ seed: 0, components: [Transform, Sprite, Camera2D] });
const at = (x: number, y: number, angle = 0) => Transform({ position: { x, y, z: 0 }, rotation: { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) } });

it("draws sprites by layer, y up, centred on the active camera", () => {
  const w = world();
  w.spawn(at(1, 1), Sprite({ shape: { type: "rect", size: { x: 1, y: 2 } }, color: "#ff0000", layer: 1 }));
  w.spawn(at(0, 0), Sprite({ shape: { type: "circle", radius: 0.5 }, color: 0x00ff00 }));
  w.spawn(at(0, 0), Sprite({ shape: { type: "text", text: "hi", height: 1 }, visible: false }));
  w.spawn(at(1, 0), Camera2D({ zoom: 10 }));
  const { ctx, calls } = fakeCtx();
  const view = createSpriteView(w, ctx, { background: "#000000" });
  view.draw();
  expect(calls.map((c) => c.op)).toEqual(["fillRect", "arc", "fillRect"]); // background, then layer 0, then layer 1
  expect(calls[1]).toMatchObject({ x: 90, y: 50, fill: "#00ff00", args: [0, 0, 5, 0, 2 * Math.PI] });
  expect(calls[2]).toMatchObject({ x: 100, y: 40, fill: "#ff0000", args: [-5, -10, 10, 20] });
  expect(view.toWorld(100, 40)).toEqual({ x: 1, y: 1 });
});

it("draws between the last two ticks, turning the short way", () => {
  const w = world();
  const e = w.spawn(at(0, 0, 3), Sprite({ shape: { type: "rect", size: { x: 1, y: 1 } } }));
  const { ctx, calls } = fakeCtx();
  const view = createSpriteView(w, ctx, { zoom: 10 });
  view.capture();
  w.set(e, Transform, at(4, 0, -3).value as never);
  view.capture();
  view.draw(0.5);
  const drawn = calls.find((c) => c.op === "fillRect")!;
  expect(drawn.x).toBeCloseTo(120);
  expect(Math.abs(drawn.angle)).toBeCloseTo(Math.PI); // 3 → -3 rad goes through π, not through 0
});

it("draws images once loaded, with sprite-sheet frames", async () => {
  const w = world();
  w.spawn(at(0, 0), Sprite({ shape: { type: "image", asset: "hero.png", size: { x: 2, y: 2 }, frame: { x: 16, y: 0, w: 16, h: 16 } } }));
  const { ctx, calls } = fakeCtx();
  let loads = 0;
  const view = createSpriteView(w, ctx, { zoom: 10, images: async () => { loads++; return { width: 64, height: 16 }; } });
  view.draw();
  expect(calls.filter((c) => c.op === "drawImage")).toHaveLength(0);
  await Promise.resolve(); await Promise.resolve();
  view.draw();
  expect(calls.find((c) => c.op === "drawImage")!.args.slice(1)).toEqual([16, 0, 16, 16, -10, -10, 20, 20]);
  expect(loads).toBe(1);
});
