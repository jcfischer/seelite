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
multi-station and named three station types, deciding only that they exist,
what generates them and where they sit. This spec decides what a type *is*.

The standard it has to meet is #6's own sentence: *multiple stations only pay
for themselves if they are not interchangeable — two identical trade stations
200,000 km apart is just a longer commute for the same transaction.*

The cost of getting that wrong is measurable rather than aesthetic. #10
tabulates cruise legs at **38 s for 0.2 AU, 68 s for a typical 1.3 AU, and
3.1 min for 6 AU** (`docs/specs/in-system-travel.md` §2.3, *Resulting pacing*), against a finite 12 AU
drive charge regenerating at ~1 AU/min. **A round trip to the wrong station
costs a typical 2.3 minutes and about a fifth of the charge**, and up to 6
minutes on an outer-planet leg. Every decision below was weighed against those
figures.

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
| **target** | any endpoint a cruise leg can be aimed at. `cruise.ts`'s speed law reads the nearest star or planet; the selected target may also be a station, moon or belt. |
| **system** | 1–3 stations plus its bodies. "**multi-station**", never "multi-destination". |

Two words are **retired**, for the same reason: a synonym with no distinct job
is how prose and types drift apart.

- **"Outpost"** — the galaxy-generation spec's "Refinery outpost" is now
  "refinery". The word carried no distinction `refinery` does not carry already.
- **"Destination"** — it had acquired two meanings at once. `in-system-travel.md`
  and `src/cruise.ts` used it for a cruise endpoint; #6 used "multi-destination"
  to mean "more than one station". Neither survives: a cruise endpoint is a
  **target**, a dockable object is a **station**, and a system with several is
  **multi-station**. This PR renames every site — `in-system-travel.md`,
  `galaxy-generation.md`, and the comments and test names in `cruise.ts`,
  `main.ts`, `system.ts`, `backdrop.ts`, `tests/` and `scripts/`. `grep -rn
  destination src scripts tests docs` is the audit, and it should return only
  the WebAudio line below. (`AudioContext`'s
  `ctx.destination` in `src/audio.ts` is the WebAudio API and is untouched.)

The station vocabulary matches `StationType = "trade" | "refinery" | "shipyard"`
(`src/system.ts`) exactly, which is the point: **the prose was renamed to the
code, not the code to the prose**.

---

## 2. The three types

Presence and location are **not restated here** — they are
`galaxy-generation.md` §6.4's, and a second copy is a second thing to keep true.
Every other row names the section that owns it, for the same reason.

| | **trade station** | **refinery** | **shipyard** |
|---|---|---|---|
| Presence, location | *galaxy-generation.md §6.4* | *ibid.* | *ibid.* |
| Price offset → §3 | 0 | **+3** | **−2** |
| Equipment → §4 | system's `min(displayTL + 3, 12)` | same | same |
| Exclusives → §4, §5.2 | — | mining gear; contraband if `blackMarket` | hulls, military |
| Law → §5.1 | `government` | `max(government − 3, 0)` | `min(government + 3, 7)` + scan |
| Docking → §6 | rotating slot | pad | rotating slot |
| Silhouette → §7 | Coriolis octahedron | drum in an asteroid | Coriolis + drydock frame |

---

## 3. Commodity markets: type as a price offset

**Every station trades the full commodity table.** Type does not scope *what*
is traded; it shifts *at what price*.

```
priceOffsetCr(good) = typeOffset · good.gradient · PRICE_STEP_CR

typeOffset  = { trade: 0, refinery: +3, shipyard: -2 }
PRICE_STEP_CR = 0.4          // Elite's byte→credits step

station price = system price + priceOffsetCr(good)
```

### 3.1 Which direction, and why — the correction that matters

Economy runs **0 = Rich Industrial → 7 = Poor Agricultural**, the Elite
convention already in `src/galaxy.ts` (`tech = … + (economy ^ 7) + …`), and
Elite's price already contains `product = economy × gradient`. The gradients are
Bell's, recorded in `docs/research/elite-1984-mechanics.md` §2.2–2.3:

| Group | Goods | Gradient | Cheap at |
|---|---|---|---|
| Extractive | Minerals −1, Gold −1, Platinum −2, Gem-Stones −1, Radioactives −3, Alloys +1 | mostly **negative** | high economy (Poor Agricultural) |
| Staple | Food −2, Textiles −1, Liquor −5, Furs −9, Slaves −5 | negative | high economy (Poor Agricultural) |
| Manufactured | Computers +14, Machinery +6, Luxuries +8, Firearms +13, Narcotics +29 | positive | low economy (Rich Industrial) |

**The refinery offsets +3, toward Poor Agricultural.** The first draft of this
spec said −3 "which is what makes its minerals cheap"; that was backwards, and
sage's review caught it. Minerals, Gold, Platinum, Gems and Radioactives are
negative-gradient, so a shift toward Rich Industrial makes the refinery's own
product *dearer*. +3 makes extractives cheap — which is the point — and
manufactured goods dear, which is right for a remote refinery with nothing but a
smelter.

**The shipyard offsets −2, toward Rich Industrial**: manufactured goods cheap,
staples dear. Correct as first written.

### 3.2 Why it is a price delta and not an economy shift

The obvious implementation — `stationEconomy = clamp(system.economy + offset,
0, 7)`, feed that to the price formula — is wrong, and wrong in the way that is
hardest to see. **The clamp eats the offset exactly where each type lives.**

Shipyards require `displayTL ≥ 10`, and `tech = … + (economy ^ 7) + …` means a
high tech level *requires* a low economy number; shipyard systems therefore sit
at economy 0–3, where `−2` clamps to 0 and the shipyard prices identically to
the trade station beside it. Symmetrically, a refinery in a Poor Agricultural
system (economy 7) clamps at 7 and prices identically too. The price axis would
stop differentiating precisely in the systems where each type is most at home —
the same "reads as a rule while behaving as a constant" failure §4 rejects for
equipment.

Applying the offset as a **price delta after the formula** is arithmetically the
same shift, and cannot clamp, because it acts on a price rather than on a 0–7
index. Worked:

| Station | Good | Gradient | Delta | Effect |
|---|---|---|---|---|
| shipyard | Computers | +14 | `−2 × 14 × 0.4` = **−11.2 Cr** | always cheaper, in every system |
| shipyard | Food | −2 | `−2 × −2 × 0.4` = **+1.6 Cr** | always dearer |
| refinery | Radioactives | −3 | `+3 × −3 × 0.4` = **−3.6 Cr** | always cheaper |
| refinery | Narcotics | +29 | `+3 × 29 × 0.4` = **+34.8 Cr** | always dearer |
| trade | anything | any | 0 | the system's own price |

No new mechanism and no new table: one scalar per type, multiplied by a gradient
the commodity table already carries. There is no `stationEconomy` field — a
station has an offset, not an economy.

**What #7 must decide:** the deltas can push a price below zero or past the
byte range at the extremes (Narcotics' +29 gradient is the outlier). Elite's
formula wraps at 8 bits by design and its overflow is part of the Narcotics
gamble; whether the delta wraps with it or is floored is #7's to settle, and §9
requires whichever it picks to be tested.

### 3.3 Why the table is not scoped

Scoping — a refinery that buys ore and refuses furs — differentiates harder,
and it was rejected on the number in the preamble: it converts "I did not read
the market screen" into a multi-minute round trip and a spent drive charge.
Under an offset the player is never stranded holding cargo, and the routing
decision survives as *where do I get the best price*, which is the decision
Elite actually ran on.

**The cost, stated plainly.** This is still the weakest form of
non-interchangeability of the options considered: on commodities alone, three
stations are the same transaction at three prices. Sections 4 and 5 carry
differentiation they would not have had to carry under a scoped market. **A
later reader tempted to weaken §5 should read §3 first** — the two were decided
together.

**The wart, named rather than hidden.** Staples share the extractive group's
negative gradient, so the +3 that makes ore cheap makes Food, Furs and Liquor
cheap at a belt refinery too — fictionally odd. One scalar and a signed slope
per good is exactly Elite's mechanism, and it cannot express "cheap ore, dear
bread". The alternative was a per-commodity-group multiplier table, declined
because it adds a second pricing mechanism to #7 for one item of flavour.
Recorded as weak joint 5.

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
consistent with §3's offset shape, and the arithmetic kills it. The equipment
list is **12 items** (`docs/research/elite-1984-mechanics.md` §3.1, the PRXS
table: fuel, missiles, large cargo bay, extra pulse laser, ECM, extra beam
laser, fuel scoops, escape pod, energy bomb, extra energy unit, docking
computer, galactic hyperdrive), so `min(displayTL + 3, 12)` **saturates at
`displayTL = 9`** — and shipyards do not exist below `displayTL = 10`. A `+3`
at a shipyard therefore has *zero* range in every system where a shipyard can
occur: a mechanism that reads as a rule while behaving as a constant.

The symmetric case — a *negative* shift at refineries, the counterpart of §3's
`shipyard −2` — does have range, and is rejected on a different ground. It would
mean a refinery in a `displayTL = 4` system shows 4 items instead of 7, i.e. the
place you go for a mining laser is where mining lasers stop being sold. The
exclusive in the table above is the whole point of the type, and a negative TL
shift is the one modifier that can take it away.

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
- **Refinery** — thin law. Police presence `max(government − 3, 0)`,
  elevated pirate presence, and — conditionally, see §5.2 — the only place
  illegal goods can be bought or sold.
- **Shipyard** — naval. Police presence `min(government + 3, 7)` and a
  **contraband scan on approach**; a poor legal status makes arrival hostile
  rather than merely expensive.

### 5.2 The black market is a seeded per-station flag

Not every refinery is a den, and that is deliberate:

```
blackMarket: boolean = rand() < P(government)

P(g) = 0.95 - 0.125·g          // 0.95 at Anarchy, 0.075 at Corporate State
```

drawn per refinery from its own stream (§5.3). Government runs 0 = Anarchy →
7 = Corporate State, and `rand(0–7) < government ⇒ no spawn` is the existing
safety polarity, so higher means more law:

| government | 0 Anarchy | 1 | 2 | 3 | 4 | 5 | 6 | 7 Corporate |
|---|---|---|---|---|---|---|---|---|
| P(fence) | 0.950 | 0.825 | 0.700 | 0.575 | 0.450 | 0.325 | 0.200 | 0.075 |

A linear ramp rather than a curve, because it is the shape a corpus test can
bound at both ends and check for monotonicity without arguing about a fitted
constant. It needs no `clamp`: the expression stays inside (0, 1) across the
whole domain, and a guard that cannot fire is the same dead weight §9.1 objects
to in assertions. Police presence is `clamp(government − 3, 0, 7)` at every refinery
regardless of the flag.

The consequence accepted with eyes open: **a fence is not inferable from the
galaxy map.** You find one by visiting, and then you remember it. That is the
texture being bought — specific places worth knowing — and it is also the
strongest argument for a rumour or bulletin system later, which is not
specified here and is not promised.

Geography follows for free, and it is scarcer than "about half". A refinery
needs a belt, and a belt needs **both** a roll under `BELT_PROBABILITY = 0.45`
**and** at least two planets to put a gap between (`src/system.ts`:
`if (wantsBelt && planets.length >= 2)`), so the refinery rate is strictly below
45%. The government weighting then removes a further share, and government is
radially biased (core mean 6, rim mean 1), so fences concentrate at the rim.

**This spec deliberately asserts no galaxy-wide figure**, because both inputs
are generator properties rather than constants — the first draft's "roughly
half" was wrong for exactly that reason. §9.1 requires the corpus test to
*measure and report* refinery incidence and fence incidence, so the number
exists as evidence rather than as an estimate in prose. What the design commits
to is the shape: **a minority of systems, rim-weighted**. Smuggling routes are
therefore a thing to be learnt, not a menu option.

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

1. **`DOMAIN.STATION_FLAGS = 8`** in `src/galaxy.ts` (§5.3).
2. **Both new per-station draws come from that tag, in this order:**
   `blackMarket` first, then `spinRpm`. Neither may be drawn from
   `DOMAIN.STATIONS` — that is the regression §5.3 exists for, and pinning the
   order here is what makes the fixture in §9.1 reproducible rather than
   accidental.
3. `Station` gains **`blackMarket: boolean`** — §5.2.
4. `Station` gains **`spinRpm: number`** — 0 for the pad type, drawn for the two
   Coriolis types from a range #9 fixes.
5. **Both new fields derive from a `Record<StationType, …>` table**, not from an
   `if (type === "refinery")` with a default. `STATION_COLORS` (`src/sim.ts`) is
   already written this way and says why: a `Record<StationType, …>` has no
   unmatched case, so a fourth station type stops the build until the table
   answers for it, where a defaulted field would silently inherit `false` and
   `0`. The same argument applies here and the same shape should be used —
   otherwise §7's build-breaking guarantee covers colour and nothing else.
6. The **price offset** (§3) and **police presence** (§5.1) are derived
   accessors, not stored fields, so they cannot drift from the commodity table's
   gradients and from `system.government`.

---

## 9. Verification obligations

Two tiers, per the repo's culture.

### 9.1 Headless (`bun`)

- **The price offset is never swallowed.** For every commodity with a non-zero
  gradient, the refinery and shipyard prices differ from the trade station's in
  every system in the corpus — including economy 0 and economy 7, which is where
  the rejected `clamp(…, 0, 7)` implementation would have collapsed them (§3.2).
  This is the test that would have caught the first draft.
- **The extremes behave as #7 decides.** Whatever #7 settles for a delta that
  pushes a price below zero or past the byte range (§3.2), the corpus must
  exercise it — Narcotics at a refinery (`+3 × 29 × 0.4` = +34.8 Cr) is the
  worst case and belongs in the test by name.
- **`blackMarket` and `spinRpm` move no station.** Guarded by
  `tests/station-orbits.test.ts` against `tests/fixtures/station-orbits.json` —
  791 stations across two full galaxies, captured by
  `scripts/capture-station-orbits.ts` on the generator as it stood *before*
  those fields existed. The fixture is committed in this PR precisely because
  the before-state stops being obtainable once `STATION_FLAGS` lands. Verified
  to fail on an inserted `DOMAIN.STATIONS` draw and pass on its removal.
- **The two golden files are not interchangeable.** `galaxy.test.ts`'s
  determinism digest pins the *record* and will legitimately move when the new
  fields land; the orbit fixture pins *placement* and must not move with them.
  Repinning both in one commit destroys the evidence.
- **`blackMarket` frequency tracks government.** Over a corpus of ≥ 20,000
  refineries: observed rate at `government = 0` within [0.92, 0.98], at
  `government = 7` within [0.05, 0.11], and non-increasing across `g` allowing
  for sampling noise. Bounds from §5.2's table.
- **Incidence is measured, not estimated.** The same corpus reports refinery
  incidence and fence incidence per galaxy, and asserts only the shape §5.2
  commits to — a minority of systems, higher at the rim than the core. The
  figures go in the test's output so the number is evidence rather than prose.
- Every shipyard-bearing system has `displayTL ≥ 10`; every refinery-bearing
  system has a belt.

### 9.2 Browser probe

- The three silhouettes are distinguishable: render one of each at a fixed
  distance and assert their projected outlines differ by more than a
  colour-only threshold. Running the same frames desaturated is the honest
  version of "tell them apart", since §7 claims outline and not colour.
- Reading constants off `window.__seelite`, never restating them.

---

## 10. What this obliges of other nodes

- **#7 (economy)** — prices generate per station: the system's price plus §3's
  `typeOffset × gradient × 0.4 Cr` delta. #7 also settles what that delta does at
  the byte extremes (§3.2). The commodity table **must** carry illegal goods
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
   real role and a quiet one. If multi-station systems ever feel thin in
   play, this is the first place to look, and a trade-station exclusive
   (missions, bulletin board — currently map fog) is the natural repair.
3. **The black market is not discoverable from the map (§5.2).** Bought
   deliberately for texture; the mitigation is a rumour system that does not
   exist and is not promised here.
4. **Refinery presence keys on the belt, which is random, not on radius.** So a
   rich core system can hold a fence. §5.2's government weighting makes that
   rare rather than impossible, which is the intended answer: rare and
   memorable, not forbidden.
5. **A belt refinery sells cheap bread (§3.1).** Staples share the extractive
   group's negative gradient, so the +3 offset that makes ore cheap makes Food,
   Furs and Liquor cheap too. Elite's mechanism — one economy scalar, one signed
   slope per good — cannot express "cheap ore, dear bread", and buying the
   distinction costs a second pricing mechanism in #7. Taken as flavour debt. If
   it ever grates, the repair is a per-commodity-group multiplier on top of the
   offset, which §3.1 records as the option that was declined.
