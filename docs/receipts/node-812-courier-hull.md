# Node #812: the approved O4 courier hull in the game

Author: Claude / ivy-agent (ranger implement lane). Measured 2026-10-09 on an
Apple M1 Pro, ANGLE Metal unless a row says otherwise.

The principal approved the O4 study on #795 (visual commit `720c928`). This
receipt records how it was integrated, what was measured, and what is left for
the principal. **The principal's flight and yes are still outstanding**, and two
browser rows are red pending that decision (Q1).

## What ships

- `public/models/courier-hull.glb`: the study export re-encoded by
  `spikes/courier-hull/prepare-game-asset.mjs` with dedup, reorder, Meshopt
  and lossless WebP. There is no simplification and no quantisation. The
  script asserts exact vertex attributes and texture pixels after decoding.
  `tests/courier-hull.test.ts` holds every mesh's triangles equal to the
  study's. **15,940,136 bytes** (the study is 30,766,660), with 353,954
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
- Traffic flies the selected variant, so every Traffic courier is the O4.

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

Berth fit is unchanged. These are the berths that admit the courier on seed 1,
before and after: trade 8/8 and 8/8, shipyard 6/6 and 6/6, refinery 4/4 and
4/4, outpost 2/2 and 2/2. `tests/aperture-fit.test.ts` and
`tests/hull-docking.test.ts` pass, and the courier still docks to 13.0 rpm,
first failing at 13.5.

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

No LOD was built. A far LOD for Traffic is the lever if a busier station
shows more than these figures.

Headless timings (bun) on the model:

| step | time | when |
| --- | --- | --- |
| first build (nav-light raycast) | 293 ms | once, inside the loader |
| later builds | 0.5 ms | |
| `ventThroats` | 530 ms | the player's hull only, at boot and on a shipyard hull change |
| muzzles | 35 ms | |

## Verification

- `npm test`: see the final commit.
- Bun preload: `tests/setup-courier-hull.ts` installs the shipped model for
  every file, so headless rows measure the courier the player flies.
- Procedural generator rows: the four files that hold the procedural hull
  language (`ship-mesh`, `ship-finish`, `surface`, `ship-details`) run on the
  procedural Kestrel through `useProceduralCourier()`. Their courier rows
  describe the generator, not this hull.
- Browser probes run on the GPU lane, singly (`probe:one`): ship-visuals,
  boot, vent-display, derelict, cabin-pass, live-cockpit, chase-orbit,
  occlusion, shipyard, dock-arrival, station-route-traffic,
  traffic-engagement, docking, collision, docking-traffic and traffic-mouth
  all pass. **probe-light-rig** and **probe-postcard** are red (Q1). The full
  suite was not run here; the supervisor runs it.
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

- Hiding `machined-alloy` alone drops the peak to 223.9, so the peak is real
  hull metal, not the canopy, the pilot or the interior.
- No single albedo scale meets both ends: the band allows a peak-to-median
  ratio of about 3.2, and the O4 reads 6.6.
- `probe-postcard`'s "the exterior composition is a different camera" row reads
  0.5% of cells changed against a 2% floor. The row is really measuring how
  far the hull stands out from the sky.
- Neither threshold was moved.

Options:

- **O1. Accept the in-game look.** The band is re-derived for this subject
  under #294's rule, which needs a ruling on the 215 ceiling, and the postcard
  row is rewritten to test the camera rather than the hull's brightness.
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

**Q4. Download size.** 15.9 MB, lossless. Quantising the vertex streams
(lossy, millimetre-scale at 16 bits) would roughly halve it. That is not done
without your say.

**Q5. Not converted.** `src/courier-cockpit-viewer.ts` (the cockpit spike's
review page) still draws the procedural courier around the cabin, because it
does not load the hull.

### Proposed Field Notes copy (not in `src/changelog.ts` until approved)

> The courier has a new hull: a long tapered body between twin drive nacelles,
> with seated hatches, slope-aligned grilles and a pilot visible under the
> canopy.
