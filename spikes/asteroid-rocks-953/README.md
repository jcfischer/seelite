# Authored field rocks

Refs #953. Prototype asset library and in-game measurement adapter, not production field integration.

## Principal rulings

- 2026-10-13: approved the generated fractured grey-brown rock direction before modeling.
- Expanded K from 8 to **16**, retaining the +1.0 ms high / +0.4 ms low budget and the existing two batches plus points.
- **Field rocks only**; station rocks remain unchanged.
- Accepted the representative model and its three LODs in the interactive viewer. Both diffuse and standard materials were acceptable; use the cheaper one. Preliminary measurements selected **Lambert diffuse**.
- Viewer exposure reduced from 1.0 to **0.85**. This is a viewer setting, not a change to global game exposure.
- Actual field counts, spacing, motion, radius bounds and LOD thresholds remain those of the field contract. The generated target's framing is illustrative; it does not amend those quantities.

## Review

Run Vite from this worktree and open `/spikes/asteroid-rocks-953/index.html`.
Drag to orbit vertically/horizontally, scroll to zoom, right-drag to pan. The viewer supplies model selection, three explicit levels, movable light, diffuse/standard/clay/wireframe materials, and the approved target.

`target.png` is the corrected visual target sheet. `source/rock-albedo-reference.png` was generated with the built-in image generator from the approved target, then baked in Blender. It is not a downloaded third-party texture.

## Rebuild

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python spikes/asteroid-rocks-953/build_model.py -- --count 16
bun test spikes/asteroid-rocks-953/assets.test.ts
```

Python is used only inside Blender, as explicitly authorized by the node. `asteroids.blend` is editable source; the script is the reproducible recipe. `runtime/asteroids.glb` contains sixteen named archetypes, each with three meshes and shared baked albedo/normal maps. All levels of each archetype are scaled together to a unit bounding sphere. glTF positions are in units of bounding radius; the field instance multiplies by `radiusKm`.

The UVs repeat a shared baked tile. Every level inherits the same mapping; the library's texture memory does not grow with archetype count. MeshStandardMaterial is the portable GLB material. `load.ts` adopts its maps into the selected Lambert material for the field. Three's stock tangent-normal and batching transformations carry the normal with each instance; the old procedural surface splice is not used.

## Measurements

The existing instrument is extended by the `batch-authored` arm. Other arms remain available. Example:

```sh
SEELITE_PROBE_RENDERER=hardware VIEWS=close,inside,edge,far ARMS=batch-authored,batch-k K=16 BLOCKS=12 FRAMES=120 PORT=5199 node spikes/asteroid-lod-950/measure.mjs
```

`SHADING=standard` compares the alternative material. `SHOTS=<existing directory>` captures instead of timing. `ORDER_SEED=7` supplies the second shuffled run. Do not run beside another GPU workload. The standalone viewer renders only when changed unless Rotate is enabled.

The in-game fixture loads after boot and inserts the field into the real near scene. It is not a production loader registration: generated-field lifecycle, jump-safe installation, fallback/retry, postcard readiness and teardown still belong to the eventual production field integration. A successful gallery is not evidence for those paths.

Final timing, cold install, delivery and remaining gates are recorded in the integration receipt, not inferred from the standalone viewer's frame rate.
