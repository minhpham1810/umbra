# Spec: builder-fixer

## Goal
Turn a design brief into a playable Lantern level, and repair Playtester findings with minimal, verified edits.

## Builder
- Gemini writes a blueprint: `floors` (rectangles with height), `pits`, `platforms`, `spawn`, `exit`.
- `compileBlueprint` snaps it to kit pieces, marks platform paths as pits, and adds a two-high wall ring.
- Compile and schema errors go back to the model; up to 3 attempts.

## Fixer
- Input: one finding, the pieces within 3 cells, spawn and goals.
- Edits: `add_floor`, `add_wall`, `remove` (max 12). No add-pit edit.
- Accepted only if a full playtest no longer reproduces the finding and reports nothing new; failures are fed back (3 attempts).

## Loop
Builder → Playtester → Fixer per finding → stop when clean or after 5 fix attempts; unresolved findings are returned.
`pnpm --filter umbra-agents haunt "<brief>" <out.json>`

## Requirements (v2-kiroween)
- [x] Builder output always passes `scene.validate`.
- [x] Fixer acceptance rule from the design doc.
- [x] Loop CLI with a JSON summary.
- [x] Multi-jump routes in `searchTarget` (edge jumps), so stepping-stone fixes can be proved.
- [ ] Studio shows each fix as a before/after replay.
