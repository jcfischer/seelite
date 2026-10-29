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
| 5 | 5.2 | Warm authored paint instead of the blue trade tint; station light lift |
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
- `src/coriolis-flight.ts`: `CORIOLIS_PAINT_LIFT` and `CORIOLIS_ENV_LIFT`
  replace the role tint on the Coriolis plates.
- `tests/coriolis-flight.test.ts`: the two assertions on the role tint.

The collision proxy is unchanged; every addition stays within
`PROXY_VERTEX_TOLERANCE_KM` of it, and the Coriolis tests pass.
