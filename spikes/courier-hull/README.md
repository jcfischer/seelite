# Courier O4 hull study — Codex

Refs jcfischer/seelite#795. Isolated exterior model study of the principal-selected O4 image: O3's long tapered hull with O2's industrial construction. Requested stopping point: approximately 6.5/10 in an independent Dream Loop visual comparison.

## View

From this worktree, run `npm run dev -- --host 127.0.0.1 --port 5197 --strictPort`, then open http://127.0.0.1:5197/spikes/courier-hull/.

Drag to orbit in both axes, wheel to zoom, right-drag to pan. Overview, Front, Top, Rear, Cockpit, Interior and Underside reset the camera. Work lights temporarily illuminate hidden surfaces; Rotate turns the model. Target opens the selected generated image; Save image downloads the current rendered canvas. H toggles the interface.

All review assets live under `spikes/`, outside `public/` and the production build entries. The viewer constructs no Game or save store. This is an exterior prototype, with a simplified cockpit and a static seated pilot behind the glass. The actual courier cockpit study is imported from a preserved Blender source, simplified and fitted beneath this canopy; Interior shows its four static instrument fixtures. The body and both nacelles have closed, outward-wound backing meshes; an exported-GLB test checks every edge for two opposing uses and positive signed volume. Small hatches retain raised lids while their bases follow the skin; the six cockpit-side grilles and two aft shoulder grilles follow their mounting slopes. The exported cockpit vertices are checked against the canopy envelope. Detailed ergonomic clearance, berth envelope, collision geometry, flight performance and production LOD remain unverified.

## Source and rebuild

- `build_model.py`: deterministic Blender authoring source in metres, Y up, +Z forward.
- `courier-hull.blend`: editable source with the generated texture packed.
- `courier-hull.glb`: textured geometry, batched by material and named engine backing meshes.
- `adapt_cockpit.py`, `source/courier-cockpit.blend`: reproducible adaptation of the real courier cockpit.
- `cockpit-adaptation.json`: source hash and geometry reduction report.
- `viewer.ts`, `index.html`, `cockpit-instruments.ts`: isolated Three.js inspection viewer and static instrument fixtures.
- `target.png`: selected O4 generated target, not a model screenshot.
- `assets.md`: texture prompts and reference provenance.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/courier-hull/build_model.py
bun test spikes/courier-hull/model.test.ts
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable spikes/courier-hull/viewer.ts
node spikes/courier-hull/capture.mjs round-N
```

Capture waits for the shared probe lock, checks served-worktree identity and requires a hardware renderer. It records seven preset model views plus level and low rear views, the interface and narrow viewport, exercises orbit, presets, target dialog, work lights, rotation and PNG export, and records browser errors and a short observed frame cadence. This is not a production flight benchmark.

Intermediate images and logs are in ignored `.dream-loop/`. Final visual score, captures and remaining gaps are recorded in `evidence/` at the review checkpoint.

## Latest visual refinement

`evidence/visual-pass-15/` records the follow-up after the real cockpit was accepted: low segmented dorsal service ducts with seated brackets, guarded hull/deck lamps, clearer blue-grey versus pale steel paint, revised neutral lighting and a denser starfield. Hull dimensions, cockpit fit, sloped hatches and grilles are preserved. This pass adds 5,496 model triangles (339,938 total).

## Flagship refinement

`evidence/flagship-pass-19/` records the next bounded pass: deck-seated service trays, rounded pipe ends with elbow returns and guarded valves, nacelle vent guards, brushed nose rails, warmer lamps, improved metal response under a broad warm area light, subtle cockpit illumination and controlled glass specular response. Model geometry is 353,954 triangles across 36 meshes; hull dimensions and cockpit fit remain unchanged.
