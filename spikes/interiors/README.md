# Modular station interiors — Codex

Refs [Give the bay a surface and a light (#205)](https://github.com/jcfischer/seelite/issues/205).

Four approved styles: Civic Exchange, Heavy Works, Frontier Anchorage and Survey Institute. The principal approved the initial styles, requested four-face parking, accepted the revised previews, then authorized Dream Loop implementation and modular fittings on 2026-10-09.

The principal accepted the implemented appearance and stopped the visual loop on 2026-10-09. See `evidence/dream-loop-codex.md` for the independent scores, acceptance and back-wall flicker verification.

## Scope

An editable Blender module library and interactive assembly workbench. It imports the current game berth catalogue and uses metres throughout. It constructs no Game, changes no save and is not a production renderer replacement. Integration remains subject to the visual result and the repository delivery gates; node #205 remains open.

Run `npm run dev -- --host 127.0.0.1 --port 5205 --strictPort`; open `/spikes/interiors/`. Theme buttons retain the camera; station seed rearranges fittings. Trade and shipyard select their real eight- and six-berth catalogues. Orbit, zoom, pan, axial/arrival views, fitting closeups, module library, clearance overlays, target comparison and PNG export are provided.

## Geometry contract

`layout.ts` reads `stationInterior()` rather than copying its bay dimensions. Current trade/shipyard bays measure 280 × 230 × 405 m; the permanent axial corridor is 120 × 70 m. Every bay ship points toward the aperture. Its local up follows the berth inward normal. Modules use local +Y away from their mounting surface and +Z along the bay axis. Floor/port/overhead/starboard instances rotate the complete fitting about Z. No new berth or capacity is introduced.

Role and style are independent: any of the four finishes can assemble over either enclosed layout. The existing refinery/outpost presentations remain open decks. An enclosed hangar theme does not turn those into enclosed bays; their deck adaptation is separate work.

## Fitting library

- Command gallery: elevated enclosed control room, panoramic framed glazing, instrument consoles, roof services and access hatch.
- Loading dock: ribbed cargo cassettes, retractable roller-transfer frontage and lifting gantry.
- Gangway: repeatable 100 m perimeter segment, grated surface, handrails, lamps and attachment brackets.
- Utility cassette: removable heat exchangers, pumps and pipe runs.
- Maintenance crane: retracted articulated twin service arms and travelling bridge.
- Airlock: framed access compartment and service connections.
- Shared shell kit: plated wall tile, structural rib, pipe/light trunk and full berth platform.
- Service racks: Civic ventilation cabinets, Works pressure vessels, Frontier repair harnesses and Survey instrument banks.
- Wall families: large plates, maintenance hatches, vents, fastened repairs and reinforced panels.

These are visual station facilities, not on-foot gameplay or new cargo mechanics. Station identity changes the command face, equipment bank sides and utility positions deterministically. Themes select distinct equipment combinations. The central lane and all reserved ship envelopes stay free. Clearances use conservative fitting envelopes, with 0.3 m allowed behind the mounting plane for seated panels.

## Authoring and provenance

`build_kit.py` creates each module in Blender; `modules/*.blend` preserves editable source and packed texture, `modules/*.glb` contains the runtime model and references one shared same-origin paint texture. `geometry.py` is adapted from the approved nine-station study in PR #826, itself developed from the shipyard/Coriolis toolchain. `industrial-surface.png` is the existing generated station paint texture, reused unchanged. No external models downloaded. These exact repetitive mounting interfaces are better authored in Blender than inferred through image-to-3D.

`targets/` preserves the four approved imagegen previews and the geometry correction prompt. Existing game courier geometry illustrates occupied berths at actual metre scale, facing the aperture.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/interiors/build_kit.py
node spikes/interiors/share-texture.mjs
bun test spikes/interiors/layout.test.ts spikes/interiors/assets.test.ts
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable spikes/interiors/viewer.ts
SEELITE_PROBE_RENDERER=hardware node spikes/interiors/capture.mjs round1
```

The capture checks the served tree and uses the shared Seelite browser lock. Generated captures and loop evidence live under `.dream-loop/` during iteration. Scores and final measured performance must be read from the evidence, not inferred from these instructions.
