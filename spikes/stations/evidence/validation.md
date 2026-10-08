# Local model study validation — Codex, 2026-10-09

- `bun test spikes/stations/model.test.ts`: 18 pass, 0 fail, 427 assertions on delivered assets.
- Standalone strict TypeScript check of `viewer.ts`: exit 0.
- `capture.mjs final-review`: nine models, six presets each, orbit and zoom motion, target dialog, lights toggle and PNG export; no page errors. Hardware renderer and per-model FPS in `metrics.json`.
- Comparison page: nine articles and eighteen loaded images, no page errors; `review-page-check.json`.
- No runtime integration, production collision/spin/LOD approval, canonical selected PR suite, full browser suite, Sage verdict or deployment claimed.
- Visual threshold remains unmet for Drum, Buoy and Salvage. See `results.json`; six other studies reached 7/10 or above. Drum round-seven shell experiment regressed, so delivered Drum restores the better round-six implementation.
