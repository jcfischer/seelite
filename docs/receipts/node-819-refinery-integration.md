# Model integration: node #819, the four refineries

Follows [the authored-model integration SOP](../model-integration-sop.md).
Design PR #817 (`spike/refinery-models-804`, approval and handoff `91f2dc2`)
is merged into `node/819-refinery-integration`, 2026-10-13.

## Current result

- **Design:** PR #817, principal-approved 2026-10-09 ("looks good"), stopped
  at an independent 7/10 per model.
- **Mapping (default, by name):** Warren → `a`, Collar → `b`, Spar → `c`,
  Works → `d` (`STATION_FORM_POOL.refinery` in `src/station.ts`). Pool order
  is unchanged, so no system redraws its refinery. The procedural forms draw
  until a model installs, and for good when one fails to load.
- **Docking presentation (principal ruling 2026-10-13): recessed pad.** All
  four approved models dock through one fly-in box (`dock()` in
  `build_model.py`): a mouth of about 262–320 × 150–160 m, 200 m deep. The
  sim's refinery is a pad (#165): `stationInterior("refinery")` measures a
  deck 380 × 380 m with a 216 m hole round the lane, four berths 155 m off
  the axis, and a corridor of radius 106 m. The box holds neither. The flight
  export keeps the framed mouth, widened to a clear 400 × 400 m and made
  shallow; the sim's deck is its floor at the plane. Rejected: an open pad on
  the rock face, and reversing #165 to a bay.
- **Warren's look in the study viewer:** approved 2026-10-13 ("Approved,
  continue") as the direction for all four. The other three are placed per
  model; their look, and every one in game, is still owed.
- **Collision (principal ruling 2026-10-13): the rock within 20 m.** The plant
  and the housing keep the shipyards' rule (at most 10 m of empty space
  collides); the rock is filled with 20 m voxels. See *Collision proxies*.
- **Shipping assets** (`src/models/`): Warren 7.62 MiB, Collar 7.25, Spar
  8.95, Works 8.76 (each under Pages' 25 MiB). Checksums: see *Asset and
  geometry preflight*.
- **Open:** the in-game look of all four, the visual/probe rows the authored
  exteriors move, SOP §4's LOD measurement, Sage, the browser gate.

## In-game look (principal, 2026-10-13)

"Looking good", with flicker round the pad's dark edges, and the lights
wanted (Q3: "yes add lights").

- **Flicker.** A headless scan of every overlapping coplanar face pair from
  different meshes at the pad (within 260 m of the axis, 80 m behind the
  plane to 50 m in front) found none in the model and all of them in the
  game's own pad drawing, which every pad role shares (#282's question): the
  deck's outer walls and its kerb, the deck's hole and the lit touchdown ring,
  and inside each berth the kerb and apron ends, the backing and apron sides,
  and the tally and guide tops. The kerb and the touchdown ring step back one
  rim step (1 m), as #269's bay rings do; the berth's kerb, backing and tally
  grow by 2% of a length, 2% of a beam and 0.2 of a plate. The scan then
  found no visible pair. Not yet confirmed in flight.
- **Lights** (`buildRefineryPadCues`): on the pad frame every authored
  refinery shares (`src/refinery-pad-frame.ts`), a heat glow along its inner
  lip, two vent banks on its top border facing the approach (their throats
  are the flare; each carries an obstruction lamp on its first nozzle), and an
  obstruction lamp at each outer corner, all 2.5 m in front of the frame's
  face, clear of its 1.8 m armour. `AUTHORED_FIXTURE_NAMES.refinery` is now
  the procedural row. The banks' nozzles reach 64 m in front of the frame, past
  the proxy's 60 m slack, so the sim makes each bank one box
  (`padVentBanks`). A row holds every shipped model's frame face to the
  figures where the lights stand (the Collar's side pods stand proud of its
  side borders' outer half, where no light is).

## Integration contract

- **Units and axes.** The flight export is in the station's frame, metres,
  +z the aperture axis, its `aperture-plane` mark on the axis at the sim's
  plane (396 m). The game scales it to kilometres and checks the mark
  (`createRefineryBuilder`).
- **Docking frame and envelope.** The sim's: the pad deck, berths, corridor,
  landing well (`padWellDepthKm`, 50.6 m) and `STATION_GEOMETRY.refinery`
  are unchanged. The game draws the deck and berths
  (`buildRefineryNavigation`) into the model's housing.
- **Moving parts.** None: a refinery does not spin.
- **Collision owner.** `station-proxy.ts`, from `src/refinery-proxies.ts`
  (generated from the shipped models) plus the sim's deck.
- **Reach.** `STATION_FORMS` holds the larger of stand-in, mesh and proxy.
- **Loading.** As the shipyards (#818): after boot, each form replaces its
  drawn stand-ins; the boot holds only for a home refinery; the postcard and
  the station workbench wait for them; direct measurement boots settle them
  (`refineries-full`).

## Asset and geometry preflight

**Why the review files could not ship.** Review GLBs 19.9 / 18.7 / 43.3 /
25.8 MiB with 170 k / 158 k / 492 k / 253 k triangles; about 400 k of the
Spar's are plate fasteners.

**The flight export** is `build_model.py -- o1 o2 o3 o4 --flight`. It
differs from the review build only where this list says:

1. **Density.** Plates draw no fasteners, seam strips or wear trails, but
   draw the same random numbers, and cladding gets no bevel. Measured
   2026-10-13, by hand and not by a test: the review build
   (`-- o1 o2 o3 o4`, no `--flight`) rebuilt from the edited scripts, and
   again from the design branch's original `build_model.py` and
   `primitives.py` (`91f2dc2`) in a scratch copy, compared mesh by mesh on
   their `POSITION` arrays (glTF Transform). O1–O3: every `static/*` mesh
   (plates, cladding, machinery, lamps) identical, element for element, to
   the original scripts' rebuild; only the rock (`Icosphere*`) differs. The
   rock is not reproducible run to run: the original scripts' O1 rebuild
   differs from the committed `o1.glb` in the rock alone. (O2's and O3's
   committed mesh names carry build-order suffixes, so that comparison was
   not made for them.) O4: the edited scripts' rebuild has the committed
   `o4.glb`'s triangle soup exactly.
2. **The recessed pad** (`pad_housing`): a frame 472 m square with a clear
   400 m opening, its front 24 m in front of the deck's face; walls run back
   into the rock (200–300 m per model); the lane's floor stands 60 m behind
   the deck's face, past the sim's 50.6 m landing well. Placed per model
   (`FLIGHT_DOCK`): Warren's flush with its rock face, Collar's just proud of
   its belt, Spar's at its spine's end, Works' at the quarry's front wall.
3. **The bore.** The housing's footprint plus 40 m, cleared through the rock
   before it is displaced. The Works' quarry shell intersects itself, and
   the plain exact boolean returned an empty mesh (15 360 faces to 0); it
   cuts in self-intersection mode, and the build fails if a cut leaves
   nothing. (The float solver left a ring of fragments.)
4. **Clearance.** Review parts whose bounds reach into the housing's clear
   volume are dropped whole (a boulder on Warren, the Collar's front-head
   plates); rock displaced into it would be pushed back to the walls (none
   was).
5. **Placement.** The whole model is moved so the plane lies on +z at 396 m.

**Encoding.** `spikes/refineries/prepare-flight-asset.mjs`: Meshopt (NONE
filter) and lossless WebP; it asserts exact vertex attributes, the flight
export's triangle soup and texture pixels after a decode. No simplification,
quantization or resize.

**Checks on the shipped files** (`tests/refinery-flight-asset.test.ts`,
through `decodeShippedGlb`, 7 rows a form): under 25 MiB; under 250 k
triangles; the rock present and whole (enclosed volume at least 80% of the
review rock's; the flight rocks read 100–103%); the `aperture-plane` mark at
(0, 0, 396 m); no model triangle in the deck the game draws nor anywhere in
front of it out to 2 km; the lane floored behind the landing well; a frame
round the deck.

Two failures the rows caught on the way: the Warren's rock once exported
with no mesh, and the float solver's Works rock passed a triangle-count row.

## Collision proxies

**The rule.** As the shipyards (#818): the sim collides with the authored
refinery whatever is drawn. The plant and the pad housing keep the
shipyards' rule (at most 10 m of empty space collides); **the rock is held
within 20 m** (principal ruling, 2026-10-13); the deck is the sim's.

**Why the rock is filled, not fitted.** #818's fitter (oriented boxes per
connected part, split and merged under the rule) fits a faceted rock at
about one box a facet, whatever the limit: Warren's rock took 19 460 boxes at
10 m and 17 459 at 25 m. Filled with voxels merged into boxes (rays along +z,
parity at each column's centre), a rock took, measured 2026-10-13:

| Voxel | Warren | Works |
|---|---|---|
| 10 m | 4 937 | 4 168 |
| 20 m | 1 172 | 1 031 |
| 30 m | 515 | 442 |

The filled volume matches the rock's (Warren 450 Mm³ both ways).

**What shipped** (`scripts/generate-refinery-proxies.ts` →
`src/refinery-proxies.ts`, 618 KB; a refit takes about 4 minutes):

| Form | rock voxel | rock boxes | plant boxes | proxy reach |
|---|---|---|---|---|
| a Warren | 20 m | 1 172 | 5 235 | 0.839 km |
| b Collar | 20 m | 1 711 | 1 745 | 0.900 km |
| c Spar | 20 m | 908 | 3 151 | 1.235 km |
| d Works | 10 m | 4 177 | 5 584 | 0.882 km |

The Works' quarry rim is thinner than half a 20 m voxel along the rays and
rounded away: at 20 m, 291 rock vertices stood up to 52 m outside the
proxy. At 10 m, 171 still stood 21–24 m out, so any rock vertex farther than
the rule from the filled solid fills its own voxel (faces within 17.3 m of
it at 10 m). That took the Works from 4 168 rock boxes to 4 177; the other
three are unchanged.

**The deck** (`padDeck` in `station-proxy.ts`): the deck the game draws, from
its back face to 30 m above the plane (the procedural forms' figure, so the
berths are solid, `collision.md` §9 obligation 8), cut round the corridor and
the landing well.

**Checks** (`tests/refinery-flight.test.ts`): the proxies' recorded model
hashes match the shipped files; no plant box face stands more than 10 m off
the plant; no outer face of the filled rock stands more than 20 m off the
rock (a face is outer when the voxel beside it is empty; sampled every 2 m;
the row went red with the limit cut to 5 m: 679 410 samples); every plant
vertex lies within 1.5 m of the proxy and every rock vertex within 20 m.
`tests/station-proxy.test.ts` holds containment within 60 m, the clear
opening, the reach and the thinnest primitive (0.8 m, a fitted plate) with
the models installed. Its two rows on the Works' solved-plan proxy are gone
with that proxy.

**Test cost.** The vertex walk concatenated a non-spinning station's two
primitive lists for every vertex, so `proxyContains` re-indexed ~10 000 boxes
per vertex (one form's row ran past five minutes), and it asked every
flat-shaded duplicate of a position. Both fixed in
`tests/helpers/station-proxy-measure.ts`: the Works' row takes 12 s.

**Reach** (`STATION_FORMS`, the larger of stand-in, mesh and proxy): a 1.2
(stand-in), b 1.15 (stand-in), c 1.24 (mesh 1.234, proxy 1.235), d 0.89
(mesh 0.878, proxy 0.882).

## Runtime and performance evidence

**Frame and loading** (`src/refinery-flight.ts`, `src/main.ts`): the builder
checks the export's `aperture-plane` mark against the sim's plane, scales
the model to kilometres and draws the sim's pad into it
(`buildRefineryNavigation`); nothing turns. Each form installs after boot
and replaces its drawn stand-ins (`refreshAuthoredStations`, shared with the
shipyards); `refineryModelsSettled` says when all four have settled; a
Commander docked at a refinery waits for that form (`homeRefineryForm`); the
postcard and the station workbench require the models. Live, 2026-10-13
(dev server, M1 Pro, Metal): seed 3's Spar installed as authored after
settle, with the sim's pad, its berths and parked traffic drawn into the
housing, and no failed request.

**Boot payload.** The proxies ride in the `station-console` chunk, which
grows from 379 KB to 985 KB (159 KB to 478 KB gzipped): the sim needs them
before any refinery can collide, so they are not deferred.

**Pending:** SOP §4's measured LOD selection, and the frame cost in game.

## Delivery evidence

Headless at 885ad0b5 (2026-10-13): `npm test` before the last fixes, 6 223 pass,
5 fail: the launcher-wiring gate (two untracked scratch scripts, removed),
the two model-URL rows (now counting the refinery literals) and two
avoidance rows (above); each re-run green after its fix (`model-urls` 5,
`combat-enemy-avoidance` 59, `refinery-flight` 33, `station-proxy` rows
alone). Typecheck, format, lint, launcher wiring and build pass; every file
in `dist/` is within 25 MiB.

Not yet run: Sage, the browser gate (`probe:pr`), the canonical view set,
and the principal's in-game look.
