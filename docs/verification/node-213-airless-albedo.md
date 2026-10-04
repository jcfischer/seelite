# Node #213: airless populations and albedo

Implementation evidence, not a graph-close receipt. Parent: `8017a887`.

`src/airless-features.ts` walks a jittered low-frequency cell shell once per
body, selects 2–4 separated basins, and uploads centre/radius descriptors.
Their chord radii are 0.50–0.64; small impacts retain the existing 8x field's
0.020–0.0625 radii. Basin interiors suppress crater slope, carry dark basalt,
and have a narrow albedo rim. Maria variation is three low-frequency noise
octaves multiplied by the basin-floor mask.

The youngest 2–3 surviving small impacts are selected by a seeded age rank
among surface-intersecting fine-field cells outside the flooded floors.
The shader reconstructs their anchors with the crater field's own hash;
CPU float rounding therefore cannot separate a ray from its source crater.
Two angular harmonics make irregular radial streaks, fading between two and
nine crater radii. Rays change albedo only.

`height` retains two crater octaves, and `craterRelief` is byte-identical to
the parent shader retained in `tests/fixtures/airless-before-213.ts`. Removing
the old height-based brightening also removes its redundant height sample.
Both new populations enter the existing albedo/normal bake. The baked draw
shader is unchanged and evaluates none of these new terms. Filling views
still use the procedural fallback; the feature is present on High and Low.

## Rendered comparisons

`probe-planet-surfaces` renders production bake programs into float targets.
For each seed it compares the same 143,616 face-on samples with the frozen
parent shader: identical seed, warmth, directions, and resolution; no tone
mapping or lighting can impersonate albedo contrast. Each of the six faces
contributes samples whose face-on cosine exceeds 0.65.

| Seed | Basins | After/before albedo variance |
| --- | --- | --- |
| 0 | 2 | 1.76 |
| 1 | 3 | 1.93 |
| 47 | 4 | 2.55 |
| 48 | 4 | 2.73 |
| 179 | 4 | 2.84 |

The 1.5–3.5 band brackets this measured count-bucket corpus while rejecting
the unchanged shader's ratio of 1. The initial implementation measured
0.24–0.38 and failed; enlarging the sparse basins and separating highland
reflectance from basalt supplied the required contrast.

The probe also measures a basin floor against the same patch with basins
disabled: albedo is below 65% of its control and normal tilt below 2% of its
nonzero control. This distinguishes floors from the retained crater terrain.
Seed 0's control tilt is only 0.003, so a universal 0.01 roughness floor was
rejected as a location test. Ray-on/off readings require actual bright pixels
and unchanged normals. Seeds 47 and 48 have distinct centre directions and
both have painted dark, flat floors at their expected direction.

## Verification

- `rtk test npm test`: **4,897 pass, 0 fail**. RTK prints a misleading FAIL
  heading because a passing reporter test contains that word; exit code is 0
  and the underlying Bun summary has zero failures.
- `npx tsc --noEmit`, `rtk lint npm run format:check`,
  `rtk lint npm run lint`, `rtk err npm run build`, and
  `npm run check:wiring`: pass. Vite retains its existing chunk-size warning.
- Selected hardware runs: `npm run probe:one -- planet-surfaces` and
  `npm run probe:one -- planets`: pass on **ANGLE Metal / Apple M1 Pro**.
  The surface run includes all five seeds. These are partial runs.
- Generator tests span 83 seeds, including large uint32 seeds, and check
  all population counts, basin separation, crater intersection, rays outside
  flooded floors, and the generated moon's actual shared uniforms.

The selector returned `all` for shared `scripts/lib` infrastructure. The
worker's explicit instruction forbids the full suite; the supervisor owns
`npm run probe` on the final reviewed head.

## Visual and delivery gates still owned by the supervisor

The named `planet-fill` and `planet-terminator` rows are desert and terran,
so assigning node #213 to their `covers` would be false. No prior row shows
an airless surface. `airless-fill` now frames seed 47's generated
`planet-5-moon-0` at two radii, with lever #213 and a caption naming its evidence.
The view count and contact-sheet clock-span pins were updated.

`scripts/measure-airless-albedo.mjs` captures headed High/Low shader-control
PNGs and writes `view-set/airless-cost.json` at 1440×900, pixel ratio 1,
resolution 100%, AA off, and forced procedural four-tap. It alternates arm
order over three blocks, taking three `?fps` readings per block, with
`--disable-gpu-vsync --disable-frame-rate-limit` and a refresh-clamp refusal.
It is a same-scene **parent-shader/current-shader** diagnostic, not canonical
captures of two complete builds. The screenshots were opened for inspection.

Final headed run on ANGLE Metal / Apple M1 Pro, nine readings per arm:

| Quality | Parent shader median (range), ms | Current shader median (range), ms |
| --- | --- | --- |
| High | 9.00 (8.63–9.20) | 9.07 (8.66–9.19) |
| Low | 8.87 (8.42–9.12) | 8.78 (8.40–9.18) |

The 200-radii control spans 8.23–9.12 ms. No cost change is attributable from
these overlapping readings. An earlier run spanned 8.43–24.21 ms across its
arms under load; that dispersion is why no performance gain is claimed.
The structural zero for the baked path is the unchanged draw program, not a
timing subtraction. JSON retains every reading and the renderer identity.

The supervisor still owes the canonical before/after contact sheet from two
builds, its headed cost comparison, the principal's yes, Sage review, the
principal's merge, and checkpoint `cp-seelite-airless-albedo`. No graph node
was changed. The changelog sentence for node #213 is proposed copy awaiting
the principal's approval before merge.
