# Ordinary work

Author: Ivy · 2026-09-16
Status: D1–D13 are agreed. The detailed contract becomes ratified on
principal-approved merge recorded in the linked decision's resolution.
Decision node: [Ordinary work: the job families a pilot flies between the story
beats](https://github.com/jcfischer/seelite/issues/356).

This spec owns the **job families a pilot flies between the story beats** and
the shape a new job is authored in. It does not own the request lifecycle,
which `missions-and-requests.md` ratified, nor the world-damage model, nor
carrier identity and the scan — the last two are child nodes of #356 and are
named in §7.

## What this spec does not own

Listed first, because the common failure here is a spec restating a rule it
does not own and then drifting from it. Each of these has exactly one home.

| Fact | Owner |
| --- | --- |
| Offers, leads, accepted requests, stages, evidence, entrusted cargo, report-at-requester, the saved journal | `missions-and-requests.md` (node #337) |
| Legal status, heat, contraband scans, bounty legitimacy, raider slots and their lifecycle | `combat-model.md` §3 and §4 |
| Per-carrier state bounds, transitions, recovery, provenance, the six galaxy domains | `persistent-world-state.md` §3–§8 |
| Stock deficit behaviour, decay, price elasticity | `economy-trade.md` §5.5 |
| Station generation — which roles a system gets and when | `src/system.ts`'s `generateContents` |
| Browser-only delivery, determinism, per-system RNG streams, no downloaded assets | the map's Constraints |

Where a figure from one of those is relevant below, this spec **points at its
owner rather than copying it**. A third copy of a number is how the last one
went stale.

## Agreed decisions

Principal evidence throughout is a live grilling session on 2026-09-16, one
question at a time, each decision selected explicitly.

### D1 — Authored templates, live operands

A job's text and rules are authored. Which station posts which template is a
deterministic draw. The **operands** — the commodity, the target carrier, the
destination — bind from live world state at offer time and pin at acceptance
under §1 of the request contract.

The principal was offered seeded templates with live operands, full derivation
from world state, a fully authored finite set, and authored templates with
seeded operands, and chose the first, adding: *"I think towards 1, but we an
easy way to build (or generate) new jobs."* That addition is a requirement on
this spec, discharged by D3, and not a preference.

Rejected with it: **seeded operands**. A template filled from the seed rather
than the world can ask a pilot to haul grain to a station that does not want
grain, which is the invented need D1 exists to avoid.

### D2 — Five families

**Courier, Bounty, Investigation, Procurement, Salvage.** The principal was
offered three (Courier, Bounty, Investigation) as the recommendation and chose
all five.

Each family owes one sentence naming what the pilot decides in it that the
others do not; §1 carries them.

### D3 — A row table and one binder per family

Content is a **typed row table with a small row-builder**, in the idiom
`market.ts`'s `good(…)` and `hull.ts`'s `HULL_SPECS` already use, and which the
map's no-runtime-network constraint requires anyway. Each family has **one
binder** that fills its operands from live world state.

Adding a job is adding a row. Adding a family is adding a binder.

Rejected: one generic struct with optional fields for all five families. The
shipped precedent argues against it — `fixtureOffers` in
`src/requests-prototype.ts` builds a 16-field offer through a chain of
ternaries on a two-value slot, and is already at its limit at two jobs.

Also rejected: JSON content files, which lose type checking at the authoring
site; and a pure generator with no authored rows, which makes every job read as
the same job.

### D4 — Every job leaves a mark

The principal was offered marks only where a carrier changes, marks on every
job, and credits-only, and chose **every job**.

§4 says what each family's mark is. The affordability of this rests on
`persistent-world-state.md` §6: growth is bounded by the finite generated
carrier set and is **at most one row per carrier key**, not one per job
completed. A per-completion ledger would be the unbounded ledger
`combat-model.md` §6 forbids, and is not what this decision authorises.

### D5 — A seeded damage floor, with raider damage on top

Damage has two sources: a deterministic floor written at generation, and
raider-caused damage accruing over time. The principal was offered each alone
and chose both.

Rates, the interaction between them, and the condition-to-capability projection
belong to the child node in §7 — not here.

### D6 — The damage model is its own node

Raised by the agent when D5 widened this node past a job catalogue; the
principal chose to split rather than absorb.

### D7 — Salvage targets a wreck, not a canister

A salvage job's objective is a **persistent wreck**, which is re-derived from
its carrier's destroyed row and therefore survives a departure and a reload. It
is **not** a cargo canister.

The reason is a verified property rather than a preference: canisters appear
nowhere in `src/save-envelope.ts` or `src/world-state.ts`. They are flight
state with a lifetime declared in `src/raider-wreck.ts`, and #324's playtests
chose that deliberately. A job spanning a save cannot be built on them without
reversing that choice.

This family needs a **wreck-interaction verb**, which does not exist. It is
this spec's one acknowledged new mechanic, and §1 marks it.

### D8 — Offers derive from need, with a courier floor

A station posts a repair job because a capability is **actually** disabled, a
procurement job because it **actually** has a deficit, a bounty because a
raider slot is **actually** operational. Plus one always-available courier run,
so no board is ever empty.

The principal was offered pure derivation, fixed seeded slots, and need-first
with seeded filler, and chose derivation with the floor. Pure derivation was
rejected because a peaceful system would offer a new player nothing, which
reads as broken rather than calm; seeded filler was rejected as D1's invented
need returning by another door.

This satisfies §1's rule that a fixed offer is not regenerated on docking, a
tab change or a clock epoch, because what posts a job is world state and not a
roll.

### D9 — Need is the only throttle

Rewards are flat for what a job is. Repetition is limited because only so much
is broken at once, and that rate is D5's to set.

The principal was offered a second throttle on the reward and a per-station
cooldown, and rejected both. The argument taken: the map's Constraints record
a per-type modifier on an already-bounded index being clamped away three times
in node #13 alone, and a second lever here would interact with a damage rate
nobody has tuned. A per-station cooldown was additionally rejected for
contradicting D8 — it can leave a genuinely broken station refusing to ask for
help.

### D10 — Every carrier is named; wanted status comes from a scan

Every carrier carries a name, ordinary traffic included. A ship's
**raider / wanted / fugitive standing is discovered by scanning it** once
targeted, not read off its name.

The principal's words: *"Name every carrier (also regular ships) —
Raiders/fugitive/wanted status will depend on a scan performed on the targeted
ship."* This went beyond the three options offered, all of which assumed
numbered slots for ordinary ships, and supersedes them.

Two shipped facts make this cheaper than it sounds and are recorded here
because they are the reason it was accepted, not as a design claim:
`DisplayContact` already declares `legalStatus` typed as `null` with the
comment that legal vocabulary belongs to the combat node, and
`scannerClass` already exists on a contact and already renders through
`targetDesignation`. Identity is also not naming from nothing —
`TrafficActor` carries a `callsign` and raiders have `raiderName`, so the work
is unifying two schemes rather than inventing one.

What did **not** exist when this was decided: any scan verb. The shipped scanner
was a passive display. **#364 has since built the verb this section deferred** —
its range, charge and equipment cost are owned by `carrier-scan.ts`, and the
record it writes by `carrier-identity.md` §5 — which retires the diagnosis and
leaves the decision standing: the verb landed in its own node, not here.

### D11 — Carrier identity and the scan are their own node

Same treatment as D6, chosen for the same reason: a cockpit verb and an
identity system outlive requests entirely, and folding them into the job
catalogue would put three unrelated decisions in one document. The principal
also declined folding them together with the damage node, which would bundle a
generation rule with a cockpit verb — two things tuned by different evidence.

### D12 — Jobs are independent of the ladders

Nothing in this spec reads a ladder rung. Jobs are gated by need (D8) and by
concrete requirements — a weapon, hold space, equipment.

No hook is reserved for a rung gate, and none is owed:
[Harmless to Elite](https://github.com/jcfischer/seelite/issues/183) ruled (D6)
that jobs, prices and stations read no ladder. A settled job's pay does count
toward the trade ladder, as realised margin does (D3); that is a ladder
reading a job, not a job reading a ladder.

Rejected: a rung weighting the pay, which is D9's second throttle wearing
different clothes.

### D13 — The courier floor's mark is the stock deficit

D4 and D8 collide at exactly one point: the floor courier is available where
nothing is broken, so it has no capability to restore. Its mark is the
**destination's stock deficit**, moved by the delivery as any trade moves it.

The principal was offered exempting the floor job from D4, and dropping the
floor entirely, and chose the deficit. It costs no new machinery: the deficit
is already saved per galaxy and already decays, both owned by
`economy-trade.md` §5.5.

## Detailed contract proposed for ratification

The following completes D1–D13. No job runtime, content or UI is delivered by
this document.

### 1. The five families

Each row names the decision the pilot makes in it, the world fact that posts
it, and what it needs that does not exist.

| Family | The decision it puts to the pilot | Posted by | Needs building |
| --- | --- | --- | --- |
| **Courier** | Which route, and whether its risk is worth the fee | A requester with goods to move; always available as D8's floor | Nothing — entrusted cargo is ratified by the request contract's D7 and §4 |
| **Procurement** | Where to source, and how much of your own capital to risk | A station with a real stock deficit | Nothing |
| **Bounty** | Whether to take a fight you could have flown past | An operational target carrier in the system — the pirate relay first ([#495](https://github.com/jcfischer/seelite/issues/495) D3–D4) | Built for the relay in [#508](https://github.com/jcfischer/seelite/issues/508), gated on the Long-Range Scanner. A ship as a target needs the scan (D10) and a ruling #495 left open |
| **Investigation** | How to read an instrument, and how long to keep looking | A lead whose subject has not been identified | Nothing — the relay prototype flew this loop |
| **Salvage** | Whether a known wreck is worth the detour | A destroyed carrier row | **A wreck-interaction verb** (D7) |

Courier and Procurement are distinct on one axis and it is not flavour: a
courier carries the requester's goods and cannot sell them, a procurer buys
with their own credits and carries the loss. The request contract's D7 already
separates the two ownership models.

### 2. The job row and its binder

A **row** is authored and carries what a person writes: the family, the title,
the requester's purpose, the danger text, the action, the consequence
sentence, the payment rule and any special terms. A row names no specific
commodity, carrier or station.

A **binder** is one function per family. It takes the posting station and the
live world, and returns either a bound offer or nothing when the family's
world fact is absent. Binding is where a commodity, a target carrier or a
destination enters.

Three rules hold the pair honest:

- **A row never contains an operand, and a binder never contains prose.** The
  moment a binder writes text, the ternary wall returns.
- **A binder is a pure function of the posting station, the world and the
  clock.** It performs no draw of its own beyond a domain-tagged stream, so
  the map's per-system RNG constraint holds and an offer does not change
  because the player docked twice.
- **A binder may return nothing.** That is D8's derivation: no deficit, no
  procurement offer.

Every offer produced this way carries the fields §2 of the request contract
requires, and acquires its stable identity from §1's scheme. This spec adds no
identity of its own.

### 3. Where offers come from

A system generates 0–3 stations, deterministically and conditionally — the
rule is `generateContents` in `src/system.ts` and is not restated here. So the
number of boards in a system varies, and a system with no station posts
nothing. That is correct rather than a gap.

Each station runs every family's binder. The offers that bind are the board.
The courier floor binds unconditionally at any station with a reachable
destination station, which is what keeps a board non-empty.

Offer count is therefore **not a configured number**. It is however many
family binders found a world fact, plus one.

**A station may post two courier offers (#408).** The courier family has a
second binder, the **Local run**, which applies the floor's rule to this
system's own stations only and declines where the posting system has no
second station. Its world fact is that second station. It is its own post on
the board — its own offer identity, draw stream and episode count (`JobPost`
in `src/jobs.ts`) — so settling one never rerolls the floor. Why it exists, and
who it is for, is `first-useful-day.md` D2.

### 4. What each job changes

D4 in concrete terms. Every mark below already has a typed home; none is a new
state domain.

| Family | The mark | Mechanism |
| --- | --- | --- |
| Courier | The destination's stock deficit moves | The existing deficit write, as a trade does |
| Procurement | The same, at the station supplied | The same |
| Bounty | The target carrier's condition becomes destroyed, with the player's provenance | The shipped destroy transition and its scheduled replacement |
| Investigation | A knowledge row records what was observed, with source and time | The existing per-galaxy knowledge domain |
| Salvage | The wreck's recoverable item is gone, once | Requires the D7 verb; the wreck itself is already derived |
| **Repair** (a courier or procurement job whose destination has a disabled capability) | The capability returns to operational, with the player's provenance | The `restore` transition, which exists and is **currently dead for stations** |

That last row is the load-bearing one for D4, and it comes with a warning.
`disabled` appears today only inside `world-state.ts`'s own machinery — no
generator and no station code writes it, and `station-commerce.ts` reads no
carrier condition at all. So a disabled station currently loses nothing. **The
projection from condition to lost capability has to be built**, and it is the
damage node's (§7), not this spec's.

### 5. Verification obligations

This document is a contract, not an implementation, and claims no test run.
What its implementation owes:

| Case | Required evidence |
| --- | --- |
| A row carries no operand | Headless: every authored row type-checks with no carrier, commodity or station field |
| A binder is deterministic | Headless: the same station, world and clock bind the same offer twice |
| A binder may decline | Headless: a station with no deficit produces no procurement offer |
| The courier floor always binds | Headless: every generated station with a reachable destination posts one |
| No offer rerolls on docking | Headless: dock, undock and dock again; identity and terms are unchanged |
| Each family's mark lands once | Headless: the mark is written on report and is not written twice on a repeated report |
| Repair restores a capability | Headless, once the damage node ships the projection: a disabled capability is unavailable, and available after the job |
| A board is legible | Browser probe on the docked console, plus the principal reading a real board |

The arithmetic and state halves are headless. The console is the browser
tier's, and `probe-station-console` is the row that has to keep passing.
**A doc-only change is not probed**; these obligations attach to the
implementation node, not to this merge.

### 6. Saved state

**This spec adds none.** The request journal and its schema bump are
`missions-and-requests.md` §7. Salvage reads existing destroyed rows. Derived offers are
derived. The generator bump that seeded damage needs belongs to the damage
node, where it can be sequenced against the bump
[#351](https://github.com/jcfischer/seelite/issues/351) already owes.

### 7. Handoff

Two child nodes carry what this spec deliberately does not decide:

- **The damage model** (D5, D6): the seeded floor's rate, the raider-caused
  rate, how the two interact, the condition-to-capability projection §4's
  repair row depends on, and the generator version bump and migration.
- **Carrier identity and the scan** (D10, D11): the naming scheme unifying
  `callsign` and `raiderName`, the scan verb's range, time and equipment cost,
  and filling `DisplayContact.legalStatus`.

Implementation of the catalogue itself attaches beneath #356 once both land,
because Bounty needs the scan and the repair mark needs the projection.
(#508 shipped Bounty for the relay, which has no standing to scan; the scan
is still what a ship target would need.)
Courier, Procurement and Investigation do not, and can ship first.

## Scope

This document decides the ordinary-job contract: the families, the authoring
format, where offers come from, what each job changes, the throttle, and the
rating relationship. It does not build a mission generator, a faction
simulation, police AI, or the expedition story's authored episodes. It does not
reopen the request contract, the combat model, the law model or the economy.
