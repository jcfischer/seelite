# Porter O2 modular freighter — Codex

Refs jcfischer/seelite#797. Editable exterior prototype of the principal-selected O2 Modular Carrier. Dream Loop stopped at an independent **7.1/10**, meeting the requested 7/10 threshold. Jens-Christian approved this visual checkpoint on 2026-10-08 and requested a PR. Production integration remains outside this prototype.

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

The study's assets are under `spikes/`, outside the production build entries; **In the game** below says what node #813 ships from them.

## Implementation handoff

The principal approved this prototype and requested commit/PR only, so another agent can implement the production Porter. Preserve O2’s three separate starboard cargo cassettes, port command keel, wrapped clamps, industrial palette and service lights. Treat `target.png`, the approved live `evidence/hero.png`, and the editable Blender source as design references. The 7.1/10 checkpoint intentionally retains the gaps recorded in `evidence/review.md`.

Production work must establish the asset/pipeline decision under the map’s current constraints, then address runtime size/LOD, geometry/envelope/collision compatibility, cockpit fit, station traffic rendering, materials and relevant verification. This PR does not switch `freighter/b` to the authored asset. Run implementation checks in that follow-up. Broad testing and Sage review were not requested for this handoff; the principal explicitly stopped the PR-preparation checks. Node #813 is that follow-up.

## In the game

Node #813 makes O2 the game's Porter, `freighter/b`, which is the variant the freighter flies.

- **Asset.** `node spikes/porter-hull/prepare-game-asset.mjs` encodes `porter-hull.glb` losslessly (Meshopt geometry, WebP textures) into `public/models/porter.glb`, 14.4 MB, the one Porter file the game ships, and checks every vertex attribute and texture pixel survives. Run it after every Blender export. Everything else here stays review-only.
- **Loading.** `src/porter-model.ts` loads it behind the Coriolis's Retry panel on every page that builds ships: the game, the postcard viewer and `?model-viewer=ship`. `buildShipMesh("freighter", "b")` clones the template and throws if it is not installed, rather than drawing a stand-in. A bun preload (`bunfig.toml`, `tests/setup/authored-hulls.ts`) installs the shipped file for the headless tier, so every envelope, collision, vent and muzzle row measures this model.
- **Frame.** One model metre is 0.001 hull km. The model is turned half a turn about Y into the game's nose −Z frame. **Turned, not mirrored, so the three cassettes are to port.** This README and `build_model.py` call +X starboard, but with the nose at +Z glTF's +X is the ship's left. `evidence/hero.png` and `target.png` both show the cassettes on the pilot's left. The approved geometry ships as approved; a mirror is a one-line change if the principal prefers starboard.
- **Hull row.** The box is 67.2 × 42.4 × 14.7 m, a third smaller by volume than the procedural Porter's 69.7 × 46.3 × 19.7 m, and it still fits every berth role. So the freighter's row is re-derived, not retuned:
  - mass at the role's 2.20 t per 1,000 m³: 140 → 92 t;
  - thrust scaled to keep the acceleration: 168 → 110.4 MN;
  - integrity by its law: 166 → 129, so time on target falls from 45 s to 39 s;
  - vent placement re-measured and shares re-solved;
  - docking ceiling: 6.5 rpm against a 6.9 rpm roll cap.
  Hold (60 t) and price are unchanged.
- **Ceiling.** `HULL_CEILING_HOLD_T` is derived from the densest hold, and on this box that gives 299 t, which would price the dreadnought and the voyager. It stays 197 t on a recorded reference (`CEILING_REFERENCE`, `economy-trade.md` §7.2). `tests/hull.test.ts` holds the 299 t live figure as a tripwire. **Adopting it is the principal's call.**
- **Drive glow.** The model was approved without one. The game's drive glow (the procedural disc's material) is seated in its six nozzles, because the main drive's plumes are drawn there.
- **Not carried over.**
  - The hull finishes (the model has its own materials).
  - Generated machinery, rails and windows (the model has its own).
  - The derelict tear: a freighter wreck is darkened but whole, because the tear cuts procedural lofts and the model has none. The derelict rows hold that gap explicitly.
- **Cockpit fit.** The game hides the player's hull in cockpit view and draws the shared courier cabin, so the Porter's own bridge is never seen from inside.
- **Performance, no LOD.** `node spikes/porter-hull/capture-game.mjs <label>` boots a no-save game flying the Porter on a hardware renderer, captures chase frames and prices four Porters in view against four procedural Derricks (`freighter/a`) on the same frame.
  - On ANGLE Metal / Apple M1 Pro, at a machine load average of 10 to 15 from other sessions, three runs read four Porters at +0.28 to +0.70 ms over the bare frame and four Derricks at +0.43 to +0.54 ms.
  - That is with 1.45 M more triangles drawn for the Porters, so triangle count is not what this renderer pays for here.
  - Only deltas are meaningful: the timing is a serialised tight loop, not the player's cadence. `evidence/game-report.json` is the third run.
  - The figures are open-space only. In a bay the shadow pass draws the model a second time, and no LOD was built against that.
- **Evidence.** `evidence/game-*.png` are that run's frames.

### Proposed Field Notes copy (for the principal's approval)

> Porter freighters are rebuilt: three removable freight cassettes clamped beside an armoured command keel, with service lights between them.

Not yet in `src/changelog.ts`: it lands there once approved.
