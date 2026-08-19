# Spec: station types

**Status:** resolved decision node — [#13](https://github.com/jcfischer/seelite/issues/13)
**Date:** 2026-08-19
**Inputs:** [#6](https://github.com/jcfischer/seelite/issues/6) (galaxy & system generation),
[#4](https://github.com/jcfischer/seelite/issues/4) (Elite-1984 mechanics),
[#10](https://github.com/jcfischer/seelite/issues/10) (in-system travel)
**Binds:** [#7](https://github.com/jcfischer/seelite/issues/7) (economy),
[#8](https://github.com/jcfischer/seelite/issues/8) (combat),
[#9](https://github.com/jcfischer/seelite/issues/9) (docking)

[#6](https://github.com/jcfischer/seelite/issues/6) made systems
multi-destination and named three station types, deciding only that they exist,
what generates them and where they sit. This spec decides what a type *is*.

The standard it has to meet is #6's own sentence: *multiple stations only pay
for themselves if they are not interchangeable — two identical trade stations
200,000 km apart is just a longer commute for the same transaction.*

The cost of getting that wrong is measurable rather than aesthetic. Legs run
0.2–3 AU, about 68 s of cruise each way (#10), against a finite 12 AU drive
charge regenerating at ~1 AU/min. **A trip to the wrong station costs roughly
two minutes and a fifth of the charge.** Every decision below was weighed with
that number in hand.

---

## 0. What this owns, and what it does not

**Owns:** the vocabulary; what each type does to commodity prices, to the
equipment list, and to the arrival profile; each type's geometry and how many
docking interactions exist; how a player tells the three apart; and the
generator fields the above requires.

**Does not own:** the price formula itself or the commodity table (#7), docking
tolerances, clearance protocol and the docking computer (#9), NPC spawning and
the legal-status system (#8), or the HUD and scanner (unowned fog).

---

## 1. Terminology

Fixed here, and these words mean exactly one thing from now on across #6, #7,
#8, #9, #10, the specs and the code.

| Word | Means |
|---|---|
| **station** | any dockable object. The umbrella. Three types today. |
| **trade station** | the `trade` type. Never "main station", never "the station". |
| **refinery** | the `refinery` type. |
| **shipyard** | the `shipyard` type. |
| **destination** | a station, i.e. a dockable object. "1–3 destinations" and "1–3 stations" are the same claim. |
| **target** | any endpoint a cruise leg can be aimed at — station, planet, moon, star or belt. |

**"Outpost" is retired.** The galaxy-generation spec's "Refinery outpost" is
now "refinery". The word carried no distinction that `refinery` does not carry
already, and a synonym with no job is how prose and types drift apart.

This vocabulary matches `StationType = "trade" | "refinery" | "shipyard"`
(`src/system.ts`) exactly, which is the point: **the prose was renamed to the
code, not the code to the prose**, so this costs no churn and closes the gap
permanently.

---

## 2. The three types

| | **trade station** | **refinery** | **shipyard** |
|---|---|---|---|
| Present when | always | system has a belt (P = 0.45) | `displayTL ≥ 10` |
| Sits at | orbit of the primary planet | inside the belt, star-centric | orbit of the primary or a gas giant |
| Commodities | full table, system economy | full table, economy −3 | full table, economy −2 |
| Equipment | `min(displayTL + 3, ALL)` | same | same |
| Exclusives | — | mining laser, fuel scoop; contraband if `blackMarket` | hulls, military laser, energy unit |
| Police | `government` | `clamp(government − 3, 0, 7)` | `min(government + 3, 7)`, plus a contraband scan |
| Docking | rotating Coriolis, slot | non-rotating pad, velocity match | rotating Coriolis, slot |
| Silhouette | Coriolis octahedron | drum sunk in an asteroid, flare stacks | Coriolis core + non-rotating drydock frame |

---

## 3. Commodity markets: type as an economy offset

**Every station trades the full commodity table.** Type does not scope *what*
is traded; it shifts *at what price*, by offsetting the economy value that
#7's price generator reads.

```
stationEconomy = clamp(system.economy + typeOffset, 0, 7)

typeOffset = { trade: 0, refinery: -3, shipyard: -2 }
```

Economy runs 0 = Rich Industrial → 7 = Poor Agricultural, the Elite convention
already in `src/galaxy.ts` (`tech = … + (economy ^ 7) + …`). A negative offset
is therefore a shift *toward* industrial: a refinery reads three steps richer
and more industrial than the system it sits in, which is what makes its
minerals, metals and radioactives cheap and its food dear. The shipyard shifts
two.

**Why not scope the table.** Scoping — a refinery that buys ore and refuses
furs — differentiates harder, and it was rejected because of the number in the
preamble: it converts "I did not read the market screen" into a two-minute
penalty and a spent drive charge. Under an offset the player is never stranded
holding cargo, and the routing decision survives as *where do I get the best
price*, which is the decision Elite actually ran on.

**The cost, stated plainly.** This is the weakest form of non-interchangeability
of the options considered. On commodities alone, three stations are the same
transaction at three prices. Sections 4 and 5 are where the types are actually
made distinct, and they carry a load they would not have carried under a scoped
market. **A later reader tempted to weaken §5 should read §3 first** — the two
were decided together and §5 is not decoration.

**What #7 inherits:** prices are generated per station from `stationEconomy`
and the station's own id, not from `system.economy`. Everything else about the
price formula — base prices, gradients, the fluctuation byte, quantity masks —
remains #7's.

---

## 4. Equipment and hulls

**The tech-level gate stays a property of the system, as in 1984.** Every
station in a system shows the same list: roughly `min(displayTL + 3, ALL)`
items, matching the cassette `EQSHP` behaviour recorded in
`docs/research/elite-1984-mechanics.md` §3.1.

Type adds an exclusive class on top, and adds nothing else:

| Type | Exclusive |
|---|---|
| trade station | — |
| refinery | mining laser, fuel scoop |
| shipyard | **hulls** (the only place ships are sold), military laser, energy unit |

Rejected: making type shift the effective tech level. It would have been
consistent with §3's offset shape, and it was rejected because the shipyard's
`displayTL ≥ 10` floor plus a `+3` puts every shipyard at the full list —
the modifier would have had no range to act in, so it would have been a
mechanism that reads as a rule while behaving as a constant.

**Where the tech gradient's teeth actually are**, therefore: not in item counts
per station, but in *where shipyards exist at all*. They generate only at
`displayTL ≥ 10`, and tech tracks radius, so hulls and military hardware are a
core-ward good and the frontier is where you cannot buy what the frontier
requires. That is #6's risk/reward geography, unchanged.

---

## 5. Law, contraband, and the arrival profile

This is where the three types stop being interchangeable.

### 5.1 Per type

- **Trade station** — busy. Civilian traffic, and police presence scaling with
  the system's `government`. Its identity is that it is *the safe one with the
  traffic*: it has no exclusive, and it is the station that expresses the
  system's own economy unmodified, which is what makes inter-system arbitrage
  legible.
- **Refinery** — thin law. Police presence `clamp(government − 3, 0, 7)`,
  elevated pirate presence, and — conditionally, see §5.2 — the only place
  illegal goods can be bought or sold.
- **Shipyard** — naval. Police presence `min(government + 3, 7)` and a
  **contraband scan on approach**; a poor legal status makes arrival hostile
  rather than merely expensive.

### 5.2 The black market is a seeded per-station flag

Not every refinery is a den, and that is deliberate:

```
blackMarket: boolean = rand() < P(government)
```

drawn per refinery, weighted so it is near-certain at Anarchy and rare at a
Corporate State. Police presence is `clamp(government − 3, 0, 7)` at every
refinery regardless of the flag.

The consequence accepted with eyes open: **a fence is not inferable from the
galaxy map.** You find one by visiting, and then you remember it. That is the
texture being bought — specific places worth knowing — and it is also the
strongest argument for a rumour or bulletin system later, which is not
specified here and is not promised.

Geography follows for free: refineries need a belt (P = 0.45), so **roughly
half of all systems have no black market at any price**. Smuggling routes are
therefore a thing to be learnt rather than a menu option.

### 5.3 Determinism: the flag needs its own domain tag

The station generator draws trade → refinery → shipyard from a single
`DOMAIN.STATIONS` stream (`src/system.ts`). Adding the `blackMarket` draw
inside that sequence would shift every shipyard draw after it and re-place
existing shipyards.

**Add `STATION_FLAGS: 8` to `DOMAIN` in `src/galaxy.ts` and draw the flag from
it.** This is the same operation, for the same reason, as the `ARRIVAL: 7` tag
already documented there — extending the table is safe, renumbering it is not,
and reusing an existing tag is the unsafe move `CLAUDE.md` names explicitly.

---

## 6. Geometry and docking: two interactions, not three

| Interaction | Types | What it is |
|---|---|---|
| **Rotating slot** | trade station, shipyard | the classic Coriolis: line up on the slot and match the station's roll |
| **Pad approach** | refinery | a non-rotating pad: approach and match the pad's velocity, no roll to match |

Three interactions were rejected on the node's own grounds — three docking
minigames is one more than anybody asked for. One was rejected because a belt
refinery that docks like a trade hub is the fiction giving up. Two is defensible
because the second is *genuinely easier* rather than merely different: dropping
the roll match removes the hardest axis, so it costs #9 a fraction again rather
than double.

**Precision that #9 must not lose: the refinery pad is non-rotating, not
stationary.** It sits star-centric inside the belt and is carried at orbital
speed. "Match velocity" means match the pad's frame, not the star's — the exact
relative-frame problem `src/main.ts` already had to solve for cruise exit, where
holding still relative to the star meant being left behind at 30 km/s.

**Station spin** (#6 deferred it here, this spec hands it on): a generated
per-station parameter, zero for refineries, non-zero for the two Coriolis types.
Its range is #9's to tune, because the range *is* the difficulty dial.

**Layering.** Docking geometry is a drawn object, so it inherits the map's
distance rule: near layer within `HANDOFF_KM` of the camera, far beyond it, with
the hysteresis band. It does not get a fixed layer because it is "close by" —
a shipyard an AU away is not close by.

---

## 7. Visual identity: silhouette first

A player tells the three apart by **outline**, before colour and before any
detail resolves — and, deliberately, without any dependence on a HUD or scanner
design, which remains unowned fog.

| Type | Silhouette |
|---|---|
| trade station | Coriolis octahedron — the classic |
| shipyard | the same rotating Coriolis core with a large **non-rotating drydock frame** clamped alongside; docks identically per §6, reads as a different object entirely |
| refinery | a squat drum sunk into a captured asteroid, with flare stacks |

`STATION_COLORS` (`src/sim.ts`) stays as the secondary cue and is unchanged.
Emissive detail — window grids and navigation strobes on the trade station,
cold floodlit bays on the shipyard, a warm flare on the refinery — is welcome
and is not what the identity rests on, because it resolves at medium range and
vanishes at scanner range.

All procedural, per the map constraint: three parameterised meshes generated at
load, no downloaded assets.

---

## 8. Generator changes this requires

1. `DOMAIN.STATION_FLAGS = 8` in `src/galaxy.ts` (§5.3).
2. `Station` gains `blackMarket: boolean` — meaningful only where
   `type === "refinery"`; `false` elsewhere.
3. `Station` gains `spinRpm: number` — `0` for refineries, drawn for the two
   Coriolis types from a range #9 fixes.
4. A derived accessor, not a stored field, for `stationEconomy` (§3) and for
   police presence (§5.1), so they cannot drift from `system.economy` and
   `system.government`.
5. `STATION_COLORS` unchanged; it remains `Record<StationType, …>` so a fourth
   type still breaks the build rather than defaulting to grey.

---

## 9. Verification obligations

Two tiers, per the repo's culture.

**Headless (`bun`):**

- `stationEconomy` clamps at both ends: a Poor Agricultural system's refinery
  does not wrap past 0, a Rich Industrial system's does not go negative.
- The `blackMarket` draw moves no station position — generate a corpus of
  systems before and after the `STATION_FLAGS` tag is introduced and assert
  every station's orbit is byte-identical. This is the test §5.3 exists for and
  it is the one that would have caught the mistake.
- `blackMarket` frequency across a large corpus tracks `government` in the
  intended direction, with bounds rather than an exact figure.
- Determinism digest over a fixed seed corpus, extended to the new fields.
- Every shipyard-bearing system has `displayTL ≥ 10`; every refinery-bearing
  system has a belt.

**Browser probe:**

- The three silhouettes are distinguishable: render one of each at a fixed
  distance and assert their projected outlines differ by more than a
  colour-only threshold. A colour-blind check of the same frames is the honest
  version of "tell them apart".
- Reading constants off `window.__seelite`, never restating them.

---

## 10. What this obliges of other nodes

- **#7 (economy)** — prices generate from `stationEconomy` per station, not
  `system.economy` per system. The commodity table **must** carry illegal goods
  (Elite's Narcotics, Firearms, Slaves) and a per-commodity legality flag,
  because §5.2 makes the black market load-bearing rather than flavour.
  Equipment prices are TL-gated per §4; hulls price only at shipyards.
- **#8 (combat)** — owns the **legal status / bounty system**, which §5 now
  requires and which no node currently specifies. It also owns elevated pirate
  presence near refineries and the shipyard's hostile response to a bad legal
  status. The map's Constraints already presume legal status exists
  ("legal-status decay" reads the game clock); this spec is what makes it
  mandatory.
- **#9 (docking)** — builds **two** interactions, not three (§6); receives
  station spin as a generated parameter and owns its range; must treat the
  refinery pad's orbital velocity as the docking frame.
- **#11 / the unowned HUD node** — inherits nothing from this spec. §7 was
  chosen specifically so it does not pre-commit a scanner design.

---

## 11. Weak joints, recorded not reopened

1. **Commodity differentiation is soft (§3).** Three stations are the same
   transaction at three prices. Accepted in exchange for never stranding a
   player's cargo two minutes and a drive charge from the station that would
   buy it. §4 and §5 carry the differentiation instead, which makes them
   load-bearing in a way they would not otherwise be.
2. **The trade station has no exclusive.** Its identity is "always present,
   safe, busy, and the unmodified voice of the system's economy". That is a
   real role and a quiet one. If multi-destination systems ever feel thin in
   play, this is the first place to look, and a trade-station exclusive
   (missions, bulletin board — currently map fog) is the natural repair.
3. **The black market is not discoverable from the map (§5.2).** Bought
   deliberately for texture; the mitigation is a rumour system that does not
   exist and is not promised here.
4. **Refinery presence keys on the belt, which is random, not on radius.** So a
   rich core system can hold a fence. §5.2's government weighting makes that
   rare rather than impossible, which is the intended answer: rare and
   memorable, not forbidden.
