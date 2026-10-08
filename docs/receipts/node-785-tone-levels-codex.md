# Node #785: view-set tone instrument

Author: Codex / ivy-agent. Captured 2026-10-08.

The instrument reports display luma; it sets no thresholds and does not judge a frame. The principal's contact-sheet approval remains the visual close gate.

Usage:

```sh
npm run views -- --label before
npm run views:levels -- before
npm run views:levels -- before after
node scripts/levels-view-set.mjs before after --out view-set
```

Capture writes `view-set/<label>/levels.txt` before publishing its manifest and links it from the existing `view-set/index.html`. Historical manifests without a recorded levels file remain readable without a tone-report link. The standalone tool also regenerates each report. Missing, corrupt, duplicate or undeclared frames refuse; stale reports are removed before rereading. If standalone regeneration fails, it removes `index.html` too, so the old sheet cannot link a deleted report; successful regeneration preserves the sheet.

Statistics use decoded 8-bit RGB, rounded Rec. 709 display luma (0.2126 R + 0.7152 G + 0.0722 B), with no linear-light conversion. Alpha is ignored for these opaque composed frames. Nearest-rank percentiles are ceil(q N), with integer stride 4 on both axes from (0, 0): 81,000 sampled pixels per 1440×900 frame. The percentages include quantised codes ≥250 and ≤7. The average row gives each view equal weight, including its percentiles; it is not a pooled-image percentile. Paired deltas are second minus first, with percentage-point deltas for the two tails. Percentages printed as 0.00 can contain smaller nonzero fractions.

## Main baseline

Source: `294b5c6279374732882ee735c8f7d49545e484ae`, matching `origin/main` and the assigned branch at worker start. The capture ran on that game source with the new instrument uncommitted, so the manifest correctly records `294b5c6-dirty`. No `src/` file was changed. This is one run, not a repeatability band.

Run: `main-294b5c6-node-785`; 72 views at 1440×900, default capture quality, seed 47 except views that declare their own fixture. Captured at 2026-10-08T19:35:46.493Z.

Renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version). The serving-tree guard verified this worktree; the manifest records its branch and head.

Reading, decoding and measuring the first twenty actual 1:1 frames took **1.184 seconds** with Node v24.19.0 on this machine. This is a reported timing, not a gate.

The complete baseline table, quoted once:

```text
Run: main-294b5c6-node-785 · ref: 294b5c6-dirty · renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)
Display luma: rounded Rec. 709 RGB codes; nearest-rank percentiles; stride 4 on both axes.
clip%: codes >=250; black%: codes <=7. Average: equal weight per view, including percentiles. Descriptive only.
view                                   mean       p1      p50      p99    clip%   black%
derelict                              54.98     1.00    27.00   178.00     0.00    15.07
derelict-tear                         65.41     1.00    36.00   179.00     0.00    17.95
cockpit-arrival                       22.40     0.00    16.00   180.00     0.00    16.74
cockpit-backlit                       24.52     0.00    20.00   177.00     0.00    16.21
station-approach                      18.29     1.00    16.00    75.00     0.00     4.94
station-shipyard-axis                 19.58    12.00    17.00    80.00     0.00     0.34
station-refinery-axis                 26.66    13.00    25.00    98.00     0.00     0.19
station-flank                         35.06     1.00    31.00    91.00     0.00     3.82
station-outline                       24.86     0.00    18.00   180.00     0.00    27.54
station-range                         20.92    12.00    20.00    71.00     0.00     0.17
station-shipyard-flank                23.24     1.00    19.00   128.00     0.00    13.58
hull-chase                            19.50     0.00    18.00   112.00     0.00     4.01
planet-terminator                     25.75     0.00    21.00   178.00     0.00    20.06
station-horizon                       23.28     1.00    19.00    93.00     0.00    25.15
planet-boundary                       26.04     0.00    18.00   178.00     0.00    31.50
planet-fill                           30.41     2.00    23.00    96.00     0.00     3.92
airless-fill                          21.15     0.00    15.00    94.00     0.00    32.56
cold-rocky-ice                        65.50     6.00    24.00   178.00     0.00     1.75
ringed-giant                          37.43     2.00    27.00   155.00     0.00     1.77
giant-fill                            89.98    13.00   101.00   178.00     0.00     0.04
sky-only                              25.93     0.00    23.00   177.00     0.00    15.93
sky-at-the-rim                        62.05     0.00    66.00   180.00     0.00    15.79
controls-open                         27.28    10.00    19.00   223.00     0.57     0.60
controls-folded                       30.50    10.00    21.00   218.00     0.48     0.60
controls-rebind                       10.96     7.00     9.00    57.00     0.00    11.56
chart-hover-crowded                   14.38     0.00    12.00   161.00     0.00    43.64
chart-hover-isolated                  14.30     0.00    12.00   161.00     0.00    43.80
duel-glass                            27.98     0.00    23.00   183.00     0.00    15.10
duel-console                          23.34    11.00    19.00   161.00     0.00     0.58
raider-canisters                      25.86     0.00    20.00   185.00     0.00    16.47
raider-log                            20.71     9.00    17.00   161.00     0.00     0.61
docking-notice-bounce                 49.20     0.00    35.00   223.00     0.00    20.04
docking-notice-let-go                 22.84     0.00    16.00   182.00     0.00    19.20
vent-plumes-chase                     19.29    12.00    18.00    69.00     0.00     0.01
vent-cue-cockpit                      24.22     0.00    18.00   211.00     0.00    16.38
vent-plumes-cruise                    18.49    12.00    17.00    60.00     0.00     0.03
witchspace-windup                     25.46     0.00    21.00   178.00     0.00    16.50
witchspace-entry                      32.32     0.00    27.00   179.00     0.00    16.51
witchspace-entry-late                 13.55     0.00     1.00   193.00     0.02    77.39
witchspace-cut                       130.74     1.00   180.00   204.00     0.03    16.19
witchspace-exit                       51.28     1.00    31.00   226.00     0.00    26.44
witchspace-exit-late                  17.98     0.00     2.00   180.00     0.00    59.05
witchspace-rift-chase                 25.84    14.00    18.00   159.00     0.00     0.03
witchspace-rift-closing               19.49    13.00    16.00    98.00     0.00     0.03
opening-forming                       17.92     0.00    20.00    43.00     0.00    19.93
opening-arrival                       47.69     0.00    32.00   223.00     0.00    32.76
opening-arrival-rift                  19.67     0.00    22.00    69.00     0.00    19.92
opening-flypast                       16.29     0.00    18.00    28.00     0.00    19.94
opening-flypast-away                  14.60     0.00    16.00    25.00     0.00    19.94
opening-cruise                        14.12     0.00    16.00    42.00     0.00    34.12
opening-cruise-late                   19.83     0.00     3.00    81.00     0.00    56.15
opening-approach                      14.14     0.00    14.00    31.00     0.00    19.93
opening-approach-late                 13.33     0.00    14.00    27.00     0.00    19.97
opening-dock                          13.57     0.00    14.00    53.00     0.00    27.55
opening-dock-late                     15.46     0.00    13.00    64.00     0.00    42.28
cruise-light-half                     26.44     0.00    19.00   211.00     0.00    16.16
cruise-light-full                     27.64     0.00    19.00   211.00     0.00    16.14
cruise-light-chase                    24.92    13.00    22.00   174.00     0.00     0.04
berth-arrival                         54.99     0.00    47.00   225.00     0.00    20.71
berth-arrival-cabin                   54.63     0.00    58.00   224.00     0.00    23.72
berth-docked-forward                  20.56    10.00    16.00   176.00     0.00     0.01
berth-free-look                       66.25     2.00    55.00   225.00     0.00     4.71
berth-launch-chase                    56.28     3.00    45.00   225.00     0.00     2.50
shipyard-wall-berth                   46.70     4.00    25.00   225.00     0.00     1.72
refinery-cradle-berth                 38.68     5.00    27.00   195.00     0.00     1.44
shipyard-tab-new-game                 19.32     9.00    16.00   142.00     0.00     0.01
shipyard-tab-open                     19.53     9.00    16.00   176.00     0.00     0.01
outpost-interior-workbench            24.88     0.00     6.00   233.00     0.50    61.81
npc-departure                         64.57    13.00    66.00   187.00     0.00     0.01
npc-arrival                           45.37    19.00    36.00   190.00     0.00     0.01
npc-departure-at-player-lane-point    44.63     0.00    43.00   175.00     0.00    16.09
npc-arrival-at-player-lane-point      52.07     0.00    40.00   179.00     0.00    16.26
average                               31.99     3.51    26.25   149.82     0.02    16.16
```

## Initial implementation verification (before review repairs)

- Test-first synthetic histogram: every column, RGB weights, quantisation, inclusive tails and two-axis stride; malformed frames and strides refuse.
- Node CLI fixtures: one/two labels, written tables, signed deltas, equal-view averages across unequal sizes, old/new sheet links, missing/corrupt PNGs and duplicate/extra views.
- Initial capture integration: full canonical hardware run above; generated sheet link checked against the file on disk. This run predates the review repairs and does not verify their capture publication path. The repaired path has static wiring evidence only; no new browser capture was run during either repair pass.
- Focused tests: 78 passed across levels, view-set and capture; final levels-only rerun: 9 passed. Typecheck, format, lint, wiring and build passed.
- The sole full `npm test` run passed: 5,658 tests, 0 failures across 308 files, 7,479,877 assertions (537.01 seconds).
- Probe selector inspected before capture: mode `all`, because `package.json` is shared infrastructure (96 probes). Per the implement-worker contract the full browser suite is reserved for the supervisor; it was not run here.
- This is internal measurement tooling under the changelog definition, so no player-facing changelog entry is due.

Checkpoint: `cp-seelite-view-set-levels` is for the supervisor; this worker did not claim, close, edit or comment on graph nodes.

## Sage round 1

All eight findings addressed. Report generation now lives in `scripts/lib/levels-report.mjs`; the CLI and capture share its report path helper. One column descriptor owns headers, scaling and delta membership. The sheet and instrument share `validateRunViews`, including duplicate refusal, without rendering discarded HTML.

The new CLI and duplicate-sheet regressions failed before the repair and passed after it. The capture check is explicitly static wiring evidence: it now checks invalidation before table generation, table before manifest, manifest before sheet rebuild, and invalidation before writing the rebuilt sheet. It does not claim to execute a browser capture. CLI wording is kept distinct from the consequence model's Intervention vocabulary.

Focused levels and view-set tests: 56 passed. Typecheck, format, lint, wiring and build passed. The sole full `npm test` run in this repair pass passed: 5,660 tests, 0 failures across 308 files, 7,479,889 assertions (385.54 seconds). Recomputing the existing 72-view baseline produced a byte-identical `levels.txt`; the baseline table above remains unchanged. No game rendering changed, and no browser probes were run in this repair pass; the supervisor retains the final browser suite.

## Sage round 2

Corrected the important evidence finding in the original Verification section: it is now explicitly initial-implementation evidence. Its hardware capture predates both repair passes. Neither repair pass ran a browser capture, and the repaired capture publication path is covered by a static source-order check only. The baseline table remains evidence for the captured game frames, not a live test of the current capture code.

Addressed both broken-link suggestions through the review's failure-path alternative: a failed standalone report regeneration removes `index.html`, as capture does. The missing-PNG regression first failed because the old sheet survived; after the repair it passes. An unreadable-manifest case also asserts removal of both report and sheet; the successful paired CLI case asserts that the sheet survives unchanged.

Shared `withRoot` and `runFor` helpers remove repeated fixture setup. Static capture wiring searches now tolerate whitespace and variable argument names, and the rebuild slice ends at the next top-level function or end of file instead of an arbitrary 1,000-character window. This remains static evidence.

Deferred buffered-read concurrency: the existing twenty-frame measurement is already 1.184 seconds, meeting this node's seconds-scale requirement. No new throughput figure is claimed; decoding and reading remain sequential.

Round-2 focused tests: 81 passed across levels, view-set and capture. Typecheck/build, format, lint and wiring passed. The current CLI regenerated the existing 72-frame baseline byte-identically and preserved the sheet. No new browser capture or probe was run; the supervisor retains the final browser suite.

The sole full `npm test` run in round 2 passed: 5,661 tests, 0 failures across 308 files, 7,479,896 assertions (397.44 seconds).
