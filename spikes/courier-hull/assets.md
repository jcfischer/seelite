# Asset provenance — Codex

Original mesh authored in Blender with `build_model.py`; no downloaded third-party model. Fal credentials were absent from the process and named entries in the local environment file. Blender authoring follows the Dream Loop Pro asset fallback and the principal's instruction to build as in the previous studies.

The selected O4 target was generated from O3 Needlewing (hull geometry) and O2 Dockhand (industrial details). Those designs were grounded in the existing courier A screenshots and the selected O9/O8 cockpit and weathered Coriolis prompts from PR 793 and PR 791. Exact O4 prompt is retained in the primary checkout `.dream-loop/courier-hull-codex/hybrid-prompts.md`.

Authored textures use the built-in image_gen tool. Actual outputs are 1254 × 1254 pixels. They provide surface wear, not baked shading or panel geometry. Material tints, metalness and roughness are authored separately; the GLB carries the tints explicitly because the exporter does not preserve the Multiply node's constant factor. The viewer uses the albedo as a subtle bump map; this is not a scanned PBR texture set.

## Active fine wear

`steel-wear.png`

+Generate one square seamless 2048px PBR base-color texture of worn pale grey enamel painted spacecraft steel. Flat uniform orthographic unlit material scan, no perspective, no objects. Broad intact neutral pale grey paint with fine scratches, small irregular dark exposed metal chips and localized subtle grey grime, tiny sparse rust traces. Rich tactile used industrial material from a working spaceship. 85% intact grey paint, 10% fine scuffing, 5% small dark chips. No panel seams, rivets, text, symbols, border, gradients, large rust clouds, concrete grain, stone mottling, baked lighting, specular highlights or shadows. Geometry will provide panel edges and bolts; this image supplies only fine surface wear.

## Strong wear experiment, unused after visual review

`steel-wear-v2.png`

The independent review found this broad dark damage too mottled. The model returned to `steel-wear.png`, retaining geometry-based chips and fasteners.

+Create a square seamless PBR diffuse albedo material scan, flat and evenly unlit, of heavily used industrial spaceship painted steel. Neutral pale grey paint covers 70 percent, dark charcoal bare-metal irregular chips and abrasions cover 20 percent, soft localized grey greasy smudges cover 10 percent. Strong readable scratches and clustered paint chips in varied sizes, several broad rubbed patches, most paint regions remain clean and smooth. Mix scratches with chunks of exposed metal 10-30 pixels across in a 1254px image; do not make everything microscopic speckle. A working ship's repaired, decades-old metal skin. No directional illumination, no shiny highlights, shadows, perspective, objects, panel seams, rivets, bolts, raised shapes, borders, text, colored rust clouds, stone or concrete texture. This is a tileable neutral material; 3D geometry supplies panels, bolts and wear at edges.
