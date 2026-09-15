# Requests cockpit UI experiment

Author: Codex / Ivy · 2026-09-15
Node: [Prototype the Requests tab and the in-flight tracked-request cue](https://github.com/jcfischer/seelite/issues/343)
Contract: [Requests](../specs/missions-and-requests.md)

Run `npm run dev -- --port 5343`, then open
`http://localhost:5343/?boot=direct&seed=42&requests-prototype=1`.
Dock at any station and choose Requests. In a development build the query enables two authored,
no-cargo fixture offers and the Requests tabs at that requester. Normal Game
sessions and production builds expose no prototype Requests tabs.
Existing Market and Equipment stay
on the same console. In flight, Requests lives on the left console.

Open details, read the terms, and choose Accept explicitly. Accept both offers
to try concurrent commitments; acceptance never changes the selected cue.
Choose Track manually, launch, and review or cancel work from the flight tab.
Arrow up/down walks the cursor, Enter activates, and arrow left/right changes
tabs while Requests is open. Alt plus arrow left/up/right changes head look.
The controller uses the existing up/down, A, shoulder tabs and Back grammar.
Normal native Tab, Enter and Space button activation remain available.

The merged parent supersedes the older handoff's one-active restriction and
partial-relay assumption: multiple commitments, one manual cue, relay unbuilt.
The relay offer's 250 Cr and survey offer's 75 Cr are prototype tuning.
Both disclose no cargo, deadline, exclusivity or cancellation fee. The built-in
pulse laser on a surviving ship satisfies the first offer's weapon requirement;
the reducer separately tests eligibility refusal.

## What is simulated

The broker reports, search region, second survey offer and objective events are
fixtures. The separately labeled Prototype Controls simulate search,
identification, disablement and an observed unavailable target. They do not
create a carrier, learn a relay in WorldState, perform combat, issue a world
report or change route danger. No relay coordinates or exact marker exist in
this experiment, including after fixture identification. Production known-target
tracking awaits the relay's real knowledge channel.

Fixture stages are ordered; untracked accepted work progresses independently.
Completed objective evidence survives later unavailability. Return and dock at
the original requester, then Report to receive the pinned reward once.
An observed unavailable unfinished target offers an unpaid information report
(terminal failed disposition) or free cancellation. A cancelled unfinished job
can be reaccepted at its requester with the same identity, terms and earned
evidence; unavailability remains recorded, so it still needs disposition.
There is no claim of live relay discoverability, intervention or consequence.

## Persistence boundary

`CommanderRecord.requests` stores the bounded experiment journal with credits
and flight state under the complete envelope's existing hash and IndexedDB
transaction. Actions use the existing dirty/debounce and docking/quit flushes.
Normal Commander writes retain `SAVE_SCHEMA_VERSION = 2` and the exact
journal-free wire shape. Schema 2 at main revision `7f1cfd3` is read after its
original hash is verified, with an empty journal added to the in-memory copy.
Only envelopes carrying experiment entries use the separately named
`REQUESTS_PROTOTYPE_SAVE_SCHEMA_VERSION = 3`. The loader accepts the bounded
revision-1 experiment entries. Schema 2 carrying a journal is refused. World schema
and generator versions are unchanged. Unsupported/corrupt records are refused
without modifying their input; normal save-store ownership remains in force.

The development-only trial uses the separate `seelite-requests-prototype-saves`
database, catalog and Web Locks. Simulated payments never write to the normal
Commander catalog. Production builds cannot enable fixture controls via the
query flag. Schema 3 is the experiment's bounded encoding; it does not claim to
implement §7's future entrusted-cargo or production evidence domains.

The parser checks scoped offer/requester identity against generated stations
and refreshes copied presentation labels through that valid CarrierKey. A
station naming-policy change does not invalidate a correctly keyed journal.
Pinned reward, eligibility, stages, evidence and settlement do not change.
It also checks
supported fixture terms, stage/evidence agreement, clock bounds, terminal
settlement and valid active tracking. This intentionally supports only the two
authored no-cargo entries; entrusted cargo and a general request engine are
outside this experiment.

## Verification and principal operation

`bun test tests/requests-prototype.test.ts tests/requests-save.test.ts
tests/save-envelope.test.ts tests/save-store.test.ts tests/station-console.test.ts`
covers 111 cases. TypeScript additionally verifies that Requests is valid in
the live cockpit and refused by the two-tab gallery contract.
The complete headless suite passed 2,102 tests. The final repairs passed
the guarded 27-check headed flow, TypeScript,
build and format gates. The browser probe includes native Tab/Enter/Space and prevents
a rapid Accept double-click from selecting the newly drawn Track action.
It also checks release of a flight key after opening Requests, reuse of docked
offers, native Space reacceptance and absence of prototype tabs in a normal Game.
Every terms label and its nonempty value has positive viewport bounds and no
ancestor clipping. It checks a separate normal Commander catalog across fixture
payment and save/load. The catalog comparison takes read-only snapshots; the
probe writes no normal save. The production bundle compiles `requestFixtures` to false
and refuses all experiment actions outside the development trial.

`node scripts/probe-requests.mjs` runs the guarded normal-Game flow with the
project's shared berth setup fixture, actual keyboard events and the shared
fake W3C controller. It flushes IndexedDB, then boots a fresh Game from the live
envelope without a seed override, and checks the preserved commitment, cue and
report settlement. The berth fixture suppresses traffic for deterministic
docking; the flow does not prove physical-controller compatibility or normal
flight discovery. The headless renderer is SwiftShader; no frame-cost claim is
made.

`HEADED=1 REQUESTS_EVIDENCE=/tmp/seelite-343-headed node
scripts/probe-requests.mjs` captures selection, details, ready-report, active
flight, flight Requests and unavailable-target states at the canonical
1440×900 viewport. `checks.json` records each observed result and fixture
boundary. Captures are local review artifacts, not committed binary assets.

The principal operated the trial and judged it "clear and usable", then asked
whether requests create new target areas: "Approach region" leaves too much
empty space to search. This experiment creates no spatial search area. Live
relay discovery in #43 and the complete request loop in #344 must supply a
bounded, discoverable region and enough guidance to reach the signal without
leaking its unlearned exact location. Final Sage review and merge remain pending.
