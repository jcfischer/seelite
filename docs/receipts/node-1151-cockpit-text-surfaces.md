# Node #1151: cockpit text surfaces

The game discovers `screen-<source>` meshes and mounts shared canvas faces on
their transformed frames. The courier adds physical status, notice, ore,
survey and fallback surfaces. Stationary cockpit text uses these faces;
world bearings retain their spatial markers. The source contract and missing
surface policy are in [cockpit-text-surfaces.md](../specs/cockpit-text-surfaces.md).

## Automated evidence

- The new routing tests failed before the implementation existed. Loading the
  alternate GLB through the base cabin builder also failed with
  `buildAuthoredCabin: the model has no screen-radar`.
- The alternate-fixture camera-plane assertion caught a corner beyond the
  cabin far plane. The fixture now lies within both camera planes.
- The fixture-only probe-selection test failed without its explicit asset
  registration, then passed with that registration.
- Final focused unit run: 65 tests passed across cockpit text/model, combat
  boundary, probe key labels and probe impact.
- The one authorized full `npm test` run: 7,248 passed, two failed across
  7,250 tests. Both failures were stale structural guards introduced by this
  change: two new combat readout source strings, and a duel-probe key label
  after its last key press was removed. Both were corrected and passed in the
  focused run above. The full command was not repeated; the supervisor owns
  the next full run on the committed head.
- Production build, TypeScript, formatting, script lint, comment lint and
  launcher wiring passed. The comment baseline only shrank.
- Host GPU lane: ANGLE Metal, Apple M1 Pro. Live cockpit passed 47/47 checks,
  including alternate-model installation through the real game builder,
  portrait ore wrapping, missing flight fallback, scanner containment,
  unpowered systems, painted source pixels, occlusion and absent glass text.
- Scoped GPU probes also passed: duel HUD, fire groups, missiles, raider
  consequence, witnesses, eject, mining survey, first day, chase view and boot.
  These are manual affected checks, not a full or repository-selected browser
  gate. Probe selection expands to the full inventory for this runtime change;
  the worker contract leaves that full run to the supervisor.

## Human acceptance

The local review sheet is `view-set/node-1151/index.html` (ignored capture
artifacts). It contains courier before/after and alternate-fixture/mining
frames, with full-resolution links and capture provenance. The second cabin
is a screen-layout fixture, not an integration or approval of the miner art.

The principal's courier before/after approval, proposed changelog sentence,
Sage review and checkpoint `cp-seelite-cockpit-text-surfaces` remain pending.
No graph closure or merge is claimed by this implementation worker.
