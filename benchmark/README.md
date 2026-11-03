# Seeded-bug benchmark

96 Lantern levels with known answers, used to measure how well a detector finds level bugs.

```sh
pnpm --filter @umbra/benchmark levels                 # regenerate levels/ (about 20 min)
pnpm --filter @umbra/benchmark bench                  # score all detectors (BENCH_JOBS=n workers)
pnpm --filter @umbra/benchmark bench playtester       # or just one
```

Results: [`levels/RESULTS.md`](levels/RESULTS.md) (table) and [`levels/results.json`](levels/results.json)
(per-detector scores, plus the levels each one missed or falsely flagged).

## Levels

`src/levels.ts` builds each level from a seeded spec: a straight corridor (1–3 cells wide)
of flat runs, one-block steps, jumpable gaps (1–2 cells) and moving-platform ferries,
compiled by the Builder's blueprint compiler (two-high wall ring, pits marked).

- **`levels/clean/` (16).** A candidate is kept only if a 1,000-run search finds a winning
  route. Detectors get 300, so "clean" is not decided by their own limits. The route is
  saved in `levels/solutions/` as a replay that Studio can play. Two of the first 18 seeds
  were dropped because no route was found, so the clean set leans toward levels the search
  can solve.
- **`levels/mutated/` (80).** Each clean level gets each of five bugs, one at a time:

| Mutation | Bug | Why it is a bug |
| --- | --- | --- |
| `chasm` | `unreachable_goal` | A 6-cell pit across the corridor; a running jump covers about 4 m |
| `ledge` | `unreachable_goal` | The rest of the level raised 3 blocks; a jump peaks at 1.6 m |
| `walled-exit` | `unreachable_goal` | Three-high walls on every floor cell around the exit |
| `missing-tile` | `fall_through` | One floor column removed from a flat run (not marked as a pit) |
| `low-wall` | `out_of_bounds` | One side wall cut to one block above the floor; open air beyond |

The three unreachable mutations are impossible by the physics limits above; as a check,
the generator also confirms a 1,000-run search fails on each. Each level's answer is in
`meta.benchmark.truth`.

## Scoring

- **Recall:** mutated levels where a finding matches the planted bug (same type; for falls,
  a cell within one of the planted one).
- **False alarms:** clean levels with any finding.
- **Spurious findings:** findings on mutated levels that are not the planted bug.
- **Time:** wall clock per level, one level per worker process.

## Detectors

- **`playtester`:** the Lantern Playtester (`playtest`, default plan, 300 runs).
- **`random`:** 300 runs of random input (heading and buttons held for half a second at a
  time). Reports the exit unreachable if no run reaches it, and a bug for every cell it fell
  out of that is not a marked pit.
- **`navmesh`:** a Recast path from spawn to exit; no path means unreachable. It cannot see
  holes and cannot model jumps.

## Caveats

- One generator and one game: straight corridors only, few platforms (1 of 16 clean levels
  has a ferry). It measures these five bug types, not level bugs in general.
- The Playtester was changed after a first run on this benchmark, which scored it 61/80
  (missing-tile 13/16, low-wall 0/16): its fall check now looks one cell past the level's
  bounds, and gives each hole enough search runs to cross gaps first. The same change
  found that Lantern level 1 had open ends, now walled off. The levels did not change, but
  a detector tuned on this set will score better here than on new levels.
