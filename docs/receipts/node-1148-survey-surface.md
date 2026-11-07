# Node #1148: survey surface, instrument range and Navigation

## Current implementation

The parked PR is rebased onto main `1951dd63`, which contains the repaired
live-cockpit probe and capability outages. The principal's recorded list ruling
now completes item 3. Fresh review, hardware and canonical-view evidence will
be recorded on the PR at its final clean head; the older measurements below
remain historical.

The first resumed Sage invocation reviewed remote head `54a79d9f` because a
stale lease rejected the preceding push. Its three findings correctly identified
the missing Navigation code at that old head. The completed implementation and
fixtures are now published, with the remote SHA checked explicitly before the
next review. This invocation is not evidence of reviewing the resumed code.

With `?mining=1`, the DEEP mark uses `Game.rockShape(ref).radiusAt(deepDir)`,
the same archetype heightfield sampler used by the Mining Laser's cut. The
mouth direction still follows the rock's spin and the field's rotation.

The target instrument reads `RockRef.distKm`, the exact figure used by
`surveyBlock`. This preserves the existing survey convention: the distance to
the bounding surface, clamped at zero. It does not change survey range,
target selection, the on-glass target bracket's centre distance, or Lane wait.

## Navigation

With mining enabled, Navigation lists valid current-field readings and the
selected rock, including a selected rock whose reading expired. The current
field is the existing `frameField` owner. Other expired and unsurveyed rocks
are absent. The existing survey designation supplies each reading; distance
is the owned `RockRef.distKm` surface distance, including zero.

The existing 40 km target limit remains unchanged. A surveyed current-field
rock beyond that limit stays readable with a disabled button and a visible
range-limit reason. The Game also revalidates selection against current rows
and the limit, so stale or synthetic input cannot select a disabled row.
Nearby listed rocks can be selected with a real pointer click.

When visible rock rows are present, the list uses strict nearest-first order
for all its visible rows. Lists without rock rows retain the existing two
kilometre ordering deadband. This change is limited to the mining context;
flag-off ordering remains unchanged. Rock rows do not run ordinary cruise time
integration. Reading details and refusal states participate in the DOM cache
key, so a reserve update repaints even with the ship and clock held still.

## Shared changes that run without the mining flag

`Game.updateInstruments` runs in ordinary play. Its new distance branch checks
`MINING_ON` before resolving a rock. With the flag off, it passes the original
`targetKm` to the original formatter. Non-rock targets also keep that figure
with mining enabled.

`deepCueRender` remains initialized and cleared to `null` in ordinary play.
Its added `mouth` field is populated only by the existing mining-gated cue
draw. The obsolete `DEEP_MOUTH_RADIUS_SHARE` constant is removed. There are
no changes to the shared heightfield sampler, save schema, survey rules or
field frame. The shared Navigation projection accepts optional owner-supplied
distance, detail and refusal fields; ordinary callers retain their previous
row shape and behavior. Its query can match a supplied reading. The shared
DOM cache also notices changed row names/kinds, and disabled Navigation rows
are excluded from the pad cursor. Ordinary rows keep their three cells.

## Historical initial-worker verification

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

## Resumed test-first evidence

Six new Navigation tests first failed on absent Game behavior and the missing
owned-distance projection. They then passed, covering current-field membership,
exact expiry, selected retention, a near pair inside the old ordering deadband,
far-row readability/refusal, nearby selection, null field, flag-off behavior,
reading search and a zero surface distance. Existing surface/instrument tests
remain intact. The initial affected six-file run passes 65 tests and 21,076
assertions. The Navigation plus canonical-view checks pass 63 tests and 1,144
assertions after adding the two declared survey views. Logs:
`/tmp/survey1148-nav-red.log`, `/tmp/survey1148-nav-green.log`,
`/tmp/survey1148-affected.log`, `/tmp/survey1148-nav-views-green2.log`.

The canonical set adds `mining-survey-surface` and
`mining-survey-navigation`, both on the existing survey probe's world/system
fixture. The shared placement completes a real held survey for the cue, and
adds explicit reading-history fixtures for Navigation's ordering, distant-row
and expiry cases. Browser regression also checks a real pointer click and a
stationary reading repaint. Flag-off control uses a new page rather than
navigating an already measured page.
