# Civilian combat and its legal consequence

Author: Ivy · 2026-09-16
Status: H0–H12 are agreed with the principal (grilled one at a time on
2026-09-16). The checkpoint also needs the principal to confirm the reaction
model and the cost of a Clean kill **having flown it**, so this document is
agreed, not yet ratified. It becomes ratified when #362 closes after all three
changes are flown, recorded in that node's resolution.
Decision node: [What it takes to shoot an ordinary ship, and what the world
does about it](https://github.com/jcfischer/seelite/issues/362).

This spec owns **what happens when a pilot fires on an ordinary carrier**: its
combat condition, its reaction, what a survivor does, what a kill drops, what
an offence costs in heat, and who in the world notices. It is the child that
[Carrier identity and the scan](https://github.com/jcfischer/seelite/issues/359)
handed on in `carrier-identity.md` §11.

Decision codes are **H**, after the D of `ordinary-requests.md`, the E of
`station-damage.md` and the F of `carrier-identity.md`, so no code means two
things across the four documents. The numbers follow the decision node's
grilling order, so `H3b` is the second question under `H3`.

## What this spec does not own

| Fact | Owner |
| --- | --- |
| Shield pool, **Energy bank**, recharge, laser damage, the shared-rules doctrine | `combat-model.md` §1–§2, `src/ship-condition.ts` |
| Legal status semantics: per galaxy, bounded, Clean/Wanted/Fugitive, 30-minute half-life | `combat-model.md` §4 |
| Carrier conditions, transitions, recovery descriptors, provenance, compaction | `persistent-world-state.md` §3–§6 |
| Standing and manifest terms, the naming scheme, the scan verb, the knowledge record | `carrier-identity.md` |
| Traffic rosters, hull pools, schedules, the carrier namespace | `station-traffic.md` §1 |
| The route projection and its materialization band | `in-system-route-traffic.md` |
| Canister ejection, rest frame, scoop | `combat-model.md` §4.1, `src/raider-wreck.ts` |
| Bounty jobs and how a lawful kill is paid | `ordinary-requests.md`, `missions-and-requests.md` |
| Clearance, the hostility flip, the denial reasons | `docking.md` §6 |

## The state of the code this is written against

Verified on `main` at `295320a`, 2026-09-16.

- **Nothing can shoot a Porter.** `src/duel.ts` steps one `Raider`, and
  `raiderInSights` is the only hit test against a ship. `Game.takeDamage`
  (`src/main.ts:8132`) is the player's own.
- **Nothing reads a Traffic carrier's condition.** `carrierCondition(` is
  called for the raider slot (`main.ts:8254`) and the relay (`main.ts:8512`,
  `8537`) only. A `destroy` written against a Traffic key today would leave the
  ship flying its schedule.
- **`carrierStanding` and `carrierManifest` are not built.** Neither is the scan
  verb, the name draw or the Target panel's standing cell.
- **Nothing writes or reads legal heat.** `setLegalHeat`
  (`src/world-state.ts:1238`) is called only from `tests/`. `LegalStatus` is
  `{ heat, updatedAt }` and is saved and parsed field by field
  (`world-state.ts:1738-1741`). The cockpit rail has a `LEGAL STATUS` label and
  no value (`src/live-cockpit.ts:1272`).
- **Every ship already shares one condition model.** `fullCondition(hull)`
  gives 106 shield per side, a bank of 100 and `HULL_SPECS[hull].integrity`
  hull points (`src/ship-condition.ts:19-31, 78-92`); the pulse laser does 6
  damage per second.
- **Station hostility is session state.** `DockingState.hostile` and
  `hostileUntilS` (`src/docking.ts:640-645`) are not in the save envelope, and
  the interim cooldown is `HOSTILE_COOLDOWN_S = 600`.
- **The frame body is already ruled.** `updateLocalFrameBody`
  (`main.ts:6743-6765`) takes the nearest body within `NEAR_FAR_KM` = 20,000 km,
  and a station is a body (`src/system.ts:866`). The raider's canisters rest in
  that frame.
- **The targeting arm is named.** The gimbal and the ON TARGET mark follow
  `raiderSelected() || relaySelected()`, and the map's Constraints (#43) say a
  third combat target owes the same line.

## Agreed decisions

### H0 — This node builds standing and the manifest, and nothing else of #359

`carrierStanding` and `carrierManifest` are built here, because a kill cannot
be judged, or its cargo canisters dropped, without them. The scan verb, the knowledge record, the
Target panel's standing cell and the name draw get their own node beneath #359
and do not block this one. **That node is #364, and it has landed** — read the
list above as a boundary this node kept, not as work still owed.

The principal was offered this, a sibling node blocking this one, and this node
building the whole of #359, and chose this.

What "drops the manifest a scan showed" means before a scan exists is a
headless identity: the canisters a kill drops are `carrierManifest` of that
carrier, instance and voyage. When the scan lands it reads the same function.

### H1 — A replacement is a new ship

`instanceOrdinal` enters both signatures:

```
carrierStanding(systemSeed, carrierKey, instanceOrdinal, gameTime)
carrierManifest(systemSeed, carrierKey, instanceOrdinal, voyageOrdinal, …)
```

H11 adds the hold and government the manifest reads.

The name draw takes it too when it is built. A replacement draws a fresh
standing timeline and hold, so a killed Wanted Porter does not come back Wanted
to be killed lawfully every thirty minutes.

The principal was offered this, the slot keying `carrier-identity.md` §3 wrote,
and a registry that stays with the slot while standing and hold move with the
instance, and chose this. It costs no state: `replacement-complete` already
increments the ordinal (`persistent-world-state.md` §4).

### H2 — A civilian is a combat ship

An ordinary carrier gets `fullCondition(hull)`, exactly as the raider does.

The principal was offered this, hull points without shields, and a per-hull
shield pool, and chose this. The two alternatives each amend `combat-model.md`
§1, which this node is told not to reopen.

Time on target, one shield side, no recharge, pulse laser, is derived from the
constants; `tests/traffic-engagement.test.ts` pins it for four hulls
(freighter, miner, courier, patrol). The figures shown to the principal while choosing are
in that test. A real chase is longer by the time off target.

### H3 — The reaction is per role

A civilian hull — freighter, miner, courier, tug, prospector, explorer — flees
from the first hit: `combat-enemy.ts`'s `evade` and `flee` phases, never
`acquire` or `attack`, and it never fires. A patrol or interceptor hull takes
the raider's full intent set and fights back.

The principal was offered this, every carrier fleeing, and a comply-and-jettison
reaction, and chose this.

**An armed hull returns fire only after it has been struck, and never starts a
fight.** A patrol that pursues a Wanted pilot is the police AI the node's
Boundary excludes. Choosing an intent is not a handling advantage, so §1's
shared rules hold for both.

### H3b — A survivor is diverted, and the diversion is saved

*Taken against the recommendation.*

A carrier that is struck and survives leaves its route and goes home, and the
world remembers.

The principal was offered this and a transient reaction — damage living only
while the contact is materialized, the ship rejoining its projection at full
condition — and chose this. The transient reaction was recommended because it
adds no transition and no saved row; what the principal bought is that a pilot
who came back finds the ship they attacked gone from its route.

### H3c — Recorded as `disable` then `repair-start`

At the diverting hit, two transitions in one tick:

1. `disable`, with the player's provenance;
2. `repair-start`, with the home station's provenance, and `completesAt` at the
   **first departure that carrier's own schedule makes at or after `now + T`**.

`T` is a floor on the absence, not the booked figure. The principal was offered
`completesAt = now + T` exactly, which is what this section first said, and the
rounding to a departure instead: it adds no saved field and no schema term, and
a repair that finishes mid-leg would otherwise leave the ship written as
operational somewhere it is not drawn until its schedule comes round anyway —
so the berth empties on the frame the schedule takes it away, and the row is
`REPAIRING` through the tail rather than sitting one tick out of step with the
lane it cannot yet enter.

`repair-complete` returns it to operational with its `instanceOrdinal`
unchanged — the same ship, which H1 does not contradict because nothing was
replaced. `repairing → destroyed` is a shipped transition, so the ship stays
killable on its way home: a kill there interrupts the repair to `disabled` and
then destroys, because a carrier already written as destroyed cannot be
destroyed again, and the shorter route would leave a wreck with no replacement
schedule and a berth nobody returns to.

The principal was offered this and widening the model so a `disable` carries its
own schedule, and chose this. The widening is what `station-damage.md` E4
declined as "a larger change than this node needs", and the explicit start makes
it unnecessary: recovery then completes lazily wherever the player is.

**What is drawn while it repairs.** While materialized, the flown ship keeps its
H3 intent. Once it leaves the materialization band, a repairing carrier
projects as parked at its home berth until `completesAt`, and rejoins its
schedule at the next departure after it.

### H3d — The trigger is a hull strike; T is 1200 s

A hit that reaches hull points diverts. A pilot who only strips shields changes
nothing, and shields recharge. T reuses `RAIDER_REPAIR_S`, the one repair
duration the game ships.

The principal was offered this, the shipped 20% flee threshold, and a
shields-down trigger with a 600 s absence, and chose this.

**What this trigger governs is the divert, and only the divert** (#396, built by
#429). Read as *the* trigger for anything, it made the hull strike the first
charge an engaged civilian ever drew — which is what the flight report that
became #396 was about: a pilot who held a beam on a Clean carrier reached the
divert, and therefore Wanted, and therefore a closed berth, with nothing said in
between. H4's sustained-fire rung now charges inside that silence, five seconds
of landed fire, while the shields are still two-thirds up. It does not divert,
does not shorten T, and writes no transition: an ordinary carrier under fire
still gets exactly one, this one.

### H4 — The heat an offence costs

| Offence against a **Clean** carrier | Heat |
| --- | --- |
| Destroyed | 40 |
| Struck (the H3d hit) | 15 |
| Sustained fire (`ASSAULT_FIRE_S` of landed fire) | 13 |

**The third rung is #396's, and its figure has somewhere it may not go.** The
charge's whole legal life is the open interval between `WANTED_HEAT` and the
strike's 15, and neither end is a rounding. At 10 the charge crosses Wanted and
un-crosses it on the frame after it is written, because decay starts the instant
the write is stamped: the offence becomes a flash no berth and no responder can
act on, which is the invisibility the flight report was about. At 15 the lattice
ties, and two rungs the law has to order become one figure — a strike after an
assault then reports as costing nothing, having forgotten which of the two it is
looking at. `tests/legal.test.ts` holds the interval, so a retune that leaves it
is a red run rather than a quiet change in what the law is.

**Why five seconds.** `ASSAULT_FIRE_S` is a third of the ~17.6 s an unbroken
beam takes to open one facing of a freighter — a figure with an instrument behind
it rather than a remembered one: `probe-witnesses.mjs` holds exactly that beam
and prints how long the facing lasted (`strike.secondsToDivert`; 176 frames at
`MAX_DT` on seed 42), and #395's receipt reached the same number from the other
side. So the charge lands while the shields are still two-thirds up: the pilot is charged for what they did to a citizen, not
for how long it took the gun to get through the armour. The clock **holds across
the gaps** — it counts fire that *landed*, and a pilot who breaks off to line up
again has not un-done the seconds already spent. A clock that reset between hits
would make the charge a marksmanship test and hand one who jinks a discount on
the same act. Both figures are declared starting forms (H12's precedent).

An offence against a Wanted or Fugitive carrier costs nothing. The offence is
judged on the target's **true** standing at the tick it happens
(`carrier-identity.md` F7), read through H1's signature with the carrier's
current `instanceOrdinal`.

| Player standing | Heat |
| --- | --- |
| Clean | below 10 |
| Wanted | 10 or more |
| Fugitive | 60 or more |

Heat is capped at 100 and decays as `heat · 2^(−Δt / 1800 s)` from `updatedAt`,
lazily, on read. A write stores the decayed value plus the offence, stamped now.

The principal was offered this, the same figures with assault free, and a
harsher 64/20 with Fugitive at 50, and chose this. The scale is Elite's legal
value in shape: an offender band, and a fugitive band that one incident does
not reach.

What that means in play, **derived rather than measured, and asserted by a
headless test**: one Clean kill is about 60 minutes Wanted; two in quick
succession are about 12 minutes Fugitive and 90 minutes before Clean; a strike
alone is about 17 minutes Wanted, and the sustained-fire charge on its own about
11 minutes — the shortest Wanted interval the game can produce, and the reason
H4's third rung is the one that teaches the law rather than the one that ends a
career.

### H5 — The stations that heard the offence turn hostile

Every station within earshot of an offence turns hostile, and stays hostile
while the player's heat is Wanted or above. For one Clean kill that is about 60
minutes. (This clause read "If an offence's frame body is a station, that
station turns hostile" until #396 amended it; what follows records both.)

The principal was offered this, the same with the shipped 600 s cooldown, the
victim's home station noticing too, and no station noticing, and chose this.

This is the replacement `docking.md` §6 reserved for #8 ("#8 replaces it with
legal-status decay"), and its condition holds: the exit is decay, so no save can
be locked out of its only station. The
barge-without-clearance flip keeps its 600 s cooldown — that is a different
offence and not this node's.

**The reach was the frame body's, and #396 amended that.** As written, the rule
inherited `NEAR_FAR_KM` — 20,000 km, the distance at which a body is a place the
ship is *at* rather than a light in the distance — and so it filed exactly one
witness per offence, whichever berth the flight assist happened to have chosen.
That rule answers "where is this ship standing", and it is a poor answer to "who
was within earshot": beside a busy berth the frame body is picked by distance
alone, so a carrier gunned down in the middle of a system indicted one station
and let the rest of them advertise. A pilot who shot a Clean carrier down in a
berth's visual range, from a point the assist had assigned to another, was
unknown to the station that could see the muzzle.

It is now a transmission with a range and a sender. **`DISTRESS_RANGE_KM` is
three times `NEAR_FAR_KM`**, declared in `src/distress.ts`, and the measure is
taken from the **victim**, not the pilot: every station in the system is asked
the same straight-line question, and a system with four berths can produce four
hearers or none. Three and not one, because at `NEAR_FAR_KM` the amendment picks
the same witness the old rule did and is a no-op dressed as a change; three and
not ten, because at ten times it a shot near a system's middle indicts every
berth in it, which turns H5's per-station judgement into a per-system one and
leaves decay as the only thing left of the rule. Straight-line, with no
occlusion: nothing in this world attenuates a radio, and a station behind the
star would be a second model rather than a second figure.

**An empty hearer set is a computed answer.** `withOffence` takes it as a
mandatory positional argument — `[]` means "looked, nobody was in earshot" and
there is no third spelling — because the difference between "nobody heard" and
"the caller never looked" is the one `witnessed: CarrierKey | null` was originally
required to keep, and an optional argument erases it in the direction that reads
as the law working.

### H6 — Witnesses are saved on `LegalStatus`

```
interface LegalStatus {
  heat: number;
  updatedAt: number;
  witnesses: CarrierKey[];   // stations that heard an offence
  assaulted: CarrierKey[];   // carriers already charged with sustained fire
}
```

A station is hostile when it is in `witnesses` and heat is Wanted or above. The
list is cleared lazily when heat is read below Wanted. It holds each station at
most once per galaxy, so what reaches its bound is offending within earshot of
every station in a galaxy inside one Wanted interval.

**`assaulted` is #396's second list, and it is here rather than on the carrier's
row because an assault has nowhere else to be written.** A traffic carrier under
fire gets exactly one transition from the player, H3c's `disable`, and the
sustained-fire charge lands *before* the hull point that earns it: a Clean ship
with two-thirds of its shields left has no row to point at that says it was
assaulted. The alternative the ruling named — a field on the carrier's own row —
would have to invent a state that row cannot hold. So the fact sits beside the
witnesses, arrives by the same door, is omitted by `canonicalEnvelope` when empty
for the same hash reason as the witnesses, is cleared by the same read below
Wanted, and holds each carrier at most once per galaxy. Its bound is the
galaxy's Traffic rather than its berths, which is a longer list, and
`measure-save-size.ts` prices that in its ceiling tiers rather than leaving it
argued.

**One clear ends the incident, and it takes both lists.** "Once per carrier per
incident" needs an ending, and the law's only ending is decay: clearing the
witnesses and not the charges would pardon a carrier forever, and the other way
round would leave a pilot re-chargeable inside an incident they are still Wanted
for. That is what makes the mark safe to write whatever the charge cost: a free
charge — a target whose rotation had turned it Wanted at the tick, F7 — is spent
and forgotten together, on the next read that comes in below Wanted.

The principal was offered this, an "offence witnessed" episode on the station's
own world-state row, and session-only hostility, and chose this. Session-only
lets a reload or a jump out and back clear what decay is meant to clear.

A save without the member parses to `[]`, so **no `WORLD_SCHEMA_VERSION`
bump**: a version mismatch refuses the whole save (`persistent-world-state.md`
§9, #89), and an optional member with a default needs none.
`scripts/measure-save-size.ts` re-measures the ceiling.

**Built, this needed one more condition than it reads as needing** (#366). The
empty list is *omitted* by `canonicalEnvelope` rather than written as `[]`,
because the envelope's `integrity` is a hash over its own canonical bytes: a
member added to every envelope changes every hash, and a save whose hash no
longer matches its body is reported as corrupt — worse than the version bump it
was avoiding, because that message is a lie about the player's save. So
"optional with a default" is the parse half, and "absent on the wire when empty"
is the write half of the same no-bump decision. `witnesses` is also stored in
canonical `CarrierKey` order for the same reason: a model that wrote them in
offence order would not equal its own save. `persistent-world-state.md` §7 holds
the full account, beside §9.10's opposite case.

### H7 — The HUD shows standing, and shipyards refuse Wanted

The left console's readout shows LEGAL STATUS as Clean, Wanted or Fugitive,
stepping back as heat decays, on both left tabs. The rail keeps its labels, and **one of them carries a value for the first
time** (#396): the Signals rail's `HAILS` row has been authored in
`live-cockpit.ts` since the console was built and has never had anything beside
it. It now holds the callsign transmitting, or `NONE` — and `NONE` rather than
blank, because a label that shows nothing when nothing has happened is a label a
pilot cannot tell apart from a console that was never wired, which is what this
one was for three hundred lines of its life.

**And it goes back to `NONE` when the fight ends.** A carrier is transmitting
*while it is being shot at*, which is what `trafficEngagements` already knows, so
the callsign leaves the rail on the frame the pilot breaks off, kills it, or
jumps away — and the line stays on the log underneath, which is the history and
does that job better. A first draft read the newest entry in the session's store
and so kept the speaker on the glass for the rest of the session, which is a log
with a shorter memory rather than a rail: **the rail answers what is happening,
and only the log answers what happened.**

**The struck Clean carrier's hail is drawn on the first landed hit**, through the
three channels every other emergency in this game uses: the rail's value, a line
on the Communications log, and `audio.alert()`. It is Clean-only by F7's
judgement and not the pilot's — a Wanted carrier being shot at is an outlaw being
stopped, and it does not get to report a crime the pilot is entitled to commit.
And it says `cease fire` and nothing about a charge, because the hail is on the
frame the first hit lands and the sustained-fire clock is still running: a victim
that announces a charge which has not been made tells the pilot the wrong thing
on the one surface that is honest about the moment.

**The hail line is session-only**, which is #396's ruling rather than an
omission: there is no world row that says "this carrier hailed at T", because
nothing about the victim changed at T, and a saved one would be a §7 state domain
for a line of console text. `raider-log.ts` derives every other line in the log
from world state and keeps no store, and its header carries this line as the
exception and says why it is merged there anyway.

Every shipyard denies docking with the reason `hostile` while heat is
Wanted or above, which is `combat-model.md` §4's "thresholds determine … shipyard
hostility". Trade stations and refineries become hostile only through H5.

The principal was offered this, the rail alone, and shipyards refusing only at
Fugitive, and chose this.

### H8 — A lawful kill pays only through a request

Confirmed rather than decided: a Wanted or Fugitive kill costs no heat and drops
the manifest, and the `destroy` with the player's provenance is the evidence a
bounty job reads. Nothing here pays cash (`combat-model.md` §4,
`ordinary-requests.md`).

### H9 — The worst offence in an incident supersedes the ones before it

The heat for one **incident** is the largest offence in it, not the sum. A strike
followed by a kill costs 40, not 55, so H4's durations are the ones a pilot
meets.

**The ladder is three deep since #396, and it orders by rung rather than by
figure**: `assault < struck < destroyed`, and each pair costs the larger one's
figure and no more — assault then strike is 13 + 2, assault then kill is 13 + 27,
and every pair in either order lands on the larger rung. `marginalOffenceHeat`
therefore compares `offenceRank`, not the two heats: comparing figures works
while the rungs happen to be spaced and silently stops working the moment two are
level, which is the failure the interval in H4 exists to refuse.

**What each rung reads itself as already-paid comes from a different place, and
that is not untidiness.** The strike and the kill are read off the carrier's row,
because the row is the copy that survives a reload — the §4 episode ledger keeps
only the latest episode, and the kill's `interrupt` erases the strike from it.
The assault has nothing on the row to read (H6), so it is read from
`LegalStatus.assaulted`. A resumed fight therefore gets its clock seeded from
the world rather than from zero, and `engage`'s third argument is required for
`FlightPerformance`'s reason: a caller that omitted it would charge a pilot a
second time for the five seconds they have already served, and nothing about the
missing argument looks wrong in a diff.

**An incident is not §4's causal episode, and the difference is load-bearing.**
The `disable` opens an episode and the kill's `interrupt` closes it, so the
strike and the kill are *two* episodes by §4's definition — and the second
replaces the first's summary in `episodes[key]` wholesale, so nothing in the
ledger still says a strike happened. The charge is therefore carried by the
**carrier's row**: what the ship's condition says has already been paid for. H9
prices the incident (the strike and the kill that ends its repair); §4 prices
episodes, which is why one cannot be read out of the other.

**And the row says the ship was struck, not who struck it.** The `disable` names
the shooter, but a `repair-start` cannot carry two causes, so the recovery
standing in the berth is the home station's. This ruling therefore holds while
the player's own fire is the only thing that diverts a carrier — which it is, and
what H3d's trigger is made of. Should another source ever divert one, the credit
here would be a discount on a fight the player did not start, and H9 would have
to be amended to read provenance rather than presence. That is a change to this
ruling, not a detail inside it.

The principal was offered this and summing, and chose this.

### H10 — Three changes, not one (then four)

1. **Destroy, drop the manifest, heat.** H0, H1, H2, H3; the projection gating on condition;
   H4's kill write and the decaying reader; the rail (H7's first half); the
   targeting arm; the canisters drawn from `carrierManifest`.
   **A survivor is transient in this change** — H3b is the next one.
2. **The diversion.** H3b, H3c, H3d, H4's strike heat, and H9.
3. **Witnesses and shipyards.** H5, H6 and H7's second half.
4. **The sustained-fire offence, the victim's hail, and earshot.** H3d narrowed,
   H4's third rung, H5's reach, H6's second list, H7's rail value, H9's three-rung
   lattice. Ruled by
   [#396](https://github.com/jcfischer/seelite/issues/396) off the flight report
   that was [#395](https://github.com/jcfischer/seelite/issues/395), built by
   [#429](https://github.com/jcfischer/seelite/issues/429), and not a child of
   #362: it amends three ratified H-clauses and adds a rung rather than landing a
   piece that was always owed.

The principal chose this over one change. The second and third are child nodes
of #362 — [#365](https://github.com/jcfischer/seelite/issues/365) and
[#366](https://github.com/jcfischer/seelite/issues/366) — and #362 closes
when all three are flown. #359's remaining build was
[#364](https://github.com/jcfischer/seelite/issues/364), the scan itself, which
lands beside this spec's standing rather than inside it — and what #359 still
leaves owed is recorded on the map, not here.

### H11 — One canister per manifest line

A destroyed ordinary carrier drops one canister per line of its manifest, and
each canister holds that line's tonnes. A manifest has one to four lines and
never more tonnes than the hull's `holdT`, so a kill drops about as many
canisters as a raider's — one to four against one to three — and a freighter's
hold in weight. Scooping takes what fits the
player's free hold and leaves the rest in the canister.

The principal was offered this, one one-tonne canister per tonne — sixty for a
full Porter — and small manifests in one-tonne canisters, and chose this. It
makes a canister's tonnage a field rather than `CANISTER_TONNES`, which raider
drops keep.

`carrierManifest` therefore reads the hull's hold and the system's government,
which `carrier-identity.md` §3's signature did not name:

```
carrierManifest(systemSeed, carrierKey, instanceOrdinal, voyageOrdinal,
                { holdT, government })
```

The contraband weighting is `cargoWeights(government)`, as §3 asked.

### H12 — Starting standing forms

Wanted 12 %, Fugitive 3 %, and a rotation period of 6 h of game time with a
phase drawn per carrier instance. **These are starting forms, not measured
figures**: the committed instrument prints the shares across seeds and
galaxies, and the principal tunes them after flying. At 6 h a two-minute
interval from scan to kill spans a rotation boundary about 0.6 % of the time,
which is F7's "long against" in figures.

The principal was offered these, shares scaled by government, and rarer
standing on a 12 h rotation, and chose these.

## What building the first change found

Recorded because each would have shipped green without the browser tier.

- **A fight beside a station was aimed in star coordinates.** `combat-enemy.ts`
  led its pursuit on the player's absolute velocity. Every raider duel is fought
  on a cruise leg, where the frame is the star's and the two agree; beside a
  station the frame moves ~30 km/s, and a struck patrol led up to 150 km along
  the orbit and flew away from the fight. The lead is taken relative to the
  frame now, which changes nothing in the star frame.
  `tests/traffic-engagement.test.ts` holds it, and the probe's armed row was red
  before it.
- **Authority readiness counted the roster.** `trafficAuthorityReady` compared
  routes with actors, and a destroyed carrier has no route, so a kill left the
  system's authority "warming" until the replacement — and every lane request
  there refused. It counts the carriers Traffic draws, flying and diverted; the
  probe row was built red against the roster comparison.
- **The module is `traffic-engagement.ts`, not `civilian-combat.ts`.**
  `tests/combat-rig-boundary.test.ts` bans the word *combat* from `main.ts` to
  keep the prototype rig unthreaded, and an import specifier counts.

## What building the second change found

The same rule, on the diversion.

- **The tick a carrier is struck is the tick its berth could be dealt twice.**
  A divert books the home berth while the carrier's *schedule* still says it is
  away, so the flying actors' berth catalogue still held a term for the ship
  that had just come in, and it was the one the struck hull was standing in. The
  parked projection goes into `occupied` before any flying actor is dealt a pod.
  The probe scans the berths Traffic is holding for a second hull on each.
- **What an incident has already cost is not in the episode ledger.** An
  `interrupt` closes the strike's episode and the `destroy` that follows opens a
  new one which replaces `episodes[key]` wholesale — H9's supersession is not
  recoverable from it, and a read taken before the write can be stale besides.
  So the charge is read off the carrier's own row: `chargedOffence` asks where
  the ship is *and what the strike it is standing for cost* — which it can answer
  because the row keeps the strike's clock (`recovery.startedAt`) and standing is
  a pure derivation from a clock. A strike on a carrier that was Wanted then
  charged nothing, and the kill after it is a full 40; the rule is right straight
  after a reload with no engagement flag carried across a save.
  `tests/legal.test.ts` holds the arithmetic, and the row of
  `tests/traffic-engagement.test.ts` named for the ledger holds the reason the
  ledger cannot answer it.
- **A kill on the way home interrupts to `disabled`, not to `destroyed`.** The
  tempting shortcut — `interrupt` with `resulting: "destroyed"` — leaves a
  carrier already written as destroyed, and `destroy` is illegal from
  `destroyed`: no destroy event, so no replacement schedule, and a berth nobody
  ever empties.
- **A diverted carrier's contact leaves with the engagement.** Out of the band a
  survivor used to hand back to the route it was struck on and keep its contact;
  a struck one has no route to hand back to — its projection is a berth 12,000 km
  from the player — so the contact stayed live and the ship was standing in its
  berth the frame the fight stopped. `trafficShown` is the presentation's gate and
  the engagement drops the contact with it.
- **The browser tier cannot time a shield side, and that is not a defect in the
  divert.** Which side of a fleeing carrier the beam finds is a matter of how it
  fled, so the seconds a hull took to open is not a fact about H3d. What the
  probe holds is the frame-precise one — the hull was whole on the frame before
  the row turned, and points were spent on the frame it did — and the arithmetic
  against `SHIELD_POOL / PULSE_LASER.damagePerS` stays where the geometry is
  pinned, in the headless rig. A row that asserted the seconds was falsely red
  here before it was rewritten.

## What reading a struck civilian found (#395)

Found by the principal flying H5's checkpoint, not by a row. Nothing below moves
a threshold in this document: H3, H3b, H3c, H3d and H4's rules and figures are as
agreed, and the trigger question is its own node.

- **The sim was right for twenty seconds and the glass said nothing.** An engaged
  carrier has had a `ShipCondition` since H2, the beam was landing, the carrier
  was fleeing from the first frame it did — and the line under a selected
  target's name was gated `raiderSelected ? … : undefined`, so none of it was
  drawn. The pilot's report was "nothing happened", and reading the glass was the
  correct way to reach that conclusion. A target a rule hands a condition is a
  target the glass has to read; the wire, not the state, was the gap.
- **The word "DIVERTING" arriving *is* H3d becoming visible.** The divert is
  written in the same tick as the hull strike (H3c), so a pilot who has spent
  seventeen seconds stripping one facing of a freighter's shields sees no word
  beside its name the whole time — and sees one on the frame the first hull point
  lands. That is the ruling, not a presentational choice: a shield-stripped
  carrier has not left its schedule, and the absence of the word is the reading
  of that. Which is why the word is absent for a carrier flying on time rather
  than always present: a state word that never leaves is a decoration.
- **A law written in points cannot cover a fleet**, and the fix is a share of the
  target's own capacity. `hud-and-scanner.md` §5.4 owns the reason and
  `printHullPercent` owns the law, so what is recorded here is only the part that
  is this document's: #367 D1 travels with the ruling, and **where its floor is
  anchored changed**, because the point form's was never its own — `printHull`
  cannot print 0 for a live ship only because `applyDamage`, the one writer,
  zeroes hull below a tolerance measured in points. The game does not reach a live
  hull printing 0 and this is not a claim that it does; what the share buys is
  that the floor stops being borrowed from the writer and sits at the resolution
  the print has, which is the property a roster of nine capacities needs. The
  point form stays on the Flight console, where the capacity is printed beside the
  figure.
- **A record of a painted label parked on a raider's firing cue.** The condition
  line was `cueRender.enemyLine`, beside the field that carries the duel's tone —
  amber, red while the raider fires. That is why a civilian under fire had no
  record of the line it was not drawing either, and why the field could not grow
  one without a tone it did not have. It is `selectedRender.conditionLine` now,
  where the painted label already lived.

## Rules this makes false, and where they are amended

Each is amended in the change that builds it, not ahead of it.

| Rule | Owner | Change |
| --- | --- | --- |
| "A visible Traffic route adds no collision or combat physics" | `in-system-route-traffic.md` §5 | A fired-on carrier leaves its projection; a destroyed or repairing one does not fly it (1, 2) |
| "Traffic actors do not add collision or combat physics in #148" | `station-traffic.md` §3.1 | Same (1) |
| Standing and manifest keyed on the slot | `carrier-identity.md` §2, §3 | `instanceOrdinal` in both signatures, and the voyage is `flownVoyageOrdinal` (F11, §3, §5) (1) |
| §7's "Nothing writes heat" and §11's handoff | `carrier-identity.md` §7, §11 | Discharged, pointing here (1) |
| Offences and thresholds named without figures | `combat-model.md` §4 | §4.2: a pointer to H4 and H7, plus H1, H2 and H11 as built — the replacement, the combat condition, and a canister's tonnage as a field with a scoop that takes what fits, the exception to §4.1's one-tonne canister (1, 3) |
| "the frame body is the witness" — H5 as ratified | this spec's H5, H6 | Amended by #396, built by #429: the reach is `DISTRESS_RANGE_KM`, measured from the victim, and the hearer set is computed rather than inherited from the flight assist |
| Sustained fire is not an offence, and a hail is nowhere drawn | this spec's H3d, H4, H7, H9 | Amended by #396, built by #429: the third rung, the `assaulted` list, and the rail's `HAILS` value |
| The interim 600 s hostility cooldown awaiting #8 | `docking.md` §6 | Kept, and narrowed to what it always was: the barge flip's exit. H5 adds a **second**, derived hostility beside it whose exit is heat decay — two fields, because they have two exits (3) |
| `LegalStatus` is `{ heat, updatedAt }` | `persistent-world-state.md` §7 | Gains `witnesses` (3) and `assaulted` (4) |

## Verification obligations

| Case | Evidence | Change |
| --- | --- | --- |
| Standing and manifest are deterministic and per instance | Headless: same inputs twice; a new ordinal draws independently | 1 |
| Standing holds from scan to kill | Headless: the rotation period is long against that interval (`carrier-identity.md` F7) | 1 |
| Standing distribution | A committed instrument printing shares across seeds and galaxies, with spread | 1 |
| A civilian obeys the shared model | Headless: `fullCondition` for every roster hull; H2's times derived from the constants | 1 |
| Reaction per role | Headless: a civilian never enters `attack`; an armed hull does only after being struck | 1 |
| A destroyed carrier does not fly | Headless: projection absent while destroyed; replacement at the next ordinal | 1 |
| The drop is the manifest | Headless: canisters equal `carrierManifest(key, ordinal, voyage)` | 1 |
| Heat by true standing, decay, cap | Headless: Clean kill +40, Wanted 0; half-life; H4's durations | 1 |
| The laser takes a civilian | Browser probe: ON TARGET on a selected Traffic contact | 1 |
| The left console's readout shows standing | View set (`raider-log` frames it) plus the principal's yes | 1 |
| The kill and its cost feel right | The principal flying it | 1 |
| A survivor diverts and returns | Headless: disable + repair-start at the strike; parked at home; same ordinal on completion | 2 |
| Strike then kill costs 40 | Headless | 2 |
| A witness is hostile until heat decays | Headless: offence beside a station, hostile at Wanted, open below it, across a save | 3 |
| Shipyards refuse Wanted | Headless: denial reason `hostile` | 3 |
| Old saves load | Headless: a save without `witnesses` parses to `[]` | 3 |
| The sustained-fire rung is legally alive | Headless: its heat sits inside the 10 … 15 interval, crosses Wanted and stays there for the interval decay gives it | 4 |
| The ladder cannot tie | Headless: every ordered pair of the three rungs, in both orders, costs the larger rung and no more | 4 |
| The clock charges at the seconds it declares | Headless: to the frame and not a frame early; holds across the gaps between hits; a stray hit under the threshold charges nothing and files nobody | 4 |
| One charge per carrier per incident | Headless: latched once however long the fight runs; a fight resumed after a reload starts latched and never re-crosses; the mark clears with the heat | 4 |
| Earshot is the victim's | Headless: a berth past `NEAR_FAR_KM` but inside `DISTRESS_RANGE_KM` is filed; every station in earshot is filed and not the nearest; `[]` is a computed answer | 4 |
| Both lists survive the save boundary | Headless: `assaulted` round-trips in canonical order, is omitted when empty, and a save predating either list parses to two empty ones | 4 |
| The hail is drawn | Browser probe: the rail's `HAILS` value, a line on the Communications log, and the alert, on the frame the first hit lands against a Clean carrier — and none of the three for a Wanted one | 4 |
| What the pilot was charged for is legible | **The principal flying it**: held fire long enough to be charged, saw the hail and the rail value and the log line, and could say afterwards what the five seconds cost them | 4 |

## Scope

This builds civilian combat and its legal consequence. It does not build
faction simulation, bounty economics, the job catalogue, the scan verb or the
name draw — the last two are #364's, shipped beside this node's standing rather
than inside it. It does not reopen the request contract, the law model, the
combat model or `carrier-identity.md`'s F1–F12, the lootable manifest included.

**"It does not build police AI" is retired** (#396, discharged by #429). That
exclusion was written while nothing in the game could hear an offence: with no
witness, no responder and no consequence beyond heat, building a police hull
meant inventing the thing the law was supposed to justify. H5 now files every
station within earshot, the sustained-fire charge means a distress call has a
moment to be made at, and [#428](https://github.com/jcfischer/seelite/issues/428)
owns the question of who answers one. Nothing here builds the responder — #429
was written against a map that still said police AI was out of scope, and its
own exclusion is the line above being deleted — but it is no longer a thing this
spec refuses, and #428's answer is what will decide its shape. What #429 did
discharge is the *legibility* half of what the exclusion was standing in for: a
pilot is now told, by the victim, by the rail, by the log, and by the charge's
own line, before any responder exists to be surprised by.
