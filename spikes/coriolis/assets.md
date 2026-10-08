# Asset provenance

All mesh geometry was authored locally in Blender by the accompanying script. No extracted film/game models or downloaded third-party assets were used. Blade Runner, Alien and Elite Dangerous guided industrial scale, weathered utilitarian finishes, warm docking lights and the familiar Coriolis silhouette.

Generated reference: `.dream-loop/target.png`, created with the built-in image generation tool from the existing station screenshot. Prompt direction: a real in-engine rendering retaining the cuboctahedral station and open rectangular dock, dense recessed machinery, riveted dark girders, weathered pale steel, service gantries, warm recessed docking lights, sparse stars and a detailed industrial appearance informed by the three requested works.

Generated material: `public/spikes/coriolis/industrial-surface.png`, created with the same tool using the target as reference. Prompt direction: square 2048px seamless, uniform unlit albedo of weathered painted industrial steel; approximately 65% off-white paint, 25% grey dirt, 10% chips and rust, no panel seams, text, borders or baked lighting. Different material tints, metalness and roughness are authored in Blender; the viewer also uses the albedo as a subtle bump map. This is a prototype material, not a complete scanned PBR set.

The `.blend` packs the texture and the GLB embeds it. The standalone PNG is retained as editable source.
