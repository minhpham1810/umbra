# Umbra — Repository Structure

```
umbra/
├── packages/
│   ├── engine/          # Pure simulation: ECS, physics, hashing, replay, scene schema
│   └── agents/          # Agent tool API (also served as MCP)
├── games/
│   ├── lantern/         # Dark 3rd-person platformer
│   └── boo-and-co/      # Bright top-down management sim
├── apps/
│   └── studio/          # Browser app: load replays, orbit camera, findings list
├── benchmark/
│   ├── levels/clean/    # 16 hand-made verified levels (8 per game)
│   ├── levels/mutated/  # ~80 levels with one planted bug each
│   └── scripts/         # mutation script, evaluation runner
└── .kiro/
    ├── specs/           # Kiro spec files
    ├── steering/        # product.md, tech.md, determinism.md, structure.md
    └── hooks/           # on-save determinism lint + replay test, scene validation
```

## Rules

- `packages/engine` has zero runtime dependencies except Rapier, Three.js, recast-navigation and Zod.
- `games/*` and `apps/*` may import only from `packages/engine` and `packages/agents`.
- `packages/agents` may import from `packages/engine` only.
- No circular dependencies.
