/**
 * MCP server exposing the agent tool API (design doc "Agent API and tools").
 * Every input is Zod-validated; limits keep one call from hogging the process.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SceneSchema, Vec3Schema } from "umbra-engine";
import { GameReplaySchema, runGame, verifyReplay } from "umbra-engine";
import { searchStrategy, strategySummary, type PlanGame } from "./strategy.js";
import { observeAt, playtestGame, searchOutcome, type AgentGame } from "./game.js";
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

/**
 * The Umbra tools. Pass `games` to serve the game.* tools for games made with defineGame,
 * and `strategy` to also serve search.strategy for a build-placement game.
 */
export function createServer<T>(opts: { strategy?: StrategyGame<T>; games?: readonly AgentGame[] } = {}): McpServer {
  const server = new McpServer({ name: "umbra", version: "0.1.1" });
  if (opts.games?.length) registerGameTools(server, opts.games);

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

const MAX_EVENTS = 500;

/** game.* tools: any registered game, by name. Levels and inputs are checked by the game's own schemas. */
function registerGameTools(server: McpServer, games: readonly AgentGame[]) {
  const byName = new Map(games.map((g) => [g.game.name, g]));
  const entry = (name: string) => {
    const g = byName.get(name);
    if (!g) throw new Error(`unknown game "${name}"; known: ${[...byName.keys()].join(", ")}`);
    return g;
  };
  /** A string naming one of the game's levels means that level; anything else is the level itself. */
  const levelOf = (g: AgentGame, level: unknown) => (typeof level === "string" && g.levels && level in g.levels ? g.levels[level] : level);
  const target = { game: z.string(), level: z.unknown().describe("the level's data, or the name of a level from game.list"),
    seed: z.number().int().min(0).max(2 ** 32 - 1).default(0) };
  const inputs = z.array(z.unknown()).max(MAX_TICKS).describe("one input per tick, in the game's input format");

  server.registerTool("game.list", {
    description: "List the games these tools can run: name, version, named levels, and the moves searches use.",
    inputSchema: {},
  }, () => json(games.map((g) => ({ name: g.game.name, version: g.game.version, levels: Object.keys(g.levels ?? {}), moves: g.moves, hold: g.hold ?? 1 }))));

  server.registerTool("game.run", {
    description: "Run a game on a level with one input per tick. Returns {outcome, ticks, finalStateHash, events[]} (outcome null if the inputs ran out first).",
    inputSchema: { ...target, inputs },
  }, async ({ game, level, seed, inputs }) => {
    const g = entry(game);
    const r = await runGame(g.game, levelOf(g, level), { seed, inputs: inputs.map((i) => g.game.input.parse(i)) });
    return json({ outcome: r.outcome ?? null, ticks: r.ticks, finalStateHash: r.finalStateHash,
      events: r.events.slice(0, MAX_EVENTS), ...(r.events.length > MAX_EVENTS ? { eventsTruncated: r.events.length } : {}) });
  });

  server.registerTool("game.observe", {
    description: "Run to a tick and return the state as JSON: entities with their components, resources, and that tick's events.",
    inputSchema: { ...target, inputs, atTick: z.number().int().min(0).max(MAX_TICKS),
      components: z.array(z.string()).max(64).optional().describe("only these components (default all non-presentation ones)") },
  }, async ({ game, level, seed, inputs, atTick, components }) => {
    const g = entry(game);
    return json(await observeAt(g.game, levelOf(g, level), { seed, atTick, inputs: inputs.map((i) => g.game.input.parse(i)), ...(components ? { components } : {}) }));
  });

  server.registerTool("game.search", {
    description: "Search for inputs that reach an outcome (beam search from checkpoints). budget = simulated ticks. Returns {found, inputs[], otherOutcomes, simulatedTicks}; found routes are re-run from scratch.",
    inputSchema: { ...target, outcome: z.string().default("win"), budget: z.number().int().min(1).max(MAX_TICKS * 20).default(100_000),
      maxTicks: z.number().int().min(1).max(MAX_TICKS).default(3000) },
  }, async ({ game, level, seed, outcome, budget, maxTicks }) => {
    const g = entry(game);
    return json(await searchOutcome(g, levelOf(g, level), { target: outcome, seed, budget, maxTicks }));
  });

  server.registerTool("game.playtest", {
    description: "Playtest a level: random play-throughs check for crashes, nondeterminism and checkpoint bugs; a search checks each expected outcome is reachable. Returns {findings[], reached[] (replays)}.",
    inputSchema: { ...target, expect: z.array(z.string()).max(8).default(["win"]), budget: z.number().int().min(1).max(MAX_TICKS * 20).default(100_000) },
  }, async ({ game, level, seed, expect, budget }) => {
    const g = entry(game);
    return json(await playtestGame(g, levelOf(g, level), { seed, expect, budget }));
  });

  server.registerTool("game.replay.verify", {
    description: "Re-run an umbra-replay file and check it reproduces its final hash. Returns {ok, reason, outcome, ticks}.",
    inputSchema: { replay: z.unknown() },
  }, async ({ replay }) => {
    const r = GameReplaySchema.parse(replay);
    const v = await verifyReplay(entry(r.game).game, r);
    return json({ ok: v.ok, reason: v.reason, outcome: v.result.outcome ?? null, ticks: v.result.ticks });
  });
}
