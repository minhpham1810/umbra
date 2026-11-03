// `pnpm --filter @umbra/boo-and-co mcp`: the Umbra MCP tools over stdio, plus
// search.strategy for Boo & Co. mansions.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "umbra-agents";
import { mansionGame } from "../src/sim/balance.js";
import { MansionSchema } from "../src/sim/mansion.js";

await createServer({ strategy: { name: "Boo & Co.", schema: MansionSchema, adapt: mansionGame } }).connect(new StdioServerTransport());
