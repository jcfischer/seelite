# Discovery handoff — Codex

## Current request and stopping point

On 2026-10-09 the principal accepted the appearance: “looks good. Wrap up in a PR for another agent to finish. don't run tests or sage”. This PR preserves that exact visual state. No further tests or Sage were run after the instruction. Do not resume them without new authorization. Do not restart fidelity iteration merely to obtain another 0.02 points.

Node #809 remains open. Branch `design/discovery-codex`; based on main `53be4f7`. This is an isolated prototype, not a production Voyager replacement. There are no changes to the ship roster, gameplay envelope, cockpit, saves, or production rendering code.

## Deliverable

- `discovery.blend` and deterministic `build_model.py`: editable geometry.
- `discovery.glb`: self-contained textured viewer model, about 35.6 MB.
- `target.png`, `target-prompt.txt`, `assets.md`: locked generated target and provenance.
- `viewer.ts`, `index.html`: orbit/pan/zoom, six views, target dialog, work lights, rotation, PNG export.
- `evidence/`: current captures, hardware metrics and all independent scores.

Run from the checkout: `npm run dev -- --config spikes/discovery/vite.config.ts --port 5189 --strictPort`, open `http://localhost:5189/spikes/discovery/`. The original worktree is `.worktrees/seelite-809`; its server was left running for review. Use normal dependency installation in a new checkout; the original uses a shared node_modules symlink.

## Existing evidence — not a fresh PR validation

Final independent comparison: **7.98/10**, composition 2.70, lighting 2.25, materials 2.22, details 0.81. This is below the skill's default 8 threshold; the principal stopped the loop after accepting the appearance.

Latest hardware capture: **59.01 FPS**, Apple M1 Pro, no page errors; orbit, presets, target dialog, work lights, rotation and PNG export passed. Model: 541,843 triangles, 18 meshes; viewer post-processing increases submitted triangles to about 2.17 million. Bounds are visual-study metres: approximately 141.63 × 26.76 × 24.34, not gameplay dimensions.

Before the stop instruction: 2 model integrity tests, 118 assertions passed; standalone viewer TypeScript check passed. The prototype capture followed the shared GPU lock and renderer assertion. No full production browser suite or Sage approval is claimed.

## Finish from here

Review the prototype and principal's visual acceptance, resolve any necessary packaging concerns, and route the PR through the repository workflow when authorized. Production adoption requires a separate scoped decision: authoritative hull envelope, collision/berth fit, cockpit fit, LOD/texture budget, and live-game performance. Do not silently substitute this study for the production ship.

If further visual changes are explicitly requested, the last judge identified a dish about 25 px too high, bulky pod faces/radiator, repetitive sphere damage, graphic bridge treatment, even fill, and uniform stars. Reuse the fixed target; do not change it to improve the score.

Keep #809 open until its checkpoint is satisfied. Current Soma work record: `discovery-codex-20261008`, C2 remains open because the numerical 8/10 criterion was not met; C1 and C3 passed.
