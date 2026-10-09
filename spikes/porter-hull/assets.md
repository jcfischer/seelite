# Porter prototype asset provenance — Codex

Original Blender geometry, authored in `build_model.py`. No downloaded third-party model. Fal credentials were absent from the process and named entries in ~/.env; Blender was the available Dream Loop Pro fallback. This prototype follows the authorized Courier and Coriolis redesign workflow; node #813 ships the encoded model as `public/models/porter.glb`; the source GLB, Blender file and textures here stay review-only.

The principal selected O2 from three built-in imagegen designs. The target was grounded in a live capture of current Porter B and the selected Courier O4 exterior as a material-style reference. `target.png` retains that selection.

Two built-in imagegen texture outputs are reused from the Courier study: `steel-wear.png` and `steel-wear-coarse.png` (Courier `steel-wear-v2.png`). The coarse image is restricted to two paint material variants and a smaller tile scale. Mesh geometry supplies panel boundaries, bolts and hardware. The viewer uses fine color texture as subtle bump, not as a physically measured normal/roughness set; roughness is authored separately.

## Active fine wear

`steel-wear.png`

+Generate one square seamless 2048px PBR base-color texture of worn pale grey enamel painted spacecraft steel. Flat uniform orthographic unlit material scan, no perspective, no objects. Broad intact neutral pale grey paint with fine scratches, small irregular dark exposed metal chips and localized subtle grey grime, tiny sparse rust traces. Rich tactile used industrial material from a working spaceship. 85% intact grey paint, 10% fine scuffing, 5% small dark chips. No panel seams, rivets, text, symbols, border, gradients, large rust clouds, concrete grain, stone mottling, baked lighting, specular highlights or shadows. Geometry will provide panel edges and bolts; this image supplies only fine surface wear.

## Coarse wear reused selectively on Porter

`steel-wear-v2.png`

The independent review found this broad dark damage too mottled. The model returned to `steel-wear.png`, retaining geometry-based chips and fasteners.

+Create a square seamless PBR diffuse albedo material scan, flat and evenly unlit, of heavily used industrial spaceship painted steel. Neutral pale grey paint covers 70 percent, dark charcoal bare-metal irregular chips and abrasions cover 20 percent, soft localized grey greasy smudges cover 10 percent. Strong readable scratches and clustered paint chips in varied sizes, several broad rubbed patches, most paint regions remain clean and smooth. Mix scratches with chunks of exposed metal 10-30 pixels across in a 1254px image; do not make everything microscopic speckle. A working ship's repaired, decades-old metal skin. No directional illumination, no shiny highlights, shadows, perspective, objects, panel seams, rivets, bolts, raised shapes, borders, text, colored rust clouds, stone or concrete texture. This is a tileable neutral material; 3D geometry supplies panels, bolts and wear at edges.


