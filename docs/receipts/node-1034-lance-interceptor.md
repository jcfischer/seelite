# Lance interceptor integration: node #1034

Checkpoint: `cp-ship-lance-authored`.

## Current result

The accepted Lance from design PR #829, checkpoint `e96d393`, supplies the
interceptor exterior. The design branch was merged in `d56e54cb`; implementation
and initial regression coverage arrived in `b3875aaa` and `dbc59513`. This receipt
records the final worker verification and corrections on top of those commits.
The other six hulls remain studies.

`interceptor-hull.ts` uses the shared authored-hull builder, sliced fitting
preparation and loader. `model-catalog.ts` registers it with the existing
background queue. The player and Traffic keep the procedural interceptor until
installation; inspection waits for the authored hulls and postcards wait for
their frame's catalog. Failed background downloads warn once and retain the
stand-in. There is no added boot-blocking model.

The original `HULL_SPECS.interceptor` envelope remains **62.4 × 25.3 × 25.2 m**,
with the same centre, mass, thrust, hold, hardpoints and economy. The inherited
implementation had narrowed beam and height; final verification restored the
original contract. Vents were remeasured on the Full Lance and their shares
re-solved against the original inertia, preserving the existing handling law.

Production appearance, the proposed changelog sentence, Sage and the final
repository-selected PR gate remain supervisor/principal gates. No principal
flight approval or completed checkpoint is claimed here.

## Asset and geometry preflight

Reproduction:

```sh
node spikes/seven-ships/prepare-game-asset.mjs interceptor
npm run build
node scripts/check-dist-sizes.mjs dist
```

Only Full ships: `src/models/lance-interceptor.glb`, **13,116,788 bytes**, under
25,000,000. SHA-256:
`cff8d0393e276fcfaca1851ba4da1723a16c6e54bc9d6723f8a03b3367ec7923`.
The 27,578,176-byte Full source remains under `spikes/seven-ships/interceptor/`.
Its SHA-256 is `989fa11e97cc9740e56f7f776d523140c1aa43457e61990cb82bbb9a68a9025b`,
identical to the accepted `e96d393` source, checked directly from Git.
All imported study binaries follow the existing LFS policy except that source
GLB: the production-loader comparison test reads it, so `.gitattributes` exempts
it explicitly, as for the earlier authored hulls. Production models stay plain.

The preparation script retains float32 positions, UVs and triangle surfaces,
quantizes normals to 16 bits, and uses Meshopt's lossless NONE filter and lossless WebP.
UV quantization is requested but skipped by the encoder because the study's
UVs extend outside [0,1]; the shipped UV accessor is float32, like the source.
It verifies exact attribute and texture-pixel round trips after preparation.
`lance-asset.test.ts` independently decodes source and shipping GLBs through the
production loader and compares every oriented triangle and position exactly;
normal error is bounded by one signed-short step plus float tolerance, UV error
by one unsigned-short step. Material factors are preserved by the export; the
shared runtime adapter applies the game's emissive ceiling and alloy floor.

Source metres, Y up and +Z forward become kilometres and −Z forward once, in the
shared adapter. The decoded Full measures **62.3085 × 25.0220 × 25.0198 m** and
fits the original envelope; every berth admitting that envelope admits the model.
Full remains authoritative for collision containment and placement rays. The
display reach is separately measured at **0.0328 km**, rounded upward to 0.1 m.

Four drive glows fit the measured engine mouths, tested at least 3 cm clear of
sampled triangle surfaces under every finish. Nav lights sit on Full-model rays
within the game's proud offset and remain fixed through level switches; gun
origins and vent lines use the Full hull. Geometry, materials and textures are
shared, including both reduced levels; disposing one of eight tested instances
does not dispose another's resources. Wreck copies darken their own materials.

## Levels and runtime evidence

The game's `authored-levels.ts` builds the two display levels once, through
`ShipLevels`, with its existing 40/400-reach bands and hysteresis in both
directions. The spike's reduced/outline GLBs remain reference files.
The measured geometry counts are **587,810 / 95,784 / 10,242 triangles** for
Full / Reduced / Outline, excluding the separate drive glow. Unit checks hold
exactly one level visible, reached simplifier targets and non-raycast reduced
meshes. The half-device-pixel figure is a simplification target in the shared
reference camera, not a claim of identical shading at a switch.

2026-10-24, Apple M1 Pro, headed Chromium, ANGLE Metal hardware lane, 1440×900
CSS pixels at device scale 2. Browser work ran sequentially, without this worker
running a unit suite alongside the measurements; external machine load was not
isolated. Fresh-page default quality/antialias settings were used.

Five fresh geometry installs, seed 42, running clock and two live interceptor
roots refreshed per install, produced these median phase wall times:

| Phase | Milliseconds |
| --- | ---: |
| Parse/decode | 63.6 |
| Builder, including yielded frames | 700.7 |
| Private fitting warmup, including yielded frames | 1,882.5 |
| First published build | 0.2 |
| Published throat lookup | <0.1 |
| Refresh two roots | 94.3 |
| Longest install frame gap | **182.1** |

The first install's longest gap was also 182.1 ms. The 60 settled frames before
installation read 16.7 ms median, 18.6 ms p95 and 34.1 ms maximum. Download time
is excluded: the instrument reparses fetched bytes, using the production
private-cache installer before publication. This passes node #907's optional
**250 ms** local regression threshold; it does not promise four-millisecond
operations or a new game-wide budget.

```sh
HULL=interceptor RUNS=5 MAX_GAP_MS=250 SEELITE_PROBE_RENDERER=hardware node scripts/measure-hull-install-stall.mjs
HULL=interceptor BLOCKS=4 SEELITE_PROBE_RENDERER=hardware node scripts/measure-authored-hull-cost.mjs
SEELITE_PROBE_RENDERER=hardware node scripts/capture-interceptor-levels.mjs
```

The steady-state comparison used four shuffled blocks of 120 frames per arm,
order seed 20261009, the same chase camera and held clock. Calls and submitted
triangles below are actual composed-frame renderer readings, including shadows
when enabled. `+4` is four close Traffic hulls; `+4far` places them at reduced
distances. All arms include the same background scene.

| Arm | Occlusion off: ms / calls / triangles | Occlusion on: ms / calls / triangles |
| --- | ---: | ---: |
| No player hull | 1.724 / 186 / 587,070 | 2.469 / 190 / 587,074 |
| Lance | 2.001 / 206 / 1,176,416 | 2.918 / 229 / 1,765,766 |
| Procedural | 1.776 / 221 / 600,186 | 2.592 / 259 / 613,306 |
| Lance +4 | 2.637 / 280 / 3,531,964 | 4.013 / 373 / 6,476,862 |
| Procedural +4 | 1.970 / 338 / 644,698 | 2.818 / 489 / 702,330 |
| Lance +4far | 2.044 / 286 / 1,565,696 | 3.038 / 385 / 2,544,326 |
| Procedural +4far | 1.848 / 349 / 651,306 | 2.705 / 511 / 715,546 |

Lance minus procedural costs 0.225 / 0.325 ms without/with occlusion;
with four close hulls, 0.666 / 1.195 ms. Those comparisons separated in 16/16
block pairings. Four reduced-distance hulls cost 0.196 / 0.333 ms more than their
procedural counterparts (12/16 and 16/16 pairings). These are relative readings,
not vsync cadence or frame-rate guarantees.

`view-set/node-1034/current/` contains the scoped canonical before/after sheet.
The before application is an isolated `git archive` of `bb2fd345`; only the
capture declaration and its expected-procedural guard were adapted, with a
`source-ref.txt` beside the frame. The after frame is this working tree at
`dbc59513-dirty`. Both use seed 47 and the same canonical Lance chase row.
`view-set/node-1034/current-transitions/` contains nine shots and a JSON report
from the production camera, FOV 60°, reach 0.0328 km: 35 → 40.8 → 44 → 40.8 →
408 → 440 → 408 → 380 → 38 reaches. Every actual distance and single visible
level was checked. Shading changes at transitions remain a principal eye gate.

## Delivery evidence

- Asset/envelope/berth, vents/handling, sharing/teardown, wreck fixtures, URLs,
  LFS and changelog checks: 179 passed across nine affected files.
- Queue, system catalog, detail-level and download fixture checks: 20 passed.
- Canonical view-set declarations and sheet checks: 50 passed, including the new
  `hull-chase-lance` row at seed 47, 1440×900 and the existing chase framing.
- Typecheck, production build and distribution-size guard passed on this host.
- Eight affected hardware browser probes passed: chase-orbit, chase-view,
  model-download, model-queue, model-viewer, postcard, ship-visuals and vent-display.
  The first seven-of-eight run exposed the obsolete procedural interceptor
  fixture in ship-visuals. The corrected prospector fixture passed 20/20 checks
  alone, including an actual flown-hull readback; the pixel assertions are
  unchanged. A regression test requires a URL-eligible, still-procedural hull.
  The download probe now flies each tested hull as well as drawing its Traffic.
- This is manual affected coverage, **not** a `probe:pr` pass. The selector
  requests all 113 probes because inspection boot wiring has broad ownership.
  The ranger worker contract reserves that final run, PR and Sage for the
  supervisor. Principal flight/appearance approval and changelog copy approval
  remain pending.
- Final full host `npm test`, run once immediately before the worker commit:
  **6,883 passed, 0 failed**, 406 files, 11,964,206 assertions, 1,023.08 seconds.
  Log: `/tmp/seelite-1034-final-host-suite-20261024.log`. No code changed after
  that run; this final receipt update records its result.

## Historical measurements

The earlier worker's logs under `/tmp/seelite-1034-*.log` are historical,
not fresh final-head verification. Its five-install measurement reported
181.7 ms median worst gap with three live roots refreshed, below node #907's
optional 250 ms regression threshold. Its cost instrument used the hardware
M1 Pro lane, 1440×900 at device scale 2, shuffled four-block arms with 120
frames each: authored versus loft added 0.217 ms without occlusion and
0.384 ms with occlusion; four close Traffic ships added 0.727 / 1.258 ms,
and four reduced-distance ships 0.171 / 0.272 ms. Those readings predate the
restored envelope and are retained only as context. They are not frame-rate
guarantees or production approval.
