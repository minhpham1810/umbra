import { expect, it } from "vitest";
import { SceneSchema } from "../scene/schema.js";
import { centerView, drawGridTop, drawSceneSide, fitView, sideLayout, toWorld, type Ctx2D } from "./render2d.js";

/** Records fillRect calls; everything else is a no-op. */
function fakeCtx() {
  const rects: number[][] = [];
  const ctx: Ctx2D = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1,
    fillRect: (...a) => { rects.push(a); }, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  return { ctx, rects };
}

// A 3-wide corridor along z with side walls, one pit cell, and an end wall.
const pieces = [];
for (let z = 0; z < 6; z++) for (let x = 0; x < 3; x++) pieces.push({ kind: z === 2 && x === 1 ? "pit" : "floor", pos: { x, y: 0, z } });
for (let z = 0; z < 6; z++) for (const x of [-1, 3]) pieces.push({ kind: "wall", pos: { x, y: 1, z } });
for (let x = 0; x < 3; x++) pieces.push({ kind: "wall", pos: { x, y: 1, z: 6 } });
const scene = SceneSchema.parse({ pieces, spawn: { pos: { x: 1.5, y: 1.72, z: 0.5 } }, goals: [{ id: "exit", kind: "exit", pos: { x: 1, y: 1, z: 5 } }] });

it("lays a corridor out along its long axis, without side walls, holes as partial fill", () => {
  const layout = sideLayout(scene);
  expect(layout.axis).toBe("z");
  const cell = (u: number, y: number) => layout.cells.find((c) => c.u === u && c.y === y);
  expect(cell(0, 0)?.fill).toBeCloseTo(1);
  expect(cell(2, 0)?.fill).toBeCloseTo(2 / 3);
  expect(cell(0, 1)).toBeUndefined(); // side walls are outside the floor's depth
  expect(cell(6, 1)).toMatchObject({ wall: true, fill: 1 });
  expect(layout.goals).toEqual([{ u: 5, y: 1 }]);
});

it("maps screen pixels back to world cells", () => {
  const view = centerView(800, 600, 3, -1, 40);
  expect(toWorld(view, 400, 300)).toEqual({ u: 3, v: -1 });
  const fit = fitView(500, 300, 10, 5, 0);
  expect(fit.scale).toBe(50);
  expect(toWorld(fit, 0, 25)).toEqual({ u: 0, v: 0 });
});

it("draws both views", () => {
  const side = fakeCtx();
  drawSceneSide(side.ctx, { w: 800, h: 600 }, sideLayout(scene), { player: { x: 1.5, y: 1.7, z: 0.5 }, platforms: [] }, centerView(800, 600, 0.5, -1.7, 40));
  expect(side.rects.length).toBe(1 + sideLayout(scene).cells.length + 2); // background, blocks, glow, player
  const grid = { tiles: ["#E#", "#.#", "#X#"], colors: { "#": "#000", ".": "#fff" }, background: "#eee" };
  const top = fakeCtx();
  drawGridTop(top.ctx, { w: 300, h: 300 }, grid, { markers: [{ x: 1, y: 1, radius: 0.3, fill: "#f00" }], hover: { x: 1, y: 1, range: 1, color: "#00f" } }, fitView(300, 300, 3, 3));
  expect(top.rects.length).toBe(1 + 7 + 1); // background, the 7 tiles with a colour, hover
});
