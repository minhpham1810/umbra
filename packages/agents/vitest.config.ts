import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@umbra/engine": new URL("../engine/src/index.ts", import.meta.url).pathname } },
});
