# Courier derived normal: node #1232

## Current result

The courier exterior uses the half-size normal at scale `(0.15, -0.15)` selected
on node #1219 on 2026-11-09. Its existing scalar roughness remains in force;
exterior bump and roughness maps are cleared. Cockpit materials and other authored
hull builders are unchanged. The normal applies on both quality settings.

Implementation is `75079117`, merged with base `b496c9ab` at `5ed3f803` before
verification. The final delivery commit adds this receipt only. No GLB, geometry,
envelope, vent placement, LOD policy, collision data or boot-set owner changed.
This is a minor finish adjustment to an existing hull, with no major changelog
entry under `src/changelog.ts`'s definition.

Production appearance approval is **pending**. The principal's prototype approval
is not a fresh production yes. The full canonical capture is also **incomplete**:
its baseline hit the unrelated shipyard page error described below. The six-view
comparison supplements that failure record; it does not waive the full-set gate.
The supervisor owns the full browser gate, Sage review, push and PR.

## Asset and derivation

Reproduce with:

```sh
bun scripts/derive-material-maps.ts --out /tmp/seelite-courier-height
```

The source is the shipping courier GLB's image 0. All textured exterior materials
were inspected and use it; cockpit materials use image 1. The CLI checks that
assumption before deriving. The pure RGB function in `scripts/lib/` owns the
linear-luma, wrapped three-pass blurs, RMS normalization and central differences.
Float32 working buffers and differences `next - previous` reproduce the
prototype's recorded 210,796-byte size. Sharp's default resize and WebP quality 88
produce 627×627 texels from the 1254×1254 source.

| Asset | SHA-256 |
| --- | --- |
| Unchanged `courier-hull.glb` | `6967208f3169dcb900f24e6164ac09023db5d6b6ee5495a92b157ce20c310c30` |
| `courier-steel-wear-normal.webp` | `fb9a8c979e8cdf3d99287c89a902fc165941d364615c87ae75659f3a71ca9f3e` |

The full-size height is a PNG in the supplied output directory, which must be
outside `src/`. No height is committed or emitted by Vite. There is no derived
roughness output. `spikes/courier-hull/assets.md` holds the source provenance and
complete recipe. The normal tile was opened and inspected.

The browser fetch is inside the callback supplied to `authoredHullLoader`, after
the GLB loads. A rejected texture request rejects preparation and clears the same
memo as a failed GLB. `createCourierHullBuilder(template, normalMap?)` itself
fetches nothing. Its texture is shared by the exterior materials and reduced
levels, with `flipY=false`, repeat wrapping, `NoColorSpace` and anisotropy 8.

## Headless and build checks

Tests were written first. The initial pure test could not import the missing
deriver. The material test subsequently observed a null normal, and the failed
fetch test observed a resolved promise, before wiring the implementation.

Final affected run: **38 passed, zero failed**, 4,000 assertions across
`derive-material-maps.test.ts` and `courier-hull.test.ts` in 14.76 seconds.
Coverage includes an independent direct blur reference, flat normals, a repeated
3×3 tile, invalid buffers, CLI reproduction and dimensions, all exterior levels,
cockpit preservation, bump/roughness removal, sampler settings, unchanged bounds,
the headless builder and the Bollard control. Loader spies verify rejection,
retry, publication and successful-load memoization.

Full host `npm test` ran once immediately before the final delivery commit:
**8,148 passed, zero failed**, 17,239,568 assertions across 498 files in 924.52
seconds. The raw log is `/tmp/seelite-1232-full-test.log`.

Build/typecheck, deployment size guard, format, script lint, comment lint and
launcher wiring passed. The build emits
`courier-steel-wear-normal-C5_8ctDp.webp` at 210,796 bytes and no height asset;
every emitted file stays within the existing 25 MiB guard. The normal's calculated
RGBA8 allocation including all mip levels is 2,094,008 bytes (about 2 MiB), not a
GPU-memory measurement.

## Browser checks

Renderer throughout: **ANGLE Metal, Apple M5 Pro**, hardware lane. The critical
`npm run probe:one probe-station-mouth` passed, including the alloy check.
`probe-production-boot`, `probe-shared-image` and `probe-model-download` passed.
`probe-chase-view` timed out on a later page's first-frame wait in the four-probe
run and its first solo run. A baseline solo run passed in 146 seconds and a repeat
head solo passed in 145 seconds. No thresholds or probe code changed; the earlier
timeouts remain unattributed intermittent failures.

`probe:select -- --base origin/main --head HEAD` falls back to all 126 probes
because the derivation scripts have no dependency owner. The worker SOP reserves
the full suite for the supervisor, so no passing `probe:pr` gate is claimed.
The deliberate partial run named the four probes above. An initial incorrectly
configured filter launched an unfiltered runner; it was stopped promptly and is
not counted as full-suite evidence.

A real browser request was also aborted for the normal URL. Preparation rejected
without publishing a courier. The next preparation fetched it again and succeeded:
exactly two requests, one shared normal, 47 exterior material occurrences checked,
and four cockpit occurrences retaining their old maps. The decoded map was
627×627 and every required material and sampler property was inspected.

## Runtime measurements

The steady fixture is seed 47, beside planet-5 at six radii and sun angle 150°,
1440×900 at device scale 1, High, render scale 1, composer samples 0, held clock,
chase yaw -0.8, elevation 0.3 and zoom 1. Four additional couriers were placed in
the camera frame; the five visible hulls were confirmed by opening the image.
The normal-on frame submitted 221 calls and 1,808,070 triangles.

Twelve blocks of 120 renders per arm, shuffled with seed 1232, were drained with
`readPixels`. Vsync and the frame-rate limit were disabled for this throughput
measurement. Medians: baseline **0.62167 ms**, normal **0.66000 ms**, repeated
normal control **0.65708 ms**. The normal difference is **+0.03833 ms/frame**;
the control difference is **-0.00292 ms**, with 134/144 pairwise normal/baseline
comparisons slower. These are saturated rendering throughput figures, not
delivered frame cadence. The baseline is the shipping anisotropy-only finish;
the prototype's quoted +0.008 ms used a bump baseline, so it is a different
comparison. No new performance budget is inferred from it.

Cold-install runs used five fresh browser contexts per arm, a visible chase
courier and production after-boot installation. The interval starts at the GLB
response end and includes preparation, publication and the first frames drawing
the installed hull. Resource timing and rAF gaps were recorded from before
installation; no navigation reused a measured page. The first run of each browser
also pays shader warm-up.

| Arm | Worst install interval per run (ms) | Median (ms) | Median install window (ms) |
| --- | --- | --- | --- |
| Base | 83.4, 84.3, 83.2, 99.1, 116.7 | 84.3 | 1612.8 |
| Normal | 100.0, 83.4, 100.0, 99.0, 100.1 | 100.0 | 1691.4 |

Each head run downloaded the 210,796-byte normal. These were sequential baseline
and head blocks with the baseline capture between them, not shuffled pairs;
their overlapping ranges do not establish a causal added stall cost.

## Appearance evidence and remaining gate

The attempted full 122-view baseline encountered repeated page errors
`auto-sale of Food refused: cargo-missing` at the shipyard/outfitting fixtures.
`src/station-commerce.ts:1134` throws this error; that module is unchanged from
base. The capture tool records any page error as fatal and refuses a sheet.
The attempt was stopped after the error was recorded, and the temporary baseline
source substitution was restored. It is an interrupted, failed baseline attempt,
not a passing full view set. No commerce code or capture assertion was changed.

Fresh scoped captures completed six canonical views: `hull-chase`,
`hull-chase-bollard`, `vent-plumes-chase`, `opening-flypast`, `opening-dock`, and
`berth-launch-chase`. There are four complete runs (before, after, control and
control2), High at the canonical 1440×900 and declared seed/camera recipes.
Baseline production modules are exact `b496c9ab` versions; the manifest honestly
says `5ed3f803-dirty` during substitution. All other production files already
matched that base. After and both controls are clean `5ed3f803`; every manifest
records the guarded serving tree and hardware renderer.

`views:diff` at its summed RGB threshold 24 reports 0.00% movement for the static
hull, Bollard, vent and flypast rows, and 0.03% for opening-dock, whose three
same-build pairings also read 0.03%. Berth-launch reads 19.39% before/after against
7.32–17.23% controls; its moving traversal is not repeatable, so that figure is
not attributed to the normal. The static courier row has 1.02% pixels with any
change against 0.27–0.33% controls, but does not clear the visible threshold.

A closer native 800×600 surface crop uses the same seed, lighting, viewport and
quality, a held clock and a fixed camera aimed at the hull (zoom 0.25). Its pose
is saved. The normal is toggled on the same build: **1.2508%** of crop pixels
move beyond summed RGB 24, with maximum channel movement 85; the normal-on
control is byte-for-byte identical. Before and after crops and the canonical
courier frame were opened and inspected. This supplies resolved detail for the
principal's judgement; it is not the principal's yes.

Evidence is host-local outside git, under `/tmp/seelite-1232/`:

- `index.html`: entry page with native close crops and the scoped canonical sheet.
- `courier-views/index.html`, its four manifests, and `view-diffs.log`.
- `panel-*.png`, `panel-full-*.png`, and `close-pose.json`.
- `runtime.json`, `cold-before.json`, `cold-after.json`, and the five-courier
  `close-*.png` overview.
- `capture-before.log`: the full baseline failure; `courier-*.log`: completed
  scoped runs.

Local reproducible instruments are `/tmp/seelite-1232-runtime.mjs`,
`/tmp/seelite-1232-cold.mjs`, `/tmp/seelite-1232-courier-capture.mjs`, and
`/tmp/seelite-1232-close.mjs`; run from this worktree with
`SEELITE_PROBE_RENDERER=hardware node <instrument>`. Captures and measurements must
remain serial. Gate logs are `/tmp/seelite-1232-*.log`. These paths are supporting
files on this host, not PR attachments.
