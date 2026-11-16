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

The target instrument, selected on-glass label and Navigation's Selected Target summary read
`RockRef.distKm`, the exact figure used by
`surveyBlock`. This preserves the existing survey convention: the distance to
the bounding surface, clamped at zero. It does not change survey range,
target selection, marker projection or Lane wait. The earlier receipt's
unchanged on-glass centre-distance limit is superseded by this correction.

## Navigation

With mining enabled, Navigation lists valid current-field readings and the
selected rock, including a selected rock whose reading expired. The current
field is the existing `frameField` owner. Other expired and unsurveyed rocks
are absent. The existing survey designation supplies each reading; distance
is the owned `RockRef.distKm` surface distance, including zero.

The existing 40 km target limit remains unchanged. A surveyed current-field
rock beyond that limit stays readable with a disabled button and a visible
range-limit reason on its own full-width line, separate from the reading.
The Game also revalidates selection against current rows
and the limit, so stale or synthetic input cannot select a disabled row.
Nearby listed rocks can be selected with a real pointer click.

When visible rock rows are present, the list uses strict nearest-first order
for all its visible rows. Lists without rock rows retain the existing two
kilometre ordering deadband. This change is limited to the mining context;
flag-off ordering remains unchanged. Rock rows do not run ordinary cruise time
integration. Reading details and refusal states participate in the DOM cache
key, so a reserve update repaints even with the ship and clock held still.

## Shared changes that run without the mining flag

`Game.displayTargetKm` is the single display adapter used by the target
instrument, Navigation summary and selected-label reservation and paint. It
checks `MINING_ON` before resolving a rock. With the flag off, and for ordinary
targets, each caller retains its original centre-distance argument and formatter.
The surface distance uses a nullish fallback, preserving zero. Marker geometry,
physical range and cruise ownership remain unchanged.

`deepCueRender` remains initialized and cleared to `null` in ordinary play.
Its added `mouth` field is populated only by the existing mining-gated cue
draw. The obsolete `DEEP_MOUTH_RADIUS_SHARE` constant is removed. There are
no changes to the shared heightfield sampler, save schema, survey rules or
field frame. The shared Navigation projection accepts optional owner-supplied
distance, detail and refusal fields; ordinary callers retain their previous
row shape and behavior. Its query can match a supplied reading. The shared
DOM cache also notices changed row names/kinds, and disabled Navigation rows
are excluded from the pad cursor. Ordinary rows keep their three cells.

## Resumed display verification

The close-pose glass consistency check first failed with actual
`selectedRender.text` reading `Rock 2.4 km` against the instrument and survey
owner's `2.0 km`. All selected mining-rock distance displays now share the
adapter above. The previously complete 98-view capture at `0e5bb424` and its
cancelled partial full gate remain historical evidence; the final corrected
source receives fresh focused/canonical captures and the full selected gate.

The front view also exposed DEEP text colliding with the selected-label
baseline. Only that text is now centred below its ring with a top baseline,
clearing the larger 14 px selected-target ring when the projections coincide.
A paint-level test failed on the old placement, then passed for both facing
and far-side cues, pinning unchanged ring position/radius, dash, facing and text.
The mouth's actual surface point is unchanged. Affected tests now pass 186 tests
and 21,762 assertions across nine files, and typecheck passes.

Scoped Sage round 7 reviewed confirmed `49e688b2`; its returned marker matches.
It approved with zero findings. The actual hardware diagnostic passes 37/37,
including the painted glass label and instrument both reading 2.0 km. Format,
lint, comment lint, wiring and build pass. Refreshed front, 25-degree oblique,
Navigation and narrow images are preserved under
`/tmp/seelite-survey-1148/quality-49e688b2` with their actual clean served-head
metadata. Root quality review clears both surface views; principal visual
approval and fresh final-head canonical/full gates remain required. Review
stops; the following response changes prose only.

The actual browser consistency check first failed with a 23.9 km Selected Target
summary against the selected row and instrument's 23.5 km surface distance.
The corrected summary uses the same mining-gated distance owner, with the
unchanged centre distance retained for ordinary and flag-off displays. This
does not change cruise or physical geometry. The check then passed in the
35-check hardware diagnostic at `7e5f3aef`.

A separate 640 px check first failed because the far row's name took 29.6875 px
of height while an ordinary rock name took 14.84375 px. The long refusal was
squeezing the name. The refusal now has its own full-width detail line, keeping
the actual reading separate. The final diagnostic and canonical evidence are
recorded on the PR after refreshed review. The interrupted `837053ed` canonical
run is partial historical diagnostics, not the final 98-view evidence.

Affected headless verification after both display changes passes 185 tests and
21,750 assertions across nine files, including the existing ordinary-contact
Navigation fixture with its real collaborator. Typecheck passes.

## Canonical baseline provenance and final review

The existing complete 96-view baseline remains unmodified at
`/tmp/seelite-capability-1194/views-after/after-5786c618`, with its actual
`5786c618` label and served-checkout metadata. It is prior evidence at identical
render inputs to rebased base `1951dd63`, not a newly captured `1951dd63` run.
The root reviewer independently checked this equality, and the implementation
worker repeated the checks:

This equality is for source, assets and capture configuration. It does not
assert identical native-input history between runs. The earlier complete
baseline and the later failing pair can therefore coexist without a source
change.

- Both revisions have `src` tree `0973c050a275a4699d51736a85bf0ed56e5c072a`.
- Both have `public` tree `1aab83bc746708b5d2767eb29fceeddabdf84183`.
- `git diff --exit-code 5786c618 1951dd63 -- src public` plus the capture script,
  view catalogue, placement helper, outage fixture, probe guard, package files,
  index and Vite config exits zero. The remaining diff contains only receipts,
  tests and the earlier cockpit-probe support.
- Local check outputs are `/tmp/survey1148-baseline-render-trees.txt`,
  `/tmp/survey1148-baseline-render-diff.txt` and
  `/tmp/survey1148-baseline-diff-paths.txt`.

Refreshed Sage round 5 reviewed confirmed runtime head `6cf32311`; its returned
reviewed-commit marker matches. It returned five suggestions and no important or
blocker finding. The narrow check now requires the actual visible refusal span,
without the old range-element fallback, and baseline provenance is recorded
above. Optional ordering, span-sync and pose-resolution refactors are declined
to retain the tested scope. Review stops under the repository's rule; final
capture, selected browser gate and principal visual approval are reported on
the PR before merge.

## Capture pointer ownership correction

The first complete after attempt at clean `0c478b4c` stopped after the crowded
chart: the isolated chart's unchanged precondition still read system 44 after
pointer parking. The exact consecutive pair also failed on clean base
`1951dd63`. The isolated chart passed alone, so that run did not cover the
failing transition. All failed and partial runs remain labelled as such.

An external trace established that an unowned trusted pointerleave was filtered
while the crowded point was owned. Chromium still changed its internal hit
target. A subsequent real move to the park therefore emitted no chart leave,
leaving the application's remembered hover intact. A real owned round trip
initially passed but then failed the committed pair again; its synchronization
premise was unreliable while unowned trusted input continued. The trace does
not identify which human or process generated those events. That attempted
pointer compensation is discarded.

The final correction is confined to the capture harness: each independent
chart shot clicks the existing Navigation tab, then the Galaxy Map tab. The
existing chart owner disposes the old chart on tab exit and mounts a fresh one
on entry. This removes cross-shot hover state through actual controls before
the unchanged unlabelled precondition and real `page.mouse` hover. The original
text and before/after shutter assertions remain unchanged; there are no
synthetic events or runtime edits.

Evidence: `/tmp/survey1148-chart-sequence-base.log` and
`/tmp/survey1148-chart-sequence.log` retain the repeated failure;
`/tmp/seelite-survey-1148/chart-event-trace.json` records the ingestion mismatch;
`/tmp/survey1148-chart-roundtrip.log` retains the initial experimental pass;
`/tmp/survey1148-chart-fixed-check.log` records its later failure;
`/tmp/survey1148-chart-lifecycle.log` records the external chart-remount pair;
`/tmp/survey1148-chart-lifecycle-committed.log` records the actual committed pair
passing with null initial hover. This pair is a regression for independent
shot setup, not a claim that a suppressed leave now reaches an existing chart.
The Navigation console browser probe covers the running chart's ordinary real
hover, release-distance, drag-clear and tab-disposal contracts, not
capture-filter interference or a dedicated outside-canvas leave check. Existing headless
capture tests inspect catalogue and wiring rather than browser hit targets.

Scoped Sage round 6 reviewed confirmed `ebde469a`, and its returned marker
matches. It returned one suggestion and three nits, with no important or blocker
finding. Provenance and coverage wording are clarified above. The fixture's
returned field, cue and row metadata is retained for the external focused
capture artifacts. Optional unused-import cleanup is declined. Review stops
under the repository rule; no further prose-review round is required.

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
