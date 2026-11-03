import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: { "@umbra/engine": new URL("../../packages/engine/src/index.ts", import.meta.url).pathname } },
  build: { target: "es2022" }, // top-level await in main.ts
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
