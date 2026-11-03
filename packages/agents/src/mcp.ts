/**
 * MCP server exposing the agent tool API (design doc "Agent API and tools").
 * Every input is Zod-validated; limits keep one call from hogging the process.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SceneSchema, Vec3Schema } from "umbra-engine";
import { searchStrategy, strategySummary, type PlanGame } from "./strategy.js";
import {
  sceneValidate, sceneWrite, simRun, simObserve, searchReach, replaySave, navBake, navPath,
} from "./tools/api.js";

const MAX_TICKS = 60 * 60 * 5; // five simulated minutes
const MAX_BUDGET = 2000; // sim runs per search

const InputFrameSchema = z.object({
  buttons: z.number().int().min(0).max(255),
  yaw: z.number().int().min(0).max(255),
});
const run = {
  scene: SceneSchema,
  seed: z.number().int().min(0).max(2 ** 32 - 1),
  inputs: z.array(InputFrameSchema).max(MAX_TICKS),
};

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

/** A build-placement game for search.strategy: how to validate its level files, and its adapter. */
export interface StrategyGame<T> { name: string; schema: z.ZodType<T>; adapt(level: T): PlanGame }

/** The Umbra tools. Pass `strategy` to also serve search.strategy for that game. */
export function createServer<T>(opts: { strategy?: StrategyGame<T> } = {}): McpServer {
  const server = new McpServer({ name: "umbra", version: "0.1.1" });

  server.registerTool("scene.validate", {
    description: "Check a scene against the schema. Returns {ok, errors[]}.",
    inputSchema: { scene: z.unknown() },
  }, ({ scene }) => {
    const r = sceneValidate(scene);
    return json(r.ok ? { ok: true, errors: [] } : r);
  });

  server.registerTool("scene.write", {
    description: "Validate and write a scene JSON file under UMBRA_SCENES_DIR. Returns {version, path}.",
    inputSchema: { path: z.string().min(1), scene: SceneSchema },
  }, async ({ path, scene }) => json(await sceneWrite(path, scene)));

  server.registerTool("nav.bake", {
    description: "Bake a navmesh from the scene's static pieces. Returns {navmeshId, islands[]}; the id lives until the server exits.",
    inputSchema: { scene: SceneSchema },
  }, async ({ scene }) => {
    const r = await navBake(scene);
    // Island polygon refs are bulky; agents need counts, not refs.
    return json({ navmeshId: r.navmeshId, islands: r.islands.map((i) => ({ id: i.id, polygons: i.polygonRefs.length })) });
  });

  server.registerTool("nav.path", {
    description: "Find a navmesh route between two floor-surface points. Returns {found, waypoints[]}.",
    inputSchema: { navmeshId: z.string(), from: Vec3Schema, to: Vec3Schema },
  }, ({ navmeshId, from, to }) => json(navPath(navmeshId, from, to)));

  server.registerTool("sim.run", {
    description: "Run the deterministic simulation. Returns {outcome, finalStateHash, events[]}.",
    inputSchema: { ...run, maxTicks: z.number().int().min(1).max(MAX_TICKS) },
  }, async ({ scene, seed, inputs, maxTicks }) => {
    const { outcome, finalStateHash, events } = await simRun(scene, seed, inputs, maxTicks);
    return json({ outcome, finalStateHash, events });
  });

  server.registerTool("sim.observe", {
    description: "Run to a tick and return a structured observation of the player and goals.",
    inputSchema: { ...run, atTick: z.number().int().min(0).max(MAX_TICKS) },
  }, async ({ scene, seed, inputs, atTick }) => json(await simObserve(scene, seed, inputs, atTick)));

  server.registerTool("search.reach", {
    description: "Search for inputs that reach a goal (navmesh route, steering, jump timings). budget = max sim runs. Returns {reached, inputs[], attempts}.",
    inputSchema: { scene: SceneSchema, goal: z.string(), budget: z.number().int().min(1).max(MAX_BUDGET) },
  }, async ({ scene, goal, budget }) => json(await searchReach(scene, goal, budget)));

  const game = opts.strategy;
  if (game) {
    // Cast: the SDK's input-shape typing does not accept a generic Zod type here.
    server.registerTool("search.strategy", {
      description: `Search ${game.name} build plans for a level. budget = sim runs. Returns {quotaReachable, bestPlan, bestByPool, dominantStrategies, deadlocks}.`,
      inputSchema: { level: game.schema as z.ZodTypeAny, budget: z.number().int().min(3).max(MAX_BUDGET) },
    }, ({ level, budget }) => json(strategySummary(searchStrategy(game.adapt(level as T), { budget }))));
  }

  server.registerTool("replay.save", {
    description: "Run and save a replay under UMBRA_REPLAYS_DIR. Returns {replayId}.",
    inputSchema: { ...run, note: z.string().max(500).optional() },
  }, async ({ scene, seed, inputs, note }) => json({ replayId: await replaySave(scene, seed, inputs, note) }));

  return server;
}
