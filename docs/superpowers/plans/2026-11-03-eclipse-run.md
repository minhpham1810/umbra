# Eclipse Run Implementation Plan

**Goal:** Build and deploy a finished five-stage Umbra game.
**Architecture:** A separate Vite workspace imports the existing Umbra source; Three.js owns visuals, Umbra owns physics. Campaign state and storage are game-local.
**Tech stack:** TypeScript, Three.js, Umbra/Rapier, Vite, Vercel static hosting.
**Spec:** ../specs/2026-11-03-eclipse-run-design.md

## Tasks
- [x] Author campaign in src/levels.ts; test real simulated routes and falls in tests/campaign.test.ts.
- [x] Implement validated local progress and result calculations in src/progress.ts; test malformed storage and best-time updates.
- [x] Implement rendering, responsive menus, keyboard/touch input, sound and lifecycle in src/main.ts, src/world.ts, src/style.css and index.html.
- [ ] Build, run regression tests, visually playtest, review, push feature branch and deploy to Vercel when connected.

## Review focus
- Malformed/unavailable localStorage must not prevent play.
- Pause, window blur and touch cancellation must clear held input.
- Rapid restart/chapter navigation must not race simulation creation or leak worlds.
- All levels must be winnable with real physics, including the platform ride.
- Mobile layout and WebGL failures must provide usable controls or a readable error.

## Verification and review
- All 61 repository tests pass (22 engine, 29 agents, 10 game). All five stages complete with real physics.
- Production TypeScript/Vite build passes. Free Kenney models include original CC0 license.
- Independent review fixes: preserve runtime across BFCache, compact landscape title layout, keep graphics error modal in a distinct error state.
- Browser has WebGL disabled, so 3D visual playtesting is unverified; readable error fallback verified.
- Portal activation before collecting every shard is intentional: all four sensors must be touched in any order, matching existing Umbra rules.
