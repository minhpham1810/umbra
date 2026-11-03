import { defineConfig } from 'vite';
export default defineConfig({
  resolve: { alias: { '@umbra/engine': new URL('../../packages/engine/src/index.ts', import.meta.url).pathname } },
  build: { rollupOptions: { output: { manualChunks(id) { if (id.includes("@dimforge/rapier3d-compat")) return "physics"; if (id.includes("/three/")) return "rendering"; } } }, chunkSizeWarningLimit: 2200 },
});
