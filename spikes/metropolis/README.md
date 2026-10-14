# Orbital Metropolis — O3 study

Refs https://github.com/jcfischer/seelite/issues/718

## Principal direction

2026-10-14: O3 chosen from three generated previews. This is a huge station reserved for wealthy worlds far along in economic development. Modules must support later expansion during play. Subsequent ruling: the rings turn 90 degrees to face outward, or use outward-pointing stalks. This study uses two axial end bearings, with wheel faces pointing toward −X and +X. The old O3 image remains the material/composition reference; its wheel orientation is superseded.

2026-10-14 revision: principal selected generated preview `exec-8cf2f67e-ba90-42c7-b8c8-d622a6ca20b4.png` (`target-four-directions.png`) over the long six-arm alternative. Preserve its clustered metropolis silhouette, with unequal growth into four radial sectors around the hub. This supersedes the earlier structure lock.

Principal feedback after round 13: "looks good", with enclosed access corridors requested for structures previously supported only by trusses. Added pressurised backbone links, terrace access shafts and radial galleries inside the trusses, plus mating necks between growth modules. This acceptance concerns the isolated study, not production integration.

2026-10-14: principal explicitly **approved** the corridor-equipped live study. Preserve this visual checkpoint; Dream Loop refinement is complete by principal acceptance. Production integration and the node's remaining technical gates are separate.

## Run

From this worktree:

```sh
npm run dev -- --host 127.0.0.1 --port 5189
# Open http://127.0.0.1:5189/spikes/metropolis/
bun test spikes/metropolis/growth.test.ts tests/station-wheel.test.ts
SEELITE_PROBE_RENDERER=hardware node spikes/metropolis/capture.mjs review
```

This viewer does not construct a Game. The existing production station pool is unchanged. A prototype capture is not the PR browser gate or a production performance measurement.

## Expansion contract

`createGrowthPlan(seed)` solves the complete reserved attachment grid using the existing WFC solver. `modulesAt(plan, moduleCount)` selects an exact connected prefix. The count is not an input to WFC: expanding cannot reroll existing modules. Every module has a stable id, parent id, position, radial orientation, type and terminal flag. Version 2 alternates socket banks between up/down and front/back sectors; unequal branch lengths preserve the clustered silhouette and a central approach corridor. `setCount` adds only missing groups; existing Three.js objects retain their UUID and transform. Decreasing count is a workbench inspection feature, not an approved gameplay mechanic.

The fixed spine, two wheels, bearings, docking district, radiator banks and support decks are foundation infrastructure; they are not included in `moduleCount`. A module means one cylindrical district unit, including its attached terrace or utility fittings. Capacity 42 and the dimensions are prototype authoring values, not economic thresholds.

For eventual saves, carry station identity plus `{ growthVersion: 2, assemblySeed, moduleCount }`; pin the grammar version. A changed vocabulary, socket layout, or traversal order needs a migration, not an implicit re-solve of existing stations. The current prototype has no save integration. Growth beyond the reserved capacity needs another explicit grammar/version policy. WFC varies district types; the reserved lattice and skyline envelope are authored, not emergent.

## Geometry and assets

All study units are metres. Shared `station-rim.ts` is the existing trade E rim loft extracted unchanged; `station-mesh.ts` still applies the existing panel UV treatment. `Pools` and `truss` are imported from `station-fixtures.ts`. No second rim or truss implementation.

The wheels spin in local Z about fixed bearings. Their roots rotate ±90 degrees about Y. The dock faces +Z. Its outer vestibule is 300×140 m, narrowing to the unchanged 120×70 m inner slot at study z=200 m. This is a prototype geometry declaration, not a production docking-frame adapter. Browser checks trace nine rays through the slot; they do not certify all triangle clearance or collision.

`target-four-directions.png` is the current principal-selected ImageGen target; `target-o3.png` retains the original reference. `hull-normal.png` supplies matching generated tangent-space relief (OpenGL +Y); both maps remain prototype-only. `hull-panels.png` is an ImageGen-generated flat albedo texture: warm off-white/silver rectangular panels, fine seams, vents, sparse bronze fasteners, uniform lighting, no text. Editable geometry is TypeScript. Procedural modules were chosen for runtime attachment, stable identity, separate rotating wheels, and reuse of existing geometry. Fal credentials were absent; a monolithic generated mesh or Blender export would not supply this growth contract. No third-party model assets were downloaded.

The texture and target live under spikes and are not imported by the production entry point. Production permission/pipeline for any retained generated texture must be settled during integration.

## Verification and current limits

- 128 seeds × every count 0..42: exact counts, stable prefixes, connected parents, deterministic replay, invalid-input refusal. The shared Wheel's existing tests also run.
- GPU capture exercises add-module, watched expansion, seed change and restoration; UUID/position retention is checked. Capture refuses a blank final frame and records browser errors, renderer and display-paced FPS.
- Evidence and independent Dream Loop scores are in `evidence/`; working iterations live in `.dream-loop/`.
- Production integration remains open: form F registration, collision proxies, authoritative reach, inner bay/berths, LOD and draw-call budgets, all finish variants, loading/disposal integration, world/save state, economy eligibility and growth events. No wealth or development threshold has been invented here.
- The independent visual threshold is 8/10; target selection is not approval of this implementation. The node remains open pending visual acceptance and its declared sheet/checkpoint.
