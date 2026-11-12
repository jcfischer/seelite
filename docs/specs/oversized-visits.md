# Oversized ship visits: external berthing, Traffic identity and the shuttle

> Implementation proposal for work-graph node
> [#1239](https://github.com/jcfischer/seelite/issues/1239), prerequisite
> analysis for
> [#1035](https://github.com/jcfischer/seelite/issues/1035) ("Draw the other six
> hulls from their authored models"). The build briefs are in
> [oversized-visits-briefs.md](oversized-visits-briefs.md). Nothing here is
> implemented; this document is a proposal for principal review.

Every claim carries one of four labels:

- **[S] settled**: a principal ruling. Not re-opened here.
- **[M] measured**: reproduced this session by a command in §9, at the named base.
- **[T] technical recommendation**: mine; the principal may overrule it.
- **[Q] player-facing decision**: unsettled and owned by the principal. No brief
  builds one of these by assumption.

## 0. Provenance

- Base: `11272f402b5ab6a2da4aeee5d05200008a73d516` (`origin/main` at the start of the session).
- World seed `0x5ee11e`, the seed `tests/world-state.test.ts` pins its goldens to.
- Settled by the principal on #1035, agreed 2026-11-10 **[S]**:
  - **D1**: retain the authored dimensions and give truthful collision envelopes. Whether the
    approved dimensions may change is not asked again here.
  - **D2**: oversized ships dock externally at shipyards and can visit other station roles
    while remaining outside, with small shuttles ferrying between station and ship.
  - Existing carrier keys, hull assignments, history, knowledge and consequences are preserved.
    Unrelated Traffic actors are not silently reshuffled.
- Source models are the seven-ships study files (`spikes/seven-ships/<role>/model.glb`), accepted
  by the principal on 2026-10-09 (`spikes/seven-ships/STATUS.md`). In the working tree they are Git
  LFS pointers; `scripts/measure-oversized-hulls.ts` reads the objects from the LFS store by the
  pointer's `oid`.

## 1. Measured envelopes

### 1.1 Source versus shipped

Only one of the seven is a shipped game asset: the Lance interceptor
(`src/models/lance-interceptor.glb`, node #1034). The six in scope are **source-only**: study
exports that `spikes/seven-ships/prepare-game-asset.mjs` has not yet been run on. Its header claims
positions are exact. The one pair that exists to check that claim agrees: the Lance's source and
shipped GLBs decode to the same box, 25.0220 × 25.0198 × 62.3085 m, and 587,810 triangles each **[M]**.
So the six numbers below are source-only measurements, expected (not proven) to carry over to
their prepared files. The integration re-measures after `prepare-game-asset.mjs`.

| Hull (role) | Source `oid` (sha256, first 12) | Triangles |
| --- | --- | ---: |
| Warden (`patrol`) | `1adfac1a45eb` | 795,784 |
| Pilgrim (`explorer`) | `9915fca11ea6` | 879,036 |
| Shiv (`raider`) | `155c894decfe` | 825,596 |
| Bastion (`carrier`) | `128e164ac2ee` | 1,350,582 |
| Sluice (`prospector`) | `15bda93f96c2` | 428,524 |
| Rampart (`dreadnought`) | `4a27d3f4b08b` | 2,282,852 |

### 1.2 The decoded envelope, with the habitat swept

Decoded through the production `GLTFLoader` and Meshopt decoder (`scripts/lib/shipped-glb.ts`'s
`withoutTextures`, the same entry the shipped-hull tests use). A vertex under a node named
`habitat-rotor` or `rotor:*` is taken at its largest radius about the +Z rotor axis, so the box is
the **swept** cylinder, not the pose the file happens to be saved in. Study frame: X beam, Y height,
Z length. The last column is the game envelope rule (`HULL_SPECS[id].env`: rounded **up** to 0.1 m).

| Hull | Rotor | Swept radius | Swept box, beam × height × length (m) | Game envelope (km) |
| --- | --- | ---: | --- | --- |
| patrol | no | – | 33.820 × 12.108 × 55.308 | 0.0554 L, 0.0339 B, 0.0122 H |
| explorer | yes | 42.295 m | 84.545 × 84.516 × 73.808 | 0.0739 L, 0.0846 B, 0.0846 H |
| raider | no | – | 33.820 × 11.678 × 56.308 | 0.0564 L, 0.0339 B, 0.0117 H |
| carrier | yes | 94.797 m | 189.492 × 189.492 × 406.760 | 0.4068 L, 0.1896 B, 0.1896 H |
| prospector | no | – | 20.008 × 15.000 × 66.400 | 0.0664 L, 0.0201 B, 0.0150 H |
| dreadnought | yes | 94.797 m | 189.492 × 189.492 × 432.000 | 0.4320 L, 0.1896 B, 0.1896 H |

Bounding-sphere radius (half the box diagonal): Pilgrim 0.0703 km, Bastion 0.2436 km, Rampart
0.2542 km **[M]**. The authored habitat sizes and RPMs (Pilgrim 80 m floor, 3 RPM; Bastion and
Rampart 180 m floor, 2.5 RPM, per `model-report.json`) are inputs, not outputs of this work, and
nothing here changes them **[S]**.

### 1.3 Against the current rows

Current `HULL_SPECS[id].env`, km (L × B × H): patrol 0.0586 × 0.0385 × 0.011; explorer
0.0738 × 0.0385 × 0.0397; raider 0.0635 × 0.0344 × 0.0109; carrier 0.3797 × 0.1764 × 0.145;
prospector 0.0665 × 0.0253 × 0.0192; dreadnought 0.4066 × 0.1331 × 0.1111 **[M]**. The new boxes move
every row, but only the Pilgrim's move changes a fit: its beam and height go from 38.5 × 39.7 m to
84.6 × 84.6 m, because the file's ring turns about the nose axis and the current row describes a
hull with no ring.

### 1.4 Against apertures and internal berths

Berth clear envelope (`stationInterior`, uniform within a role) and aperture
(`STATION_GEOMETRY`), km **[M]**:

| Role | Berths | Clear L × B × H | Aperture |
| --- | ---: | --- | --- |
| trade | 8 | 0.09 × 0.058 × 0.04 | slot 0.12 × 0.07 |
| shipyard | 6 | 0.09 × 0.058 × 0.04 | slot 0.12 × 0.07 |
| refinery | 4 | 0.09 × 0.058 × 0.04 | pad 0.15 × 0.15 |
| outpost | 2 | 0.078 × 0.054 × 0.03 | pad 0.12 × 0.12 |

| Hull | Internal berth (any role) | Slot 120 × 70 | Refinery pad 150 | Outpost pad 120 |
| --- | --- | --- | --- | --- |
| patrol, raider, prospector | fits | fits level and rolled 50° | fits | fits |
| explorer | **fits none** | **fails**: a 84.6 m circle cannot pass a 70 m height at any roll | admitted | admitted |
| carrier, dreadnought | fits none (already true today) | fails | fails (189.6 > 150) | fails |

Two consequences **[M]**:

- **Only the Pilgrim changes who fits where.** The three smaller hulls fit every berth and
  aperture before and after. The capitals fit nothing before and after; they only grow, which the
  capital rule already covers (`docking.md`, "Neither the carrier nor the dreadnought fits").
- **The Pilgrim is the only one of the six that is both oversized and ordinary.** It is a
  purchasable hull (`PURCHASABLE_HULL_IDS`), a Traffic pool member at trade stations
  (`TRAFFIC_HULL_POOLS.trade`), and today fits the trade, shipyard and refinery cells (38.5 × 39.7 m
  against 58 × 40). #1035's own assumption ("a capital's ~189 m envelope fits its `HULL_SPECS`
  envelope and berth") is false for the berth and was always going to be: no berth admits a capital.

### 1.5 Collision proxy and station motion

The collision box is `HULL_SPECS[id].env` plus `envCentre` (`collision.md` §2.3). For a rotating
ring the swept box in §1.2 is the truthful, conservative box: any smaller box leaves ring outside
it for part of every revolution **[T]**. `envCentre` for the new meshes is not measured here; the
integration re-measures it (`tests/collision.test.ts` rebuilds every mesh).

Station reach (`stationSilhouetteKm`, km) and spin **[M]**: trade 0.62–1.0; shipyard 1.5–1.87;
refinery 0.89–1.24; outpost 0.42–0.58. Slot stations spin 0.6–3.0 rpm (`SPIN_RPM_RANGE`); a shipyard
tip at 1.87 km and 3 rpm moves at 0.59 km/s. Refineries and outposts do not spin. Existing Traffic
holds already ignore the rotation: `trafficHoldProjection` stands off at phase zero in a
non-rotating frame, 5 km out on the axis plus 1.5–3 km lateral.

## 2. How Traffic depends on internal berths today

All references are to the base. **[M]** unless noted.

| Quantity | Depends on internal berths how | Where |
| --- | --- | --- |
| Roster size | `trafficBerths(interior).length`: the catalogue minus the visitor berth (7, 5, 3, 1). **Not on hulls.** | `station-traffic.ts:122` |
| Hull assignment | `compatible = pool.filter(id => any berth fits HULL_SPECS[id].env)`, then actor `n` takes `compatible[floor(unit·len)]`. The **position in the filtered list** decides, so removing one entry re-indexes every later pick. | `station-traffic.ts:130-148` (filter `:130`, signature check `:133`) |
| Signature slot | Ordinal 0 is forced to the role's signature (`freighter`, `patrol`, `miner`, `courier`); the build throws if it fits no berth. | `station-traffic.ts:133` |
| Callsign | `trafficRegistry(hullId, …)`: derived from the hull, so a reassigned hull renames the ship. | `station-traffic.ts:163`, `carrier-name.ts:77` |
| Local home berth | `trafficBerths[ordinal % length]`: chosen by ordinal, **not by fit**. An actor whose hull fits none would be drawn parked in a cell it does not fit, with no error. | `station-route.ts:1781-1787` (the index is at `:1784`) |
| Local destinations | `fits` filter over the system's stations; with none, the visit becomes `abstract-away` (the safe fallback already exists for the away interval). | `station-route.ts:958-1010` |
| Hauler home berth | `fittingTrafficBerths(...)[ordinal % len]`: divides by zero if empty. | `station-route.ts:2265-2276` |
| Hauler eligibility, vocation, `cycleMultiple` | `boundsIfFits`/`haulerBounds` per (system, station, hull); both **throw** when no Traffic berth fits (`no Traffic berth for <hull> at <station>`). Eligible set, vocation and cycle multiple then depend on the hull's `tankLy` and `chargeAu`. | `inter-system-traffic.ts:115-116, 158-236` |
| Schedules | `cycleS`, `departureAtS`, `awayS` depend on berth count and station seed only. Not on hulls. | `station-traffic.ts:124-170` |
| Identity fingerprint | `carrierBaselineFingerprint` hashes `traffic:<homeType>:<hullId>`: a changed hull changes the fingerprint. | `world-state.ts:806` |

Player side: `requestClearance` denies a hull no berth fits with `no berth that fits`
(`docking.ts:876`); `deliverHull` returns `on-launch` when no berth fits, and the swap happens at the
outward aperture crossing (`main.ts:14405-14410`; the swap is `:14408`).

## 3. The Traffic comparison

Command: `bun scripts/measure-oversized-traffic.ts --haulers`, base above, seed `0x5ee11e`, all 8
galaxies × 256 systems, 19,114 Traffic actors (trade 14,336; refinery 2,304; shipyard 1,900;
outpost 574). Scenario **A** is the code at base (its eight fingerprints equal the goldens in
`tests/world-state.test.ts`). **B** installs §1.2's envelopes and changes nothing else, which is
what a plain integration does. **F** keeps A's hull assignments and asks which no longer fit.

**Scenario B, naive integration [M]:**

- **Hull assignments changed: 3,641 of 19,114 (19.05%), in 1,812 systems, all at trade stations.**
  Roster sizes are unchanged.
- 1,999 actors were Pilgrims (all at trade stations). In B they are 1,196 Longwall, 803 Towline
  (`explorer>miner` 1,196, `explorer>tug` 803).
- **1,642 actors that were never Pilgrims also change hull**: `miner>freighter` 810,
  `tug>prospector` 412, `freighter>courier` 420. This is the list-position effect in §2, and it
  is exactly the "silent reshuffle of unrelated Traffic actors" D1/D2 forbid.
- **All eight galaxy fingerprints move.** The pinned goldens would go red, which is the guard
  working, and would force a generator bump and a real migration for something that is not a
  world change.
- Hauler plans (A vs B, 19,114 plans, 4,969 haulers in A): 66 vocation flips, 209 `cycleMultiple`
  changes, 970 eligible-destination sets changed.

**Scenario F, identities preserved, envelopes new [M]:**

- 1,999 actors (all `trade:explorer`) have no internal Traffic berth, in 1,333 systems.
- **466 of those systems have a single station**, so a visiting oversized ship has no in-system
  alternative and the local route has nowhere to go but the home station.
- 662 of the 1,999 are inter-system haulers in A, with 17,781 eligible (system, station)
  destinations among them. Under F the Pilgrim can enter none of those stations, and
  `boundsIfFits` returns null for each home station, so `buildHaulerPlans` throws at the first
  Pilgrim in any system (`inter-system-traffic.ts:197-199`). The B run did not throw only because
  the filter had already dropped the Pilgrim.
- Pilgrims are a trade-station population only: no other role's pool holds one (the outpost cell
  already rejects the current Pilgrim). Their visits to other roles are the hauler and local
  destination legs above.

`tests/oversized-roster-baseline.test.ts` pins the quoted figures (19,114; 1,999; 3,641; 1,642; the
eight fingerprints) so the prose cannot drift from the generator.

## 4. Proposal

### 4.1 Identity: freeze the assignment, separate it from fit [T]

**D1. Assign hulls against a frozen identity baseline, not live envelopes.** Add a table of the
generator-11 envelopes (the 12 rows as they stand at the named base) used only by
`stationTrafficRoster`'s compatibility filter. Physical fit continues to read live
`HULL_SPECS[id].env`. The baseline is named, versioned (`TRAFFIC_IDENTITY_ENV_VERSION = 11`) and
reproduces every existing assignment, because it is the table that produced them. Tests: with all
six envelopes installed, 0 of 19,114 actors change hull and all eight fingerprints equal the
goldens (the inverse of the §3 result). No generator bump, no schema change, no migration: nothing
persisted moves.

**Rejected [M]:** substituting a fitting hull for the Pilgrim (3,641 changes, §3); keeping a false
collision envelope (D1 forbids); shrinking the ring (changes the habitat's gravity and the approved
model).

**D2. Roster identity, home affiliation and physical berth are three facts.**

| Fact | Owner | Depends on |
| --- | --- | --- |
| Roster identity (key, hull, callsign, schedule) | `stationTrafficRoster` | station seed, frozen baseline |
| Economic/home affiliation (`homeStationId`) | the roster | unchanged |
| Physical berth (where the hull is when parked) | a new `physicalBerthOf(actor)` | live envelope; internal berth where one fits, otherwise an external berth (§4.2) |

Roster size stays `trafficBerths(interior).length`. An oversized actor keeps its ordinal and its
"home berth slot" as an identity; it simply parks outside. This also fixes the silent hazard in §2
(`ordinal % length` home berth ignoring fit) by making fit part of the berth's answer.

### 4.2 External visit lifecycle (NPC) [T]

New route phases extend `TrafficRoutePhase` for an actor whose hull fits no internal berth at the
station it is visiting or based at:

1. **Approach.** Unchanged: cruise to the existing station exclusion boundary
   (`TRAFFIC_STATION_EXCLUSION_KM` = 5 km), so everything before the hold reuses shipped laws.
2. **Hold.** The existing off-axis hold (`trafficHoldProjection`), unchanged. Already outside the
   rotation: the hold is non-rotating, 5 km out.
3. **Reservation.** An external berth is reserved through the same arbitration as an internal one:
   a grant *is* a reservation (`docking.md` §13.2), here for an `ext-n` catalogue entry. No fitting
   free external berth: the actor stays at the hold. This is today's `clearance-queued` shape.
4. **Berthed.** The ship holds a fixed pose in the station's non-rotating, translating frame at
   the external berth, for the actor's existing parked interval. It does not rotate with the station.
5. **Departure.** Release the reservation and leave by the hold, the reverse of 1 to 3.
6. **Blocked arrival.** If the wait exceeds a bounded window, the visit becomes `abstract-away`,
   the same fallback an actor with no fitting destination already takes. A queued oversized ship
   never waits for a berth that cannot exist (the queue/denial split `docking.md` §13.2 already
   draws).

**Geometry (what B2a measures, with the rule I recommend):**

- Berth centre lies in the station's non-rotating frame, outside the rotation cylinder: distance
  from the station centre ≥ `silhouetteKm + 2R + 0.1 km`, R the hull's bounding-sphere radius. At
  the worst reach (shipyard form c, 1.87 km) that is 2.11 km for the Pilgrim, 2.46 km for Bastion
  and 2.48 km for Rampart **[M arithmetic]**. A fixed 3.0 km standoff covers all three at every
  role with 0.5 km spare. It stays inside the 5 km hold, so the berth is nearer than the hold.
- Outside the docking corridor: the 3 km aperture-frame corridor (#419) is a lane. An external
  berth sits lateral to it by at least the corridor radius plus R.
- Clear of other ships: berths are separated by ≥ the sum of the two bounding-sphere radii plus
  a margin; an existing carrier's random hold (1.5–3 km ring, annulus area 21.2 km²) would
  collide with a 0.25 km-radius ship with probability about 3.7% per pair by area alone **[T,
  arithmetic, not measured]**, which is why external berths are an enumerated catalogue and not a
  hash of the key.
- **Capacity [Q3].** One external berth per station mirrors `VISITOR_BERTHS_PER_STATION` and
  is what the briefs assume; a second, or a larger capital cradle at shipyards, is a gameplay choice.

### 4.3 Player and purchase [Q]

The player's Pilgrim differs from an NPC in six ways: it is bought, it must launch, it must
return, it is saved, it takes services, and it is never abstracted away.

- **Purchase while docked.** `deliverHull` can only delay: with no fitting berth it returns
  `on-launch` and the new hull appears at the outward aperture crossing
  (`main.ts:14405`). For a Pilgrim that is impossible: an 84.6 m ring at the plane of a 70 m slot
  intersects the station proxy. The existing delivery law is a *delay* for a hull that fits
  something; a hull that fits nothing needs a different law. **Q1.**
- **Launch.** A Pilgrim cannot use the slot; from an external berth it departs by the hold, so
  the docked launch law never runs for it. Which launch the pilot sees from inside a station, if
  they bought it there, is Q1.
- **Return.** `requestClearance` already answers an oversized hull `denied: no berth that fits`
  (`docking.ts:876`). The new answer is a grant of an external berth. **Q2** below.
- **Save/load.** A docked commander saves `dockedAt` (a carrier key) and no berth id
  (`save-envelope.ts:402`); the docked restore re-enters "by the protocol, any free berth"
  (`restoreDockedAt`, `main.ts:21001`) and on failure leaves the ship beside the station. `hullOnLaunch`
  is **not saved**, so a save taken between a purchase and a launch reloads with the new hull and
  the old berth. Today that is unreachable; with the Pilgrim it is not. **[T]** Oversize is derived
  from the hull, so the save needs no new field.
- **Drive charge and fuel.** The map's Constraints give a free drive-charge refill on docking (#10). Whether an
  external berth counts as docking is a gameplay choice. **Q2.**

**Player-facing decisions (none built by assumption):**

- **Q1. How is an oversized hull bought?** O1: purchase is allowed only at a shipyard external
  berth, so the buyer arrives in a hull that can berth there. Circular for a first Pilgrim.
  O2: the trade-in completes inside, the pilot launches in the old hull, and boards the delivered
  Pilgrim at the shipyard's external berth by shuttle (the first shuttle use). O3: oversized hulls
  are not purchasable until the shuttle exists. I recommend O2 and treat O3 as the safe interim:
  it stops the Pilgrim being sold into a state the game cannot represent. The principal chooses.
- **Q2. What does an external berth give?** Console, market, fuel and drive-charge refill the same as
  inside, a reduced set, or none. And whether the pilot stays in the cockpit (the map forbids
  on-foot play) with the shuttle only carrying cargo.
- **Q3. Capacity and roles.** External berths per station (1 or 2), whether a shipyard has a
  capital-sized berth, and whether the player's Pilgrim may berth externally at roles other than
  shipyards (D2 says NPC oversized ships may visit other roles).
- **Q4. Saves that already hold a Pilgrim docked inside.** Preserve (place it at an external berth),
  leave it beside the station as the existing failed-redock path does, or refuse the load with a
  named reason. No data is lost in any of them; the choice is what the pilot sees.
- **Q5. Do capitals visit stations in v1?** Neither is purchasable nor in a Traffic pool, so
  nothing produces a Bastion or Rampart visit today.

### 4.4 The shuttle: a bounded first slice [T]

Slice 1 is **visual only and labelled so in its interface and its brief**: a small ship leaves the
station mouth, flies to the external berth, pauses, and returns. It moves no goods, no passenger and
no money, and nothing in the save records it. It is a pure function of the clock, the station
frame and the berth reservation, so it needs no persistence and nothing to settle on load.

Slice 1 states its inputs, and does not decide the following; each is a **[Q]** that blocks the
authoritative slice and is not built by assumption:

| Choice | Options for the principal |
| --- | --- |
| **Q6 Visible versus authoritative** | visual only forever; authoritative settlement of cargo/passenger after a visible transfer; a mix per use |
| **Q7 Station-side access** | which station role's mouth, or a dedicated shuttle dock; whether it uses the lane |
| **Q8 Dispatch and concurrency** | player-called, automatic on berthing, or standing service; one shuttle per external berth or per station |
| **Q9 Rendezvous** | at the external berth, at a fixed point between, or at the player's position |
| **Q10 Return and cancellation** | what a cancel does mid-flight; what happens to a shuttle holding cargo |
| **Q11 Parent departure and destruction** | a parent that leaves while the shuttle is out; a parent destroyed with the shuttle aboard |

No prices, trade privileges, combat consequences or economy rules are proposed. A shuttle and its
interaction with the lane are collidable Traffic (`collision.md`), so slice 1 owes a corpus row
proving its path enters no proxy.

## 5. Save and generator audit

Against `persistent-world-state.md` and the migration list (`WORLD_GENERATOR_VERSION` = 11,
`LEGACY_WORLD_GENERATOR_VERSIONS` = [10, 9, 8, 7, 6]).

| Saved reference | Affected? | Why / behaviour |
| --- | --- | --- |
| `CarrierKey` of every Traffic actor, in objective, recovery, legal-status (`witnesses`, `assaulted`), knowledge and deficit rows | Keys unchanged under D1. **Under a naive integration the key survives but its hull does not**: a saved "destroyed `Porter TR-03`" now names a different ship (1,642 such cases in §3). | D1 prevents it. Evidence: fingerprints equal goldens, and a fixture with a destroyed explorer key still names an explorer. |
| Carrier baseline fingerprint | Moves in 8 of 8 galaxies under a naive integration; unchanged under D1. | Pinned in `tests/world-state.test.ts`. |
| `commander.hull` | `explorer` stays valid. | Oversize is derived from the hull. |
| `commander.dockedAt` and `lastDocked` | A Pilgrim saved docked inside a station before the change is a state the new game cannot represent. | **Q4.** Both existing paths (external re-place; beside the station) lose nothing. |
| `hullOnLaunch` | Not saved (see §4.3). | The purchase flow of Q1 must define it before an oversized hull can be sold. |
| `deathWreck.hull` and offset | `explorer` or a capital id is already a valid hull; the placement is the lost hull's drawing id, frame and offset. Whether the offset is hull-box-relative was **not verified** here. | B4 owns the read and a round-trip test. |
| Loadout (`slots`) | Unchanged; hull stats and slot layouts do not change. | – |
| Callsign | Derived, not saved. | – |
| Shuttle state | None in slice 1. | A later authoritative slice must settle a transfer at a saved endpoint and never persist "in flight". |

**Generator and schema changes.**

- With D1: **no generator bump and no schema bump are necessary.** Nothing the generator emits
  (identity, type, parent, placement) changes. That is the answer, not an assumption: it is the
  assertion in B1's test.
- If the principal instead chooses to change hull identity (for example, replace Pilgrims), that
  is a generator bump to 12 with `LEGACY_WORLD_GENERATOR_VERSIONS` gaining 11, and a migration that
  keeps keys and rewrites nothing the hull names. This proposal does not recommend it and does not
  choose it.
- **Refused explicitly.** A saved docked commander whose station key no longer exists keeps
  today's behaviour (flight at the saved position). A load whose hull is oversized and which the
  chosen Q4 policy cannot place refuses with a named reason rather than dropping `dockedAt`
  silently.

**Required evidence.** The eight golden fingerprints with all six envelopes installed; a
save→load→save round trip for an oversized commander docked externally; an old fixture (a Pilgrim
docked inside, save envelope 18, generator 11) loading to the Q4 state; a destroyed-explorer deviation row
that still projects an explorer.

## 6. Minimum prerequisites for the six-hull integration

| Hull | Blocked by |
| --- | --- |
| Warden, Shiv, Sluice | Nothing in this chain: they fit every berth and aperture before and after (§1.4) and no Traffic pool changes (§3 shows no hull change when only these install). They owe B1's fingerprint assertion as a regression test. |
| Pilgrim | B1, B2a, B2b, B3 and B4, and Q1 to Q4. It is the only purchasable, Traffic-pool and docked-save hull among the six. |
| Bastion, Rampart | The truthful swept envelopes only (existing mechanism). Nothing produces them in Traffic or the shop; external visits need B2b only if Q5 says they visit. |

**Splitting the integration** into "three fitting hulls now" and "Pilgrim after the chain" is
justified by §1.4 and §3 and is **a principal decision, not mine**: #1035 is a single node and its
own assumption (above) is already false.

**Graph action required before this node closes (A1).** At the time of writing, `soma graph node
1035` reports `blocked by: 1034 (closed), 1239 (open)`. Closing #1239 therefore unblocks the six-hull
integration with no edge to any of the work above. I do not edit the graph (worker contract). Before
#1239 closes, the briefs must be filed and each of #1035's required slices given `--blocked-by`
edges to them, and #1035's acceptance line "bounds fit the hull's envelope and berth rows hold" must be
corrected for the Pilgrim and capitals.

## 7. Dependency chain

```
B1 identity baseline ────────────────┐
B2a external berth catalogue ──┬─────┼──> B2b NPC external visit ──> B3 player external docking ──> B4 save/restore ──> [Pilgrim in #1035]
                               └─────┼──> B5 visual-only shuttle (needs-eye)
Q1..Q5 (grilling) ───────────────────┘ (B3, B4, Pilgrim)
Q6..Q11 (grilling) ──> authoritative shuttle (not briefed: unsettled)
```

## 8. Open risks

- **R1**: the Pilgrim's rotor axis is assumed to be the nose axis (+Z in the study). The measured
  box is square in X and Y (84.545 and 84.516 m), which agrees; a ring on another axis would show it.
- **R2**: all measurements are source-only. Lance is the one source/shipped pair, and agrees.
- **R3**: the 3.0 km standoff and 3.7% overlap figures are arithmetic, not measured on a built
  station. B2a measures them over every form in every pool.
- **R4**: `ordinal % length` home berths (§2) already park by ordinal, not fit. This is correct
  today only because every ordinary hull fits every berth, and no test says so for Traffic.

## 9. Reproduction

All at base `11272f40`, from the repository root; evidence outside git in `/tmp/n1239/`
(`hulls.txt`, `hulls.json`, `traffic.txt`).

```sh
bun scripts/measure-oversized-hulls.ts --out /tmp/n1239/hulls.json   # decode six GLBs, swept envelopes, fit tables
bun scripts/measure-oversized-traffic.ts --haulers                   # §3, about 2 s
bun test tests/oversized-roster-baseline.test.ts                     # pins §3's figures
```

Coverage: the six source GLBs, 8 galaxies × 256 systems at seed `0x5ee11e`, every station's roster
and every hauler plan. Not covered: other world seeds (the script takes `--seed`; the pinned test is
one seed), prepared game assets (none exist for the six), the browser tier (no rendered or runtime
behaviour changed; no probe was run, and none is claimed). Both scripts throw on a non-finite vertex,
size, count or a roster that differs between scenarios.
