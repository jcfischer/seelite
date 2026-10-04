# Spec: station types

**Status:** resolved decision node — [#13](https://github.com/jcfischer/seelite/issues/13)
**Date:** 2026-08-19
**Amended:** 2026-08-19 by [#28](https://github.com/jcfischer/seelite/issues/28),
which built §7 and §8 — one verification obligation in §9.1 was sized on the
wrong quantity. The amendment is inline, in that section.
**Amended:** 2026-10-04 by [#491](https://github.com/jcfischer/seelite/issues/491),
which placed [#490](https://github.com/jcfischer/seelite/issues/490)'s raider
outpost: §1's retirement of "outpost" is withdrawn, §2 gains a fourth column,
and §5.5 says what the outpost carries and what it does not yet.
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
| **station** | any dockable object. The umbrella. Four types since #491. |
| **trade station** | the `trade` type. Never "main station", never "the station". |
| **refinery** | the `refinery` type. |
| **shipyard** | the `shipyard` type. |
| **raider outpost** | the `outpost` type: #490's raider haven, the fourth type (§5.5). "Outpost" alone means this and nothing else. |
| **target** | any endpoint a cruise leg can be aimed at. `cruise.ts`'s speed law reads the nearest star or planet; the selected target may also be a station, moon or belt. |
| **fence** | a refinery whose `blackMarket` flag is true (§5.2). Not a separate object — the word is shorter than "a refinery with a black market" and is used only in that sense. |
| **the target's frame** | the selected target's *velocity* frame, in which cruise exit and docking are judged (§6, `cruise.ts`). Declared here rather than left inferred, since it is the one place "target" means a reference frame and not a place. |
| **system** | 1–4 stations plus its bodies — every system has a trade station on its primary planet since #51 (§5.4). "**multi-station**", never "multi-destination". |

These words hold across the specs and the code. **They do not rewrite the
tracker**: #6's node text says "multi-destination" and will keep saying it,
because a closed node is a record of what was decided, not a document to
maintain. Where the two disagree, this spec is later and wins.

Two words were **retired**, for the same reason: a synonym with no distinct job
is how prose and types drift apart. **One retirement stands and one is
withdrawn.**

- **"Outpost" — withdrawn by #490 D2, placed by #491.** The galaxy-generation
  spec's "Refinery outpost" is still "refinery", and "outpost" is no longer a
  synonym for anything: it is the fourth type, the raider outpost, with its own
  law, its own (unbuilt) market scope and its own reason to exist. #56 had
  already reintroduced it in `src/station.ts` as a form and a geometry, and the
  code and this section disagreed from then until #490 ruled for the code. The
  word now appears across `src`, `tests` and `docs` on purpose, so the audit
  below no longer searches for it.
- **"Destination"** — it had acquired two meanings at once. `in-system-travel.md`
  and `src/cruise.ts` used it for a cruise endpoint; #6 used "multi-destination"
  to mean "more than one station". Neither survives: a cruise endpoint is a
  **target**, a dockable object is a **station**, and a system with several is
  **multi-station**. This PR renames every site — `in-system-travel.md`,
  `galaxy-generation.md`, and the comments and test names in `cruise.ts`,
  `main.ts`, `system.ts`, `backdrop.ts`, `tests/` and `scripts/`. The audit is

  ```
  grep -rniE 'destination' src scripts tests docs --exclude='station-types.md'
  ```

  It was written for both retired words and said it should return exactly one
  line, `ctx.destination` in `src/audio.ts`, the WebAudio API. **It no longer
  does, and #491 did not make it a gate:** "destination" has come back as an
  ordinary word in job and route code (`destinationStationId`, a courier's
  destination); run the pattern for today's count rather than trusting one
  written here. Whether each is
  the retired sense is a sweep of its own, not #491's. The pattern stays as the
  audit's definition, case-insensitive because the sweep had capitalised
  occurrences ("Destination-only law"). This file is excluded by name
  because a retirement note necessarily contains the word it retires; `grep`'s
  `--exclude` matches the basename, which is why the pattern is written that
  way. (`AudioContext`'s
  `ctx.destination` in `src/audio.ts` is the WebAudio API and is untouched.)

The station vocabulary matches `StationType = "trade" | "refinery" | "shipyard"
| "outpost"` (`src/station.ts`) exactly, which is the point: **the prose was
renamed to the code, not the code to the prose** — and #490 D2 held the same
line the other way, amending this section rather than renaming the type.

---

## 2. The four types

Presence and location are **not restated here** — they are
`galaxy-generation.md` §6.4's, and a second copy is a second thing to keep true.
Every other row names the section that owns it, for the same reason.

| | **trade station** | **refinery** | **shipyard** | **raider outpost** (§5.5) |
|---|---|---|---|---|
| Presence, location | *galaxy-generation.md §6.4* | *ibid.* | *ibid.* | *ibid.* — government 0–1, a Trojan point |
| Price offset → §3 | 0 | **+3** | **−2** | **none yet** — no market (#490 D6 unbuilt) |
| Equipment → §4 | system's `min(displayTL + 3, 10)` | same | same | **none yet** |
| Exclusives → §4.1, §5.2 | — | fuel scoops, mining laser; contraband if `blackMarket` | hulls, military laser, energy unit | **none yet**; not a fence until it trades |
| Law → §5.1, §5.5 | hostile odds ×1.0 | ×2.0 | ×0.5 + scan | Wanted-only berth (D5); witnesses nothing (D10) |
| Docking → §6 | rotating slot | pad | rotating slot | pad — **closed to every pilot** until it has a market |
| Silhouette → §7 | three forms, Coriolis selected | three forms on a rock, Warren selected | three forms, Gantry selected | five forms, Salvage (E) selected |

<!-- glossary-ignore: slot -->
<!-- glossary-ignore: pad -->
<!-- The Docking row names aperture kinds (`aperture.kind`), not berths. -->

---

## 3. Commodity markets: type as a price offset

**Every station trades the full *legal* commodity table.** Type does not scope
what is traded; it shifts at what price. **Illegal goods are the one exception,
and it is a deliberate one — see §3.4.**

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
high tech level *requires* a low economy number, so shipyards crowd the bottom
of the economy scale. **Measured over 40 worlds — 81,920 systems, 14,035
shipyards, 31,169 refineries — by `scripts/measure-clamp-bite.ts`, committed so
the number can be re-derived rather than trusted:**

| | offset **clamped at all** | of which, offset **erased** |
|---|---|---|
| shipyards (`clamp(economy − 2, 0, 7)`) | 79.0% | **46.5%** |
| refineries (`clamp(economy + 3, 0, 7)`) | 41.1% | **16.3%** |

The second column is a subset of the first, not a separate population — and the
distinction matters. At economy
1 a shipyard's `−2` clamps to 0 — one step of shift instead of two, so it is
halved, not lost. It dies only at economy 0, where the station prices exactly
like the system beside it. Shipyard economies run 0: 6,523 · 1: 4,568 · 2: 1,979
· 3: 849 · 4: 98 · 5: 18.

So: **the offset is silently degraded for four shipyards in five and erased
outright for nearly half of them**, in the type whose entire placement rule puts
it there. That is enough to disqualify the mechanism — a price rule that is a
constant for 46.5% of the stations it governs is not a price rule — without
needing the stronger claim.

(The first draft asserted "shipyard systems sit at economy 0–3, where −2 clamps
to 0", which is false of economy 2 and 3 and ignores the shipyards at 4 and 5;
the second draft then reported the 79.0% "reduced" figure as though it were
collapse. Both are recorded rather than quietly replaced, because the measurement
is the thing carrying the decision and it took two tries to state honestly.)

Applying the offset as a **price delta after the formula** produces the same
shift wherever the price formula is linear, and cannot clamp, because it acts on
a price rather than on a 0–7 index. The two forms part company only at the byte
extremes, which is precisely what #7 has to settle below — so "the same shift"
is a claim about the ordinary range, not about the overflow. Worked:

| Station | Good | Gradient | Delta | Effect |
|---|---|---|---|---|
| shipyard | Computers | +14 | `−2 × 14 × 0.4` = **−11.2 Cr** | always cheaper, in every system |
| shipyard | Food | −2 | `−2 × −2 × 0.4` = **+1.6 Cr** | always dearer |
| refinery | Radioactives | −3 | `+3 × −3 × 0.4` = **−3.6 Cr** | always cheaper |
| refinery | Computers | +14 | `+3 × 14 × 0.4` = **+16.8 Cr** | always dearer |
| trade | anything | any | 0 | the system's own price |

No new mechanism and no new table: one scalar per type, multiplied by a gradient
the commodity table already carries. There is no `stationEconomy` field — a
station has an offset, not an economy.

**What #7 must decide:** the deltas can push a price below zero or past the
byte range at the extremes (Narcotics' +29 gradient is the outlier, and it is a
fence-only good — §3.4). Elite's
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

### 3.4 The one exception: illegal goods

§3.3 rejects scoping the commodity table because it strands a player's cargo a
multi-minute round trip from anywhere that would buy it. **Illegal goods are
scoped anyway**, and the two positions are consistent because the stranding is
the point in one case and an accident in the other.

- **Legal cargo.** Being unable to sell furs at a refinery punishes not reading
  a market screen. The player learns nothing, and pays two minutes and a fifth
  of the drive charge for it. Rejected.
- **Contraband.** Being unable to sell Narcotics anywhere but a fence *is* the
  mechanic. A smuggling run is precisely the bet that you can reach a buyer that
  most stations are not; §5.1.1's shipyard scan is what makes carrying it costly
  in the meantime, and §5.2's rim-weighted fence distribution is what makes the
  route worth learning. Remove the scoping and contraband becomes an ordinary
  commodity with a worse gradient.

So the rule is scoped by **legality**, not by station type as such:

| | legal goods | illegal goods (Narcotics, Firearms, Slaves) |
|---|---|---|
| trade station | full table | not traded |
| refinery, `blackMarket: false` | full table | not traded |
| refinery, `blackMarket: true` (a *fence*) | full table | **traded** |
| shipyard | full table | not traded, **and scanned for** |

**The counter-case, engaged rather than waved past.** Fences are a minority of
systems and rim-weighted (§5.2), so a player who buys contraband may carry it a
long way. That is the risk being sold, and it is **not** mitigated by cargo
density: Narcotics, Firearms and Slaves are all tonne goods, so contraband
occupies the hold exactly as ordinary cargo does. (The sub-tonne goods that skip
the hold check are Gold, Platinum and Gem-Stones — research §2.2 — and all three
are legal here.) The only real mitigation is that nothing forces the purchase.

What the exception must **not** become is a surprise: #7 owes a legality flag
per commodity and the market screen owes a visible marker, or it degenerates
into exactly the unread-screen tax §3.3 rejects. That obligation is doing the
work a density argument would have done, which is why it is stated as an
obligation rather than as a hope.

---

---

## 4. Equipment and hulls

**The tech-level gate stays a property of the system, as in 1984.** Every
station in a system shows the same list, and type adds an exclusive class on
top — but the two sets must be **disjoint**, or an item is both universal and
exclusive and #7 cannot price it.

### 4.1 The split

Elite's cassette list is 12 items (`docs/research/elite-1984-mechanics.md` §3.1,
the PRXS table). Two of them are pulled out as type exclusives, leaving **10
universal**:

| Universal — `min(displayTL + 3, 10)` | Type-exclusive |
|---|---|
| fuel, missiles, large cargo bay, extra pulse laser, ECM, extra beam laser, escape pod, energy bomb, docking computer, galactic hyperdrive | **refinery:** fuel scoops, mining laser¹ · **shipyard:** extra energy unit, military laser¹, identity scanner¹, long-range scanner¹, **hulls** |

¹ Not in Elite's 12 — new to seelite, and priced by #7 alongside the rest.

> **Two scanner modules are here as shipyard exclusives** — #364's identity
> scanner and #481's long-range scanner. Each takes an exclusive rather than an
> eleventh universal item, and this section does not argue for that a second
> time: the universal count is ten and §4.2's saturation argument rests on it,
> which is F12's own reason along with the two options it rejected. What
> follows is unchanged — the exclusive is *why* a module is worth travelling
> for. The two are one keystroke apart in every list that names them and they
> answer different questions: the identity scanner reads a hull the pilot is
> holding on target, the long-range scanner reads a **Pirate relay**'s signal
> at the range `pirate-relay.ts` declares — thousands of kilometres, not a
> system-wide sensor, and the range is that module's to state rather than
> this table's.

Fuel scoops go to the refinery because scooping is the mining trade's tool, and
the extra energy unit to the shipyard because it is the heaviest hull-work
upgrade on the list. Both scanners join the shipyard column on the same
kind of ground — sensor work is a shipyard's craft, not a miner's.
`carrier-identity.md` F12 records the identity scanner's ruling, its price and
its consequence; #479 and #468 record the long-range scanner's, and its
consequence is stated there rather than here: no module, no relay cue and no
identification, while the relay's dial on the watched route still bites. Every other item is available anywhere the system's tech
level reaches it.

### 4.2 Why type does not shift the tech level

It would have been consistent with §3's offset shape, and the arithmetic kills
it. With 10 universal items, `min(displayTL + 3, 10)` **saturates at
`displayTL = 7`** — and shipyards do not exist below `displayTL = 10`. A `+3`
at a shipyard therefore has *zero* range in every system where a shipyard can
occur: a mechanism that reads as a rule while behaving as a constant, and the
same failure §3.2 and §5.1 each had to be rewritten to avoid.

The symmetric case — a *negative* shift at refineries, the counterpart of §3's
refinery `+3` — does have range, and is rejected on a different ground. It would
mean a refinery in a `displayTL = 4` system shows 4 items instead of 7, i.e. the
place you go for a mining laser is where equipment stops being sold. The
exclusive is the whole point of the type, and a negative TL shift is the one
modifier that can hollow it out.

**Where the tech gradient's teeth actually are**, therefore: not in item counts
per station, but in *where shipyards exist at all*. They generate only at
`displayTL ≥ 10`, and tech tracks radius, so hulls and military hardware are a
core-ward good and the frontier is where you cannot buy what the frontier
requires. That is #6's risk/reward geography, unchanged.

---

## 5. Law, contraband, and the arrival profile

This is where the three types stop being interchangeable.

### 5.1 Per type: a factor on the odds, not on the probability

#6's spawn rule is `rand(0–7) < government ⇒ no spawn`, so a system's hostile
chance is `p = (8 − government) / 8`.

Two expressions were tried and both saturated, which is this spec's recurring
failure mode:

- **An offset on `government`** — `min(government + 3, 7)` is a flat 7 for every
  core system with `government ≥ 4`, exactly where shipyards generate, and
  `max(government − 3, 0)` a flat 0 across the whole `government ≤ 3` rim band.
  The same defect §3.2 rejects for prices.
- **A factor on `p`** — `2 × p` reaches 1.0 at `government = 4` and stays there
  all the way down, which is a *wider* flat band than the offset had. Caught in
  review, and worth recording rather than quietly replacing: it looked like the
  fix and was the same bug.

The form that does not saturate is a factor on the **odds**:

```
p        = (8 - government) / 8          // #6's rule, unchanged
odds     = p / (1 - p)
odds_st  = typeFactor · odds
p_st     = odds_st / (1 + odds_st)

typeFactor = { trade: 1.0, refinery: 2.0, shipyard: 0.5 }
```

| government | 7 | 6 | 4 | 2 | 1 | 0 |
|---|---|---|---|---|---|---|
| system `p` | 0.125 | 0.250 | 0.500 | 0.750 | 0.875 | 1.000 |
| trade station | 0.125 | 0.250 | 0.500 | 0.750 | 0.875 | 1.000 |
| refinery | 0.222 | 0.400 | 0.667 | 0.857 | 0.933 | 1.000 |
| shipyard | 0.067 | 0.143 | 0.333 | 0.600 | 0.778 | 1.000 |

**Every column moves except the last, and the last is a special case the
implementation must handle explicitly:** at `government = 0`, `p = 1`, so
`odds = p / (1 − p)` divides by zero. The formula is *undefined* there, not
equal to 1 — an implementation that evaluates it naively gets `NaN` for all
three types, including the trade station at factor 1.0.

```
p_st = p === 1 ? 1 : odds_st / (1 + odds_st)
```

The special case is also the right answer rather than a patch: #6's rule already
puts an Anarchy system at certainty — `rand(0–7) < 0` is never true, so it always
spawns hostiles whatever sits in orbit. That is the base rule's own endpoint, and
no per-station factor can or should reach past it. §9.1 requires the
`government = 0` row to be in the test, because it is the one input that returns
`NaN` if the guard is forgotten.

An odds ratio is also the honest object here: "twice as likely to be jumped" is
a statement about odds, not about probability, and doubling a probability is
only an approximation of it that breaks down exactly where it matters.

### 5.1.1 What each type is on arrival

- **Trade station** — busy. Civilian traffic and the system's own hostile chance,
  unmodified. Its identity is that it is *the safe one with the traffic*: it has
  no exclusive, and it is the station that expresses the system unmodified,
  which is what makes inter-system comparison legible.
- **Refinery** — thin law. Twice the hostile *odds*, and — conditionally, see
  §5.2 — the only place illegal goods can be bought or sold.
- **Shipyard** — naval. Half the hostile odds, plus a **contraband scan on
  approach**; a poor legal status makes arrival hostile rather than merely
  expensive.

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
to in assertions. §5.1's hostile-odds factor of 2.0 applies at every refinery
regardless of the flag: a fence is not what makes a refinery dangerous, and this
spec states no police rule of its own — spawning is #8's (§0).

The consequence accepted with eyes open: **a fence is not inferable from the
galaxy map.** You find one by visiting, and then you remember it. That is the
texture being bought — specific places worth knowing — and it is also the
strongest argument for a rumour or bulletin system later, which is not
specified here and is not promised.

Geography follows for free, and it is scarcer than "about half". A refinery
needs a belt, and a belt needs **both** a roll under `BELT_PROBABILITY = 0.45`
**and** at least two planets to put a gap between (`src/system.ts`:
`if (wantsBelt && planets.length >= 2)`), so the refinery rate is strictly below
45%. The government weighting then removes a further share, and government is radially
biased — `galaxy-generation.md` §4.1 sets the core mean at 6 (range 4–7) and the
rim mean at 1 (range 0–3) — so fences concentrate at the rim.

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

### 5.4 A defect this node found, fixed by #51: unreachable systems

**Fixed.** One correction to the framing first, because it was carried from
#23 and is wrong: a planetless system's arrival point *computes*. `arrivalPoint`
places the ship along a seeded bearing from the system origin and pushes clear
of whatever bodies exist, so it returns a finite point for a system with none.
What was broken was that there was nothing to travel to — undockability, and
uselessness, rather than a failure to place the ship.

The rate was about one system in 700 — 0.143% over 40 worlds — and
is now zero. #51 took the second of the three answers below: the ladder keeps
the primary rung, clamped to the envelope boundary rather than discarded.

**A second defect went with it, three times as common.** The same floating-point
edge could filter the primary rung while other rungs survived, leaving a system
with planets but *none flagged primary*. Measured over the same 40 worlds:
14 planetless against **42** with planets and no primary. It was invisible to
the rate measurement because `generateStations` falls back to `planets[0]`, so
those systems had a trade station and simply did not have it on a primary.

**This section owns the figures.** Every other mention — §11.6,
`src/system.ts` — points here rather than restating them. The invariant is
asserted by `tests/system-reachability.test.ts`; the rate test that used to
pin the defect is gone, because a band around a rate passes a generator that
has half-regressed.

Not introduced by the node that found it, and not fixed by it either — #51 did
that, later. Recorded here because the fixture committed with this spec is what
exposed it, and because §5's whole construction assumes every system can be
docked at.

`galaxy-generation.md` §6.4 lists the trade station as present **"always"**, and
`src/system.ts` states it outright: *"The trade station is unconditional, so a
system always has somewhere to dock — a system with no station would be a dead
end the galaxy map has no way to warn."* Both are false. The push is guarded by
`if (primary)`, and §6.2's Titius-Bode ladder discards every rung outside the
0.3–6 AU envelope, so a system can end up with no planets at all.

**It is a rate, not two named systems.** `src/main.ts` seeds the world from
`Math.random()` unless `?seed=` pins it, so there is no single shipped world
whose bad systems could be listed — every session generates its own. Measured
across **40 worlds, 81,920 systems: 117 are planetless, and the same 117 are
stationless — 0.143%, about one in 700, or roughly three per 2,048-system
world** (`scripts/measure-clamp-bite.ts`, which reports this alongside §3.2's
table so both figures come from one reproducible sweep). It compares the two as
*sets* rather than as counts, and prints whether they match, because the whole
fix menu below rests on planetlessness being the sole cause.

**It is not only a docking problem.** A planetless system has no body to arrive
near either, and #10's arrival point assumes one — so the deferred node is
scoped to *reachability*, not to docking. Reading "nowhere to dock" as the whole
defect would under-scope it. Pinned by `tests/station-orbits.test.ts` as a rate over eight worlds
with a band around that figure, asserting the defect's extent rather than the
invariant, so the fix breaks the test on purpose.

**Why it is not fixed in this PR.** Two reasons, and the second is the
decisive one:

1. There are three defensible answers and picking one is a decision, not a
   patch — give a planetless system a **star-orbiting** trade station; force the
   ladder to keep **at least one** planet; or drop such systems from the galaxy
   entirely. Each has different consequences for #10's arrival point (which
   assumes a body to arrive near), for the galaxy map, and for the determinism
   digest.
2. Any of the three **moves station placement**, which is precisely what the
   fixture committed here exists to pin. Landing the fix in the same PR would
   make the baseline and the change indistinguishable.

Owned by its own node, below this one.

---

### 5.5 The raider outpost, placed and not yet trading (#491)

#490 ruled what the outpost is; #491 put one in every system at the lawless end
of the government scale (`galaxy-generation.md` §6.4 owns where). What it
carries, and the explicit absence of what it does not:

- **Law — carried.** Its berth admits a pilot at or above Wanted heat and
  refuses one below (#490 D5): the witness rule inverted, available because an
  outpost is never a system's only station. `legal.ts`'s `dockingRefusedByLaw`
  holds that arm. It **witnesses nothing** (D10): `stationsInEarshot` skips any
  station `STATION_LAWFUL` marks unlawful, so no save's witness list names one.
  That is the witness half only — `chargeOffence` prices heat from the act, not
  from who heard it, so an offence beside an outpost still costs heat and can
  still make the pilot Wanted, which every shipyard refuses on standing alone.
  And it posts no Bounty
  (#495 D4's "every lawful station").
- **Market — absent.** D6 makes it a fence with a thin, punitive general list,
  and reopens §5.2's geography to do it; none of that is built. A single signed
  `TYPE_OFFSET` cannot be dear in both directions, so "punitive" is a design
  question of its own, and §3's floor-fire figure (0.80% over the non-zero
  types) would move under any new offset. Until then `TYPE_OFFSET` has no
  outpost row, `market.ts`'s `hasMarket` says so to anything that walks a
  system's stations, `STATION_FENCE_ELIGIBLE.outpost` stays `false` — a fence
  flag on a station that trades nothing is a lie the market's node would
  inherit — and it posts no ordinary work.
- **Docking — closed, as its own reason.** The docked console's context is
  built on the station's market (`main.ts`'s `dockedStationContext`), so every
  tab — market, equipment, fuel — would throw for a Wanted pilot admitted by
  D5's arm. `STATION_BERTHS_OPEN.outpost` is `false`, and
  clearance is denied as `"closed"` — *"No berth is free to you"* — before the
  law is asked, so a clean pilot is not told they are hostile. The market's node
  opens the berth as an act; `tests/raider-outpost.test.ts` refuses an open
  berth without a market behind it.
- **Traffic — on its own side of the line.** Its roster is the table's: one
  carrier, with two berths less the visitor's. A lawful station's carriers are never
  routed to it and its own to no lawful berth (`STATION_LAWFUL` in
  `station-route.ts`), so placing it moved no existing carrier's schedule; its
  courier leaves the system abstractly and comes home.
- **Raider pressure — not yet.** D3's own dial on the leg law, the relay paired
  with it (D7), its destruction and relocation (D8, #494) and the sweep that
  finds it (#482) are each their own node. Today it is a place.

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

A player tells the four types apart by **outline**, before colour and before any
detail resolves — and, deliberately, without any dependence on a HUD or scanner
design, which remains unowned fog.

### 7.1 A pool of forms, not one silhouette per role

#28 gave each role exactly one outline. Reviewed in the live game after #36's
visual pass, all three were rejected on form: the trade station's slot sat on a
vertex, so there was nothing to fly into, and the other two read as neither
machine nor rock. #56 rebuilt them in the **swept-loft language of #35's ship
hulls**, and each role now carries **three forms** rather than one.

They are all kept. A role names a size and a job; a form names a station model
within it — the same relationship #35 settled between a hull archetype and its
variants, and for the same reason: the pool is what a later decision draws on.

| Role | A | B | C |
|---|---|---|---|
| trade | **Coriolis** — a cuboctahedron; the slot is cut into a real flat square face | **Ring** — a spun torus on a fixed hub, the dock a tunnel on the axis | **Drum** — an O'Neill barrel end-on; length rather than width is the cue |
| shipyard | **Gantry** — a bridge keel under open ribbed bays sized for a ship | **Hangar** — a closed slab with a floodlit bay mouth; ships inside, not clamped outside | **Slipway** — a broken ring with the gap as the slip |
| refinery | **Warren** — terraced plant cut into the rock; the pad is in the notch | **Collar** — a machined band gripping the rock at its waist | **Spar** — a processing spar run through the rock and out the far side |
| outpost | **Derrick** — a lattice tower on a tank cluster, pad deck on top | **Buoy** — a stubby drum wearing radiator fins; nothing hangs off it | **Rig** — an angled truss holding a deck out over a drill head |

Three roles carry a fourth form, **D**, whose shape is a **plan solved by wave
function collapse** rather than a drawing: a vocabulary of modules with
per-axis adjacency rules, a few cells planted, the rest collapsed onto a
diamond of cells from the station's own assembly seed (`DOMAIN.STATION_ASSEMBLY`,
`Station.assemblySeed`, #257 — its own draw rather than the berth seed's, so a
station's shape and the side its berth is on can vary alone). Every station of
a solved form is its own shape and keeps it. `station-modular.ts` is the
vocabulary core and the trade Assembly, on seekolous's solver copied in and
given directional adjacency; `station-plant.ts` is the two pad roles'.

- **Trade D — Assembly** (#202): a compact hub carrying the slot, a truss
  spine, habitat tubes, junctions and lattice beams with radiator banks, tank
  racks and a dish hung off them. The hub is what spins, for the shipyard's
  reason below.
- **Refinery D — Works** (#257): **the rock is the station.** A 0.55 km
  asteroid quarried flat across its +Z face, with the plant solved onto that
  floor: a head house at the centre carrying the pad at the table's plane, a
  pipe line running from it to a mine head over the shaft at the −Y edge, a
  flare stack beside the line, a radiator rank, and columns, crackers, pipe
  racks and tank farms where the plan puts them. Every joined pair of cells
  is piped centre to centre; the rock carries the mass. **Two passes were
  flown and rejected on the sheet first, and they were the same mistake from
  opposite sides**: units on plated deck tiles read as an opaque wall with
  the plant hidden behind it, and units on pipes alone read as *"modules
  linked only by trusses, one little asteroid with a ton of modules around
  it"* — the role inverted, since the other three refinery forms are all
  rock first and machine second.
- **Outpost D — Cluster** (#257): the Assembly's grammar at a fifth of the
  size — a core can carrying the pad on its +Z face, a truss spine, habitat
  cans docked end to end, and tank racks, a tower and radiator fins. The tower
  is barred from the first ring of cells, where the pad deck overhangs.

The Assembly entered the pool for a ranking round on the principal's yes
(2026-09-06); `SELECTED_FORM.trade` stays A until that round ranks it. **The
Works and the Cluster were taken in that round** — shown at four plans under
three finishes and four framings on the finish sheet
(`scripts/shot-finishes.mjs`, which grew a `SEEDS` axis because one plan
cannot show the variety a solved form is for), and selected for their roles.
So a solved form is what the game draws for the refinery now, and every
refinery in the galaxy is its own plant.

Trade carries a fifth form, **E — Wheel** (#332), a close homage to *2001*'s
Space Station V requested by the principal: two box-section rims on one axis,
one plated with its ports lit and the other still a lattice, on a hub whose
front cap carries the slot. The unfinished rim is lattice **all the way round**
— four continuous rails with plated sections set inside them — because the
whole Wheel spins, and a half-built arc would be an outline that depends on the
clock (§7.2). The section is a box rather than the Ring's tube, which is what
tells the two ring forms apart. The hub is sized from §13.1's bay rather than
from the slot, so the bay stands inside it. It entered the pool unselected, for
a ranking round, as the Assembly did.

The outpost carries a fifth form too, **E — Salvage** (#518), because #490 made
the outpost the raider's haven and the Cluster was ranked as an industrial
machine (#493). Its sentence is the role's: *welded together from salvage —
hull sections, cargo pods and a ship's forward half bolted around the pad;
improvised, asymmetric, lit by work lamps.* It is **grown rather than solved**:
a salvaged freighter section stands on the axis as the core, and every later
piece is welded onto a socket on something already built, leaning the pile to
one side the assembly seed chooses. Each welded piece — the bow, a section, a
pod — is kept only if its box stays inside 0.40 km and behind the deck or well
clear of the corridor; the plates, lamps and girders on them are not checked one
by one, and what holds the whole form is the corridor and reach rows over the
seed spread. The bow, the sections and the plates are painted from a palette of
other hulls' colours, drawn per piece, so a plan repeats some; the pods carry
freight colours. The lamps are warm work lamps, not the pad's cool floods and
never red (`hud-and-scanner.md` §4). It was ranked beside A–D at three plans
under five finishes and four framings, and taken (2026-09-24). Its macro
fixtures — a belt, two pipe runs and a tank rack on the core — were added after
that sheet, because a selected form owes them under the industrial finishes.

`SELECTED_FORM` (`station-mesh.ts`) names the one the game builds for each role,
and is one line per role so a later choice is one edit. Trade and shipyard are
**A** because round one ranked their slot first. **Refinery and outpost were D
since 2026-09-06**, on the principal's yes to #257's sheet — the first choice
either role had, after two rounds in which `a` was a placeholder that said so.
**The outpost is E since 2026-09-24**, on the principal's yes to #518's sheet,
because the role became a raider's haven after the Cluster was taken. The
refinery's choice changes what a running game draws; the outpost's did not
until #491 placed the first outposts, so E is now what a lawless system draws
where before only the workbench drew it.

**The letter carried forward and the geometry did not, which is worth being
plain about.** Round one's trade A was a twelve-sided lofted drum; it has been
rebuilt twice since — squared in section, then as a cuboctahedron — because it
projected as a circle and could not be told from the refinery by outline, and
then because it was judged ugly. The shipyard's A has changed less but its
spinning part is now a hub rather than the keel that was ranked. So the ranking
chose a *concept* and the concepts survived; nobody has ranked the geometry that
ships. A round three would be ranking different objects under the same letters.

### 7.2 What each form owes

- **A flat face for its aperture.** #28's octahedron put the slot on a vertex.
  Every form now mounts the aperture on a surface that exists: a cuboctahedron's
  square face, a hub's front cap, a pad deck.
- **A compact spinning part.** The slot sits on the spin axis (`docking.md` §4),
  so whatever turns sweeps its own outline round that axis. A 1.4 km keel spun
  about it changes the station's projected width between phases, which is a
  silhouette that depends on the clock. The shipyards turn a hub and leave the
  structure still — #28's non-rotating drydock rule, generalised.
- **A declared reach**, in `STATION_FORMS`, which `station-mesh.test.ts`
  measures every form against — including the ones nobody has selected, because
  a form the game never builds is exactly where an overrun hides.
- **One connected assembly**, and **nothing in the docking corridor**: both are
  headless assertions, and both caught real defects — four parts hanging in
  space beside their stations, and an asteroid standing 131 m proud of its own
  pad.

`STATION_COLORS` (`src/sim.ts`) stays as the secondary cue and is unchanged.
Emissive detail — window grids and hull strobes, cold floodlit bays, glowing
vent throats — is welcome and is not what the identity rests on, because it
resolves at medium range and vanishes at scanner range. #36's visual pass
(`station-visuals.md`) owns all of it and is keyed on the *role*, so it survived
this rebuild untouched.

All procedural, per the map constraint: every form is a parameterised mesh
generated at load, no downloaded assets.

---

## 8. Generator changes this requires

1. **`DOMAIN.STATION_FLAGS = 8`** in `src/galaxy.ts` (§5.3).
2. **`DOMAIN.STATION_SPIN = 9`**, and `spinRpm` draws from it. One tag for both
   new fields would reproduce inside `STATION_FLAGS` exactly the coupling §5.3
   created the tag to escape: `spinRpm` is drawn conditionally on type, so a
   third flag added later would shift it. The orbit fixture pins type, parent
   and orbit only, so a shifted flag stream has no guard — which is the argument
   for separating them rather than for ordering them carefully.
   Neither field may be drawn from `DOMAIN.STATIONS`.
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
7. **`DOMAIN.STATION_ASSEMBLY = 13`**, and `Station` gains
   **`assemblySeed: number`** (#257), drawn unconditionally in station order
   from its own stream, beside the berth draw that `docking.md` §13.2 reads,
   for the reason item 2 gives: a draw inside another tag shifts everything
   after it.
   It is the plan seed of a solved form (§7.1) and nothing else reads it.

---

## 9. Verification obligations

Two tiers, per the repo's culture.

### 9.1 Headless (`bun`)

- **The price offset is never swallowed.** For every commodity with a non-zero
  gradient, the refinery and shipyard prices differ from the trade station's in
  every system in the corpus — including economy 0 and economy 7, which is where
  the rejected `clamp(…, 0, 7)` implementation would have collapsed them (§3.2).
- **The offset points the right way**, which is a *separate* obligation and the
  one that matters most. The test above passes just as happily with a refinery
  offset of −3 — the backwards value §3.1 records as this spec's largest
  correction — so it must be pinned by direction, not merely by difference:

  | assertion | why |
  |---|---|
  | a refinery's **Minerals** are cheaper than the trade station's | the refinery's own product; the −3 draft made them dearer |
  | a refinery's **Computers** are dearer | positive gradient, remote outpost |
  | a shipyard's **Computers** are cheaper | manufacturing hub |
  | a shipyard's **Minerals** are dearer | the mirror of the above |

  Each holds in **every** system of the corpus, since §3.2's delta form has no
  system-dependent behaviour. A sign error anywhere in the chain — the offset,
  the gradient, the price step — fails at least two of the four.
- **`government = 0` returns 1.0, not `NaN`.** §5.1's odds form divides by zero
  there, and the guard is a special case that a reimplementation will drop.
  Every type at `government = 0` must be asserted, trade station included — it
  is the factor-1.0 case that looks safest and fails identically.
- **The extremes behave as #7 decides.** Whatever #7 settles for a delta that
  pushes a price below zero or past the byte range (§3.2), the corpus must
  exercise it — Narcotics at a refinery (`+3 × 29 × 0.4` = +34.8 Cr) is the
  worst case and belongs in the test by name, priced at a fence since that is
  the only place it trades.
- **`blackMarket` and `spinRpm` move no station.** Guarded by
  `tests/station-orbits.test.ts` against `tests/fixtures/station-orbits.json` —
  791 stations across two full galaxies, captured by
  `scripts/capture-station-orbits.ts` on the generator as it stood *before*
  those fields existed. The fixture is committed in this PR because that is the last
  moment the baseline is *cheap*. Strictly it stays recoverable — this commit's
  `src/` plus the capture script reproduce it — so the honest argument is not
  "impossible later" but "nobody will remember to, and the guard is worthless
  unless the baseline predates the change". Its ability to
  fail was checked by hand, by inserting a throwaway `DOMAIN.STATIONS` draw and
  watching it go red, then removing it. **That experiment left no committed
  artifact** — it cannot, without shipping a deliberately broken generator — so
  it is evidence about a run, not a reproducible check, and is stated that way
  rather than as a passing test.
- **The two golden files are not interchangeable.** `galaxy.test.ts`'s
  determinism digest pins the *record* and will legitimately move when the new
  fields land; the orbit fixture pins *placement* and must not move with them.
  Repinning both in one commit destroys the evidence.
- **`blackMarket` frequency tracks government.** One world holds 2,048 systems
  and well under a thousand refineries, so this corpus **sweeps world seeds**
  rather than galaxies — the tooling takes a seed list, not the single
  `WORLD_SEED` the placement fixture is pinned to. Over ≥ 20,000 refineries: observed rate at `government = 0` within [0.92, 0.98], at
  `government = 7` within [0.05, 0.11], and non-increasing across `g` allowing
  for sampling noise. Bounds from §5.2's table.

  > **Amended by [#28](https://github.com/jcfischer/seelite/issues/28), which
  > built it.** *≥ 20,000 refineries* sizes the wrong quantity. The binding
  > assertion is the `government = 7` rate, and that bucket is two orders of
  > magnitude rarer than the others: over 200 worlds, 156,388 refineries held
  > 16,647 at `g = 0` and **735 at `g = 7`**. At 20,000 total the `g = 7` bucket
  > holds about **95** refineries, where the standard error on a rate of 0.075 is
  > 0.027 — wider than the half-width of the band it is asked to be inside. A
  > test written to that number passes or fails on its seed set, which is this
  > section's own "assertion that cannot fail" defect wearing the other face.
  >
  > **Size the sparse bucket, not the total.** The obligation is now, and this is
  > written as *what is gated where* because the first draft of this amendment
  > claimed a band that nothing enforced:
  >
  > - **Gated, `npm test`.** Every bucket holding ≥ 500 refineries is within four
  >   standard errors of §5.2's ramp, over a ~20,000-refinery corpus; and the
  >   `g = 7` bucket is swept for **separately** until it holds 400, then held to
  >   the same 4σ — ±0.052 there, which is nine standard errors clear of the 0.20
  >   a broken ramp produces. Costs about four seconds.
  > - **Not gated — `scripts/measure-fence-rate.ts`, run by hand.** §5.2's
  >   [0.05, 0.11] band at `g = 7` needs 2,000 refineries in that bucket, which
  >   takes 541 worlds and a quarter of a minute. Run it when the ramp changes.
  >   Measured: **0.9501 at `g = 0` over 45,347 and 0.0830 at `g = 7` over
  >   2,000**, every bucket inside 4σ, both bands held.
  >
  > The distinction matters because a band checked only by a script no CI job
  > and no suite invokes is a band nothing checks.
- **Incidence is measured, not estimated.** The same corpus reports refinery
  incidence and fence incidence per galaxy, and asserts only the shape §5.2
  commits to — a minority of systems, higher at the rim than the core. The
  figures go in the test's output so the number is evidence rather than prose.
  Measured by #28: **37.9%** of systems hold a refinery over 53,248 systems,
  against §5.2's strictly-below-45% argument.
- Every shipyard-bearing system has `displayTL ≥ 10`; every refinery-bearing
  system has a belt.

### 9.2 Browser probe

- The three silhouettes are **measured** for distinguishability: render one of
  each at a fixed distance and compare their projected outlines desaturated,
  which is the honest version of "tell them apart" since §7 claims outline and
  not colour.

  It is reported and not asserted, by the principal's decision of 2026-08-26
  while #56's forms were being ranked. §7's standard stands as design intent;
  what was withdrawn is the *gate*. A floor on this metric turns out to be a
  design driver — in one afternoon it produced a third radiator wing, a pair of
  forward booms and a squared hull section, none of them chosen for the role and
  all of them chosen to move a figure. Forms are ranked on how they look, and a
  gate that quietly reshapes them competes with the person ranking.

  What stays gated is that each station is drawn and has a silhouette at all,
  and that re-measuring one reproduces it — the control, which is about whether
  the measurement works rather than about what it finds.
- Reading constants off `window.__seelite`, never restating them.

---

## 10. What this obliges of other nodes

- **#7 (economy)** — prices generate per station: the system's price plus §3's
  `typeOffset × gradient × 0.4 Cr` delta. #7 also settles what that delta does at
  the byte extremes (§3.2). The commodity table **must** carry illegal goods
  (Elite's Narcotics, Firearms, Slaves) and a per-commodity legality flag,
  because §5.2 makes the black market load-bearing rather than flavour.
  Equipment prices are TL-gated per §4; hulls price only at shipyards.
  **Per-station stock** (quantity, and how it regenerates against the #6 game
  clock) is #7's too — this spec deliberately says nothing about it, and the
  galaxy spec's original "prices and stock belongs to #7" hand-off is preserved
  by this sentence rather than lost in the amendment.
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

1. **Commodity differentiation is soft.** §3.3 — three prices for one
   transaction, accepted to avoid stranding cargo. §4 and §5 carry the
   differentiation instead, which is what makes them load-bearing.
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
5. **A belt refinery sells cheap bread.** §3.3 — staples share the extractive
   gradient, so the +3 that cheapens ore cheapens Food, Furs and Liquor too.
   Flavour debt; the declined repair is named there.
6. **A small fraction of systems generated unreachable** — no planet, so no
   station and no arrival body. Found by this node, fixed by #51. §5.4 owns the
   measurement and records the second, more common defect the fix also closed.
