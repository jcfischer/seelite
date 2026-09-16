# seelite Domain Language

This glossary defines vocabulary for seelite's planned causal world model and points to the specs that own structural details. The core consequence terms originate in work-graph node [“Operational consequences: what can the player change?”](https://github.com/jcfischer/seelite/issues/41). The work-graph map (`soma graph node 1`) remains authoritative for constraints and delivery rules.

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
meaning. `ship-visuals.md` §2 owns the review fleet's use of it.

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
One tonne of a single good, dropped by a destroyed raider (one to three per
kill). Each leaves the wreck in its own direction and comes to rest ten
seconds later, relative to the local frame's velocity at the kill; it stays
until scooped or until five game-clock minutes pass (`combat-model.md` §4.1). A ship scoops one by passing close and
slow, with no module, into the hold. Flight state only: it is not saved.
`src/raider-wreck.ts` owns the drop and the scoop.
_Avoid_: Loot, salvage drop, jettisoned cargo

**Pirate relay**:
The first infrastructure **Carrier** (#43, prototype): one **Carrier slot** per
system, `relay-00`, standing a few hundred kilometres off one station's
approach and moving with it. Its capability is **Route detection**: the
system's raiders find every ship on the route to the station it watches. It
is found by its signal, identified inside its own range, destroyed by the
pulse laser, and replaced on the game clock. `src/pirate-relay.ts` owns it;
`docs/prototypes/relay-codex.md` records the decisions taken as proposals.
Not to be confused with the **System relay**, which is an information channel.
_Avoid_: Pirate base, sensor buoy, beacon

**Route detection**:
The pirate relay's dial on the leg law (`raider-slots.ts`' `RouteDetection`):
`law` is the ordinary draw; `certain` is a watched route while the relay is
operational, where every leg meets a raider given an operational **Raider
slot** to send; `none` is that route while the relay is down. The dial skips
the chance and not the draw, so a `certain` leg meets the raider the law would
have sent. `combat-model.md` §3 states it beside the law.
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

> **Scope of the `Command` alias** (added by [#71](https://github.com/jcfischer/seelite/pull/71), and it is that PR's reading rather than a ruling from [#41](https://github.com/jcfischer/seelite/issues/41), which introduced the term and did not address the question). Every term in this file is a term of the **consequence model**, so the alias bans "Command" as a name for *a player act on a carrier* — not as an English word. `Game.command(key)` dispatches a keypress and `ComputerCommand` is one frame of an autopilot's output; neither is an intervention on a carrier, and renaming them would make the canonical term mean two things. If the model's owner reads the alias more widely than this, this note is what should be corrected.

**Operational condition**:
A carrier instance's objective physical condition. `docs/specs/persistent-world-state.md` §3.2 owns the enumeration.
_Avoid_: Status flag, lifecycle

**Last-known state**:
The player's timestamped knowledge of a carrier instance and its observed
operational condition. It may differ from the objective condition when events
happen out of sight. It never expires; its increasing age carries the
uncertainty until an approved information channel refreshes it.

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
Sourced intelligence about an object or search region. `docs/specs/missions-and-requests.md` owns observation, confirmation and refresh rules (§1 and §5).
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

**System relay**:
The public station-condition report received when the initial world is
established or the player later enters a system (#116). It refreshes Last-known
state for every station there, and preserves any private facility facts already
checked, but reveals no new ones such as black-market presence. Opening the Galaxy Map does not contact a System relay.
_Avoid_: Live galaxy feed, long-range scan

**Recovery process**:
A named, visible, and interruptible in-world process that repairs a carrier instance or replaces it with a new one.
_Avoid_: Respawn timer

> **`repairing` is the persisted spelling of "a recovery process is live"** — both kinds, repair and replacement. A carrier awaiting a replacement is `repairing` in `docs/specs/persistent-world-state.md` §3.2's enumeration and in `src/world-state.ts`, which is narrower than this entry reads. **The exception is a scheduled replacement (#324 part d):** a destroyed row carrying one stays `destroyed` until `startsAt`, and it becomes `repairing` only when the lazy start materializes (§4). The descriptor's own `kind` says which process it is, and §4 makes the kind decide the valid completion. Renaming the condition is a `worldSchemaVersion` bump, so it is a decision rather than a tidy-up.

**Causal episode**:
The bounded provenance unit for the latest related operational transitions at one carrier slot. `docs/specs/persistent-world-state.md` §5 owns its retained facts and compaction rule.
_Avoid_: Full event log

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
_Avoid_: Berth, Clearance queue, approach corridor

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
