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

Independent review scores are pending the first capture. No achieved fidelity or production readiness is claimed here yet.
