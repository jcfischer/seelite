# Accepted designs and distance LODs

Principal on 2026-10-09: "backside of bastion iss open. Close it, then leave bastion as is. Others are ok too." This is visual acceptance of the current designs with one bounded stern repair; historical judge scores remain historical and are not revised upward. Further Dream Loop redesign is stopped.

Bastion now has an enclosed aft bulkhead; its forward bay remains open. The other six full-detail models are unchanged. Each of all seven ships now has separately exported `model-reduced.glb` and `model-outline.glb`, generated with the Node 812 / PR 828 method. See [LOD.md](LOD.md) for measurements, provenance, commands and integration notes, and [the comparison gallery](review/lods.html).

The isolated viewer supports Full, LOD 1, LOD 2 and automatic apparent-size switching, with Medium range / Far range controls. Habitat rotation stays synchronized across levels. All full models and LODs remain isolated study artifacts; production integration and merge are separate.

---

# Latest outcome

## Round 8 — Bastion assembly rebuild

Principal requested another round after the stall report. Rebuilt Bastion with separately housed pressure bays, recessed assembly joints, inclined shoulder exchangers, a deep stepped bow collar, and a low elongated glazed bridge. Replaced the rear grille grid with a central segmented pressure door, vertical pump plant, control cabinets and a rear service gallery. Adjusted carrier lighting and pulled back its bay camera. Other six models were not rebuilt in this round.

Independent score: **5.65/10**, versus 5.20 in round 7 (+0.45). Review: `review/seven-bastion-round8-review.md`. Improvement is real but the 8/10 criterion remains open. Stall approaching persists: ring inner architecture, repeated side equipment, dark hero bay and sparse deck remain the priorities. The equal-or-worse stop condition was not triggered. This completes the principal's requested additional round; it does not assert visual acceptance.

Verified: seven model tests / 75 assertions, strict standalone viewer typecheck, hardware browser capture with all controls and no browser errors. Bastion measured 63.55 FPS, 2.441 RPM (nominal 2.5), 1,350,362 model triangles and 60.11 MB GLB. Approved 180 m floor diameter and 0.629012 g remain unchanged; clearance test passes. Capture evidence `.dream-loop/round-8/carrier/`; refreshed review gallery includes hero and interior. Previous hero preserved as `review/carrier-round7.png`.

---

# Current outcome — Dream Loop visual improvement reopened

The principal rejected treating prior prototype approval as a quality pass, requested Dream Loop improvement, identified floating gun/grille fixtures on Warden and Shiv, requested shipyard-inspired Bastion bay articulation, and approved new capital habitat-ring images. Those bounded changes are built. The latest models are not accepted as meeting the visual target.

Capital habitats: 180 m floor diameter, 2.5 RPM, 0.629012 g; approximately 189.49 m outer envelope. Authored rotor-to-bearing radial clearance 1.60 m; an independent test of exported triangles verifies greater than 0.5 m conservative clearance through every angle. Browser measured 2.470 RPM on Bastion and 2.440 RPM on Rampart. Pilgrim remains 80 m / 3 RPM / 0.40257 g.

Current round 7 scores: Lance 5.50, Warden 5.10, Pilgrim 5.10, Shiv 5.00, Bastion 5.20, Sluice 5.25, Rampart 4.25. The 8/10 gate is not met. Independent review reports unchanged or regressed small-ship scores after structural attempts; Dream Loop Pro stalled condition requires principal input. Main gaps remain hull/assembly specificity, purposeful machinery layout, materials, dreadnought nose and turret architecture. Do not infer quality acceptance from technical checks.

Verification: seven asset tests / 75 assertions, strict standalone viewer typecheck and seven hardware browser control captures passed. Isolated scenes measured 49.6–76.3 FPS on Apple M1 Pro; no production benchmark. Bastion Bay interior preset now exposes internal galleries, braced structural frames, crane, manipulators, ladders and equipment wall. Grille/weapon supports visually checked by independent judge.

Review: http://127.0.0.1:5227/spikes/seven-ships/review/
Viewer: http://127.0.0.1:5227/spikes/seven-ships/
Source and assets remain isolated studies. PR #829 is a draft; no production integration or merge.

---
## Historical record (superseded by current outcome above)

# Current outcome

Principal accepted the models after the Bastion correction: "looks good, continue". Packaging as an isolated study PR. Historical review scores and limitations below are retained; numerical 8/10 criterion was not achieved. Production integration remains separate.

# Generation status — Codex, 2026-10-09

All seven approved concepts have editable Blender scenes, textured GLBs, measured reports, and a shared interactive viewer. Three implementation/review rounds completed. Targets remain unchanged.

Verification: seven asset tests / 61 assertions passed; strict viewer TypeScript check passed; all seven browser control probes passed with no browser errors, hardware Apple M1 Pro at approximately 120 FPS. Pilgrim floor radius 40 m, nominal 3 RPM, 0.40257 g; browser measured 2.966 RPM. These are isolated-viewer measurements, not production benchmarks.

Visual acceptance is unresolved. Small-ship round 3 scores: interceptor 4.9, patrol 4.9, explorer 4.9. Explorer did not improve after the architectural revision. Dream Loop Pro stalled criterion now requires principal assessment; no claim of reaching the 8/10 gate. Known recurring gaps: component proportions, repetitive structural assemblies, flat canopy materials, ring/spoke/hub depth and capital hull hierarchy. Inspect triangular surface artifacts on Lance's lower rear pod before acceptance.

Review: http://127.0.0.1:5227/spikes/seven-ships/review/
Interactive viewer: http://127.0.0.1:5227/spikes/seven-ships/

Worktree: .worktrees/seelite-827; branch design/seven-ships-codex; graph issue #827 remains open. No production integration or merge. Local studies are preserved for principal review.

Final round-3 scores: Lance 4.90; Warden 4.90; Pilgrim 4.90; Shiv 4.90; Bastion 4.65; Sluice 4.85; Rampart 3.95. Rampart regressed from 4.05 after its architectural attempt, independently meeting the stalled criterion. Full verdicts are in review/round-3-*.md.

Principal follow-up: "looking good. small cockpit fairings on bastions top don't make sense. Cockpit would be on bridge". Removed all four cockpit-like deck shuttle assemblies; retained command glazing on the naval bridge. Regenerated carrier Blender and GLB; refreshed review image. Prior numerical judge scores remain historical evidence, not principal rejection.

Bastion follow-up verification: carrier asset test passed (8 assertions); fresh hardware browser capture passed all controls with no errors at 72.22 FPS. Hero screenshot visually inspected: four deck cockpit assemblies absent, bridge retained. Evidence: .dream-loop/bastion-bridge-only/carrier/.
