# Node #500: derive stable control names once per layout

`rigLegend` now holds its string in a `WeakMap<Layout, string>`; `dialKeys`
holds each dial's label in a layout-keyed weak map. `layoutOf` freezes through
the binding rows, and `rebind` produces a new layout, so neither needs an
invalidation hook. Old layouts can be collected. The legacy HUD still formats
live dial values on every update. The rig's fitter still keys on the legend's
full text and viewport width, so a longer rebound legend gets its own fit.

## Measurement

`bun run scripts/measure-derived-names.ts`, Bun 1.4.2, Apple M1 Pro, headless
CPU lane, **no renderer**. These are isolated name-builder timings, not frame
times or an estimate of player-visible frame-rate improvement.

The baseline was measured at `c7aad0fcbd2223811f6598fcc2faa0ebdce2ceb3`
before changing production code. The same instrument ran after adding the two
memos. Each run warms the functions, then measures 12 blocks of 30,000 calls
in each of two same-build arms, A and B, alternating AB/BA order. Each block
cycles default, mouse-flight and rebound layouts. The dial row calls all six
labels and joins them; it excludes numeric formatting and DOM updates. Layout
construction and cold misses are excluded. Timing values must be finite and
positive; the loop consumes each result's length and a character.

| Work per call | Before A / B median (µs) | After A / B median (µs) | Reduction in mean of the two medians (µs) |
| --- | ---: | ---: | ---: |
| Rig legend | 14.375332 / 14.317985 | 0.007113 / 0.006627 | 14.339788 |
| Six dial labels + join | 38.428797 / 38.632057 | 0.248701 / 0.248851 | 38.281651 |

Same-build control (B median minus A median): legend −0.057347 µs before,
−0.000486 µs after; dials +0.203260 µs before, +0.000150 µs after. Every
before block exceeds every after block on both rows (576/576 pairings each).
The before blocks have outliers: legend A/B range 12.881–19.337 µs and dials
37.799–77.821 µs; after ranges are 0.006400–0.024275 µs and
0.226806–0.277721 µs. These distributions support avoiding both repeated
derivations; they do not establish a browser-engine or whole-HUD cost.

Both runs consumed checksum `200902000`. Raw blocks and metadata are preserved
in [before](node-500-before.json) and [after](node-500-after.json).

## Verification

The two scan-count tests in `tests/legend-memo.test.ts` failed before the production edit.
It counts actual layout filters: the legend's four scans and the six dials'
twelve scans stay fixed through ten warm repetitions. A rebound layout gets
new names; returning to the original layout preserves its names. A third test
fits the actual legend before and after rebinding the beam to Backspace at the
same width, checks that the font shrinks, and then returns to each cached fit.
The existing
`tests/derived-names.test.ts` is unchanged: 29 tests passed before the edit,
and all 32 tests across the two files pass after it. Together with
`combat-rig-boundary.test.ts` and `headless.test.ts`, the affected run passes
123 tests, zero failures. Typecheck, format and script lint pass.

The unchanged browser contracts ran serially on the hardware lane (ANGLE Metal,
Apple M1 Pro): `probe-derived-names.mjs` **11/11** and
`probe-live-cockpit.mjs` **64/64**, including the narrow combat overlay. The
derived-name rows press the rebound beam and dial keys read from their text.

Before launching, `probe:select` was inspected with all four changed code/test/
instrument paths: it selected all 107 probes because a new measurement script
is classified as shared infrastructure. The ranger worker contract requires
only affected probes here and reserves the final browser gate for the
supervisor, so the two runs above are **manual partial coverage**, not a
repository-selected PR gate or a full-suite pass. Neither existing probe nor
`tests/derived-names.test.ts` was edited.

### Full headless run: red, attribution pending

The one required `rtk test npm test` run returned **6,338 pass, 31 fail** across
366 files in 2,720.17 seconds (9,609,305 assertions). This is **not a passing
full-suite gate**. RTK printed only the final counts and a passing test whose
name contains `FAIL`; it did not preserve a raw log in its configured tee
directory. Consequently the failed test names and causes are unavailable from
this run, and no claim that they also fail at the base is made here.

A focused rerun with raw output captured in `/tmp` passed all 32 derived-name
and memo tests (88 assertions). A diagnostic run of `probe-guard.test.ts`
also passed all 16 tests. The host showed heavy memory compression during the
long full run, but that observation does not attribute any of its failures.
Per the worker contract, the full command was not repeated. The supervisor's
head/base runs still need to classify the 31 failures before accepting the
headless gate. `npm run build` passed, including its typecheck and dist-size
check; format and script lint passed too.

This is performance tuning under `src/changelog.ts`'s definition, so it adds
no major-change entry.
