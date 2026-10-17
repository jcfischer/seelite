# Node #756 — terran clouds on the footprint octave helper

The live terran weather shell's two coarse scales — the broad cloud field at
frequency 2.3 and the wisps at 8.5 — run through the footprint helpers #755 shipped
(`src/planet-footprint.ts`), so cloud edges and wisps keep detail from 1.6R down to the
1.2R boundary instead of going soft at station altitude. Nothing else about weather
changes: coverage, drift, cirrus, lightning, ground shadow and the dust shells keep
their shipped behaviour.

`CLOUD_FIELD_GLSL` is emitted from one template twice. The base arm keeps the original
fixed-extra-octave arithmetic and is what the coverage bake, the ground's cloud shadow
and every non-coherent class (desert dust, ice, jovian) select. The footprint arm differs
only in `broad` and `wisp`, which call `fbm4Footprint` and `fbm5Footprint` with the body's
own footprint and the shell's cap. `cloudFieldFootprint` is the wrapper the fragment calls.
The weather shell alone selects the footprint arm (`CLOUD_FRAGMENT` splices both arms and
the shared cap uniform).

The shell's footprint is its own: `cloudPixelAngle`, written by the shell's draw callback
from the height of the target that shell is actually drawn into, with the fragment's camera
distance and a grazing cosine floor of 0.1, divided by the body radius (shell radius 1.014
over `vRadius / CLOUD_SHELL_R`) so the shell reads the band in body radii like the ground.
It is not the ground's `surfacePixelAngle`: the ground can draw at half resolution while the
shells stay full-res (#720 D9). The cap is `extraOctaveCap × (1 − smoothstep(1.6, 2.0, cameraR))`,
so Low (cap 0) leaves the base arm's arithmetic untouched and a camera at 2R or beyond gets
zero extra weight, where the helper accumulates nothing.

The ground's cloud shadow still samples the baked coverage cube unchanged (#720 D4): the
bake and the shadow pass take the base arm.

## Verification

Host: ANGLE Metal / Apple M1 Pro, hardware GPU lane.

- `tests/planet-clouds.test.ts`: 8 tests, 66 assertions. The coherent arm must call
  `cloudFieldFootprint` with the body footprint and the cap, and both helpers at their own
  frequencies; the cirrus and dust arms must not gain a footprint; the two emitted bodies
  must differ only in the `broad` and `wisp` lines; the coverage bake and the ground shadow
  must keep the base arm and the cube sample; and the shell must share the body's cap uniform
  while writing its own target angle — with the separation row: the ground's draw hook writes
  its own angle for a 450-high target while the shell's dial stays at the 900 its own hook
  measured.
- Targeted files run while working: `planet-clouds`, `planet-footprint`, `planet-surfaces`,
  `planet-bake`, `planet-appearance`, `probe-selection` — 82 pass, 0 fail.
- `probe-planet-footprint`: 75/75 checks (44 before this node). Forced Low matches the shipped
  program channel for channel, and the forced cap-0 footprint arm matches the base arm exactly
  at every radius probed. Changed channels (Low vs High, then both arms against the base arm;
  repeat differences are zero throughout):

  | body radii | ground cap 0 vs 6 | ground High vs base | cloud cap 0 vs 6 | cloud High vs base |
  | --- | --- | --- | --- | --- |
  | 1.2R | 144,005 | 144,005 | 762,436 | 762,436 |
  | 1.5R | 39,831 | 39,831 | 442,434 | 442,434 |
  | 1.9R | 23,115 | 23,115 | 179,699 | 179,699 |
  | 1.99R | 676 | 676 | 2,468 | 2,468 |
  | 1.9999R | 0 | 0 | — | — |
  | 2R | 0 | 0 | 0 | 0 |
  | 3R | 0 | 0 | 0 | 0 |
  | 20R | 0 | 0 | 0 | 0 |

  No pixel tolerance is involved: the cap-0 arms read zero changed channels, and the band ends
  exactly at 2R on both layers.
- The cloud rig's detectors move on the defects they name: zeroing the footprint weight in the
  cap-0 arm moves 972,000 channels at 1.2R; carrying the band's fade past 2R moves 163,899
  channels at 2R. The ground rig's detectors still move after the isolation below (384,266 and
  21,435 channels).
- The desert dust shell is cap-invariant: 0 changed channels and 0 repeat noise against the base
  arm at any cap, on 373,350 lit channels. Its cover is raised to 0.6 in the rig only — the
  shipped 0.22 alpha rounds to zero on an 8-bit target, which would let every arm read zero
  (#94).
- The shell's angle follows its own target: 0.002566001 for a 900-high target, exactly
  double for a 450-high one. In the live frame Low leaves both weather shells at cap 0 and High
  puts six extra octaves on the terran shell while the desert shell stays at 0; surface, clouds
  and atmosphere read one `extraOctaveCap` uniform object.
- `probe-planet-surfaces`: 114/114 on three runs; one earlier run reported 113/114 at peak load
  54 on 10 cores with the failing row above the captured output, and did not reproduce in four
  subsequent runs. `probe-planets`: passes. These are manually selected affected probes, not a
  full browser-suite or PR-gate pass.
- Ground rows reproduce #755's ground-only figures (144,005 / 39,831 / 23,115 / 676 changed
  channels at 1.2/1.5/1.9/1.99R, zero at and beyond 2R) because the ground rig now hides the
  weather shells: since this node the shell is cap-driven, so its residual at 1.9999R — the band
  leaves a weight of 2e-4 on a frequency-2.3 field — read as the ground program failing to join
  the original, which is a verdict about the wrong layer. Each rig now measures the layer it names.
- Typecheck, formatting and lint clean.
- The single final review-pass `npm test` run on this host: 6,434 pass / 5 fail across 373 files
  (1,099 s). All five failures are 5000 ms timeouts in files this node does not touch
  (`vent-plumes`, `collision-stations`, `music-test-score`, `probe-impact`), and those four files
  pass 82/82 when run alone on this host. Peak load during the suite was well above the core count.

## Eye gate and handoff

`npm run probe:one -- probe-planet-footprint` on the hardware lane writes
`view-set/footprint-octaves/index.html`, PNG before/after pairs and `metrics.json`, copied out of
the ignored path to `~/.cache/seelite/ranger/756/captures/`. Left is cap 0 (base fields), right is
cap 6, one program pair, everything else fixed, on the canonical placers for planet-fill,
planet-terminator, station-horizon and planet-boundary.

On the final capture, planet-fill and planet-terminator read zero delta with zero repeat noise —
both sit at or beyond 2R. Mean absolute channel deltas are 0.156 at station-horizon and 0.0714 at
planet-boundary (0–255 display codes), both repeat controls zero. This proves the band reaches
those views; it does not prove legibility. The principal's yes on cloud-edge and wisp legibility
at station altitude remains required by `ranger:needs-eye`.

The supervisor owns push, PR, Sage, final browser selection and the merge. No graph node has been
changed or closed. This is detail tuning of an existing surface, not a new mechanic or screen under
the public changelog's definition of major. The cap's final value stays with the pricing node under
#720; the interim 6 is #755's and is unchanged here.