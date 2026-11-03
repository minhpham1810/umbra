import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: {
    "@umbra/engine": new URL("../../packages/engine/src/index.ts", import.meta.url).pathname,
    "@umbra/agents": new URL("../../packages/agents/src/index.ts", import.meta.url).pathname,
  } },
});
