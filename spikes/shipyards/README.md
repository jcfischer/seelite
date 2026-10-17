# Industrial shipyards — Codex model study

Refs [three approved shipyard designs](https://github.com/jcfischer/seelite/issues/800). The principal approved O1 Gantry Works, O2 Foundry Hangar and O3 Crescent Slipway and requested independent Dream Loop fidelity of 7/10 per model.

## Inspect

From this worktree run `npm run dev -- --host 127.0.0.1 --port 5210 --strictPort`, then open http://127.0.0.1:5210/spikes/shipyards/.

Select a station with O1/O2/O3. Drag to orbit horizontally and vertically, wheel to zoom, right-drag to pan. Seven camera presets include a docking-hub close-up. Animate tooling moves the rail carriages and articulated shoulders, elbows and wrists; toggle it again to pause. Hull restraints remain stationary. These are bounded demonstration motions, not a collision-planned repair simulation. Capsule rotation spins only the life capsule about its docking axis. Work lights reveal shadowed structure. Style reference opens the approved Coriolis reference; Save image exports the current canvas. H hides the controls. Direct model links use `?model=o1`, `?model=o2`, or `?model=o3`.

The viewer constructs no Game and touches no saves. This is a visual prototype, not a production replacement. Simulation dimensions, berth fit, collision proxies, LOD and flight integration remain future work. The serviced vessel is the current in-game Carrier A, built directly by `src/ship-mesh.ts`, at its actual catalogue scale: approximately 379.7 m long, 176.4 m wide and 145 m high. The same kilometre-to-view conversion is used in every yard; the decorative surrounding craft remain roughly 30–50 m long. These are not simulation actors.

Following the principal's live-view corrections, Gantry and Hangar use rigid rail-guided robotic manipulators with positive hull clamps, not gravity-dependent hanging hoists. Every life capsule connects to the main structure through an enclosed access spine, an axial rear bearing and a rotary pressure sleeve. Trusses provide bracing around that enclosed route. The geometry communicates an internal worker-transfer route; there is no on-foot simulation or pressure-system implementation.

Slipway mounts its capsule above the midpoint of the arc, with the docking port facing upward and the enclosed access spine underneath.

## Source and reproduction

- `build_model.py`: deterministic Blender authoring source, separate static and rotating material batches. Draft dimensions are in 10-metre units; export coordinates are metres, Y up, capsule-local +Z docking approach. Slipway mounts that axis along world +Y.
- `o1.blend`, `o2.blend`, `o3.blend`: editable Blender scenes with packed generated paint texture.
- `o1.glb`, `o2.glb`, `o3.glb`: textured browser exports. The viewer uses a common 0.1 display scale.
- `coriolis-industrial-surface.png`: the approved Coriolis generated albedo, reused at its 145 m material repeat. `paint-clean.png` retains the previous shipyard finish for provenance. Material metalness/roughness and geometry provide the rest of the appearance; this is not a measured PBR texture set.
- `target-o1.png`, `target-o2.png`, `target-o3.png`: approved v2 generated targets, not implementation screenshots.
- `model.test.ts`: exported hierarchy, axial centres, texture and geometry checks.
- `capture.mjs`: guarded hardware capture and browser geometry/control checks.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/shipyards/build_model.py
bun test spikes/shipyards/model.test.ts
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable spikes/shipyards/viewer.ts
node spikes/shipyards/capture.mjs round-N
```

To rebuild one model, append `-- o1` (or o2/o3) to the Blender command. The capture observes the shared probe lock, checks the served worktree and requires a hardware renderer. It records seven views per station, checks the docking approach at five roll angles, samples fixed geometry against the capsule envelope, and exercises the viewer controls. These are prototype checks, not production collision validation.

**Flight export (node #818).** The shipping assets are built separately and do not touch the review files:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python spikes/shipyards/build_model.py -- o1 o2 o3 --flight
node spikes/shipyards/prepare-flight-asset.mjs   # writes src/models/shipyard-{gantry,foundry,slipway}.glb
bun test tests/shipyard-flight-asset.test.ts
```

The viewer's **Flight export** button (or `?flight=1`) shows them. What the flight build changes, and why, is in [the integration receipt](../../docs/receipts/node-818-shipyard-integration.md).

Vite may miss edits under ignored `.worktrees/`; restart this worktree's server before recording a changed viewer. Intermediate captures stay in ignored `.dream-loop/`. Final review and capture evidence lives in `evidence/`.

## Verified stopping point

| Station | Independent fidelity | Final capture | Warm FPS on Apple M1 Pro |
| --- | --- | --- | --- |
| O1 Gantry | 7.1/10 | round 7 | 50 |
| O2 Hangar | 7.0/10 | round 8 | 56 |
| O3 Slipway | 7.0/10 | round 7 | 60 |

Stopped visual iteration when each model reached the requested 7/10. Exact judge reports, seven-angle images and hardware-browser metrics are in `evidence/`; scores account for the principal's revised mechanical requirements. This is independent review evidence, separate from principal approval.

Validation: 3 exported-model tests, 150 assertions; strict standalone viewer TypeScript; hardware browser controls and tooling motion/pause; invariant docking centres, five-angle throat rays and sampled capsule sweep clearance. No browser errors or static sweep violations. Hashes pin final source and model artifacts. The source/GLB hierarchy preserves the carriage and three arm joints for further iteration.

For a focused capture append a model ID, e.g. `node spikes/shipyards/capture.mjs review-o2 o2`. The all-model default remains available. The principal approved the final models on 2026-10-08. See [HANDOFF.md](HANDOFF.md) for production implementation and integration work. The study was isolated on `spike/shipyard-models-800`; node #818 (PR #939) integrates the flight exports into the game.

The subsequent capital-ship scale correction replaces the earlier enlarged Porter reference. `evidence/carrier-scale/` contains updated captures and measured Carrier A dimensions for all three yards; the earlier fidelity reports document the station-design stopping point before this requested vessel substitution.

## Coriolis visual family

The principal requested the shipyards adopt Coriolis's textures and shapes. The active models reuse the approved original industrial texture from Coriolis at commit `30781f3`, its ceramic-steel/graphite/worn-alloy palette and roughness, and its restrained warm lighting. Larger flat armor panels sit within dark strapped edges; service trunks divide broad surfaces; the capsule mouths have three deep chamfered tiers, compact lamps and ochre hazard sills. The three station layouts, real-scale Carrier A, tool animation and enclosed axial worker routes remain intact.

`references/` preserves the actual Coriolis hero/detail images and texture provenance. The original O1/O2/O3 target images remain historical layout references; the viewer's Style reference button shows Coriolis. The new surface is included in every GLB and packed Blender scene.

Independent Coriolis-family review passed on the first adaptation: O1 8.2/10, O2 8.1/10, O3 8.0/10. No further polish after passing the retained 7/10 threshold. `evidence/coriolis-style/` contains the full review, seven views per station, hardware-browser metrics and the verified reference-dialog screenshot. Model/axis tests: 3 passed, 150 assertions. Hardware checks retain true carrier dimensions and zero capsule sweep violations; tooling/control exercises pass. Measured warm FPS: approximately 56/60/60 on Apple M1 Pro. Strict viewer TypeScript passed. These supersede the earlier material-style review, and the principal approved the resulting models on 2026-10-08.
