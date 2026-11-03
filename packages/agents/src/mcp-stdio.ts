// Entry point: `pnpm --filter @umbra/agents mcp` serves the Umbra tools over stdio.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp.js";

await createServer().connect(new StdioServerTransport());
