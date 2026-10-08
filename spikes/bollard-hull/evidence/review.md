# Dream Loop review — Codex

Target: `../target.png`, principal-selected O4. User requested independent visual fidelity of 7/10. Scores compare actual GPU browser captures to the generated image; they are not principal visual acceptance.

| Round | Composition /3 | Lighting /3 | Materials /3 | Details /1 | Total /10 |
|---|---:|---:|---:|---:|---:|
| 1 | 2.1 | 1.1 | 1.6 | 0.5 | 5.3 |
| 2 | 2.1 | 1.6 | 1.8 | 0.6 | 6.1 |
| 3 | 2.4 | 1.7 | 2.0 | 0.6 | 6.7 |
| 4 | 2.5 | 1.7 | 2.0 | 0.7 | 6.9 |
| 5 | 2.5 | 1.9 | 2.0 | 0.7 | **7.1** |

Round 1 independent judge: recognizable engines, cabin, winch and collar, but under-framed, dim, matte and sparse. Requested thicker cockpit/collar framing, richer machinery, stronger highlights and less repetitive panel wear.

Round 2 independent judge: improved scale, metal and pipes; collar cropped at bottom. Main gaps were slender wedge hull, tall glass-box cabin, long collar mounts, repeated hose geometry, flat lighting and sandy paint. Requested compact stepped hull, low armoured cabin, shorter mounts, irregular mechanical junctions, localized wear and more varied starfield.

Round 2's first capture was rejected as evidence because Vite retained an old viewer module. The judged capture was `.dream-loop/round-2-live/hero.png`, made after server restart and served-module verification.

Round 3 fresh independent judge: full collar framing, broader bow, shorter mounts and lower cockpit improve silhouette. Wear and dark glass are closer. Remaining gaps: barrel pods rather than rounded rectangular masses, broad illumination and harsh bow highlight, simple canopy and repetitive fittings. Round 4 changes the pod cross-section, reshapes its rings/grilles, adds winch braces and varied junctions, reduces fill and reframes.

Round 4 fresh independent judge: 6.9, not certified at 7. Rounded-rectangle pods, framing and winch supports improve resemblance. Remaining gaps: flat lighting, lamps without warm spill, simple glass, repetitive fittings, tan winch cable. Rear geometry appears intact but stern is blank; top preset clips the ring. Round 5 darkens cable, adds warm practical illumination, adjusts canopy material/equipment, details the stern and increases top-preset distance.

## Final checkpoint

Fresh independent judge: **7.1/10**, meeting the requested 7 threshold narrowly. Warm local illumination and darker cable improved depth. Top and rear views showed coherent geometry without obvious clipping or missing surfaces. Human visual acceptance remains pending.

Remaining gaps: broad/repetitive armour, less complex pipework and recessed hardware than the target, somewhat uniform weathering, simplified cockpit equipment, bright winch hotspots, sparse starfield and smooth exhaust rims. These remain visual limitations at this stopping point.

Final hardware browser: ANGLE Metal / Apple M1 Pro; 1586 × 992, DPR 1. Observed short frame cadence 56.25 FPS, 444,600 model triangles, 15 meshes. The postprocessing/shadow render reports 83 calls and 1,778,434 triangles per frame. This is a vsync-limited viewer sample, not production flight performance.

Orbit, six presets, target modal, work lights, rotation, PNG export and narrow layout passed; no browser errors. Both exported-geometry tests passed (23 assertions), including watertight outward body/nacelle backing shells. Viewer strict typecheck and production build passed.

The final captures here are live renders, not generated images. The target remains at ../target.png.

Repository browser selection was inspected at implementation commit `6645958`. The standalone selector suggested 3 probes; canonical `probe:pr` re-evaluated semantically and selected only model-viewer. No manual narrowing was applied. That hardware run passed 1/1 checks in 5 seconds. This is selected partial evidence, not the full 96-probe suite. Receipts are in `probe-selection.txt` and `probe-run.txt`.
