# Flagship refinement — Codex

User requested another visual round after accepting pass 15. Original O4 target remains unchanged. Independent fresh-context judge: flagship_visual_judge.

Initial pass 15: 7.0/10. Candidate 16 with service assemblies and minor lighting changes: 7.1/10. Review identified material depth as the larger problem. Candidate 17 changed the lighting arrangement to a broad warm rectangular source with reduced ambient/fill and adjusted paint response: 7.3/10, but canopy reflection crossed the pilot. Final 19 lowers glass metalness, raises roughness and exports KHR_materials_specular factor 0.16. Final score remains 7.3/10: composition 2.5, lighting 2.0, materials 2.0, details 0.8.

Final judge: cockpit readability restored; pilot, harness and controls visible; warm reflection sufficiently subdued; interior displays legible. No concrete visible regression to silhouette or seated fittings. Target still has richer material response and more complex large-scale surface organization. Stopped at the requested bounded pass.

Geometry: dark deck-seated trays, rounded pipe terminations, smaller elbow returns to deck sockets, guarded valves, supported nacelle vent rails. Brushed longitudinal nose rail replaces the bright alloy there. Warmer amber lamps, subtler pilot helmet and cockpit illumination, broad warm hull reflections, sparse soft star highlights. Existing hull closure, cockpit fit, raised hatches and angled grilles retained.

Verification: two exported-model tests / 3705 assertions pass after geometry and glass roughness changes; final specular-only export preserves geometry. Strict viewer TypeScript, Biome and git diff whitespace checks pass. Final hardware capture uses Apple M1 Pro via ANGLE Metal; no page errors; orbit, all presets, target dialog, lights, rotation and PNG export pass.

Final model 353,954 triangles / 36 meshes, +14,016 triangles from pass15. Same hull bounds. Short capture cadence 43.37 FPS versus about 51 in pass15; these separate runs are not a controlled performance comparison or production benchmark. No production integration or deployment.
