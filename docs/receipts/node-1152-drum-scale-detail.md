# Node #1152: Drum scale detail and trade seam backing

## Current result

Raw evidence is not committed, by the principal's ruling of 2026-11-06. The files
named in backticks below are in `~/work/cyphr/spark/seelite-evidence/node-1152/`
on the hardware machine, at those relative paths. Commit `a95c41d9` on this PR's
branch held them until the ruling.

Trade C carries the approved Drum barrel and entry-face pass from
`origin/spike/ring-scale` (`2faf1f16`, following `57cf8980`, `2a845417` and
`12f50683`). The principal approved the appearance and all three trade forms'
seam backing on 2026-10-30. Production appearance, frame cost and asset sizes
still require the principal's acceptance; this implementation does not supply it.

The implementation and timing baseline use `origin/main` at `0ac662f1`, including node
#1145's Ring split and shared station lighting. Main through `36941f9b` was
subsequently merged in `7940fba1`; its `src/` changes are comments only. Eight full-only Drum meshes
carry windows, girders, trusses, masts, panels, dishes, the gallery and beacons.
They use the existing deferred-detail request, retry, attachment and teardown
path. The new detail file does not join the boot set. Reduced and outline hide
all eight meshes. A separate `plate-backing` hull mesh in each base export
stays visible at every detail level. Outposts and the Assembly are unchanged.

The shared station material adapter already gives the Drum key gain 2,
hemisphere gain 0.6 and navigation gain 8. No lighting setting, ship material,
cockpit material or exposure band changes here. Gameplay strobes, pools, bay,
nameplates and navigation fittings remain on the existing production path.

The four original window housings at radius 180 m now have their backs on the
entry face at z 394.8 m. Their fronts are 4 m proud of it. The headless test
casts a ray at each housing and measures that front plane. Drum reach is
0.6870291114647181 km on both refs, against its 0.70 km silhouette limit.

## Asset and geometry preflight

Rebuild from the repository root:

```sh
Blender --background --factory-startup --python spikes/stations/build_model.py -- ring drum wheel --flight
node spikes/stations/prepare-flight-asset.mjs ring drum wheel
bun scripts/generate-trade-proxies.ts
```

This host had no Blender. A temporary copy of [official Blender 5.0.1](https://download.blender.org/release/Blender5.0/blender-5.0.1-macos-arm64.dmg) for macOS
ARM64 was mounted under `/tmp`; Blender's authoring script ran on the host
because sandboxed startup crashed. No standalone Python toolchain was added.
The preparation step checks exact vertex attributes, triangle attributes,
material inputs and lossless texture pixels after encoding and splitting.
The Ring's separate detail asset is byte-identical to main.

| Shipped file | Bytes | MiB |
| --- | ---: | ---: |
| trade-drum.glb | 5,001,176 | 4.77 |
| trade-drum-detail.glb | 5,959,832 | 5.68 |
| trade-ring.glb | 6,621,444 | 6.31 |
| trade-ring-detail.glb, unchanged | 14,027,844 | 13.38 |
| trade-wheel.glb | 7,075,896 | 6.75 |

Every file is below the preparation step's 25,000,000-byte limit. Production
build validation passes the 25 MiB emitted-file guard. The asset manifest (`assets.json`) records complete checksums and triangle counts. Drum full is 271,644 triangles: 83,384 in the base and 188,260 in deferred detail.
The separate Drum generator resets seed 1008 only after the approved form has
built; it consumes none of that form's random draws. Backing changes no plate
face vertices or material. It adds a full-size dark prism under each shrunken
plate, in its own hull batch.

`tests/trade-plate-seams.test.ts` decodes the shipped base GLBs through the
production GLTFLoader/Meshopt path. It casts axis-aligned rays on a 2.5 m grid
from all six sides, with grid extents derived from the shipped model's bounds,
using projected triangle intersections to compute the
first surface. Removing only the isolated backing mesh gives the same form
without backing. No backed ray goes more than 2 m deeper than that control;
each form has more than 100 samples restored by more than 2 m. The test also
checks 576,000 radial Drum barrel rays (720 angles, 800 axial rows from z −570
to 370 m): none reaches inside radius 330 m. Entry-face rays inside radius
275 m, outside the central 296 × 244 m opening exclusion, never go behind
z 380 m. Both regional checks find holes with the backing removed. These are
sampled tests; they do not claim a continuous surface proof.

The final audit found that a fixed ±800 m grid missed the Wheel's outer
67.5 m. A bounds-coverage assertion first failed at 867.5 m against 800 m
(failure: `wheel-grid-before.txt`). The
grid now spans each shipped model's measured bounds plus one grid step;
all three seam tests pass with that coverage assertion
(result: `seams-final.txt`).

The new detail, backing and window tests first failed against the original
assets; the failing-before log (`failing-before.txt`)
retains that result. A reconstructed full-size-plate reference was investigated
and discarded: at grazing angles its shallow surface stand-off also moves the
first hit along a ray, so that comparison was not a measure of empty-hull holes.

All fittings remain in collision. Regenerated hull counts are 4,347 for the
Drum, 8,676 for the Ring and 5,033 for the Wheel. The required authored-proxy
coverage, empty-space, reach and opening tests pass with these proxies.

## Hardware evidence

The five requested live frames were captured on each ref with seed 42, system
0, form C, at ship scale 1. The before/after sheet (`drum-before-after.png`)
shows the entry face and barrel; individual full-resolution frames and placement
readbacks are retained beside it. All eight detail meshes are attached and
visible in every branch frame. The renderer is ANGLE Metal / Apple M5 Pro.
The images were inspected: the additions are visible and the plate-face finish
remains consistent with the baseline. This inspection is not principal approval.

The existing capture script already contains node #1145's copy of the
station-scale study capture and its late-detail readiness wait; both baseline
and branch use those bytes. The canonical sheet (`views/index.html`) contains nine views per arm. All 435 baseline files under `src/` match main by Git blob hash (verification: `baseline.json`). The canonical wrapper adds Drum approach, flank
and range rows on the same seed/system, alongside existing Ring, station,
hull-chase and cockpit controls. It copies only the view declaration into the
baseline archive so both arms offer the same framings. These are selected
canonical captures, not all canonical views.

The final complete canonical sheet (`views-full/index.html`)
contains all 94 declared views in each arm, captured sequentially on the same
hardware lane. Both manifests and every declared PNG were checked for
completeness. The Drum rows use seed 42, system 0; the other rows retain their
canonical fixtures. The baseline's 435 source hashes were rechecked after its
capture. Run the wrapper with `<baseline-root> before --full` and `. after --full`
to reproduce this full selection. The final Drum flank pair was opened and
inspected; principal acceptance of the complete sheet is still pending.

The raw frame receipt (`cost.json`) compares main `0ac662f1` with runtime implementation `d65b5dbc`. It uses 12 paired blocks per framing, randomized arm order (seed 1152), 120 synchronous renders per block and a readPixels drain at each block boundary. Both automatic frame loops are stopped after settled boot. All eight added meshes must be attached and visible before timing. Both Vite roots are checked through their own tree declarations. The fixture is seed 42, system 0, 1440 × 900, DPR 1, high quality, scale 100%, no MSAA, hardware on an Apple M5 Pro with 18 logical CPUs. The probe lock was free before the run and held by this measurement throughout. Load average was 7.272/10.292/11.205 at start and 7.076/9.747/10.944 at finish. No local test/build/capture ran alongside the timing.

| Framing | Main median (range), ms/frame | Branch median (range), ms/frame | Branch slower pairs | Calls main → branch | Submitted triangles main → branch |
| --- | --- | --- | --- | --- | --- |
| station-approach | 2.312 (2.258–2.828) | 2.254 (2.203–2.792) | 46/144 (32%) | 616 → 625 | 3,708,306 → 3,900,142 |
| chase | 4.281 (4.234–5.103) | 4.130 (4.070–4.544) | 22/144 (15%) | 1493 → 1520 | 11,832,152 → 12,407,660 |

The ranges overlap. This run supplies no causal attribution or speedup claim. It measures whole-frame command-submission and GPU-drain throughput, not rAF cadence, isolated GPU time, loading or installation latency. Extra render passes account for chase submitting the same geometry multiple times. Browser and WebGL error lists are empty. Two preliminary study-harness attempts stopped before any timing block because the copied script had invalid renamed methods; only the successful receipt above is used.

The collision receipt (`collision.json`) exercises the production `sweepShip` with a courier hull, dt 0.1 s and a 2 rpm rotating station, in four fixed station-relative paths. It retains all Drum fittings in the proxy, compares 1615 → 4347 hull boxes, warms each case and interleaves 12 blocks of 100 sweeps per arm. Both strike cases must actually register an impact; clear approach must remain clear.

| Case | Main median (range), ms/sweep | Branch median (range), ms/sweep |
| --- | --- | --- |
| approach-clear | 0.008 (0.004–0.093) | 0.005 (0.004–0.037) |
| outer-rim-strike | 0.233 (0.170–0.397) | 0.234 (0.170–1.099) |
| front-rim-strike | 0.217 (0.102–0.591) | 0.237 (0.153–0.343) |
| rim-flyby | 0.292 (0.156–0.637) | 0.245 (0.184–0.354) |

This is a sampled collision workload rather than a worst-case bound. Main-thread broadphase and contact solving are included; no production physics or collision tolerance changed.


## Delivery evidence

Implementation commit: `d65b5dbc`. Required trade/proxy tests plus new detail,
seam, model-URL and Ring regression checks: 105 pass, 0 fail. The canonical
view and Drum detail checks separately pass 58 tests. Typecheck, formatting,
script lint, comment lint, launcher wiring and production build pass. The final
audit passes 161 tests across the required trade/proxy files, Drum and Ring
detail, model URLs and view declarations
(log: `audit-focused-tests.txt`). The
later grid-coverage change passes all three seam tests. The final production
build also passes its emitted-file size guard
(log: `build-final.txt`).

Probe selection against `origin/main` selects all 120 probes because an impact
path has no dependency owner. Under the ranger implement-worker contract, the
supervisor owns that final selected PR gate. This worker runs affected probes
only and does not claim `probe:pr` green.

Affected hardware browser probes pass station visuals 100/100 (`probe-station-visuals.txt`) and hull lighting 12/12 (`probe-light-rig.txt`). Hull-chase reads peak 238.21, lower quartile 34.48 and median 51.70 within the existing `hull-luma.mjs` band. The canonical controls also retain the unchanged cockpit and hull code.

The single full host `npm test` run completed 7,525 tests across 467 files in
933.46 s: 7,523 passed and two failed
(raw log: `full-host-tests.txt`). Both
failures were corrected before delivery:

- The new study PNGs had been staged as plain blobs without an active LFS
  filter. They were restaged through a command-local LFS filter, without
  changing Git configuration. All 217 new study images were then indexed as LFS
  objects, before the ruling above took them out of the branch; all three LFS
  tests passed
  (rerun: `lfs-final.txt`).
- `tests/model-url-source.test.ts` still pinned 28 literal model URLs. The new
  Drum detail asset makes 29. The inventory pin now includes it, and all five
  URL tests pass
  (rerun: `model-urls-final.txt`).

Only the affected tests were rerun after these corrections, following the
worker's single-full-run contract. This is a full-run result plus green
corrective reruns, not a claim of a second green full-suite run.

Sage, the final PR browser gate, principal visual/cost/size acceptance and merge
belong to the supervisor/principal. The same change adds proposed changelog copy for approval:
“Drum stations show more detail, and plate seams on Ring, Drum and Wheel stations
stay closed.” Its comment marks principal approval and the main date as pending.
