# O4 visual refinement pass 15 — Codex

User requested one more pass after accepting the real cockpit fit. Compared unchanged target.png against prior evidence/cockpit-fit/hero.png and final hero.png.

Independent judge: courier_o4_pass_judge, fresh context. Initial 6.2/10: composition 2.5, lighting 1.6, materials 1.6, details 0.5. Final 7.0/10: composition 2.5, lighting 1.9, materials 1.9, details 0.7.

Changes: mounted segmented dorsal service ducts clear of the access covers; slope-following guarded deck lamps; side rail lamps; stronger blue-grey and pale steel separation with paint roughness variation; neutral key and restrained fill; sparse brighter star tier. First candidate was too evenly lit, corrected in final pass.

Judge confirmed visible support feet connect ducts to hull, hatches follow local slopes, cockpit/pilot remain visible. Remaining gaps: target has richer stepped armor and irregular machinery; ducts are repetitive with conspicuous black end caps; near-side pale strip remains strong; lamps lean cream, and starfield remains sparse versus target. Stopped at the requested bounded pass.

Verification: two exported-model tests, 3705 assertions, pass; strict viewer TypeScript and Biome pass. Hardware browser capture uses Apple M1 Pro via ANGLE Metal, no page errors, all existing controls pass. Observed cadence 50.94 FPS is a short capture, not a production benchmark. Geometry 339,938 triangles across 35 meshes, +5,496 triangles; unchanged overall bounds. Previous cockpit envelope and closed-shell regression checks remain green. No production integration performed.
