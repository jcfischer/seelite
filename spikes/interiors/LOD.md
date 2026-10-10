# Interior fitting LODs — Codex

The station interior workbench now selects each module's geometry independently. Original full-detail GLBs and editable Blender files are unchanged. This records the accepted study's asset delivery. Node #843 integrates it into production; the viewer now shares its assembly and themed material factory with `src/interior-kit.ts`. The hardware measurements below describe the original study checkpoint, not a fresh capture of this shared-builder viewer.

## Geometry

LOD1 removes small metal fastener components up to 0.16 m across; LOD2 up to 0.24 m. Removal is restricted to disconnected 12–40-triangle components, at most 0.08 m thick, in dark-structure or machined-alloy batches. Cladding, paint, glazing, grilles, lamps and major structure remain. Components are found by position connectivity, but output vertices are never welded: surviving positions, normals, UVs, winding and material definitions remain byte-identical. No normal-map bake or edge collapse is applied. Each level derives independently from the full source.

This uses the same full/reduced/distant presentation as courier #812 / PR #828 and the seven-ship PR #829, with conservative component removal instead of their position-welded simplifier. The closer inspection cameras make preservation of surface shading particularly valuable here.

| Module | Full | LOD1 | LOD2 |
|---|---:|---:|---:|
| airlock | 13,268 | 9,268 | 6,868 |
| berth | 76,452 | 51,972 | 37,284 |
| command | 44,672 | 30,272 | 21,632 |
| crane | 17,340 | 11,420 | 7,868 |
| gangway | 37,260 | 26,060 | 19,340 |
| loading | 79,664 | 55,344 | 40,752 |
| panel | 136 | 136 | 136 |
| rib | 256 | 256 | 256 |
| service-civic | 17,076 | 11,796 | 8,628 |
| service-frontier | 12,492 | 8,652 | 6,348 |
| service-survey | 13,160 | 8,840 | 6,248 |
| service-works | 8,840 | 5,960 | 4,232 |
| trunk | 240 | 240 | 240 |
| utility | 11,744 | 8,544 | 6,624 |
| wall-hatch | 3,512 | 2,552 | 1,976 |
| wall-reinforced | 232 | 232 | 232 |
| wall-repair | 1,796 | 1,316 | 1,028 |
| wall-vent | 2,484 | 2,004 | 1,716 |

Four already-light shell modules reuse their full assets. The other fourteen have two additional GLBs. All reference the existing shared-paint.png. The manifest fingerprints full sources and records bounds, bytes, triangles and the maximum removed component diameter for each level.

## Selection and batching

Auto bounds the projected size of removed hardware in device pixels using the drawing-buffer height, projection matrix, module scale and camera-space bounds. It includes off-axis perspective magnification. A coarse level starts at at most one pixel of removed detail and remains until that bound exceeds 1.2 pixels. A fitting touching or behind the camera plane stays full. The bound is intentionally conservative: close inspection commonly retains every fitting at full.

Instances are partitioned into full/reduced/distant buckets per module and parent group. Only a changed selection rewrites instance matrices; no per-fitting draw calls are introduced. Static camera/projection states skip selection work. Aggregate bounds remain conservative as instances change buckets. Shadow maps refresh on a transition. Geometry and theme materials remain shared, and rebuilds release the old instance buffers.

The Detail selector forces any level for review; Auto is the default. PNG export updates selection before rendering. Full geometry and the existing layout remain authoritative for clearances. Production conversion, streaming and asset residency are separate integration concerns; this workbench loads the complete review set.

## Hardware evidence

Apple M1 Pro / ANGLE Metal, 1584 × 992, seed 205 trade layouts. Rendered counts include the scene and postprocessing geometry passes; shadow maps were settled. These are triangle measurements, not an FPS speedup claim.

| Theme | Full rendered triangles | Auto rendered triangles | Reduction | Pixels changed >24/255 |
|---|---:|---:|---:|---:|
| civic | 6,955,056 | 5,399,344 | 22.4% | 450 |
| works | 5,803,968 | 4,471,488 | 23.0% | 291 |
| frontier | 6,373,832 | 4,901,064 | 23.1% | 280 |
| survey | 6,449,824 | 4,972,192 | 22.9% | 387 |

Axial full-versus-auto changes cover 0.018–0.029% of the image. All same-camera full-versus-full controls changed zero pixels. Twelve close inspection comparisons changed zero pixels except Works command (8) and Frontier command (6). The preserved silhouettes and scene composition were inspected in the captured views. Numerical pixel differences are evidence for review, not a substitute for principal visual approval.

Auto adds active LOD batches: axial draw calls increase by 110–135 while triangle submissions fall 22–23%. The instrument does not establish a frame-time gain. Forced LOD2 reduces major fitting geometry about 47–55%; its use at close distance is a diagnostic, not the automatic policy.

Raw screenshots and comparison sheet: .dream-loop/lod-codex/. Committed measurements: evidence/lod-codex.json. The first development capture exposed empty mesh batches caused by class-identity checks across Three.js module instances; it was rejected. Mesh detection now uses isMesh, empty batches fail, and axial captures require authored geometry in actual renderer counts.

## Regenerate and verify

```sh
node spikes/interiors/generate-lods.mjs
bun test spikes/interiors/lod.test.ts spikes/interiors/instanced-lod.test.ts spikes/interiors/layout.test.ts spikes/interiors/assets.test.ts
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable spikes/interiors/viewer.ts
# Start the workbench on 5205 and perform repository probe selection first.
SEELITE_PROBE_RENDERER=hardware node spikes/interiors/capture-lods.mjs
```

The capture validates all four themes, full/reduced/distant controls, mixed automatic levels, return to full detail, role/seed rebuilds, stable image controls and browser errors. The focused headless checks cover selection hysteresis, device pixel scaling, per-instance placement/population, source hashes, exact surviving triangles and layout clearance.

Final focused verification: 7 tests / 1,957,780 assertions; strict viewer TypeScript; deterministic regeneration of all 46 GLBs; final four-theme hardware capture. The repository-selected run passed 22/22 probes in 255 seconds; 74/96 probes were not run. This is partial repository coverage, not a full-suite pass.
