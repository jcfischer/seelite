# Node #1017 — planet relief across the approach handoff

The screen-space relief shader used a height field in unit-sphere coordinates
and position derivatives in scaled world units. Its terrain slope therefore
varied inversely with the drawn radius. Crossing from `FAR_SCALE` to
`APPROACH_SCALE` reduced that slope by 100×: the far surface exaggerated relief,
and the approach surface flattened it.

Divide the position derivatives by `vRadius`, keeping the world orientation
needed by the lighting normal while expressing both fields in sphere units.
The existing relief bands, bake scheduler and half-resolution policy are
unchanged. This is an internal repair under `src/changelog.ts`'s definition
of major, so it adds no public changelog entry.

## Reproduction and regression

The reported subject reproduces on this host: seed 47, system 185 (ABITI),
`planet-2`, radius 5,486.6165 km, chase view at 1080×1920. Centre distances
20,188 and 16,996 km draw in the far layer; 14,126, 11,569 and 7,663 km draw in
the approach layer. Every sample uses screen-space relief. Disabling the
half-resolution pass still reproduces the detail loss.

`scripts/probe-approach-handoff.mjs` now boots that fixture and compares its
production desert shader at identical framing, geometry and lighting under
both layer scales. It repeats with a 20,000 km radius to reject a correction
calibrated to one body. It reads a 100×100 interior patch of a 320×320 render
target, avoiding silhouette coverage. Figures are mean absolute RGB display-code
differences, measured on Apple M1 Pro / ANGLE Metal:

| Radius (km) | Before: far vs approach | After: far vs approach | Before: approach vs relief off | After: approach vs relief off |
| --- | ---: | ---: | ---: | ---: |
| 5,486.6165 | 9.89043 | 0.00010 | 0.18480 | 1.01700 |
| 20,000 | 4.56790 | 0.00010 | 0.04917 | 1.01700 |

The same-build repeat difference is zero. The comparison allows less than 0.1
code of mean layer difference and requires more than 0.5 code from the
relief-off control, so a surface without relief cannot satisfy it. The probe
ran **10/14 before**, failing both scale/detail rows for each radius, then
**14/14 after**.

## Worker verification and delivery boundary

- Targeted headless checks: 90 passed across relief bands, planet surfaces,
  bake, half resolution, footprint and probe selection.
- Final `npm test`, run once on this host: **6,419 passed, 0 failed** across
  372 files (exit 0).
- GPU browser checks: approach handoff **14/14**, footprint **44/44**, live
  planet surfaces **114/114**, planet gallery **69/69**. These are affected
  contracts, not a full browser-suite or PR-gate pass.
- Typecheck, formatting, script lint and production build passed.
- A focused before/after approach sheet is available locally at
  `view-set/node-1017/index.html` (gitignored). It is a diagnostic capture,
  not the canonical view set or principal approval.

The selector was inspected before probing. The edited catalog causes its
infrastructure fallback to select all 108 probes. The worker contract permits
only affected probes; the supervisor owns delivery selection, review, canonical
visual acceptance, push and PR. The principal owns the merge and visual yes.
