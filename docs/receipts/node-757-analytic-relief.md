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

The stated legacy tolerance is **p95 < 10°, p99 < 16°, maximum < 30°**
over this pixel sample. This is agreement with a finite-spaced approximation,
not a claim that both normals are identical. The legacy `e=0.0035` step smooths
ridged cusps and narrow coastlines. The probe sweeps smaller spacings, holding
the `2e` strength convention constant: p95 is 3.632° at `e=0.001`, 0.722° at
`0.00035`, and 0.356° at `0.0001`, before rounding error raises it to 0.894°
at `0.000035`. This diagnoses the initial overly tight legacy bound and selects
a precision-qualified control; no shipped parameter was retuned. The fine
control gates p95 at 0.5° at 2R and 2° at 1.2R, rejecting both injected defects.

At 1.2R, all 256,000 drawn normal pixels are finite. Switching the octave cap
from zero to six changes 374,977 RGB components by more than `1e-4`; relief
against the unperturbed sphere changes 361,799 components. The differentiated
height's value agrees with the scalar height to a maximum absolute error of
`0.00006199` (gate `1e-4` of the height's 0..1 range); scalar and vector
accumulation round differently. These are fixed-fixture correctness readings,
not performance figures or a ruling to switch the shipped path.

## Verification scope

The targeted GPU runs passed: gradient **10/10**, footprint **44/44**, live
planet surfaces **114/114** checks. Build (including typecheck), formatting and
lint passed. The 285 tests in the 19 directly affected shader, routing,
headless-boundary and script-contract files passed in targeted runs.

The mandatory single `npm test` run reported **6,470 pass, 1 fail**, across
375 files in 678 seconds. RTK's filter discarded the failing test's identity,
and no raw tee log was saved by that sandboxed invocation. The failure remains
unidentified; this receipt does **not** claim that it also fails on the base.
The supervisor's merge-base comparison is still required. No second full unit
run was made, and no unrelated test was changed to conceal the failure.

The footprint probe also covers original pixels at zero cap,
determinism, the distant fade, all other classes and the canonical horizon cap
pairs. This is targeted coverage, not a full browser-suite pass. The supervisor
owns the final reviewed-head browser gate, review and publication.
