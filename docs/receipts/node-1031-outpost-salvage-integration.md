# Model integration: node #1031, the outpost Salvage

Follows [the authored-model integration SOP](../model-integration-sop.md).
Design PR #826 (`design/remaining-stations-codex`, accepted commit `75f7b23`)
is merged into `node/1031-outpost-salvage`, 2026-10-19.

## Current result

- **Design:** PR #826, principal-approved 2026-10-09; Salvage scored 6.90
  and was approved below the 7/10 threshold (`spikes/stations/README.md`).
- **Mapping:** Salvage → outpost form `e`, the one outpost form in play
  (`STATION_FORM_POOL.outpost`). The procedural Salvage draws until the model
  installs, and for good when it fails to load.
- **Pad presentation (principal ruling 2026-10-19, option 1).** Ranger's
  escalation measured the approved pad, a 200 × 180 m slab, against the sim's
  outpost: a deck 314 m square (`stationInterior("outpost").halfAcrossKm`
  157.26 m) with a 173 m hole round the lane (`padHoleHalfKm` 86.55 m), two
  berths of 78 × 54 × 30 m centred 124.86 m off the axis, and a landing well
  42.1 m deep (`padWellDepthKm`). The ruling: redraw the front to the sim's
  figures in the flight export, as #819 did for the refineries. The sim's
  geometry is unchanged. Rejected: the game's generic deck over a cleared
  front (option 2), and moving the sim's outpost to the slab (option 3).
- **Shipping asset:** `src/models/outpost-salvage.glb`, 3,868,000 bytes
  (3.69 MiB), sha256
  `6f78b99cb2d680fcf19c39b38faf09bb0dae81918c0e6d1fbc9979637fa180ca`.
- **Open:** the in-game look (view set and the principal's yes), the
  changelog sentence, SOP §4's LOD measurement, Sage, the browser gate.

## Integration contract

- **Units and axes.** The flight export is in the station's frame, metres,
  +z the aperture axis, its `aperture-plane` mark on the axis at the sim's
  plane (165 m). The game scales it to kilometres and checks the mark
  (`createOutpostBuilder`).
- **Docking frame and envelope.** The sim's: the deck, berths, corridor,
  landing well and `STATION_GEOMETRY.outpost` are unchanged. The model draws
  the deck and berths to those figures; the game draws the lit frame round
  the lane and both painted names (`buildOutpostNavigation`).
- **Berths.** `deck-near` always, and the seeded side berth on `port-near`
  (even seed) or `starboard-near` (odd). The model carries all three; a
  station keeps the two its seed draws.
- **Moving parts.** None: an outpost does not turn.
- **Collision owner.** `station-proxy.ts`, from `src/outpost-proxies.ts`
  (generated from the shipped model) plus the sim's deck (`padDeck`).
- **Reach.** `STATION_FORMS` outpost `e`: 0.43 km, the larger of stand-in
  (0.40), mesh (0.4262) and proxy (0.4281).
- **Loading.** The background queue (#838): `outpost/e` in
  `model-catalog.ts`, so `systemModelIds` names it for any system with a
  Salvage, and `refreshAuthoredStations("outpost", "e")` replaces the drawn
  stand-ins. No boot blocks on it unless the save is docked at a Salvage
  (`bootModelIds`, which names a docked save's station model).
  `outposts-full` and `outpostModelsSettled` mirror the refineries'.

## Asset and geometry preflight

**The review file.** `spikes/stations/salvage.glb`, 13,944,152 bytes,
128,476 triangles in 18 meshes.

**The flight export** is `build_model.py -- salvage --flight`. It differs
from the review build only where this list says:

1. **Density.** Plates draw no fasteners, seam strips or wear trails, and
   cladding gets no bevel, as the shipyards' and refineries'. They still draw
   the same random numbers, so every later part lands where the review build
   puts it.
2. **The plane** stands at 86.5 m in the review frame: the hull face's plates
   (their tops at 56 m) behind the sim's 30 m deck, with half a metre to
   spare, so no exterior part stands in the deck's volume. That is 7.5 m in
   front of the review pad's face (the dock mark, 79 m).
3. **Clearance.** Every review part whose bounds reach into the deck's
   volume, stand in front of it, or stand in the well goes whole: the slab,
   its frame and lip, the edge trunks, the rails, the machinery covers, the
   pipe runs round the pad. The hull box's steel shell is one connected part
   (its inset faces share corners), so it loses only its front face.
4. **The well**: four walls from the deck down to a floor 48 m behind the
   plane (the sim's well is 42.1 m), ribs and work lamps a metre proud of
   the walls (outside the 84.85 m corridor), and the hull face closed again
   round it.
5. **The pad**, authored to the sim's figures in the model's materials: a
   ring of landing-grey plates on a 31 m slab, the plates' tops on the plane;
   an ochre and black hazard band round the hole; a lit lane edge outside the
   band; a kerb inside the deck's edge; a flood mast at each corner; and on
   each of the three berths an apron, a lit outline with ochre centre marks,
   tie-downs, a tally lamp and a work-lamp mast at each outboard corner,
   outside the cell. Mesh groups carry the names the game reads
   (`interior-deck`, `interior-lane-edge`, `interior-rail`, `interior-flood`,
   `berth-<id>-*`).
6. **Placement.** The whole model is moved so the plane lies on +z at 165 m.

**Encoding.** `spikes/stations/prepare-flight-asset.mjs`: Meshopt (NONE
filter) and lossless WebP; it asserts exact vertex attributes, the flight
export's triangle soup and texture pixels after a decode. No simplification,
quantization or resize. Shipped: 39,222 triangles in 54 meshes.

**Checks on the shipped file** (`tests/outpost-flight-asset.test.ts`,
through `decodeShippedGlb`): under the host's per-asset limit; under 250 k
triangles; the `aperture-plane` mark at (0, 0, 165 m); no exterior triangle
in the deck's volume nor anywhere in front of it out to 2 km; nothing at all
in the corridor's square from the well's floor outward; the deck's face on
the plane; a group for each of the three berths; an apron under each and
nothing of the pad in a cell's upper half; a lit lane edge; the lane floored
behind the landing well. A mutant build (liner 82 m, one side berth left out)
turned the corridor, berth-group and apron rows red, 2026-10-19.

## Collision proxy

**The rule**, as the shipyards (#818) and refineries (#819): the sim collides
with the authored Salvage whatever is drawn; its hull keeps the shipyards'
rule (at most 10 m of empty space collides), fitted to the model's own
parts; the deck is the sim's (`padDeck`, now shared with the refinery).
The model has no rock, so no voxel fill.

**What shipped** (`scripts/generate-outpost-proxies.ts` →
`src/outpost-proxies.ts`, 24 KB, about 10 s a refit): 875 boxes (3,237
fitted, 1,365 after absorbing, 875 after merging). The fit's keep-out is the
refinery's, read from the outpost's figures (`padKeepOut`).

**Checks** (`tests/outpost-flight.test.ts`): the recorded model hash matches
the shipped file; the proxy is the same object before and after the install;
no hull box face stands more than 10 m off the hull; every hull vertex lies
within 1.5 m of the proxy. `tests/station-proxy.test.ts` measures the
installed Salvage now: containment within tolerance, the clear corridor, the
reach, and the thinnest primitive (0.8 m, a fitted plate; the procedural core
section was 90 m).

## Runtime and performance evidence

Pending.

## Delivery evidence

Pending.
