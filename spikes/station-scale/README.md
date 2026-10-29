# Station scale: detail at several sizes (F7)

Spike, 2026-10-29. Question: does the trade-A Coriolis read as a 1.2 km
structure next to a 55–85 m ship once it carries detail at several sizes?

## Method

Dream Loop Pro. `capture.mjs` boots seed 42, system 4, holds the clock and
shadows the opening film camera (`openingCamera`) to frame the ship beside the
station from outside. The target (`evidence/target.png`) was generated with
Nano Banana Pro from the round-0 frame `evidence/r0-face-close.png`. A fresh
judge agent scored each round against it.

```bash
SYSTEM=4 TYPES=trade SCALES=1 CLEAN=1 ONLY=03-face-close,04-wide \
  SEELITE_PROBE_RENDERER=hardware node spikes/station-scale/capture.mjs <out-dir>
```

## Result

| Round | Score /10 | Change |
|---|---|---|
| 1 | 4.5 | Lit window rows, greebles, spine trusses |
| 3 | 4.65 | Lighter truss paint, beacons |
| 5 | 5.2 | Warm authored paint instead of the blue trade tint |
| 6 | 5.5 | Lit girders in the trenches |
| 7 | 5.75 | Lattice in the face plane; masts on the edge girders |

The loop stalled at round 7 and stopped there. The remaining gap is mostly
the surface texture (the principal's earlier choice), the target's tighter crop
and bloom on small beacons.

- D1: Detail smaller than the ship gives scale: rows of lit windows, lattice
  trenches, masts on the silhouette.
- D2: Paint matters as much as detail. The blue trade tint read as a dark toy;
  the warm, lifted paint was the largest single gain.

Compare `evidence/r0-*.png` with `evidence/r7-*.png`.

## Cost

| | main | round 7 |
|---|---|---|
| Triangles | 139,948 | 478,286 |
| Vertices | 269,016 | 928,790 |
| Draw calls | 14 | 16 |
| `src/models/coriolis.glb` | 6.4 MB | 16.4 MB |

Frame time, interleaved arms, M1 Pro: about 16.0 ms (main) and 16.5 ms
(round 7) for render plus a 1 px readback. A ranger probe suite ran on the same
GPU and the figures sit near the vsync floor, so they are not evidence of
headroom.

## Changes

- `spikes/coriolis/build_model.py`: `panel_detail`, `spine_truss`, `mast`,
  `dish`, girder masts, slot beacons, warmer structural steel and recess.
- `src/coriolis-flight.ts`: `CORIOLIS_PAINT_LIFT` replaces the role tint on
  the Coriolis plates. `CORIOLIS_ENV_LIFT` was inert in rounds 5–7: it tested
  `emissiveIntensity === 0`, and three gives every standard material 1. The
  round-5 gain came from the paint lift alone. The lighting pass fixed the test.
- `tests/coriolis-flight.test.ts`: the two assertions on the role tint.

The collision proxy is unchanged; every addition stays within
`PROXY_VERTEX_TOLERANCE_KM` of it, and the Coriolis tests pass.

## Lighting pass

The game's rig is a broad hemisphere (3.425) over a weak sun (1.0), so shadows
have almost nothing to remove (`light-rig.ts`). Tested on the round-7 model:

- F20: Sun ×2–3 with hemisphere ×0.4–0.6 makes masts and trusses cast long
  shadows across the plates. It is the strongest scale cue found. Implemented
  for the Coriolis only, as a splice of its materials' lights chunk:
  `CORIOLIS_KEY_GAIN` 2, `CORIOLIS_AMBIENT_GAIN` 0.6. Ships and cockpit keep
  rig B.
- F21: The builder normalised every emissive to the bloom threshold, so no
  beacon could bloom. `CORIOLIS_BEACON_GAIN` 8 gives the navigation beacons
  halos.
- F22: A stronger key darkens the side away from the star, and in the wide
  frame it merges with the sky. A grazing rim term (`CORIOLIS_RIM`) lifts that
  face's mean luminance only from 0.093 to 0.114 at gain 1.5, measured in one
  boot. A rim cannot light a face that looks at the camera. It is left at 0;
  the open lever is the shade-side ambient or the backdrop.

`evidence/lighting-before-after.png`: left today, right this branch (close and wide).
`evidence/rim-sweep.png`: rim 0, 0.6, 1.5 in one boot.

`tests/coriolis-flight.test.ts` asserts the splice lands in the compiled
shader and that beacons exceed the bloom threshold.

## Ring (trade form b)

The same levers on the Ring, seed 42, system 1. No generated target and no
judge this time: the evidence is the before/after sheet alone.

```bash
SYSTEM=1 FORM=b TYPES=trade SCALES=1 CLEAN=1 \
  ONLY=03-face-close,04-wide,06-hero,07-sun-wide,08-sun-close \
  SEELITE_PROBE_RENDERER=hardware node spikes/station-scale/capture.mjs <out-dir>
```

`07-sun-wide` and `08-sun-close` frame the station from the star's side; the
approach face of the Ring often looks away from the star, so the key light
alone darkens it (F22 again).

- `spikes/stations/build_model.py`: after the approved Ring, nine rows of lit
  1.7 × 1.15 m windows round the torus, three lattice girders, 16 rim masts
  (23–30 m, inside the form's 0.75 km reach), 24 short front masts and eight
  7 m red and green beacons. Its own seeded generator, so the approved parts
  keep their random draws.
- `src/trade-flight.ts`: the Coriolis key light and the beacon gain on the
  Ring, Drum and Wheel materials.
- `src/trade-proxies.ts`: regenerated from the new model.

| | main | this branch |
|---|---|---|
| Triangles | 102,164 | 485,440 |
| Draw calls | 12 | 16 |
| `src/models/trade-ring.glb` | 5.6 MB | 19.0 MB |
| Ring proxy hull boxes | — | 8,985 |

`evidence/ring-before-after.png`: left main (row 4: key light only), right
this branch; rows face-close, hero, wide, sun-side close.

## Drum (trade form c)

The same levers on the Drum, seed 42, system 0. The evidence is the
before/after sheet alone.

```bash
SYSTEM=0 FORM=c TYPES=trade SCALES=1 CLEAN=1 \
  ONLY=03-face-close,04-wide,06-hero,07-sun-wide,08-sun-close \
  SEELITE_PROBE_RENDERER=hardware node spikes/station-scale/capture.mjs <out-dir>
```

- `spikes/stations/build_model.py`: after the approved Drum, 17 rows of lit
  1.7 × 1.15 m windows round the barrel, clear of the trunks, pods and pipes;
  eight lattice girders down the clear facet edges, broken at the middle end
  ring; 16 radial masts (23–30 m) on the front shoulder, 24 short masts on the
  front face outside the approach lane, 12 aft antennae inside the rear rim and
  eight 7 m red and green beacons. Its own seeded generator, so the approved
  parts keep their random draws.
- The entry face, after the Coriolis face: eight lit lattice trusses between
  the approved spines and vents, 70 panels of window strips, greebles and
  grilles on the plating, six masts with arms, two dishes, red and green
  beacons on posts at the slot's corners, and a lit gallery round the raised
  rim. The four approved window bands at r 18 hung 20 m in front of the face
  (z 47 against a face at 45.18); they now sit on it.
- The key light and beacon gain came with the Ring commit (`src/trade-flight.ts`).
- `src/trade-proxies.ts`: regenerated from the new model.

The rear rim sets the form's reach: 0.687 of the 0.70 km silhouette, unchanged.

| | before | this branch |
|---|---|---|
| Triangles | 82,088 | 268,068 |
| `src/models/trade-drum.glb` | 4.9 MB | 10.8 MB |
| Drum proxy hull boxes | — | 4,218 |

`evidence/drum-before-after.png`: left before, right this branch; rows
face-close, hero, wide, sun-side close, sun-side wide, taken before the
entry-face pass. The captures ran while
another worktree's probe suite held the GPU lock; they are images, not timings.
