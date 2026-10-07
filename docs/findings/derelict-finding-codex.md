# Derelict finding — node #733

Author: Codex, 2026-10-07.

`long-range-scanner.ts` owns the headless sweep and identification seams. This
checkout had the relay's passive path but no charged sweep or Scanner tab. The
shared sweep added here reads live derelicts and operational relays in the
current system. Sweep readings are a separate save domain from retained job
Leads; no job observation, confirmation or refresh is supplied here. Raider
concentrations and Salvage job leads remain outside this build.

A deliberate Scanner-tab press charges for ten seconds. Completion replaces
that system's region readings, leaving other systems' readings untouched.
`GalaxyEnvelope.sweepReadings` holds one source, observation clock and region per
carrier identity. No position or target action is saved or displayed. Arriving
at a stripped or taken wreck writes nothing and leaves the old lead intact.

The fitted module uses the relay's passive signal and identification ranges.
Without it, identification requires the 10 km visual floor. The knowledge row
records the derelict's actual destroyed instance; the ordinary
carrier's absent-row operational default is not used. A new loss in the same
carrier identity requires another identification. Drawing and collision still
happen independently of knowledge.

Identified live instances alone become `wreck` display contacts, Navigation
rows and targets. Removing the scanner does not erase a visual or scanner
identification. A scanner cue offers strength and bearing before identification,
and range afterward. It is suppressed while docked.

The first wreck identification adds the commander's pending `wreck` exploration
kind. A dock banks it once; another wreck adds none. The optional ladder `kinds`
list and optional world `sweepReadings` map read older saves without either
field and omit empty fields on the wire. Pending credit follows the existing session-only
exploration banking contract.

Verification: `tests/derelict-finding.test.ts` covers both finding channels,
stale leads, system-local replacement, new instances and save round trips.
`probe-derelict.mjs` checks both identification paths with controlled range
placements and a live physics step, then reads the painted Scanner tab, cue and
Navigation row. It deletes fixture knowledge between the two channels; it does
not verify a flown approach or a continuous range crossing. Screenshots live
under the ignored `view-set/node-733/`; the principal's visual verdict remains a separate gate.

The mandatory selector reports `all` because shared runtime and probe catalog
files changed. The ranger worker contract limits local execution to affected
probes; the supervisor owns the full browser run on the final reviewed head.

Round 1 verification: `npm test` passes 5,534 tests across 301 files with zero
failures. Production build, formatting, lint, typecheck and launcher wiring
pass. Eight affected hardware browser probes pass on ANGLE Metal (Apple M1
Pro): derelict, relay, ladders, live cockpit, display contacts, Navigation
console, boot and save. This is partial browser evidence: 85 of 93 probes were
not run; the supervisor owns the full-suite gate. The teardown regression
initially failed because its headless Game-method list omitted the extracted
cleanup helper; it now executes that real helper and passes. The proposed
changelog sentence and cockpit screenshots await the principal's approval in
the supervisor's delivery gate.

Round 1: sweep readings now have their own save domain, relay readings require
an active relay on load, and wreck contacts are built by the headless scanner
seam. Shared region and system-reading projections keep cockpit reads aligned
with the sweep. Finding skips Holdings outside identification range and adopts
only a successful identification. The optional frame-cache suggestion is
deferred: mutable ship coordinates, world writes and multiple physics clocks
need explicit invalidation coverage before sharing those projections.
