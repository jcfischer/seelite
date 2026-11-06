# Station capability operational time: decision evidence

Refs #937. Instrument base `804c60f`; verified 2026-11-07. The principal approved
D1–D5 and the full contract draft in conversation. Graph rulings and the eventual
close receipt own that approval; [the spec](../specs/capability-operational-time.md)
owns the resulting structure. This is not a production outage implementation.

## Arithmetic and queue instrument

```sh
node --test docs/prototypes/capability-outages-937.test.mjs
node docs/prototypes/capability-outages-937.mjs
bun docs/prototypes/capability-outages-937-corpus.ts
```

The first command passed 11 cases: odds and endpoints; exact exclusion of disabled
seconds; pressure changes in both phases; repair through its original outage;
whole versus partitioned queries; remote recovery boundaries with visits and
reloads; FIFO splitting and late submission; rejected discarded history and
malformed anchors; bounded fields after 10,000 causal changes; and duration bounds.
Partition checks cover 64 seeds over 100,000 seconds with 137-second subdivisions.
The remote case explicitly supplies the ordered recovery timeline; the
instrument does not discover lazy recoveries in production world state.

The distribution command checks 32,768 initialized seeds per government at zero
and full raider pressure (16 populations). The largest sampled initial-share
error was **0.004415253** (0.442 percentage points). Separately, integrated runs
of 128 complete cycles for 64 seeds per population differed from the target
share by at most **9.992008e-16**. These are different checks: one finite sample
of stationary initialization, and one numerical integration of the complete-cycle
identity. Neither claims that a changing-pressure population instantly matches
the stationary share or that the game's live rates have been measured.

## Bounded candidate footprint

The corpus command reads the actual generator-10 station roster in every galaxy
for three world seeds, with two slots on trade stations, three on refineries and
shipyards and none on the currently unavailable outposts. It populates every
candidate timing record, using large clocks/ordinals and a long fractional
duration, and reports JSON bytes independently of any complete save envelope.
Records include redundant generated fields, so these are candidate footprint
measurements, not the production format or a mathematical byte ceiling.

| World seed | Capabilities, eight galaxies | Refineries | Candidate anchor JSON bytes | Maximum eight-job work rows |
| --- | ---: | ---: | ---: | ---: |
| 0 | 7,522 | 783 | 1,524,503 | 6,264 |
| 42 | 7,564 | 802 | 1,532,969 | 6,416 |
| 2026 | 7,423 | 769 | 1,504,235 | 6,152 |

The final column is a count, not a serialized job/custody measurement. The
standalone harness retains its input job list; it does not implement the
production eight-job queue bound or completed-custody compaction. Actual
production records should omit generated facts. Node #1194 must extend the real
save-size instrument for the complete envelope; the refinery build must add its
real occupied queues and custody. IndexedDB has no project-imposed byte cap
(`src/save-store.ts`), but write/read cost and bounded growth still require that
measurement. The contract bounds record count by the generated roster; event
count and play duration do not add rows.

## Finite protocol model

[The model and configs](../prototypes/capability-outages-937-formal/README.md)
checked **376 states and 898 steps**, with type bounds, preserved natural ends,
no repaired-outage resurrection, no disabled processing, settle-before-replace
and deadlock checking all passing. Three deliberate negative configs fail:

- Reset end: time passes → service fails → pressure changes.
- Resurrection: time passes → service fails → repair → pressure changes.
- Replace before settlement: time passes → pressure changes.

This finite four-tick protocol model does not prove continuous arithmetic,
population rates, FIFO, serialization, migration or code that does not exist.
The separate executable instrument tests the continuous arithmetic. Production
must replay these counterexamples against its own module and world mutations.

## Delivery scope

Only docs, decision instruments and their local checks change. No game source,
test-suite configuration, save format or stock availability changes in this PR.
No browser rendering is claimed. Production migrations, probes and complete-save
measurements remain explicit acceptance criteria on node #1194. The mining balance
instrument can consume this contract after decision closure; balance ratification
and production mining are still separate nodes.
