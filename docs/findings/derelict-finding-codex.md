# Derelict finding — node #733

Author: Codex, 2026-10-07.

`long-range-scanner.ts` owns the headless sweep and identification seams. This
checkout had the relay's passive path but no charged sweep or Scanner tab. The
shared sweep added here reads live derelicts and operational relays in the
current system. Raider concentrations and Salvage job leads remain outside
this build.

A deliberate Scanner-tab press charges for ten seconds. Completion replaces
that system's region readings, leaving other systems' readings untouched.
`GalaxyEnvelope.leads` holds one source, observation clock and region per
carrier slot. No position or target action is saved or displayed. Arriving at a
stripped or taken wreck writes nothing and leaves the old lead intact.

The fitted module uses the relay's passive signal and identification ranges.
Without it, identification requires the 10 km visual floor. The knowledge row
records the derelict lifecycle's actual destroyed instance; the ordinary
carrier's absent-row operational default is not used. A new loss in the same
slot requires another identification. Drawing and collision still happen
independently of knowledge.

Identified live instances alone become `wreck` display contacts, Navigation
rows and targets. Removing the scanner does not erase a visual or scanner
identification. A scanner cue offers strength and bearing before identification,
and range afterward. It is suppressed while docked.

The first wreck identification adds the commander's pending `wreck` exploration
kind. A dock banks it once; another wreck adds none. The optional ladder `kinds`
list and optional world `leads` map read older saves without either field and
omit empty fields on the wire. Pending credit follows the existing session-only
exploration banking contract.

Verification: `tests/derelict-finding.test.ts` covers both finding channels,
stale leads, system-local replacement, new instances and save round trips.
`probe-derelict.mjs` additionally flies both identification paths and reads the
painted Scanner tab, cue and Navigation row. Screenshots live under the ignored
`view-set/node-733/`; the principal's visual verdict remains a separate gate.

The mandatory selector reports `all` because shared runtime and probe catalog
files changed. The ranger worker contract limits local execution to affected
probes; the supervisor owns the full browser run on the final reviewed head.

Local verification: `npm test` passes 5,531 tests across 301 files with zero
failures. Production build, formatting, lint and launcher wiring all pass.
Ten affected hardware browser probes pass: derelict, relay, ladders, live
cockpit, pad panels, pointer lock, display contacts, Navigation console, boot
and public site. The public-site probe now derives its real wheel-scroll budget
from document height so the growing Field Notes list remains testable on phones.
The proposed changelog sentence and cockpit screenshots await the principal's
approval in the supervisor's delivery gate.
