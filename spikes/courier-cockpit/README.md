# Courier cockpit study — Codex

Refs jcfischer/seelite#792. Isolated interactive model study, not a production cockpit replacement.

The principal selected O9's low tapered canopy and dashboard with O8's stacked cyan displays, keypad, physical controls and worn equipment. The subsequent instruction was to build a viewer like the Coriolis viewer and stop at approximately 6.5/10. Independent visual judging reached **6.5/10 in round 4**, and visual work stopped there.

## View

From this worktree:

```sh
npm run dev -- --host 127.0.0.1 --port 5192 --strictPort
```

Open http://127.0.0.1:5192/spikes/courier-cockpit/ . This is a dev-only entry, deliberately absent from the production site's build inputs.

- **Pilot:** drag to look; P returns to the fixed pilot view.
- **Orbit / Side / Instruments:** drag to orbit, wheel to zoom, right-drag to pan.
- **Hull fit:** overlays the current courier A as wireframe for spatial review.
- **Work lights:** temporary inspection lighting.
- **Target:** the selected generated design; Esc closes it.
- **Save image:** downloads the current canvas. H hides/restores the viewer controls.

Instrument values are a fixed visual fixture. The viewer constructs no Game, flight simulation or save store. The two glyphs on the small screens are stylized courier schematics, not meshes of its precise exterior.

## Source and fit

- `build_model.py` authors the original cockpit in Blender and exports the GLB.
- `courier-cockpit.blend` is editable source with the generated material packed.
- `../../src/courier-cockpit-viewer.ts` supplies lighting, instruments and inspection controls.
- `../../public/spikes/courier-cockpit/` contains the runtime model and images.

Geometry uses pilot-local metres. Its origin corresponds to `(0, 4.7, -12.5)` metres in the current courier A hull; the pilot camera is another 1.15 m aft. The hull overlay and forward hull geometry come directly from `buildShipMesh('courier', 'a')`, scaled from kilometres to metres. The viewer cuts away the portion of that hull around the cockpit and changes its presentation material; production geometry is untouched.

This is a visual fit study, not a proven pressure vessel or certified collision-free interior. Canopy joins, rear enclosure, seat/footwell ergonomics and all equipment clearances remain review work. The visible foredeck uses the existing hull, whose proportions differ from the generated target. The independent judge explicitly retains that gap.

## Rebuild and verify

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/courier-cockpit/build_model.py
npx tsc --noEmit
node spikes/courier-cockpit/capture.mjs round-4
```

Capture expects the local server above, verifies the served worktree and requires a hardware renderer. It captures pilot/orbit/instrument/side/hull-fit/narrow views, tests orbit and pilot look, target opening/closing, pilot reset and work lights, and records actual frame timing and browser errors. It does not establish production flight correctness or a throughput benchmark: the FPS is vsync-on observed cadence at 1586×992, DPR 1, on the named machine.

`evidence/` preserves the final pilot and viewer captures, metrics and judge verdict. Full intermediate captures and original target live under `.dream-loop/` and are intentionally ignored. No production PR, full production browser-suite result, merge or principal acceptance is claimed by this checkpoint.

## Remaining visual gaps at the requested stop

The nose reads broader and shallower than the target, canopy framing is skeletal, cockpit surfaces are flatter/more angular, and fine surface detail/ambient light remain limited. Text and scanner graphics are simpler. Stop was intentional at 6.5, not a claim of target parity.
