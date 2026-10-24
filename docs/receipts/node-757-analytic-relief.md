# Node #757 — terran analytic-gradient relief

`analytic-gradient` is the fourth compiled relief arm. Terran still ships
`screen-space`; other classes retain their existing programs. The policy type
admits the analytic choice for terran only. This is an instrument arm, not a
change to the default appearance, and is not a major changelog entry under
`src/changelog.ts`'s definition.

The derivative carries value noise's cubic interpolation through octave
frequency and amplitude, the domain warp's full Jacobian, stretch, both
smoothstep masks, and the ridged fold. At the fold's nondifferentiable cusp,
`sign(0)` chooses the symmetric zero slope. Footprint and cap are held fixed
while differentiating, as they are in the four-tap samples. Both the base and
extended octaves contribute to the derivative. No screen derivatives or finite
differences enter the analytic arm. The tangent projection and `0.007` strength
factor retain the four-tap normal convention.

Two unit-test SHA-256 pins hold the pre-node screen-space terran source, with
and without footprint support, byte for byte. Analytic helpers and the relief
splice are assembled only for the new terran arm. The cost instrument imports
the shared roster, supports `--classes terran --relief analytic-gradient`, and
omits unsupported class/analytic cells rather than pricing a four-tap fallback
under an analytic label. An explicit analytic request covering another class
is refused.

## Rendered comparison and its tolerance

`scripts/probe-planet-gradient.mjs` uses the shipped material and shader
assembly, a unit sphere, fixture `footprint-47`, a 640×400 floating-point target
and a 60° camera. The 2R camera stands on +Z. The 1.2R camera faces the surface
direction with the strongest measured 2R relief, keeping both close arms at
that same pose. A +Z close view sees ocean and would not exercise relief.

Normal output is read before sanitisation, lighting, encoding and bloom. A
separate validity channel rejects non-finite or invalid normals. Angular
comparisons count only pixels perturbed in either arm; identical ocean normals
cannot inflate the passing fraction.

Measured on **Apple M1 Pro, ANGLE Metal**, on this host:

| Comparison | Relief pixels | p95 | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Analytic vs legacy four-tap, 2R | 8,803 | 8.965° | 14.894° | 25.868° |
| Analytic vs fine four-tap (`e=0.0001`), 2R | 8,208 | 0.356° | 1.833° | 13.760° |
| Missing warp Jacobian vs fine control, 2R | 8,211 | 14.419° | 19.146° | 37.013° |
| Analytic vs fine four-tap, extended field at 1.2R | 120,865 | 1.493° | 6.366° | 21.029° |
| Missing extended ridge octaves vs fine control, 1.2R | 120,865 | 14.561° | 19.995° | 37.989° |
| Missing extended fbm derivatives vs fine control, 1.2R | 120,870 | 20.026° | 28.437° | 49.457° |

The stated legacy tolerance is **p95 < 10°, p99 < 16°, maximum < 30°**
over this pixel sample. This is agreement with a finite-spaced approximation,
not a claim that both normals are identical. The legacy `e=0.0035` step smooths
ridged cusps and narrow coastlines. The probe sweeps smaller spacings, holding
the `2e` strength convention constant: p95 is 3.632° at `e=0.001`, 0.722° at
`0.00035`, and 0.356° at `0.0001`, before rounding error raises it to 0.894°
at `0.000035`. This diagnoses the initial overly tight legacy bound and selects
a precision-qualified control; no shipped parameter was retuned. The fine
control gates p95 at 0.5° at 2R and 2° at 1.2R, rejecting all three injected defects.

The fbm mutation zeros only the extended-loop derivative frequency inside
`fbm5FootprintAndGradient`; its base derivatives, values, weights and
normalisation remain intact. It therefore tests omission of the extended fbm
derivatives without changing the height field seen by the two arms. The
existing 2° close gate rejects it without any tolerance adjustment.

At 1.2R, all 256,000 drawn normal pixels are finite. Switching the octave cap
from zero to six changes 374,977 RGB components by more than `1e-4`; relief
against the unperturbed sphere changes 361,799 components. The differentiated
height's value agrees with the scalar height to a maximum absolute error of
`0.00006199` (gate `1e-4` of the height's 0..1 range); scalar and vector
accumulation round differently. These are fixed-fixture correctness readings,
not performance figures or a ruling to switch the shipped path.

## Verification scope

Current verification on 2026-10-22 retains the measured gradient figures above.
The gradient GPU probe passes **11/11** and footprint passes **44/44** checks.
The gradient comparison now also rejects invalid four-tap and flat reference
targets, requiring their drawn pixel counts to match the analytic target.
That additional assertion was observed red before its measurements were wired
in. Build (including typecheck), formatting, Biome lint and ESLint passed.

The single full host `npm test` run reported **6,763 pass, 2 fail**, across
397 files in 1,279 seconds. Complete output is retained at
`/tmp/node-757-npm-test.log`. Its failures are identified:

- `tests/game-url.test.ts`, `no script builds a game URL by hand`: the new
  gradient probe navigated to the bare origin. It now opens the tree declaration
  for its offscreen renderer, with that exact navigation registered in the
  existing non-game table. The table's stale-exemption check was observed red
  before the navigation changed. The subsequent URL, gradient, cost and relief
  policy run passed **101/101** tests across four files.
- `tests/rock-heightfields.test.ts`, `decoded uint16 fields meet the selected
  spike's Euclidean budgets per archetype`: all 16 fit rows met their numeric
  bounds, but the test exceeded its existing 300-second limit at 314.5 seconds.
  The test, its helpers and its model data are unchanged from merge base
  `2dd890e`. At that base the isolated case passed in 98.5 seconds; this does
  not establish a reproduced base timeout. The branch's isolated rerun also
  passed, in 121.7 seconds (**1/1**, 48 assertions). The full-suite timeout's
  cause remains unattributed. No heightfield code or timeout was changed.

No second full unit run was made under the worker SOP. The preceding worker's
unidentified full-run failure is superseded by this named, fully logged run.

The broader `probe-planet-surfaces.mjs` timed out in `bootedGame` after 20
seconds, twice on the branch and once on an immutable merge-base snapshot.
The first branch run and the base run stopped at the same later boot on line
2257; the second branch run stopped at its initial boot. Host peak loads were
73.9, 93.6 and 72.3 respectively. This is a reproduced base failure, not a
current surface-probe pass; the cause of the boot timeout remains unattributed.

`npm run lint:comments` also fails its suppression-growth guard relative to
newer `origin/main`. The same two entries fail at the branch's merge base:
`scripts/probe-planet-footprint.mjs` (14 to 15) and `src/authored-hull.ts`
(27 to 33). ESLint itself passes. Those unrelated baselines were left intact.

The footprint probe also covers original pixels at zero cap,
determinism, the distant fade, all other classes and the canonical horizon cap
pairs. This is targeted coverage, not a full browser-suite pass. Probe selection
was inspected before running probes; it selected 111 contracts. The supervisor
owns the final reviewed-head browser gate, review and publication.

## Sage round 1 — 2026-10-23

All four findings were taken. `fragmentFor` now refuses non-terran analytic
requests; its desert rejection test failed before the guard and passes after
it. The cost instrument uses one `supportsRelief` predicate for explicit
request validation, sweeping and reporting. The gradient probe uses one
`spaced(e)` helper for both its fine control and convergence sweep, and adds
the derivative-only fbm mutation measured above.

The GPU gradient probe passes **12/12** checks on **Apple M1 Pro, ANGLE Metal**;
the other measured gradient figures are unchanged. Affected headless tests
pass **124/124** across six files, including both shipped screen-space shader
source pins. Build/typecheck, formatting, Biome lint and standalone ESLint pass.
The comments suppression-growth guard still reports the same two entries as
above; comparison of merge base `2dd890e` against `origin/main` reproduces
both entries, and this branch leaves the baseline unchanged.

This round's single full host `npm test` run passes **6,765/6,765**, with
**0 failures**, across 397 files in 931.23 seconds. Its complete output is at
`/tmp/node-757-review-npm-test.log`. The rock-heightfield case that timed out
in the prior full run passes here in 154.3 seconds.

Probe selection was inspected again before the targeted run (111 contracts
selected); the supervisor retains the broader final-head browser gate.

## Base merge pass — 2026-10-24

Merged `origin/main` at `b8f53d3b` as `cb3a54cf`, without conflicts.
The single full host `npm test` run returned **6,874 pass, 1 fail** across
405 files in 991.09 seconds. RTK omitted the failure details and saved no
recovery log. A focused rerun reproduced one failure: the shipped-terran
source hash assertion in `tests/planet-gradient.test.ts`.

The merged cloud helper changed source formatting. Both screen-space terran
programs, with footprint off and on, were compared as complete strings against
an isolated `git archive origin/main src` snapshot and were byte-identical.
The two hash pins now record that merged base; no production source was edited.

After the repair, **125 tests pass, 0 fail** across eight affected and guard
files (`/tmp/node-757-merge-targeted-tests.log`), and `npx tsc --noEmit` passes.
The full command was not repeated under the worker's once-only rule; the
supervisor's final full run remains pending. No browser probes ran in this
base-only pass.
