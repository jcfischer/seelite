# Nine station studies — Codex

Refs #808 (approved images), #810 (model studies). The principal approved all nine targets and requested independent visual fidelity of at least **7/10 per model**, then stopping.

Run `npm run dev -- --host 127.0.0.1 --port 5217 --strictPort`, then open `/spikes/stations/`. O1–O9 select Ring, Drum, Assembly, Wheel, Derrick, Buoy, Rig, Cluster and Salvage. Drag to orbit in both axes, wheel to zoom, right-drag to pan. Camera presets, work lights, a display turntable, approved target and PNG export are available. H hides controls. `?model=wheel` links directly to a model.

This is an isolated model study. It constructs no Game and touches no saves. Turntable rotates the display, not a simulated station bearing. Production integration, physical dimensions, collision proxies, spin ownership, LOD, berth placement and game-lighting approval remain separate work. Slot studies have a 120 × 70 m clear passage; pad studies retain an exposed approach. Salvage follows its approved target with its pad on the front face.

## Authoring

- `build_model.py`: reproducible per-station Blender authoring. Author units are 10 metres, Y up; GLB coordinates are metres. The viewer displays at 0.1 scale.
- `geometry.py`: material-batched geometry helpers adapted from the active shipyard study. Seeded detail, plate bevels, UVs and fixtures.
- `<name>.blend`: editable scene with packed texture.
- `<name>.glb`: browser model, embedded texture and docking datum.
- `industrial-surface.png`: existing generated Coriolis texture reused by permission through the requested style/tooling continuity.
- `target-<name>.png`: approved built-in imagegen target. These are design references, not implemented screenshots.
- `model.test.ts`: exported assets and approach-clearance checks.
- `capture.mjs`: tree-guarded, lock-coordinated hardware browser captures and viewer interaction checks.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/stations/build_model.py
bun test spikes/stations/model.test.ts
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable spikes/stations/viewer.ts
node spikes/stations/capture.mjs round1
```

Append station names after Blender's `--` or after the capture label to work on a subset. Intermediate evidence stays under ignored `.dream-loop/`; final reviewed evidence is copied to `evidence/`.

## Review status — 2026-10-09

The principal approved the visuals on 2026-10-09 and requested a PR plus final integration by another agent. That approval supersedes the earlier request for input; historical independent scores remain unchanged below. Ring, Wheel and Salvage received the requested hull closures after those scores. No further visual refinement is requested. Tests and probes were explicitly stopped during PR preparation.

| Station | Fidelity /10 | Status |
|---|---:|---|
| Ring | 7.10 | Threshold met |
| Drum | 6.90 | Principal approved |
| Assembly | 7.00 | Threshold met |
| Wheel | 7.00 | Threshold met |
| Derrick | 7.00 | Threshold met |
| Buoy | 6.90 | Principal approved |
| Rig | 7.05 | Threshold met |
| Cluster | 7.05 | Threshold met |
| Salvage | 6.90 | Principal approved |

Open `review.html` for target/model comparisons. `evidence/results.json` binds scores to reports and asset hashes; each `*-judged.png` is the exact reviewed image. Final hardware captures include six angles and the viewer controls for every model. `metrics.json` records approximately 60 FPS on ANGLE Metal / Apple M1 Pro, with no page errors. This is desktop viewer evidence, not a game performance claim.

Validation before the stop instruction: 21 asset/approach/closure tests pass; strict standalone viewer typecheck passes; all nine browser loads, orbit, zoom, six presets, target dialog, lights and PNG export pass. The canonical selected/full PR browser suite has not been run. These are local model studies, not a runtime integration PR.

`final_shapes.py` contains the structural revisions layered on the shared authoring helpers in `build_model.py`. Rebuild from the main authoring script. All Blender files pack their texture; all GLBs embed it.

## Principal hull-closure correction — 2026-10-09

Ring and Wheel now have solid rear pressure bulkheads with segmented armor and service panels. Salvage's bow loft has closed end skins; its tower has recessed caps beneath the raised rim. Front docking approaches remain clear. The three new exported-geometry regression tests failed before rebuilding and passed afterward (21 tests, 497 assertions total). Previous independent fidelity scores predate this correction and have not been reassessed.

## Receiving integration agent

The model delivery branch is `design/remaining-stations-codex`; worktree `.worktrees/station-designs-codex`. Read `CLAUDE.md`, graph #1 and #810, then current Coriolis authored-model integration before selecting the production path. Preserve the approved silhouettes and materials. Ring/Drum/Assembly/Wheel map to remaining trade forms; Derrick/Buoy/Rig/Cluster/Salvage map to outposts. Verify the actual runtime registry mappings; do not infer index order from viewer O1–O9 labels. Coriolis is already done. Shipyard and refinery work is in PRs #811 and #817; reuse those designs.

Production work still needs optimized assets/LOD and loading, scale and berth-envelope agreement, docking transforms and clearance, collision proxies, spin ownership, shared game lighting and lifecycle disposal. The study viewer's 0.1 scale and turntable are display choices, not game contracts. Source GLBs are intentionally detailed studies and must not be dropped into runtime without addressing performance.

The principal explicitly said **stop tests and probes**. Do not restart them without fresh authorization. The pending closure capture was terminated while waiting for another worktree's GPU lock, so closure screenshots were not taken. Historical screenshots and scores are retained; the current exported closure geometry passed its regression checks before the stop instruction. No fresh Sage approval, full PR verification, merge or deployment is claimed.
