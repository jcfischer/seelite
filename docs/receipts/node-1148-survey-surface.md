# Node #1148: survey surface and instrument range

With `?mining=1`, the DEEP mark uses `Game.rockShape(ref).radiusAt(deepDir)`,
the same archetype heightfield sampler used by the Mining Laser's cut. The
mouth direction still follows the rock's spin and the field's rotation.

The target instrument reads `RockRef.distKm`, the exact figure used by
`surveyBlock`. This preserves the existing survey convention: the distance to
the bounding surface, clamped at zero. It does not change survey range,
target selection, the on-glass target bracket's centre distance, or ETA.

## Navigation remains deferred

Item 3 is absent. The principal has not ruled which rocks Navigation lists or
how it orders them. This change adds no rock rows and makes no list-policy
decision. The survey probe checks a populated Navigation list while a
surveyed rock is selected and confirms that rocks remain absent.

## Shared changes that run without the mining flag

`Game.updateInstruments` runs in ordinary play. Its new distance branch checks
`MINING_ON` before resolving a rock. With the flag off, it passes the original
`targetKm` to the original formatter. Non-rock targets also keep that figure
with mining enabled.

`deepCueRender` remains initialized and cleared to `null` in ordinary play.
Its added `mouth` field is populated only by the existing mining-gated cue
draw. The obsolete `DEEP_MOUTH_RADIUS_SHARE` constant is removed. There are
no new runtime imports or changes to the shared heightfield sampler, save
schema, survey rules, field frame, or Navigation projection.

## Verification

- Headless: `tests/rock-survey-surface.test.ts` executes the shipped Game
  methods without WebGL. It checks the mouth against the shipped heightfields
  and laser intersections for at least three archetypes at three spin times.
  It checks the numeric instrument distance and survey range boundary, plus
  a flag-off control. The initial run failed on the missing surface readback
  and the centre-distance instrument: expected `0.0 km`, received `0.4 km`.
- Existing survey and extraction tests pass alongside the new tests.
- The single full host `npm test` run passes: 7,246 tests across 437 files,
  zero failures.
- Hardware `probe-mining-survey.mjs`: 28/28 checks pass on Apple M1 Pro Metal,
  including the two new geometry/range rows, the deferred Navigation list,
  and an ordinary boot without the mining flag. Captures are generated under
  `probe-shots/mining-survey/`.
- Hardware `probe-live-cockpit.mjs`: 64/64 checks pass, including the ordinary
  target instrument at desktop and narrow viewport widths.
- Build, typecheck, format, lint, comment lint, and launcher wiring pass.

Browser coverage is scoped by the ranger worker contract. Path-based
selection reports all probes because `src/main.ts` is shared runtime; the
worker runs the affected survey and live-cockpit probes only. The supervisor
owns the final reviewed-head browser gate, PR, review, and principal merge.
The principal's visual approval is not supplied by these probes.

This is a correction to the provisional mining feature, not a public major
change under `src/changelog.ts`.
