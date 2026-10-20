# Model integration: trade Ring, Drum and Wheel — node #1033

## Current result

PR #826's accepted design commit `75f7b23` is merged into this node branch by
`9d8ff09`. Main already carried the study bytes through the squash-merged
outpost integrations; the merge retains their LFS representation and newer
flight-export code. Appearance approval is the principal's 2026-10-09 ruling.
Production appearance and the changelog sentence still require the principal's yes.

Ring → trade `b`, Drum → `c`, Wheel → `e`. Each installs through the existing
background queue, refreshes the live station once and stays procedural until
then. Failed background downloads retain that stand-in and warn once. A home
exterior follows the existing cockpit-plus-home boot contract; no unrelated
trade model becomes a boot dependency. Postcards use the same model catalogue.

Coriolis `a` retains its existing builder. Assembly `d` remains procedural,
reads `assemblySeed`, uses its existing seeded proxy and has no shipped model.
Pool membership, save data and `STATION_GEOMETRY.trade` are unchanged.

## Asset and geometry preflight

Reproduce with the two Blender invocations, encoding command and proxy generator
under **Trade flight exports** in `spikes/stations/README.md`. The invocation
split also reproduces Blender's material names. The native Blender executable
needed sandbox escalation for Metal device initialization on this host.

| Form | File under `src/models/` | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| b | trade-ring.glb | 5,875,120 | `16e59c914e5c9e229636f839a15fff616b40b0b10fc16613cec4f530521e2a05` |
| c | trade-drum.glb | 4,894,180 | `c9a95bb2c0ea2c4abef69d0af0ea890df6c6b29f611a021c95c489cc47e5141a` |
| e | trade-wheel.glb | 6,443,744 | `9ea91aa845efb1ce05de14af68b1911a8c636788db574cef19d0c2526bcb0cd3` |

Each is below 25,000,000 bytes. The prepare script verifies exact decoded
vertex attributes, triangle surfaces and lossless WebP pixels against the flight
export, and refuses oversized files. Meshopt uses the lossless NONE filter.
Flight export density drops the same small plate details and bevel as the
outposts; this is separate from the encoding's lossless guarantee.

The studies stay unchanged. Only flight files ship, under Vite's hashed URLs.
`npm run build` and `node scripts/check-dist-sizes.mjs dist` pass; all deployed
files are within the guard's limit, including the three explicitly byte-bounded GLBs.

### Frame and local adaptations

The export uses metres, +Z outward along the docking axis. The game converts
metres to kilometres, without a whole-model size adjustment. Study dock datums
are Ring 173 m, Drum 485 m and Wheel 203 m; translation places each at the
unchanged production aperture plane, 428 m.

The sim bay remains 280 × 230 × 405 m, extending from 428 to 23 m. Ring's
310 m hub and Wheel's 370 m hub become 390 m long, extending only aft while
keeping their front faces fixed. The rear pressure skins then stand at about
21.5 m, behind the bay's back. Drum needs no hull extension. A 40 m rendered
mouth recess preserves the front wedges; the export clears the bay, 120 × 70 m
throat and approach. The outward 140 m square carve contains the corridor's
69.46 m radius. The sim's aperture, berth catalogue, traversal and spin stay
authoritative. Production interior geometry is built by `buildStationInterior`.
A 40 m local slot liner joins that recessed mouth to the aperture lamps at
428 m. Its 121 × 71 m clear opening gives the sim's 120 × 70 m slot 0.5 m
clearance on each side; its outer frame meets the study's larger opening.
Loader-backed rays verify actual support behind the aperture lamps, rather
than a floating rectangle inside the study's hole.

`tests/trade-flight-assets.test.ts` decodes every shipped GLB with the
production GLTFLoader/Meshopt decoder (texture references removed for Bun),
checks the datum within 1 cm, tests triangle/volume intersections in the bay,
throat and approach, and ray-checks retained front wedges and rear closures.
`tests/trade-flight.test.ts` builds the production adapter, checks the approach,
berths, shared rotation, lamps, fallback and display reach.

The existing Coriolis navigation helper accepts mount coordinates with unchanged
defaults for Coriolis. The new forms use rays starting at 350 m, strobe mounts
at ±150 m across and beacon mounts at ±130 m / 120 m. These intersect their
own front structures. Lamp emission is normalized to `EMISSIVE_CEILING`.

Measured maximum proxy reaches are b 0.743834 km, c 0.691096 km, e 0.944979 km.
Display declarations are b 0.75 km, c 0.70 km, e unchanged at 0.98 km. The
display budget is separate from the unchanged dockable core and aperture.

### Collision

`scripts/generate-trade-proxies.ts` uses the earlier stations' oriented-part
fitter. Generated source hashes bind each proxy to the shipped GLB. The sim
always uses the authored proxy, including while a procedural stand-in is drawn.
All exterior boxes spin with the station; the static list is empty. The sim's
bay keep-out stays unchanged. Side and rear shell proxies stop at the rendered
mouth, 388 m; no synthetic forward bulkhead is added at the 428 m aperture.
An interior mouth wall would lie inside the sim-owned bay keep-out; entry and
traversal own that transition.

Packed hull counts: b 3,503; c 1,615; e 5,127. Thin plates measure 0.8 m after
packing. The fitter clips input triangles out of the sim-owned keep-out before
subdivision, avoiding futile subdivision of front faces inside that volume.
Coplanar coaming-front triangles receive fitting copies 1.25 m outward, keeping
their thin proxies clear of the bay after packing. The drawn surface stays at
428 m; the independent source-distance and vertex-coverage rows bind the offset.

The tests independently measure packed boxes on the fitter's 1 m face grid
against decoded triangles, under its conservative sample limit for the 10 m
empty-space rule. They also hold every exterior vertex outside the sim opening
within 1.5 m of the proxy. The existing station budget rows cover opening
clearance, frame ownership and reach; the collision corpus remains applicable.
The final composed proxy is also sampled against all drawn surfaces. This
regression failed on eight synthetic wall boxes per form before the shell
correction and passes after it; fitting only the generated exterior boxes
would not have caught that composition defect.

## Runtime and performance evidence

GPU lane: ANGLE Metal / Apple M1 Pro, 1440 × 900, High. The new cases in
`probe-model-queue.mjs` boot at an Assembly, hold one trade GLB across a real
jump, capture the procedural form, release it, wait for current-set settlement,
capture the authored form, verify repeat refresh preserves the root, fly the
docking computer into `deck-near`, and launch. All three pass. A separate
refused Ring download stays procedural and warns once. The complete affected
model-queue probe passes 20/20, including its prior full-catalog boot and jump rows.

The three cases use seed 42: Ring system 1 from 5, Drum system 0 from 52,
Wheel system 3 from 26. Each asserts the jump reached its target. A first
fixture incorrectly attempted two out-of-range jumps; that run is superseded.
The arrival effect is cleared for the captures; simulation geometry is retained.

No additional LOD is introduced. The prepared Full exports reduce submitted
calls relative to the procedural exteriors in the measured production near
scene's colour pass, including navigation but hiding the interior. Shadow-map
updates are pinned in both arms so an opportunistic depth pass cannot bias the
comparison:

| Form | Procedural calls / triangles | Authored calls / triangles |
| --- | ---: | ---: |
| b | 92 / 71,740 | 57 / 102,416 |
| c | 78 / 39,832 | 56 / 80,060 |
| e | 105 / 43,000 | 58 / 123,064 |

These are `renderer.info` submission counts, not mesh counts. They do not
claim a frame-time speedup. The JSON under `probe-shots/trade-models/` also
records 120 presentation intervals and cold-install maximum intervals. On the
final run, median / p95 / maximum cold-install intervals were Ring
8.4 / 25.2 / 225.2 ms, Drum 8.4 / 24.8 / 150.3 ms, Wheel
8.5 / 25.7 / 175.1 ms. This worker ran no other suite alongside it, but host
load was about 26 on the shared M1 Pro; these timings are diagnostics rather
than an isolated GPU-cost claim. Earlier timing and unpinned-shadow runs are
superseded by this colour-pass comparison.

The module uses the existing shared-resource disposal and system-identity
refresh path: a jump during an awaited refresh cannot install into the old
system. Postcards and full-model boots consume the extended catalogue without
a separate loader. Failed background loads are terminal for that queue.

## Delivery evidence

- Final loader, adapter, packing-fit, composed-proxy, coverage and model URL run:
  24/24 pass, 474 assertions, on the final liner exports and generated proxies.
- Collision/station geometry/interior/system focused run: 105/105 pass.
- Model URL ownership and literal hashed paths: 5/5 pass.
- Typecheck and build pass; final full unit result will be recorded below.
- Mandatory selector reports all 112 probes because the diff touches shared
  runtime. The worker SOP reserves that full run for the supervisor. The
  manually scoped development browser coverage is not a `probe:pr` pass.
- The principal's in-game yes, changelog sentence approval and supervisor Sage
  review remain merge gates; this worker does not open a PR or merge.
- Changelog decision: major visual change; sentence proposed in `src/changelog.ts`.

The first six-probe development run passed collision (35/35), docking (73/73),
postcard (47/47), production boot (3/3) and station mouth (7/7). Station visuals
found a missing authored-trade fixture catalogue row; it now reuses the existing
trade names, and a focused rerun passes. No pixel threshold was changed.

Canonical before captures are under `view-set/node-1033/node-1033-before`.
Per-form production before/after frames are under `probe-shots/trade-models/`.
Final canonical after captures and final gate results are recorded after the
implementation commit. These capture directories are gitignored by repository policy.
