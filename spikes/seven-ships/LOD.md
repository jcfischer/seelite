# Seven-ship distance levels — Codex

Principal accepted the existing designs on 2026-10-09, requested only Bastion's open stern be closed, then two simpler distance versions of each ship. Full-detail geometry for the other six ships is unchanged. Bastion adds a closed, outward-facing aft bulkhead; the forward bay stays open.

Reference: node [812](https://github.com/jcfischer/seelite/issues/812), actual integration [PR 828](https://github.com/jcfischer/seelite/pull/828), `src/courier-hull.ts` reducedGeometry/reducedLevel. The requested number 838 is the separate background-loading issue.

## Artifacts

Each role directory contains `model.glb` (full), `model-reduced.glb` (LOD 1), `model-outline.glb` (LOD 2), and `lod-report.json`. All keep metres, Y up, +Z forward, the original origin, material tints and embedded textures. Habitat parent names, physical metadata and independent rotation groups remain intact. The report fingerprints the full source with SHA-256 and records actual output bounds, counts, bytes and simplification errors.

| Ship | Full triangles | LOD 1 triangles | LOD 2 triangles | LOD 1 / LOD 2 size |
| --- | ---: | ---: | ---: | ---: |
| Lance | 587,810 | 95,772 | 9,410 | 8.56 / 3.35 MB |
| Warden | 795,784 | 106,090 | 2,254 | 9.10 / 3.09 MB |
| Pilgrim | 879,036 | 169,699 | 4,302 | 13.20 / 3.16 MB |
| Shiv | 825,596 | 109,805 | 1,884 | 9.31 / 3.07 MB |
| Bastion | 1,350,582 | 226,192 | 12,094 | 16.66 / 3.62 MB |
| Sluice | 428,524 | 72,687 | 7,056 | 6.94 / 3.26 MB |
| Rampart | 2,282,852 | 302,561 | 10,396 | 21.80 / 3.51 MB |

## Method and use

The generator follows the courier's Meshopt 1.3.0 position-weld, absolute-error edge collapse with Prune, and recomputed normals with a 30 degree crease. It compacts the exported attributes afterward. Materials and texture bytes are retained. This is lossy: regenerated normals and welded UVs can change pixels even when positional error is small. Each level is independently derived from full, never from the preceding simplified output.

The reference frame is 60 degrees vertical FOV, 1800 device pixels high; geometric error targets half a device pixel at 40 ship reaches for reduced and 400 for outline. Reach is measured from the full model's bounding-box centre to its furthest vertex. The study viewer centres ALL levels using the full model's centre and scale. Auto uses the existing `detailLevel` hysteresis and adjusts radii for its actual FOV and drawing-buffer height, so its narrower inspection lens does not switch too early. The dropdown also forces each level for comparison. Medium range and Far range buttons cross the respective hysteresis bands. All three habitat rotors advance together so changing LOD does not reset their phase. The viewer shares the full level's materials/textures across levels.

Use full geometry for collision, bounds, mounting-point raycasts and gameplay measurements. These LODs are display-only stand-ins. Production integration remains separate: no production loaders, hull envelopes or game rendering paths were changed. An integrator can reuse these exports and the existing ship detail bands; apply one shared metre-to-game transform and phase to all three levels.

## Regenerate and verify

```sh
npm ci --prefix spikes/seven-ships --ignore-scripts
node spikes/seven-ships/generate-lods.mjs
bun test spikes/seven-ships/model.test.ts spikes/seven-ships/lod.test.ts
node spikes/seven-ships/capture-lods.mjs
```

The generator accepts optional role arguments. Rebuild Bastion with the existing Blender command before regenerating its levels if its source changes. Headless verification checks source fingerprints, smaller triangle/file counts, finite geometry, containment within the full envelope, retained rotor metadata, and outward-facing stern coverage in all three assets. `capture-lods.mjs` captures all 21 models, stern views, automatic transitions, synchronized habitat rotation and distant full-versus-LOD pixel changes on hardware WebGL. Current browser evidence is stored under `review/lod/`.
