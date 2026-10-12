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
  | a | `shipyard-gantry.glb` | 8 489 496 (8.10 MiB) | 201 300 | `d8ce90f903f588acced3ac3015ad925b593be868d093c703446b7d234da32ac5` |
  | b | `shipyard-foundry.glb` | 8 768 300 (8.36 MiB) | 209 912 | `1823608af958d1657ef4b344584a90e2124c57f5b6f6da11175eaa2fc51a3703` |
  | c | `shipyard-slipway.glb` | 6 688 052 (6.38 MiB) | 136 508 | `401d1b19997eb26cabf71eb18b511c27f0b74c4abff5ba5d1ea3adbae59f0981` |

- **Flight look:** the principal approved the flight exports in the study
  viewer (`?flight=1`) on 2026-10-11, and the grown drum ("looks good") on
  2026-10-12. Neither is the in-game approval, which the map requires before
  merge.
- **Open:** the in-game look (the principal), the PR browser gate, SOP §4's
  measured LOD selection, and Sage review.

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
  but a lot less overall".

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
| a | 514 | 2 806 |
| b | 514 | 2 350 |
| c | 483 | 2 750 |

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

**Pending:** SOP §4's measured LOD selection, and the frame cost in game.

## Delivery evidence

Headless, on the branch after merging `origin/main` (2026-10-12): `npm test`
6 101 pass, 0 fail; typecheck, format, lint, launcher wiring and build pass;
every file in `dist/` is within 25 MiB. The build ships the three models
under hashed names; the proxies ride in the `station-console` chunk, which
grows from 126 KB (46 KB gzipped) to 379 KB (159 KB): the sim needs them before
any shipyard can collide, so they are not deferred. Browser gate: pending.

**Rows changed for the authored yards**, each from a measurement:

- the yard-does-not-turn row and C5's crossing count named the procedural
  Gantry's boom; both now read their subject from the authored proxy;
- the mouth duel's blind control asks for more than a third of the runs, not
  half: blind runs meeting a shipyard fell from 11, 8 and 8 to 7, 3 and 3
  (28, 23 and 26 meeting any station before; 24, 18 and 21 after), trade and
  refinery unchanged;
- the thinnest shipyard primitive is 0.7 m, a fitted plate.

## Historical measurements

The review-file size table above is from 2026-10-11, on the review GLBs.
The flight exports supersede it.
