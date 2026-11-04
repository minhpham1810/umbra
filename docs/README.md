# Umbra guides

Read them on the docs site: [minhpham1810.github.io/umbra](https://minhpham1810.github.io/umbra/)
(`pnpm docs:dev` serves it locally).

1. [Getting started](getting-started.md): games, components, systems, runs, checkpoints, replays and scene files.
2. [In the browser](browser.md): the game loop, input, 3D and 2D drawing, glTF models and sound.
3. [Physics](physics.md): 3D and 2D bodies, characters, sensors, models as colliders and navigation.
4. [Agents](agents.md): search, playtesting, observation, the MCP server and Studio.
5. [Determinism](determinism.md): the rules that keep replays exact, and how to debug a divergence.

Every TypeScript example in these guides runs in the test suite
(`packages/agents/src/docs.test.ts`), so they stay in step with the code.
Complete games are in [`packages/engine/examples`](https://github.com/minhpham1810/umbra/tree/main/packages/engine/examples).
