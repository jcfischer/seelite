# Requests cockpit UI experiment

Author: Codex / Ivy · 2026-09-15
Node: [Prototype the Requests tab and the in-flight active-request cue](https://github.com/jcfischer/seelite/issues/343)
Contract: [Requests](../specs/missions-and-requests.md)

Run `npm run dev -- --port 5343`, then open
`http://localhost:5343/?boot=direct&seed=42&requests-prototype=1`.
Dock at any station and choose Requests. The query enables two authored,
no-cargo fixture offers at that requester. Existing Market and Equipment stay
on the same console. In flight, Requests lives on the left console.

Open details, read the terms, and choose Accept explicitly. Accept both offers
to try concurrent commitments; acceptance never changes the selected cue.
Choose Track manually, launch, and review or cancel work from the flight tab.
Arrow up/down walks the cursor, Enter activates, and arrow left/right changes
tabs while Requests is open. Alt plus arrow left/up/right changes head look.
The controller uses the existing up/down, A, shoulder tabs and Back grammar.
Normal native Tab and button activation remain available.

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
Only `SAVE_SCHEMA_VERSION` changes, from 2 to 3. The compatible source is schema
2 at main revision `7f1cfd3`; its original hash is verified before migrating a
copy to an empty journal. Schema 2 carrying a journal is refused. World schema
and generator versions are unchanged. Unsupported/corrupt records are refused
without modifying their input; normal save-store ownership remains in force.

The parser checks scoped offer/requester identity against generated stations,
supported fixture terms, stage/evidence agreement, clock bounds, terminal
settlement and valid active tracking. This intentionally supports only the two
authored no-cargo entries; entrusted cargo and a general request engine are
outside this experiment.

## Verification and principal operation

`bun test tests/requests-prototype.test.ts tests/requests-save.test.ts
tests/save-envelope.test.ts tests/save-store.test.ts` covers 88 cases.
The full suite passed 2,098 tests before the additional snapshot/requester
regressions; the affected tests passed after those changes. Build, TypeScript
and format gates passed.

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

Principal usability judgment and merge are pending. Operate the flow and judge
whether offer terms, commitment, the manually chosen next action and return
report are clear. Production graduation and checkpoint closure require that
judgment; automated evidence does not supply it.
