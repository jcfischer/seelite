# Model integration: node #818, the three shipyards

Follows [the authored-model integration SOP](../model-integration-sop.md).
Prepared on the design branch `spike/shipyard-models-800` (PR #811) on
2026-10-11, before the integration itself. The runtime and delivery sections
are for the integration worker to fill.

## Current result

- **Design:** PR #811, principal-approved 2026-10-08. Branch rebased onto
  `main` `1b76a0f` on 2026-10-11; the spike tree was unchanged by the rebase.
- **Mapping (principal ruling 2026-10-11):** the approved yards replace the
  current shipyard forms one for one, so station selection is unchanged.
  O1 Gantry Works → `a`, O2 Foundry Hangar → `b`, O3 Crescent Slipway → `c`
  (`STATION_FORM_POOL.shipyard` in `src/station.ts`). The procedural forms stay
  only as the load fallback.
- **Shipping assets**, prepared, not yet loaded by the game:

  | Form | File | Bytes | Triangles | sha256 |
  |---|---|---|---|---|
  | a | `src/models/shipyard-gantry.glb` | 8 395 704 (8.01 MiB) | 200 748 | `5e6f3582b128b81aa197bdcdf9015b75680b64402f63c0beed28f8122ff397fe` |
  | b | `src/models/shipyard-foundry.glb` | 8 678 724 (8.28 MiB) | 209 360 | `b755de18f5f9c53c6e5762171c604c08f7eb5a12f9b49c3f1a233aad3c4b3053` |
  | c | `src/models/shipyard-slipway.glb` | 6 622 380 (6.32 MiB) | 135 956 | `ba54088fafad9278cc7dcac0a543ed40e83b506f0d51f2a6013ea03c69f46223` |

- **Flight look:** the principal looked at all three flight exports in the
  study viewer (`?flight=1`) on 2026-10-11 and approved them. This is not the
  in-game approval, which the map still requires before merge.
- **Open:** frame alignment to the station's aperture plane, berths and
  interior, collision proxies, the approach corridor in front of the mouth,
  loading, LOD, traffic, and everything in the runtime section.

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

The review build is unchanged: rebuilt from the edited script, O2's positions
and normals equal the committed `o2.glb` exactly, with texture coordinates
within 4.8e-7 (the bevel's run-to-run noise).

**Encoding.** `spikes/shipyards/prepare-flight-asset.mjs` reads the raw
flight exports from `.dream-loop/shipyard-flight/` (ignored; rebuilt by the
command above) and writes Meshopt (NONE filter) with lossless WebP. It asserts
exact vertex attributes, the flight export's triangle soup and texture pixels
after a decode. No simplification, quantization or resize.

**Checks on the shipped files** (`tests/shipyard-flight-asset.test.ts`,
through `decodeShippedGlb`, 18 rows): under the 25 MiB limit; under 250 k
triangles (a ceiling against the review density, not a render budget);
`life-capsule` and `docking-centre` at capsule-local (0, 0, 96 m); no
`throat-back`; no capsule triangle inside the production slot from z = −26 m
to +120 m (separating-axis test); along each drum face, no radial hole of
1 m or more in the stack above the plates. The slot row was red before the
end-cap corner fix, and the review O2 fails the rear-wall, slot and drum rows
(a 13.4 m hole).

## Runtime and performance evidence

Pending: the integration. SOP §3 lifecycle rows and §4 LOD measurements.

## Delivery evidence

Pending: the integration. On the design branch at preparation: the asset
test (18 pass), format, lint, typecheck and build passed, and the build
emits no shipyard file because nothing imports one yet.

## Historical measurements

The review-file size table above is from 2026-10-11, on the review GLBs.
The flight exports supersede it as the shipping candidates.
