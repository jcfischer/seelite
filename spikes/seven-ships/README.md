# Seven exterior studies — Codex

Refs jcfischer/seelite#827. The principal approved seven generated design targets
on 2026-10-09, including the enlarged Pilgrim ring. These are isolated editable
studies. They do not replace the game's hulls.

Run `npm run dev -- --host 127.0.0.1 --port 5227 --strictPort` in this worktree.
Open `/spikes/seven-ships/` and select a ship. Drag to orbit, wheel to zoom,
right-drag to pan. Presets, inspection lights, model rotation, target comparison
and PNG export use the approved Porter study's viewer pipeline. Pilgrim has a
**Habitat · 3 RPM** control; both capitals use **Habitat · 2.5 RPM**. Bastion offers
a **Bay interior** preset. H hides controls.

| Code | Role | Name |
|---|---|---|
| F1 | interceptor | Lance |
| F2 | patrol | Warden |
| F3 | explorer | Pilgrim |
| F4 | raider | Shiv |
| F5 | carrier | Bastion |
| F6 | prospector | Sluice |
| F7 | dreadnought | Rampart |

## Editable source

- `build_model.py`: seven distinct ship assemblies, metres, Y up, +Z forward.
- `geometry.py`: shared textured mesh authoring, derived from the Porter study.
- `<role>/model.blend`: packed editable Blender scene with material batches.
- `<role>/model.glb`: self-contained textured export.
- `<role>/target.png`: principal-approved generated target, not a live screenshot.
- `<role>/model-report.json`: measured exported bounds, triangles and asset size.
- `approved-brief.json`: target provenance and the Pilgrim dimension decision.

Build one role with:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python spikes/seven-ships/build_model.py -- explorer
bun test spikes/seven-ships/model.test.ts
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable spikes/seven-ships/viewer.ts
node spikes/seven-ships/capture.mjs round-N
```

`--python-exit-code 1` is necessary: Blender otherwise exits successfully after
a script exception and leaves the previous GLB in place. Restart Vite after
viewer edits in this nested worktree; its watcher has served stale transformed
source. Capture asserts the served worktree, holds the shared probe lock and
rejects software rendering. Run captures after model exports have completed.

## Pilgrim

The design floor radius is 40 m. At 3 RPM, `(2π × 3 / 60)² × 40 / 9.80665`
gives **0.40257 g**. This is rotational acceleration at the floor during steady
rotation; it does not model flight thrust, crew adaptation or long-term health.
The ring and spokes rotate together around the stationary longitudinal keel.
The GLB preserves the `habitat-rotor` assembly and its dimension/rate metadata.
The scene contains an exterior shell, not a walkable interior.

## Integration boundary

Production adoption must decide LOD/asset budgets, metre-to-kilometre conversion,
authoritative dimensions, collision and docking fit, cockpit compatibility,
traffic instancing and live-game performance. Pilgrim's larger ring specifically
changes its envelope; no production hull numbers have been modified here.
Other study dimensions also differ from the current game. Capture FPS measures
an isolated inspection scene and is not a production flight benchmark.

Visual improvement was reopened by the principal. Current independent scores
are 4.25–5.65/10, below the 8/10 gate. The new capital ring targets were approved,
but no current built-model quality acceptance is asserted. See STATUS.md.
See HANDOFF-codex.md for production work and review evidence.
