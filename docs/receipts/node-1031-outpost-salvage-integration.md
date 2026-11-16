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
- **The look, principal rulings 2026-10-19** (flown at seed 56, system 0):
  D1, the authored deck glows as the procedural pad (`padShell`) and its
  plating is matte; D2, the review pad's surround (edge trunks, machinery)
  moves to the deck's four outer sides; D3, the changelog sentence; D4
  (option 3), the deck plates a middle grey, `0x737a80`, between the study's
  `landing-grey` and the procedural deck's `0x8b95a0`, on the pad's own
  material copies.
- **Shipping asset:** `src/models/outpost-salvage.glb`, 4,213,892 bytes
  (4.02 MiB), sha256
  `36a3ada8b9b0216ccc7e7443923841083a44d2f960757e961fcc4e78893f1efd`.
- **LOD:** none (the Full model only), as the shipyards and refineries;
  measured cost below. Frame time not measured.
- **Open:** the principal's yes on the final look.

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
  (0.40), mesh (0.4262) and proxy (0.4281), measured with the dressing.
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
6. **The flank** (principal, 2026-10-19, D2): on each of the deck's four
   outer sides an edge trunk with its pipes and lamps under the deck's face,
   and five machinery units below it, the review pad's own parts. Exterior
   structure, outside the deck's volume; the deck's slab stands half a metre
   past the sim's edge so they are seated on it.
7. **Placement.** The whole model is moved so the plane lies on +z at 165 m.

**Encoding.** `spikes/stations/prepare-flight-asset.mjs`: Meshopt (NONE
filter) and lossless WebP; it asserts exact vertex attributes, the flight
export's triangle soup and texture pixels after a decode. No simplification,
quantization or resize. Shipped: 52,150 triangles in 58 meshes.

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
`src/outpost-proxies.ts`, 27 KB, about 10 s a refit): 971 boxes with the
flank dressing (875 before it). The fit's keep-out is the
refinery's, read from the outpost's figures (`padKeepOut`).

**Checks** (`tests/outpost-flight.test.ts`): the recorded model hash matches
the shipped file; the proxy is the same object before and after the install;
no hull box face stands more than 10 m off the hull; every hull vertex lies
within 1.5 m of the proxy. `tests/station-proxy.test.ts` measures the
installed Salvage now: containment within tolerance, the clear corridor, the
reach, and the thinnest primitive (0.8 m, a fitted plate; the procedural core
section was 90 m).

## Runtime and performance evidence

**The station's cost per frame**, measured 2026-10-19 on the GPU lane (M1
Pro, ANGLE Metal), seed 56, system 0, at four framings 0.9–1.4 km off the
pad: `renderer.info` over five frames with the outpost shown, less five with
it hidden (`.tmp/capture-salvage.mjs`, not tracked). Counts were constant
across the five frames.

| | draw calls | triangles |
|---|---|---|
| procedural Salvage | 115 | 19,184 |
| authored, before the flank dressing | 151 | 116,946 |
| authored, with it | 163 | 155,730 |

The triangles are about three times the model's: the station is drawn in
more than one pass. No LOD level was tried: a level adds calls, and SOP §4
asks for a measured reason first.

**The look.** Before/after frames at the same four framings, seed 56,
system 0, were shown to the principal in this session; the view set's
`outpost-interior-workbench` now names form `e` (it named `d`, a form
the role no longer draws).

## Delivery evidence

**Headless** (`npm test` at `d63c4384`): 6,569 pass, 3 fail — the two
model-URL rows (now counting the Salvage literal) and outpost E's reach row
(0.42 → 0.43); each re-run green after its fix. The outpost, proxy, asset,
view-set and changelog files re-run green on every later head. Typecheck,
format, lint, launcher wiring and build pass; every file in `dist/` is within
25 MiB.

**Sage** (PR #1037): round 1 at `996fba28`, all seven lenses ran: 19
findings, no blocker or major (3 suggestions, 16 nits); 2 taken in
`aa73889c`, 17 declined with reasons on the PR. Stopped there under the
map's rule.

**Browser gate: the directly affected probes, by the principal's instruction
(2026-10-19)**, not the selector's fallback to all 111 (it fell back on
`scripts/probe-guard.mjs`). GPU lane (M1 Pro, Metal), one probe at a time
under the probe lock, against this worktree's dev server (own Vite cache);
`probe-collision` on its own server, since it imports `three` from the
default cache. Head `aa73889c`, all pass, peak load 7–18 on 10 cores:
`probe-station`, `probe-station-visuals`, `probe-dock-arrival`,
`probe-docking`, `probe-raider-outpost`, `probe-model-download`,
`probe-model-queue`, `probe-quality-bloom`, `probe-adaptive-resolution`,
`probe-planet-surfaces`, `probe-postcard`, `probe-model-viewer`,
`probe-station-interior-kit`, and the two `collision` probes. This is
selected coverage, not a full-suite pass.

**The look:** the principal's rulings D1–D4 above; the final yes before
merge is pending. Changelog sentence approved (D3).
