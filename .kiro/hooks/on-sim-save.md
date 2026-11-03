# Hook: on-sim-save

**Trigger:** any file saved under `packages/engine/src/sim/` or `packages/engine/src/physics/`

**Actions:**
1. Run the determinism lint (`pnpm lint --filter @umbra/engine`).
2. Run the determinism test (`pnpm test --filter @umbra/engine -- runner`).
3. Report pass/fail inline.

This keeps the determinism invariant from silently breaking during development.
