# Field-shape study for node #1043

Four isolated layout candidates reuse the production field generator's radius,
shape, spin and drift draws, then render through production `FieldDraw` and the
installed authored rock model. Nothing under `src/` changes. These inputs are
study candidates, awaiting the principal's choice, rather than approved tuning.

- `baseline` reproduces the shipped profile exactly.
- `expanded` expands each semi-axis by 2.5, cell size by 1.5, with occupancy 0.12.
- `clusters` expands each semi-axis by 3, cell size by 1.5, with occupancy 0.7
  filtered by two separated smooth density peaks and a tapered outer quarter.
- `broken` uses the same occupied slots as `clusters`, with anchor jitter in a
  cell-contained box rather than the generator's ball. Drift and bounding radius
  still fit each cell, with the unchanged minimum surface gap.

Run the independent arithmetic checks and corpus:

```sh
bun test spikes/field-shape-1043/profiles.test.ts
bun spikes/field-shape-1043/measure.ts > /tmp/field1043-corpus.json
```

Run production-renderer comparisons and frame measurements:

```sh
SEELITE_PROBE_RENDERER=hardware OUT=/tmp/seelite-field-shape-1043 node spikes/field-shape-1043/run.mjs
SEELITE_PROBE_RENDERER=hardware ORDER_SEED=20261019 ANTIALIAS=2 CAPTURES=0 OUT=/tmp/seelite-field-shape-1043-repeat node spikes/field-shape-1043/run.mjs
```

The instrument takes the machine probe lock, guards its own Vite server, asserts
the hardware renderer, and writes screenshots, a contact sheet and JSON samples
outside the repository. It uses 12 shuffled blocks of 120 frames per arm, warm
passes, readPixels drains and the shared measurement statistics. Every frame
advances the held game clock by 1/60s within a two-second window and re-stands
the camera. Both quality sides and pinned occlusion off/on are measured against
a matched no-field control.

The far view is a common 224km from the centre; inside is the same field-frame
coordinate; edge is 2km beyond each candidate's long semi-axis. Close uses the
largest rock of each candidate at 1.2 bounding radii, so that view compares
worst-case subjects rather than the same rock. The manifest records camera
miss, asked/actual range, axis error, per-level counts and raw frame blocks.

`SYSTEM` and `KIND` can select another fixture (for example `SYSTEM=0 KIND=rare`).
The default is world0x5ee11e system173 charted. The corpus separately includes
charted and rare fields across three worlds. A fixture's frame cost is not a
corpus-wide worst-case guarantee.

## Scope and collision boundaries

The shipped `refreshScannerContacts` supplies `fieldContactsAt` centre contacts;
it does not send individual rocks or field extent to the scope. Real cockpit
scope captures therefore compare that existing centre-only contract, and cannot
prove that a density profile reads differently on the scope. Changing that
representation needs its own approved design.

The headless containment test proves each rock's bound, drift and margin stay
inside its indexed cell, separately on charted and rare fixtures. This preserves
the mathematical premise of #969's lattice broadphase. Production `buildLattice`
still reads `FIELD_PROFILE` and `fieldRocks` directly: this study does not wire
candidate collision or claim a production collision-query timing measurement.
An integration must move drawing and broadphase to the same chosen profile.

## Version consequences

Every nonbaseline candidate changes cell enumeration and moves existing rock
anchors in both charted and rare fields. Shipping it must bump
`FIELD_GENERATOR_VERSION`, then drop deposit/readings for fields whose baseline
fingerprints change, as #951 requires. World carrier identities and
`WORLD_GENERATOR_VERSION` do not change. The study itself bumps no version.

The node remains open until the principal judges the comparisons, the canonical
view-set requirement is met, and any approved production integration is linked
as a release blocker. No principal approval is represented by this study.
