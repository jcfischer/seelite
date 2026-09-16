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
and do not block this one.

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
constants; `tests/traffic-engagement.test.ts` pins it per hull and is its only
copy. The figure the principal was shown for a Porter was about 45 s. A real
chase is longer by the time off target.

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
2. `repair-start`, with the home station's provenance, `completesAt = now + T`.

`repair-complete` returns it to operational with its `instanceOrdinal`
unchanged — the same ship, which H1 does not contradict because nothing was
replaced. `repairing → destroyed` is a shipped transition, so the ship stays
killable on its way home.

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

### H4 — The heat an offence costs

| Offence against a **Clean** carrier | Heat |
| --- | --- |
| Destroyed | 40 |
| Struck (the H3d hit) | 15 |

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
alone is about 17 minutes Wanted.

### H5 — The station the offence happened beside turns hostile

If an offence's frame body is a station, that station turns hostile, and stays
hostile while the player's heat is Wanted or above. For one Clean kill that is
about 60 minutes.

The principal was offered this, the same with the shipped 600 s cooldown, the
victim's home station noticing too, and no station noticing, and chose this.

This is the replacement `docking.md` §6 reserved for #8 ("#8 replaces it with
legal-status decay"), and its condition holds: the exit is decay, so no save can
be locked out of its only station. **The reach is `NEAR_FAR_KM`, 20,000 km**,
because that is the frame body's rule and the place a pilot is *at*; it is
stated here so nobody reads it as a separate witness radius. The
barge-without-clearance flip keeps its 600 s cooldown — that is a different
offence and not this node's.

### H6 — Witnesses are saved on `LegalStatus`

```
interface LegalStatus {
  heat: number;
  updatedAt: number;
  witnesses: CarrierKey[];   // stations that saw an offence
}
```

A station is hostile when it is in `witnesses` and heat is Wanted or above. The
list is cleared lazily when heat is read below Wanted. It holds each station at
most once per galaxy, so what reaches its bound is offending beside every
station in a galaxy inside one Wanted interval.

The principal was offered this, an "offence witnessed" episode on the station's
own world-state row, and session-only hostility, and chose this. Session-only
lets a reload or a jump out and back clear what decay is meant to clear.

A save without the member parses to `[]`, so **no `WORLD_SCHEMA_VERSION`
bump**: a version mismatch refuses the whole save (`persistent-world-state.md`
§9, #89), and an optional member with a default needs none.
`scripts/measure-save-size.ts` re-measures the ceiling.

### H7 — The HUD shows standing, and shipyards refuse Wanted

The left console's readout shows LEGAL STATUS as Clean, Wanted or Fugitive,
stepping back as heat decays, on both left tabs. The rail keeps its label. Every shipyard denies docking with the reason `hostile` while heat is
Wanted or above, which is `combat-model.md` §4's "thresholds determine … shipyard
hostility". Trade stations and refineries become hostile only through H5.

The principal was offered this, the rail alone, and shipyards refusing only at
Fugitive, and chose this.

### H8 — A lawful kill pays only through a request

Confirmed rather than decided: a Wanted or Fugitive kill costs no heat and drops
the manifest, and the `destroy` with the player's provenance is the evidence a
bounty job reads. Nothing here pays cash (`combat-model.md` §4,
`ordinary-requests.md`).

### H9 — A kill supersedes the strike that preceded it

The heat for one instance in one causal episode is the largest offence in it,
not the sum. A strike followed by a kill costs 40, not 55, so H4's durations are
the ones a pilot meets. The episode is `persistent-world-state.md` §4's: the
`disable` opens it, and the kill that interrupts the repair closes it.

The principal was offered this and summing, and chose this.

### H10 — Three changes, not one

1. **Destroy, drop the manifest, heat.** H0, H1, H2, H3; the projection gating on condition;
   H4's kill write and the decaying reader; the rail (H7's first half); the
   targeting arm; the canisters drawn from `carrierManifest`.
   **A survivor is transient in this change** — H3b is the next one.
2. **The diversion.** H3b, H3c, H3d, H4's strike heat, and H9.
3. **Witnesses and shipyards.** H5, H6 and H7's second half.

The principal chose this over one change. The second and third are child nodes
of #362 — [#365](https://github.com/jcfischer/seelite/issues/365) and
[#366](https://github.com/jcfischer/seelite/issues/366) — and #362 closes
when all three are flown. #359's remaining build is
[#364](https://github.com/jcfischer/seelite/issues/364).

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
  there refused. It counts the flying carriers; the probe row was built red
  against the roster comparison.
- **The module is `traffic-engagement.ts`, not `civilian-combat.ts`.**
  `tests/combat-rig-boundary.test.ts` bans the word *combat* from `main.ts` to
  keep the prototype rig unthreaded, and an import specifier counts.

## Rules this makes false, and where they are amended

Each is amended in the change that builds it, not ahead of it.

| Rule | Owner | Change |
| --- | --- | --- |
| "A visible Traffic route adds no collision or combat physics" | `in-system-route-traffic.md` §5 | A fired-on carrier leaves its projection; a destroyed or repairing one does not fly it (1, 2) |
| "Traffic actors do not add collision or combat physics in #148" | `station-traffic.md` §3.1 | Same (1) |
| Standing and manifest keyed on the slot | `carrier-identity.md` §2, §3 | `instanceOrdinal` in both signatures, and the voyage is `flownVoyageOrdinal` (F11, §3, §5) (1) |
| §7's "Nothing writes heat" and §11's handoff | `carrier-identity.md` §7, §11 | Discharged, pointing here (1) |
| Offences and thresholds named without figures | `combat-model.md` §4 | A pointer to H4 and H7 as built (1, 3) |
| The interim 600 s hostility cooldown awaiting #8 | `docking.md` §6 | Replaced by H5 for an offence beside a station (3) |
| `LegalStatus` is `{ heat, updatedAt }` | `persistent-world-state.md` §7 | Gains `witnesses` (3) |

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

## Scope

This builds civilian combat and its legal consequence. It does not build police
AI, faction simulation, bounty economics, the job catalogue, the scan verb or the
name draw. It does not reopen the request contract, the law model, the combat
model or `carrier-identity.md`'s F1–F12, the lootable manifest included.
