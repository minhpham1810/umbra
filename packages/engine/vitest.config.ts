import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // Allow experimental WASM modules needed by Rapier.
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--experimental-wasm-modules"],
      },
    },
  },
});
