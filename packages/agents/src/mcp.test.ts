import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./mcp.js";

const lantern = JSON.parse(readFileSync(new URL("../../../games/lantern/src/level.json", import.meta.url), "utf8"));
const client = new Client({ name: "test", version: "0" });

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(a);
  await client.connect(b);
});
afterAll(() => client.close());

async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] };
  return { isError: r.isError === true, text: r.content[0]!.text, value: r.isError ? undefined : JSON.parse(r.content[0]!.text) };
}

it("lists every design-doc tool except search.strategy", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(["nav.bake", "nav.path", "replay.save", "scene.validate",
    "scene.write", "search.reach", "sim.observe", "sim.run"]);
});

it("validates scenes and reports errors", async () => {
  expect((await call("scene.validate", { scene: lantern })).value).toEqual({ ok: true, errors: [] });
  const bad = (await call("scene.validate", { scene: { pieces: "nope" } })).value;
  expect(bad.ok).toBe(false);
  expect(bad.errors.length).toBeGreaterThan(0);
});

it("runs, observes and searches Lantern through MCP", async () => {
  const inputs = Array.from({ length: 30 }, () => ({ buttons: 1, yaw: 0 }));
  const run = (await call("sim.run", { scene: lantern, seed: 0, inputs, maxTicks: 30 })).value;
  expect(run.outcome).toBe("timeout");
  expect(typeof run.finalStateHash).toBe("number");
  const obs = (await call("sim.observe", { scene: lantern, seed: 0, inputs, atTick: 30 })).value;
  expect(obs.tick).toBe(30);
  const reach = (await call("search.reach", { scene: lantern, goal: "exit", budget: 200 })).value;
  expect(reach.reached).toBe(true);
}, 60_000);

it("bakes a navmesh and keeps its id for nav.path", async () => {
  const { navmeshId, islands } = (await call("nav.bake", { scene: lantern })).value;
  expect(islands.length).toBeGreaterThan(1); // the gap splits the floor
  const path = (await call("nav.path", { navmeshId, from: { x: 0.5, y: 1, z: 1.5 }, to: { x: 0.5, y: 1, z: 4.5 } })).value;
  expect(path.found).toBe(true);
});

it("rejects bad inputs and paths that escape the scenes dir", async () => {
  expect((await call("sim.run", { scene: lantern, seed: 0, inputs: [{ buttons: 999, yaw: 0 }], maxTicks: 1 })).isError).toBe(true);
  expect((await call("sim.run", { scene: lantern, seed: 0, inputs: [], maxTicks: 10 ** 9 })).isError).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), "umbra-scenes-"));
  process.env["UMBRA_SCENES_DIR"] = dir;
  try {
    const escape = await call("scene.write", { path: "../evil.json", scene: lantern });
    expect(escape.isError).toBe(true);
    expect(escape.text).toMatch(/inside/);
    expect((await call("scene.write", { path: "x.txt", scene: lantern })).isError).toBe(true);
    const ok = (await call("scene.write", { path: "levels/a.json", scene: lantern })).value;
    expect(JSON.parse(await readFile(ok.path, "utf8")).goals[0].id).toBe("exit");
  } finally { delete process.env["UMBRA_SCENES_DIR"]; }
});
