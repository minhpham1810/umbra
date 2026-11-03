# Eclipse Run

A five-chapter, single-player 3D platform adventure built with Umbra, Rapier and Three.js. Collect three light fragments and touch the portal in each chapter to restore the constellation. Includes keyboard and touch controls, chapter selection, pause/restart, synthesized optional sound, personal bests and local progress.

## Run

From the repository root, with Node.js 20+ and pnpm 11:

```sh
pnpm install --frozen-lockfile
pnpm --filter @umbra/eclipse-run dev
pnpm --filter @umbra/eclipse-run test
pnpm --filter @umbra/eclipse-run build
```

Build output: `games/eclipse-run/dist`. A browser with WebGL is required. No API keys or backend are required. Progress is stored on the current device only. Sound starts muted and can be enabled in the top-right control.

WASD / arrows move relative to the screen; hold Space to jump. R restarts the current chapter. Escape pauses. Touch controls appear on small screens and touch devices. Ferries carry an idle player: wait at the edge, step aboard when they arrive, then stop moving until the far bank.

## Engine integration

`src/levels.ts` authors valid Umbra scenes. `src/main.ts` drives `createSimulation` at `FIXED_DT` (60 Hz), interpolates render positions and processes engine goal events. Umbra owns player collision, jumps, platform carry, goal collection and falling. The renderer never overrides physics. Existing engine code and existing games are unchanged.

Headless tests run all five complete routes through real Rapier physics and assert four goal events and a win. They also cover falls/restarts and corrupted progress data. Browser play and tests use the same scenes and simulation.

## Vercel

Create a project from this repository with **Root Directory left at the repository root** and Framework Preset **Other**:

- Install command: `npx --yes pnpm@11.25.0 install --frozen-lockfile`
- Build command: `npx --yes pnpm@11.25.0 --filter @umbra/eclipse-run build`
- Output directory: `games/eclipse-run/dist`
- Node.js: 22.x

This allows Vite to resolve Umbra's source across the workspace. For a local CLI deployment from the repository root, use `vercel --local-config games/eclipse-run/vercel.json --prod` after linking the intended project. The configuration is intentionally not placed at the repository root, so other Umbra apps can retain independent deployments.

## Free assets

The bundled `public/assets/*.glb` files are from [Kenney Nature Kit](https://kenney.nl/assets/nature-kit), licensed CC0. Original files:

| Bundled file | Original model |
| --- | --- |
| tree.glb | tree_pineDefaultA.glb |
| rock.glb | rock_largeA.glb |
| bush.glb | plant_bush.glb |

The original license is preserved at `public/assets/LICENSE-Kenney.txt`. Models are tinted at runtime to match the art direction. Terrain, player, portal and light effects are generated in code. DM Sans and Manrope load from Google Fonts with system sans-serif fallbacks.

## Verification limits

The managed preview browser used during development has WebGL disabled. Startup's readable graphics-error fallback was verified there; visual 3D and touch playtesting on a real WebGL-enabled desktop/phone remains recommended. Production build, real-physics campaign playthroughs, and repository regression tests are checked separately.
