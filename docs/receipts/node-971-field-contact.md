# Node #971: field contacts and cruise arrival

Fields are stable `DisplayContact` objects, keyed by the generator's field id
and scoped to a `System` through a weak cache. Selection and the scanner refresh
their centre and velocity from the game clock. They never enter generated
bodies, body lookup, cruise masses, gravity frames or jump placement.

The existing cruise integrator accepts the contact endpoint unchanged. A field
has zero physical radius; the default 50 km arrival radius clears its whole
extent. The Target panel's existing kind label reads `FIELD`.

## Acceptance evidence

- C1: `tests/field-contact.test.ts` executes the shipped selection, target,
  velocity and mass methods over every field-bearing system in seed 47's
  first galaxy, at two clocks. It checks exact ids/centres, stable objects,
  scanner selection, and absence from bodies and masses.
- C2: The same file executes the shipped cruise step and drop-out for each
  field placement kind present in that galaxy, including both profiles. It
  checks 50 km arrival and clearance from every rock. A separate bound over
  every generated rock's anchor, drift radius and bounding radius holds the
  charted/rare extents to 26.5/18.9 km, below the 50 km drop radius.
- C3: A fast swept cruise step toward a target beyond a field crosses its
  centre and arrives at the other target, without a field proximity stop or
  an endpoint inside the field.
- C4: A jump into another field-bearing system agrees with canonical
  `arrivalPoint`, replaces contact objects and leaves the arrival position
  untouched by field projection. No jump/arrival code changed.

The new tests were written before the projection; their initial run failed
because the field-contact module did not exist.

## Browser coverage

Hardware lane: ANGLE Metal, Apple M1 Pro. Chromium required an unsandboxed host
launch after the sandboxed launch aborted before any browser checks ran.

- `probe-arrival`: 11/11. New field row: seed 47, system 173, `field-00`;
  arrival range 49.999997410 km; 168 rocks; minimum bounding-sphere surface
  clearance 26.647465 km. Existing clear/occluded station rows also passed.
- `probe-display-contacts`: 39/39.
- `probe-navigation-console`: 74/74.

These are manually scoped affected probes, not a full-suite or PR-gate pass.
Pre-run selection diagnostics expanded to all 108 probes because shared Game
and contract-root files changed. The worker contract restricts browser runs
to affected probes; the supervisor owns the final browser gate.

## Delivery

The worker ran `npm test` once immediately before its final commit: **6,419
passed, 0 failed**, across 372 files (693.28 s).

Typecheck, build, formatting, script lint and launcher wiring passed. The
changelog sentence is proposed copy; principal approval and the date on main
remain merge-time checks. No graph node was changed, and the worker neither
pushes nor opens a PR.
