#!/usr/bin/env node
// Entry point: `pnpm --filter umbra-agents mcp`, or the `umbra-mcp` bin, serves the Umbra tools over stdio.
// `umbra-mcp --games ./agent-games.js` also serves the game.* tools for the games that module
// exports (as `games` or its default export: a list of AgentGame).
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp.js";
import type { AgentGame } from "./game.js";

const at = process.argv.indexOf("--games");
const path = at >= 0 ? process.argv[at + 1] : undefined;
if (at >= 0 && !path) throw new Error("--games needs a module path");
const mod = path ? (await import(pathToFileURL(resolve(path)).href)) as { games?: AgentGame[]; default?: AgentGame[] } : undefined;
const games = mod?.games ?? mod?.default;
if (mod && !Array.isArray(games)) throw new Error(`${path} must export a list of games as "games" or its default export`);
await createServer({ ...(games ? { games } : {}) }).connect(new StdioServerTransport());
