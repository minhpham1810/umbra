# Changelog

## 0.2.0

`umbra-engine` is now a general 2D and 3D engine: any game is a `defineGame` definition
on a deterministic core, and the platformer runtime the Lantern demo uses is one legacy
part of it. Guides: [docs/](docs/README.md).

### umbra-engine

- **Core:** `defineGame`, `createGame`, `runGame`; components with Zod schemas, resources,
  events, systems in phases (`input`, `update`, `physics`, `late`) and plugins; a seeded
  `world.rng`; a state hash after every tick; checkpoints (`save` / `load`); replays
  (`recordReplay` / `verifyReplay`, format `umbra-replay`); scene files with prefabs
  (`spawnScene` / `saveScene`). `z` is re-exported.
- **Physics:** `physics3d()` and `physics2d()` plugins on Rapier 0.12.0 (pinned): fixed,
  dynamic and kinematic bodies, colliders, characters, sensors and contact events,
  impulses and ray casts, all hashed and checkpointed. `navBakeWorld` and
  `navBakeTriangles` for navmeshes.
- **Presentation:** `Transform` plus `Mesh`, `Camera`, `Light`, `Sprite` and `Camera2D`
  components, saved but never hashed. `createSpriteView` (Canvas 2D);
  `createSceneView` and `gltfModels` in `umbra-engine/three`.
- **Runtime:** `umbra-engine/runtime` with `startGame` (fixed-tick browser loop that
  records inputs and exports replays), `createInput` and `createAudio`.
- **Assets and math:** `gltfTriangles` reads glTF models for colliders; `rotationZ` and
  `angleZ` convert 2D angles identically on every JavaScript engine.

Breaking: the old `ecs/types` and `hash/state` exports are gone (use the core's `World`
and `GameRun.hash`); system names are optional labels, so duplicate names are allowed.

### umbra-agents

- **Any game:** `AgentGame`, `searchOutcome` (beam search from checkpoints, routes
  re-run from scratch), `playtestGame` (`crash`, `nondeterministic`,
  `checkpoint_mismatch`, `unreachable_outcome` findings, with replays) and `observeAt`.
- **MCP:** `game.list`, `game.run`, `game.observe`, `game.search`, `game.playtest` and
  `game.replay.verify`; `umbra-mcp --games <module>` serves a module's games.
- The kit-scene Playtester, Builder, Fixer and `searchStrategy` are unchanged.

## 0.1.1

First published release: the kit-scene platformer runtime, Playtester, Builder, Fixer,
balance search and MCP server.
