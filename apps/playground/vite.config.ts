import { defineConfig } from "vite";

const engine = (path: string) => new URL(`../../packages/engine/src/${path}`, import.meta.url).pathname;
export default defineConfig({
  // Subpaths first: aliases match by prefix, in order.
  resolve: { alias: {
    "umbra-engine/three": engine("render3d/three.ts"),
    "umbra-engine/runtime": engine("runtime/index.ts"),
    "umbra-engine": engine("index.ts"),
  } },
  build: { target: "es2022" }, // top-level await
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
