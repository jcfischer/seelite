> Visual work was reopened. See STATUS.md for current evidence and scores. Both capitals now have approved 180 m floor-diameter habitats at 2.5 RPM (0.629 g); latest models are not a visual quality pass. Historical measurements below are superseded by the live per-role model-report.json files and review/*-metrics.json.

# Seven approved exterior ship studies — Codex handoff

Refs #827. Principal approved all target images, then accepted the generated models with one correction: remove the four cockpit-like assemblies from Bastion's deck; command glazing belongs on its bridge. That correction is built and captured. Final instruction: "looks good, continue".

## Deliverables

Each role directory contains the approved target, editable packed Blender scene, self-contained textured GLB and measured model report. `build_model.py` and `geometry.py` regenerate them. `index.html` / `viewer.ts` inspect every ship; `review/index.html` compares approved targets with actual browser screenshots. Launch instructions are in README.md. Source dimensions are metres, Y up, +Z forward. Viewer scales each model to a common inspection size; it does not change exported dimensions.

| Role | Bounds X × Y × Z (m) | Triangles | GLB MB |
|---|---|---:|---:|
| interceptor | 24.01 × 24.02 × 62.31 | 253298 | 16.5 |
| patrol | 33.82 × 12.11 × 55.31 | 446924 | 26.7 |
| explorer | 84.54 × 84.51 × 73.81 | 513704 | 29.0 |
| raider | 33.82 × 11.59 × 56.31 | 463464 | 27.6 |
| carrier | 122.60 × 129.59 × 402.05 | 605268 | 36.1 |
| prospector | 20.01 × 15.00 × 66.40 | 214448 | 14.5 |
| dreadnought | 106.60 × 135.19 × 432.00 | 1106876 | 65.9 |

## Verification and acceptance

Seven GLB tests passed (61 assertions), strict standalone viewer typecheck passed, and all seven hardware browser captures passed orbit, target dialog, inspection lights, rotation, presets and PNG export without browser errors. Initial round-3 capture ran about 120 FPS on Apple M1 Pro. The corrected Bastion capture ran 72.22 FPS; no production performance claim follows from either isolated inspection run.

Pilgrim has an 80 m walking-floor diameter, nominal 3 RPM and 0.40257 g at its floor. Exported outer envelope is approximately 84.54 m wide; longitudinal length 73.81 m. Its rotor is a separate named GLB assembly. The browser measured 2.966 RPM. No walkable interior or crew simulation is implemented.

Independent target-similarity scores ended at 3.95–4.90/10; see review/round-3-*.md. These did not reach the nominal 8/10 gate. The principal accepted the appearance after inspecting the results and requesting the Bastion correction. Preserve both facts. Known visual limitations include repetitive panel/assembly treatment, target proportion differences, and small surface artifacts on Lance's lower pod.

## Production implementation remains

These are isolated prototypes; no game hull builder, collision, roster, economy or deployment was changed. Integrating requires a deliberate asset/LOD strategy (current models have 214k–1.1m triangles), metre-to-kilometre conversion, collision and docking envelopes, cockpit/weapon/thruster transforms, disposal and instancing, and live-flight performance checks. Pilgrim's ring changes its envelope substantially: preserve the 40 m floor radius while resolving station fit. Keep its rotating ring distinct from the stationary keel. Bastion command windows belong only on the bridge; do not restore the removed deck fairings.

Use src/ship-mesh.ts and the current ship definitions as integration entry points, verify their live contracts first, and reuse the approved Porter/Longwall pipeline decisions. Do not infer production handling, hold capacity or mass from visual dimensions. Run repository probe selection against the final integration diff, then the required canonical checks and principal visual review before merge. No production acceptance or merge is asserted by this study handoff.
