# Node #1057 — Assembly authored blocks, Phase 1

## Current result

**Ready for `ranger:needs-eye`; Phase 2 has not started.**
The supervisor can attach [the comparison sheet](../../spikes/stations/assembly-kit/evidence/index.html)
and its linked images to node #1057. The worker has not posted to GitHub,
changed graph state, or claimed the close checkpoint.

HUB, NODE and TUBE are authored in TypeScript and exported as one study GLB.
TUBE draws both X and Y through a 90° rotation. The hub includes a separate
static bearing member. Trusses, radiators, tanks, dishes, aperture, interior,
lights and macro fixtures come from the actual procedural Assembly builder.
No production file or production model registration changes in this phase.

## Problem and goal

Test the principal's 2026-10-20 ruling: authored blocks placed by the existing
WFC plan, rather than shipping the fixed `spikes/stations/assembly.glb` study.
The immediate goal is reviewable joints across four seeds, before authoring
the full kit or changing production loading and collision.

## Scope and anti-criteria

Only `spikes/stations/assembly-kit/`, its README pointer, its headless test and
this receipt change.
The solver, vocabulary, seed derivation, cell pitch, station geometry,
aperture and berth catalogue stay unchanged. No shipped asset, pool, other
station form, save or startup path changes. This internal spike does not meet
`src/changelog.ts`'s definition of a major player-visible change.

## Design provenance

Read `docs/model-integration-sop.md` before implementation. The visual reference
is `spikes/stations/target-assembly.png` and the construction language in
`final_shapes.py` (current source commit `5c27366`). The original study approval
is recorded in `spikes/stations/README.md`; it does not approve these new blocks.
This kit uses ivory pressure shells, dark collars, exposed service pipes,
panel seams, orange hardware and restrained warm lamps. It has no study texture
dependency and is cleaner than the weathered target; that difference needs the
principal's judgment too.

## Geometry contract

GLB coordinates are kilometres, +Z is the docking axis, and cell centres are
`(dx * 0.2, dy * 0.2, 0)`. Authoring helpers use metres and convert once on export.
Tube and junction socket ends are exactly ±100 m. Closed unused NODE sockets
are part of the sample, so the principal can judge that treatment.

The hub preserves the existing procedural shell controls and the 120 × 70 m
cut at z = 0.428 km. Its existing 204 m body radius exceeds a cell half-width:
the cell is its placement pitch, not a new hub envelope. The existing bay
requires this hub size. No hub resizing, solver change or new docking policy
was used to accommodate the blocks. Static collars sit around the neighbouring
fixed members; only the hub shell and existing hub fittings turn.

## Reproduction

```sh
bun spikes/stations/assembly-kit/prepare.ts
bun test tests/assembly-kit-spike.test.ts
npx tsc --noEmit --project spikes/stations/assembly-kit/tsconfig.json
SEELITE_PROBE_RENDERER=hardware node spikes/stations/assembly-kit/capture.mjs
```

The capture owns a foreground Vite server on an allocated port, verifies the
serving tree, holds the machine probe lock, refuses a software renderer and
closes browser/server on exit. For interactive inspection, serve this tree and
open `/spikes/stations/assembly-kit/`.

## Asset preflight

`blocks.glb`: **1,451,156 bytes**, SHA-256
`b079b3b41711206bb3cc2ccb980ed891df135c9292abf397a433a06b50e9b320`.
No compression or quantization is applied; float32 source geometry is encoded
losslessly and decoded through Three's GLTFLoader in tests. Source/decoded
bounds agree within 0.1 mm. Export size and hash are pinned against `asset.json`.
All study GLB/PNG files use the existing Git LFS attributes; no exemption added.
The supervisor must upload the LFS objects before pushing the branch.

## Geometry verification

Six spike tests / 119 assertions pass: GLB/hash/bounds, NODE–TUBE surface hits
on both axes at 98/100/102 m, seeded placement equality, separate spinner/static
bearing, 20 authored instance batches regardless of module count, ≤1.0 km
vertex reach including instance transforms, and the existing corridor row.
Aperture rays and the corridor are checked at 0°, 45° and 90° in the rotating
slot frame. These are sample checks, not a fitted collision-proxy claim.

## Render evidence

[40 hardware frames](../../spikes/stations/assembly-kit/evidence/index.html):
seeds 0, 1, 47, 1234; overview, hub bearing, quarter-turn hub, NODE joint and
rear; procedural/authored pairs at identical camera, lighting and phase.
The full-resolution inspected samples show the tube/junction rings meeting;
the principal still decides whether the shape and joints are acceptable.

[metrics.json](../../spikes/stations/assembly-kit/evidence/metrics.json) records
the base revision `2dd890e`, each source checksum, asset checksum, placements,
framing, phases and actual renderer counters. Lane: headed ANGLE Metal,
Apple M1 Pro, 1440 × 900, device pixel ratio 1. The studio lighting is the
original station study rig, without bloom, shadows or the game backdrop.
These are spike comparisons, not canonical in-game approval frames.

## Measured draw submission

Whole scene, fixed overview, `renderer.info.render` (no frame-time claim):

| Seed | Procedural calls | Spike calls | Procedural triangles | Spike triangles |
|---|---:|---:|---:|---:|
| 0 | 258 | 244 | 77,496 | 114,188 |
| 1 | 243 | 242 | 61,672 | 82,892 |
| 47 | 260 | 245 | 99,864 | 136,412 |
| 1234 | 257 | 243 | 78,744 | 125,132 |

Authored geometry is instanced per family/material: six batches each for
HUB, NODE and TUBE (X/Y share), plus two for the static hub bearings. The rest
of each station remains procedural. Fewer whole-scene calls and more submitted
triangles do not establish a speedup. Full-kit LOD and game-frame measurements
remain Phase 2 work under SOP §4.

## Delivery verification

- Spike tests: 6 pass, 0 fail, 119 assertions.
- Repository typecheck and standalone spike typecheck pass.
- `npm run build` passes, including its dist size guard (25.0 MiB per file).
  Vite retains its existing large-chunk warning. No spike model ships in dist.
- Single pre-commit host `npm test`: **6,766 pass, 0 fail**, 397 files,
  10,615,735 assertions, 1,157.83 seconds. RTK's failure-heading matcher
  echoed a passing test whose name contains `FAIL`; Bun reports zero failures
  and the command exits 0.
- Selector diagnostic on the spike source/capture selects all 112 probes:
  ambiguous production changes without reviewer-authored intent fail closed.
  The worker contract reserves the full browser suite for the supervisor;
  no `probe:pr` pass is claimed. The hardware spike capture itself passed
  with zero page errors. Re-run git-based selection on the committed head.

## Principal gate and remaining integration

Stop here for the principal's yes on the look and joints. Do not treat this
receipt as approval to enter Phase 2 or as fulfillment of
`cp-trade-d-authored-kit`. The supervisor owns attaching the renders and the
`ranger:needs-eye` state; the worker must not edit the node.

After that yes: author the remaining kinds, settle unused sockets and hub
bearings against feedback, prepare shipping assets, implement background
installation/fallback and shared ownership, fit per-kind proxies to the same
plan, measure production LOD/cost, capture canonical before/after views across
seeds, run the selected PR browser gate and Sage, and obtain principal flight
approval before merge. No production loading, failure, collision or timing
acceptance is claimed by this spike.
