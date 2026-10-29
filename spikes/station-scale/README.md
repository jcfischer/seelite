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
