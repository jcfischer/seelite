# Exterior anisotropy: node #1230

## Result

`industrial-surface` resolves at anisotropy 8 through its optional `SharedImage`
entry, before owner copies are cloned. Entries without the field keep the loader's
setting (three's default is 1). The courier sets every non-`cockpit-` material's
base-colour map to 8 in its own preparation callback, except maps owned by the
shared registry: those retain their entry's settings. Other authored hull builders,
normal/bump maps and the interiors' owner copy are unchanged.

The interiors still set exactly 8 (`src/interior-kit.ts`). Their owner copy and
the exterior now share one GPU upload. The measurements below describe production
code at `5b683f19`, against base `535fe0d7`. The round-1 changes use one
`EXTERIOR_MAP_ANISOTROPY` constant in the registry entry, courier and interior kit,
and prevent the courier from mutating registry maps. Source identity recognizes
both owner copies and texture clones. The shipped courier has no registry map,
so these changes preserve its measured settings.

No model or image bytes changed. `git diff 535fe0d7 HEAD -- src/models` is empty.
SHA-256 pins, rechecked during round 1 with
`shasum -a 256 src/models/{courier-hull.glb,coriolis.glb,industrial-surface.webp,station-interiors.glb}`:

```text
6967208f3169dcb900f24e6164ac09023db5d6b6ee5495a92b157ce20c310c30  src/models/courier-hull.glb
e220ff240675f202642f9a71e2e9674a5f458bc94a88eb143c1da4bda8e9fdd1  src/models/coriolis.glb
10d4d0776274448b52fc3191941d09dc0a74f1967854f23f86406188bf1eedd7  src/models/industrial-surface.webp
29b48cde0d18c5a7c8e663e91b190c8d4190906834215c71036f6d8ae3638e16  src/models/station-interiors.glb
```

No changelog entry is proposed under `src/changelog.ts`'s major-change rule:
this is a texture-sampling adjustment to existing surfaces, with no new ship,
system, mechanic or screen. It changes appearance, but the comparisons below do
not establish a noticeable visual difference. This is a minor visual change;
the earlier receipt's performance-tuning rationale was incorrect.
The accepted appearance comes from node #1219; fresh principal approval remains
required on the production captures before the checkpoint can close.

## Headless checks

Tests were written first. The shared-image tests failed on the required 8 and
per-entry 4; the shipped courier failed on `blue-grey-0` at 1 while the shipped
Bollard control passed. Both regression groups are now in the corresponding
`shared-image.test.ts` and `courier-hull.test.ts` files.

The courier tests decode shipped GLBs with meshopt through `GLTFLoader`, replacing
only the WebP image decoder with fake textures. Unlike the usual headless helper,
this retains texture references. They inspect all map occurrences in all built
levels, include a material-array fixture, keep cockpit maps at 1, and check that
Bollard maps stay at 1. Registry tests cover the actual industrial entry and its
owner copy, an omitted field on a paint-wear fixture, and a distinct explicit
value so a hardcoded global 8 fails.

Affected tests: 93 passed, zero failed. Build (including typecheck and deployment
file-size guard), format, script lint, comment lint and launcher wiring passed.
Before round 1, `npm test` ran once on this host immediately before `994b0a9e`:
7,821 passed, zero failed, across 488 files in 558.76 seconds. The original log
was re-read during round 1; its summary is preserved here:

```text
 7821 pass
 0 fail
 17227790 expect() calls
Ran 7821 tests across 488 files. [558.76s]
```

Reproduce with `npm test` on that commit. Raw logs, captures and measurements
remain outside git under the principal's 2026-11-06 evidence ruling; `/tmp`
paths below identify this host's supporting files, not PR-accessible attachments.
The hashes, fixture recipes, counts and summaries in this receipt are the
versioned evidence.

## Sage review round 1

Both sampler-policy suggestions are addressed together: the constant remains 8,
and courier preparation skips registry-owned sources. A new regression on the
shipped courier checks maps from entries with omitted anisotropy (1) and explicit
anisotropy (4), their owner copies and their clones. Before the fix it failed
with expected 1, received 8; the other 93 affected tests passed.

The two receipt suggestions are also addressed: the asset pins and historical
unit summary are now inline, with commands to reproduce them, and the changelog
decision uses the major-change definition rather than a performance exemption.

Round-1 validation on this host: 112 affected tests across five files passed.
Build (including typecheck and deployment size checks), format, script lint,
comment lint and launcher wiring passed. The required single full `npm test`
run immediately before the round-1 commit exited 0:

```text
 7822 pass
 0 fail
 17227815 expect() calls
Ran 7822 tests across 488 files. [558.63s]
```

Its supporting host-local log is `/tmp/node-1230-r1-full-test.log`. Fresh focused
hardware probes follow the clean commit; the supervisor owns the final PR gate.
The hardware measurements and captures below remain the earlier implementation's
evidence; they are not relabelled as fresh round-1 runs.

## Hardware measurement

2026-11-12, ANGLE Metal / Apple M5 Pro, headed, 1440×900 CSS, device scale 2,
2880×1800 drawing buffer, quality high, resolution 100%, AA off. No browser suite
or capture ran alongside the timings. The final timing run closes the docked
page before opening the courier page.

The visible docked fixture is seed 42, system 4, Coriolis `overhead-near`, chase
view with yaw −0.8 and elevation 0.3 radians. It waits for system models and
interiors to settle, holds the clock, and warms 30 renders. The exact base's
three production files were temporarily restored for the baseline measurement,
then the committed files were restored in `finally`; no branch or commit changed.

| Visible docked bay | Base production files | Implementation |
| --- | ---: | ---: |
| Native renderer GPU textures | 71 | 70 |
| Industrial map anisotropies | 1, 8 | 8, 8 |

The existing `measure-docked-coriolis-cold.mjs` reports 61 on both refs: its forward
console suppresses 3D rendering, so it does not establish the visible-bay saving.
The separate visible fixture above is the acceptance evidence.

Timing uses 12 blocks of 120 synchronous `render(0)` calls per arm, drained with
one-pixel reads before and after each block. Arm order is shuffled with seed 1230.
The base arm sets the relevant exterior map to 1; approved and same-build control
arms independently set it to 8. The interior remains 8. All station blocks count
71 textures at 1 and 70 at 8. The courier uses seed 47 beside `planet-5`, six
radii, sun angle 150°, chase view; its `steel-wear` map is the changed texture.

| Subject | At 1, median ms | At 8, median ms | Delta ms | 8-vs-8 control delta ms | Pairwise 8 slower than 1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Visible docked Coriolis | 7.93042 | 7.89250 | −0.03792 | +0.01250 | 57/144 |
| Courier | 0.76083 | 0.76167 | +0.00083 | −0.00208 | 76/144 |
| Coriolis exterior | 1.75917 | 1.76125 | +0.00208 | −0.00625 | 82/144 |

The exterior sample uses the canonical Coriolis flank: seed 42, system 4, four
silhouette radii, 35° sun angle, chase view. Only the industrial exterior map
changes between its arms. Its screenshot was inspected to confirm the painted
exterior is visible. Raw data and instrument are
`/tmp/node-1230-cost-coriolis-exterior.json` and
`/tmp/node-1230-exterior-cost.mjs`.

These are saturated rendering throughput measurements, not delivered frame
latency. No added cost is established by these runs. The earlier docked run read
+0.00458 ms against +0.00208 ms control; the sign changed on repetition.

Raw evidence and reproducible local instruments remain outside git:
`/tmp/node-1230-cost.json`, `/tmp/node-1230-cost-first.json`,
`/tmp/node-1230-measure.mjs`, `/tmp/node-1230-visible-base.json`,
`/tmp/node-1230-base-only.mjs`, `/tmp/node-1230-verify-base.mjs`, and the
`/tmp/node-1230-cost-*.png` frames. Run the instrument from this worktree with
`SEELITE_PROBE_RENDERER=hardware node /tmp/node-1230-measure.mjs`.

## Browser and appearance evidence

`npm run probe:select -- --base origin/main --head HEAD` selected 122 of 124
probes through affected dependencies. The selected `probe:pr` gate passed: 120/120 gating probes in 1156 seconds, with 122 selected probes executed and two of the repository's 124 probes unselected. Of the two existing quarantines, death passed and output-stage failed (121 passes overall).
This is selected coverage; it is not a full-suite claim.

The quarantined output-stage row (node #975) also failed alone on both head and
exact base production files: 1.05% lit-pixel disagreement against a 1% bound,
13/14 checks on each. No threshold was changed. Logs are
`/tmp/node-1230-probes.log`, `/tmp/node-1230-output-head.log` and
`/tmp/node-1230-output-base.log`.

The shared-image probe now requires the exterior and interior owner to share the
upload at 8, then changes only the owner to 4 and requires a separate upload while
the exterior remains 8. It retains fetch, failure/retry, background fallback and
teardown checks.

Canonical captures are complete on the hardware renderer, high quality,
1440×900, at the view set's declared seeds and camera recipes:

- Full before, after and same-build control: 118 frames each,
  `/tmp/node-1230-views/index.html`.
- Two additional scoped repeats: 18 frames each. The combined sheet is
  `/tmp/node-1230-controls/index.html`, with four after samples for those views.
- Baseline production code is `535fe0d7`, with test-only working-tree changes;
  its `-dirty` label is retained. Every after/control capture is clean `5b683f19`.
- Pixel comparisons and their local instrument are `/tmp/node-1230-diff.json`,
  `/tmp/node-1230-diff.txt` and `/tmp/node-1230-diff.mjs`.

Percentage of pixels moving by more than 24/255 summed RGB, across four
before/after comparisons and six same-build pairings:

| View | Before/after range | Same-build range |
| --- | ---: | ---: |
| Coriolis flank | 0.077–0.995% | 0.098–1.087% |
| Ring flank | 0.166–1.124% | 0.049–1.620% |
| Courier chase | 0–0.000232% | 0–0.000232% |
| Bollard chase | 0–0.003% | 0–0.003% |
| Sky only | 0% | 0% |

These readings do not establish a visual improvement. The scoped berth repeats
have a different game clock (about 83.48 s versus 337.18 s in the full runs), so
their roughly 38% differences are excluded from any repeatability claim. In the
three full runs, berth-free-look reads 1.008–1.168% before/after against 1.135%
same-build. The raw scoped readings remain in the report with this limitation.
The full-set sheet is the review surface for the berth row.

The principal's production appearance approval is pending and is not supplied by
this worker. The supervisor owns PR, Sage review and push; the principal owns the
merge and `cp-seelite-exterior-anisotropy` checkpoint. No graph node was edited.
