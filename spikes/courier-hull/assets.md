# Asset provenance — Codex

Original mesh authored in Blender with `build_model.py`; no downloaded third-party model. Fal credentials were absent from the process and named entries in the local environment file. Blender authoring follows the Dream Loop Pro asset fallback and the principal's instruction to build as in the previous studies.

The selected O4 target was generated from O3 Needlewing (hull geometry) and O2 Dockhand (industrial details). Those designs were grounded in the existing courier A screenshots and the selected O9/O8 cockpit and weathered Coriolis prompts from PR 793 and PR 791. The exact selected O4 prompt is preserved below.

Authored textures use the built-in image_gen tool. Actual outputs are 1254 × 1254 pixels. They provide surface wear, not baked shading or panel geometry. Material tints, metalness and roughness are authored separately; the GLB carries the tints explicitly because the exporter does not preserve the Multiply node's constant factor. The viewer uses the albedo as a subtle bump map; this is not a scanned PBR texture set.

## Active fine wear

`steel-wear.png`

+Generate one square seamless 2048px PBR base-color texture of worn pale grey enamel painted spacecraft steel. Flat uniform orthographic unlit material scan, no perspective, no objects. Broad intact neutral pale grey paint with fine scratches, small irregular dark exposed metal chips and localized subtle grey grime, tiny sparse rust traces. Rich tactile used industrial material from a working spaceship. 85% intact grey paint, 10% fine scuffing, 5% small dark chips. No panel seams, rivets, text, symbols, border, gradients, large rust clouds, concrete grain, stone mottling, baked lighting, specular highlights or shadows. Geometry will provide panel edges and bolts; this image supplies only fine surface wear.

## Strong wear experiment, unused after visual review

`steel-wear-v2.png`

The independent review found this broad dark damage too mottled. The model returned to `steel-wear.png`, retaining geometry-based chips and fasteners.

+Create a square seamless PBR diffuse albedo material scan, flat and evenly unlit, of heavily used industrial spaceship painted steel. Neutral pale grey paint covers 70 percent, dark charcoal bare-metal irregular chips and abrasions cover 20 percent, soft localized grey greasy smudges cover 10 percent. Strong readable scratches and clustered paint chips in varied sizes, several broad rubbed patches, most paint regions remain clean and smooth. Mix scratches with chunks of exposed metal 10-30 pixels across in a 1254px image; do not make everything microscopic speckle. A working ship's repaired, decades-old metal skin. No directional illumination, no shiny highlights, shadows, perspective, objects, panel seams, rivets, bolts, raised shapes, borders, text, colored rust clouds, stone or concrete texture. This is a tileable neutral material; 3D geometry supplies panels, bolts and wear at edges.


## Selected O4 target prompt

Create one new 16:10 high-fidelity realistic in-engine exterior screenshot of the Seelite courier by combining these two reference images. Image 1 (O3 Needlewing) LOCKS THE MAJOR GEOMETRY: long sharply tapered prow, low elongated raked dark teal cockpit canopy, broad low swept cargo shoulders, two aft lateral chamfered engine nacelles, open recessed mechanical channels between body and nacelles. Preserve these proportions, engine positions, low roofline and long nose. Image 2 (O2 Dockhand) supplies INDUSTRIAL DETAIL AND MATERIAL CONSTRUCTION: bolted layered replaceable armour, maintenance cassettes, cargo access doors, chunky locking hardware, protective rails, ribbed service conduits, vented heat exchangers, chipped painted metal, localized dirt in seams and restrained amber work lamps. Do not import image 2's blunt nose, taller cabin, or boxier overall silhouette. The goal is O3's elegant hull with O2's hardworking utilitarian construction, a believable working courier rather than a fighter. Keep human-scale cockpit instruments dim cyan and amber behind transparent glass; tiny fasteners and service hatches communicate ship scale. Engine front faces are dark protective radiator/vent grilles, exhaust is rearward. Industrial detail must attach plausibly, stay concentrated around joints and machinery, leaving readable broad hull panels. Worn desaturated blue-grey, some pale steel replacement armour, dark graphite machinery, very sparse faded orange service markings. Physically coherent PBR painted steel with edge wear and directional grime, no stone mottling. Sparse black starfield. Same front three-quarter camera as reference 1, slightly above, prow pointing lower right; whole vessel fills about 85 percent of frame with margin, both nacelles visible. Soft neutral upper-left key light, cool shadow fill revealing detail, warm small practicals. Crisp achievable 3D game target rendering, no painting, no cinematic haze, no excessive bloom, no blur. No text captions, labels, borders, watermark, humans, planet or station. One ship only. O4 BALANCED HYBRID: Precise synthesis with subtle layered armour lips, recessed rectangular cargo hatches on the swept shoulders behind cockpit, visible hinge pins and latch handles. Retain O3's mostly blue-grey dorsal plating. Add O2's pale replacement engine cover panels, segmented ribbed conduit bundles, recessed warm service lamps, and compact black protective rails around engine-root machinery. Preserve the uninterrupted elegant taper of the foredeck. Moderate hardware density, strong clear silhouette and calm large surfaces.

## Adapted real courier cockpit

`source/courier-cockpit.blend` is a preserved copy of the courier cockpit study from `seelite-792/spikes/courier-cockpit/`, taken at worktree head `d0848ad3e978a116324307433b9acfe4cc6ff222` (PR 793 lineage). SHA-256: `3e588c7d62395f6c1e84287a81379af7346c0b9a8faa0b32ac34608a5d410a7a`. The source is unchanged.

`adapt_cockpit.py` retains the original seat, dashboard, four screen faces, console housings, switches and materials. It removes the original surrounding canopy/floor, label quads and micro-detail, preserving complete mesh components and UVs. The selected source geometry goes from 36,876 to 13,690 triangles (about 63% reduction). It rotates from cockpit -Z forward to hull +Z forward, narrows equipment to fit the canopy, and aligns the original chair with the seated pilot. `cockpit-adaptation.json` records rebuild results.

`cockpit-instruments.ts` preserves the source viewer's static four-screen fixture renderer. Screen content is applied by the viewer; it is not baked into the exported GLB and is not live game state. The original cockpit wear texture remains packed in the exported model.
