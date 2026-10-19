# Model integration: node #1032, the outposts Derrick, Buoy, Rig and Cluster

Follows [the authored-model integration SOP](../model-integration-sop.md) and
[node #1031's receipt](node-1031-outpost-salvage-integration.md), whose path
this node extends from form `e` to forms `a`–`d`. Design PR #826
(`design/remaining-stations-codex`, accepted commit `75f7b23`) arrived with
node #1031's squash merge: `spikes/stations/` on this branch's base already
holds its sources, so there was nothing left to merge.

## Current result

- **Mapping:** Derrick `a`, Buoy `b`, Rig `c`, Cluster `d` (the study names;
  `OUTPOST_MODEL_NAMES`). Each draws from its model once it installs; the
  procedural form stands in until then, and for good if the load fails.
- **Not in play:** no pool holds them. `OUTPOST_FORM` is still `e`, so a
  generated world still draws only the Salvage (`tests/station-form.test.ts`
  holds it). They are in the model catalog (`outpost/a`–`outpost/d`), so a
  station of one installs through the same background queue, and the station
  workbench draws them. `OUTPOST_MODELS`, the set swept in after every boot,
  is the Salvage alone: no player downloads the four.
- **Shipping assets** (`src/models/outpost-<name>.glb`, Meshopt NONE filter,
  lossless WebP, no LOD):

  | form | bytes | triangles | sha256 |
  |---|---|---|---|
  | a Derrick | 4,889,508 | 76,890 | `7f7a70a29b6a292292ac3f33fc2a1ad78899bb7d5a767e00cdf6a41b0e7abc20` |
  | b Buoy | 4,049,556 | 47,896 | `54ff8d7f41a753357734bbeb1e72304f863dcdaa9a0fc5c8d5ca34b3238f6628` |
  | c Rig | 5,202,512 | 83,141 | `ea2ce49965dc7f48bb9c8ca31219a86424a1201b6feae328326af040e705c879` |
  | d Cluster | 4,996,508 | 78,910 | `8ca948046ffe94c9597a7994d6bc8f0ed0b17677e2fb91d8c0aef8a892adbd00` |

  The Salvage's file is unchanged (`36a3ada8…`, 4,213,892 bytes): the new
  export path leaves its build alone, and the build reproduces its hash.
  `node scripts/check-dist-sizes.mjs dist` passes after `npm run build`: every
  file in `dist/` is within 25 MiB, the largest model 21.3 MiB (the
  interiors); the four are 3.9–5.0 MiB hashed assets.
- **Open:** the principal's yes on the look of the four (`ranger:needs-eye`),
  and the cost in a flown system, which no world can show until #460 places
  one.

## Integration contract

- **Units and axes.** As the Salvage's: the station's frame, metres, +z the
  aperture axis, an `aperture-plane` mark on the axis at the sim's plane
  (165 m), checked at install by `createOutpostBuilder`.
- **The studies face +Y, not +Z**, and the Rig's pad stands off the axis.
  The flight export turns each model a quarter turn about X so its pad faces
  +Z, moves the pad's centre onto the axis (the Rig's by 147.35 m across and
  105.35 m along the old Z) and its pad surface onto the plane. The pad
  surface is measured off the review GLBs (the top of the `landing-grey`
  tiles): Derrick 213.3 m, Buoy 123.3, Rig 51.2, Cluster 63.3
  (`FLIGHT_FRAMES`). No global scale.
- **Docking frame and envelope.** The sim's, unchanged: deck, berths,
  corridor, landing well and `STATION_GEOMETRY.outpost`. The pad is drawn by
  the model to the sim's figures, as the Salvage's is.
- **Berths, moving parts, collision owner, loading:** as the Salvage's.
  `station-proxy.ts` owns collision, from `src/outpost-proxies.ts`
  (generated from the shipped models) and the sim's deck.
- **Reach** (`STATION_FORMS` outpost): the authored model's reach is what each
  declares, the larger of stand-in, mesh and proxy. a 0.42 km and b 0.42
  stand (mesh 0.3781 and 0.3114, proxy 0.3799 and 0.3131); **c is 0.58** (was
  0.42; mesh 0.5716, proxy 0.5781) and **d is 0.50** (was 0.42; mesh 0.4925,
  proxy 0.4974), measured 2026-10-19. The Rig hangs its pad off the flank of
  its drill body and the Cluster puts its cans a pad away from the lane, so
  both stand further out than the 0.42 the stand-ins keep inside.

## Asset and geometry preflight

**The flight export** is `build_model.py -- <name> --flight`, as the
Salvage's: the approved layout without plate fasteners, seam strips, wear
trails or the cladding bevel, the Salvage's pad, landing well and flank in
the model's materials at the sim's figures. Where it differs from the
Salvage's path:

1. **Frame:** the turn and move above (`frame_batch`), before the pad is
   built, so the pad, well and flank code is the Salvage's, unchanged but for
   the flank's heights (now relative to the plane, which they were not).
2. **The front is carved, not cleared** (`carve_front`). The Salvage's pad
   sat in front of a box hull, so every part reaching the deck went whole. The
   four studies stand their pads on towers, drums and trusses, so a part that
   crosses the deck is split on the carve's planes and what lies inside the
   deck, or inside the liner above its floor, is deleted: the Derrick's
   column and the Cluster's hull box keep the rest of themselves. A touched
   part under 500,000 m³ of bounds goes whole, as the Salvage's. Four strips
   round the deck's edge also go, down to the study slab's underside, where
   the study's pad reached past the sim's 314 m deck (Derrick and Buoy).
3. **Orphans.** Whatever the carve leaves standing wholly in front of the
   plane, small and within 25 m of the study pad's rim, was fitted to that pad
   and would hang in the air: the Buoy's rear fin (one part), and three parts
   on the Rig. Dropped, and printed (`ORPHAN`).
4. **No hull closure.** The Salvage re-closes its box hull's face round the
   well; the four have no such face.
5. **Deterministic.** The carve keeps its faces in insertion order. A first
   version kept them in a set and the Rig's file differed between two builds
   of one source; the four now rebuild to identical hashes.

**Encoding:** `spikes/stations/prepare-flight-asset.mjs`, as #1031's: it
asserts exact vertex attributes, the export's triangle soup and texture
pixels after a decode.

**Checks on each shipped file** (`tests/outpost-flight-asset.test.ts`, now a
row set per form, through `decodeShippedGlb`): under the host's limit; under
250 k triangles; the `aperture-plane` mark on the axis at 165 m; no exterior
triangle in the deck's volume nor in front of it to 2 km; nothing in the
corridor's square from the well's floor outward; the deck's face on the
plane; a group per berth, an apron under each and nothing of the pad in a
cell's upper half; a lit lane edge; the lane floored behind the well. All
five forms pass.

## Collision proxy

The Salvage's rule, unchanged: the sim collides with the authored model
whatever is drawn; the hull is held to 10 m of empty space; the deck is the
sim's. `bun scripts/generate-outpost-proxies.ts` refits all five (about 1.5
minutes). Hull boxes: a 1,229, b 776, c 2,282, d 1,494 (e 971, byte-identical
to #1031's).

**One change to the fitter** (`scripts/lib/shipyard-proxies.ts`): the fit
keeps a face sample within `SAMPLE_LIMIT_M`, and the written box's samples
land elsewhere than the fit's, so a box on that limit passed the fit and
failed the row. The Buoy had five. Forms `a`–`d` fit half a metre inside the
limit (`fitLimitM`); the Salvage's boxes are as #1031 shipped them.

**Checks** (`tests/outpost-flight.test.ts`, per form): the recorded model
hash matches the file; no hull box face stands more than 10 m off the hull;
every hull vertex lies within 1.5 m of the proxy; the stand-in is solid as
the model before it installs. `tests/station-proxy.test.ts` now also measures
the four through `FORMS_MEASURED` (forms in play plus the outposts built
ahead: `tests/helpers/forms-in-play.ts`): containment, the clear corridor,
reach, thinnest primitive (0.8 m on all four, as the Salvage). "Only a form in
a pool has a proxy" now exempts exactly those four, and a row asserts the
exemption is the outpost forms no pool holds.

## Runtime and performance evidence

**Not measured in a flown system**: no world draws these forms, so SOP §4's
procedural-baseline against Full in the same scene cannot be taken in the
game yet. What was measured is the station workbench (`?model-viewer=station`,
the outpost role, every form selected in turn), single pass, GPU lane (M1
Pro, ANGLE Metal), 1280 × 800, `renderer.info` after five frames:

| form | procedural stand-in: calls / triangles | authored: calls / triangles |
|---|---|---|
| a Derrick | 97 / 10,396 | 57 / 76,678 |
| b Buoy | 72 / 1,572 | 57 / 47,684 |
| c Rig | 85 / 2,172 | 58 / 82,929 |
| d Cluster | 100 / 26,564 | 56 / 78,698 |
| e Salvage | 111 / 13,452 | 58 / 51,974 |

(The calls include the workbench's grid; the game draws a station in more than
one pass, which is why #1031 measured 163 calls and 155,730 triangles for the
Salvage in flight.) The four authored forms draw fewer calls than their
stand-ins and 48–83 k triangles, the Salvage's order. **No LOD level**, as the
Salvage's and for its reason: a level adds calls, and §4 asks for a measured
reason first. The in-flight cost of each is for the node that puts one in
play.

**Loading** (SOP §3):

| path | |
|---|---|
| Boot and cold download | Nothing added to boot: `bootModelIds` names a station model only for a docked save, and no save can be docked at one of these. `OUTPOST_MODELS` stays the Salvage, so no after-boot download either. |
| Background installation | The queue's: `outpost/a`–`d` in `model-catalog.ts`; `modelInstalled` refreshes any drawn station of the form, as the Salvage's. |
| Failed load | `prepareOutpostModel` clears its promise so a retry fetches again; the queue warns once; the procedural form stays (the stand-in row above). |
| Postcard, jump during install, rebuild and teardown | Shared with the Salvage: nothing in this node touches them. |

## Delivery evidence

**Headless.** `npm test` once on the final export's head, before the receipt's last edit: 6,658 pass, 0 fail across 384 files. Along the way: `tests/outpost-flight.test.ts` and
`tests/outpost-flight-asset.test.ts` (98 pass), `tests/station-proxy.test.ts`
(44 pass), `tests/station-mesh.test.ts`, `tests/model-urls.test.ts`; the
station, collision and system-model files (264 pass). The one red on the way,
station-mesh's "not slack" floor on the Rig's 0.58, now reads the authored
model for outposts (`tests/outpost-flight.test.ts`) and not the stand-in.
`npx tsc --noEmit`, `npm run format:check`, `npm run lint`, the launcher
wiring check and `npm run build` pass.

**Browser** (GPU lane, M1 Pro, selected by hand, not the selector's fallback
to all 111): `probe-model-queue`, `probe-model-download`, `probe-model-viewer`
and `probe-raider-outpost` pass. The PR gate (`npm run probe:pr`) is the
supervisor's, on the final head.

**The look.** The workbench frames of all five forms (hero, front, rear and
deck views) were captured on the GPU lane; Blender workbench renders of each
flight export were read before the shipping files were written. The four read
as their approved studies with the Salvage's deck, well and flank on them.
The principal's yes on the final look is pending. The Rig and Cluster decks
are 314 m against studies' pads of 248 × 288 and 282 × 273 m, so they
overhang their studies' hulls by a few tens of metres: the same sim-figure
ruling as #1031's.

**Changelog:** none. The question in `src/changelog.ts`'s docblock is a
player-visible change; no world draws these four, so nobody would see one.
