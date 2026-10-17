# Authored hull installation: node #907

Checkpoint: `authored-hull-install-stall`.

## Current result

Courier and tug preparation yields between simplifier meshes, nav-light rays
and vent measurements. The four-millisecond scheduler is shared with interior
installation; it checks the budget **between** operations, so a single operation
can exceed it. Geometry calculations, simplification targets and shipped assets
are unchanged. Both drive-glow forms are warmed without changing the global
finish, and the builder is published only after warming succeeds. Until then,
flight keeps its existing builder or procedural stand-in. A failed preparation
leaves that builder installed; the loader clears its memo for a retry.

Offline LOD/fitting exports would remove more runtime work, but would introduce
new generated artifacts and a freshness contract. Merely yielding between the
three original phases leaves a half-second throat task. This change instead
slices within each phase, preserving the current source of the geometry and
fitting positions. It adds no asset bytes or requests. Total preparation wall
time increases, including work on the second glow form and time yielded to flight.

## Measurements

2026-10-17, Apple M1 Pro, headed Chromium, ANGLE Metal hardware lane,
1440×900 CSS pixels at device scale 2, seed 42, running clock, two live roots
refreshed per hull. Five installs per hull, medians; the unchanged baseline is
`d23accdeabd8568f5198a9b32d88a2fa6553b086`, served from an isolated archive of
that revision. Runs were sequential; this worker ran no tests or other browser
work alongside them. External host load was not sampled by this instrument.

| Milliseconds | Courier baseline | Courier sliced | Tug baseline | Tug sliced |
| --- | ---: | ---: | ---: | ---: |
| Parse/decode | 67.3 | 68.6 | 66.1 | 70.1 |
| Builder wall time | 471.0 | 545.6 | 615.5 | 685.0 |
| Private fitting warmup wall time | — | 1,049.3 | — | 1,269.6 |
| First published build | 97.5 | 0.3 | 131.2 | 0.2 |
| Published throat lookup | 409.6 | <0.1 | 506.2 | <0.1 |
| Refresh two live roots | 25.6 | 25.0 | 33.3 | 33.2 |
| **Longest install frame gap** | **983.4** | **133.4** | **1,283.0** | **133.3** |

Separately, 60 settled frames before each hull measurement read 16.7 ms median,
18.6 ms p95 and 18.6 ms maximum. These are cadence figures, not CPU/GPU execution
times, and do not replace the cold-install row. The first sliced run's longest
gap was 150.0 ms for courier and 133.4 ms for tug.

The instrument reparses already-fetched shipping bytes and creates a fresh
builder/caches every run. Download latency is excluded; this is cold geometry
installation on an already-running, settled Game, rather than a fresh-browser
boot measurement. Builder/warmup wall times include yielded frames. The existing
baseline instrument called build/throat measurement directly; the updated one
calls the same private-cache installer as the production loader before building
and refreshing roots. An intermediate run that sliced only the builder still
read 526.8/666.6 ms gaps, demonstrating why fitting warmup must also yield.

Reproduce on the hardware lane:

```sh
SEELITE_PROBE_RENDERER=hardware RUNS=5 MAX_GAP_MS=250 node scripts/measure-hull-install-stall.mjs
```

The optional 250 ms local regression threshold passed. It is not a promise of
four-millisecond slices or a new game-wide frame budget. Parse/decode, one mesh's
simplification, one raycast and live-root refresh remain indivisible; visible
short hitches remain. Offline baking or finer slicing could reduce these further.

## Verification and delivery

The new tests cover per-mesh yields, geometry equality, publication after warmup,
zero fitting raycasts after publication under every finish, equivalence to fresh
measurements on both shipped hulls, and preservation of the previous builder on
failure. Existing courier/tug, vents, muzzles, finish, resource teardown, model
queue and interior-scheduler tests cover the surrounding contracts.

The browser selector expands this diff to all probes because it changes shared
ship geometry and measurement infrastructure. Under the ranger worker contract,
only affected probes run here; the supervisor owns the broad final gate, PR,
review and merge. No visual redesign or asset modification is intended. This is
performance tuning, excluded from major changelog entries by `src/changelog.ts`.

Local checks:

- Affected headless run: 144 passed across 10 files. The final version of the
  new installation test file separately passed all five tests.
- TypeScript, format, lint, launcher wiring and production build passed,
  including the build's deployment-size guard.
- Hardware browser coverage: model-download, model-queue, model-viewer and
  vent-display, 4/4 passed, run serially. These manual filters are development
  evidence, not the repository-selected final PR gate. The two runs reported
  peak host loads of 21.1 and 21.2 on 10 cores; their elapsed times are not used
  as performance measurements.
- Full headless suite, run once immediately before the final commit:
  **6,424 passed, 0 failed**, 373 files, 9,635,648 assertions, 720.89 seconds.
