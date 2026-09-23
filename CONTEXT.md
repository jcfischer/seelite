# seelite Domain Language

This glossary defines vocabulary for seelite's planned causal world model and points to the specs that own structural details. The core consequence terms originate in work-graph node [“Operational consequences: what can the player change?”](https://github.com/jcfischer/seelite/issues/41). The work-graph map (`soma graph node 1 --repo jcfischer/seelite`) owns the constraints and delivery rules both maps answer to. Since the 2026-09-21 split, gameplay nodes — missions, the expedition story, combat consequence, onboarding, progression — live on a second map, [#460](https://github.com/jcfischer/seelite/issues/460), which **adds constraints of its own on top of #1's**; working one of those nodes means reading both. A node linked from this glossary may sit on either map, so follow the link rather than assuming #1.

## Language

Each `_Avoid_` list is local to the canonical term immediately above it: it
names words that must not be used as aliases for that concept, not globally
forbidden vocabulary. A word can therefore remain canonical for a different
concept defined elsewhere in this glossary. In particular, **Berth** and
**Clearance queue** must not be used to mean **Transit lane**, while each keeps
its own distinct canonical meaning below; `Command` remains ordinary English
for controller input under the explicit scope note on **Intervention** — which
since #283 has a second consumer, `stepAngular`'s commanded rate, and a pad
binding table that speaks of pressing one.

**Display contact**:
A targetable presentation identity outside the generated body list. Its producer
supplies position, velocity, name, hull type and scanner classification;
`src/display-contact.ts` owns this shape under work-graph decision #52. A
contact's display name is a label, with no persistence identity or Carrier slot
meaning. `ship-visuals.md` §2 owns the review fleet's use of it; the other
producers include the raider, Traffic actors, the combat rig, the **Pirate
relay** and the **Cargo canister**.

**Review fleet slot**:
A `FleetSlot` layout position in the query-gated showroom avenue. Its `slot`
identifier describes the model and its placement; it has no Berth reservation,
aperture, station or docking semantics. `src/ship-mesh.ts` owns the layout.

**Carrier**:
A named physical asset, actor, or condition in the universe that enables a capability in a bounded consequence area.
_Avoid_: Modifier, influence point

**Carrier slot**:
The persistent identity for a generated place that survives destruction and replacement of its occupying carrier instance. `docs/specs/persistent-world-state.md` §2 owns its key structure.
_Avoid_: Bare global object ID, display name

**Station name**:
What a station is **called** — `QUERIOR`. A third thing beside its `id` (a
lookup key) and its **Carrier slot** (what a save row is filed under). Work-graph
decision “What is a planet called?” amended `docking.md` §12.5's E9: names are
drawn from a dedicated `DOMAIN.STATION_NAME` stream, one fixed sub-stream per
station-type slot, and locally redrawn on a collision. `src/station-name.ts`
owns that policy. The name remains display-only; neither lookup nor persistence
may switch to it.
_Avoid_: using this term for the persistence identity.

**CarrierKey**:
The canonical persisted identity of a carrier slot; a galaxy envelope may store its system-local pair and supplies the galaxy component. `docs/specs/persistent-world-state.md` §2 and §7 own the structure.

**Carrier instance**:
The original or a numbered replacement occupying a carrier slot.
_Avoid_: Replacement state

**Traffic actor**:
A ship in a station's stable **Traffic roster**, continuous across departures,
arrivals and time outside the player's view. It occupies a **Carrier slot**;
routine movement is not saved history. Its visible callsign and hull variant
derive from that identity and remain stable when it returns.
_Avoid_: Spawn, ambient ship, anonymous ship

**Traffic roster**:
The finite set of **Traffic actor** Carrier slots belonging to one station, one
actor per berth Traffic may call home — the catalogue minus the one berth a
station keeps free for a visitor (#277). Roster size is a population ceiling:
each actor's own
**Traffic schedule** takes it away from its berth for part of the cycle. Hulls
are deterministic draws from the station role's compatible pool, including its
required signature hull, so stations of one role can have different casts.
_Avoid_: Spawn table, traffic density

**Raider slot**:
A **Carrier slot** for a raider, belonging to a system rather than to a
station: one to four per system by government, keyed `raider-00` upward, with no
parent. Raider hulls stay out of every **Traffic roster**
(`station-traffic.md` §1); this is where they live instead.
`src/raider-slots.ts` owns the count and the ids, and
`persistent-world-state.md` §2 lists them in the namespace.
_Avoid_: Pirate spawn, random raider

**Encounter**:
One cruise leg's hostile approach to the player, by one or more raiders, from
the leg's seeded draw to its end: inbound, contest, duel, and over — missed,
broken, lost, escaped, fled or destroyed. `combat-model.md` §3's rating-chosen
composition makes it a group; today's only composition is a single raider
filling one **Raider slot** (#324, #183 owns the rest). It is not saved
history; what a destroyed raider leaves in the world is the slot's own
condition. `src/encounter.ts` owns the phases.
_Avoid_: Spawn, fight instance

**Cargo canister**:
A quantity of a single good dropped by a destroyed ship: one tonne from a
raider (one to three per kill), or one manifest line's tonnes from an ordinary
carrier (`civilian-combat.md` H11). Each leaves the wreck in its own direction and comes to rest ten
seconds later, in the frame of **the body the kill happened beside** as that
frame stands — its own, not a snapshot and not the observer's
(`combat-model.md` §4.1); it stays
until scooped or until five game-clock minutes pass (`combat-model.md` §4.1). A ship scoops one by passing close and
slow, with no module, taking what fits into the hold and leaving the rest in
the canister. It is a **selectable contact** of kind
`cargo` — scanner blip, target lock, and range plus the **relative speed**
(`REL`) on the cockpit Target instrument, which is the speed the scoop gate
checks. The green diamond alone gave a range and no speed, and the gate is a
speed (`hud-and-scanner.md` §3).
Flight state only: it is not saved.
`src/raider-wreck.ts` owns the drop and the scoop.
_Avoid_: Loot, salvage drop, jettisoned cargo

**Standing**:
Whether an ordinary carrier instance is Clean, Wanted or Fugitive at a game
time — derived, never saved, rotating on a clock term, and the true value the
law judges a shot against whether or not it was scanned. The player's own
standing is read off **Legal heat** in the same three words.
`carrier-identity.md` §2 owns the carrier's; `civilian-combat.md` H4 the
player's. A **Scan record** stores a reading of it, taken at a moment; it is not
it.
_Avoid_: Legal status (for a carrier), reputation, bounty flag

**Scan record**:
What the player keeps after pointing an Identity Scanner at an ordinary carrier
and holding it there: the **Standing**, the **Manifest**, and the **Carrier
instance** and voyage the reading was taken on, stamped with when. A member of
that carrier's knowledge row, so it is the player's, not the ship's — the
standing and the manifest themselves stay derived and unsaved. Its increasing age is
the point rather than a defect: an old record is an honest record of a ship that
may since have changed its cargo or its luck. A scan records **no** operational
condition; nothing about identifying a carrier's hold says anything about whether
its hull is sound. #364; `carrier-identity.md` §5 owns the semantics,
`world-state.ts`'s `CarrierScanObservation` the shape.
_Avoid_: Dossier, intel, scan (as a noun for the record — the scan is the act,
the record is what it leaves)

**Drawn name**:
A carrier's proper name — `RAANAR` — rolled from its Carrier key and the instance
it is, so the same ship is called the same thing in two sessions and a replaced
hull is called something new. What the cockpit names a target with, and what a
pilot remembers a ship by. **Display only, entirely**: it keys nothing, saves
nothing, looks nothing up, and `localCarrierId` remains the identity, which is
what makes renaming a carrier in a later generator cost nothing. `carrier-name.ts`
owns the **draw** — the domain, the instance seeding, the shape of a name; the
digram alphabet it draws from is `names.ts`'s, shared with every other name in the
galaxy. `carrier-identity.md` §1 the rule.
_Avoid_: Ship name (that is a hull's model — a `Porter` is a make, `RAANAR` a
name), callsign, label

**Registry**:
A carrier's registration designation — `Kestrel TR-03` — composed from its hull
model, its home station's role code and its roster ordinal. What a filing cites,
because it says which station a ship belongs to: read today it is the Flight
console's `REGISTRY` row and the raider log's line, and the kill feed a later node
writes will cite this rather than the drawn name.
The `TrafficActor` field is named `callsign`; the term is Registry because a
callsign is spoken and a registry is filed. Presentation, like the **Drawn name**,
and for the same reason: neither is a persistence key. Composed by
`carrier-name.ts`'s `trafficRegistry` since #364; `station-traffic.md` §3.2.

> **Scope of the `registry` alias** (added by [#486](https://github.com/jcfischer/seelite/pull/486), the same reading as the `Command` note below). The canonical term is a *carrier's* registration designation. `src/commands.ts` calls itself the **binding registry** — the table of `(command, trigger, scope)` #369 D1 ratified — which is a table of inputs and names no carrier. The two never meet in one sentence, and renaming either would make one word mean two things. Where the shorter word could be read as a carrier's, the prose says "the command registry" or names the module.

**Manifest**:
What an ordinary carrier instance carries on one voyage: one to four lines, each
a tonne good and its tonnes, derived and never saved. What a scan shows and what
a kill drops, one **Cargo canister** per line. `carrier-identity.md` §3 owns
it; `civilian-combat.md` H11 the drop. The Flight console prints this under the
word `HELD`, which is ordinary speech for what a ship is carrying, while the
field behind it is named `manifest` — because **Traffic hold** is a place a
carrier waits and `ScanHold` is a charge, and one identifier cannot serve all
three.
_Avoid_: Cargo list, loot table, hold contents

**Hold**:
The player ship's cargo capacity and what is in it: `usedT`, `capacityT`,
`freeT`, the entrusted share, and one line per good with its owner. `src/hold.ts`
owns the projection and `commanderHold` in `station-commerce.ts` owns the
capacity rule it reads; the station console draws it above the market rows and
the till refuses against the same figures (#443).

It is the *player's* hold and nothing else's. **Manifest** above is what an
ordinary carrier carries, **Traffic hold** is a place a carrier waits, `ScanHold`
is a charge, and a **held launch** is Traffic refusing one — four senses the same
English word reaches for, which is why each has its own name here.
_Avoid_: Inventory, cargo bay, hold contents (for the manifest)

> **Scope of the `hold` alias** (added by [#486](https://github.com/jcfischer/seelite/pull/486), the same reading as the `Command` note below). A fifth English sense is a **held key**: `Trigger.hold` in `src/commands.ts` says a binding is flown by keeping a key down rather than by pressing it — #369 D3 splits `x` pressed from `x` held on exactly that — and #381's storage slice writes it into `seelite:bindings`. It is a property of an input and never of cargo, a carrier or a launch, so it takes no canonical name here; it is listed because it is durable now, and a reader meeting `{ kind: "key", hold: true }` in a stored blob should find it rather than wonder which of the four it is. The `_Avoid_` line above is **Hold**'s and not this note's.

**Legal heat**:
The player's per-galaxy offence score: an offence adds to it, it decays lazily
on a 30-minute half-life, and it reads as Clean, Wanted or Fugitive at its
thresholds. Saved as `LegalStatus`; the reading is derived. `combat-model.md`
§4 owns the semantics, `civilian-combat.md` H4 the figures.
_Avoid_: Bounty, notoriety, wanted level

**Pirate relay**:
The first infrastructure **Carrier** (#43, production since #351): one
**Carrier slot** per system with a station, `relay-00`, standing a few hundred
kilometres off one station's approach and moving with it. Whether a system's
relay is *active* is a seeded roll that falls with government, 80% in an
Anarchy to 10% in a Corporate State; an inactive one is absent. Its capability
is **Route detection**: the system's raiders find most ships on the route to
the station it watches. It is found by its signal, identified inside its own
range, destroyed by the pulse laser, and replaced on the game clock.
`src/relay-slot.ts` owns its persistence ids and its plan, `src/pirate-relay.ts`
the rest; `docs/prototypes/relay-codex.md` records the prototype's decisions
and #351's receipt the production ones.
Not to be confused with the **System relay**, which is an information channel.
_Avoid_: Pirate base, sensor buoy, beacon

**Route detection**:
The pirate relay's dial on the leg law (`raider-slots.ts`' `RouteDetection`):
`law` is the ordinary draw; `watched` is a watched route while the relay is
operational, where 90% of legs meet a raider given an operational **Raider
slot** to send; `none` is that route while the relay is down. The dial moves
the chance's threshold and not the draw, so a `watched` leg meets the raider
the law would have sent. `combat-model.md` §3 states it beside the law.
_Avoid_: Encounter modifier, danger bonus

**Interdiction contest**:
The skill contest that decides an interdiction (`combat-model.md` §3): the
initiator holds a heading lock through a charge while following at part of its
turn authority, and the target breaks it by turning away. One function for any
initiator, player or NPC. `src/interdiction.ts` owns it.
_Avoid_: Interdiction minigame, pull-over

**Traffic schedule**:
A Traffic actor's game-clock sequence of parked and away intervals. An away
interval expresses desired home state rather than an arrival deadline. A
real visit may attach to that interval; physical travel and contention may
delay it. Each station role sets a parked-duty band, while
actor phases vary within it. At most one pending movement intent reconciles the
actor toward its current scheduled state under `station-traffic.md`'s “Delay
and reconciliation” rule. A full station's schedules always produce a departure
within one minute.
_Avoid_: Random spawn timer

**Traffic route**:
A home-owned Traffic actor's deterministic visit to another compatible station
in its current system and back. Its Carrier slot stays in the home Traffic
roster; the slot's **CarrierKey** identifies the visitor everywhere, and the
destination may hold its Berth for that key without adopting the slot. The
route composes the shared launch, cruise, Traffic hold, Clearance, Transit-lane
and arrival laws, and derives routine progress from the game clock.
A system with no eligible other station retains an abstract away interval.
_Avoid_: Spawn path, roster transfer, timetable

**Traffic hold**:
A deterministic station-relative point outside the docking cone where a
Traffic actor waits for a compatible Berth and the Transit lane. Holds are
off-axis and leave the player's approach corridor clear.
_Avoid_: Staging point, queue slot, parking berth

**Diversion**:
What a shot that opens a carrier's hull does to it. In one tick the carrier is
disabled with the shooter's provenance and taken in for repair under its home
station's, and from then on it is **parked at home**: drawn in a berth, holding
it, off its route and off the scanner, until the first departure its own schedule
makes at or after the repair's floor, when the same instance flies again. The
word is for the whole of it, not for the `disable` — a diversion is a place a
carrier is, and `trafficPresence` names which of `flying`, `parked-home` or
`absent` a carrier row describes. Killing a carrier that is on one is still a
kill, with its replacement schedule. `docs/specs/civilian-combat.md` H3b, H3c and
H3d own the decision, and `in-system-route-traffic.md` §5 what it does to the
projection.
_Avoid_: Recall, tow, recall-to-base, wound

**Held launch**:
The player's launch request after Traffic refused it, kept with its first
`readyAt` so it keeps its place in the Transit lane order (#314). It leaves by
itself on the first step the lane is the player's. It ends on cancel, on a
system change, or on any step the ship is not docked at that station. A state
of a request, not a place: a **Traffic hold** is a place. The code calls it
`launchHold` (`Game.launchHold`, `LiveCockpitState.launchHold`,
`LAUNCH_HOLD_NOTICE`); that name means this state and never a place.
_Avoid_: Launch queue

**Instance ordinal**:
The stable sequence number distinguishing the original carrier instance from its replacements. `docs/specs/persistent-world-state.md` §2 owns its allocation rule.

**Capability**:
What a carrier enables while it has a particular operational condition.
_Avoid_: Bonus, percentage effect

**Intervention**:
A player action that changes a carrier's operational condition or recovery process.
_Avoid_: Command, influence spend

> **Scope of the `Command` alias** (added by [#71](https://github.com/jcfischer/seelite/pull/71), and it is that PR's reading rather than a ruling from [#41](https://github.com/jcfischer/seelite/issues/41), which introduced the term and did not address the question). Every term in this file is a term of the **consequence model**, so the alias bans "Command" as a name for *a player act on a carrier* — not as an English word. `Game.command(id)` runs one command, and `resolveKey` and `resolvePad` map a keypress or a pad press to the ids it reaches in the layout in force — it was `Game.command(key)` until [#381](https://github.com/jcfischer/seelite/issues/381) folded the dispatch onto command ids, and the `commandKey(key)` that stood beside it through that node's first three slices went in its fourth — and `ComputerCommand` is one frame of an autopilot's output; neither is an intervention on a carrier, and renaming them would make the canonical term mean two things. If the model's owner reads the alias more widely than this, this note is what should be corrected.

**Operational condition**:
A carrier instance's objective physical condition. `docs/specs/persistent-world-state.md` §3.2 owns the enumeration.
_Avoid_: Status flag, lifecycle

**Last-known state**:
The player's timestamped knowledge of a carrier, from one approved information
channel or several. It holds a **Scan record**, an observed operational
condition, or both — a carrier that has been scanned and never docked at is
known, and knows nothing about its hull — plus any private facility facts. It may
differ from the objective condition when events happen out of sight. It never
expires; its increasing age carries the uncertainty until an approved information
channel refreshes it.

The same row also holds any **private facility facts** the player has checked —
black-market presence at a refinery is the only one in v1 (#275). Those are
scoped to the carrier's persisted identity rather than to the instance, so
unlike the observed condition they survive the carrier being destroyed and
replaced; the row stores only when the fact was learned and from what source,
never the generated value, which the baseline supplies once a marker exists.
_Avoid_: Live map state, discovery status

**Offer**:
Work available from a named requester. `docs/specs/missions-and-requests.md` §1–2 owns offer identity, details and acceptance.
_Avoid_: Accepted request (before explicit acceptance)

**Lead**:
Sourced intelligence about an object or search region. `docs/specs/missions-and-requests.md` owns observation, confirmation and refresh rules (§1 and §5). Retaining one is the `retain` action, and that is the word in the code and the save; the screen says **Keep for later** and labels the row **kept**. The principal read `Retain lead` and asked what it meant (#459) — one reader, so this is a ruling rather than a finding about players.
_Avoid_: Mission, confirmed target (for unconfirmed intelligence)

**Accepted request**:
A job the pilot has explicitly committed to undertaking for a requester. `docs/specs/missions-and-requests.md` owns concurrent commitments and progress (D1 and §3).
_Avoid_: Active mission (when implying a single accepted job)

**Tracked request**:
The accepted request the pilot has chosen to guide the cockpit next-action cue. `docs/specs/missions-and-requests.md` owns manual tracking and its interface (D2 and §6).
_Avoid_: Active request (when conflating tracking with acceptance)

**Ready to report**:
An accepted request whose objective has been satisfied but whose result has not yet been reported to the requester. `docs/specs/missions-and-requests.md` §3–5 owns report eligibility and settlement.
_Avoid_: Completed request (before reporting)

**Search region**:
The bounded area a lead gives the pilot to search before identifying a hidden target. `docs/specs/missions-and-requests.md` owns region cues and identification boundaries (D5 and §6).
_Avoid_: Target position (before identification)

**Entrusted cargo**:
Requester-owned goods carried in the pilot's hold for a request. `docs/specs/missions-and-requests.md` §4 owns hold usage, sale restrictions and return/loss settlement.

_Avoid_: Player cargo, reward cargo

**Scope note, not an _Avoid_ line.** The pilot *hands over* a consignment;
they *deliver* goods of their own. **Deliver** stays canonical — it is the
action id, the DOM attribute and the right word for a procurement job — so it
does not belong on this entry's _Avoid_ line, which is for words canonical
nowhere. What the rule bans is the narrower thing: `Deliver N t X` as the
**label over cargo already aboard**, where it reads as an instruction to
supply something. #446
found a pilot buying 8 t of Food they were already carrying; the details pane
read *entrusted* at the time, so what the two together show is that the label
on the control is what gets acted on, not that the label alone caused it.
`deliverAction` in `src/requests-view.ts` owns both labels and
`tests/requests-view.test.ts` holds the entrusted one against `/deliver/i`. The
same distinction runs through the in-flight cue (*carried* against *sourced*)
and the settlement.

**System relay**:
The public station-condition report received when the initial world is
established or the player later enters a system (#116). It refreshes Last-known
state for every station there, and preserves any private facility facts already
checked, but reveals no new ones such as black-market presence. Opening the Galaxy Map does not contact a System relay.
_Avoid_: Live galaxy feed, long-range scan
_Scope_: that Avoid line bans the phrase as a name for **this report** — the
phrase is quoted there and here to name the ban, not used as a name. It does
not reach the **Long-Range Scanner** below, which is a bought module and a
different thing entirely: a report about stations against a reading of one
carrier's signal.

**Long-Range Scanner**:
The module a pilot buys at a Shipyard for 1,000 Cr (#481, under #468) to read
a **Pirate relay** at all: strength and bearing at range, identification much
closer in, which is #43's close regime — `pirate-relay.ts` owns both figures
and nothing restates them. Unfitted, nothing is read: no cue, no contact, no
target, and no identification is recorded. **An identification already
recorded is not erased, only unread** — the relay goes dark and is found again
when the module is back. The relay's **Route detection** dial is deliberately
untouched, so the effect is felt by a pilot who cannot find its cause (#479).
Not the **Identity Scanner**, which reads a hull held on target.
_Avoid_: system scanner, sensor upgrade

**Recovery process**:
A named, visible, and interruptible in-world process that repairs a carrier instance or replaces it with a new one.
_Avoid_: Respawn timer

> **`repairing` is the persisted spelling of "a recovery process is live"** — both kinds, repair and replacement. A carrier awaiting a replacement is `repairing` in `docs/specs/persistent-world-state.md` §3.2's enumeration and in `src/world-state.ts`, which is narrower than this entry reads. **The exception is a scheduled replacement (#324 part d):** a destroyed row carrying one stays `destroyed` until `startsAt`, and it becomes `repairing` only when the lazy start materializes (§4). The descriptor's own `kind` says which process it is, and §4 makes the kind decide the valid completion. Renaming the condition is a `worldSchemaVersion` bump, so it is a decision rather than a tidy-up.

**Causal episode**:
The bounded provenance unit for the latest related operational transitions at one carrier slot. `docs/specs/persistent-world-state.md` §5 owns its retained facts and compaction rule.
_Avoid_: Full event log

**Incident**:
The unit an offence is *priced* on: one strike on a carrier and the kill that ends that strike's repair, charged as the largest offence in it rather than as their sum — 15 then 25, 40 together, never 55. It is not a **Causal episode**, and the difference is not a matter of taste: the kill's `interrupt` closes the strike's episode and its `destroy` opens one that replaces `episodes[key]` wholesale, so a strike and the kill that follows are *two* episodes and the ledger keeps no memory of the first. What carries the charge instead is **the incident's own record**, and since #396 that is two places rather than one: the carrier's own row for a hull strike and a kill — `trafficPresence` says whether the ship is standing in its home berth, and the repair's `startedAt` is the clock the standing the strike was judged on derives from, standing being never saved — and `LegalStatus.assaulted` for the sustained-fire rung, which lands *before* that row has anything to say because the one transition an ordinary carrier gets from the player is H3c's `disable`, written by the strike. `docs/specs/civilian-combat.md` H9 owns the ruling and H6 why the second list is where it is. **The two are read by different hands:** the carrier's row is read inside `chargedOffence`, and the assault list is read by its caller — `main.ts`, through `assaultCharged` — and handed across as an argument, because `chargedOffence` is given the world's facts and touches no world. `marginalOffenceHeat` does the arithmetic on what it is passed. **No _Avoid_ line, deliberately:** the word to avoid naming this unit with is "episode", and **Causal episode** is canonical two lines above, so an alias line here would misfire on correct prose — as the one under **Transit lane** did.

**Sustained fire**:
The third rung of an offence against a Clean carrier — `ASSAULT_FIRE_S` seconds of fire that has *landed* on one carrier, charged at `OFFENCE_HEAT.assault` and **held across the gaps** between hits, because the act is the pilot's intent measured in what it did to the hull rather than in whether the crosshair stayed steady. **The persisted and API spelling is `assault`** (`LegalStatus.assaulted`, `markAssaultCharged`), and the rail the pilot meets it on says "sustained fire": one rung, three spellings, and the reason is that the save and the function names were written first and the player's word came from the flight report. It is not a **Hearer**'s doing — an offence with nobody in earshot is still charged — and it is not the strike: the rung exists precisely because the hull has not yet agreed. `docs/specs/civilian-combat.md` H4 owns the duration and the interval the figure may not leave.
**Scope note, not an _Avoid_ line.** `assault` is canonical as the save's and API's spelling — `OFFENCE_HEAT.assault`, `markAssaultCharged`, `LegalStatus.assaulted` — so an _Avoid_ line naming it would misfire on every correct use of it, which is the shape §Language's Transit lane note rules out by name. What is worth saying is the scope: the strike is an assault too, so "charged with assault" means two rungs unless the rung is named. "Sustained-fire charge" is the phrase to drop, because the charge is the heat and the fire is the act.

**Hearer**:
A station that was within earshot when an offence was committed against a carrier — `DISTRESS_RANGE_KM` in a straight line from the **victim**, never from the pilot, which is #396's amendment of the frame-body reach `civilian-combat.md` H5 had inherited. `src/distress.ts`'s `stationsInEarshot` computes the set and `withOffence` requires it, so an empty set is the answer "nobody heard it" and not the absence of having looked. **It is the physics, not the verdict.** Being heard is what puts a berth in `LegalStatus.witnesses`, and the refusal H5 names needs the heat the same act filed as well — which is why `distress.ts` returns keys and no judgement, and why the two words are not interchangeable in either direction.
_Avoid_: Bystander, neighbour (both say "near" where the rule is "heard")

**Causal-episode ordinal**:
The stable sequence number distinguishing successive causal episodes at one carrier slot. `docs/specs/persistent-world-state.md` §4 owns allocation; §5 owns retention and compaction.

**Consequence area**:
The station, system, or named route affected by a carrier's capability.
_Avoid_: Territory

**Aperture frame**:
The station-local frame the docking checks are stated in: the outward aperture axis, the slot's current roll, the aperture rectangle, and the **phase-zero reference** the roll is measured from. `docs/specs/docking.md` §3 and §5 own its content; `src/docking.ts` is the one place it is *assembled*, and `src/sim.ts` is the one place the reference comes from — the station's own along-track direction, because that is where the orbit is and because a reference derived from the axis alone jumps as the axis swings (#126). Every tolerance is measured in the station's *velocity* frame, never the star's.
_Avoid_: Docking port, world-space approach vector

**Closing-speed gate**:
The bound on `|v_rel|` at the instant of crossing the aperture plane, measured in the station's frame. `docs/specs/docking.md` §3 owns the figure; §3.1 owns why it is that figure.
_Avoid_: Approach speed limit, docking speed

**Clearance grant**:
A station's time-boxed permission to enter, and a **precondition** rather than one of the checks. Crossing without a live one is a failed entry *and* turns the station hostile. Since §13.2 the grant **is** a berth reservation — it names the berth the ship will park in, it queues when no free berth fits, and it is spent when the ship crosses the aperture outward. `docs/specs/docking.md` §6 owns the protocol and its queued and denied replies; §13.2 owns the reservation.
_Avoid_: Docking permission flag, landing request

**Clearance queue**:
The station-local order of ships waiting for a fitting free **Berth**. The
oldest compatible request advances first; request time orders it and stable
**Carrier** identity breaks a tie, equally for the player and Traffic actors.
Its visible position is one-based and updates with the live queue.
_Avoid_: Occupancy count, player queue, NPC queue

**Transit lane**:
The one-ship path through a Station interior between its aperture and staging
point. A traversal is non-preemptive; the oldest ready arrival or launch goes
next, with a simultaneous launch first because it releases a Berth. A Traffic
arrival reserves it before leaving its Traffic hold.

**A lane is not a Berth — and this entry no longer lists Berth under _Avoid_.**
That listing was read as a ban on the word, and a ban on the word forbids the one
distinction an interior is made of — which occupancy a ship is waiting for. The
body above names both in one breath, which is the honest way to keep them apart: a
launch releases a Berth, and a Traffic arrival reserves the lane before leaving its
hold. An _Avoid_ line that names a canonical term misfires on every correct use of
it — #365's first review round spent 54 findings on the word *berth* for exactly
this — so only words that are canonical nowhere belong here. `Clearance queue` and
`approach corridor` do; **Berth** does not, and neither does the `disable` that
#365's **Diversion** first listed beside its own aliases. **Berth** carries the
matching note about its own four senses of "pad".

**Station interior**:
What lies at a station's aperture, in one of two **presentations** decided by `aperture.kind` (#165). Computed in exactly one place, `src/station-interior.ts`, and drawn in exactly one, `src/station-interior-mesh.ts`; `docs/specs/docking.md` §13.1 owns the topology of both.
_Avoid_: Hangar, throat, docking bay corridor

**Bay**:
A **slot** role's interior — trade and shipyard: the enclosed, unpressurized volume *beyond* the aperture, a role-scaled room with a permanently clear central **transit lane** running from the open mouth to a **staging point**, and berths on its four walls. It has no door — the aperture frame and the name shield stay visible from every berth.
_Avoid_: Hangar, throat
"Throat" is an alias for this and for **Station interior** when it means the way into a station. An engine bell has a **throat** of its own — a nozzle's narrowest section, where `ship-mesh.ts`'s open bell (#203) starts its glow — and that is the rocket's word rather than a synonym for a bay. A reviewer flagging it there has found the English word.

**Landing pad**:
A **pad** role's interior — refinery and outpost: an open deck *at* the aperture plane with berths standing on it around a central landing lane, no enclosure, and an uncut hull behind it. Its volume runs **outward** from the deck to the staging point, so `endAxialKm === mouthAxialKm` and `interiorAxialSpanKm` is the one place that ordering lives. Ratified by the principal on #165, reversing §13.1's bay for those two roles.
_Avoid_: Touchdown deck, apron, exterior pad

**Berth**:
Where one ship parks in a station interior, addressed as **interior face × depth band** — deck, port wall, starboard wall or overhead; near or deep. In a bay the face is the wall the berth is bolted to; on a landing pad there is one surface, so the face is the *side of the landing lane* the berth stands on and every berth is in the `near` band, because a deck has no depth. Its **family** (open deck pad, wall-side berth, recessed service cradle) changes presentation and parked pose and never the docking interaction. It accepts a hull when its declared clear length, beam and height contain that hull's envelope; there is no S/M/L class. `docs/specs/docking.md` §13.2 owns the catalogue, the fit predicate and the allocation.
_Avoid_: Docking bay, slot, pad, landing pad
These are aliases for **a berth** and nothing else. **The scope note is the point of the entry, not a footnote to it**, and it has grown once already: the repo has had to correct one alias that read as banning an English word. "Slot" is an aperture kind — `aperture.kind === "slot"` is code. "Pad" now carries **four** senses that are not this one — a berth *family* (open deck pad), the surface a ship settles onto (`berth-pad`), since #165 an aperture kind and the interior presentation that goes with it (**Landing pad** above), and since #283 the **game controller**: `src/gamepad.ts`, `PadFrame`, `padIntents`, `docs/gamepad.md`. That fourth one arrived as a *copy* — the module is byte-identical to seekolous's and says "pad" throughout — so it could not have been renamed here even if the sense were worth renaming, and it is not: a controller is what every player calls a pad. Since #90 "slot" carries a **second** sense of its own: a **save slot** is one named save — `src/save-store.ts`, `CommanderCatalog.slots()`, `exportSlot`, and #89's D6, which ratified the word. It holds two records, `live` and `lastDocked`, and has nothing to do with where a ship parks. The player never sees the word: what a player sees of a save slot is a **Commander** (below). The first version of this sentence claimed the two senses "do not meet in any one file", and the change that introduced it refuted that six lines apart: `releaseBerth` and `saveDirty` sit in the same block of `main.ts`, because releasing a berth is exactly when a save stops describing a parked ship. They meet, and it does not matter — the disambiguation is the word beside it, and `saveSlot`, `exportSlot` and `SaveRecordKind` never read as a place to park. A reviewer flagging one of those has found the alias rule firing on an English word rather than on a synonym for a berth.

**Commander**:
What the player sees of one **save slot**: a named save, with its galaxy seed and
its permadeath flag, listed, loaded, exported, imported, renamed and deleted in
the Commander overlay. Its name **is** the slot key. It is the whole save — both
of the slot's records — and not `CommanderRecord`, which is only the player half
of one `SaveEnvelope`. `docs/specs/persistent-world-state.md` §11 owns the
overlay and the active-Commander pointer. **Scope note:** `slot` and
`CommanderCatalog`'s `slots()`, `exportSlot`, `importSlot`, `renameSlot` and
`deleteSlot` are the storage layer's words for the same thing and stay as they
are; this entry governs what a player reads, not what the store calls its keys.
_Avoid_: save game, save file, profile (in player-facing text)

**Failed entry**:
A crossing of the aperture plane that does not satisfy every check. It repels the ship, damages it, and keeps its clearance grant; unless it was a barge it does not turn the station hostile. Damage is quadratic in the closing speed above a floor, so a failed entry at the gate speed is survivable by design while one flown at the assist cap is not — "it costs you something, not everything" is a claim about the gate, not a guarantee at any speed. `docs/specs/docking.md` §2 owns the model.
_Avoid_: Crash, docking failure

**Operational consequence**:
A mechanically different later situation produced by an intervention and attributable through world evidence and a persistent record.
_Avoid_: Flavour text, global influence

**Jump**:
The act of moving between star systems (`docs/specs/galaxy-generation.md` §8),
built in #187. Three seconds of **wind-up** flown in normal flight — the window
§8 makes the pilot vulnerable inside, and the same seconds cruise's spool
borrows — then a **witchspace transition** that costs no sim time, then an
arrival 1 AU out on §7.4's **inbound bearing**. It spends the **hyperspace
tank** by the light year and leaves the cruise **drive charge** alone; the two
consumables are separate by `in-system-travel.md` §7. `src/hyperspace.ts` owns
the range gate, the cost and the wind-up; `src/sim.ts`'s `jumpWorldTo` owns what
it does to a `World`.
_Avoid_: Warp, hyperjump, hyperspace jump (as a verb), FTL
"Cruise" is the other superluminal regime and is *in-system*; calling either one
"warp" makes the pair unnameable.

**Hyperspace tank**:
The 7 LY jump fuel, spent by distance and bought at any station's equipment
screen at `economy-trade.md` §6.1's 0.2 Cr per 0.1 LY. Its capacity is
`galaxy.ts`'s `JUMP_RANGE_LY` and deliberately **not** the flown hull's
`tankLy`, because that constant is the connectivity graph's edge predicate —
#185 is the node that makes both hull-aware. Distinct from the **drive charge**,
which is cruise's own 12 AU reserve with free refills on docking.
_Avoid_: Fuel (unqualified), drive charge, energy (unqualified)

**Energy bank**:
A ship's shared combat reserve (`combat-model.md` §2): lasers spend it, and it
recharges the lower shield first, so weapon fire and recovery compete. It
regenerates on its own while the gun is idle and is never bought or refuelled.
`src/ship-condition.ts` owns its figures. Distinct from the **Hyperspace tank**
and the **drive charge**, which move the ship; the energy bank never does.
_Avoid_: Energy (unqualified), capacitor, power

**Witchspace**:
Where the ship is between two systems. It costs no sim time today: the clock
advances by the wind-up, which is flown, and by nothing else — so a jump does
not turn over #25's 30-minute market epoch and is not a way to wait a market
out. Misjumps and witchspace ambushes are reserved to #8, and the tunnel as a
*rendered* thing is unbuilt.
_Avoid_: Hyperspace (as a place), jump space

**Galactic frame**:
Galaxy space — the coordinate system `galaxy.ts` places the 256 systems in, whose
reference plane is `y = 0` and whose centre is the cluster's density peak. Its
reference-plane normal has exactly one **named** author in `src/` —
`GALACTIC_NORMAL` in `src/galaxy-frame.ts`, which the chart reads rather than
restating — and one structural one, `GALAXY_FLATTENING_Q` in `galaxy.ts`, which
flattens onto that axis as a choice of component. A row ties the two.
`galaxy-generation.md` §2 owns the shape and §11 the frame.
_Avoid_: Galaxy space (as a type or constant name), universe frame, ecliptic

**System frame**:
A single system's own world frame — the one the ship flies in, the sim is written
in, and the renderer draws. Its reference plane is `z = 0`, the planets' orbital
plane, and `hud.ts`'s attitude reference calls its normal "up". Distinct from the
**Galactic frame**, which it has no fixed relation to: a system's planets and a
cluster 24 light years across are not coplanar by anything but coincidence.
_Avoid_: World space (unqualified), ecliptic

**Sky frame**:
The seeded rotation that carries the **Galactic frame** into one system's
**System frame**, so a direction in the cluster can be said as a place in a
particular pilot's sky. One per system, drawn from its own domain tag, isotropic
over rotations — what that buys and what it costs is §11's to say, including
that an isotropic draw rules nothing out. `src/galaxy-frame.ts` owns the
arithmetic; `galaxy-generation.md` §11 owns the ruling.
_Avoid_: Attitude (that is the ship's own quaternion)

**Galactic pole**:
Where a **Sky frame** lands the cluster's reference-plane normal — the direction
"straight up out of the galaxy" looks like from this cockpit, and therefore the
axis any cluster structure is arranged about. Varies per system, by design.
_Avoid_: Zenith, galactic north (unqualified)

**Core bearing**:
The direction from here to the cluster's centre, in the observer's own sky. Worth
stating because it is the one bearing that carries information rather than light —
which is #100's measurement. §11 of `galaxy-generation.md` is where the rule is
written down once, and §12 is where the measured cone figures are — how much of a
sky's other systems a star near the rim puts inside a cone on the centre, against
what uniform spacing would — reprinted by `scripts/measure-sky-density.ts core`.
`coreBearing` in `src/galaxy-frame.ts`.
_Avoid_: The way home, galactic down

**Derived sky**:
The points that *are* systems — one for every other system in the galaxy, at its
true bearing through the observer's **Sky frame**, sized by how far away it is and
coloured by the class of the sun a pilot finds there. Rebuilt on every **witchspace
transition**, because it is a picture of where the player is standing. `systemField` in
`src/backdrop.ts`; `galaxy-generation.md` §12 owns the size law and the figures.
**Scope note, not an _Avoid_ line.** `StarField` is the buffer shape *both* layers
return — `systemField` and `faintField` hand back one apiece, and `main.ts` imports
the type — so a ban on the words would fire on every correct use of them, which is
the misfire §Language rules out by name. What is worth saying is the scope: since
#431 there are two point layers, so **"the star field" unqualified** and **"the
bright stars"** are both ambiguous, and the sentence should name which one.
Brightness is not what makes the derived sky real: the invented points are drawn
smaller, and the systems are systems, for two different reasons.

**Invented population**:
The scattered points behind the **derived sky** — a uniform scatter over the
sphere from the world seed, never rebuilt, and there because 255 systems is not a
night. Every one of them is drawn **smaller** than the smallest real star, which is
the ordering the counts make necessary — the invented population outnumbers the
derived one by an order of magnitude in every direction, so size is the only channel
in which the real layer can read as structure at all. Two things that sentence does
not do: it does not say the derived sky *is* legible, which is a question about a
picture and belongs to #433's sheet and the principal's yes; and it does not say no
invented point delivers more light than a real one, which is `size²` times a tint,
and the two layers' tints are not yet on one scale (§12, `grain` mode).
`faintField` and `FAINT_COUNT` in `src/backdrop.ts`; §12 says what that costs.
_Avoid_: Dust, filler. **Scope note, not a ban on "background"**: both populations
sit *in* the background layer, so the words "background stars" name whichever one
the sentence means and nothing is renamed here. What the sentence has to name is
which population — an invented point and a system are not interchangeable, and the
invariant between them is the reason.
