# Discovery exterior study

Authored by Codex for the Dream Loop redesign request of 2026-10-08. Refs #809.

Preserves Voyager A's Discovery One homage: spherical command section, long segmented service spine, dish and compact aft propulsion. The target derives from the live current Voyager and the ongoing Porter O2 industrial treatment. This standalone study does not replace the production ship. <!-- glossary-ignore: Command -->

Final independent score: **7.98/10**. Principal accepted the appearance and requested a PR handoff; see `HANDOFF-codex.md`.

## Review

From this worktree, run `npm run dev -- --config spikes/discovery/vite.config.ts --port 5189 --strictPort`, then open:

`http://localhost:5189/spikes/discovery/`

Drag to orbit; wheel to zoom; right drag to pan. Presets show front, rear, top, underside and command detail. Target opens the generated design image; Work lights reveals shadowed geometry; Save image exports the rendered canvas. <!-- glossary-ignore: Command -->

- `discovery.blend`: editable Blender source.
- `discovery.glb`: embedded-texture model used by the viewer.
- `build_model.py`: deterministic authoring script, executed through Blender.
- `assets.md`: texture and target provenance.
- `evidence/review.md`: independent image comparison history.

Rebuild with `/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/discovery/build_model.py`. The study config uses a separate dependency cache and file polling so concurrent worktrees do not overwrite its prebundle cache. The capture uses the repository's hardware renderer assertion and shared probe lock.

## Verification boundary

`bun test spikes/discovery/model.test.ts` verifies self-contained textures, finite accessor bounds, and the elongated form. The viewer is independently typechecked. `node spikes/discovery/capture.mjs <label>` captures six views and verifies orbit, presets, target dialog, work lights, rotation and PNG export. Captures go to ignored `.dream-loop/<label>`; selected review captures and runtime metrics are retained in `evidence/`.

Current model: approximately 542k triangles, 18 meshes, embedded textures. Hardware captures on Apple M1 Pro run at about 59 FPS with no page errors. Model integrity tests (2 tests, 118 assertions), standalone viewer typecheck and all interaction checks pass. These measurements apply to the isolated viewer.

No full production browser suite, production integration or principal visual acceptance is claimed. Production adoption needs the authoritative hull envelope, collision/berth fit, cockpit fit, LOD/texture budget and live-game performance reviewed separately.

## Production (node #820)

The accepted export is integrated as the voyager's selected variant:
`node spikes/discovery/prepare-flight-asset.mjs` turns the nose from +X onto +Z
and writes `src/models/discovery-voyager.glb` losslessly; `src/voyager-hull.ts`
draws it. `node spikes/discovery/capture-game.mjs` captures it in the game on
the GPU lane (`evidence/game-*.png`). See
`docs/receipts/node-820-discovery-integration.md` for the contract, the
decisions and the measurements. The study's own files above are unchanged.
