# Bollard O4 hull study — Codex

Refs jcfischer/seelite#798. Editable exterior prototype of the selected O4: O2's open-frame salvage tug with O3's reinforced collar and selective armour. Dream Loop stopping point: independent visual fidelity of 7/10. Reached **7.1/10** after five reviewed rounds; final screenshots and limitations are in `evidence/review.md`. Principal visual approval given on 2026-10-08: “visual approval given! Commit any open things then leave PR for another agent to finish”. Approval covers this isolated Bollard O4 visual prototype.

## View

Run `npm run dev -- --host 127.0.0.1 --port 5208 --strictPort` from this worktree, then open http://127.0.0.1:5208/spikes/bollard-hull/.

Drag to orbit horizontally and vertically, scroll to zoom, right-drag to pan. Presets include Overview, Front, Top, Rear, Cockpit and Underside. Work lights illuminate hidden surfaces; Rotate turns the model; Target opens the generated reference; Save image exports the current rendered canvas. H hides the controls.

The viewer constructs no Game and touches no saves. Files are outside production build entries. This is an isolated model study; flight integration, berth fit, collision geometry, vent positions and production LOD are unverified. The cabin has simplified equipment, not the separate authored flight cockpit.

## Sources

- `build_model.py`: deterministic Blender authoring source, metres, Y up, +Z forward.
- `bollard-hull.blend`: editable mesh with packed generated paint texture.
- `bollard-hull.glb`: material-batched textured export.
- `paint-wear.png`: generated chipped paint albedo; prompt and provenance in `assets.md`.
- `target.png`: selected generated O4 reference, not an implementation screenshot.
- `viewer.ts`, `index.html`: isolated Three.js inspection viewer adapted from the Courier study.
- `capture.mjs`: guarded hardware capture, controls exercise and timing receipt.
- `model.test.ts`: exported backing-shell winding/closure and textured geometry bounds checks.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/bollard-hull/build_model.py
bun test spikes/bollard-hull/model.test.ts
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable spikes/bollard-hull/viewer.ts
node spikes/bollard-hull/capture.mjs round-N
```

Capture observes the shared probe lock, verifies served-worktree identity and requires a hardware renderer. It records six presets, two additional rear views, the interface, and a narrow viewport; checks orbit, presets, target modal, lights, rotation and PNG download; and records errors and observed frame cadence. Timing is for the study viewer, not production flight.

Vite's file watching can miss edits inside ignored `.worktrees/`; restart this study's server after changing viewer source and confirm the served module before judging. Intermediate screenshots and logs stay in ignored `.dream-loop/`; final review evidence lives in `evidence/`.
