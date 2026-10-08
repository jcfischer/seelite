# Porter O2 modular freighter — Codex

Refs jcfischer/seelite#797. Editable exterior prototype of the principal-selected O2 Modular Carrier. Dream Loop stopped at an independent **7.1/10**, meeting the requested 7/10 threshold. This is a visual checkpoint, not production integration or principal visual acceptance.

## View

Run `npm run dev -- --host 127.0.0.1 --port 5199 --strictPort` in this worktree and open http://127.0.0.1:5199/spikes/porter-hull/.

Drag to orbit, wheel to zoom, right-drag to pan. Presets show Overview, Front, Top, Rear, Cockpit and Underside. Work lights reveal hidden surfaces; Rotate turns the ship; Target shows the chosen reference; Save image exports the canvas. H hides controls.

## Source and rebuild

- `build_model.py`: seeded Blender authoring source, metres, Y up, +Z forward.
- `porter-hull.blend`: editable mesh and packed materials.
- `porter-hull.glb`: exported textured model.
- `viewer.ts`, `index.html`: isolated Three.js inspection viewer.
- `target.png`: selected generated target, not a live render.
- `evidence/`: final live screenshots, hardware metrics and independent review.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/porter-hull/build_model.py
bun test spikes/porter-hull/model.test.ts
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable spikes/porter-hull/viewer.ts
node spikes/porter-hull/capture.mjs round-N
```

Capture checks served-worktree identity, waits for the shared probe lock, requires a hardware renderer, captures multiple views and checks orbit, presets, target dialog, inspection lights, rotation and PNG export. Vite file watching in this nested worktree did not reliably invalidate transformed viewer source during authoring; restart the server after viewer edits.

## Verification and limits

The exported command hull and all three cargo cassettes pass closed-manifold and outward-winding checks. Cargo cassettes have real depth, remain beside the command keel, and preserve open separations. The final capture reported no browser errors and 58.7 FPS on ANGLE Metal / Apple M1 Pro at 1586 × 992. This is an observed inspection-view cadence, not a flight benchmark. The model has 363,646 triangles across 19 material-batched meshes, about 67.1 × 42.3 × 14.7 metres.

All assets are under `spikes/`, outside the production build entries. No production game module was changed. Flight integration, collision/docking envelope, production LOD, cockpit integration and production performance remain unverified. No merge or deployment performed.
