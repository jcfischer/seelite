# Node #839 — the canopy struts were flat-shaded

Author: ranger implement worker, 2026-10-09.

## Cause

The checker on the curved canopy struts comes from the struts' **normals**.
Each quad of each strut was exported with its own face normal, so the whole
quad shaded as one flat facet. The bloom only enlarges what the shading
draws.

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

**The frame.** I captured cockpit view headed on the GPU lane (ANGLE Metal,
Apple M1 Pro) at 1280 x 800 and device scale 2. The game booted `?seed=47` with
`no-save` and `boot=direct`, in open space. I held the clock and set
`orientation` to a pure yaw about +y, at 0°, 90°, 180° and 270°. Each heading
was rendered in three arms: bloom on, bloom off, and bloom off with every cabin
`bumpMap` removed.

At yaw 0 the sun lights the right-hand support hoop. The boxes on it are there
in all three arms, at the same edges. Turning bloom off only removes the glow
around the bright quads, so the defect is in the shading.

The bump-off arm removes only the bump. The albedo map, which `poly()` also
projects per face, stays on. What rules the maps out is the after frame: the
maps are untouched there and only the normals changed, and the checker is gone
with bloom both off and on. The highlight is one continuous band along the
hoop. That frame also shows the segment count is not the cause: twenty sides
and eight samples per span read smooth once the facets are shaded smooth.

These captures are local session evidence, and the script that took them is not
shipped. The canonical view set's two interior rows, `cockpit-arrival` and
`cockpit-backlit`, were not captured here. I have not checked whether a strut
catches the sun in either, so the sheet may have no frame for this lever. To
see it in game, fly with the sun beside and slightly behind the nose and look
at the support hoop on the sunward side.

## Fix

`adoptCockpitTemplate` now passes every mesh through `smoothCockpitNormals`
(`src/cockpit-model.ts`). The pass finds the copies of one position by exact
coordinates. A grid would merge the model's 9 mm bevels and 5 mm chips, and
three's `toCreasedNormals` hashes positions to 1 cm, so neither is used. Each
copy takes the area-weighted mean of every copy within `COCKPIT_CREASE_DEG` of
its own exported normal. A copy with no such neighbour keeps its normal exactly
as exported, so a join at or past the crease stays hard. The index and vertex
count are unchanged.

**The pass reaches the whole model, not only the struts.** Every join under
the crease is now shaded as one surface. That includes the other tubes and
ducts, the shallow steps of a chamfer beside its face, and copies the exporter
had already weighted. The instrument counts the 47,540 moved vertices by mesh.
*Inside* means every face at the position lies within the crease. *Edge* means
at least one pair of faces there is at or past it, and those positions keep
their hard side.

| mesh | moved, inside (largest turn) | moved, at edges (largest turn) |
|---|---|---|
| `exposed-machined-edges` | 13,056 (22.1°) | 2,520 (27.3°) |
| `graphite-housings` | 7,072 (18.0°) | 5,104 (24.2°) |
| `rubber-and-recess` | 11,584 (40.8°) | 1,632 (40.8°) |
| `weathered-blue-steel` | 6,280 (19.4°) | 160 (12.1°) |

The 9,416 edge moves are tube ends and chamfer steps that join their face. The
instrument does not separate the two. In the yaw-0 frames the box housings and
their chamfers read the same before and after. The visible change besides the
struts is the front coaming tube across the top of the dash, which now shows a
smooth band where it showed lit facets.

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
(`cockpit-strut-bloom-review`). This worker cannot give that yes. The yes covers
every join under 43.5° across the cabin, not only the struts: the ducts, the
coaming, the studs with ten or more sides, and the chamfer steps.
