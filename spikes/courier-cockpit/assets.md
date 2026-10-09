# Asset provenance and prompts

All cockpit geometry was authored locally with Blender by `build_model.py`. No downloaded third-party model was used. FAL credentials were absent; Blender was explicitly permitted. The principal waived prior procedural-only asset constraints for this study.

The current courier A hull is built from the repository's `src/ship-mesh.ts`; it was inspected from hero/top views before target selection. The viewer's station is the game's own default Coriolis, `src/models/coriolis.glb`, served under a content-hashed name (#834) from #791. It supplies context only; the viewer ships no copy of it.

All images below were produced with the built-in imagegen tool in this conversation. Film/game names informed industrial materials and atmosphere, not extracted assets.

## Selected target

`target.png` combines the principal-selected O9 architecture and O8 details. Inputs were `O9-courier-flight-deck.png` and `O8-courier-retrofit.png` under the primary checkout's `.dream-loop/cockpit-codex/`.

Prompt: Use O9 as the locked composition and architecture: low dashboard height, shallow tapering courier canopy, thin perimeter supports, clear center sightline, pilot eye position, visible pointed blue-grey foredeck, smaller industrial Coriolis outside. Adopt O8 only for equipment details: two compact cyan instrument modules arranged vertically at or below the existing dashboard top, tactile keypad under the amber target screen, guarded toggle switches, dark teal worn metal housings, attached black ribbed conduits and braided cable channels. Keep central circular amber scanner size and place. No giant stack or raised dashboard/roof beam. Physically coherent in-engine screenshot, 16:10, worn steel and charcoal/blue-grey materials, warm under-console lamps, restrained cyan bounce. No people, captions, logos or new foredeck domes.

## Generated wear texture

`steel-wear.png`: square seamless PBR base-color of charcoal gunmetal blue-grey painted steel; 85% intact paint, 10% fine wear/scratches, 5% oily discoloration, subtle directional brushed grain. Flat unlit albedo, no panels, rivets, labels, perspective or baked lighting; metal rather than stone or concrete.

The Blender file packs this image. The GLB exporter omits the multiply node's tint, so the viewer explicitly restores the named material palette. The viewer uses the same albedo as a low-strength bump map; this is a prototype material, not a measured PBR texture set.

## Generated distant sky

`starfield.png`: wide 2:1 very dark blue-black space, fine naturally distributed white/warm stars, extremely faint dusty Milky Way on the upper right, subtle desaturated dust; no planets, ships, sun, horizon or bright nebula.

It is drawn on a distant plane behind the three-dimensional station, not used as a replacement for geometry. Sky and station are hidden in inspection views. Orbit views inspect the actual cockpit mesh, not a projection of the target image.
