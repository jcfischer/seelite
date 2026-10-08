# Asset provenance

All mesh geometry was authored locally in Blender by the accompanying script. No extracted film/game models or downloaded third-party assets were used. Blade Runner, Alien and Elite Dangerous guided industrial scale, weathered utilitarian finishes, warm docking lights and the familiar Coriolis silhouette.

Generated reference: `.dream-loop/target.png`, created with the built-in image generation tool from the existing station screenshot. Prompt direction: a real in-engine rendering retaining the cuboctahedral station and open rectangular dock, dense recessed machinery, riveted dark girders, weathered pale steel, service gantries, warm recessed docking lights, sparse stars and a detailed industrial appearance informed by the three requested works.

Generated material: `spikes/coriolis/industrial-surface.png`, created with the same tool using the target as reference. Prompt direction: square 2048px seamless, uniform unlit albedo of weathered painted industrial steel; approximately 65% off-white paint, 25% grey dirt, 10% chips and rust, no panel seams, text, borders or baked lighting. Different material tints, metalness and roughness are authored in Blender; the viewer also uses the albedo as a subtle bump map. This is a prototype material, not a complete scanned PBR set.

The `.blend` packs the texture and the GLB embeds it. The standalone PNG is retained as editable source.

## Round 6 paint refinement

The image generation tool produced `spikes/coriolis/paint-surface-v2.png` for the painted armour only. Original industrial texture remains on exposed hardware. Final prompt:

> Generate a square 2048x2048 seamless tiling PBR base-color texture for aged off-white enamel-painted spaceship steel. Pure uniform diffuse albedo, flat front-on scan, no lighting, no reflections, no objects. 90% intact smooth pale warm grey paint, 7% very subtle grey smudges and sparse hairline scratches, 3% tiny dark exposed-metal chips. Overall clean readable broad paint regions, restrained industrial wear. A few fine vertical runoff traces, not brown all-over speckle. Absolutely no stone, concrete, grain, clouds, heavy mottling, rust islands, panel lines, seams, rivets, text, borders, shadows or baked highlights. This is the generic paint microtexture; geometry will supply panel edges and bolts.

The tool returned a 1254px square image. The asset is used at its native resolution. Chips and fastener plates at panel edges are authored geometry; the material's roughness is reduced from 0.66 to 0.44 for a painted-metal response.

The principal preferred the earlier grit. The active model now restores the original `industrial-surface.png` and original armour metalness/roughness (0.45/0.66), retaining the round-6 geometry. `paint-surface-v2.png` is an unused experiment retained for provenance.
