# Interior Dream Loop — Codex

Reference: [node #205](https://github.com/jcfischer/seelite/issues/205). This is a standalone design workbench, not production integration or node closure.

The principal approved four styles and their four-face berth revisions, then authorized implementation and modular fittings. All bay dimensions, berth placements, ship orientation and the central clear lane come from the existing game catalogue. The six fitting types are authored in Blender and placed deterministically by station identity.

## Independent visual reviews

| Round | Civic | Works | Frontier | Survey | Main result |
|---|---:|---:|---:|---:|---|
| 1 | 3.0 | 2.8 | 2.9 | 3.0 | Flat lighting, thin structure, poor portal, pervasive grime; command camera broken |
| 2 | 4.4 | 4.3 | 4.1 | 4.5 | Portal and camera repaired, readable berth numbers; lighting and material hierarchy still weak |
| 3 | 5.7 | 5.6 | 5.1 | 5.8 | Broader service bands, deeper ribs, cleaner paint, cast shadows and a deliberate portal; local lighting and structural volume remain below target |
| 4 | 6.0 | 5.9 | 5.4 | 6.1 | Fixture-driven light, deeper ribs and antialiasing; construction detail still insufficient |
| 5 | 6.4 | 6.5 | 6.0 | 6.6 | Four functional service racks, chamfered structural joints, raised shoulder spans and berth equipment |

Fresh independent judges compared each approved target against current and previous live captures. Their scores explicitly exclude unavoidable differences imposed by the authoritative bay dimensions and unchanged game ship meshes. No review reached the Dream Loop 8/10 exit criterion.

After round 6 introduced distributed area lighting, maintenance panel families and a segmented portal, the principal explicitly accepted the current result: **“Looking really good. you can stop loop”** (2026-10-09). This ends the visual loop by principal instruction, not by an invented independent score. The same message reported back-wall flicker; the remaining work is that defect only.

Round 2 initially exposed two invalid capture states: an older Vite transform and then a missing scene-color pass before ambient occlusion. Neither was judged. The capture now checks a source build identifier and rejects blank scene frames. The dev server runs with file polling because the nested worktree did not reliably receive native file notifications.

## Verification to date

- Headless layout and exported module-envelope tests: 4 pass, 0 fail; 433,989 assertions over the theme/role/seed spread.
- Strict viewer TypeScript check passes.
- Hardware browser: ANGLE Metal, Apple M1 Pro, 1584 × 992 pixels.
- Round 3: 60 FPS across all four themes, approximately 4.65–5.05 million rendered triangles across color and ambient-occlusion passes.
- Round 4 balanced lighting: 55–59 FPS across all four themes. Four shadowed mounted floods and two mouth lights replace the global directional key. Shadow atlases update only when assembly/visibility changes.
- All themes captured in axial, command, loading, gangway and kit views. Three Civic seeds captured from the same arrival camera.
- Public-control checks passed: trade/shipyard switch, changed fitting layout on Next station, fitting/ship/clearance toggles, target dialog, PNG download and orbit drag. No page errors.

Canonical PR probe selection returned six affected probes in semantic mode: cabin-pass, model-viewer, pointer-lock, station-mouth, station-visuals and station. This is selection evidence only; the selected canonical suite has not yet been run. The standalone workbench capture does not establish production integration.

Temporary raw captures and metrics are under `.dream-loop/`. Latest judged round is `round5-clear`; accepted appearance is `round6`. Current 205-seed assemblies contain 95–103 fittings, including the four theme-specific service racks. Expanded layout/export checks pass 1,550,883 assertions. Round 6 measured 38–47 FPS at the capture's 1584 × 992 resolution; this does not establish Retina Safari performance.

## Back-wall flicker

The exact symptom was reproduced in WebKit/Apple GPU at Retina resolution with a slight orbit offset. It remains with ambient occlusion disabled. The 0.3 m camera near plane loses sufficient depth precision for centimetre-separated wall layers at the far end of the 405 m bay. Changing it to 3 m removes the reproduced depth-ordering artifact without changing geometry or materials.

`probe-flicker.mjs` compares the same composition at three slight orbit angles against a higher-precision near-plane reference. Its `--prove-baseline` mode restores the old near plane and demonstrably fails: 7,194 / 3,204 / 1,581 falsely darkened wall samples. The probe also captures command, loading, gangway and kit close-ups. It uses the shared browser lock and verifies the served worktree.

With the 3 m near plane, all three WebKit regression views pass: 6 / 5 / 9 darkened samples out of 191,160 per view, below the 0.1% threshold. Command, loading, gangway and module-library captures were visually inspected without a new clipping regression. The strict viewer TypeScript check also passes. The visual loop remains stopped at the principal's accepted appearance.
