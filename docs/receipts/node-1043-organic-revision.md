# Organic asteroid-field proposal — #1043, 2026-11-07

The new `organic` study breaks the visible placement lattice: unequal asymmetric
lobes, tapered density, sparse curved bridges and open gaps produce irregular
silhouettes from the original far camera, a side camera and an oblique overview.
`braided` remains a secondary exploration; the four earlier geometric profiles
remain historical counterexamples. This is an isolated prototype. Nothing under
`src/`, production defaults, generator versions or saved state changes. No
principal appearance approval, merge, closure or next mining slice is implied.

## Visual evidence and provenance

Review `/tmp/seelite-field-shape-1043-organic/index.html`. It links all three
world seeds (47, 7, 0x5ee11e), charted and rare paired views, actual dense peaks,
full-resolution images and directly captured detail crops. Broad detail crops
use CSS rectangle [480,290,480,320] in the same 1440×900 DPR 2 page. They do not
change the viewing distance. The original far camera is (-224,0,0) km, side is
(0,-160,0) km, overview is (-110,-90,70) km, inside is (1.8,1.8,1.8) km; dense is
candidate-targeted and labelled separately. The selected charted organic peak
has 256 rocks within 8 km of the chase camera, versus 52 baseline; rare has 83
versus 29. These local-density counts belong to the recorded world-view cameras,
not to a separately recorded Navigation camera.
Actual camera errors, field clock, clearance and occupied content are recorded
in each manifest. The main charted dense camera has >1 km surface clearance.

The four world-cost sets (`cost-{charted,rare}-aa{0,2}`) are clean source
`4fcc3de6db5fcef6d0d02be287518b4f76347ca1`. Every set records hashes of generator,
renderer, model heightfields, game and harness, plus copies of the study source.
Early multi-seed sets are explicitly dirty diagnostic captures; they are not
clean-head gates. World images hide the player hull's children to expose the
field; actual production FieldDraw, authored rock shapes/materials and LODs are
unchanged. Rare images demonstrate rocks, not newly discovered scope contacts.
No claim that camera teleportation discovers a rare field is made.

## Provisional density: not an approved production change

The selected charted fixture increases from 193 to 676 total rocks, and its
recorded chase dense view increases from 52 to 256 rocks within 8 km. These
population and density increases are provisional study inputs, not an approved
economy, yield, radius-distribution or performance change. Feedback on the
arrangement must not be interpreted as approval of those figures. The 83
out-of-range Navigation rows are an observed consequence of this provisional
population, not an approved UI or performance outcome. The existing 40 km
targeting limit is unchanged. Production must separately resolve population,
local density, resource availability and the resulting Navigation workload.

## Geometry, identity and counts

Placement draws use their own seeded stream. Source metadata still comes from
the original fifteen per-slot physical draws. Anchors never come from layout
cells. A metadata bank with original cell size and semi-axes×1.6 supplies 2081
charted / 945 rare numeric slots, then independent selection and full-drift-envelope
thinning retain the rocks. Spatial buckets hold arrays and accelerate rejection;
they never supply the anchors. Conservative candidate-profile semi-axes are
bounds only; layout-cell count is N/A for these continuous candidates.

The full three-seed corpus covers 292 charted and 147 rare fields. Counts are
min / median / p99 / max:

| Kind | Baseline | Organic | Braided |
|---|---|---|---|
| charted | 156 / 185 / 211 / 214 | 457 / 637 / 756 / 774 | 391 / 519 / 632 / 651 |
| rare | 66 / 90 / 108 / 111 | 245 / 313 / 374 / 383 | 204 / 253 / 303 / 319 |

Envelope-dependent thinning may bias the retained radius population even though
every retained slot keeps its original physical values. The realized radius
distribution, rock yield and changed ore availability require production audit;
this study does not ratify them.

Raw corpus: `/tmp/seelite-field-shape-1043-organic/corpus.json`. Retained physical
attributes and slot identities agree with the original stream, including when
the metadata input order is reversed. Pairwise anchor distance includes both
radii, both complete drift radii and the unchanged surface margin, proving the
gap for every clock, rather than only sampled static positions. Bounds and
sampled closed-form positions remain inside 49 km on explicit charted/rare tests,
so this candidate does not require an arrival-policy change to 50 km clearance.
The construction also supplies a universal geometric bound: lobe centres are
within 31/25 km, warped offsets within 1.28×9.5/9 km, and radius+drift within 1.1/1.2 km,
giving 44.26 km charted / 37.72 km rare. Curved bridges are tighter. These bounds hold
for every seed and clock, independently of the sampled tests. No corpus-wide
worst-case renderer guarantee is inferred from sampled views.

## Synchronous hardware-render costs

Apple M5 Pro / ANGLE Metal, 1440×900 DPR 2, render scale 1; actual settings and
shadow-map state are in each row. Both quality levels, AA0/AA2 and pinned shadow/
AO off/on are measured. Each arm has six reordered blocks of 48 frames after a
warm pass. Timings use performance.now plus readPixels drains: synchronous
hardware-render frame cost including CPU and GPU, not pure GPU timer elapsed
time. The clock advances manually over two seconds; no flight or CCD step runs.

There are 160 world-cost rows. Each field arm has a matched no-field control.
Common far/inside cameras isolate the same world pose. `sharedclose` uses the
same numeric slot and physical shape/radius/spin/drift at the same relative
close distance, moved to each layout's anchor. Background workload still differs.
`close` chooses each layout's largest rock; `dense` chooses its own density peak.
Those targeted stresses are not a layout-only speedup comparison.

| Fixture / AA | Baseline high / low peak Δms | Organic high / low peak Δms | Max added organic calls high / low |
|---|---:|---:|---:|
| charted / 0 | 1.052 / 0.323 | 0.961 / 0.318 | 5 / 3 |
| charted / 2 | 1.536 / 0.628 | 1.333 / 0.568 | 5 / 3 |
| rare / 0 | 1.609 / 0.430 | 1.590 / 0.423 | 4 / 3 |
| rare / 2 | 2.426 / 0.967 | 2.377 / 0.964 | 4 / 3 |

Historical budgets remain high ≤1 ms / +12 calls and low ≤0.4 ms / +6 calls. The organic
AA2 and rare close rows fail the elapsed-time limits; their raw failures are
retained. Dense-peak rows pass these sampled limits, but that does not waive the
close failures or certify production readiness. Rejected variants were not
rerun. No performance winner is chosen from small baseline/organic differences.
Raw samples, dispersion, calls, triangles and LOD counts are in each manifest;
`world-summary.json` consolidates the peaks. Exact source and held starting
clocks are recorded separately per boot.

A separate nonreported CPU profile is retained at
`instrument-check/nonreported-cpu.cpuprofile`: the readPixels drain is the
largest individual sample group, followed by Three instance-buffer and matrix
updates. This supports a mixed synchronous graphics workload; it does not
identify pure GPU stages or justify a shader/geometry optimization claim.

## Live Navigation: verified production work

The final sets are `nav-verified-{charted,rare}-aa{0,2}`, all clean source
`2c9b7e9e371da9e940487612803e1243bd1da7ad`. Geometry, profiles and the arbitrary
anchor query remain byte-identical to 4fcc. The actual ownership is
`animate() → render(dt); updateCockpit()`; `render()` does not refresh the
cockpit. The timer now calls those two production methods in that order.
A wrapper counts the actual production `navRows()` calls and returned rock
rows inside every timed frame. Exactly one nonempty projection containing every
expected rock is required. A deliberately omitted cockpit refresh must fail
that guard before timing starts; all eight arms detect it.

**Navigation pose provenance and gap:** the immutable harness at 2c9b7e9e
(source copy in each verified set under source/organic-views.mjs) calls
`__organicView(name, "dense")` before switching to cockpit view and left look.
That function selects the candidate's peak by counting anchors within 8 km and
settles a clear chase-camera pose. The Navigation setup then records the actual
field frame, selected target, row counts, disabled rows and settings, with a
cockpit screenshot. It discarded the dense-view return value and did not record
the Navigation camera position/orientation or its local rock density. The later
manifest.rows dense entry is a separately captured chase view, not a measurement
of the earlier Navigation camera. Therefore no precise Navigation camera values
or 52/256 local-density claim is inferred for the timed Navigation frames. The
work counters prove populated production row projection; exact Navigation-pose
and local-density provenance remains an unrecorded gap for a future production
measurement. No new benchmark is run to fill it in this bounded revision.

Each arm has six alternating blocks of 24 frames, high quality, occlusion off,
actual AA and a held stationary clock. Numeric mining flag 1, actual acquired
field frame, selected row, fresh survey facts and DOM counts are asserted.
Charted baseline/organic contains 193/676 rock rows; organic includes 83 disabled
rows beyond 40 km. Rare contains 76/320 rows.

| Fixture / AA | Baseline median [min,max] ms | Organic median [min,max] ms |
|---|---|---|
| charted / 0 | 2.942 [1.558, 4.412] | 3.206 [2.913, 3.642] |
| charted / 2 | 9.171 [6.429, 9.992] | 5.179 [2.721, 10.471] |
| rare / 0 | 1.262 [1.229, 4.954] | 1.696 [1.538, 1.879] |
| rare / 2 | 2.819 [1.996, 9.754] | 7.650 [2.708, 13.875] |

Raw blocks and actual work guards are in each manifest and
`navigation-summary.json`. Dispersion leaves Navigation affordability
inconclusive; no speedup or population-penalty conclusion is drawn. These are
synchronous production rendering and cockpit-update costs, excluding deferred
browser style/layout/paint, moving flight and large-list interaction latency.
No UI optimization or threshold was changed to obtain the samples.

**Correction of earlier claims:** Sage found that the supposed duplicate
refresh was a mistaken source trace. The original 4fcc world-set Navigation
entries time one explicit refresh plus render plus an additional navRows
projection for counting. They remain extra-projection diagnostics. The later
`nav-{charted,rare}-aa{0,2}` sets at b1e62e7a omit the refresh entirely; their
render-only numbers do not measure live Navigation work and are invalid for
that claim. Their earlier flat timings do not establish low row cost.
Original manifests remain unchanged; `NAVIGATION-CORRECTION.txt` labels the
superseded scope, and `navigation-summary-render-only-invalid.json` preserves
the former summary. The verified sets above supersede both series. World-render
cost rows and field images are unaffected by this correction.

## Arbitrary-anchor query prototype

The production lattice cannot index these continuous anchors. `anchor-query.ts`
is a separate study adapter: arrays per arbitrary spatial bucket, actual anchor
bounds, full shape-reach/drift envelopes and the same production solid/reach
predicate. It does not silently reuse the old one-rock-per-cell query. Tests
compare its complete reach sets and motion signatures against independent full
traversal, and compare the native baseline against production fieldRockSolids.
Widths1.7/4/9km, clocks0/1000/1e6, occupied points, crossings, enclosing reach,
multiple fields and a deliberately omitted occupied rock are covered. The
oracle validates reach sets and motions, not the settled predicate or full CCD.

`query-cost.json` has 48 rows, six alternating-order blocks, cold generation/index
costs and 64-query warm batch means, with output signatures/counts checked.
Nonempty rock-centred high-speed crossings are guarded independently; the
centreline crossing may be empty and remains a labelled synthetic stress.
Generic cold construction eagerly indexes all fields, whereas native production
lazily builds nearby fields. These costs are implementation-specific and cannot
prove an isolated index speedup. Organic occupied warm batch means are about
0.004–0.005 ms; eager cold generation/index costs are roughly 3–5 ms on these
fixtures, excluding the separately prebuilt authored collision pieces. The latest
run reuses the shared median helper; the original upper-middle aggregation is
retained as query-cost-upper-median-original.json. Per-file source hashes
identify the exact measured input. Full
flight, collision CCD and first-frame hitch handling remain production work.

## Remaining integration gates

This study proposes geometry and measures limits. A production build must make
rendering, targeting, frame acquisition, discovery and collision consume the
same approved layout; append production RNG domain tags deliberately; bump
FIELD_GENERATOR_VERSION and invalidate changed field deposits/readings while
preserving discovery knowledge and independent world identity. It must resolve
close-view budgets, measure moving/advancing flight and full CCD, and reassess
larger ore availability against the approved economy. Principal approval and
the canonical production view set remain required before shipping. The queue
stays paused; #1043 and draft PR #1203 stay open.

## Verification revisions and input equality

Verification is recorded at its actual input revision, rather than represented
as a fresh whole-tree test at the final report revision:

| Evidence | Actual tested/measured input | Scope |
|---|---|---|
| 15 affected tests, 547375 assertions | b1e62e7a plus in-progress receipt-only edits | Four study test files and their production/study dependencies; /tmp/field1043-study-tests-final.log |
| Production build, distribution-size check | b1e62e7a plus receipt-only edits, before cc292230 was committed | TypeScript/Vite build inputs; /tmp/field1043-build-final.log |
| World images and 160 timing rows | Clean 4fcc3de6 | Actual renderer arms and per-file hashes in cost-* manifests |
| Verified Navigation work | Clean 2c9b7e9e | Four nav-verified-* manifests; actual in-timer calls/rows and missing-refresh control |
| Later strict spike TypeScript check | ea7ecbce TypeScript input contents | Includes the shared-median instrument edit; /tmp/field1043-review-spike-tsc.log |
| Final report guards and selected PR gate | d7e3a3f2 report-guard revision | Report-only guards and prose; /tmp/field1043-final-clean-gate.log, zero selected probes |

No new 15-test suite or production build ran at d7e3a3f2. Their reuse is justified
by tracked-input equality, not by claiming a fresh final-tip full-suite pass.
cc292230 contains the receipt following the b1 tests/build; Sage round 1 reviewed
that later receipt revision. Repository TypeScript, both format scopes, script
lint and comment lint passed at the recorded local checks. The unrelated full
unit run was interrupted cleanly (exit 130) after 356 files started and is not
a pass; /tmp/field1043-unit-final.log remains partial.

Replay the report guards and tracked-input comparison independently:

```sh
node spikes/field-shape-1043/verify-report.mjs /tmp/seelite-field-shape-1043-organic d7e3a3f2
```

The script copies the eight immutable input manifests into a fresh scratch
directory, first verifies the valid case, then independently introduces dirty
source, mismatched head, mismatched file hash and missing timing-row mutants.
Each must exit nonzero with its specific expected error. Originals are never
mutated. It writes the actual outcomes and Git tree digests to
report-verification.json beside the gallery; the scratch path is retained.

The same script proves equality through d7e3a3f2: 1713 tracked production-build
input identities match b1e62e7a and cc292230; 1723 affected headless input
identities match b1e62e7a; organic.ts, profiles.ts and anchor-query.ts match
measured 4fcc3de6. It also compares every strict spike TypeScript input with
ea7ecbce. The build scope conservatively includes all tracked files outside
docs/ and spikes/. The affected-test scope adds study TypeScript except the
separate anchor-measure.ts CPU instrument, which no affected test imports.
These are exact Git blob/mode/path comparisons including asset references, not
an installed-dependency or operating-system snapshot. Passing HEAD as the final
argument repeats these comparisons through a later documentation/verification
tip without relabelling earlier test executions.

Build had only the existing large-chunk warning. Sage round 1 reviewed cc292230
and found the Navigation work-guard defect; corrected claims and immutable
negative-control evidence are retained above. Sage round 2 reviewed ea7ecbce:
four suggestions, zero blocker/important findings. The d7 response enforces
160 actual timing rows and clean/common heads plus matching hashes; optional
oracle/browser-bootstrap refactors were deferred for independence/provenance.
The map stop rule does not require another review loop for bounded report and
prose responses. Canonical production views and principal approval remain open.
No browser or performance coverage is inferred from a selector returning zero.
