# Seven-ship distance levels — Codex

Principal accepted the existing designs on 2026-10-09, requested only Bastion's open stern be closed, then two simpler distance versions of each ship. Full-detail geometry for the other six ships is unchanged. Bastion adds a closed, outward-facing aft bulkhead; the forward bay stays open.

Reference: node [812](https://github.com/jcfischer/seelite/issues/812), actual integration [PR 828](https://github.com/jcfischer/seelite/pull/828), `src/courier-hull.ts` reducedGeometry/reducedLevel, inspected at `74f21128f0d5cfdf56a85edace8ade7844cc9e13`. The requested number 838 is the separate background-loading issue.

## Artifacts

Each role directory contains `model.glb` (full), `model-reduced.glb` (LOD 1), `model-outline.glb` (LOD 2), and `lod-report.json`. All keep metres, Y up, +Z forward, the original origin, material tints and embedded textures. Habitat parent names, physical metadata and independent rotation groups remain intact. The report fingerprints the full source with SHA-256 and records actual output bounds, counts, bytes and simplification errors.

| Ship | Full triangles | LOD 1 triangles | LOD 2 triangles | LOD 1 / LOD 2 size |
| --- | ---: | ---: | ---: | ---: |
| Lance | 587,810 | 95,772 | 67,654 | 8.56 / 6.91 MB |
| Warden | 795,784 | 106,090 | 88,610 | 9.10 / 8.09 MB |
| Pilgrim | 879,036 | 170,275 | 126,650 | 13.24 / 10.73 MB |
| Shiv | 825,596 | 109,805 | 92,148 | 9.31 / 8.30 MB |
| Bastion | 1,350,582 | 228,744 | 175,040 | 16.80 / 13.40 MB |
| Sluice | 428,524 | 72,687 | 47,160 | 6.94 / 5.49 MB |
| Rampart | 2,282,852 | 303,761 | 217,092 | 21.87 / 16.22 MB |

## Method and use

The generator follows the courier's Meshopt 1.3.0 position-weld, absolute-error edge collapse and recomputed normals with a 30 degree crease. Machinery can be pruned. Painted armor, deck and glass retain their component topology: indiscriminate pruning erased the pale hull and habitat skin, revealing the dark backing shell. This intentionally retains more triangles in the outline version (86–90% below full, compared with 81–87% for reduced), while preserving the accepted color fields. It compacts the exported attributes afterward. Materials and texture bytes are retained. This is lossy: regenerated normals and welded UVs can change pixels even when positional error is small. Each level is independently derived from full, never from the preceding simplified output.

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

## Verified results — 2026-10-09

- 15 model tests / 1,565 assertions pass; standalone viewer TypeScript check passes. Armor surface coverage is now checked too, guarding against removing the visible skin and exposing dark backing meshes.
- All seven hardware captures pass: three manually selected levels, one visible level at a time, both automatic range transitions and return to full, synchronized three-level habitat rotation where present, and no browser errors. ANGLE Metal / Apple M1 Pro. Captured all 21 close inspection views and three Bastion stern views; visually inspected every final outline, plus Bastion reduced and rear.
- Canonical repository selector and runner: 4/4 selected probes pass at 969c8e5 (chase-orbit, handoff, model-viewer, pointer-lock); 92 probes were not run. This is partial coverage, not a full-suite pass. Subsequent armor-retention changes are covered by the final model tests and study captures.
- Six non-Bastion full GLBs match the accepted f1c512a source byte-for-byte. Bastion's full model adds only the aft closure.

### Visible transition measurement

Same camera at 44 / 440 reference reaches, full twice as a control, then the LOD. Counts below use RGB differences greater than 24/255. Every full-versus-full control changed zero pixels. These are geometric simplifications, **not pixel-identical replacements**: normals, small fixtures and welded UVs change shading. At the far edge the whole ship is only 3–15 measured pixels, so percentages there are not a useful quality score. Production integration should review the actual transitions under the game rig before selecting final switching bands; this study makes no seamless-transition claim.

| Role | Reduced full footprint | Reduced changed pixels | Outline full footprint | Outline changed pixels |
| --- | ---: | ---: | ---: | ---: |
| interceptor | 647 | 411 | 7 | 4 |
| patrol | 762 | 484 | 9 | 6 |
| explorer | 1316 | 617 | 15 | 15 |
| raider | 532 | 425 | 3 | 3 |
| carrier | 908 | 392 | 10 | 8 |
| prospector | 485 | 319 | 8 | 4 |
| dreadnought | 472 | 272 | 3 | 1 |

Sage review correction: full capital clearance is now measured over triangle surfaces, not just vertices. Both exports have 1.558017 m conservative radial clearance. `authoredVertexGapMetres` is separately labeled as a vertex-only authoring diagnostic. See REVIEW-codex.md for findings and dispositions.
