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

## Sage rounds 1 and 2

Round 1 found that the first commit deleted coverage the figures above do
not show. `probe-duel-hud` had lost the rout-range row (#367) and the
heat-death row; both are restored from `main`. `probe-live-cockpit` had lost
the CHARGE refusal, the empty-drive prompt, the course-row refusal and its
prompt; four rows now check them as refusal ink on the cockpit face. So the
47/47 figure above did not cover those readings. `presentCockpitReadouts` is
now the only cockpit writer of the prompt and clearance sources.

Those two rows were not all of it. Round 2 found more behaviour rows that the
rewrite had dropped, and a comparison of row names against `main` listed
them. Rows that measured layout on the old glass (plates, margins, floor fit,
row order) are superseded by the faces. These behaviour rows are now ported
to the faces:

- `probe-duel-hud`: the raider's ring is red while it fires and amber while
  it does not; the Flight console's FORE and HULL against the condition; only
  the armed group after an encounter ends; the scoop in normal flight, on a
  cruise pass (bank draw, tank in LY), in combat and out of the band; and,
  after round 3, the values on two kept rows: the selected raider's
  condition line (`SHD F …`, `HULL n%`, `HULL 100%` on a whole hull) and the
  TEMP percentage of the hull temperature with no gun heat.
- `probe-live-cockpit`: no course row without a course; the course row on
  arrival; the target instrument without the drive charge.

`__cockpitSourcePainted` compares a face with an exact paint from both 2D
rasterisers. Chrome moves a canvas to software after repeated readbacks,
and a face read many times differed by one pixel from a fresh GPU paint.

On `38bfd6bc`, on the GPU lane, each alone with `npm run probe:one
--show-output`: `probe-live-cockpit` 61 rows, `probe-duel-hud` 36,
`probe-fire-groups` 14, `probe-missiles` 15, `probe-chase-view` 13,
`probe-mining-survey` 24, all ok. These are affected probes, not the
selected PR gate, which selects all probes for this change. Static gates and
the seven affected unit files (102 tests) passed.

## Human acceptance

The local review sheet is `view-set/node-1151/index.html` (ignored capture
artifacts). It contains courier before/after and alternate-fixture/mining
frames, with full-resolution links and capture provenance. The second cabin
is a screen-layout fixture, not an integration or approval of the miner art.

## Housed screens

The principal flew the first branch build on 2026-10-30 and asked for a
physical integration: the six readout strips had been injected into the
shipped GLB as bare quads, some floating 0.6 m above the side pods, and
`build_model.py` did not know them, so a rebuild would have dropped them.
`build_model.py` now authors the readout screens, and the principal chose
the layout from in-game captures of two variants:

- one centre display set into the dashboard brow (`screen-fallback`), which
  carries `status` and the other sources without a screen of their own;
- on each side pod a housing with one shared screen: `screen-notices+lasers`
  and `screen-ore+survey`.

A screen named `screen-<a>+<b>` serves each source it names
(`cockpitScreenFor`); sources on one screen share a face and stack in the
order they are written. The brow variant hid `lasers` behind the duct batch
and was not taken. The four original panels are unchanged to the millimetre.

On `dd8b819c`, GPU lane, each alone with `npm run probe:one --show-output`:
`probe-live-cockpit` 61 rows, `probe-duel-hud` 36, `probe-fire-groups` 14,
`probe-missiles` 15, `probe-chase-view` 13, `probe-mining-survey` 24,
`probe-raider-consequence` 21, all ok. `probe-live-cockpit`'s cockpit row
raycasts from the eye to the status, prompt and lasers faces and requires
each to be unobstructed. A diagnostic run that was not kept found the
notices and ore/survey faces unobstructed too; mining is off in that row, so
they carry no reading there.

## Decisions

The principal approved the courier cockpit after flying the housed layout,
and the changelog sentence, on 2026-10-30.
