import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: { "@umbra/engine": new URL("../../packages/engine/src/index.ts", import.meta.url).pathname } },
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
