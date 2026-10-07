# Derelict cockpit implementation — node #732

Author: Codex, ranger implement worker. Date: 2026-10-07.

The seeded derelict pose supplies both the dark roster mesh and the built hull
collision proxy. Rendering evaluates the current post-step clock. Containers
stay in the translating body frame outside the enclosing radii of both the
wreck and the largest purchasable pilot hull, plus the scoop radius and margin.
Planet placements also clear the approach boundary: the first flight probe
exposed an inward-flight stop when the wreck was inside that boundary.

Owned recovery calls the existing canister gate. Holdings commits the tonnes
left and the goods or fitting item together. Recovered fittings count in the
hold, save in schema 10, and sell or fit through the Equipment tab; fitting
retains the ladder and mount refusals. Schemas 2–9 still load. Death keeps the
world remainder while reverting the commander to its launch snapshot.

## Initial build verification

- Final `npm test`: 5,388 passed, zero failed across 293 files (278.27 s).
- Twelve dedicated headless tests cover the gate, partial recovery, refusal,
  fitting capacity and commerce, reload, death, frame placement, tether clearance,
  material isolation, and the moving hull proxy.
- `npm run build`, `npm run format:check`, and `npm run lint` passed.
- Hardware browser: `npm run probe:one probe-derelict.mjs` passed twelve checks.
  It flies the gate, reads the row, round-trips the remainder and hold, reads the
  free-tonne refusal, checks heat and hull contact, and verifies the drawn
  post-step pose and tumble. Its Equipment fixture explicitly supplies a carried
  fitting; headless tests own fitting recovery. The locked row and SELL press are
  checked through the live UI.
- Hardware browser: collision, death, hold, ladders, save and station-console
  probes passed together, 6/6. This is a partial run, not a suite verdict.

The mandatory selector was consulted before probing. Shared view infrastructure
selected the entire suite; the worker contract expressly reserves that run for
the supervisor. Only the affected probes above were completed. An earlier probe launch
omitted the intended filter and was stopped before any probe verdict; the corrected
run used exact `PROBE_FILES` selection.

## Principal review still owed

`scripts/lib/view-set.mjs` declares the derelict view, captured by the natural
first-loss fixture in `scripts/lib/derelict-state.mjs`. The new probe writes
`view-set/node-732/derelict.png` and `equipment.png` as local review evidence.
These two frames do not constitute the complete canonical contact sheet, and
the worker cannot give the principal's visual yes. That approval and the
`cp-seelite-derelict-cockpit` close gate remain with the supervisor.

Finding, knowledge and leads, the entrusted Salvage job item, the broken-hull
look, and death-wreck creation remain outside this implementation.

## Sage round 1 repairs

Fittings are recovered whole or refused with their required tonnes and the
free hold. A three-tonne fitting with two tonnes free leaves both row and hold
unchanged; with three free it creates one item and can yield only one sale.
Goods retain their partial-recovery path.

Holdings returns the adopted take or refusal, including tonnes left and free
tonnes. Game checks proximity before building its Holdings snapshot and draws
only that outcome. An event naming a stale instance returns no scoop signal.
The recovery reducer lives in sim-free `derelict-salvage.ts`.

Derelict poses share one orbital placement per timestamp across every wreck,
retaining both step ends for collision, post-step scooping and rendering.
WorldStarts receives wreck solids at construction; cruise does no such work
when there is no fleet. Hold occupancy now has one sum in `commanderHold`,
and mesh teardown has one owner.

The clearance regression sweeps real hull proxies through sampled turns for
every wreck/pilot hull pairing. It no longer repeats the enclosing-radius
formula. A resealed schema-9 envelope with a partially stripped derelict also
loads the remainder. The browser adds a three-tonne fitting fixture, checking
the live refusal and whole recovery through Holdings.

### Round 1 verification

- `npm test`: 5,392 passed, zero failed across 293 files (283.19 s).
- Sixteen dedicated derelict cockpit headless tests pass.
- Build, typecheck, formatting, lint and launcher wiring pass.
- Hardware renderer: ANGLE Metal, Apple M1 Pro. Collision, death, hold,
  ladders, save and station-console probes passed in the selected run.
- The derelict probe passed on its corrected rerun. Its new fitting fixture
  first used an object for the galaxy array and crashed; correcting that
  fixture yielded a green rerun, including the whole-fitting refusal and take.
- The mandatory selector again chose all probes due to shared view
  infrastructure. The worker contract reserves the full run for the supervisor;
  these seven probes are partial evidence. Principal visual approval remains
  owed. No review suggestions or nits were declined.
