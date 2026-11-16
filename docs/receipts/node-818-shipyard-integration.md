# Model integration: node #818, the three shipyards

Follows [the authored-model integration SOP](../model-integration-sop.md).
The asset preflight was prepared on the design branch `spike/shipyard-models-800`
(PR #811) on 2026-10-11; the integration is on `node/818-shipyard-integration`,
2026-10-12.

## Current result

- **Design:** PR #811, principal-approved 2026-10-08.
- **Mapping (principal ruling 2026-10-11):** the approved yards replace the
  current shipyard forms one for one, so station selection is unchanged.
  O1 Gantry Works → `a`, O2 Foundry Hangar → `b`, O3 Crescent Slipway → `c`
  (`STATION_FORM_POOL.shipyard` in `src/station.ts`). The procedural forms
  draw until a model installs, and for good when one fails to load.
- **Shipping assets** (`src/models/`, measured 2026-10-12):

  | Form | File | Bytes | Triangles | sha256 |
  |---|---|---|---|---|
  | a | `shipyard-gantry.glb` | 10 494 100 (10.01 MiB) | 200 924 | `bf0378666f0f19f9ff66a4aa599719d3ae29470f2e851930d27763f3584b4f0b` |
  | b | `shipyard-foundry.glb` | 10 819 548 (10.32 MiB) | 209 272 | `0aed305df76af134142a6e620d184adb946440ded7e7195d6640ab0b32651cc1` |
  | c | `shipyard-slipway.glb` | 7 992 896 (7.62 MiB) | 135 736 | `71b7edefe1bb68bda61d2e4c9f5b775970a8ff1d6cb28a675d8cc74ebd0e3cc5` |

  Beside each, its baked work lights: lightmaps of 1 704 168, 1 448 010 and
  1 521 516 bytes (`-lightmap.webp`) and probe grids of 590 976, 912 384 and
  1 099 800 bytes (`-probes.bin`). The study's size-comparison hulls are
  dropped from the flight export (principal, 2026-10-12). The second UV set the lightmap reads adds
  about 2 MiB to each model.

- **Flight look:** the principal approved the flight exports in the study
  viewer (`?flight=1`) on 2026-10-11, and the grown drum ("looks good") on
  2026-10-12. **In game** (2026-10-12) the principal approved the look ("looks
  gorgeous. No flickering, drums look good") and then the baked work lights
  ("looks good"), and found the drum's added lamps floating. They were
  re-seated square to their faces and the study's size-comparison ships
  removed, and the principal approved that ("approved. run the full browser
  gate").
- **Open:** ~~SOP §4's measured LOD selection~~ (measured in [node #947](node-947-shipyard-lod-policy.md): Full outside the bay, a bay level proposed). The browser gate passed on
  6be0b9b4 except `output-stage`, red on `main` too (see Delivery evidence). Sage review: seven rounds on PR #939.

## Rulings during the integration (principal, 2026-10-12)

- **D1, extend the drum aft.** The sim's bay (`stationInterior("shipyard")`)
  is 405 m deep behind the plane; the display drum held 30 m. The drum grows
  forward round the bay; its rear, bearing and spine stay as approved, so it
  stays attached to the yard ("make sure drum is attached … a problem on all
  3 stations").
- **D2, the yard aft of the drum.** O2's halls stay beside the drum.
- **Collision: always the authored yard.** The sim collides with the authored
  model whatever is drawn, a stand-in included.
- **Empty space that collides: at most 5 m, relaxed to 10 m the same day.**
- **Flicker and cracks.** Coplanar faces were separated and the drum given a
  backing shell; the principal: "looks much better — still some flickering —
  but a lot less overall". In game: "looks gorgeous. No flickering".
- **Work lights: baked, gain 12; the ships lit by an irradiance grid** — see
  below.

## Rulings at the browser gate (principal, 2026-10-13)

The first full gate (head 1c485de9) failed 7 of 104 probes. Three were the
branch's own and are fixed (`probe-collision`, `probe-quality-bloom`,
`probe-planet-surfaces`), and `probe-output-stage` is red on `main` too.
The other three needed a ruling, because each check was written for the
procedural yard:

- **F1, the interior kit's cold install: fix it here.** The kit's dequantise
  held one frame for 75–92 ms on `main` as well. There the baseline's
  975–1250 ms hitches set the tail budget to about 2 s, so the check could not
  fail. With the authored yards the baseline is clean, the budget is 50 ms, and
  the frame failed. It now runs in 4 ms slices, and the worst install frame is
  9 ms in flight and 33–41 ms in the bay.
- **F2, `station-visuals.md` §5: the authored yards get their own row.** Their
  fixtures are their capsule lamps (as `windows`) and the mouth ring. Their
  work light is the baked, warm light ruled above, so a shipyard is not ranked
  by warmth. There are no `bay-flood` or `weld-arc` objects.
- **F4, no strobe pair on an authored drum.** The mouth ring turns with the
  drum and shows the rotation.
- **F3, `probe-station` at 60 km: re-derive from measurement.** All three forms
  were measured (seeds 54, 3, 2, 19, 9, 11): 10–42 px, aspect 0.56–1.50 against
  the trade station's 0.75–1.20. The Foundry and the Slipway are taller than
  wide down the axis, so "wider than trade" is not a cue they carry, and no
  limit set from these figures would test anything. For an authored yard the
  width and the type colour are printed, not gated, and presence (drawn,
  not empty) is still gated.

- **F8, `probe-occlusion`'s bay ceiling: fix the clock and measure the reach.**
  The bay check failed alone at 77.97–78.61% against a fixed ceiling of 77.
  The shadow was drawn identically on both sides (same fit, extent, map and
  biases). The figure follows the station's spin phase at capture: `main`
  reached the bay at 93.5–98.3 s of game time (65.6–76.0%), the branch at
  103.4–104.0 s (77.7–78.6%). At the view-set's clock both read 79.3%, so
  `main` fails the old ceiling there too. The bay is now captured at that
  clock, and the ceiling is the sun's measured reach in the same frame plus
  2.5 points. It reads 79.30% against a reach of 79.31% on both sides. A relit
  "off" frame (hemisphere ×1.5) reads 99.9% against 79.3% and fails.

## Work lights (principal, 2026-10-12)

**The ruling.** In game the yards were "too dark, they would need industrial
lights that lighten the work areas", in four places: the assembly bays and
slips, the gantries and cranes, the drum and its mouth, and the hull overall.
Asked baked or real time, the principal had both built on one yard to fly
through, then chose **baked, gain 12**; then asked for the ship's hull to be lit
in the yard too, chose an irradiance grid (H1), and found the drum's added lamps
floating and then set at one angle; every added housing is now built on its
surface (`mounted_flood`: its back on the surface, square to it, its long
side along it).

**What was measured for the choice** (`.tmp`-only instrument, the method of
`scripts/measure-light-cost.mjs`: one page, the arm switched in place, eight
shuffled rounds of 60 renders and a pixel read, medians; M1 Pro, Metal, device
scale 2, 1440 × 900, O1 Gantry Works filling the frame, near layer):

| Real-time arm | ms/frame | added |
|---|---|---|
| none | 7.18 | — |
| 8 spot lights | 8.33 | +1.15 |
| 16 | 24.91 | +17.7 |
| 32 | 115.3 | +108 |
| 16, of them 2 / 4 / 8 shadowed every frame | 22.4 / 24.9 / 27.2 | +15.2 / +17.7 / +20.0 |
| 16, of them 4 / 8 shadowed once | 23.9 / 26.2 | +16.7 / +19.1 |

The cost is the light count — three.js evaluates every light at every fragment
of every object, over a yard's many layers — not the shadows. 12 shadowed
lights exceeded the shader's texture units, and 67 unshadowed lights ran
~430 ms a frame and lost the context. The design's 67 floods and 66 lamps
cannot be lit in real time; eight can.

**The bake** (`build_model.py`, flight export): every fixture registers its
light; the added floods are seated on the yard by a ray-cast toward their
mount (placed by figure, they had floated 3–25 m off it). A second UV layer is
packed across the whole yard (4096², 1.7–2.7 m a texel) and Cycles bakes the
lamps' direct and indirect light into it, the drum with its own lamps only so
nothing turns with it that should not. The light is written as an 8-bit sRGB
lightmap divided by its 99.5th-percentile level, which the root records
(`lightmap_scale`); the game multiplies it back by π and `WORK_LIGHT_GAIN` (12).

**The ships** (`src/ship-work-light.ts`): the same lamps are sampled every 50 m
through the yard, with the yard's occlusion, as an ambient colour plus one per
axis; a ship reads the grid at its position each frame and its own copies of its
materials add the term to their indirect light (`SHIP_WORK_LIGHT_GAIN`, 1).

**The comparison panel** (`src/worklight-tuner.ts`) stays: on a dev URL with
`worklights=baked|realtime|off` it switches the mode in place and moves the
gains, the real-time intensity and light and shadow counts while flying. The
game never mounts it.

## Asset and geometry preflight

**Why the review files could not ship.** The review GLBs are 55.1 / 80.0 /
33.9 MiB with 694 k / 1 021 k / 415 k triangles. Post-processing alone did
not fit O2 under the host's 25 MiB per-file limit
(`scripts/check-dist-sizes.mjs`):

| Yard | review | lossless Meshopt + WebP | + `quantize()` |
|---|---|---|---|
| O1 | 55.1 MiB | 24.6 | 18.4 |
| O2 | 80.0 MiB | 35.2 | 25.9 |
| O3 | 33.9 MiB | 16.0 | 12.1 |

`weld()` changed nothing, and `simplify()` plateaued at about 900 k triangles
on O2 even at a 22 m error bound: the hull is thousands of separate inset
plates, each with fasteners, seam strips and wear trails.

**The flight export** is `build_model.py -- o1 o2 o3 --flight`. It differs
from the review build only where this list says:

1. **Density.** Plates draw no fasteners, seam strips or wear trails, and
   cladding gets no bevel modifier. The lean plate draws the same random
   numbers in the same order, so plate places and colours do not move. With
   this change alone, all 22 cladding meshes of a flight O2 were
   bit-identical in position to a review O2 built without the bevel. Changes
   2–4 draw no other random numbers; with all four, the 18 cladding meshes outside
   the capsule are still identical, and the 4 capsule ones differ by the
   aperture stretch and corners.
2. **Aperture.** The display throat's clear opening was about 92 × 61.5 m
   (rails and lamps at |x| 46.1 m, rails at |y| 30.75 m), not the 102 × 66 m
   the handoff states. Capsule-local geometry in front of z = −32 m is
   stretched (×1.31 in x, ×1.15 in y inside the throat, blending back to
   identity at the coaming's outer edge) to a clear 121 × 71 m; the
   production slot is 120 × 70 m (`STATION_GEOMETRY.shipyard.aperture`).
   The end cap's inner edge was an octagon inscribed in the opening, which
   cut the slot's corners; flight end-cap plates turn the corner instead.
3. **Rear wall.** The display `throat-back` is removed; the authoritative
   interior replaces it. The throat is open at the back.
4. **Drum mounts.** The drum is an octagon 220 m to its corners, so its
   plated faces stand at about 204.5 m, but the side housings, vents and bars
   were placed as if they stood at 220 m and floated 15–25 m off the hull
   (found by the principal in the viewer). Flight lowers both mount groups by
   16.8 m, so the lowest parts rest on the plates.

5. **The drum holds the sim's bay** (D1). `grow_drum_forward` moves the
   capsule's front forward until its hub face stands 405 m in front of the
   bay's end, rebuilds the barrel between with plates drawn without random
   edges, adds a rear band, and lines it with a backing shell
   (`drum-backing`) so no crack between plates shows the sky.
6. **Coplanar faces separated.** `separate_coplanar` lifts overlapping
   coplanar parts apart in up to six passes (4 cm tolerance, steps from
   12 cm); left within 2 cm: O1 0, O2 28, O3 36 pairs.
7. **Marks.** `aperture-plane` and `hub-face` on the capsule, which since the
   10 m ruling are one place: the game puts it on the sim's plane, so the bay
   opens where the drawn one does.

The review build is unchanged: rebuilt from the edited script, O2's positions
and normals equal the committed `o2.glb` exactly, with texture coordinates
within 4.8e-7 (the bevel's run-to-run noise).

**Encoding.** `spikes/shipyards/prepare-flight-asset.mjs` reads the raw
flight exports from `.dream-loop/shipyard-flight/` (ignored; rebuilt by the
command above) and writes Meshopt (NONE filter) with lossless WebP. It asserts
exact vertex attributes, the flight export's triangle soup and texture pixels
after a decode. No simplification, quantization or resize.

**Checks on the shipped files** (`tests/shipyard-flight-asset.test.ts`,
through `decodeShippedGlb`, 24 rows): under the 25 MiB limit; under 250 k
triangles (a ceiling against the review density, not a render budget); the
capsule's docking frame and its two marks on the axis, the plane on the hub
face; no `throat-back`; the production slot clear from the hub face out
through the funnel; the sim's whole bay inside the drum with no drum geometry
in it; the yard's bearing meeting the drum's rear face; along each drum face,
no radial hole of 1 m or more in the stack above the plates.

## Runtime and performance evidence

**Frame alignment** (`src/shipyard-flight.ts`). The builder reads the marks:
the drum turns in the spinner with its plane on
`STATION_GEOMETRY.shipyard.aperturePlaneKm`; the yard stands still. The bay,
berths, slot and spin are the sim's.

**Collision proxies** (`scripts/generate-shipyard-proxies.ts` →
`src/shipyard-proxies.ts`). Oriented boxes fitted to each model's connected
parts, split by plane and along their longest side, then absorbed into and
merged with neighbours, while every sample of a box's faces, 1 m apart and as
packed, has drawn metal within 10 m less the sampling's half-diagonal. The
drum's boxes keep out of the sim's bay and lane; the bay is walled from the
sim's own figures. Measured 2026-10-12:

| Form | drum boxes | yard boxes |
|---|---|---|
| a | 513 | 2 755 |
| b | 513 | 2 347 |
| c | 483 | 2 782 |

246 KB of source; a refit takes about 5 minutes for the three. Settings were
measured on form a: a 4.5 m fit and 1.5 m absorb gave 14 290 boxes, 9 m and
3 m 4 265.

**Checks** (`tests/shipyard-flight.test.ts`): the proxies' recorded model
hashes match the shipped files; no box face stands more than 10 m off the
model (red on the first fit: an 873 m hall box the old sampler saw at 22 m
spacing); every drawn vertex of the yard and the drum lies within 1.5 m of
its proxy (red on a fit that moved the drum's rim boxes off the plane,
leaving rim vertices 3.77 m outside). `tests/station-proxy.test.ts` holds
containment (a row per form), the opening, reach and the thinnest primitive
(0.7 m) for the authored proxies.

**Sweep cost.** Lists over 128 primitives are searched through a grid
(`src/sphere-grid.ts`), in the sweep and in `proxyContains`; every procedural
proxy is 66 or fewer and stays a walk. `proxyReachKm` is read once per proxy:
the avoidance read it every step, and a refinery duel in a system with an
authored shipyard ran four times slower until it was cached.

**Reach** (`STATION_FORMS`, the larger of stand-in, mesh and proxy): a 1.66
(1.655), b 1.5 (stand-in 1.497), c 1.87 (1.868).

**Loading** (`src/main.ts`). The boot holds only for a home shipyard: a
Commander docked at one waits for that form (`src/home-shipyard.ts`). Every
other form installs after boot and rebuilds its drawn shipyards, compiled
off-scene and swapped only if still drawn; a failure keeps the stand-in.
`shipyardModelsSettled` says when all three have settled; direct measurement
boots wait for it (`shipyards-full`), as for the interiors. The postcard and
the station workbench require the models.

**Pending:** ~~SOP §4's measured LOD selection, and the frame cost in game~~ — both are in [node #947's receipt](node-947-shipyard-lod-policy.md).

## Delivery evidence

Headless at 4fdf3856 (2026-10-13), after the gate fixes: `npm test` 6 166
pass, 0 fail; typecheck, format, lint and build pass.

Headless after the work lights (fffad2e, 2026-10-12): `npm test` 6 114 pass,
1 fail — `tests/public-site.test.ts`, the grids fetched outside
`bundle-fetch.ts`; fixed in 3d1ce2d (that file 9 pass). Before them, after
merging `origin/main`: 6 101 pass, 0 fail; typecheck, format, lint, launcher wiring and build pass;
every file in `dist/` is within 25 MiB. The build ships the three models
under hashed names; the proxies ride in the `station-console` chunk, which
grows from 126 KB (46 KB gzipped) to 379 KB (159 KB): the sim needs them before
any shipyard can collide, so they are not deferred.

**Browser gate** (`probe:pr`, all 104 probes selected, head becaaf53,
2026-10-13): 93 passed in the suite. The machine's load peaked at 370 on 10
cores during it. Of the 11 reds, 9 pass alone (`dock-arrival`,
`docking-traffic`, `docking`, `duel-hud`, `eject`, `fire-groups`,
`music`, `neural-voice`, `opening-cinematic`), which points at the load.
`output-stage` is red on `main` too (1.20% edge disagreement, unchanged).
`occlusion` was red alone, and F8 above fixes it; the fixed probe passes on
the branch and on `main`. After becaaf53 only `probe-occlusion.mjs` and
documents change.

**Browser gate on the final head** (`probe:pr`, all 104 selected, 6be0b9b4,
2026-10-13, peak load 64): **103 of 104 pass**. The one red is
`output-stage`, red alone too, with the same 1.20% as on `main`. CI on
6be0b9b4: static, unit (4 shards), build and gate pass.

**Rows changed for the authored yards**, each from a measurement:

- the yard-does-not-turn row and C5's crossing count named the procedural
  Gantry's boom; both now read their subject from the authored proxy;
- the mouth duel's blind control asks for more than a third of the runs, not
  half: blind runs meeting a shipyard fell from 11, 8 and 8 to 7, 3 and 3
  (28, 23 and 26 meeting any station before; 24, 18 and 21 after), trade and
  refinery unchanged;
- the thinnest shipyard primitive is 0.7 m, a fitted plate;
- C5's empty chord is chosen by the model (no triangle within 10 m plus the
  hull's reach), not by `crossesStation` (sage round 6);
- `probe-collision` perches on the authored yards, measured per form;
- `probe-quality-bloom` opts out of the shipyard wait (its frames are held, so
  the wait could never end), and `probe-planet-surfaces` waits for the yards.

**Checks that now report an authored yard instead of failing it** (the
rulings of 2026-10-13 above). Each one still gates the procedural stand-in:

- `probe-station`: the 60 km floor of 20 px (presence is still gated); the
  60 km "wider than the trade station" check; the type-colour check;
- `probe-station-visuals`: the shipyard's place in the warm-to-cold ranking.
  Its per-fixture check reads `AUTHORED_FIXTURE_NAMES` for an authored yard;
- `probe-station`'s handoff check counts the yard group as the frame.

## Historical measurements

The review-file size table above is from 2026-10-11, on the review GLBs.
The flight exports supersede it.
