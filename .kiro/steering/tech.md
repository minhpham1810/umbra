# Umbra — Tech Steering

## Stack

- **Language:** TypeScript strict mode, one codebase for Node and browser.
- **Monorepo:** pnpm workspaces — `packages/engine`, `packages/agents`, `games/*`, `apps/studio`.
- **Physics:** `@dimforge/rapier3d` **pinned to 0.12.0**. Never upgrade without invalidating replays and bumping the benchmark.
- **Rendering:** Three.js for drawing only. Physics and rendering share NO math.
- **Navigation:** `recast-navigation` + `@recast-navigation/three`.
- **Schemas:** Zod. All scene JSON is validated before use.
- **Build:** Vite for games/studio; tsup for packages.
- **Tests:** Vitest + fast-check. Playwright for the browser hash check.
- **Lint:** ESLint determinism rules on `src/sim/`.

## Commands

```sh
pnpm install          # install all deps
pnpm build            # build all packages and apps
pnpm test             # run all tests
pnpm typecheck        # tsc --noEmit everywhere
pnpm lint             # eslint
```
