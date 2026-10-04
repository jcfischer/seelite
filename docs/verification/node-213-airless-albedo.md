# Node #213: airless populations and albedo

Implementation evidence, not a graph-close receipt. Parent: `8017a887`.

`src/airless-features.ts` walks a jittered low-frequency cell shell once per
body, takes four jittered candidates per cell, selects 2–4 separated basins
with a bounded backtracking search, and uploads centre/radius descriptors.
Round 2 precomputes scalar pair compatibility for at most 500 candidates
(at most 124,750 pair checks) and caps backtracking at 10,000 candidate visits.
Round 3 makes exhaustion a reported result rather than a body-build exception:
an exhausted basin search disables both sparse populations, and fewer than two
eligible ray sources disables rays while retaining the basins. The surface
builder warns with the seed and exhausted population, uploads zero for the
affected counts, and keeps the existing crater terrain drawable. These are
degraded pictures, not successful population generation. The cap still bounds
the search; it does not prove that every uint32 seed succeeds.
An adversarial candidate menu exercises budget and candidate exhaustion, and a
forced-exhaustion test builds the production moon with both counts at zero.
`tests/airless-features.test.ts` now includes the reproducible 4,096-seed sweep:
seeds 0–2047 plus 2,048 seeds spaced across uint32, ending at `0xffffffff`.
Every corpus seed must complete without degradation with 2–4 basins and 2–3
rays. This replaces the earlier uncommitted sweep as the safety evidence.
Their chord radii are 0.70–0.80 (smaller with four basins for packing room);
small impacts retain the existing 8x field's 0.020–0.0625 radii. Basin interiors
suppress crater slope, carry dark basalt,
and have a narrow albedo rim. The inner 94% of a basin is flat, with a smooth
transition to its edge. Maria variation is three low-frequency noise octaves
multiplied by the basin-floor mask. Basalt is 0.015/0.014/0.017; the floor
blend is 0.96 + 0.04 × low-frequency noise. Warm highlands and cold frost retain
the parent reflectances (0.235/0.225/0.210 and 0.400/0.415/0.440).

The youngest 2–3 surviving small impacts are selected by a seeded age ordering
among surface-intersecting fine-field cells outside the flooded floors.
The shader reconstructs their anchors with the crater field's own hash. CPU
float arithmetic only selects candidates: it cannot guarantee GPU eligibility.
Round 4 adds a GPU guard that rejects reconstructed sources away from the shell
or inside a flooded basin (including one source-radius of clearance). Rejection
can reduce the displayed population below the CPU-selected 2–3 rays. The earlier
claim that CPU rounding cannot affect source survival is withdrawn.
Two angular harmonics make irregular radial streaks, fading between two and
nine crater radii. Rays change albedo only.

`height` retains two crater octaves, and `craterRelief` is byte-identical to
the parent shader retained in `scripts/lib/fixtures/airless-before-213.ts`.
Removing the old height-based brightening removes its redundant height sample.
Both new populations enter the existing albedo/normal bake. The baked draw
shader is unchanged and evaluates none of these new terms. Filling views
still use the procedural fallback; the feature is present on High and Low.

## Rendered comparisons

`probe-planet-surfaces` renders production bake programs into float targets.
For each seed it compares the same 143,616 face-on samples with the frozen
parent shader: identical seed, warmth, directions, and resolution; no tone
mapping or lighting can impersonate albedo contrast. Each of the six faces
contributes samples whose face-on cosine exceeds 0.65.

Round 1 replaces the raw variance oracle with variance divided by mean
albedo squared. A uniform reflectance gain therefore cancels. The combined
gate requires a parent ratio of 1.5–6 and at least 1.5× contrast against the
same current shader with both sparse terms disabled. The wider upper bound
allows the two-, three- and four-basin footprints; it is a contrast envelope,
not a guarantee of appearance. The count buckets were selected before the
repair measurements. On ANGLE Metal / Apple M1 Pro:

| Seed | Basins | Relative variance, after/parent | Raw variance, after/parent | Feature-on/off relative variance |
| --- | --- | --- | --- | --- |
| 0 | 2 | 1.54 | 1.65 | 104.60 |
| 1 | 3 | 2.30 | 1.93 | 157.39 |
| 47 | 4 | 3.30 | 2.09 | 223.25 |
| 48 | 4 | 3.22 | 2.05 | 222.83 |
| 179 | 4 | 3.49 | 2.16 | 203.31 |

The original raw gate was unsound: raising highland reflectance could pass
it. Restoring the parent highland colour exposed insufficient contrast
(relative ratios 0.27–0.54). The revised broad, dark basin floors supply
the difference, rather than raising every highland's brightness.

The rendered highland-only brightening control has a relative parent ratio
of 1.57–1.60: normalisation alone does **not** reject it because its basalt
remains fixed. Round 1 prescribed its feature-on/off ratio as a literal 1,
so its claimed control-rejection evidence was invalid. Round 2 renders both
the enabled and disabled feature-uniform arms of the highland-only control
and a repeat of the feature-off control, then computes both ratios through
the same helper as the production subject. The probe feeds these measured
rows into the same gate and also offers the rendered production subject as
a positive control, which must defeat negative-control rejection. The
current shader with sparse features off reads 0.014–0.018 relative to the parent.
These rendered controls are required probe rows. The uniform-gain ratio of
1.000 was computed by scaling parent samples in JavaScript, so it is an
arithmetic identity, not a rendered control. Round 4 removes that computation
from the browser instrument; the unit test retains the gain-invariance check.

At identical directions with sparse features disabled, warmth 0/7 reads
0.547 near-star/cold highland luma for every seed, inside the 0.5–0.6 band
from the retained palette's luminance ratio. Near-star darkening therefore
survives in the rendered shader, as well as in a palette regression test.

The probe also measures a basin floor against the same patch with basins
disabled: albedo is below 65% of its control and normal tilt below 2% of its
nonzero control. This distinguishes floors from the retained crater terrain.
Ray-on/off readings require actual bright pixels and unchanged normals. Seeds
47 and 48 have distinct centre directions and
both have painted dark, flat floors at their expected direction.

## Verification

- Round 1: `rtk test npm test`: **4,900 pass, 0 fail**, exit 0. RTK prints a
  misleading FAIL heading because a passing reporter test contains that word;
  the underlying Bun summary has zero failures.
- `npx tsc --noEmit`, `rtk lint npm run format:check`,
  `rtk lint npm run lint`, `rtk err npm run build`, and
  `npm run check:wiring`: pass. Vite retains its existing chunk-size warning.
- Selected hardware runs: `npm run probe:one -- planet-surfaces` and
  `npm run probe:one -- planets`: pass on **ANGLE Metal / Apple M1 Pro**.
  The round 1 surface run includes all five seeds and the new contrast controls.
  These are partial runs.
- Generator tests span 83 seeds, including large uint32 seeds, and check
  all population counts, basin separation, crater intersection, rays outside
  flooded floors, and the generated moon's actual shared uniforms.

The selector returned `all` for shared `scripts/lib` infrastructure. The
worker's explicit instruction forbids the full suite; the supervisor owns
`npm run probe` on the final reviewed head.

### Round 2 repair

- `rtk test npm test`: **4,904 pass, 0 fail**, exit 0 (250.01 s).
  RTK again labels the passing reporter fixture containing `FAIL` as a
  failure heading; Bun's summary and the exit status are green.
- `npx tsc --noEmit`, `rtk lint npm run format:check`,
  `rtk lint npm run lint`, `rtk err npm run build`, and wiring: pass.
- Round 2 hardware `planet-surfaces`: **unresolved failure**, on **ANGLE
  Metal / Apple M1 Pro**. The first run reported 103/104 checks with an
  assertion failure at peak load 37.5. Its assertion name was lost in
  truncated output; its cause is unestablished. The rerun passed at peak
  load 32.1, but that does not rule out flakiness or a defect and does not
  clear the first run. The raw logs were not retained in the repository, so
  these historical outcomes cannot be audited from this tree and are not the
  reproducible evidence for the current repair.
- Round 2 hardware `planets`: pass on the same renderer.
- The rim uses a signed distance multiplied by itself, avoiding GLSL's
  undefined negative-base `pow`. Its regression test also pins the crater
  walk and two-octave height policy. A source-text pin detects changes to the
  GLSL hash body that the CPU candidate selector mirrors. It does not compare
  CPU and GPU hash outputs numerically and is not a parity test.
- Both negative controls' **rendered** feature-on/off ratios are 1.000
  across all five seeds. Their parent ratios remain 1.57–1.60 for
  highland-only brightening and 0.014–0.018 for feature-off. Their gate
  rejection no longer receives a literal feature ratio.
- An earlier note cited an uncommitted browser mutation; that run and its
  numerical claims are withdrawn as reproducible evidence. The committed
  normal probe offers its rendered production comparison to the rejection
  helper as a positive control.
  Synthetic unit tests prove either control can defeat rejection and
  invalid/empty measurements cannot pass.

### Round 3 repair

- `rtk test npm test`: **4,906 pass, 0 fail**, exit 0 (277.90 s).
  The passing reporter fixture still triggers RTK's misleading `FAIL` heading.
- `npx tsc --noEmit`, `rtk lint npm run format:check`,
  `rtk lint npm run lint`, and `rtk err npm run build`: pass.
  The build retains the existing chunk-size warning.
- The focused generator file passes all nine tests, including the committed
  4,096-seed corpus and forced-exhaustion production body build. All corpus
  seeds complete with both requested population counts; the sweep is sample
  evidence, not an exhaustive guarantee over uint32.
- The selector still returns `all` for the branch's shared probe library.
  The explicit worker contract reserves the full suite for the supervisor.
  `npm run probe:one -- planet` passes **2/2 gating probes** (`planet-surfaces`
  and `planets`) on **ANGLE Metal / Apple M1 Pro**, peak load 29.6 on ten cores.
  The raw output was not retained in the repository; this is historical
  reporting, not an auditable record of the current head.
- The first attempt aborted Chromium with `SIGABRT` in the sandbox during
  renderer preflight, before any assertions. The same focused invocation passed
  after a sandbox escalation. Neither this pass nor the round 2 rerun explains
  the historical 103/104 assertion failure; that result remains unresolved.
- This repair changes exhaustion handling and evidence, with no shader edits.
  Successful populations retain their existing layout and shading. Optional
  shader optimizations and helper refactors were deferred; the hash guard's
  description now states its source-text-only limit.

### Round 4 repair

`scripts/lib/airless-ray-source.mjs` builds a float-target diagnostic from the
production bake program. It reads the actual ray helper's centre/radius and,
independently, the exported `CRATER_CELL` geometry that both crater walks use.
It also reads the crater distance at the GPU anchor, basin floor mask, the
production GPU guard's answer, and membership in the walk's 3×3×3 neighbourhood.
Every selected source on the five albedo-probe seeds must pass: GPU geometry
agreement within 1e-6 body radii; CPU selection agreement within 5% of the source
radius; distance below one quarter of the crater radius; floor mask zero; and
both eligibility and neighbourhood membership true. This is numerical
agreement on those seeds and the measured renderer, not bit parity or a proof
over all uint32 seeds and backends.

The diagnostic also compiles a committed mutation of the actual ray helper,
displacing each anchor by 0.02 body radii. Rendered mutated sources must fail
the same gate that accepts the production sources. Unit tests separately reject
wrong CPU/GPU centres, radii, off-shell/flooded sources, missing neighbourhoods,
and missing/non-finite readbacks. Neither control uses a hard-coded pass result.

The shared seed phase now belongs to `planet-appearance.ts`; live body and probe
uploads use `applyAirlessFeatures`. The CPU ray scan skips cells whose midpoint
is outside 1 ± 0.15. Jitter can move that point by at most √3/16, and shell
eligibility adds at most 0.0625/4: their sum is below 0.15. Six captured seed
fixtures retain their original selected cells; the 4,096-seed corpus still
checks completion and counts. `craterRelief` and the crater cell walk remain
unchanged.

- `rtk test npm test`: **4,910 pass, 0 fail**, exit 0 (288.18 s).
  The passing reporter fixture containing `FAIL` still gives RTK a misleading
  failure heading; Bun's summary and the command exit status are green.
- `npx tsc --noEmit`, `rtk lint npm run format:check`,
  `rtk lint npm run lint`, and `rtk err npm run build`: pass.
  The build retains the existing chunk-size warning. Wiring passes as the
  focused hardware runner's entry gate.

The focused hardware run passed both gating probes (`planet-surfaces` and
`planets`), 2/2, with peak load 10.3 on ten cores. The retained runner summary is
[node-213-round4-probes.txt](node-213-round4-probes.txt). The selector requested
all probes because it treats `scripts/lib` as shared infrastructure; the worker
contract restricts this run to the two covering probes and reserves the full
suite for the supervisor.

The scoped headed diagnostic also passed. Its raw source/eligibility readbacks
and all timing samples are retained in
[node-213-round4-measurements.json](node-213-round4-measurements.json), produced
by `node scripts/measure-airless-albedo.mjs`. On ANGLE Metal / Apple M1 Pro,
all 11 sources across seeds 0, 1, 47, 48 and 179 passed the shared gate; all 11
rendered displacement mutations failed it. Maximum GPU centre/radius difference
between the ray helper and the crater geometry was zero. Maximum CPU centre
difference was 0.0002461 body radii. The largest GPU shell distance was 0.2262
crater radii (rounded upward here), below the 0.25 cutoff. Every source had a
zero basin-floor mask and both eligibility/membership flags equal to one.

Round 4's 1440×900 headed `?fps` diagnostic used the same interleaved shader-arm
basis, settings and vsync-off flags as the earlier instrument runs. Nine
readings per arm; same ANGLE Metal / Apple M1 Pro renderer:

| Quality | Parent shader median (range), ms | Current shader median (range), ms |
| --- | --- | --- |
| High | 5.10 (4.94–5.35) | 5.17 (4.93–5.41) |
| Low | 5.13 (4.87–5.35) | 5.22 (5.14–6.72) |

The 200-radii control spans 4.90–5.25 ms; the refresh-clamp refusal passed.
The arms overlap, establishing no attributable cost change. All four High/Low
parent/current PNGs were opened. This is shader-control evidence, not two
canonical builds or the principal's visual approval.

## Visual and delivery gates still owned by the supervisor

The named `planet-fill` and `planet-terminator` rows are desert and terran,
so assigning node #213 to their `covers` would be false. No prior row shows
an airless surface. `airless-fill` now frames seed 47's generated
`planet-5-moon-0` at two radii, with lever #213 and a caption naming its evidence.
The view count and contact-sheet clock-span pins were updated.

`scripts/measure-airless-albedo.mjs` captures headed High/Low shader-control
PNGs and writes `view-set/airless-cost.json` at 1440×900, pixel ratio 1,
resolution 100%, AA off, and forced procedural four-tap. It alternates arm
order over three blocks, taking three `?fps` readings per block, with
`--disable-gpu-vsync --disable-frame-rate-limit` and a refresh-clamp refusal.
It is a same-scene **parent-shader/current-shader** diagnostic, not canonical
captures of two complete builds. The screenshots were opened for inspection.

Round 1 headed run on ANGLE Metal / Apple M1 Pro, nine readings per arm:

| Quality | Parent shader median (range), ms | Current shader median (range), ms |
| --- | --- | --- |
| High | 9.27 (8.11–12.95) | 8.78 (8.09–9.09) |
| Low | 9.41 (8.93–14.31) | 9.13 (8.73–11.05) |

The 200-radii control spans 8.83–9.31 ms. No cost change is attributable from
these overlapping readings. An earlier run spanned 8.43–24.21 ms across its
arms under load; that dispersion is why no performance gain is claimed.
The structural zero for the baked path is the unchanged draw program, not a
timing subtraction. JSON retains every reading and the renderer identity.

Round 2 reran the headed diagnostic with per-quality source caching and
restoration of the production shader before each quality switch. All four
High/Low parent/current PNGs were inspected. Same renderer and diagnostic
basis as above, nine readings per arm:

| Quality | Parent shader median (range), ms | Current shader median (range), ms |
| --- | --- | --- |
| High | 5.14 (4.88–5.44) | 5.12 (4.95–5.30) |
| Low | 5.07 (4.86–5.14) | 5.08 (4.97–5.27) |

The 200-radii control spans 4.94–5.03 ms. The refresh-clamp refusal passed.
These overlapping arms establish no attributable frame-cost change, and
the figures must not be compared across diagnostic runs as a build delta.

The supervisor still owes the canonical before/after contact sheet from two
builds, its headed cost comparison, the principal's yes, Sage review, the
principal's merge, and checkpoint `cp-seelite-airless-albedo`. No graph node
was changed. The changelog sentence for node #213 is proposed copy awaiting
the principal's approval before merge.
