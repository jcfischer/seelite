# Node #839 — the canopy struts were flat-shaded

Author: ranger implement worker, 2026-10-09.

## Cause

The checker on the curved canopy struts comes from the struts' **normals**.
Each quad of each strut was exported with its own face normal, so the whole
quad shaded as one flat facet. The bloom and the maps play no part in it.

**Where it comes from.** `spikes/courier-cockpit/build_model.py` builds every
strut with `curve_path`, a swept tube with 12 to 20 sides. Its `poly()` adds
four fresh vertices for every face. So every quad of a tube is its own island,
and the Weighted Normal modifier applied before export has no neighbouring face
to average with. Every quad leaves the exporter flat-shaded.

**The measurement.** `bun scripts/measure-cockpit-normals.ts` reads the shipped
GLB through the loader the game uses. It compares each strut vertex's normal
with the tube's true radial at that point. Flat shading puts a corner normal
half a facet off that radial.

| strut | sides | half a facet | exported, median / p90 | adopted, median / p90 |
|---|---|---|---|---|
| support hoop (`weathered-blue-steel`) | 20 | 9° | 9.09° / 12.51° | 0.50° / 2.16° |
| oblique rib (`graphite-housings`) | 12 | 15° | 15.03° / 15.59° | 0.39° / 1.89° |

The model has 9,530 positions where every face that meets lies inside the
crease (below). As exported, 9,528 of them carry split normals; after adoption,
none do.

**The frame.** I captured cockpit view on seed 47 in open space, headed on the
GPU lane (ANGLE Metal), with the clock held. I rendered four headings, each in
three arms: bloom on, bloom off, and bloom off with every cabin `bumpMap`
removed. The boxes on the right-hand support hoop are there in all three arms
at the same edges. Turning bloom off only removes the glow around the bright
quads. So the defect is in the shading and the bloom only enlarges it. The
bump-off arm rules out the node's second candidate. `poly()` also projects UVs
per face, so the albedo and the bump could change from quad to quad, but taking
the bump away leaves the checker unchanged. The third candidate, segment count,
is not the cause either. Twenty sides and eight samples per span give a smooth
silhouette once the facets are shaded smooth.

These captures are local session evidence. The script that took them is not
shipped, and the before/after view set is the principal's.

## Fix

`adoptCockpitTemplate` now passes every mesh through `smoothCockpitNormals`
(`src/cockpit-model.ts`). The pass finds the copies of one position by exact
coordinates. A grid would merge the model's 9 mm bevels and 5 mm chips, and
three's `toCreasedNormals` hashes positions to 1 cm, so neither is used. Each
copy takes the area-weighted mean of every copy within `COCKPIT_CREASE_DEG` of
its own exported normal. A copy with no such neighbour keeps its normal exactly
as exported. So box edges, chamfers and the exporter's own weighted normals do
not move. The index and vertex count are unchanged.

The pass runs once per page load, when the template is adopted. Under bun on
an M1 Pro it took 34.8–37.7 ms over the whole model in three runs. Builds
after that clone the smoothed geometry, so they pay nothing.

**The crease is 43.5°.** The exported split angles cluster at the tube facet
steps: 18°, 22.5°, 30° and 36° for 20-, 16-, 12- and 10-sided sections. They
also cluster at 45°, which is the chamfer steps and the eight-sided studs, and
at 90°, the box edges. No exported pair of normals falls between 42.46° and
44.81°, and the crease sits in that gap.

The review viewer (`courier-cockpit-viewer.ts`) runs the same pass, so it shows
the normals the game ships.

The bloom pass, `EMISSIVE_CEILING` and the materials are unchanged. With the
normals smooth, the sun's highlight runs as one continuous band along the
strut, and the bloom follows that band.

## Checks

The new `tests/cockpit-model.test.ts` rows run on the decoded shipped GLB, put
through `adoptCockpitTemplate`:

- **The crease sits in an empty band.** No exported pair of normals is within
  1° of the crease.
- **The surface is smooth inside the crease.** Wherever every face at a
  position is inside the crease, all copies share one normal. This row goes red
  with the pass removed: one fail in 16, with the other 15 green.
- **Hard edges keep their normals.** A copy with no other face inside the
  crease keeps its exported normal.
- **No normal moves far.** No normal moves by more than the crease.
- **Screens, labels and keys are untouched.** Their positions, normals and UVs
  are unchanged, so `screenFrame` reads the same quads.

The angles are taken as `atan2(|a×b|, a·b)`, not `acos`. Near a dot product of
1, `acos` turns float32 rounding into a 0.02° reading between two identical
normals.

## Not done here

**Visual sign-off.** The change alters what the cabin looks like, so it closes
on the canonical view set and the principal's yes in game
(`cockpit-strut-bloom-review`). This worker cannot give that yes.
