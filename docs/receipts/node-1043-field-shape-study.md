# Asteroid field-shape study — node #1043

This is a reviewable prototype, not an approved field profile. No production source or runtime behavior changes; node #1043 remains open for principal visual judgment and its remaining integration measurements.

## Implementation and reproducibility

The branch contains four study profiles, arithmetic tests, a three-world count instrument and a GPU capture/cost instrument under `spikes/field-shape-1043/`. Its README gives the commands. Captures, raw samples and contact sheets live outside the repository. Production `FieldDraw`, the authored asteroid model, `fieldRocks`, shape/radius draws, motion and LOD selection are reused. No field shape, material or level threshold is retuned.

The candidates are baseline; 2.5x semi-axes with sparse occupancy; 3x semi-axes with two smooth clusters, voids and a soft edge; and the clustered layout with cell-contained box jitter. These are comparison inputs, not policy rulings.

## Counts and settled costs

Count corpus: worlds 47, 7 and 0x5ee11e, galaxy0. The charted bucket contains 292 fields; the rare bucket 147. These are bucket sample sizes, not galaxy counts.

| Kind | Candidate | Cells | Rocks min / p50 / p99 / max | Semi-axes km | Cell km |
|---|---|---:|---|---|---:|
| charted | baseline | 531 | 156 / 185 / 211 / 214 | 24 × 12 × 6 | 2.4 |
| charted | expanded | 2445 | 240 / 294 / 330 / 342 | 60 × 30 × 15 | 3.6 |
| charted | clusters | 4107 | 468 / 519 / 555 / 574 | 72 × 36 × 18 | 3.6 |
| charted | broken | 4107 | 468 / 519 / 555 / 574 | 72 × 36 × 18 | 3.6 |
| rare | baseline | 227 | 66 / 90 / 108 / 111 | 16 × 10 × 6 | 2.6 |
| rare | expanded | 1059 | 98 / 127 / 154 / 159 | 40 × 25 × 15 | 3.9 |
| rare | clusters | 1823 | 191 / 225 / 258 / 262 | 48 × 30 × 18 | 3.9 |
| rare | broken | 1823 | 191 / 225 / 258 / 262 | 48 × 30 × 18 | 3.9 |

The original heightfield file remains 786,480 bytes and the sixteen archetypes are reused. Higher rock count increases instance and lattice-row counts, not heightfield-archetype storage. The largest candidate lattice index magnitude is at most 21, inside the current signed lattice-key range. Headless tests prove the bound, drift and half-margin remain inside every indexed cell, including explicit rare fixtures. This is the broadphase containment premise, not a production collision-query timing measurement. Production `buildLattice` still reads the shipped profile directly; an integration must make drawing and collision consume the same chosen layout and measure that real path.

## GPU method and measured scope

ANGLE Metal / Apple M5 Pro, 1440×900, device scale2, render scale1. Each run has twelve shuffled blocks ×120 frames per field/control arm, one warm pass and readPixels drains; the shared median, shuffler and pair-separation functions are imported. Every timed frame advances the held clock by1/60s within a two-second window and re-stands the camera. Both quality sides, both pinned shadow+AO states, and close/inside/edge/far are included. Antialias conditions are separate runs, not same-condition repeats. No corpus-wide worst-case guarantee is claimed.

Far uses the same224km centre distance across candidates. Inside uses the same field-frame coordinate(1.8,1.8,1.8)km. Edge stands2km outside each candidate's own long semi-axis. Close uses each candidate's own largest rock at1.2 bounding radii, so close is not a same-rock comparison. The no-field control is matched to each candidate's own framing. Camera range, position error, axis error, levels, calls and raw blocks are in each manifest; empty close/inside arms refuse.

| Fixture and AA | Candidate | Worst high Δms | Worst low Δms | Max added calls high / low |
|---|---|---:|---:|---|
| s173 charted, AA0 | baseline | 0.973 | 0.280 | 4 / 3 |
| s173 charted, AA0 | expanded | 0.541 | 0.161 | 5 / 3 |
| s173 charted, AA0 | clusters | 0.566 | 0.169 | 5 / 3 |
| s173 charted, AA0 | broken | 0.555 | 0.170 | 5 / 3 |
| s173 charted, AA2 | baseline | 1.430 | 0.492 | 4 / 3 |
| s173 charted, AA2 | expanded | 0.728 | 0.187 | 5 / 3 |
| s173 charted, AA2 | clusters | 0.742 | 0.193 | 5 / 3 |
| s173 charted, AA2 | broken | 0.750 | 0.201 | 5 / 3 |

The baseline AA2 close/shadow+AO-on row exceeds the historical high≤1.0ms and low≤0.4ms budgets. This is retained as a measured limitation, not tuned away. The three candidate charted fixtures stay below both timing budgets in these samples. The closer surfaces differ between profiles, so this does not rank an abstract rendering scheme independently of its subject.

Rare-field AA0 counterexample: all four profiles exceed the high-quality 1.0ms budget at close/shadow+AO-on.

| Rare s0 candidate | Worst high Δms | Worst low Δms | Max added calls high / low |
|---|---:|---:|---|
| baseline | 1.539 | 0.381 | 4 / 3 |
| expanded | 1.358 | 0.310 | 5 / 3 |
| clusters | 1.217 | 0.307 | 5 / 3 |
| broken | 1.208 | 0.308 | 5 / 3 |

No candidate is declared affordable across the measured scope. The charted fixture cannot stand in for the larger rare rocks. No layout, material or gate was altered to conceal this counterexample. The existing baseline also exceeds the high timing budget on the rare fixture.

## Evidence files

- /tmp/seelite-field-shape-1043/index.html: system173 charted, AA0, 64 rows, 36 captures. Instrument e89a8f7f89b27691015bbd9d08fd22f89883458c; held clock starts 1.616400s; order seed7; max camera miss3.261e-8km, max axis error0.000000degrees. Raw blocks, levels and calls: manifest.json in the same directory.
- /tmp/seelite-field-shape-1043-aa2/index.html: system173 charted, AA2, 64 rows, 0 captures. Instrument 7bea8cf24b569a6908dd0dce5bee21cef8423a16; held clock starts 1.601500s; order seed20261019; max camera miss2.008e-8km, max axis error0.000000degrees. Raw blocks, levels and calls: manifest.json in the same directory.
- /tmp/seelite-field-shape-1043-rare/index.html: system0 rare, AA0, 64 rows, 36 captures. Instrument 7bea8cf24b569a6908dd0dce5bee21cef8423a16; held clock starts 0.999200s; order seed99; max camera miss9.135e-9km, max axis error0.000000degrees. Raw blocks, levels and calls: manifest.json in the same directory.
- /tmp/field1043-corpus.json: full three-world count corpus and comparison-field anchor maps.
- /tmp/field1043-{gpu-run1,gpu-aa2,gpu-rare}.log: renderer and raw row logs.
- /tmp/field1043-sage/jcfischer-seelite-1203.md: Sage verdict, five suggestions.
- /tmp/seelite-field-shape-1043-review.html: landing page linking charted and rare contact sheets.

There are 192 timing rows and 72 captures. These are one run per stated fixture/AA condition, not repeated identical-condition runs. The held clock start differs across boots and is recorded; within each run every candidate shares that clock.

## Scope, identity and release consequences

The actual cockpit scope displays field-centre contacts, not the rock distribution. The four scope rows on each contact sheet preserve that representation; manifest contact coordinates agree to numerical placement error. A density/extent indicator on the scope remains a separate design question.

All nonbaseline layouts change cell enumeration and move existing anchors in charted and rare fields. A production choice requires a FIELD_GENERATOR_VERSION bump and #951 deposit/reading resets for changed-fingerprint fields. Carrier identities and WORLD_GENERATOR_VERSION remain independent. The study changes neither version and never writes a save. Integration must give new density and jitter streams their own appended domain tags rather than accidentally adopting the study salts.

## Verification and remaining work

The initial arithmetic run failed because the profiles module was absent. Explicit profile-bucket coverage then failed because all three original fixtures were charted; generated rare fixtures made the check nonvacuous. Final arithmetic: 7 tests, 67,819 assertions pass. Standard typecheck, format, script lint, comment lint, wiring and build passed. A separate strict TypeScript invocation covers the study modules because the repository tsconfig excludes spikes. The measurement script passes node --check.

Sage empty-arm guarding and realised-layout tests were taken. The asynchronous-WebGL-query suggestion was declined after inspecting setOcclusion/applyOcclusion: they pin shadow/AO passes, not query-based culling. Loop extraction was declined for this throwaway instrument. The verdict and response are on PR1203; stop under the suggestion-only rule.

The final selector and probe:pr use the exact base/head recorded on the PR. This isolated study selects 0 probes under the spike rule: no production browser-suite pass is claimed. Dedicated GPU runs above verify the study surface and timings. CI passed build/static/unit gates on the instrument head.

Still owed before close: principal visual choice, canonical view-set acceptance, a measured resolution of the rare close-view budget counterexample, and real candidate collision/broadphase timings when the selected layout is wired. Any separate integration build must block release1197. No aesthetic approval or release completion is claimed.
