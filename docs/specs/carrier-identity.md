# Carrier identity and the scan

Author: Ivy · 2026-09-16
Status: F1–F12 are agreed. The detailed contract becomes ratified on
principal-approved merge recorded in the linked decision's resolution.
Decision node: [Every carrier has a name, and a scan says who is
wanted](https://github.com/jcfischer/seelite/issues/359).

This spec owns **what every carrier is called, whether it is wanted, what it is
carrying, and the cockpit verb that finds all three out**. It is the second of
the two children [Ordinary work](https://github.com/jcfischer/seelite/issues/356)
named in its §7: its D10 and D11. The Bounty family cannot ship until this one
does.

Decision codes are **F**, continuing the parent's D and the sibling damage
spec's E, so no code means two things across the three documents.

## What this spec does not own

| Fact | Owner |
| --- | --- |
| Job families, offer derivation, the courier floor, what each job's mark is | `ordinary-requests.md` (node #356) |
| What breaks at a station, the damage floor, the capability projection | `station-damage.md` (node #358) |
| Legal status semantics, heat, thresholds, contraband scans of the player, bounty legitimacy | `combat-model.md` §4 |
| Raider slots, their counts, operational condition, leg chance and their kill-time cargo drop | `combat-model.md` §3 and §4.1 |
| Per-carrier state bounds, transitions, knowledge rows, provenance, the six galaxy domains | `persistent-world-state.md` §2–§8 |
| The commodity table and which goods are illegal | `economy-trade.md` §2 |
| Traffic rosters, schedules, hull pools and the carrier namespace | `station-traffic.md` §1 |
| Browser-only delivery, determinism, per-system RNG streams | the map's Constraints |

Where a figure from one of those is relevant below, this spec **points at its
owner rather than copying it**. §8 is the separate list of rules this spec makes
*false* — those are amended, not pointed at.

## The state of the code this is written against

> **A dated snapshot, kept as written, and this is the drift since it was
> taken.** #364 built this contract, so four of the facts below are now history:
> `legalStatus` is **`standing`** and typed `CarrierStanding | null`;
> `station-traffic.ts` no longer composes the callsign (`carrier-name.ts`'s
> `trafficRegistry` does, beside the draw); the knowledge row carries a scan
> observation and a row may hold one with no condition observation at all; and
> `WORLD_SCHEMA_VERSION` is 3, with no migration table (§9.6's ruling, §9.10's
> precedent). The line numbers are the ones this spec read on the day it was
> written. Do not "fix" them — a snapshot that is quietly rewritten stops being
> evidence about what was known when.

Verified on `main` at `2a80e14`, 2026-09-16. Four of these findings changed a
decision rather than decorating it.

- **`DisplayContact.legalStatus` is typed as literally `null`**
  (`src/display-contact.ts:13`), with the comment that legal vocabulary belongs
  to the combat node. **Six** producers set it null — `station-traffic.ts:482`,
  `combat-rig.ts:378` and `main.ts` at 1789, 1811, 5058 and 8358. The field was
  reserved for exactly this.
- **`scannerClass` already renders in the Target panel.**
  `targetDesignation` (`src/display-contact.ts:46`) prints
  `SHIP · <HULL> · <CLASS>` from `unknown | civilian | hostile | station`.
- **The raider contact is already `hostile`** (`src/main.ts:1789-1790`), its hull
  is called `Marauder` (`src/station-traffic.ts:70`), and `station-traffic.md`
  §1 keeps raider hulls out of every station roster. So hull, silhouette and
  designation all answer *is this a pirate?* before any scan. This is why F1
  makes ordinary carriers the scan's subject.
- **A raider's cargo does not exist until it dies.** `src/raider-wreck.ts:185-188`
  seeds the drop with `mix(mix(systemSeed, fnv1a(key)), second)` — the second of
  the kill. A hold knowable in advance cannot be that draw, which is why F10
  leaves raiders out of the manifest scheme.
- **Ordinary traffic cannot be destroyed.** `src/duel.ts` and `raiderInSights`
  handle the raider alone, and `Game.takeDamage` (`src/main.ts:8132`) is the
  player's own. Nothing in the game can shoot a Porter. F6 therefore spawns a
  child node rather than a paragraph.
- **Nothing writes legal heat.** `setLegalHeat` exists in `src/world-state.ts`
  and is called only from `tests/`. The offence-to-heat write is unbuilt, which
  F7 records as debt rather than inventing.
- **`carrierBaselineFingerprint` hashes identity, type, parent and placement —
  never condition or any other property** (`src/world-state.ts:400-430`). So
  standing and manifest, expressed as derived properties, need **no**
  `WORLD_GENERATOR_VERSION` bump. The sibling damage spec's §7 reached the same
  finding and forwent it for its own reason; this spec takes it.
- **The universal equipment list is full.** `UNIVERSAL_GATE_CAP = 10`
  (`src/market.ts`) and `station-types.md` §4.1's table holds exactly ten, with
  §4.2's `min(displayTL + 3, 10)` saturation argument resting on that count. An
  eleventh universal item breaks both, which is why F12 takes a shipyard slot.
- **`awayOrdinal` is a stable voyage index.** `trafficScheduleAt`
  (`src/station-traffic.ts:195-205`) returns the cycle number, and it holds for
  the whole away interval. F11 keys the manifest on it.

## Agreed decisions

Principal evidence throughout is a live grilling session on 2026-09-16, one
question at a time, each decision selected explicitly. **Three were taken
against the agent's recommendation and are marked.**

### F1 — Ordinary carriers can be wanted; raiders stay visibly hostile

The scan's subject is **ordinary traffic**. A Porter in a trade roster may be
Clean, Wanted or Fugitive, and neither its silhouette nor its designation says
which. Raiders keep the hostile reading they ship with today.

The principal was offered this, an instrument that withholds hull type and class
from every contact until scanned, and both together, and chose this.

The alternative is rejected on a verified cost rather than taste: withholding
hull type would change all six `DisplayContact` producers and make the passive
scanner less informative than it is today, to answer a question the silhouette
answers anyway.

**This decision is why the node was worth taking.** With standing a property of
the hull, a scan reveals nothing — the pilot already knows. Deriving wanted
status *from kind* was ruled out by the same reasoning and is not on the table
below.

### F2 — Standing is derived, with a clock term

A carrier's standing is a **pure function of the world seed, the carrier key and
the game clock**, under its own `DOMAIN` tag. Nothing is persisted.

The principal was offered this, the same draw without a clock term, and a
seventh persisted galaxy domain, and chose this.

This is the sibling damage spec's E4 shape reused deliberately: a derived
baseline, recomputed on read, exactly as `persistent-world-state.md` §8 requires
of a projection. It costs no state domain, no schema bump and — per the
fingerprint finding above — no generator bump.

The clock term is what keeps the galaxy from being solved. A static draw makes a
system you have scanned once permanently answered, and a bounty board over the
same traffic never refreshes. It is also consistent with the shipped law model,
where the *player's* own heat decays on a 30-minute half-life
(`combat-model.md` §4).

The rejected persisted domain would put a mutable row on thousands of carriers
that mostly never change — the growth `persistent-world-state.md` §6 bounds.

### F3 — A drawn proper name, and the composed registry beside it

Every carrier carries **two** display strings: a proper name drawn from the
digram vocabulary, and the composed registry it already has.

The principal was offered the drawn name alone, the composed callsign alone, and
both, and chose both.

Both shipped precedents survive rather than one replacing the other.
`station-name.ts` draws proper names from `DOMAIN.STATION_NAME`, one sub-stream
per slot; `station-traffic.ts:172` composes `Kestrel TR-01` from model, role code
and ordinal. The drawn name makes a bounty target a ship a pilot can remember
and hunt — `Kestrel TR-03` is a registration number, not a quarry. The registry
keeps the *where it belongs* fact a drawn name loses.

#109's rule binds and is not restated as a new decision: **a name is display,
the id is identity.** Nothing that keys, saves or looks up may switch to either
string.

### F4 — The scan is equipment-gated and held on target

*Taken against the recommendation.*

A scan requires a **scanner module bought at a station**, and completing one
requires holding the selected target in a forward cone, inside a range well under
the passive scanner's, for an uninterrupted interval.

The principal was offered the same held scan with **no** equipment gate, this,
and an instant short-range read, and chose this.

The instant read was rejected on the node's own argument: a scan a pilot can take
for free from any range is the passive display with one more keystroke, and it
decides nothing in a fight.

**The cost is stated where the decision is.** An unequipped pilot cannot tell a
wanted ship from a clean one at all, so the Bounty family is unavailable until
the module is bought. This needs no amendment to the parent spec: its D12 gates
jobs on "concrete requirements — a weapon, hold space, equipment", and this is
one.

The recommendation was the ungated version, on the argument that a new pilot in
their first minutes has no way to participate in the law at all. The principal
chose the gate knowing that.

### F5 — A scan reveals standing and a cargo manifest

*Taken against the recommendation.*

A completed scan reveals the target's standing — Clean, Wanted or Fugitive — and
**what it is carrying**.

The principal was offered standing recorded as knowledge, standing alone and
unrecorded, and standing with a manifest, and chose the last.

The recommendation was standing alone, on the finding that `station-traffic.ts`
gives a Traffic actor no cargo of any kind, so a manifest is invented rather than
revealed. The principal chose it knowing that; F11 gives the invention its shape
and F6 its consequence.

### F6 — The manifest is lootable, and that needs a node of its own

*Taken against the recommendation.*

What a pilot scans in a hold is what drops when they destroy that ship.

The principal was offered a revealed-but-not-lootable list, a lootable list, and
a single contraband bit, and chose the lootable list.

**This is the largest thing in this document and most of it is not built here.**
Ordinary traffic is not destructible: it has no hull points, no shields, no
damage path and no reaction. The recommendation was the revealed-only list
precisely because it needs none of that and leaves this reachable later without
reversing anything. The principal chose the full loop.

The node's Boundary forbids building it, so the build attaches **below** this
node as its own child. This spec decides that a manifest exists, what it is drawn
from and when it changes; the child decides hulls, damage, reaction and what a
civilian kill does to the world.

The single contraband bit was rejected as too little to be called a manifest,
though it remains the most symmetric with `combat-model.md` §4's station scan of
the *player*.

### F7 — The world judges true standing; the scan is an information channel

Killing a Clean carrier is an offence whether or not it was scanned. Killing a
Wanted one is lawful whether or not it was scanned. **Scanning protects a pilot
from their own mistake, not from the law.**

The principal was offered this, a rule making any unscanned kill an offence, and
no legal weight on NPC kills at all, and chose this.

**F2's clock term constrains this, and the constraint is binding.** If standing
rotated quickly, a ship scanned Wanted could read Clean by the time it died, and
the kill would be an offence the pilot could not have avoided — F7's protection
would be worthless and F11's own rule ("must not change between the scan and the
kill, or the reveal is a lie") would be violated on the other axis. So **the
rotation period must be long against the time from a completed scan to the
kill**, and the instrument §2 requires must show it. The interval is named
directly rather than as "an encounter", which CONTEXT.md reserves for a raider's
cruise-leg approach — the target here is ordinary traffic, so that term's
duration does not bound this window. This is a requirement on the clock term, not a new
decision: it constrains how F2 is implemented rather than reopening it.

It adds no vocabulary to a law model this node is told to consume rather than
reopen. Requiring a scan before firing would have been a genuinely new rule in
it, and would make the F4 module mandatory for all combat rather than for the
Bounty family. Removing legal weight entirely was rejected because with F6 it
makes every civilian a target with no downside.

**The debt this creates is recorded in §7 rather than discharged here**: nothing
in the game writes heat today, and the child node of F6 is where a Clean kill
first becomes possible, so it is where that write lands.

### F8 — `UNKNOWN` before the scan, an ageing reading after

An unscanned ship reads `SHIP · FREIGHTER · UNKNOWN` — the middle cell is the
hull **id** the producer supplies, never a model name, which is §3's rule that a
type is never inferred from a display string, and why `Porter` (what a freighter
is called) never reaches this cell. A scanned one reads its
standing, **with the age of the reading beside it**.

The principal was offered this, the same substitution without ageing, and keeping
today's display with the result on a separate line, and chose this.

The separate line was rejected because `CIVILIAN` would then mean *not a raider*
while the line meant *not wanted* — two words for standing on one instrument.
Ageing is load-bearing rather than decorative: standing **rotates** under F2 —
in both directions, so a clean ship can become wanted as well as the reverse —
and a reading without its age invites a pilot to act on an hour-old answer.

### F9 — The result is recorded on the knowledge row

A completed scan writes **when it was read, and that a scan was its source**.
What was read is *not* stored: it is re-derived from the pure functions at
display time. §5 owns that contract and the row's shape, and neither is as
cheap as this decision first assumed.

The principal was offered this and an ephemeral result, and chose this.

It is `persistent-world-state.md` §3.1's own idiom, not a new mechanism: the
`knownPrivateFacts.blackMarket` marker stores `learnedAt` and a source while the
value itself stays generated. F8's ageing needs a stored `observedAt` to be
anything but zero, and the Bounty family needs a board that can point at
something the pilot learned.

### F10 — Ordinary traffic only; raiders keep their kill-time draw

The manifest scheme covers ordinary carriers. A raider's cargo remains what
`combat-model.md` §4.1 and `src/raider-wreck.ts` already say it is.

The principal was offered this and one scheme covering every carrier, and chose
this.

One scheme would retire the kill-second term of `DOMAIN.CARGO_DROP` and change
shipped #324 behaviour, which this node would owe an amendment for. Against that:
a raider is a fight taken for the fight, and a pilot does not need to see its
hold to decide. Nothing in #324 changes.

### F11 — A hold is fixed for one voyage

A carrier's manifest is drawn per **voyage**, keyed on the schedule's existing
voyage index, and redrawn on the next departure.

*Amended by #362*: the voyage is the one the carrier is **flying** —
`flownVoyageOrdinal`, the route's visit and the schedule's ordinal only without
a route — because a return running late is projected as the previous visit
while the schedule has moved on (`civilian-combat.md`).

The principal was offered this and a hold fixed for the life of the world, and
chose this.

The requirement it satisfies is that a hold **must not change between the scan
and the kill**, or the reveal is a lie. `trafficScheduleAt` already computes
`awayOrdinal` and it is stable across the whole away interval, so the term costs
nothing new. A world-lifetime hold would satisfy the same requirement and was
rejected for F2's reason: a system scanned once would hold no further surprises.

### F12 — A shipyard exclusive, priced with the E.C.M.

The scanner module is a **shipyard type-exclusive**, priced in the E.C.M. band —
the principal's figure is ~600 Cr, matching `EQUIPMENT`'s E.C.M. row.

The principal was offered this, the same as a refinery exclusive, and an eleventh
universal item, and chose this.

The universal slot is not available: `station-types.md` §4.1's table holds
exactly ten and §4.2's saturation argument rests on that count, so an eleventh
would amend two ratified rules. The refinery was rejected on fiction — reading
another ship's standing is not a mining tool — and because refineries are the
rarer station.

**The consequence, stated here**: a pilot in a system with no shipyard cannot buy
one, so the Bounty family waits until they reach one. That is a reason to travel
rather than a gap.

## The detailed contract as ratified, and as built

The following completes F1–F12. This document delivered no runtime, content or UI
document.

### 1. The naming scheme and its stream

Every carrier has:

| Field | What it is | Source |
| --- | --- | --- |
| `localCarrierId` | persistence identity | the generator, unchanged (`persistent-world-state.md` §2) |
| `name` | the drawn proper name | a new `DOMAIN` tag, drawn per carrier key |
| `registry` | the composed designation | model name, role code and ordinal, as `station-traffic.ts:172` already builds |

The name is drawn with **`mix(systemSeed, fnv1a(carrierKey))`** under its own
`DOMAIN` tag, not from a stream consumed in roster order.

**Never seed on the carrier key alone — the system seed is what carries the
galaxy.** `CarrierKey` is `${systemIndex}:${localCarrierId}` and is
*envelope-relative* (`src/carrier-key.ts:26-33`): the galaxy comes from the save
envelope, not from the key. A draw seeded on the key alone would give system 5's
`station-trade` Porter the same name, standing timeline and hold in all eight
galaxies. `systemSeedFor` is `mix(layoutSeed(worldSeed, galaxy, attempt), index)`
and `layoutSeed` folds in the galaxy (`src/galaxy.ts:208-220`), so passing the
system seed settles it and a separate galaxy parameter adds nothing. That is
precisely why the shipped precedent — `mix(mix(kill.systemSeed, fnv1a(key)), …)`
in `raider-wreck.ts:185-188` — does not have the problem.

Roster size is
conditional — on the berth catalogue, on government, on which station types a
system generated — so an ordered pass lets a conditional carrier shift every
later name. This is `domains.ts`'s own recorded hazard, and `STATION_NAME`'s
per-slot sub-stream exists for it.

**Uniqueness inside a system is not required**, and this is a deliberate
departure from `station-name.ts`'s `drawUniqueStationName`. The registry
disambiguates two ships that draw the same name, and a redraw loop would
reintroduce the ordered pass the per-key draw exists to avoid.

Raiders take their name from the same scheme. `raiderName`'s `Raider 01` becomes
the registry half, and the drawn name is new.

**One module owns both halves for every carrier**, and it is a new leaf beside
`station-name.ts` — call it `carrier-name.ts`. Naming is split across
`station-traffic.ts:172` and `raider-slots.ts` today, and a shared drawn name
left in either one makes that module the owner of the other's identity.

### 2. Standing, as a derived function

```
carrierStanding(systemSeed, carrierKey, instanceOrdinal, gameTime)
  -> "clean" | "wanted" | "fugitive"
```

Built by #362 in `src/carrier-standing.ts`, with `instanceOrdinal` added by
`civilian-combat.md` H1 and starting forms by H12.
`scripts/measure-carrier-standing.ts` is the instrument this section asks for.

Pure, deterministic, **never persisted**, recomputed on read. Its own `DOMAIN`
tag, drawn per carrier key so no carrier's standing moves another's.

Its terms: a share of carriers wanted, a smaller share fugitive, and F2's clock
term rotating which. **The implementation owes their exact forms and a committed
instrument that prints the resulting distribution across seeds and galaxies**, in
the shape `scripts/measure-clamp-bite.ts` already uses. No figure is stated here,
because none has been measured, and a figure stated in a spec reads as a
measurement.

The share plausibly reads government — the gradient already drives the raider
slot count and the damage floor. The sibling spec rejected a *third* use of
government for exactly that reason, and this spec records the same caution
without deciding it: the instrument comes first.

### 3. The manifest, as a derived function

```
carrierManifest(systemSeed, carrierKey, instanceOrdinal, voyageOrdinal,
                { holdT, government })
  -> readonly { good: string; tonnes: number }[]
```

Built by #362 in `src/carrier-manifest.ts`. **The slot keying below is
superseded**: `civilian-combat.md` H1 ruled a replacement a new ship, so both
functions take `instanceOrdinal`, and H11 added the hold and government a hold
is drawn against. The paragraph is kept as the question #362 answered.

These were keyed on the carrier *slot*, not on the instance occupying it, and
that was a decision handed onward rather than an oversight. CONTEXT.md's *Carrier
slot* survives the destruction and replacement of its occupant, so once F6's
child makes traffic destructible, the replacement for a killed Wanted Porter
inherits its predecessor's name and standing timeline and can draw the same hold
again. CONTEXT.md's *Last-known state* records the precedent cutting both ways:
a private facility fact is deliberately "scoped to the carrier's persisted
identity rather than to the instance", while an observed condition is not.
**F6's child decides whether a replacement is a new ship or the same one**, and
adds `instanceOrdinal` to both signatures if it rules the former. Nothing here
is built on a replacement existing, because nothing can yet destroy one.

Pure, deterministic, never persisted, its own `DOMAIN` tag. `voyageOrdinal` was
`trafficScheduleAt`'s `awayOrdinal`; #362 made it `flownVoyageOrdinal` (F11's
amendment), fixed on an engagement at the first shot that lands.

The commodity draw reads `economy-trade.md` §2's table, which already flags
Slaves, Narcotics and Firearms `illegal: true`. Weighting contraband by
government has a shipped precedent in `cargoWeights` (`src/raider-wreck.ts`), and
the implementation should read it rather than invent a second weighting.

**A manifest is not a market fact.** It moves no price and no stock deficit. A
hold is what a ship carries, and `economy-trade.md` §5.5 keeps owning what a
trade does.

### 4. The scan verb

A scan needs, all at once:

- the F12 module fitted;
- a **selected** target — the scan has no acquisition of its own, and Navigation
  plus `T` stay authoritative for selection (`hud-and-scanner.md` §2);
- that target inside a forward cone;
- that target inside a scan range, **well under** `SCANNER_RANGE_KM`'s 10,000 km;
- the cone held, unbroken, for a charge interval.

Breaking the cone resets the charge. The idiom is `src/interdiction.ts`'s
contest — a lock held through a charge, broken by heading separation — and the
implementation should read its shape rather than invent a second one.

**No figure for the cone, the range or the charge is stated here.** They are
feel, they are tuned by flying, and this repo's record is that a predicted figure
written into a spec is later read as a measured one. The implementation owes them
and owes an instrument that reprints them, as `scripts/measure-interdiction-contest.ts`
does for the contest it is modelled on.

**A scan can fail**, and failure is simply the charge not completing. There is no
separate failure roll: a roll would make the same ship answer differently to two
identical scans, which is a lie of a different kind. What makes the verb cost
something is F4's hold — keeping a nose steady on someone is exactly what a pilot
cannot afford in a fight or a chase.

### 5. The knowledge record

A completed scan writes **`{ observedAt, source, observedInstanceOrdinal,
observedVoyageOrdinal }`** and nothing else. The source is a new value alongside
§3.1's `docking`, `system-relay` and `intervention`.

**What it owes beyond the stamp was the open question, and #364 settled it by
storing both ordinals.** The two below are kept as the argument that decided it,
not as a question still open: F11's flown voyage depends on the route as it stood
when the carrier left, so it cannot be recovered from the clock afterwards, and a
scan taken before a late return and a kill after it would otherwise disagree.

**It does not store what was read, and that is the idiom rather than an
omission.** `persistent-world-state.md` §3.1 says the black-market marker
"stores only `learnedAt` and its report source. The black-market value itself
remains generated baseline data", and CONTEXT.md's *Last-known state* says the
row holds never the generated value. Standing and the manifest are pure
functions, so the reading is re-derived at display time as
`carrierStanding(…, observedAt)` and `carrierManifest(…, voyageOrdinalAt(observedAt))`.
**#362 made `voyageOrdinalAt(observedAt)` not derivable after the fact**: the
flown voyage depends on the route as it stood, not on the clock alone. So the
record owes the voyage it read (and the instance), or a scan read before a late
return and a kill after it disagree, which breaks F6. **#364 stored both**, and
`world-state.ts`'s `CarrierScanObservation` is the shape that came out.
A stored copy would duplicate derivable state inside a versioned save.

**What this spec cannot settle, and must not pretend to.** A Traffic actor has
no knowledge row today — rows are written for stations, by `system-relay`,
`docking` and `intervention` — and `KnowledgeRow` requires
`observedInstanceOrdinal`, `observedCondition` and a top-level `source`, none of
which a scan observes. `parseKnowledgeRow` also rebuilds `knownPrivateFacts`
with `blackMarket` alone, so a new member added naively is **dropped on load**.
So the implementation must decide one of two shapes — a scan that also records a
condition observation, or a container that can exist without one — and settle
the `WORLD_SCHEMA_VERSION` question that follows. **This document withdraws any
claim that the record is free.**

It is **last-known intelligence, not a live reference**. Standing rotates under
F2 and the hold is redrawn each voyage under F11, so a row goes stale by design, and
§3.1's rule that objective events outside the player's channels do not update
knowledge is what makes that correct rather than a bug.

### 6. The Target panel, before and after

`targetDesignation` gains one cell's worth of new behaviour and keeps its shape:

| Contact | Before a scan | After a scan |
| --- | --- | --- |
| Raider | `SHIP · MARAUDER · HOSTILE` | unchanged — F1 |
| Ordinary ship | `SHIP · FREIGHTER · UNKNOWN` | `SHIP · FREIGHTER · WANTED · 4m` |
| Station | unchanged | unchanged |

**The display rule, because two axes now share one cell.** `scannerClass` still
answers *is this a pirate*; standing answers *is this wanted*. The cell reads
`HOSTILE` when `scannerClass === "hostile"`, and otherwise the recorded standing,
or `UNKNOWN` when no scan has been recorded.

`DisplayContact.legalStatus` is **renamed `standing`** and takes a new
**`CarrierStanding`** type — `"clean" | "wanted" | "fugitive"` — or `null` for
never scanned. The rename rides the retype rather than following it: a field
still called `legalStatus` sitting beside the player's `LegalStatus` type is
the very name collision this paragraph warns about. **It must not take
`LegalStatus`**, which is
`world-state.ts:223`'s `{ heat, updatedAt }` pair and is the *player's*. Two
meanings under one name in one field is the collision `CarrierKey`'s brand exists
to prevent.

The age suffix follows `hud-and-scanner.md` §3's existing discipline: a figure a
pilot flies on goes on an instrument in front of them, not only in the left
console's `display: none` copy.

The manifest does not fit the designation line. It belongs on the Flight console
beside §5.4's condition block, which is where the whole reading already lives
while the glass carries the minimum.

### 7. The law, consumed not reopened

`combat-model.md` §4 stays the owner of legal status, heat, thresholds and
police response. This spec adds one sentence to the world's behaviour and no
vocabulary: **the offence is judged on the target's true standing, not on what
the player knew.**

Two pieces of debt are recorded rather than discharged:

- **Nothing writes heat.** *Discharged by #362*: `src/legal.ts` writes a Clean
  kill's heat on the target's true standing (`civilian-combat.md` H4).
- **A lawful kill's reward is not decided here.** `combat-model.md` §4 already
  rules there are lawful bounties only for sanctioned targets and no universal
  cash bounty; the Bounty family's payment is `ordinary-requests.md`'s, through
  the request contract.

### 8. Rules this makes false, and where they are amended

Pointing at an owner is right for a figure this spec *uses*. It is wrong for a
rule this spec *changes*.

**None of these rules is rewritten here, and every *spec* owner is told so in
this same change.** A rewrite would put unbuilt behaviour into specs that
describe what ships — the sibling damage spec made the same call for
`station-types.md` §4.1's hull mention. What this change does instead is add one
pointer line to each spec owner naming this section, so a reader of a ratified
spec cannot meet a rule this document contradicts without being told. The
rewrites land with the implementation node.

**The two source files below carry no pointer**, and that is deliberate rather
than an exception quietly taken: a doc-only change that edited a comment in
`display-contact.ts` would be prose landing ahead of the code it describes. They
are changed by the implementation, at which point the comment and the field move
together.

| Rule | Owner | What changes |
| --- | --- | --- |
| The Target designation format, `SHIP · <HULL> · <SCANNER STATUS>` | `hud-and-scanner.md` §3 | The third cell becomes standing for non-hostile contacts, with an age |
| "Unclassified review hulls show `UNKNOWN`, not a fabricated legal status" | `hud-and-scanner.md` §3 | Still true, and now `UNKNOWN` also means unscanned |
| The type-exclusive table | `station-types.md` §4.1 | The shipyard column gains the scanner module |
| The equipment list and its prices | `economy-trade.md` §7 | One row added, `newToSeelite` |
| The knowledge row's shape, and its set of observation sources | `persistent-world-state.md` §3.1 | A scan is a new source, and the row must be reachable for a carrier with no condition observation |
| *Last-known state* holds "an observed operational condition" | `CONTEXT.md` §Language | A scan record carries neither an instance ordinal nor a condition — **answered by #364: it carries an instance ordinal and a voyage ordinal, and still no condition**, because a scan sees no hull |
| `legalStatus` is "null means no legal identity has been given" | `src/display-contact.ts` | The field is **renamed `standing`** and typed `CarrierStanding \| null` |
| Traffic callsigns "may change in a future generator version without becoming persistence keys" | `station-traffic.md` §1.1 | Still true, and now a drawn name sits beside the callsign |

Unchanged, and listed so a reader does not assume otherwise: `combat-model.md`
§4.1's raider cargo drop (F10), the six galaxy domains
(`persistent-world-state.md` §7), and `WORLD_GENERATOR_VERSION` — the
fingerprint hashes identity, type, parent and placement, and this spec adds a
property to none of them.

### 9. Verification obligations

This document is a contract, not an implementation, and claims no test run.
What its implementation owes:

| Case | Required evidence |
| --- | --- |
| A name is deterministic | Headless: the same key gives the same name twice, across a process boundary |
| A name draw is independent | Headless: a system's conditional carrier count does not change any other carrier's name |
| Identity never becomes a name | Headless: every save, key and lookup path still reads `localCarrierId`; a name change orphans no market memory |
| Standing is deterministic at a clock | Headless: same seed, key and time give the same standing twice |
| Standing rotates, both ways | Headless: over a clock range, a wanted carrier reads clean and a clean one reads wanted |
| Standing holds from scan to kill | Headless: the rotation period is long against that interval, so a scan is still true when the shot lands |
| A key draws independently per galaxy | Headless: the same carrier key in two galaxies gives different name, standing and hold — which the system seed already secures, and this row is what proves the seed was not bypassed |
| The standing distribution | A committed instrument printing wanted and fugitive shares across seeds and galaxies, with the spread |
| A manifest holds for a voyage | Headless: every clock inside one away interval gives the same hold; the next interval may differ |
| A scan needs the module | Headless: unequipped, the verb refuses with a readable reason |
| A scan needs the hold | Headless: a cone broken before the charge completes reveals nothing and resets |
| The scan's feel | The principal flying it, plus an instrument reprinting cone, range and charge |
| The record ages | Headless: scan, advance the clock, and the row reads the older `observedAt` |
| The record survives a save | Headless: scan, serialize, parse, and read the same observation |
| A raider still reads HOSTILE | Headless: `targetDesignation` on a raider contact is unchanged |
| An unscanned ship reads UNKNOWN | Headless, plus a browser probe on the cockpit Target panel |
| The panel is legible | Browser probe, plus the principal reading a real Target panel in flight |

The arithmetic and state halves are headless. The panel is the browser tier's.
**A doc-only change is not probed**; these attach to the implementation nodes,
not to this merge.

### 10. Saved state

**The objective values are never written**: standing and the manifest are
derived on read, so no state domain holds them and no generator bump is owed —
`carrierBaselineFingerprint` hashes identity, type, parent and placement, and
this adds a property to none of them.

**The observation is not free, and §5 says why.** A scan of a Traffic actor has
no knowledge row to extend, `KnowledgeRow`'s required fields describe a
condition observation a scan does not make, and `parseKnowledgeRow` drops an
unrecognised member of `knownPrivateFacts` on load. So a
`WORLD_SCHEMA_VERSION` bump is **likely and is not ruled out here**; the
implementation settles it along with the row's shape. An earlier draft of this
section claimed one optional member and no migration, which the parser refutes.

### 11. Handoff

*Discharged for the lootable half*: #362 built it (`civilian-combat.md`), and
the rest of this spec's build was #364, which landed it. The handoff as written, kept as the brief it was:

One child node carries what F6 decided and this spec deliberately does not
build: **destructible ordinary traffic** — hull, shields and damage for a
civilian carrier, its reaction to being fired on, the manifest actually dropping
as canisters, and F7's offence-to-heat write for a Clean kill.

Implementation of naming, standing, the scan verb, the knowledge record and the
Target panel attaches beneath this node and does **not** wait on that child.
Only the lootable half does.

## Scope

This document decides what a carrier is called, whether it is wanted, what it
carries, and the cockpit verb that reveals all three. It does not build the job
catalogue, police AI, bounty economics, civilian combat, or the damage model,
which is its sibling node. It does not reopen the request contract, the combat
model, the law model or the economy.
