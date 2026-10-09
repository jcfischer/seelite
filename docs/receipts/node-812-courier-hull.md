# Node #812: the approved O4 courier hull in the game

Author: Claude / ivy-agent (ranger implement lane). Measured 2026-10-09 on an
Apple M1 Pro, ANGLE Metal unless a row says otherwise.

The principal approved the O4 study on #795 (visual commit `720c928`). This
receipt records how it was integrated, what was measured, and what the
principal ruled. **The principal flew `c21419c` and approved the visuals on
2026-10-09**, and ruled on Q1 and Q7 and the Field Notes copy in a PR comment
the same day (below). Both browser rows that were red on Q1 are green.

## What ships

- `src/models/courier-hull.glb`: the study export re-encoded by
  `spikes/courier-hull/prepare-game-asset.mjs` with dedup, reorder, Meshopt
  and lossless WebP. There is no simplification and no quantisation. The
  script asserts that the Meshopt encoding round-trips every vertex attribute
  exactly (its baseline is taken after dedup and reorder) and that the WebP
  pixels are exact. `tests/courier-hull.test.ts` holds the shipped file
  against the study export itself: every mesh's triangles, with each corner's
  position, normal and texture coordinate. (Corrected in sage round 2: this
  line said the script asserted exact vertex attributes, and until round 2 the
  test compared positions only.) **15,940,136 bytes** (the study is 30,766,660), with 353,954
  triangles, 36 meshes and two 1254² WebP textures (2.03 MB and 1.81 MB). The
  boot now downloads the Coriolis (6.70 MB), the cockpit (3.14 MB) and this
  file.
- `src/courier-hull.ts` builds the courier from the loaded template. It turns
  the model a half-turn about Y (the study is +Z forward, the game's hull is
  −Z), scales it uniformly to kilometres, and adds two drive glows (`…-exhaust`)
  at the nozzle throats so that the vent plumes and the finish find them. It
  unpowers the study's four fixture screens, normalises the lamps to
  `EMISSIVE_CEILING`, and marks all geometry, materials and textures
  `shared()`.
- `buildShipMesh("courier", "a")` draws it once it is installed. Nav lights are
  placed once per model and cloned, because the raycast against 354k triangles
  took about 0.3 s per courier.
- Loading: the model loads behind the existing Retry panel on every path that
  builds a Game (the main boot and the postcard viewer) and on
  `?model-viewer=ship`. The first courier is built inside the loader, so no
  Traffic courier pays the nav-light raycast mid-flight.
- **The courier hull blocks boot until node #838 lands.** It is one of
  `prepareCoriolisPage`'s `also` loaders, so no Game starts before it
  arrives. Map #1's Constraints were amended on 2026-10-09 (#830, #835): only
  the cockpit and the home station's exterior block a start, and every other
  model, this one included, installs after boot behind a procedural stand-in.
  That mechanism is node #838's, not this node's, so review findings asking
  to take this file off the boot path, or to move its level and nav-light
  work out of the loader, are left to #838. The gap #838 inherits: the
  Kestrel cannot be the courier's stand-in as it stands, because it is built
  11.65 m tall against the O4's declared 9.6 m envelope.
- Traffic flies the selected variant, so every Traffic courier is the O4.
- Since sage round 2 the detail band switches the model (below,
  "Reduced levels").

## D1. The size: the length is held, and why

The study is 60.95 m long, 55.52 m across and 10.11 m high. The model is drawn
at 57.45 m long, inside the declared 57.5 m, which is a uniform 0.9425 of the
study.

**The courier's length is every hull's agility reference.**
`referenceHandling` (`scripts/measure-vent-shares.ts`) scales each hull's
angular figures by `(thrust / length)` over the courier's. A 61 m courier would
have retuned the turning of all twelve hulls.

Checked: with the new envelope and placement, `bun scripts/measure-vent-shares.ts`
reports `re-solve pitch,yaw,roll` for the courier alone. The other eleven rows
read `matches`.

## D2. The envelope, measured off the model

| | before (Kestrel) | now (O4) |
| --- | --- | --- |
| built box | — | 57.45 × 52.33 × 9.53 m |
| `env` (rounded up 0.1 m) | 57.5 × 51.3 × 11.7 m | 57.5 × 52.4 × 9.6 m |
| `envCentre` | right 0, up 1.0, fore 1.8 m | unchanged: the model's box is centred on it |
| density (60 t) | 1.74 t/1000 m³ | 2.07 t/1000 m³, inside the 1.2–2.4 band |
| farthest vertex | — | 35.8 m, inside `HULL_REACH_KM` 36 m |

Berth fit and the spin ceiling are unchanged. These are the berths that
admit the courier on seed 1, before and after: trade 8/8 and 8/8, shipyard
6/6 and 6/6, refinery 4/4 and 4/4, outpost 2/2 and 2/2.
`tests/aperture-fit.test.ts` and `tests/hull-docking.test.ts` pass. The
spin-ceiling row prints each hull's first failure, and the courier's reads
the same at the merge base (`8c865d2`,
the Kestrel's 11.7 m box) and on this branch (the O4's 9.6 m): `courier first
fails at 13.5 rpm after 25 unbroken rungs; 13 coincidental crossings above
it`, so the courier docks to 13.0 rpm either way. Every other hull's row is
identical too.

Vent placement was re-measured on the model (`scripts/measure-vent-placement.ts`):

`{"retroX":0.5,"strafeZ":0.25,"yaw":{"y":0,"fore":0.995,"aft":0.9975},"pitch":{"x":-0.025,"fore":0.9975,"aft":0.9225},"roll":{"z":-0.075,"port":0.9975,"starboard":0.9975}}`

The courier's shares were then re-solved: pitch 0.00769567, yaw 0.0132061,
roll 0.00678681. `flightPerformance("courier")` still reproduces #5's tuning
exactly.

Two consequences:

- The yaw arms are no longer equal (0.995 fore, 0.9975 aft). A dead
  `aft-port-lateral` now leaves 49.94% of the yaw couple, not 50%.
  `tests/vents.test.ts` now states the arm ratio.
- The instrument used three's raycast, which would have taken about an hour on
  354k triangles. `scripts/lib/axis-line-hits.ts` answers the same raycast
  from a grid, and it reproduces all eleven other hulls' stored placements
  exactly.

## Performance (`scripts/measure-courier-hull-cost.mjs`)

Setup: one page, chase view, clock held, 1440×900 at device scale 2, GPU lane
(ANGLE Metal, M1 Pro). 12 blocks × 120 frames, arm order shuffled from seed
20261009. Timing is a tight loop with a `readPixels` drain, which is a wall
clock rather than the player's cadence.

| arm | occlusion off: ms | calls | triangles | occlusion on: ms | calls | triangles |
| --- | --- | --- | --- | --- | --- | --- |
| no hull | 1.985 | 209 | 517,372 | 3.649 | 552 | 2,211,808 |
| O4 | 2.315 | 249 | 872,120 | 4.063 | 625 | 2,921,244 |
| Kestrel | 2.064 | 239 | 527,352 | 3.823 | 611 | 2,231,768 |
| O4 + 4 more | 2.622 | 390 | 2,270,018 | 4.755 | 885 | 5,716,860 |
| Kestrel + 4 more | 2.141 | 342 | 562,488 | 3.913 | 813 | 2,302,040 |

Differences between arms:

| comparison | occlusion off | occlusion on |
| --- | --- | --- |
| O4 − Kestrel | +0.251 ms (144/144) | +0.239 ms (144/144) |
| five O4s − five Kestrels | +0.481 ms (144/144) | +0.842 ms (144/144) |

No LOD was built in round 1; the rows above are that build's. Round 2 built
one.

### Reduced levels (sage round 2)

Every courier now carries the model and two reduced copies, and the existing
ship detail band (`detail-level.ts`, stepped every frame for every hull
`main.ts` draws) picks one. `full` is the approved model, triangle for
triangle. Past `DETAIL_RADII.full` (40 courier reaches, 1.44 km) a courier
draws `reduced`, and past `DETAIL_RADII.reduced` (400, 14.4 km) it draws
`outline`.

- **How a level is made.** At load, from the loaded model (`courier-hull.ts`),
  by meshoptimizer's simplifier: each mesh welded on position, edges collapsed
  under an absolute error, normals recomputed with a 30° crease, and the
  corners welded again where they agree (sage round 5), so a level is indexed
  rather than three corners a triangle; the triangle counts did not move. A collapse
  moves a corner onto an existing vertex, so every vertex of a level is one
  of the model's and the level's box lies inside the model's; a triangle
  between existing vertices can still bridge a concavity, so the surface is
  not shown to stay on or inside the model. The envelope rows still read the full model's box. The cabin and the
  pilot are left out of both levels.
- **The error is a target, in pixels.** Half a device pixel at the level's
  band edge, at the near camera's 60° on a 1800-pixel frame (900 CSS pixels
  at device scale 2): 0.46 m for `reduced`, 4.6 m for `outline`
  (`courierLevelErrorKm`, asserted in `tests/courier-hull.test.ts`). That
  is what the simplifier is asked for, against its own error metric; it is
  not a measured or guaranteed bound on how far a level lies from the model.
  The band's hysteresis draws `reduced` somewhat nearer than its edge on the
  way back in, and a frame taller than 1800 pixels sees the same error at
  more than half a pixel. What the simplifier reports reaching, the largest
  over a level's meshes, is recorded on the level (`LEVEL_REACHED_ERROR_KM`)
  and held at or under the target by its own row: 0.460 m against 0.462 for `reduced`, 4.532 m against 4.619 for
  `outline`. With the target tripled the row goes red, reading 1.372 m. It does not
  hold the recomputed normals or the welded texture coordinates, so what the
  switch does on screen is measured separately (Q7).
- **Triangles.** `full` 353,954; `reduced` 92,540 (20 meshes); `outline`
  6,472 (11 meshes), pinned in the test. Two meshes, `blue-grey-1` (35,518)
  and `pale-steel-1` (17,928), barely reduce at 0.46 m and are most of what
  `reduced` still draws.
- **Nothing is measured on a level.** Its meshes are `CourierLevelMesh`,
  whose `raycast` is empty, and carry `userData.levelStandIn`, which the vent
  throats and `scripts/measure-vent-placement.ts` skip. Nav lights, muzzles
  and throats are placed on the approved metal. A wreck darkens every level.
- **What it costs at load.** `createCourierHullBuilder` took 231–251 ms in
  bun over three runs, most of it the two levels. It runs inside the loader,
  behind the Retry panel, like the nav-light raycast. `meshoptimizer` moves
  from `devDependencies` to `dependencies`, since `src/` imports its
  simplifier.

`scripts/measure-courier-hull-cost.mjs` now has two more arms: the same four
extra couriers, or Kestrels, placed on the camera's axis at 60 and 80 courier
reaches, where the band draws `reduced`. The instrument checks that the
level drawn is the one named. Same machine and lane as above, run 2026-10-09
under a load average of 6–12 from other sessions, so the milliseconds
separate weakly. The draw counts are exact.

| arm | occlusion off: ms | calls | triangles | occlusion on: ms | calls | triangles |
| --- | --- | --- | --- | --- | --- | --- |
| no hull | 4.253 | 194 | 255,970 | 6.505 | 490 | 904,794 |
| O4 | 5.232 | 234 | 610,718 | 7.250 | 563 | 1,614,230 |
| Kestrel | 4.091 | 224 | 265,950 | 6.640 | 549 | 924,754 |
| O4 + 4 near | 5.518 | 375 | 2,008,616 | 8.297 | 823 | 4,409,846 |
| Kestrel + 4 near | 4.574 | 327 | 301,086 | 6.757 | 751 | 995,026 |
| O4 + 4 far | 4.954 | 330 | 984,054 | 7.530 | 743 | 2,360,694 |
| Kestrel + 4 far | 4.425 | 332 | 304,526 | 6.643 | 761 | 1,001,906 |

| comparison | occlusion off | occlusion on |
| --- | --- | --- |
| four near O4s − four near Kestrels | +0.944 ms (125/144) | +1.540 ms (144/144) |
| four far O4s − four far Kestrels | +0.529 ms (106/144) | +0.888 ms (117/144) |
| four near O4s − four far O4s | +0.564 ms (99/144) | +0.767 ms (128/144) |

The scene behind the arms differs from round 1's (the no-hull arm draws
255,970 triangles here against 517,372 then), so the two tables compare
within themselves and not across. Four far couriers add 373,336 triangles
over the O4 alone, 93,334 each. The `reduced` level is 92,540 of them and the
two drive glows 768 (384 each, the bowl the default finish draws, counted
headless on a built courier); the last 26 are not attributed. The nav lights
are points and add none. Inside 1.44 km a Traffic courier is still the full
model. The near row prices four couriers 0.16–0.32 km ahead of the player in
the seed-42 approach scene: a stand-in for ships close by, not a measured
berth, and how many couriers a berth draws at once was not counted.

Headless timings (bun) on the model:

| step | time | when |
| --- | --- | --- |
| first build (nav-light raycast) | 293 ms | once, inside the loader |
| later builds | 0.5 ms | |
| `ventThroats`, first | 486–499 ms | once per model and finish: the game's finish inside the loader, another only on the workbench's switch |
| `ventThroats`, later | 0.03 ms or less | every courier the player flies, at boot or on a shipyard hull change |
| muzzles | 35 ms | |

The two `ventThroats` rows are sage round 1's: the throats were measured
afresh for every courier (530 ms each) until `vent-plumes.ts` kept them per
installed model and finish. Two runs of six builds each, after the first
build had placed the nav lights.

## Verification

- **Sage round 9, on the code tree being pushed (`077d890`; the commit after
  it changes this receipt only):** `npm test` 5728 pass, 0 fail (398.6 s,
  load average 18–26 from other sessions). Browser probes singly on the GPU
  lane: light-rig 12/12, postcard 43/43, ship-visuals, vent-display,
  chase-orbit and boot pass; light-rig and postcard also pass on
  SwiftShader. Those six were chosen as the probes this round's and round 7's
  changes reach (the glow-keyed throats and the builder-keyed nav lights are
  vent-display's and ship-visuals'); the full suite was not run here.
- `npm test`: 5685 pass, 0 fail (349.3 s) after sage round 1; 5691 pass, 0 fail (355.6 s) on round 2's final tree. On sage round 5's tree, which carries round 4's child re-parenting and its row: 5694 pass, 0 fail (423.8 s), under a load average of 22–28 from other sessions. One earlier round-2 run timed out two `tests/station-proxy.test.ts` rows (43.6 s and 41.0 s against a 30 s limit) under a load average of 28–45 from other sessions; the file passed alone in 20.0 s and the next full run was green.
- Round 2's browser probes, singly on the GPU lane: ship-visuals, boot,
  derelict, vent-display, station-route-traffic, shipyard, chase-orbit,
  traffic-mouth, docking-traffic, traffic-engagement, collision (both),
  docking, and dock-arrival pass. probe-light-rig is red on Q1's figures,
  unchanged (peak 252.21, lower quartile 10.16, median 37.88). probe-postcard is red on the same row as before (Q1, 0.5% of cells). Both are green since sage round 9.
- Bun preload: `tests/setup-courier-hull.ts` installs the shipped model for
  every file, so headless rows measure the courier the player flies. Its
  installer and the GLB decoder moved to `scripts/lib/` in round 2
  (`shipped-courier-hull.ts`, `shipped-glb.ts`), because
  `scripts/measure-vent-placement.ts` uses them too.
- Procedural generator rows: the four files that hold the procedural hull
  language (`ship-mesh`, `ship-finish`, `surface`, `ship-details`) run on the
  procedural Kestrel through `useProceduralCourier()`. Their courier rows
  describe the generator, not this hull.
- Browser probes run on the GPU lane, singly (`probe:one`), for the node's
  first record (`e6fc8e4`), before sage round 2 added the reduced levels:
  ship-visuals, boot, vent-display, derelict, cabin-pass, live-cockpit,
  chase-orbit, occlusion, shipyard, dock-arrival, station-route-traffic,
  traffic-engagement, docking, collision, docking-traffic and traffic-mouth
  all pass. **probe-light-rig** and **probe-postcard** are red (Q1), green since sage round 9. The full suite was not run here; the
  supervisor runs it.
- Sage round 4, on its own tree, which carries the reduced levels and their
  switching: ship-visuals, cabin-pass, live-cockpit and occlusion, singly on
  the GPU lane, all pass. These are the three round 2's list left out, plus
  ship-visuals. `scripts/measure-courier-hull-cost.mjs` ran to the end with
  its level check reading the shared names; its figures were taken under a
  load average of 20–33 from other sessions and are not transcribed.
- `probe-ship-visuals` changes:
  - Its identity row now checks the authored model.
  - Its #101 plating section boots `?hull=interceptor`, because the courier
    carries none of that plating.
- View set: `npm run views -- --label after-812` (72 views) is in
  `view-set/after-812`. No `before` run was captured on this machine.
- In-game frames: `node spikes/courier-hull/capture-game.mjs` writes to
  `.dream-loop/courier-game/<label>/`.

Found on the way: an exact `closing > 0` billed a resting ship pair at
2e-17 km/s as an impact of zero damage. The courier's new box exposed it in
`tests/collision-traffic.test.ts`. The floor is now
`RESTING_CLOSING_FLOOR_KMS` (1 nm/s, `collision.md` §3.1).

## For the principal

**Q1. How the hull reads under the game's rig.** In game the O4 reads much
darker than in its study viewer. That viewer had its own key light, softbox,
rim light, hemisphere, room environment and ACES at 1.1. The machined-alloy
trim also catches the sun near white.

`probe-light-rig` reads the painted hull in the `hull-chase` framing:

| | O4 | band | Kestrel (worn, `c6f8b57`) |
| --- | --- | --- | --- |
| peak | 252.21 | 139.3–215 | 204.92 |
| lower quartile | 10.16 | ≥ 19.33 | 22.80 |
| median | 37.88 | ≥ 68.40 | 79.53 |

- Hiding `machined-alloy` alone drops the peak to 223.9. So that trim sets
  most of the peak, and it is hull metal. The rest, 223.9 against the 215
  ceiling, was not attributed: no arm hid the canopy, the pilot or the
  interior, so none of them is ruled out.
- No single albedo scale meets both ends: the band allows a peak-to-median
  ratio of about 3.2, and the O4 reads 6.6.
- `probe-postcard`'s "the exterior composition is a different camera" row reads
  0.5% of cells changed against a 2% floor. Why it reads low was not
  measured. One untested reading is that a dark hull changes few cells
  against a dark sky whichever camera frames it.
- Neither threshold was moved before the ruling.

**Ruled 2026-10-09: O1, accept the in-game look; the band follows it.** What
was done, each figure measured in sage round 9:

- `scripts/lib/hull-luma.mjs` re-calibrated at `9f8d533`, rig B,
  `hull-chase`, five samples per lane, same-build noise 0.00: ANGLE Metal
  252.21 / 10.16 / 37.88, SwiftShader 252.21 / 10.16 / 38.80. The lower is
  recorded; `laneSpread` is 0 / 0 / 0.92.
- **Keyed on the subject, not the finish.** Built under every finish preset,
  the authored courier differs only in its two drive glows, which are
  emissive and outside `hull-chase`'s mask; a headless row holds every
  painted material equal across the presets. The key is the hull, that it is
  the authored model, and the shipped GLB's sha256 (`65879357cb7d…`). A
  headless row hashes `src/models/courier-hull.glb` against it, and the
  probe hashes the file the page's `model-urls.ts` serves and gates both
  band rows on the match.
- **Ceiling 255, no ceiling**, by the principal's ruling of 2026-10-09
  (relayed with the rulings above): the machined-alloy trim reads near white
  by design. Nothing in these rows now rejects a hull gone too bright.
- Floors under the module's rules: peak margin 0.32 → 0.45, the smallest the
  shipped 140 allows being 44.5%, deriving **138.716**; quartile 0.152
  (inside half of #294's 31.1% drop) deriving **8.616**; median 0.14 deriving
  **32.577**. Each is above half its reading and its margin exceeds the lane
  spread; `tests/light-rig.test.ts` asserts all of them.
- `probe-light-rig`: 12/12 on ANGLE Metal and on SwiftShader.
- `probe-postcard`, measured cause: on `main` at `bd09ae5` (the
  procedural courier) the cell row read 3.1%, and all 12 of its cells past
  ten codes were the hull's, moving 14–44 codes; the station's own shift
  moved its cells 7–8 codes on both builds and never cleared the threshold.
  On the O4 the same hull cells move 5–7 codes (sky 16.1), and only the two
  drive-glow cells clear it: 2 of 384. So the row measured whether a bright
  hull appeared, not the camera, which is #294's class. It now reads the
  share of pixels above the band moved past 24/255:

  | arm | pixels moved past 24/255 |
  | --- | --- |
  | clear composed again (same camera) | 0.000% |
  | exterior, hull's meshes hidden (camera alone) | 2.75–2.78% |
  | exterior, O4 | 2.91–2.95% |
  | exterior, procedural courier on `main` | 4.54% |

  The floor is 1%, between the null arm and the camera alone, and the same
  camera arm is its own row. Ranges are three runs over both lanes; the
  `main` arm is one GPU run. `changedCells` is unchanged, since the cockpit
  row and `probe-chase-orbit` share it. `probe-postcard`: 43/43 on both
  lanes.

Options, as they were put:

- **O1. Accept the in-game look.** The band is re-derived for this subject
  under #294's rule, which needs a ruling on the 215 ceiling. The postcard row
  is looked at first, to find out why it reads low, before anything about it
  changes.
- **O2. Light the hull for the game.** For example, a per-hull exposure trim
  or material response tuned under rig B, judged on the sheet.
- **O3. Reconsider rig B for authored hulls.** This is the larger question.

**Q2. A courier wreck is untorn.** `tearHull` cuts lofted parts, and the
authored model has none. A courier derelict, including the player's own death
wreck, is the whole hull gone dark, inside its envelope. That is held by
`tests/derelict-tear.test.ts`. Tearing the authored model is follow-up work.

**Q3. The name.** Traffic's registry and the workbench still call courier
variant `a` "Kestrel" (`Kestrel TR-01`). Keep it, or give the O4 its own
name?

**Q4. Download size.** 15.9 MB (15,940,136 bytes), lossless. Quantising the
vertex streams is lossy and saves less than first estimated here. Measured in
sage round 4: the prepare script with glTF Transform's `quantize()` added
before `reorder`, at 16-bit positions and the library's default 10-bit normals
and 12-bit texture coordinates, wrote 12,203,964 bytes, 23% smaller. It
skipped the texture coordinates of 32 primitives, whose values lie outside
[0, 1]. That encode was written to `/tmp` and not shipped; the earlier
"roughly halve it" was an estimate and is withdrawn. Quantising is not done
without your say.

**Q5. Not converted.** `src/courier-cockpit-viewer.ts` (the cockpit spike's
review page) still draws the procedural courier around the cabin, because it
does not load the hull.

**Q6. Three views no longer show the levers they claim.** Each one frames the
player's courier, which now carries none of the procedural hull's terms:

| view | levers it claims |
| --- | --- |
| `hull-chase` | 101, 102, 203 |
| `berth-free-look` | 102, 203 |
| `berth-launch-chase` | 101 |

The levers are #101's hull surface, #102's greebles and #203's hull finish.
`tests/view-set.test.ts` stays green, because every lever still has a view,
but those frames are no longer evidence for these levers. Move them to a
procedural hull, or add a view? The views were not changed here, because that
changes the sheet.

**Q7. The reduced levels are a lossy change to the approved hull.** Like Q4,
they are not the study's geometry. Each is made to a target error of half a
device pixel at its band edge (in the 1800-pixel frame above; a target, not a bound), but
its normals are recomputed and its texture coordinates welded, and the
switch is visible in pixels.
`scripts/measure-courier-level-pop.mjs` puts a courier on the chase camera's
axis at 1,469 m (1.02 × the band's first edge, inside its hysteresis, where a
courier coming in still draws `reduced`; the band draws it nearer still, down
to the edge itself), clock held, and draws it at
`full` and at `reduced`. Since sage round 9 the footprint is every pixel
**either** level moves past 24/255 against the empty frame, so a reduced
level drawn beyond the full silhouette is counted; round 2's table counted
the full hull's footprint only, which made its share a lower bound. The
control is the full hull drawn twice. GPU lane, M1 Pro, 1440×900 at device
scale 2, on `9f8d533`'s tree:

| heading | footprint px | control moved | reduced moved | reduced only | of them moved |
| --- | --- | --- | --- | --- | --- |
| 0° | 344 | 0 | 27 (7.8%) | 38 | 19 |
| 90° | 333 | 0 | 23 (6.9%) | 56 | 3 |
| 180° | 334 | 0 | 22 (6.6%) | 38 | 5 |
| 270° | 438 | 0 | 48 (11.0%) | 91 | 13 |

"Reduced only" is the pixels the reduced level moves past 24/255 against the
empty frame and the full level does not. On a dark hull against a dark sky
that mixes two things: silhouette the reduced level draws beyond the full
one, and pixels where the full hull sat within 24 codes of the sky and the
reduced level's recomputed normals pushed it past. So it is an upper bound
on overreach, not a measure of it, and "of them moved" — the ones the switch
itself moves past 24/255 — is the same kind of bound.

So a Traffic courier crossing 1.44 km changes up to about a ninth of its few
hundred pixels in one frame.

**Ruled 2026-10-09: accepted.** The principal flew the switch and approved
it, quoting a real maximum deviation of about 1.2 m (about 1.3 px at the
band edge). That figure is the principal's; no instrument on this branch
produced it, and nothing here measures how far a level lies from the model.

### Field Notes copy (approved by the principal 2026-10-09, in `src/changelog.ts`)

> The courier has a new hull: a long tapered body between twin drive nacelles,
> with seated hatches, slope-aligned grilles and a pilot visible under the
> canopy.
