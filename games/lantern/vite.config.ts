import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: {
    // The subpath first: aliases match by prefix, in order.
    "@umbra/engine/three": new URL("../../packages/engine/src/render3d/three.ts", import.meta.url).pathname,
    "@umbra/engine": new URL("../../packages/engine/src/index.ts", import.meta.url).pathname,
  } },
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
