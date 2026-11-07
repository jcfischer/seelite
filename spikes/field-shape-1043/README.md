# Field-shape study for node #1043

The four historical isolated layout candidates reuse the production field generator's radius,
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
different subjects rather than the same rock. Inside does not sample either
cluster peak; dense-region GPU cost and profile-wide maxima remain unmeasured.
The manifest records camera
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
the mathematical premise of #969's lattice broadphase.

The isolated CPU instrument now drives the unchanged production
`fieldRockSolids` with candidate profile and generator inputs. Each candidate
runs in a separate Bun process; its in-memory dependency overrides cannot reach
the game or another measurement. Generation remains inside each fresh-System
query, followed by the real lattice construction. Actual authored heightfield
pieces are prebuilt and measured separately. Warm queries use the cached
lattice. This is a study input adapter, not production integration.

```sh
bun test spikes/field-shape-1043/collision-study.test.ts
bun spikes/field-shape-1043/collision-measure.ts /tmp/field1043-collision-matched.json
```

Native and adapted baseline outputs must agree exactly. Each query is also
checked against a complete linear traversal that reuses the settled per-rock
solid/reach predicate but never uses the lattice. It validates the reach set
and motion outputs, not that predicate or full CCD independently. A deliberately
omitted rock must fail this oracle before any timing report is emitted.

Common world-space menus are identical across candidates, including the union
of one occupied point from each of the four layouts. Every candidate/fixture
must return a hit on that shared menu. Separately labelled occupied-rock targets
use each candidate's own rocks. Whole-field crossing and
enclosing-sphere cases are synthetic stresses, not normal flight. The clock is
held at 1000 seconds across a 0.1-second step. Timings are CPU query costs with
prebuilt archetype pieces: sixteen fresh-System preconditioning queries,
eleven fresh-System samples and eleven 64-query
warm batch means, in two reversed candidate orders. Cheap returned-count
accumulation is included in warm elapsed time; cold counting and hashes are
outside it. Cached-lattice warm queries do not promise stable JIT tiering.
These are not individual-query percentiles, advancing-frame costs,
CCD timings or an affordability guarantee. Integration must still make drawing
and collision consume the same approved layout and measure actual flight.

## Version consequences

Every nonbaseline candidate changes cell enumeration and moves existing rock
anchors in both charted and rare fields. Shipping it must bump
`FIELD_GENERATOR_VERSION`, then drop deposit/readings for fields whose baseline
fingerprints change, as #951 requires. World carrier identities and
`WORLD_GENERATOR_VERSION` do not change. The study itself bumps no version.

The node remains open until the principal judges the comparisons, the canonical
view-set requirement is met, and any approved production integration is linked
as a release blocker. No principal approval is represented by this study.

## Organic revision (2026-11-07)

The principal rejected the geometric appearance of the four historical profiles.
`organic` is the new primary proposal; `braided` is a secondary exploration.
Both use continuous, independent seeded anchors in unequal asymmetric lobes,
warped soft density and sparse curved bridges. A later spatial hash thins full
drift envelopes; it never supplies placement cells. Numeric source slots retain
unchanged production radius, shape, spin and drift draws. A larger metadata bank
supplies slots, not positions. Conservative profile semi-axes are display bounds,
not the actual occupied footprint or a layout lattice.

`anchor-query.ts` separately prototypes a bucket index for arbitrary anchors,
with multiple rocks per bucket and ranges derived from actual anchor bounds.
The independent complete traversal oracle and native baseline parity checks
cover reach sets and motion outputs. They do not independently validate the
settled reach predicate or full CCD. No production consumer, generator version,
save state or default profile changes in this study.

```sh
bun test spikes/field-shape-1043/organic.test.ts spikes/field-shape-1043/anchor-query.test.ts
bun spikes/field-shape-1043/anchor-measure.ts /tmp/field1043-query-cost.json
SEELITE_PROBE_RENDERER=hardware CANDIDATES=baseline,organic OUT=/tmp/field1043-organic node spikes/field-shape-1043/organic-views.mjs
SEELITE_PROBE_RENDERER=hardware CANDIDATES=baseline,organic COST=1 BLOCKS=6 FRAMES=48 OUT=/tmp/field1043-organic-cost node spikes/field-shape-1043/organic-views.mjs
```

`WORLD`, `SYSTEM`, `KIND` and `ANTIALIAS` select fixtures and AA. `PROFILE=1`
records a separate nonreported renderer CPU profile. The instrument retains
source hashes and source copies, actual camera/clock/occupied-content metadata,
full broad images and directly captured detail crops. The player hull children
are hidden for world-only comparisons; authored asteroid meshes are unchanged.
Cost rows distinguish common cameras, a common physical close-up slot, and
candidate-targeted largest-rock/dense views. Frame cost is synchronous hardware
render cost including CPU and GPU, not GPU timer-query elapsed time. Populated
live Navigation uses numeric mining flag 1, actual candidate field draws,
recorded survey rows and actual acquired field frame, and asserts rendered row
counts. These are study measurements rather than an advancing-flight release
regression or a production-affordability claim.
