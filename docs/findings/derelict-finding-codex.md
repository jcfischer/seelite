# Derelict finding — node #733

Author: Codex, 2026-10-07.

Round 2 reconciles the build with node #482, merged on origin/main at
`08dd507` after this branch's base. The existing `system-sweep.ts`,
`system-sweep-view.ts`, Sweep console tab and save-schema-11 parser are
integrated from that reviewed implementation. There is one sweep ledger,
`CommanderRecord.sweepReadings`, and one glossary entry pointing to
`docs/specs/system-sweep.md`. The unshipped `GalaxyEnvelope.sweepReadings`
domain, its parser and the duplicate Scanner tab are removed.

A deliberate Sweep press charges for ten seconds on the game clock. Completion
replaces only the current galaxy/system's region readings, with source and
observation time. No coordinates or target actions are saved or displayed.
Opening a tab does not charge, refresh or identify anything. Stripping a wreck
or arriving after other salvagers take it writes no identification and leaves
the commander's old reading unchanged until a new completed sweep.

`long-range-scanner.ts` owns the flown derelict identification and contact
builder. A fitted scanner uses the relay's passive signal and identification
ranges; without it the proximity floor is 10 km. This is a distance test,
independent of facing, head look or occlusion. The knowledge row records the
actual destroyed instance, and another loss in that carrier identity requires
its own identification. Drawing and collision stay independent of knowledge.

Only identified live instances become contacts, Navigation rows and targets.
Removing the scanner preserves identification. Before identification the
scanner cue offers strength and bearing, with range afterward; docking
suppresses the cue. Runtime pre-check and knowledge writer share
`identifyRangeKm`; registered contacts retain their identity while all their
fields are refreshed from `wreckContact`. World persistence imports no relay
gameplay rule.

The first wreck identification adds one pending exploration kind, banked on
dock once commander-wide. Further wrecks add none. Pending credit follows the
existing session-only banking contract. The optional ladder kinds list reads
older saves empty. The sweep ledger uses node #482's schema 11: versions 2–10
migrate empty after their original hash is checked, and version 11 requires
the ledger. No alternative save domain or version is introduced by this node.

`tests/derelict-finding.test.ts` covers both identification channels, stale
readings after stripping/taking, system-local replacement, changed instances,
commander-only save ownership and updating a registered contact. The integrated
`tests/system-sweep.test.ts` covers charge, source and save validation.
`probe-derelict.mjs` uses controlled range placements and a live physics step,
then reads the painted Sweep tab, passive cue and Navigation row. It clears
fixture knowledge between the two channels; it does not prove a continuously
flown approach. `probe-system-sweep.mjs` covers the canonical ledger and UI.
Screenshots remain ignored under `view-set/node-733/`. Principal visual and
changelog approval remain the supervisor's separate gates.

Correction to the prior receipt: its round-1 figures (5,534 tests and eight
affected probes) did not name the measured tree or establish their ordering
against the round-1 changes. They are historical self-reports, not evidence
for this repaired implementation. The verification entry below will name the
implementation commit measured in this pass.
