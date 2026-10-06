# Economy and trade

> Resolves [#7](https://github.com/jcfischer/seelite/issues/7). Nine decisions,
> taken one at a time with the principal, plus one forced by a measurement that
> overturned the second of them.

## 0. What this owns, and what it does not

**Owns:** the commodity table and its legality flags; the price and stock
arithmetic; how a station's type shifts both; how stock regenerates against the
#6 game clock and how it remembers the player; cargo, credits and fuel prices;
equipment prices; the trade→upgrade progression; the economic half of death.

**Does not own**, and deliberately says nothing about:

| | Owner |
|---|---|
| Which stations exist, where, and of what type | `galaxy-generation.md` §6.4 |
| What a station type *is* — exclusives, law, geometry, the `blackMarket` flag | `station-types.md` |
| Legal status, bounties, police, contraband *consequences* | #8 |
| The market screen's layout | the unowned HUD node |
| Which hulls exist, and what each carries | `src/hull.ts` (#181); §7.1 prices them |
| Save format, slots, permadeath | the save/load node (still fog) |

Terminology is `station-types.md` §1's, unchanged: a **station** is any dockable
object, a **fence** is a refinery whose `blackMarket` flag is set.

---

## 1. The shape, in one place

```
product   = economy × gradient                    // Bell's slope
changing  = fluct & maskbyte                      // the visit's noise

priceByte = clamp(basePrice + changing + product, 0, 255)
priceCr   = max(PRICE_STEP_CR,                                 // §3.1's floor
                priceByte × PRICE_STEP_CR
                  + typeOffset × gradient × PRICE_STEP_CR)
priceCr   = max(PRICE_STEP_CR,                                 // §5.3's floor —
                priceCr × (1 + PRICE_ELASTICITY                //   not redundant
                               × clamp(deficit / holdT,        // §5.2 — in
                                       ±DEFICIT_SATURATION_RUNS)))  // holds

// §5.6: that figure is the market's *mid*, and a station quotes two edges off
// it. A purchase pays the ask, which is the mid; a sale is paid the bid.
askCr = mid
bidCr = max(PRICE_STEP_CR, mid × (1 − BID_CUT_FLOOR
             − BID_CUT_GRADE × (displayTL − DISPLAY_TL_MIN)
                                  / (DISPLAY_TL_MAX − DISPLAY_TL_MIN)))
// …and both edges are then quantized to PRICE_DISPLAY_STEP_CR, because the
//   console prints a tenth of a credit and the till charges what the glass shows.

quantity  = clamp(clamp(clamp(baseQuantity + changing − product, 0, 63)
                          + max(0, −typeOffset × gradient),    // §3.2
                        0, 63)
                    − clamp(deficit, ±63),                     // §5.2 — inside
                  0, 63)                                       //   the clamp
```

| Constant | Value | Source |
|---|---|---|
| `PRICE_STEP_CR` | 0.4 Cr | Bell's byte→credits step |
| quantity cap | 63 (`& 0x3F`) | Bell |
| `typeOffset` | trade 0, refinery +3, shipyard −2 | `station-types.md` §3 |
| `MARKET_PERIOD` | 30 min game time | §5.1 |
| `DEFICIT_HALF_LIFE` | 20 min game time | §5.2 |
| `PRICE_ELASTICITY` | 0.10 per full hold, any hull | §5.3 |
| `HOLD_REFERENCE_T` | 20 t — the *baseline hull's* hold | §6, `src/hull.ts` |
| `DEFICIT_SATURATION_RUNS` | 3.15 runs of the flown hold | §5.2 |
| `HULL_PRICE_BASELINE_CR` | 23,000 Cr | §7.1 |
| `HULL_PRICE_EXPONENT` | 1, up to the knee | §7.1 |
| `HULL_PRICE_KNEE_HOLD_T` | 60 t | §7.1 |
| `HULL_PRICE_UPPER_EXPONENT` | 0.52, above the knee | §7.1 |
| `HULL_CEILING_HOLD_T` | 197 t | §7.2 |
| `BID_CUT_FLOOR` | 0.10 — `PRICE_ELASTICITY`, the mark one full hold leaves | §5.6 |
| `BID_CUT_GRADE` | 0.15 wider from rim to core | §5.6 |
| `PRICE_DISPLAY_STEP_CR` | 0.1 Cr — the quote's own precision | §5.6 |

The executable copy is **`src/market.ts`**, where
[#25](https://github.com/jcfischer/seelite/issues/25) moved it. There is one
copy of the **price and stock pipeline** — `marketRowAt` — imported by the
suite, by `tests/helpers/market-math.ts` and by `scripts/`, so no two of them
measure different arithmetic. The claim is about that function and not about
every byte below it: `BELL_WRAP` deliberately re-derives the byte close, because
it is the arithmetic §2.2 *rejected*, and `NARCOTICS_BELL` re-transcribes one
commodity row for the same reason. Both are the counterparts a rejection needs
to stay runnable, and both live with the measurements rather than in the module. What stayed behind in `market-math.ts` is the surface that
exists only to check this spec — Bell's own Narcotics row, his wrapping byte
close, the domain sweeps, the residual surveys — and §11 records why that is a
split rather than a move.

**The figures quoted below are transcribed script output, not pinned values.**
The suite asserts *thresholds* — margin above 75 Cr/t, floor under 1%, exhaustion
within four runs — deliberately, because a pinned figure would fail on every
legitimate retune and teach the next reader to re-pin it without thinking. The
cost is that a number in this prose can go stale while the suite stays green;
§10.2 is how it gets re-derived, and it should be re-run whenever a constant in
the table above moves.

---

## 2. Prices: Bell's arithmetic, closed differently

### 2.1 The formula is Bell's

`genmarket` from `txtelite.c`, recorded in `docs/research/elite-1984-mechanics.md`
§2.1. Four constants per good — `basePrice`, `gradient`, `baseQuantity`,
`maskbyte` — one fluctuation byte per market, and the signed `product` term
entering price *added* and quantity *subtracted*. That opposite sign is the
whole mechanism: **cheap implies plentiful**, in one line of arithmetic.

It is reused twice more in this spec rather than replaced — by the type offset
(§3) and by the stock deficit (§5). Neither introduces a pricing mechanism of
its own, which is the discipline `station-types.md` §3.3 set.

**`baseQuantity` is a signed byte.** Liquor `0xFB`, Slaves `0xE2`, Furs `0xDC`,
Gem-Stones `0xFA` and Alien Items `0xC0` are −5, −30, −36, −6 and −64; the 6502
reads them as two's complement. Read them unsigned and all five sit at the
63-unit cap in every system, which inverts the trade lanes the economy is built
on. `basePrice` is genuinely unsigned. This is written down because it is a
transcription trap that produces a plausible-looking table, and
`tests/market.test.ts` pins all five values.

### 2.2 Saturating, not wrapping

Bell does the arithmetic in 8 bits with deliberate overflow — "overflow 'errors'
are extremely frequent and exploited". seelite **clamps at 0 and 255 instead**.

The case for wrapping is that the overflow is a feature, and research §6.2
recommends adopting it exactly. The case against is that a good which wraps from
254 to 2 Cr is inexplicable at the market screen, and #13's type delta already
sits on top of this formula — which is why `station-types.md` §3.2 deferred the
byte extremes here.

**What that choice costs was measured, not argued.** Swept over the entire input
space — 17 goods × 8 economies × 256 fluctuation bytes — by
`scripts/measure-market.ts`:

- **Sixteen of seventeen goods overflow on 0.00% of rows.** Bell's constants
  simply never leave 0…255 for them, so for all but one good the two
  arithmetics agree **on the price byte**. They do not agree on quantity — four
  goods differ, per the divergence table below — and the distinction matters,
  because this sentence was previously quotable as though the two arithmetics
  were the same function outright.
- **Narcotics overflowed on 97.66%**, and its price span collapsed from
  0.4–101.6 Cr to 94.0–102.0 Cr.

So the entire disagreement between wrap and clamp lived in one good — and in
that good it was fatal. §2.3 is what was done about it.

**The clamp applies to the quantity byte too, and there it *is* a divergence
from Bell.** He clips negatives to zero and then masks with `& 0x3F`, which
wraps 64…127 back down rather than capping. Four goods read differently as a
result, measured over the whole domain:

| Good | Rows differing | By up to |
|---|---|---|
| Gold | **100%** | 61 units |
| Platinum | 90.2% | 63 units |
| Narcotics | 18.8% | 62 units |
| Furs | 10.6% | 63 units |

Gold is the extreme: `baseQuantity` 0x42 = 66 never leaves 66…80, so txtelite
shows 2–16 units and seelite shows a permanent 63. **This makes a precious metal
abundant that Bell made scarce**, and since Gold is sub-tonne (§6) it skips the
hold check entirely — 63 units ride free *beside* a full cargo hold. Measured,
that is **353 Cr a run** at its 5.6 Cr/kg spread on the fence leg — 479 Cr over
every leg — and **Platinum is the bigger beneficiary at 1,134 Cr**, rising to
**1,386 Cr** across all legs, which is where §4's table ranks it. The instrument
prints the all-leg figures and the suite pins the fence-leg ones; §4.1's run
totals are where the two combine, and they are pinned too. Both figures are printed by the
instrument's run-value table and pinned by the suite, because every other sweep
in this spec drops non-tonne goods and the numbers would otherwise have nothing
behind them. Clamping is chosen for
the same reason as on price — a shelf that jumps from 63 units to 2 when the
fluctuation byte ticks up by one reads as a bug — but the consequence is a
design change, not a transcription.

**After §2.3, the price side never overflows at all: the measured overflow rate
is 0.00% across every good.** The clamp is therefore a *guarantee* rather than a
behaviour — it fires nowhere in the shipped table. It is kept, and named as a
guard that currently cannot fire, because the alternative is leaving the
boundary undefined for the first good a later node adds or retunes.

### 2.3 The one divergence: Narcotics

Every *constant* in the table is Bell's except this row (the arithmetic around
them diverges in two places — §2.2's two clamps):

| | basePrice | gradient | baseQuantity | mask |
|---|---|---|---|---|
| Bell | `0xEB` | +29 | `0x08` | `0x78` |
| **seelite** | **`0x14`** | **+13** | `0x08` | **`0x70`** |

**Bell's row cannot stay inside a byte, by construction**: `235 + 120 + 7×29` is
558. He chose those constants *to* overflow, and the wrap is where the good's
entire price variation lives. Under §2.2's clamp it flattens, and a flat
contraband price is not a survivable outcome — `station-types.md` §3.4 makes
Narcotics the centrepiece of the smuggling loop, and §5.2 there builds a
rim-weighted fence geography on it being worth carrying.

Measured fence→fence, with **independent fluctuation bytes per station** (two
stations have different seeds; pairing them on one byte understates every
margin):

| Narcotics row | Best margin | In stock | Overflows |
|---|---|---|---|
| Bell + wrap | 100.4 Cr/t | 47% | 97.7% |
| Bell + clamp | **8.0 Cr/t** | 36% | 97.7% |
| **seelite + clamp** | **81.2 Cr/t** | **64%** | **0%** |

The 47% is Bell's own, and an earlier draft of this table said 36% for both of
his rows. That was seelite's shelf wearing his name: the arithmetic clamped
quantity regardless of mode, so the "Bell + wrap" row was his price formula with
seelite's quantity close — quoted in the very table written to justify diverging
from him. `wrap` now wraps both bytes, and the suite pins that it does.

Firearms (39.2 Cr/t, stocked at 38%) and Slaves (22.0 Cr/t, stocked at 100%)
are untouched by any of this — they never overflowed.

**These are refinery→refinery figures.** A fence is a refinery whose
`blackMarket` flag is set (`station-types.md` §5.2), and the flag does not enter
pricing at all — `typeOffset` is a property of the *type* — so fence and
refinery prices coincide everywhere in this table. The measurement is named for
what it sweeps rather than for what the fiction calls it.

**And it sweeps economies independently, which means a multi-jump route.** Buy
and sell are maximised over the whole (economy, fluct) domain, so 81.2 Cr/t is
the best pair of fences *anywhere in a galaxy* — not one jump apart, and with no
guarantee two such fences are neighbours. Unlike §5.4's interstellar baseline,
that is the right measurement here rather than a defect: `station-types.md` §5.2
makes fences a rim-weighted minority you find by visiting and then remember, so
a smuggling route is explicitly a thing to be learnt and flown, not a next-door
arbitrage. The figure is an upper bound on what the trade can pay, and it should
be read as one.

The retuned row keeps everything the good is for: a positive gradient, so it is
cheap in Rich Industrial and dear in Poor Agricultural; the largest mask in the
table at `0x70`, so it stays the volatile gamble; and a margin within a fifth of
Bell's. It is more available than his row — 64% against 47% — though the honest
gap is narrower than the 36% figure this section first claimed.

**Three alternatives were considered and are recorded rather than deleted**,
because the failure is easy to reintroduce:

1. **Revert to wrapping everywhere.** Defensible — the "reads as a bug" cost is
   confined to the one good whose character is the wild swing, and it keeps an
   exact txtelite oracle. Rejected because the type delta then needs a defined
   wrap order and a 0.4 Cr Narcotics is a farmable artefact.
2. **Wrap for illegal goods only.** Keeps every constant verbatim and the gamble
   exactly as built. Rejected: two arithmetics in one formula selected by a flag
   is the second mechanism §3.3 of `station-types.md` worked to avoid.
3. **Accept a flat Narcotics** and move contraband's value to #8's risk side.
   Rejected: that mechanism does not exist, is not #7's, and would leave #13's
   smuggling design with no economic basis at all.

### 2.4 The lanes, unchanged

| Group | Goods | Gradient | Cheap and plentiful at |
|---|---|---|---|
| Extractive | Minerals −1, Gold −1, Platinum −2, Gem-Stones −1, Radioactives −3, Alloys +1 | mostly negative | Poor Agricultural |
| Staple | Food −2, Textiles −1, Liquor −5, Furs −9, Slaves −5 | negative | Poor Agricultural |
| Manufactured | Computers +14, Machinery +6, Luxuries +8, Firearms +13, Narcotics +13 | positive | Rich Industrial |

The canonical loop survives: Computers outward from Rich Industrial (+39.2 Cr/t at
zero fluctuation), Furs homeward (+25.2 Cr/t). `tests/market.test.ts` asserts
the direction for every good rather than for the two named ones, so a retune
that inverts a lane fails the suite.

**Alien Items** keep Bell's sell-only rule — quantity forced to 0, so the row
exists and is always empty until #8 provides combat scooping. **Gold, Platinum
and Gem-Stones** keep the sub-tonne unit that bypasses the hold check;
`station-types.md` §3.4 depends on all three being legal, and the suite asserts
that the sub-tonne set and the illegal set do not intersect.

---

## 3. Station type, applied to price and stock

### 3.1 Price: a delta in credits, after the clamp

```
priceCr = max(PRICE_STEP_CR, priceByte × 0.4 + typeOffset × gradient × 0.4)
```

The offset lands **after** the byte closes, in credits — not inside the byte and
not as an economy shift. The map's constraint from #13 is explicit that a
per-type modifier must be expressed where it cannot saturate, and it was written
after three separate measured collapses. Adding `typeOffset × gradient` into the
byte would reintroduce exactly that: the delta would be eaten at both ends.

**The floor.** A delta can in principle push a price to or below zero, so it is
floored at one price step. Measured across 17 goods × 8 economies × 256
fluctuation bytes at **the two station types whose offset is non-zero** —
69,632 rows — **the floor fires on 0.80%**. `tests/market.test.ts` fails if it
exceeds 1%.

The trade station is excluded from that denominator on purpose. Its offset is
zero, so its rows *cannot* fire and including them only pads the figure: over
all three types the same measurement reads 0.54%, which flatters the mechanism
by a third. The instrument prints both, and the suite asserts separately that a
trade station's floor never fires.

The suite also asserts the stronger property directly: at every point in the
domain the observed delta equals `typeOffset × gradient × 0.4` exactly, except
where the floor legitimately intervenes.

### 3.2 Quantity: one-sided

```
quantity += max(0, −typeOffset × gradient)
```

`station-types.md` §3 shifts price only, which leaves a refinery with cheaper
ore but no more of it — a fiction §3.3 there already flagged as a wart. Bell's
own arithmetic couples the two, so the symmetric fix is obvious:
`quantityDelta = −typeOffset × gradient`.

**The symmetric form deletes the contraband trade.** Narcotics' gradient is
positive, so a refinery's `+3` gives a quantity delta of **−39 units** (−87
under Bell's +29) against a `baseQuantity` of 8. It clips to zero. The refinery
is the *only* place contraband is traded, so symmetric coupling empties the
shelf at the fence.

Applying the delta **only where it is positive** has no such failure, and states
one rule: *a station type never makes a good scarcer — where its offset makes
something cheap, it also makes it plentiful.*

| Station | Good | Price | Quantity |
|---|---|---|---|
| refinery | Minerals (−1) | −1.2 Cr | **+3 units** |
| refinery | Radioactives (−3) | −3.6 Cr | **+9 units** |
| refinery | Narcotics (+13) | +15.6 Cr | unchanged (would be −39) |
| shipyard | Computers (+14) | −11.2 Cr | **+28 units** |
| shipyard | Food (−2) | +1.6 Cr | unchanged (would be −4) |

The refinery becomes a real ore source and the shipyard a real electronics
source, with no new table and no new mechanism. The 63-unit cap still binds.

---

## 4. Legality: the one scoped class

`station-types.md` §3.4 scopes the market by **legality**, not by station type:
Narcotics, Firearms and Slaves trade only at a fence; everything else trades
everywhere. That section obliges #7 to supply two things, and this is them.

1. **A per-commodity `illegal` flag**, carried on the commodity row itself
   rather than derived from a name list. Exactly three goods carry it, and the
   suite asserts the set.
2. **A visible marker on the market screen**, wherever an illegal good is
   listed, at a fence and in the player's own hold. This is stated as an
   obligation on the HUD node rather than a layout: `station-types.md` §3.4 is
   explicit that without it the exception degenerates into the unread-screen tax
   the unscoped table exists to avoid.

**Consequences are #8's**, not this spec's: legal status, scans, police
response, and the shipyard's reaction to contraband in the hold. This spec
prices contraband and marks it; it says nothing about what happens when you are
caught with it.

**Contraband must out-earn every legal good**, or the fence geography buys
nothing — and that has to be measured as **value per run**, not as a per-unit
margin. Gold's 5.6 Cr/kg is 5,600 Cr per tonne-equivalent, so any straight
ranking of margins is measuring unit scale. What makes goods commensurable is
what one trip can carry: a hold of tonne goods, or 63 units of a sub-tonne good
riding free beside it.

**And each good is ranked on the legs it may actually use.** Contraband is held
to the fence leg because §4 scopes it there; a legal good is not, and a draft of
this table held both to refinery→refinery — a restriction §4 imposes on
contraband by design and on nothing else. That understated every legal good and
so overstated the premium the section exists to justify.

| | margin | best leg | run value |
|---|---|---|---|
| **Narcotics** (illegal) | 81.2 Cr/t | refinery→refinery | **1,624 Cr** |
| Platinum | 22.0 Cr/kg | refinery→shipyard | 1,386 Cr |
| Computers | 68.4 Cr/t | shipyard→refinery | 1,368 Cr |
| Furs | 68.4 Cr/t | refinery→shipyard | 1,368 Cr |
| Firearms (illegal) | 39.2 Cr/t | refinery→refinery | 784 Cr |

Contraband holds the top of the *per-good* table, but **by 17%** — not the 43%
the earlier comparison produced, and not the 2× a per-unit ranking implies.

### 4.1 And per *run*, contraband loses

A per-good ranking is not what a player optimises. **A single run carries a full
hold *and* all three sub-tonne goods**, because Gold, Platinum and Gem-Stones
skip the hold check (§6) — the "or" in the paragraph above is inclusive, and a
draft of this section priced it as exclusive. Measured over every leg, economy
pair and byte pair:

| | best single run |
|---|---|
| legal — refinery→shipyard, economy 7→0 | **3,746 Cr** (Furs 1,352 + Gold, Platinum, Gem-Stones 2,394) |
| smuggling — fence→fence | **2,314 Cr** |

**So a legal run out-earns a smuggling run by 62%, and §4's opening requirement
is not met.** The cause is structural rather than a tuning miss: Narcotics has a
**positive** gradient, so it buys at low economy and sells at high; the metals
are negative-gradient and want precisely the opposite leg. **A smuggling route
cannot also carry peak-value metals**, so contraband does not add to the best
run — it displaces most of it.

This is recorded, not fixed here (weak joint 11), on the principal's call. It
touches #13 §5.2's rim-weighted fence geography, which was built on contraband
being worth carrying, and every available repair — dropping Bell's hold-check
bypass, retuning Narcotics a second time, or capping sub-tonne stacking — is a
design decision with reach past this node. **#8 owns contraband's risk side and
is where the premium can be priced**; it should read this section before
assuming the economy already pays for the danger it adds.

The suite pins both facts: the per-good ranking §4's table states, and the
run-level reversal, so neither can drift without failing.

---

## 5. Stock over time: the clock, and the memory of you

### 5.1 The base market is `f(seed, gameTime)`

Elite re-rolls the fluctuation byte on every hyperspace jump and stores it in
the save. seelite cannot inherit that unchanged: #6 made the game clock
authoritative, #10 forbids compressing sim time, and a system now holds up to
three stations separated by ~68 s cruise legs, so "regenerates on jump" would
freeze all three together for as long as the player is in the system.

```
fluct(station, t) = hash(stationSeed, floor((t + phase(station)) / MARKET_PERIOD))
phase(station)    = hash(stationSeed) mod MARKET_PERIOD
MARKET_PERIOD     = 30 min game time
```

No stored fluctuation byte: the base market is derivable from the seed and the
clock, which satisfies the map's determinism constraint rather than carving an
exception from it. The `phase` term staggers stations so markets do not all flip
on the same boundary.

**The stream needs its own domain tag.** `galaxy.ts`'s `DOMAIN` table gains
`MARKET`, for the reason `station-types.md` §5.3 gives about `STATION_FLAGS` and
the map's constraint about per-system RNG streams: reusing an existing tag
silently correlates the market with whatever else draws from it.

### 5.2 The deficit: what the market remembers

Elite's market forgets you the moment you leave. seelite's does not.

```
buying  n units at a station:  deficit += n
selling n units at a station:  deficit −= n

deficit(t)   = deficit₀ × 2^(−(t − t₀) / DEFICIT_HALF_LIFE)
             clamped to ±max(DEFICIT_SATURATION_RUNS × holdT, DEFICIT_MAX)
DEFICIT_HALF_LIFE          = 20 min game time
DEFICIT_SATURATION_RUNS    = DEFICIT_MAX / HOLD_REFERENCE_T = 63 / 20 = 3.15

effectiveQuantity = floor(clamp(generatedQuantity − clamp(deficit, ±63), 0, 63))
priceCr          ×= 1 + PRICE_ELASTICITY
                      × clamp(deficit / holdT, ±DEFICIT_SATURATION_RUNS)
```

**The deficit is read in *holds*, not in tonnes — #26's D6, measured by #182.**
Until that node the response was `clamp(deficit, ±63) / HOLD_REFERENCE_T`, which
is the same arithmetic for as long as every ship in the game holds 20 t and is
the map's #13 failure the moment one does not: **a per-hull *scaling* on a
bounded index gets clamped away where that type lives** — the map's own wording
of the constraint, with the noun changed because `CONTEXT.md` lists the map's
one as an *Avoid* alias for Carrier. One run of a 63 t hull
already reaches a ±63 *tonne* clamp, so the market's memory of a 63 t trader and
a 200 t trader was identical — the response stopped distinguishing hulls exactly
at the hold where §7.1's ladder begins. Measured, at 200 t the old expression
discarded 69% of one run's mark.

#13's own fix applies: express the scaling on the ratio, where the clamp cannot
reach it. **One full run of any hull now moves a *tonne* good's price by
`PRICE_ELASTICITY`, and every hull saturates after the same 3.15 runs.**

**Not the sub-tonne goods, and the exception is structural rather than an
oversight.** Gold, Platinum and Gem-Stones bypass the hold check entirely
(research §2.2), so a run of one is Bell's 63 units whatever the ship — and 63
units divided by the hold is a *smaller* mark on a bigger hull. Measured through
`stockResponse`, one full gold run moves the price 31.5% at 8 t and at 20 t,
10.5% at 60 t and 3.2% at 197 t, saturating in 0.4, 1.0, 3.0 and 9.8 runs. That
is the same arithmetic doing the same thing to a quantity that is not a hold:
a big hull leans *less* on the metals per run because it did not have to give up
any hold to carry them. It is also why §12's weak joint 12 finds the round-trip
pump strongest at a *small* hold, and `tests/market.test.ts` pins both halves so
the invariance claim cannot be read wider than it is.

*At the baseline hull's 20 t the new expression is the old one term for term*,
which is why every figure §5.4 was ratified on survives: `MIN_STOCK_RESPONSE_FACTOR`
is 0.685, the closable ratio 1.920, exhaustion in 3 runs, 953 Cr total, a 7.9
Cr/t richest residual — and `scripts/measure-market.ts` prints output identical
to the run before the change, line for line. **What did not survive is the
brake's *shape* across the roster.** Swept at three holds:

| response | hold | saturated factor | closable ratio | runs to exhaust | farm take |
|---|---|---|---|---|---|
| shipped | 20 t | 0.685 | 1.920 | 3 | 953 Cr |
| shipped | 60 t | 0.685 | 1.920 | 3 | 2,859 Cr |
| shipped | 200 t | 0.685 | 1.920 | 3 | 9,531 Cr |
| pre-#182 | 20 t | 0.685 | 1.920 | 3 | 953 Cr |
| pre-#182 | 60 t | 0.685 | 1.920 | **1** | 1,704 Cr |
| pre-#182 | 200 t | 0.685 | 1.920 | **1** | 5,680 Cr |

The steady state is identical on both arms at every hold, because the cap and
the reference scale together; only the transient moves. `measure-hull-pricing.ts`
section B prints it, and both arms run through the same `runsToExhaustion` and
the same `surveyResiduals` — the response is a parameter of each, so the two
cannot be built differently.

**The accumulator's cap is a ratchet.** It is 3.15 of the *writing* hull's hold
and never reduces a mark already larger than that; otherwise selling a
freighter, trading once in a courier and buying the freighter back would launder
a saturated 189 t mark down to 63, which is a brake with an off switch.

**And it never falls below one full shelf (#316).** A draft of this section
clamped the memory at 3.15 holds and nothing else, which is under 63 units for
every hold below the baseline's 20 t — and the shelf reads that memory. At 6 t
the memory saturated at 18.9, the shelf stopped at 44 kg of Gold, and the till
sold it without end, because Gold skips the hold check and the shelf was the
only limit left. The floor is `DEFICIT_MAX`.

**At 20 t and above the floor is never the larger term**, so for those hulls
it changes nothing.

**Below 20 t it moves how long a mark lasts.** A hull that empties a shelf
leaves a mark of 63 rather than 3.15 holds, so its price stays saturated for
log₂(63 / (3.15 × holdT)) half-lives longer — about 35 minutes at 6 t — while
the shelf refills. The floor is symmetric, so a sale moves the same way: the
mark can reach −63, and the sell price stays depressed for as long. The size
of each price step does not move, because the response clamps
`deficit / holdT` on its own.

**A mark read by another hull moves too.** A 6 t hull that empties a shelf now
leaves a mark near 63 rather than 18.9, so a 40 t hull trading there next reads
a ratio of 1.575 rather than 0.47. It is the ratchet above seen from the other
side — a mark belongs to the market, not to the hull that left it.

**A shelf is whole units, floored.** The decay is exponential, so a mark read
between trades is almost never whole, and the console printed
`23.95361409160266 t`. The till reads the same figure, so it is floored rather
than rounded: a shelf of 0.6 shown as 1 is a unit the till would refuse.

**What the two changes do to the measurements.** `measure-market.ts` prints
byte-identical output across them. `measure-hull-pricing.ts` section D — what
the market's memory is worth to the greedy trader, which is §12's weak joint
12 — does not, and the two halves move different rows:

| build | 8 t | 20 t | 60 t | 200 t |
|---|---|---|---|---|
| before #316 | 7.19× | 3.39× | 0.78× | 0.46× |
| cap floor only | 5.61× | 3.39× | | |
| whole-unit shelf only | 7.18× | 3.35× | | |
| both (shipped) | 5.58× | 3.35× | 0.78× | 0.46× |

The cap floor is what moves the small hold: a 63-unit mark saturates the price
on a pump that used to stop at 3.15 holds. The whole-unit shelf moves the rest
by a unit here and there. Both make the pump smaller, and section D reprints
the figures on every run. A first draft of this paragraph said both scripts
were identical; that came from a filtered `diff` that reported identical files
that differ.

**The upper clamp is not decorative.** A deficit reaches −63 when the player
dumps cargo, so `generatedQuantity − deficit` reaches 126 — twice Bell's cap —
and a draft of this spec left the subtraction outside the clamp in both §1 and
here, while §10.1 claimed the cap held everywhere. Selling into an already-full
shelf therefore adds nothing *visible*, which is right: the cap is a shelf, not
an accumulator. The price still falls, because §5's response is what carries the
effect.

Buying thins the shelf and raises the price; selling fattens it and lowers what
it pays. It is Bell's coupling a third time — price and quantity moving opposite
— rather than a new mechanism.

**The scale is the point.** Bell's cap is 63 units and the starting hold is 20 t,
so one purchase takes 30–55% of a station's stock of that good. The *shelf*
clamp stays Bell's 63 whatever the hull, because a shelf is a shelf; it is the
memory that scales. In a
single-player game nothing dilutes that, which is the whole reason the mechanic
is worth having: the player is the only actor, so the effect is legible as
theirs.

### 5.3 Why the response is proportional, not a flat byte

The obvious reading of "the deficit behaves like `product`" is a flat byte
shift: ±1 byte per unit, so a 20 t purchase moves the price 8 Cr. **It breaks
the cheap goods.** Food prices at 2.0–8.0 Cr across the entire economy sweep; a
flat 8 Cr shift for one hold would move it further than the whole
Rich→Poor geography does, and more than double it.

Scaling by the price instead is scale-free and legible at both ends: a full
hold moves any good by **10%**, whatever it costs *and whatever hull is carrying
it* — §5.2's second scale-freedom, and #182's. It applies in
credits, after §3.1's delta, **and is floored the same way**.

That floor is not redundant, though a draft of this spec removed it as though it
were. The ±63 clamp bounds the multiplier at 0.685, which was taken to mean the
result could never fall below one price step — true only above
`0.4 / 0.685` ≈ 0.584 Cr, and the rows §3.1's floor pins at exactly 0.4 Cr are
the population underneath it. `0.4 × 0.685` = 0.274 Cr, below the floor the row
had just been given. The suite now asserts the floor holds for every price the
table can actually produce, rather than asserting the bound that failed to
imply it.

### 5.4 The brake, which is load-bearing

Economy is a *system* property, so within one system all stations share it and
only the type offset separates them — but that offset spans 5 steps, and on
Computers that is `5 × 14 × 0.4` = **28 Cr/t** for a 68 s cruise leg instead of
a hyperspace round trip. If that were repeatable it would collapse the galaxy
into single-system loops.

Measured over 8 worlds and 16,359 docked systems, legal goods only, with
independent fluctuation bytes per station — **7,919 intra-system pairs against
7,780 interstellar pairs**:

| | mean | median | p95 | max |
|---|---|---|---|---|
| intra-system | 15.2 | 11.4 | 28.0 | 28.0 |
| interstellar | 19.0 | 16.0 | 44.8 | 67.2 |

**The interstellar sample is restricted to pairs a ship can reach**: same
galaxy, within `JUMP_RANGE_LY` (7 LY), i.e. one hyperspace jump. An earlier
version of the instrument paired systems *adjacent in generation order* across
every world and galaxy — about 169 samples, no distance check — which is a
baseline no player can fly, and this section's entire conclusion rests on the
comparison. The figures barely moved (interstellar mean 19.3 → 19.0), but the
first version was not evidence for the claim it was supporting.

Interstellar trade wins on every statistic, so the risk is real but weaker than
it first appeared. **And the deficit closes it outright.** The best
shipyard→refinery pair, run repeatedly — with §5.2's decay applied across the
4 minutes each run takes to fly, so the brake is measured against a mark that is
already fading rather than one that only accumulates:

**Searched, not sampled at two convenient bytes.** A draft of this table fixed
the fluctuation bytes at `0x7a`/`0x1c` on one leg and called the result "the
best pair"; the 27.2 Cr/t it reported was purely the Computers type spread at
those constants, identical at every economy. The pair that belongs here is the
richest one the deficit *can* close — the unclosable ones are bounded by the
residual above instead:

| | |
|---|---|
| richest closable pair | Computers, economy 0, shipyard→refinery |
| opening margin | 28.4 Cr/t |
| margins per run | 28.4 → 15.3 → 3.9 |
| runs until unprofitable | **3** |
| total take | 953 Cr |

**The brake does not close every pair, and an earlier draft of this section
claimed it did.** At the ±63 cap the multipliers are 1.315 on the buy side and
0.685 on the sell side, so the deficit drives a pair to zero only if its
sell/buy ratio is below **1.920**. That draft reported a comfortable worst case
of 1.571 — measured buying at a shipyard and selling at a refinery, **one of six
ordered station pairs**. The reverse legs are where the cheap goods sit, and
they are the ones §3.1's floor pins at 0.4 Cr:

| | measured |
|---|---|
| ratio the deficit can close | 1.920 |
| worst legal intra-system ratio | **12.00** — Food at economy 6, refinery→shipyard |
| rows above the closable ratio | 2.32% of 29.8 M |

**The ratio was the wrong metric.** Food reaches a ratio of 12 by being a 0.4 Cr
good; what it pays is 4.4 Cr/t. The question a farmer asks is not whether the
margin reaches exactly zero but what survives at the steady state, and that is
what the spec should bound:

| | measured |
|---|---|
| richest unclosable pair | 43.2 Cr/t — Furs, refinery→shipyard, ratio 1.96 |
| **richest steady-state residual** | **7.9 Cr/t** — Furs at economy 7, refinery→shipyard |
| …per 20 t run | **158 Cr** |

**Compared like with like** — an interstellar route farmed to the same ±63
saturation, rather than a fresh one:

| | Cr/t | per 20 t run |
|---|---|---|
| intra-system, saturated | 7.9 | 158 Cr |
| **interstellar, saturated** | **14.6** | **291 Cr** |
| interstellar, fresh | 67.6 | 1,352 Cr |

An earlier version of this section set the saturated intra-system figure against
a *fresh* interstellar one and then argued the gap away on relative leg times —
which nothing measures, and §12.5 concedes as much. The honest comparison needs
no time argument at all: **the interstellar route wins by 1.85× with both sides
farmed flat, and by 8.6× before either is.**

**The two sides are not swept to the same depth**, and the label should not hide
it. The intra-system figure is exhaustive — every legal good, all six legs, all
256×256 byte pairs. The interstellar one samples: every 64th origin, one
reachable neighbour, five byte pairs, tonne goods only. A sample understates a
maximum, so the interstellar number is a **lower bound** and the true gap is
wider than 1.85×, not narrower — which is the direction that leaves the
conclusion safe. Stated because "like with like" otherwise reads as equal
coverage, which it is not.

**The farm is allowed to exist; it is not allowed to be worth preferring**, and
that is what the suite asserts — a bound on the residual, not on the ratio. A
run-count test alone would have reported "more than four" without ever saying
why.

**The deficit is therefore not tuning — it is the reason the intra-system pair
is safe.** A later reader tempted to simplify it away should read this section
first.

Two scope notes, because drafts of the test got both wrong. **Contraband cannot
run this loop at all.** §4 scopes illegal goods to fences, so shipyard→refinery
is not a transaction that exists for them. Searching for the "best intra-system
pair" without that filter finds Narcotics at a ratio of 59 and concludes the
brake fails — against a route no player can fly. And **all six ordered station
pairs have to be searched**, not the one that happens to be written first.

### 5.5 Determinism, and where state begins

The base market is pure. The deficit is **save state**, and it is the first
world state in seelite that is not derivable from the seed. The map already
permits this — per-galaxy state (visited flags, legal status) is saved
separately — but it is worth naming plainly:

- **Sparse.** Only stations actually traded at get a row; untouched stations
  cost nothing. Inside a galaxy's state envelope, each row is
  `{(systemIndex, localCarrierId) → {goods: {good → units}, updatedAt}}`, where
  `localCarrierId` is the system-local carrier-slot persistence ID. A bare
  `Station.id` is only system-local and is not a save key.
- **Per galaxy**, per the map's constraint that galaxies are a namespace.
- **Decayed lazily** on read from `updatedAt` and the clock, not by a tick.
- **Dropped** when `|deficit| < 1` unit, so the save does not grow without bound
  across a long game.

**Waiting must almost never beat flying** — and the word changed, because the
sim §10.3 required has now been run. `MARKET_PERIOD` 30 min and
`DEFICIT_HALF_LIFE` 20 min are set against a full trade run of 3–5 minutes so
that parking for a re-roll or a recovery is dominated by going somewhere else.

**Measured**, over the 149 decision points where parking until the next epoch
was a profitable option at all — the wait being costed against the *same* menu
of onward hops a launch gets, interstellar included:

| | wait rate / best flight rate |
|---|---|
| median | 0.132× |
| p95 | 0.608× |
| max | **1.492×** |
| points where waiting won | **4 of 149 (2.7%)** |

**Re-derived at #182's constants, and against a control run rather than against
#25's numbers.** The build immediately before this node's change printed **1 of
128 at a 1.132× tail**; after it, 4 of 149 at 1.492×. So #182 makes the exploit
*more frequent and slightly larger*, which is the opposite of what a draft of
this paragraph claimed by comparing against #25's 4.679× — a figure separated
from this one by every node in between, exactly the drift §8 records for the
milestone. The mechanism is §5.2's response reading the flown hold: the trader's
own mark weakens once it buys the Large Cargo Bay, so a market it has been
working is worth waiting on slightly more often.

**The median is not the argument, and a draft of this paragraph made it one.**
An exploiting player selects the tail, not the median, so "waiting is worth 15%
of flying at the median" says nothing about whether waiting-at-the-right-moment
is a strategy.

**Two limits on the sample, both of which cut the same way.** The run stops at
the capital milestone, so every decision point behind the table is a trader
still under 90 minutes and still capital-constrained — the hold-limited late
game, where a hold sitting idle costs least and parking for a re-roll is
therefore cheapest, is never sampled. And the trader is a one-hop rate
maximiser. Neither limit makes waiting look better than it is.

What the measurement does support is narrower. The greedy trader **takes the
single best-rate option at each decision**, so it does take a wait whenever a
wait is the best thing on the table — it did so four times in 149 — and the
56–82 minute milestone §8 quotes already contains those. **That bounds one-hop
waiting and nothing more.** A planner that chained waits across epochs, or held
a hold back for a re-roll it could see coming, is a strategy this sim never
evaluates, and a one-hop rate-maximiser is not a bound on one.

**And it is swept — which strengthened the finding rather than confirming it.**
This document calls the dock-and-market stop "the modelled number that decides",
and a longer stop makes flying worse relative to waiting, exactly the direction
this section argues about. Over all four galaxies, each row a four-run total:

| dock stop | waiting won, 4 runs | rate | best ratio |
|---|---|---|---|
| 15 s | 3 of 139 | 2.2% | 1.69× |
| 30 s | 3 of 133 | 2.3% | 1.62× |
| **45 s** | **4 of 149** | **2.7%** | **1.49×** |
| 60 s | 3 of 141 | 2.1% | 1.47× |
| 90 s | 4 of 144 | 2.8% | 2.28× |

**The rate column is not decoration.** The denominators differ — a run ends at
its own milestone, so it offers its own number of decision points — and raw
counts across different denominators are not comparable. A draft of this table
had counts only and concluded "fewest wins" from them.

**Waiting wins at every dock cost**, at a rate of 2.1–2.8% with no trend across
the five. 45 s — the value everything else here is measured at — sits **second
of five on that rate**, behind 90 s's 2.8%, where before #182 it was the lowest
of the five. So the exploit is not an artefact of that choice and the reported
row is close to the worst of them rather than the flattering one; the honest
reading of a 0.7-point spread over five rows is that the rate does not depend on
the dock cost at all.

**The tail is not monotone in the dock cost, and a draft of this paragraph said
it was.** Read the column: 1.69×, then *down* to 1.62×, 1.49× and 1.47×, then up
to 2.28×. "The tail grows with the dock cost" is a story the table does not tell
— the honest reading is that the phenomenon survives across the whole range and
the worst case is at the long end. Every tail is under 2.3×, and the pre-#182 control's were under
1.7× — so the change lifts the worst case a little rather than the eightfold
drop from #25's 8.31× that a draft of this line credited it with.

An earlier draft swept galaxy 0 alone — the one galaxy that never produces a
winning wait — reported 0 wins at four of the five costs, and concluded the
result "is not an artefact of the 45 s choice" while its own row showed the
outcome flipping between 45 s and 60 s. That was a null result drawn from a
population without the phenomenon.

So the honest statement is: **the exploit exists, is available at about 1% of
decision points, is worth up to 4.7× when it lands, and does not change the
pacing of a trader that takes it greedily.** Whether it changes the pacing of a
trader that *plans* around it is open, and closing it needs a planner rather
than another run of this one. That is a weaker claim than the "never" this
section shipped with, and it is the one the evidence carries.

Changing either constant re-opens the question, and
`scripts/measure-greedy-trader.ts` is now what catches it.

---

### 5.6 The spread: what a station *pays*, and the reversal that came with it

**The law, in the two lines the module runs.** Every market quotes two edges off
the §1 pipeline's figure, and the figure that used to be *the* price is the mid:

```
askCr = midCr
bidCr = max(PRICE_STEP_CR, midCr × (1 − bidCutAtTl(displayTL)))
bidCutAtTl(tl) = BID_CUT_FLOOR
               + BID_CUT_GRADE × (tl − DISPLAY_TL_MIN) / (DISPLAY_TL_MAX − DISPLAY_TL_MIN)
```

Shipped at `BID_CUT_FLOOR` 0.10 and `BID_CUT_GRADE` 0.15: **the cheapest market in
the game cuts a bid exactly 10.0% off the mid and the dearest exactly 25.0%** —
the two endpoints *are* the two constants, which they were not for a round. The
first version of this ladder added 1 to the numerator's offset and divided by the
range plus one, so the rim sat at 0.110 and `BID_CUT_FLOOR` named a cut no market
in the game pays: a constant read as the closure requirement, and the floor of the
whole node, was a figure one tech level away from the cheapest market. `tests/
market.test.ts` §5.6 now asserts the endpoints *equal* the constants rather than
standing above them. `marketQuote`
(`src/market.ts`) is the one implementation, and `stationMarketScreen`, the till
and `scripts/lib/greedy-trader.ts` all price through it, so no arm of any sweep
in §10.2 can be given the wedge on one leg and not another.

**This reverses #7's one-figure transaction law and the reversal is the point, not
a side effect.** §1's pipeline used to end in one number per good and the player
traded against it in both directions; §12's weak joint 12 recorded what that cost.
Read precisely, two things were true of the old law and only one of them is
reversed here:

- **Reversed:** the price a station *pays* was the price it *charged*. It is now a
  different figure, lower, and the difference is a function of the system's tech
  level. This is what #191's D1 ruled and what closes §12's joint for tonnage.
- **Kept:** a transaction is still priced at one figure per unit — a hop buys its
  whole basket at the same number. §7.1 names that as the surviving bias in its
  exponent and it survives unchanged; #196 did not touch the marginal unit inside
  a trade.

**The one-sided form is the cheaper closure, and the claim holds in both quote
modes.** Closing the round trip costs 0.100 of wedge placed on the bid alone,
against 0.053 a side — **0.105 total** — spread across both columns, and the split
form raises what the BUY column charges besides, which #191's D1 declined. The
first version of that comparison gave the two arms different quote precision, which
matters because the survey counts cycles the tenth-credit step alone closes; the
instrument now runs the pair with the step off *both* arms and prints the shipped,
quantized pair beside it. Both read 0.100 against 0.105, so the ruling does not rest
on the rounding — and it would not have been checkable until someone asked.

**The floor is `PRICE_ELASTICITY`, and the number it first shipped as is the
finding of this node.** The obvious derivation is the far end of the response's
range — `PRICE_ELASTICITY × DEFICIT_SATURATION_RUNS` = 0.315 — on the argument
that the cut must exceed the deepest mark §5.2's memory can move a price, since
that is exactly the swing a round trip at one console harvests. The argument is
sound, 0.315 *is* the closure figure, and the ladder below measures the step. **It
is also not shippable.** The §5.6 section of
`scripts/measure-greedy-trader.ts` flies the honest trade loop — a trader that
never visits a console twice, so it is neither the pump nor rigged — against the
cut ladder, and at a mean cut of 0.30 — where the closure lives — that trader
reaches the Combat Engine in **1 of 4 galaxies** inside a four-hour session, in
two more it stops finding a profitable hop at all, and its best rate falls from
291–430 Cr/min to 0–198. A spread that closes the pump by making ordinary trading
unprofitable has not repaired the economy; it has cancelled it, and §8's
time-to-kit goes the wrong way with it. The `flat 0.30` row of the table below is
that rung, printed by the same instrument, at the same width as the rows above it.

So the floor is the mark **a trade can actually leave in ordinary goods**: one
full hold of tonnage, `PRICE_ELASTICITY × (holdT / holdT)`, exact at every hull
because no trade moves the deficit by more than the hold it was made in.

```
bun run scripts/measure-greedy-trader.ts            # §5.6, three sections
```

```
  cut     tonnage cycles open   sub-tonne cycles open   best surviving cycle
  0.090                    48450                  16650   Platinum/courier e0 shipyard TL1 …
  0.100                        0                  15915   Platinum/courier e0 shipyard TL1 …
  0.150                        0                  13905   Platinum/courier e0 shipyard TL1 …
  0.315                        0                      0   —
  shipped                      0                  12073   Platinum/courier e0 shipyard TL1 …
```

98,685 cycles, every dockable hull × every good the table sells × three priced
station types × eight economies × fifteen tech levels × both orders, flown through
`transactAtStation` with a refused leg throwing rather than netting a quiet zero
(`tests/helpers/console-cycle.ts`). **Closed means measured-at-zero, not
smaller-than-before**, which is why the figure is a count of cycles that still
print money and not a maximum. Note the cliff: 48,450 tonnage cycles are open at
0.090 and none survive 0.100, so the floor is not merely *a* cut that helps, it is
the step.

**Two markets the survey above does not visit, and what each one turns out to do.** The
corpus seeds a fresh deficit map per cycle — every realized dock is its own epoch — which
leaves two questions a review round was right to call unmeasured. Both are now measured
through `transactAtStation` on **one shared map**, in `tests/station-commerce.test.ts`:

| the situation | flown | clear | worst |
| --- | --- | --- | --- |
| four chained cycles, mark handed back each cycle — **tonnage** | 4,410 | **0** | — |
| the same over **sub-tonne** goods | 1,080 | **720** | Platinum, shipyard, e 0, TL 1: +4,410.00 Cr over four cycles |
| one cycle on a market already sold into (2 holds thrown first), **every dockable hull** | 188,325 | **6,327** | Luxuries, shipyard, e 0, TL 1, at the 60 t hauler: **+90.00 Cr** |
| the same dump sweep at the flat **0.315** floor | 188,325 | **0** | — |

**Chaining does not reopen the tonnage pump.** A cycle hands the mark straight back — sell
a hold, buy it back, and the station is where it started — so the fourth cycle faces the
same market as the first, and 4,410 of them net nothing. **A dump does.** Sell two holds in
and keep them sold, and the console sits 40 units short of a price; a third hold sold into
that depression is quoted off it, while the buy-back is the same depression with no cut on
it.

**The dump's size is the hull's, and this row was first flown at one hull.** §182 made the
mark scale with the *flown* hold, so the relative depression is hull-invariant and the
profit is not: at the baseline 20 t courier the worst cycle clears **+40.00 Cr**, and at
the 60 t hauler the same sweep clears **+90.00 Cr**. Every dockable hull is therefore in the
domain, and the row is titled with the worst it finds.

**The floor that shuts that door is the flat 0.315 rung, and that arm is flown in the same
walk rather than asserted beside it** — 188,325 legs, **0 clear**. §5.6 already prices that
rung as "closes the pump completely and costs the trade loop", so the price of closing this
residue is known and declined for a stated reason, which makes it a decision rather than a
surprise, and `market.ts` says the closure it claims is closure **at a market the trader has
not already moved**.

**And +90.00 Cr is a residue rather than a living because the dump is not free.** Throwing
two holds away means selling them into a falling market at the depression you are paying to
create; the figures above are the cycle's net alone, which is the narrower and more
favourable reading, and the section states them as that. Against the ordinary loop's
206-399 Cr/min it is small, and against the named 1,064.70 Cr residue above it is the same
family — an exploit that costs cargo to open. What makes it worth a paragraph is that the
constant's sentence was wider than the survey, not that 90 Cr threatens the economy.

**A quote is a whole number of tenths, and that is a law rather than a rendering
choice.** `priceLabel` prints `toFixed(1)`, so while the till charged the
unquantized figure a commander reading `5.3 Cr` was being paid 5.31 — #193's defect
class, arrived at from the other side. So `marketQuote` quantizes *both* columns
through `quantizeToDisplayStepCr` and the till charges the quoted figure;
`tests/station-commerce.test.ts` holds the console's own printed SELL column
against what one unit actually cost the station, at three tech levels. One
consequence is worth having: `stockResponse`'s output is not a multiple of a tenth
(5.6000000000000005), so the quote comes out *tidier* than the mid it was computed
from, and the ask side became exact where it had only been exact after a
subtraction no row should have trusted.

**What that leaves open is the sub-tonne case, and it is reported rather than left
out of the headline.** §5.2's memory counts *units*, so 63 units of Platinum is
0.2 t of cargo and one purchase saturates a hull of 20 t or less — the swing is
the whole 0.315, which is more than any cut the trade loop survives. At the shipped
law **12,073 of 98,685 cycles still net a credit and every one of them is a
metal**; the binding row is 63 units of Platinum at a courier in an e0 shipyard at
TL 1, sell-first, netting **1,064.70 Cr on 4,964 Cr of working capital** — a fifth
of it per cycle, at one console, for a click. The same corpus on #7's one-price law
nets 1,563.79 Cr on that row and is profitable in 99.9% of its rows, so the cut took
a third of the pump and left the pump standing. That residue is #182's weak joint
14 — the metals saturating at a single purchase, which #182's D6 chose to preserve
rather than re-anchor §5.4's calibration on — and the cheap lever on it is the unit
the deficit is counted in, not the spread, because closing it from the spread side
costs the trade loop the ladder above.

**The direction was measured, and the story got half of it right.** #191's D4 left
narrow-at-high-TL against wide-at-high-TL undecided, and #196's brief predicted
that narrow "reinforces a core-ward pull that shipyards already create" while wide
"gives exploring an economic reason but shows a new player the worst rates". Both
arms were flown at **matched mean cut** — a grade of twice the mean, so the two
tables hold the same multiset of cuts in the other order — against a flat spread at
the same mean.

**Matched over the tech-level index, not over where traders actually dock, and that
is a limit on what the pairing can say.** A trader does not visit the ladder evenly:
the control row's own mix is 25/59/16 across TL 1-5/6-10/11-15, weighted to the rim.
The shipped arm is cheap at those rim levels, so the *realized* mean bite its traders
meet is lighter than the opposing arm's at the same declared mean. Part of the gap
below is therefore not direction alone but direction times where the traders went —
which is also what the route-mix reading is measuring, so the two readings are not
independent of each other. What the pairing removes is the level, not the visit mix,
and the direction was chosen on §4's double-charge argument and #191 D1's reading as
well as on these rows:

```
  arm                                      kit affordable     Cr/min   docks by TL 1-5-6-10-11-15   mean radius
  no wedge (control)                       52-82 min          291-430    25/59/16                  0.595
  flat 0.10                                56-92 min          228-351    33/56/11                  0.631
  wide at high TL (shipped) @ 0.000/0.200  47-72 min          309-425    50/42/8                   0.694
  narrow at high TL @ 0.000/0.200          70-96 min          225-308    31/57/13                  0.612
  flat 0.15                                62-93 min          214-318    38/51/11                  0.658
  wide at high TL (shipped) @ 0.000/0.300  47-86 min          235-518    55/36/9                   0.735
  narrow at high TL @ 0.000/0.300          68-119 min         163-286    19/63/18                  0.585
  flat 0.20                                68-88 min          222-289    29/47/24                  0.537
  wide at high TL (shipped) @ 0.000/0.400  50-96 min          200-681    88/12/0                   0.911
  narrow at high TL @ 0.000/0.400          2/4 in cap         8-242      15/39/47                  0.465   stalled 2/4
  flat 0.30                                1/4 in cap         0-198      26/52/22                  0.539   stalled 2/4
  wide at high TL (shipped) @ 0.000/0.600  63-127 min         325-691    93/7/0                    0.922
  narrow at high TL @ 0.000/0.600          1/4 in cap         0-174      1/53/46                   0.509   stalled 2/4
  shipped table                            51-103 min         206-399    42/47/11                  0.676
```

Four galaxies per arm, so the range is four draws and not one sample; the
instrument prints them per galaxy as well, shipped arm first
(`kit by galaxy (wide at high TL (shipped) / narrow at high TL)`), because
a range over four sessions is exactly the figure that hides one stalled session
inside a healthy-looking span. **Each graded row's label carries the two dials it
flies** — floor and grade — because the label used to be a string the caller typed
next to the arm it meant, and three review rounds each caught a variant of those two
arguments disagreeing; now the name comes out of the flag that builds the quote, so
flipping the direction renames the row. The rung each pair is matched at is printed
beside it as a guard — `mean cut of the graded table at this rung` against the target —
and reaches the target to four digits only because the ladder's endpoints sit on
the constants; at the old `+1` offset the graded table's mean was 1/15 of a cut
above the flat arm it was being compared to.

**Say which arm is which before reading the verdicts.** A table that is cheap at the
rim and dear in the core *is* wide at high tech level, and the two phrasings crossed
once in this node's prose — which is why the instrument now names its arms
`wide at high TL (shipped)` and `narrow at high TL` instead of by where they happen
to be thin. Radius is the generator's normalised galactic distance averaged over the
systems a trader docked at, so 0 is the core and 1 the rim.

**#191 D4 made two predictions and only one of them survived.** The route-mix one
held: dear-at-the-rim — narrow-at-high-TL, the arm that did *not* ship — pulls trade
inward, mean dock radius 0.612 → 0.509 as the level rises, with **46% of its docks
landing in the TL 11-15 band at the widest rung**, while the shipped direction pushes
it outward (0.694 → 0.922, 93% of docks in TL 1-5 by the widest rung).

**The other half is a question this node first answered with the wrong experiment.**
D4's worry was that a spread dear at high tech level charges a commander who starts
*somewhere developed* — which in this generator is the **core**, not the rim; an earlier
revision of this section wrote "developed, at the rim" and then tested something else.
The matched-mean sweep cannot reach the question: its graded arms are built at **floor
0**, so their cuts can be matched against a flat arm's, which leaves both of them
charging nothing at the rim — where 50-93% of the shipped arm's docks land. Reporting
that sweep as a refutation was reporting a comparison of two free rims.

**So the instrument flies the pair that does answer it: the shipped law, and the same
two constants with the ends swapped** — `BID_CUT_FLOOR` and `BID_CUT_GRADE`, floor held,
grade held, direction reversed; `MIRRORED_SHIPPED` in `tests/helpers/console-cycle.ts`,
beside `NO_WEDGE` where the repo keeps the rejected laws. Same mean by construction,
same quote step, same four worlds, same trader.

Every row below is flown from a start the instrument names. `run()` used to drop every
arm at the first multi-station system the generator listed, whatever its tech level — so
neither arm flew D4's commander, and a review round said so. `startPolicy` now takes
`first`, `developed` (the system with the highest-tech market in the galaxy) or `rim`.

**At the arbitrary start:**

| arm | kit affordable | Cr/min | docks TL 1-5/6-10/11-15 | mean radius | kit by galaxy |
|---|---|---|---|---|---|
| shipped (wide at high TL) | 51-103 min | 206-399 | 42/47/11 | 0.676 | 98 / 103 / 51 / 63 |
| mirror of the shipped dials | 65-112 min | 176-298 | 34/56/10 | 0.648 | 80 / 112 / 65 / 75 |

**At the developed start, which is the one D4 asked about:**

| arm | kit affordable | Cr/min | docks TL 1-5/6-10/11-15 | mean radius | kit by galaxy |
|---|---|---|---|---|---|
| shipped | 55-100 min | 182-360 | 32/39/29 | 0.412 | 69 / 55 / 69 / 100 |
| mirror | **3/4 in cap** | 167-253 | 20/44/36 | 0.416 | 82 / — / 79 / 87 |

**D4 was right about the level, and the loop claim is now stated at the width the
instrument can hold.** The level is arithmetic, not measurement: **a core market takes
25.0% of a sale under the shipped law against 10.0% under the mirror**, and the rim is the
other way round, so a commander who never leaves a developed world does pay the wider cut
— this spec says that rather than implying the opposite, which an earlier revision did.

**And four galaxies cannot settle a rate, because the drop point moves the rate more than
the law does.** The same shipped arm, same worlds, same clock, from each start rule:

| start | kit affordable | Cr/min | docks TL 1-5/6-10/11-15 | mean radius |
|---|---|---|---|---|
| `first` | 51-103 min | 206-399 | 42/47/11 | 0.676 |
| `developed` | 55-100 min | 182-360 | 32/39/29 | 0.412 |
| `rim` | 67-161 min | 121-298 | 49/46/6 | 0.800 |

The band between those rows is wider than the shipped-versus-mirror gap in either of the
tables above. **So the rate figures are not the evidence.** What survives is the *paired*
ordering — eight draws, four worlds at two starts, kit reached first by the shipped arm in
**6 of 8** (the exceptions: galaxy 0 at the arbitrary start, 98 against 80, and galaxy 3 at
the developed start, 100 against 87) — and one stalled session, the mirror's, at the
developed start. A 6-of-8 sign is not a proof either; it is what four worlds can say, and
the section says that.

**What the direction is actually bought with is §4's own table, not this ordering — and
this is the argument, stated once here and pointed at from §10.3 rather than repeated.** §4
already loads the frontier with price *risk*: a TL 1 market's whole historical range is 3.3×
its base against 1.92× at TL 15, which is why §4 exists as its own section. A spread is the
*other* charge — the price of immediacy, not of movement — and the core, where the range is
narrow and the book is thick, is where a marginal tonne is worth least to the station buying
it. Loading the same markets with both double-charges the one thing they already pay for.
The route mix here is consistent with that (the shipped arm's mean dock radius is 0.676
against the mirror's 0.648 at the arbitrary start), but **the radius also moves 0.412 →
0.800 with the start alone**, so the mix is read as agreement, never as the argument.
**That reversal was the instrument's arithmetic, not the world's.** The first
version of this sweep compared a graded table against a flat one at the same
*floor* and called it matched, which left the two arms' means apart. What fixed it is
the pairing's own arithmetic and not the shipped constants — the graded arms are built
at floor 0 with `grade = 2 × target mean`, so a table walking 0 → 2·mean across the tech
levels holds the flat arm's figure as its mean, in each direction's own order. The
printed guard (`mean cut of the graded table at this rung`, against the target) is there
so the next reader checks the pairing rather than trusts this sentence. A finding that survives becoming
a matched comparison is worth more than one that only survived being run.

**Where the cut dies — and where it does not, which is the half this section first got
wrong.** #13 told this node to check whether an index shift bites where the index lives.
It does not. **The spread is lost at §3's price floor, not at the rim**, and the
measurement is a control rather than an argument: over the whole priced domain a
**flat** cut erases exactly the same rows as the graded one — 8,760 either way — because
every erased row is one whose mid already stands at one price step, where any cut
collides with the floor. Counted per tech level the set is **584 rows at TL 1, 584 at
TL 2, … 584 at TL 15**: flat across the ladder, exactly as flat-cut arithmetic says it
should be. An earlier revision of this section called it "a rim bite, #13's shape", which
was a realized-data artefact — see the control below.

What *is* shaped like #13's finding is the **station-type** axis, over realized rows
across 40 worlds: **0.5% of priced rows come back with no spread at all, 1.9% of a
refinery's against 0.0% at a trade station and 0.0% at a shipyard**. That is the axis
#13's warning was about — a per-type offset dying where the type lives — and it is the
reason an average over station types is the wrong thing to quote.

**And the concentration is §3's own arithmetic, named rather than guessed.** Walking the
domain by good and type, the rows that reach the floor are **Food at the refinery (384),
Slaves at the refinery (168), Narcotics at the shipyard (32)** — nothing else. Food is
gradient −2 and Slaves −5, so `TYPE_OFFSET`'s **+3 at a refinery moves them three
economy-equivalent steps *down***; Narcotics is +13, which the shipyard's −2 pushes down
hard enough to reach the floor at the top of the range. §3's offset and §3's floor are the
same lever read twice: any station type whose offset points the way a gradient runs will
pin some good's rows at one price step, and a cut applied after the floor has nothing left
to cut. A node that widens an offset inherits this table.

**Two populations, and the sentence that conflated them.** Over realized rows the rate
slopes with tech level — 2.5% at TL 1, 0.7% at TL 5, none from TL 8 up — and over the
synthetic domain it does not, because the realized slope is *which markets exist at which
tech level*, not how hard the cut bites there. Both are the same mechanism, and quoting
one as evidence about the other is the error a reviewer caught: `tests/market.test.ts`
§5.6 pins **8,760 of 1,566,720 rows (0.56%)**, `measure-clamp-bite.ts` reprints the
realized rate per tech level and per type, and neither figure says anything about where
on the tech ladder the loss sits.

**What the 8,760 is made of, since it is not the grade.** 8,400 of them are rows §3's
floor pins at one price step outright. The other **360 are the quote step's**: a mid near
the floor whose sell, expressed in tenths, lands back on the ask. Turn the quantization
off and the count is 8,400 under either direction and either endpoint — which is also why
this figure did not move when the ladder's endpoints were rebased onto the constants,
contrary to what an earlier revision of this paragraph claimed.

**And the erasure is not a hole.** On every erased row the round trip nets nothing either,
because the floor that swallows the spread swallows the deficit's mark on the way through
`stockResponse`. `tests/market.test.ts` §5.6 checks that per erased row, at the shipped
quantization, in the sell-first order at the baseline hold — a narrower claim than
"flying the cycle", and stated at its real width.

**Every zero off that floor is attributed, and one category is not a success.** A
previous version of this row counted 74 zeros, called them boundaries, and walked
one of the 74 to prove it. Walking *all* of them — 3,472, since the count itself
was wrong — found three mechanisms instead of one, and `tests/helpers/
console-cycle.ts` now classifies each zero by re-flying it with the tenth-credit
quote step taken off. **2,799 the law closes outright**: the rim, where the cut
equals the mark a full hold leaves, plus the buy-first metals near the core that
wash because a purchase's mark and the cut cancel, `(1 + 0.315) × (1 − 0.239) ≈ 1`
— a mark of the law no comparison of the two leg figures can see, which is how the
first taxonomy lost 279 rows. **392 the law loses and the quote step washes to
nothing**, a wash for the player rather than a leak. And **281 would profit** — by
up to **5.54 Cr** — if the quote were not a whole number of tenths, which means the
precision rule above closes cycles §5.6's cut does not. Trivial against the
1,064.70 Cr the residue row reports, and stated because a closure whose weakest
rung is the number of digits on the glass should be known to have one. The three
categories sum to the count, and a test holds that sum.

**What the player sees, and what the till charges.** The market row carries BUY and
SELL as two columns rather than one price with a cut folded into the arithmetic —
#191's D3, and the reason a probe rather than a unit test owns it. Both render
through `priceLabel` (#193): the ask is a multiple of `PRICE_STEP_CR` and the bid
is not, so a whole-credit rendering of the bid would be a lie the player is
charged against, and `tests/station-console.test.ts` checks both columns print a
fraction. M6's delta arrow rides the ask column, which is the price §5.2's
response actually moved. And the screen and the till are one function called with
one set of arguments: the row that holds that lives in
`tests/station-commerce.test.ts` §5.6, at the console where the deficit and the
printed label are checked beside the credit delta through a float tolerance, which is
the pair #193 was about. It was written in `tests/station-console.test.ts` too, as a
second copy of the same three-tech-level round trip, and one copy was deleted rather
than kept in two files.

The station-console probe prices a row iff the station lists the good, on both
columns now, and prints the spread the glass shows beside the count of rows where the
bid sits under the ask and the count pinned at the price step. **Run it with
`npm run probe:one station-console`.**
What the check line prints is the owner of that spread figure — it is not transcribed
here, because a range quoted in prose is a range that goes stale against a display step,
which is the rounding that produced the figures this paragraph replaced.

**Figures in this section are transcribed output.** Re-derive them with
`bun run scripts/measure-greedy-trader.ts`, `bun run
scripts/measure-clamp-bite.ts`, and the probe above before quoting any of them at a
retune.

**`BID_CUT_GRADE` is a rung on a ladder, transcribed rather than summarized** — floor
held at its shipped 0.10 so the only dial that moves is the rim-to-core difference:

```
  grade  rim → core      kit affordable     Cr/min   docks by TL 1-5/6-10/11-15   mean radius
  0.00   0.100 → 0.100  56-92 min          228-351    33/56/11                  0.631
  0.05   0.100 → 0.150  60-76 min          273-334    40/48/12                  0.684
  0.10   0.100 → 0.200  50-81 min          269-393    36/47/16                  0.641
  0.15   0.100 → 0.250  51-103 min         206-399    42/47/11                  0.676
  0.20   0.100 → 0.300  3/4 in cap         144-312    45/47/9                   0.676   stalled 1/4
  0.25   0.100 → 0.350  69-123 min         161-268    57/41/2                   0.762
```

**0.20 is the first rung that stalls a session (1 of 4) and the first whose kit figure is
not a span: the report prints `3/4 in cap`, which is three galaxies reaching it inside the
four-hour cap and one not reaching it at all** — a range printed over the sessions that
finished would hide which sessions those are, so the count is the claim. 0.15 is the
widest rung that stalls nothing, **not a rung that costs nothing**: against the no-wedge
control's 52-82 min, the shipped 0.15 takes 51-103 and its floor of the rate band is the
worst of any rung above 0.05. The grade is bought, like the direction, against §8's time
to kit; what §5.6 can say is where the next rung stops being a trade-off and starts being
a stall. What would make 0.15 wrong is a change to what a margin is worth, not a retune of
the floor — and the rungs between 0.15 and 0.20 are not flown, so a dial inside that gap
is a claim this table does not cover.

---

## 6. Cargo, credits, and fuel

| | Value | Source |
|---|---|---|
| Starting credits | 100 Cr | Elite |
| Hold | 20 t | Cobra Mk III |
| Large Cargo Bay | +15 t → 35 t | PRXS, 400 Cr |
| Sub-tonne goods | Gold, Platinum, Gem-Stones bypass the hold check | research §2.2 |

The 20 t figure was a **v1 default that the ship-roster node inherited**, not a
decision about hulls, and it is fixed here because §8's pump cannot be computed
without it. Since [#181](https://github.com/jcfischer/seelite/issues/181) it is
derived rather than declared: `HOLD_REFERENCE_T` reads the baseline hull's row
in `src/hull.ts`, and a commander's hold is their own hull's. It stays the
*baseline* hull's on purpose: §5.2's response is scale-free in the flown hold
since #182, so no *per-hull* arithmetic reads it. **Two laws still divide by it
and a future roster change has to know which**: `DEFICIT_SATURATION_RUNS` is
`DEFICIT_MAX / HOLD_REFERENCE_T`, and §7.1's price law is a ratio against the
baseline hull's hold. Renaming which hull is `player-baseline` therefore
re-opens §5.4's brake and §7.1's whole table together, and it is not the priced
ladder's bottom rung either — that is the 8 t interceptor.

The compounding from 100 Cr is faster than the stingy reputation suggests: on
the canonical lane at zero fluctuation — Computers bought at 61.6 Cr and sold at
100.8 — the player is capital-limited for **six runs** and hold-limited from the
seventh. A draft of this section said five and called it arithmetic while
committing none; `runsUntilHoldLimited` derives it now and the suite pins the
six. **The minutes are claimed now, and carefully**: §10.3's sim reaches 400 Cr — the
Large Cargo Bay, §8's first purchase — at **5.8–11.0 minutes** from the opening
100 Cr across four galaxies, against a modelled 45 s dock stop. Not "perfect
play", which a draft said: §10.3's trader is a greedy heuristic with a named
59.7% blind spot and no routing, so it is a *ceiling on a human* rather than an
optimum. And the range is **transcribed script output, not a pinned value** —
§1's rule for every figure in this document, and §12.7's recorded cost of it.
Re-derive it with §10.2's instrument rather than trusting it.
The sim *buys* it later than that, because it keeps an 800 Cr working float
back; that float is a property of the sim, which stops dead without it, and not
of the economy, so affordability is the figure this section is about. A draft
quoted the purchase time, which was time to 1,200 Cr wearing a 400 Cr label, and
a second draft quoted one galaxy's figure as though it were all four.

### 6.1 A correction to `galaxy-generation.md` §8

That spec prices hyperspace fuel at **0.2 Cr / LY**, which makes a full 7 LY
tank 1.4 Cr. Elite's PRXS table charges **0.2 Cr per 0.1 LY** — 2 Cr/LY, and
**14 Cr for a full tank** (research §3.1). The `/0.1` was dropped in
transcription.

seelite takes the PRXS figure, per §7's decision to adopt that table verbatim.
It matters only at the very start, where 14 Cr is 14% of the player's opening
capital and two early jumps are a real cost — which is precisely the early-game
pressure Elite was shaped around. By the time a run pays 700 Cr it is noise
either way. Correcting a transcription under this node's ownership of the
constant is not overturning #6's decision, and the notes at each site say so.

**Three places carried the wrong figure and all three are corrected**:
`galaxy-generation.md` §8's Cost row (with a note there pointing at this
section), its §2 summary table, and `in-system-travel.md`'s hyperspace-fuel
line. Two drafts of this section each claimed a completeness they did not have —
the first recorded the error here only, the second fixed one of the three sites.
A repo-wide grep for `0.2 Cr` is the check, and the only matches left are the
two that quote the error in context.
Recording the error only here — which the first draft did — left a closed spec
still telling its readers a full tank costs 1.4 Cr, which is worse than the
tidiness it was protecting. Fixing a transcription under this node's ownership
of the constant is not overturning #6's decision, and the note says so.

The cruise drive charge is **not** a second fuel cost: #10 makes it a free
refill on docking with passive regeneration. Nothing in the economy prices it.

---

## 7. Equipment and hulls

> **The scanner module's row is here since #364.** `carrier-identity.md` F12
> owns what it buys and why it is a shipyard exclusive rather than an eleventh
> universal item; this section carries only its price, which is the E.C.M.'s.

**Prices are Elite's PRXS table, flat everywhere**, and they live in
`src/market.ts` as data rather than only in the table below — this was the one
number block in the spec with no re-derivation path, which is exactly what §6.1
records the cost of. §8's total is computed from that list, and the suite pins
both.

A note on the source, because two published figure sets exist: these are the
**BBC cassette PRXS** prices as recorded in research §3.1, which also documents
that the *Elite Players Guide* lists others (ECM 500, Beam 750) and adjudicates
in favour of what the cassette code charges. #4 closed on that reading. Tech level and
`station-types.md` §4's type exclusives gate *availability*; they do not shift
price.

| Item | Price | Where |
|---|---|---|
| Fuel | 0.2 Cr / 0.1 LY | universal |
| Missile (max 4) | 30 Cr | universal |
| Large Cargo Bay | 400 Cr | universal |
| Extra Pulse Laser | 400 Cr | universal |
| E.C.M. System | 600 Cr | universal |
| Extra Beam Laser | 1,000 Cr | universal |
| Escape Pod | 1,000 Cr | universal |
| Energy Bomb | 900 Cr | universal |
| Docking Computer | 1,000 Cr | universal |
| Galactic Hyperdrive | 5,000 Cr | universal |
| Fuel Scoops | 525 Cr | **refinery** |
| Mining Laser | 800 Cr | **refinery** |
| Extra Energy Unit | 1,500 Cr | **shipyard** |
| Military Laser | 6,000 Cr | **shipyard** |
| Identity Scanner | 600 Cr | **shipyard** |
| Long-Range Scanner | 1,000 Cr | **shipyard** |

The ten universal items are gated at `min(displayTL + 3, 10)` per
`station-types.md` §4.1. Mining and military lasers are not in Elite's cassette
list — `station-types.md` §4.1 introduced them and left the price here; the
figures are the disc/Master ones research §3.1 cites. The identity scanner is
priced at the E.C.M.'s figure on F12's instruction rather than derived from
anything here, and #481's long-range scanner at 1,000 Cr flat on #468's, which
puts it between that scanner and the Extra Energy Unit. Neither figure is
derived from this section, and the counts of `newToSeelite` rows and of
shipyard exclusives are `tests/market.test.ts`'s rather than this table's —
they were stated here as "the third" and "the third" and went stale the day a
fourth arrived. seelite is therefore on
**cassette economy plus disc laser tiers**, which is what research §6's open
question recommended.

**Type does not discount.** It would need a second pricing mechanism —
equipment has no gradient for §3's delta to multiply — and the exploration
incentive is already carried by availability: shipyards exist only at
`displayTL ≥ 10`, so hulls and military hardware are a core-ward good and the
frontier is where you cannot buy what the frontier requires
(`station-types.md` §4.2). Discounting on top applies the same gradient twice.

### 7.1 Hull prices

[#26](https://github.com/jcfischer/seelite/issues/26) graduated the fog — both
axes, roles horizontally and tiers vertically — and deferred the prices to a
measurement on purpose (D4). [#182](https://github.com/jcfischer/seelite/issues/182)
made it, and [#383](https://github.com/jcfischer/seelite/issues/383) made it again
once §5.6's spread had changed what a hold earns. `src/hull.ts` is where the
figures live, as data, per §1's rule.

**A hull costs what its hold earns back over one kit.**

```
hullPriceCr(holdT) = HULL_PRICE_BASELINE_CR × (holdT / HOLD_REFERENCE_T) ^ HULL_PRICE_EXPONENT
                     up to the knee, then that figure at the knee
                     × (holdT / HULL_PRICE_KNEE_HOLD_T) ^ HULL_PRICE_UPPER_EXPONENT
                     rounded to HULL_PRICE_STEP_CR

HULL_PRICE_BASELINE_CR = 23,000 Cr    HULL_PRICE_EXPONENT = 1
HULL_PRICE_KNEE_HOLD_T = 60 t         HULL_PRICE_UPPER_EXPONENT = 0.52
HULL_PRICE_STEP_CR     = 100 Cr       HULL_CEILING_HOLD_T = 197 t
```

| Hull | Hold | Price | vs the kit |
|---|---|---|---|
| interceptor | 8 t | 9,200 Cr | 0.44× |
| prospector | 12 t | 13,800 Cr | 0.67× |
| **courier** (baseline) | 20 t | **23,000 Cr** | 1.11× |
| tug | 24 t | 27,600 Cr | 1.33× |
| explorer | 30 t | 34,500 Cr | 1.66× |
| miner | 40 t | 46,000 Cr | 2.22× |
| freighter | 60 t | 69,000 Cr | 3.33× |

The kit is `fullKitCr()`, 20,725 Cr. `patrol` (6 t, 6,900 Cr) and `raider` (10 t,
11,500 Cr) are priced by the same law; they sit on the combat ladder at rungs 6
and 7 (#562 D7) and are not sold until #565 and #566 close. The two capitals carry
`priceCr: null`, because 400 t and 200 t are past the ceiling and outside the
range the curve was measured over, and #56 rules they dock at nothing.

**What #383 changed, and why the law has two segments.** #182 fitted one power law,
`hold^0.61`, on an economy with one price per good. §5.6's bid cut takes 10–25% of
every *sale*. The instrument's section J flies the pre-#196 quote law on today's
engine as the control, so the spread is measured alone:

- **The level fell by a third.** At 20 t the spread cuts the rate by 57.7% and
  lengthens the kit window by 60.5% (81.6 min against 50.9); the product, which is
  the baseline, falls by 32.1%.
- **The shape changed too, which #196's hypothesis did not expect.** The cut costs
  a small hold most: an 8 t hold keeps 0.277 of its no-spread rate and a 60 t hold
  0.538 (paired per world, medians). Over the roster's own holds the rate is now
  **linear in the hold** — b 0.996 ± 0.007 on the mean curve, per world
  0.928–1.074 (p10–p90) — where the control reads 0.651. The *mechanism* is not
  measured: the engine does not split income by good, so #182's "the marginal
  tonne is filled with a worse good" is not offered for either arm.
- **Above the freighter's hold the curve bends, and the spread did not cause
  that.** From 60 t to 200 t the rate rises at b 0.517 ± 0.030 (per world
  0.344–0.655), and the control's upper segment reads 0.509. #182's single law
  averaged the two segments; with the lower one straightened, one law misses by
  31.6% at the top of the ladder. Fill falls to 89% at 200 t and 5 of 512 arms end
  early, against none in the control.

So the law is two segments, split at `HULL_PRICE_KNEE_HOLD_T`. **The knee is placed,
not fitted**: it sits at the freighter's 60 t, the largest hold the roster sold
when #383 measured it, so the lower segment is fitted on the holds that existed
(8–60 t) and the upper one on the ladder above them (60–200 t). It is a
constant rather than a rule about the roster: selling a §7.2 rung later does not
move it, and only a re-measured bend does. The local slope is 0.97 over 20–60 t and 0.60 over 60–120 t,
so the bend is within one ladder step of it. The principal chose this law on
2026-09-30 from four candidates, each printed by section J beside the measured
value of every hold (its rate × the window):

| law | worst miss, roster | worst miss, above it | ceiling | rungs |
|---|---|---|---|---|
| two segments (shipped) | +3.1% | +4.4% | 128,000 | 2 |
| one power law, ^0.88 | +13.8% | +41.4% | 172,500 | 3 |
| roster fit carried on, ^1.00 | +3.2% | +86.4% | 226,900 | 3 |
| #182's, 35,000 × ^0.61 | +121.0% | +15.4% | 141,300 | 3 |

**Read the misses as fit, not as prediction.** Each is scored on the same holds
its law was fitted on, so the law with the most parameters is favoured by
construction, and #182's row keeps #182's anchor, so most of its miss is the fall
in level rather than its shape. What the table settles is narrower: one law
cannot fit both ends at once, and the two-segment law does.

**Two digits, and neither is resolved by its fit.** Each exponent is its
segment's pooled fit rounded to two places. What the standard errors cost is
measured rather than argued: moving each segment by its own ±1σ moves the
interceptor 1.1%, the freighter 0.7% and the ceiling 4.4%, and the courier not at
all (it is the anchor). `measure-hull-pricing.ts` prints that band beside the
declared law.

**Where the constants come from.** `scripts/measure-hull-pricing.ts` flies
`scripts/lib/greedy-trader.ts` at sixteen holds over **32 worlds** (4 seeds × 8
galaxies), 2 h per arm, with the hold as the only thing that varies. The baseline
is the measured rate at 20 t times the economy's own progression unit: the
measured time the baseline hull takes to earn `fullKitCr()`, **81.6 min median**
(52.0–176.0) over the same 32 worlds. That gives 23,040 Cr and the constant is the
round 23,000 — rounding a price to a legible figure is what this whole section
does. **The instrument reprints every constant beside what a fresh run derives**,
per the map's #118 rule.

**The control reproduces #182's curve; the window drifted 4.5% and is not traced.** With the spread
removed the full-span fit reads b 0.612, A 114.77 and a per-world median of 0.621
(0.531–0.683) — #182's figures to the printed digit. The one factor that moved is
the kit window, 50.9 min against #182's 48.7, so the control's baseline is 33,914
Cr against #182's derived 34,743. That drift is not the spread's, because the
control has no spread, and it feeds the baseline directly; it is reported rather
than traced, so "no drift" is a claim about the rate curve only.

**Both factors fly the same economy — memory off, no shopping pass — and
differ in one thing, the capital they open with.** That is deliberate and it is
the whole content of the price *level*, so it is stated rather than buried: if
the rate came from the same 100 Cr opening as the window, then rate × window
would be `fullKitCr()` by identity for the baseline hull, every hull would cost
the kit times its hold ratio, and the level would carry no information at all.
What the two regimes give it is a meaning: **what a hull earns for the player
who can afford one, over the span the game calls one kit.** The 1.11× ratio to
the kit is exactly the ratio between those two regimes' rates, and a reader who
takes it as a fact about the economy rather than about that choice is reading
it wrong.

The *shipped* economy is slower than either arm: §8 reports the same milestone
with the deficit and the shopping list in it. So the window is the payback
window of the economy §7.1 prices against, and a reader who wants the figure a
player experiences wants §8's. **Recorded as weak joint 13** rather than argued
away.

**The two arms open with different capital, and that is not one clock counted
twice.** The curve arm opens at `fullKitCr()`; the window arm opens at §6's
100 Cr. The window is a *unit of time* — how long the economy takes to yield one
kit at its own opening pace — so it is measured from the opening, because that
is what the unit means. The curve is a *rate*, and a rate averaged across the
capital-limited opening measures the opening: in #182's run, before the spread,
the 20 t rate ran 474 → 613 → 690 → 736 Cr/min at windows of 1, 2, 4 and 8 h, so
the price level would have carried an instrument parameter that means nothing in
the game. Opening at a hull buyer's own capital removes the transient rather than
averaging over it.

**The trading economy prices the hold and nothing else, and that is a concession
rather than a measurement.** The greedy trader fears no pirate and does not
route, so a hardpoint, a point of integrity, a light year of tank and an AU of
charge were never *varied*: the sweep measured the hold and conceded the rest.
#8's combat balance owns those axes — #183's ladders gate hulls by rung and
price none of them — and this section invents no figure for them — which is why
the interceptor, the hardest-accelerating hull in the game, prices below the
courier.

**Working capital is the one bias that was measured, and it does not move the
lower segment.** The exponent collapses to 0.115 at 500 Cr
— a hold you cannot fill is worth nothing, which is §6's capital-limited opening
said a second way — and has stopped moving by the kit's total. #182 closed the
argument there because the cheapest hull then cost more than the kit. That
stopped being true before #383: the kit grew to 20,725 Cr past the interceptor's
#182 price of 20,000, and #383's prices (9,200 and 13,800) put both sub-kit hulls
well below it. So
[#594](https://github.com/jcfischer/seelite/issues/594) measured the one ratio
the law asserts for those two hulls, `r(h) / r(20 t)` at a single capital, paired
per world against section C's at the kit. It used two arms: a cap on what one hop
may spend, which is a bound because the wallet never grows, and an opening
balance that compounds, which is a pilot who has just bought the hull. **Both arms
are within 1% of the kit from 2,000 Cr up**, at 8 t and at 12 t. Of every route
into a sub-kit hull that the trade-in pays for, the one that leaves a pilot with an
empty wallet the least is the prospector into the interceptor, at 3,220 Cr. From the
courier the figures are 6,900 Cr (prospector) and 11,500 (interceptor). At each of
these capitals both arms' median per-world ratio to the kit is 1.000 or 0.998. **Not
every route in is paid by the trade-in**: the interceptor's trade-in
(8,280 Cr) is less than the prospector's list, so a pilot who makes that step pays
5,520 Cr in cash and can leave the yard with nothing. There the cap arm's bound
does not settle (1.66x the kit at 100 Cr, 8 t), so the route is read on the
pilot's arm alone. That arm is within 1% of the kit from 1,000 Cr, and at a new
game's own 100 Cr opening it drifts 2.5% at 8 t and 0.9% at 12 t. An empty wallet
cannot be flown, because the trader buys nothing and the ratio is undefined. So
100 Cr is the lowest balance measured, and what a pilot holds between that and
nothing is not measured. The world-to-world spread at the kit is 0.328–0.419 at 8 t. **The lower segment does not move**, by
the principal's ruling (2026-09-30). The
lower segment's own ±1σ is not the yardstick for this: it is the fit's error on
*b*, and section C's own 8 t ratio (0.395 against the law's 0.400) sits outside it
at the kit with no cap at all. `measure-hull-pricing.ts` section I reprints the
table and reads the verdict off the sweep. The other known bias is §10.1's
no-slippage rule: a hop buys its whole basket at one price, which flatters a hold
big enough to move the marginal unit. It runs the direction that steepens the
curve, so the fitted exponents are the upper end of what the sweep supports, and
because the law is a ratio against the 20 t baseline, a larger exponent *lowers*
every price under it. Above the baseline these prices are upper bounds; below it
they are lower ones.

**A hull is bought with a trade-in, so its effective cost is `new − 0.9 × old`**
([#556](https://github.com/jcfischer/seelite/issues/556) D5, built by
[#583](https://github.com/jcfischer/seelite/issues/583)). The derivation above
prices a hull as cash paid from earnings and assumes no trade-in; the shipyard
takes the flown hull at `HULL_TRADE_IN_FRACTION` (0.9, `station-commerce.ts`) of
its list price. So the list prices in the table are what a hull is *worth*, and
the step between rungs is what it *costs*: courier to freighter nets 48,300 Cr,
not 69,000, and courier to interceptor pays the pilot 11,500. A swap and back
loses a tenth of each hull, so no loop earns. The payback window above is
therefore an upper bound on a step up the ladder rather than its figure — this
section does not re-derive the window net of the trade-in.

### 7.2 The ceiling, and how many rungs the ladder holds

#26's D7 puts the ceiling where the priced curve stops being interesting.
**Measured, it never does**: §7.1's upper segment bends but is still rising at
b 0.52 to 200 t, and a trader with one kit's capital still fills 89% of a 200 t
hold. So the binding limit is not the economy's, and naming which one it is *is*
the answer rather than a substitute for one.

It is the berth. The largest clear envelope in the game — `BERTH_CELL.trade`, 90
× 58 × 40 m, **208,800 m³**, the maximum over all four station types — against
the roster's own densest hold, the cargo role's **1,059.6 m³ of bounding box per
tonne**. Floored, because a hold that does not fit is not a ceiling, that admits
**197 t** (the quotient is 197.06), priced at **128,000 Cr**. The density is
quoted to a decimal on purpose: rounded to 1,060 the same division floors to 196,
and `tests/helpers/hull-math.ts` derives it from the envelope rather than from
either printed figure. It is an upper bound in
the safe direction: it assumes a hull could be a solid box at the best density
measured, and #26's constraint that beam and height are nearly spent means growth
is in length, the cheapest axis of the three. `HULL_CEILING_HOLD_T` is declared
in `src/hull.ts` — a leaf that imports nothing — and `tests/hull.test.ts`
re-derives it from the berth catalogue, then pins it from both sides: a hull
stretched to 197 t at the cargo role's density fits a trade berth and one at
198 t does not.

**The rung count is an output.** The priced roster's own adjacent price steps are
1.50×, 1.67×, 1.20×, 1.25×, 1.33×, 1.50× — a typical (median) step of **1.42×**
and a widest of **1.67×**. A gap is an interval wider than **one typical step
squared, 2.01×**: room for a rung at the ladder's own spacing. That threshold is
not the maximum of the steps, which nothing could exceed — a draft used the
maximum and reported "no interior gap" on any roster whatever, which is a check
derived from its own subject. By the real criterion the priced roster has **no
interior gap**, and the one gap is above it: 69,000 Cr to the ceiling's 128,000
is 1.86×, which holds **two steps of at most the roster's widest 1.67×** — so
**two new rungs**, and the typical step gives two as well:

| rung | hold | price |
|---|---|---|
| 1 | 109 t | 94,100 Cr |
| 2 | 197 t | 128,000 Cr — the ceiling |

#182 derived three rungs here. #383's law moved the count and nobody edited it:
the roster's steps widened as the lower segment straightened, and the gap above
narrowed as the upper one bent.

**Two is derived, not chosen — but the rule that derives it was chosen, and
saying otherwise would be the tautology this section already corrected once.**
What is measured is the two endpoints and the roster's own step distribution;
what is a decision is dividing by the *widest* step rather than the typical one,
and spacing the holds evenly in the log. A retune of the curve or of the berth
cell moves the count without anybody editing a number, which is the property that
matters; a different spacing rule would move it too. **What the hulls at those
rungs look like is not this section's** — #26 puts drawing them out of scope and
#130 is open on ship detail the existing roster already lacks.

---

## 8. The progression pump

A full 20 t hold on the canonical lane is ~700 Cr per run at 3–5 minutes. The
Large Cargo Bay is the first purchase and lifts that to ~1,225 Cr.

The fourteen items above total **20,725 Cr** — 20,845 with a full missile rack.
Both are `fullKitCr()`, derived from the price list rather than added up in
prose, and asserted. **Two rows have arrived since the measurements below were
taken**: #364's identity scanner at 600 Cr and #481's long-range scanner at
1,000, so the kit has moved 1,600 Cr — 8.4% — against figures measured at
19,125. Every "earns the kit's price in N minutes" below is short by that.
That is about fifteen clean runs, and the design was aiming at **1.5–2.5 hours**
of trading once §5.2's deficit forces route rotation.

**Measured, the pump is faster than the aim.** §10.3's greedy trader earns the
kit's whole price in **56–82 minutes** across four galaxies, at 233–363
Cr/min — a run taken before either scanner row landed, so it is 8.4% short of
the kit it is being quoted against. `scripts/measure-greedy-trader.ts` reprints the
range on the machine it is run on, and this section's habit of quoting a stale
one is what §12.7 records the cost of. All four land under the target's lower bound of 90 minutes — **on figures
measured against a kit 8.4% cheaper than the one that now ships**. Scaled by
that ratio the top of the range is about 89 minutes, which is arithmetic and
not a run: it assumes the trader's Cr/min holds over the extra 1,600 Cr, and
no spread is quoted for it. So the margin the conclusion rests on is somewhere
around a minute rather than eight, and the honest form is that **the
conclusion is no longer established by the measurement behind it** —
`scripts/measure-greedy-trader.ts` is what would settle it. So the
1.5–2.5 h figure survives only as a claim about a *human*: it needs a real
player to run at roughly 0.7× the ceiling. That is plausible and unmeasured, and
it is the honest form of the sentence.

**The figure moved twice since #25 reported 48–85 min, and only one of the two
is a decision.** Re-run immediately before
[#182](https://github.com/jcfischer/seelite/issues/182)'s change it printed
**44–66 min at 290–450 Cr/min** — drift from nodes between #25 and #182 that
nobody re-ran the instrument after, which is exactly the cost §12.7 records.
#182's own change accounts for the rest: §5.2's response reads the *flown* hold,
so once the trader buys the Large Cargo Bay the market's memory of it weakens by
20/35, and a trader that was partly farming its own mark (weak joint 12) earns
less. Both figures are on this page because a range quoted without saying which
build it came from is how the first one went stale.

**What is measured is the capital, not the shopping.** Buying the list also
means standing at a refinery and at a shipyard for the four exclusives
(`station-types.md` §4.1), and the sim does not route — §10.3 says why the two
are reported apart. The travel that the exclusives force is real time this
figure does not contain, and it pushes the true number **up**, toward the
target rather than away from it.

**Half the clock is a modelled constant**, so the figure is a claim about that
too. The dock-and-market stop is 45 s in the sim and is specified nowhere — #9
sets docking tolerances, not a duration. Swept over all four galaxies, the
milestone runs **40–53 min at 15 s and 81–114 min at 90 s**. A reader who thinks
90 s is the right stop should read this section as met rather than beaten.

---

## 9. Death economics

**The escape pod is death insurance at 1,000 Cr**, Elite's price and Elite's
semantics: you eject, you lose the entire hold, you keep the hull and everything
fitted to it, and you resume at the last station you docked at.

#660 settled the rest (2026-10-05). A death keeps the world (#654), and the
commander it starts from is the one that **launched** from that station, not
the one that arrived: what was bought there, the pod included, is aboard when
the death happens. That is the baseline, and a death's cost is then taken from
it — the hold and the pod with a pod (below), the whole ship without one. The pod is **manual
only**, as in Elite: it works if the pilot ejects before the hull reaches zero,
at any time in flight except docked or on an arrival or launch's rails, and it
is **consumed**. A job's entrusted goods are lost with the hold and the job
fails with no debt. A pilot with a pod fitted is warned on the glass when the
hull falls below a threshold derived, once and for the whole roster, from the
most hull damage any hostile's weapon can land in about one second of the
pilot's reaction — so the warning cannot come after the last hit. #704 derived
it (`EJECT_WARNING_HULL` in `death-cost.ts`): every hostile today fires the one
pulse laser at 6 hull points a second with its shields down, over a second of
reaction, the 0.75 s eject hold and two longest frames — the game reads the line
before a frame's hits land, so a crossing is seen a frame late, and a press
between frames waits for the next — plus the half point the kill tolerance
rounds away: **12.2 hull points**, the same on every hull, because what kills is
the gun's rate and not the hull's size. One frame was not enough; a headless row
flies the game's order and loses a ship with it. It is written against the
strongest *weapon*: two hostiles firing at once land twice the rate, and the
warning can then come late. The glass names the key as bound, keyboard first as
every prompt does; the voice line names it only while it is the default
Backspace, since a rebound key may be a word the voice has none for, and a pilot
flying from the pad hears the keyboard's key as the glass shows it.

One consequence is recorded because #8 has to reckon with it: **ejecting dumps
contraband**, which makes the pod a panic-button disposal route ahead of a
shipyard scan. Whether that is a legitimate tactic or wants a cost is #8's, not
this spec's.

**Without a pod, or without ejecting, the pilot loses the ship** (#660 D6): the
hull, every fitting and the hold. They wake at the station they launched from in
a stock courier with a full tank, and keep the credits they launched with. The
intent is that this cannot strand a save: a courier is always left, and #356's
courier floor entrusts its goods to a pilot with no credits. A Wanted or
Fugitive pilot keeps their heat through a death (#654), and #704 checked what
that leaves them (`tests/death-cost.test.ts`). **Work holds**: Courier and
Procurement read no standing, so the floor is open to them; only a Bounty asks
for Clean. **A berth holds, with one exception, and the exception is bounded.**
A launch station that refuses them by law — a shipyard on standing alone, or a
trade station or refinery that heard the offence — refuses the docked restore's
clearance too, so they wake in flight beside it rather than in its berth. From
there a trade station or refinery that did not hear it admits them, and a stock
courier wakes with a full tank and charge to reach one, in this system or the
next. The worst case is every station in reach having heard: then the refusal
lasts until heat decays below Wanted, at most about **100 minutes** of game
clock from the cap (`HEAT_HALF_LIFE_S × log₂(HEAT_CAP / WANTED_HEAT)`). That is
the one place the floor bends, and it bends to a wait, never to a stranded
save. A pilot who dies before their first dock wakes
docked at the start system's trade station as a new commander (D10). Ladder
rungs and banked ladder credit are never touched (#183).

**A permadeath commander who ejects ends the save**, as any death of theirs
does: the store restores nothing for them (#89 D7), so the pod buys them
nothing. Whether it should is permadeath's question, and #238's, not this
section's.

The pilot wakes to a notice of what the death took — the hold and the pod, or
the ship, its fittings and the hold, and how many jobs failed with it — on the
docked console's message line and the Communications log (#704). The First day
tab teaches the eject key from the first pod purchase (D9).

An eject is a death with a pod here, and both will leave a **wreck** at that
point holding a seeded share of what was lost — cargo and fittings after a death
without a pod, cargo only after an eject — never the hull, the pod
or entrusted goods. Recovering it is salvage's verb, so it waits on #466.
Permadeath is a separate arm and is #238's.

---

## 10. Verification obligations

All headless `bun` — none of §1–§9 may require a browser, per #7's own framing.

### 10.1 Suite — `market.test.ts` 51, `market-state.test.ts` 16, `deficits.test.ts` 15

`market.test.ts` owns §2–§4 and §6–§7 — the arithmetic, swept over its whole
domain — and is listed below. §5's two properties are not about a formula and
live apart; §10.3 lists them and says which file each is in.

**The counts are measured, and one of them was already wrong.** This heading
read "`market-state.test.ts` 24" while the file ran 28 —
`bun test tests/market-state.test.ts` at the commit before
[#67](https://github.com/jcfischer/seelite/issues/67). A count in prose is a
claim like any other; these three were read off a run. **The first of them was
stale again before this node arrived** — the file ran 42 on `main` while this
heading said 38 — and #196 takes it to **51**, nine rows in §5.6: the two dials
re-derived from the response rather than quoted, the swing the floor does not
reach, the domain's two ends, the ask's identity, the erased rows flown for a
pump, and the quote's own precision. **The heading said 53 and eleven for a round**,
because two of those rows restated assertions the rows before them already made and were
merged in review — a count transcribed from intent rather than from a run is the drift
this paragraph is about, one file and one node later. **The counts below were counted off
`git show`, not remembered:** `market.test.ts` gained 9 rows (42 → 51),
`station-commerce.test.ts` 11 (13 → 24), `station-console.test.ts` 3 (21 → 24), and
`live-cockpit.test.ts` 1 (1 → 2) — the row-arity check §5.6's CSS comment cites. §10.3 says
what they are for. The arithmetic is stated because this heading got it wrong twice: once
eleven where the file gained nine, and once a set of three totals transcribed from intent
after the residue rows grew. A count that does not add up is the same third-copy drift in a
new place, and the fix each time was to run the count rather than recall it.

1. **Table integrity** — 17 goods; `baseQuantity` signed for all five negative
   rows; exactly three illegal; the sub-tonne set is Gold/Platinum/Gem-Stones
   and disjoint from the illegal set; Alien Items never stock.
2. **Lane direction, every good** — negative gradient ⇒ cheaper *and* no
   scarcer at Poor Agricultural; positive gradient ⇒ the mirror. Asserted over
   the table, not over two named goods.
3. **Overflow** — no good in the shipped table *overflows* the byte anywhere in
   the domain, illegal ones included. Not "reaches a byte end": **Computers sits
   exactly on 255** at economy 7, which the suite pins, and §12 weak joint 2
   records that the guard's margin is one point rather than comfortable. The
   retuned Narcotics row cannot overflow by construction; **Bell's own row
   does**, on >90% of rows, so the divergence's justification is runnable rather
   than prose.
4. **Contraband viability** — the retuned row clears 75 Cr/t and stocks at >50%
   of rows; Bell's row under the clamp falls below 10 Cr/t; Narcotics out-earns
   the best legal good.
5. **The type offset** — the *unfloored* delta equals `typeOffset × gradient ×
   0.4` exactly at every point in the domain; the floor fires on <1% of the rows
   it can reach and never at a trade station; quantity is never *below* the
   trade station's; all three illegal goods still stock at a refinery; the
   63-unit cap holds **after the deficit as well as before it** — §1 put the
   subtraction outside the clamp, so dumping a hold yielded a 126-unit shelf that
   no test could observe, `marketRow` taking no deficit.
6. **The quantity clamp's divergence from Bell** — the set of goods that read
   differently from `& 0x3F` is pinned at exactly {Furs, Gold, Narcotics,
   Platinum}, and Gold's permanent cap is asserted against Bell's under-20
   reading, so §2.2's recorded divergence cannot drift from the real one.
7. **`wrap` is Bell on both bytes** — quantity included, so no measurement
   labelled "Bell" is silently using seelite's shelf.
8. **The market epoch** — advances once per `MARKET_PERIOD_MIN`, and a phase
   offset shifts the boundary, which is §5.1's only executable claim.
9. **The deficit** — proportional at 7, 61 and 100 Cr; saturates at ±63 rather
   than running away; halves over one half-life; **never prices any good the
   table can produce below one price step**; **the best legal intra-system pair
   — searched across goods, economies and independent fluctuation-byte pairs —
   is exhausted within four runs**, with decay applied across the minutes each
   run takes to fly. Both searches cover **all six ordered station legs**; an
   earlier draft searched only shipyard→refinery, and §5.4's richest residual
   sits on the excluded direction. The exhaustion claim is deliberately
   conditional — a pair above the closable ratio never reaches zero — and the
   companion assertion bounds what those keep paying: **no intra-system pair
   leaves more than 10 Cr/t once both deficits saturate**, and no run leaves more
   than 200 Cr — **each bound asserted on the pair that maximises it**, which
   are different pairs: run value scales by 63 for sub-tonne goods and 20 for
   tonne goods, so a single argmax cannot guard both.
10. **The spread** — §5.6. The floor is `PRICE_ELASTICITY` recomputed from
    `stockResponse` rather than quoted; the swing it does *not* reach is named and
    bounded, so the residue is a fact the suite notices changing; the cut is
    monotone in tech level with both endpoints derived from the two constants; the
    generator neither leaves the table's domain nor fails to reach both its ends;
    the ask is the mid for every good in the domain; the bid never falls under one
    price step, and **on the rows where §3's floor already pins the mid there is no
    pump either** — flown on every one of the 1,566,720 cells and netting nothing
    where the cut was erased. Plus the till's half: the six cycles §12 joint 12 was
    written against, priced through `transactAtStation` and asserted as a formula
    rather than a transcribed balance.

### 10.2 Instruments (`scripts/measure-market.ts`, `scripts/measure-hull-pricing.ts`)

Committed so every number in this document can be re-derived rather than
trusted, in the discipline `scripts/measure-clamp-bite.ts` established:

```
bun run scripts/measure-market.ts [worldCount]     # default 8 worlds
```

**`tsconfig.json` now includes `scripts/`.** It did not, so `npx tsc --noEmit`
— one of the repo's four gates — never looked at the instrument. Two bugs shipped
through that hole during this node's review: a rename left `marketRow` reading a
*function*, printing NaN across every row while the suite stayed green, and a
dropped import produced a `ReferenceError` at load. Closing it also surfaced a
pre-existing break in `scripts/measure-rejection-bias.ts`, which imported `Vec3`
and `lengthSq` from `src/sim.ts` — where neither is exported — and so could
never have run. Fixed here because this node moved the gate.

Reports per-good overflow rates and price spans under both arithmetics —
including **Bell's own Narcotics row**, so §2.2's 97.66% and §2.3's whole table
come from committed code rather than from prose; the floor's firing rate at both
denominators; intra-system vs interstellar margins over the real generator; and
runs to exhaustion on the best intra-system pair.

Every figure is computed through `src/market.ts`. Nothing here re-implements
the price pipeline — an earlier version did, and its floor rate was therefore a
second measurement that could drift from `TYPE_OFFSET` without failing anything.

**§7.1 and §7.2 have their own instrument**, added by #182:

```
bun run scripts/measure-hull-pricing.ts [hours]     # default 2 h per arm
```

Ten sections: the clamp bite that §5.2's change answers, the D6 sweep of the
hold multiplier against §5.4's brake, the hold curve and its fit, what §5.2's
memory is worth to a greedy trader, the payback window, the priced roster, the
ceiling, the rung count, where the measurement is still biased, and (#383) the
spread's own effect against a no-wedge control arm with every candidate law
judged against the measured value of each hold. It flies
`scripts/lib/greedy-trader.ts` — **the same engine `measure-greedy-trader.ts`
reports §5.5 and §8 from**, which is what makes the arms of a hold sweep
incapable of being built differently. §10.3's three riggings were all that one
shape.

**§5.6 lives in the two instruments above rather than in a third.**
`measure-greedy-trader.ts` gained three sections — the closure ladder, the
one-sided-against-split cost of closure, and the direction sweep — and
`measure-clamp-bite.ts` gained the cut's own bite, per tech level and per
station type. One engine flies the ladder and the direction, because #25's three
riggings were all one shape and a two-arm comparison built from a second engine
can differ in more than the arm it is named for. Two guards sit inside the
report rather than in prose beside it: the arms it flies are checked against
`marketQuote` at every tech level before any row prints — a report whose
"shipped" row had quietly become a re-implementation would otherwise print
confident numbers about a spread the game does not have, and it said exactly
that on its first run — and a session that stops hunting is labelled `stalled`
instead of folding into a small hop count, because a route mix drawn from a
halted trader is a claim about a halt. The console-cycle corpus itself is
`tests/helpers/console-cycle.ts`, imported by the report, so the figure this
spec quotes and the figure `tests/station-commerce.test.ts` asserts are the same
flight rather than two implementations of "sell a hold, buy it back".

**What is gated and what is run by hand**, per the map's #28 rule that the split
be said rather than discovered. `npm test` gates §5.2's hold-invariance and the
sub-tonne boundary it does *not* cover, the accumulator's ratchet, every roster
row against `hullPriceCr`, §7.1's and §7.2's published tables row by row against
the same law, the ceiling re-derived from the berth catalogue and pinned from
both sides, that no priced hull sits above it, and that the flown hold reaches
the market screen. Run by hand: the 32-world curve, its fit, the payback window,
the memory arm, the capital sweep, and the rung count derived from them — about
**3,000 two-hour flights**, a minute or so of wall clock, which is not a suite's
work.

### 10.3 Owed by the implement node — delivered, and what it found

All three landed in #25. Each is named here with the result rather than the
obligation, because two of them **moved a claim in this document**.

**The greedy-trader sim** — `scripts/measure-greedy-trader.ts`,
`bun run scripts/measure-greedy-trader.ts [hours] [seed]`. It flies a trader
against the real generator: every in-system leg is `cruise.ts`'s `legSeconds`
over `placeBodies` at the current clock, so an arrival 0.2 AU out and one 3 AU
out cost what they cost. Hyperspace wind-up (15 s) and the dock-and-market stop
(45 s) are the only modelled numbers, and the second is **swept** rather than
conceded, because it is paid on every hop and is half the clock.

It is a **ceiling, not a player**: it fears no pirate, never misjudges a docking,
and takes the best-rated option every time. It does **not** see every price it
can reach — the neighbour list is truncated at eight, which bit on 59.7% of
neighbour lookups — and an earlier draft of this line said it did. A target is falsified by a ceiling that is
too slow and merely unproven by one that is too fast.

| | measured, world `0x5ee11e`, four galaxies |
|---|---|
| capital covers the full kit | **56–82 min** against §8's 1.5–2.5 h |
| Cr/min | 233–363 |
| hops chosen: interstellar : intra-system | 118 : 27 — **not evidence, see below** |
| dock cost 15→90 s, all four | 40–53 → 81–114 min |

Re-derived at #182's constants; §8 records what moved and why, and the figures
#25 reported are on that page beside these.

**The figure is the capital milestone, not a fit-out, and the distinction was
forced by a review finding.** An earlier version bought equipment wherever the
trader happened to be docked, ignoring `station-types.md` §4 entirely — so it
handed over the shipyard's military laser at a trade station, which is exactly
what §4.1's exclusives exist to make you travel for. With scope and the
`min(displayTL + 3, 10)` gate enforced, *buying* everything needs the trader to
stand at a refinery and at a shipyard, and **this trader does not route**: it
maximises credits per minute and docks wherever that leads. A completion time
from it would measure luck as much as economy. What it can measure honestly is
the pump — how long the economy takes to yield `fullKitCr()` — and that is what
the table reports. §8's "about fifteen clean runs" is a claim about the pump, so
they are the same question.

Every row spans all four galaxies. A draft swept the dock cost over galaxy 0
alone and quoted §6's first-purchase time from the same single column; both are
four-galaxy figures now, because a one-galaxy number set beside a four-galaxy
range reads as the same kind of claim and is not.

**The hop ratio is not evidence for §5.4, and a draft of this section offered it
as such.** `intraOptions` enumerates the one or two other stations in the current
system; `jumpOptions` enumerates eight systems and all their stations. A
rate-maximising pick over pools an order of magnitude apart returns jumps by
construction, so 121 : 20 says something about the option sets and nothing about
the economy. §5.4's conclusion rests on the margin measurements in that section,
which compare like with like; the row is kept only so the trader's behaviour is
on the page.

**The neighbour list is truncated at eight**, and that bit on **59.7% of
neighbour lookups** (178 of 298) — so the trader does not see every price in
range, which the instrument's header claimed until it was counted. Lookups
rather than decisions: `jumpOptions` runs twice per decision point, once for the
launch and once inside the wait branch, so a denominator called "decisions" was
double what a reader would count.

**What that blindness costs is measured, not left as a caveat.** Run again at
sixteen: the milestone goes **56–82 min to 45–87 min**. The fast end improves by
a fifth and **the slow end gets worse, 82 to 87 min**, which is the direction
this paragraph used to wave away — a wider option set is not monotonically
better for a one-hop rate maximiser, because the best-rated hop it can now see
may lead somewhere the next decision is poorer from. So the eight-neighbour
limit loosens the ceiling on the fast galaxies and tightens it on the slowest,
and §8's "beaten by the pump" conclusion rests on the four-galaxy *range* rather
than on the claim that a fuller option set is uniformly faster.

**The §5.5 comparison was wrong twice before it was right, and both faults
flattered the same side.**

1. **Both ends of a trade are quoted at the clock each happens on**; the first
   version quoted both at departure. That is not a rounding error — a leg runs
   into the tens of minutes against a 30-minute `MARKET_PERIOD`, so every flight
   was booked at prices from before it was flown while the wait option, priced
   at the epoch it waits for by construction, got the future it was asking
   about.
2. **The wait gets the same menu the flight does**; the second version built its
   post-wait candidates from the current system's other stations only. The
   trader takes an interstellar hop three times in four, so the waiting strategy
   was being denied the move it would actually make — and in a single-station
   system the wait offered nothing, so those decision points went unrecorded
   rather than counting.

Each fix moved every figure in this table. The measured tail of waiting went
1.326× → 1.785× → **4.679×** as the comparison stopped being rigged, which is
the shape of a number that was an artefact of its instrument. Those three are
#25's history and stay as written; §5.5's current figures are re-derived at
#182's constants and are smaller again.

**Re-run it whenever `MARKET_PERIOD`, `DEFICIT_HALF_LIFE` or `PRICE_ELASTICITY`
moves.** All three are in the loop, and §12.5 is explicit that changing either
of the first two re-opens the exploit with nothing else to catch it.

**The determinism tests** — `tests/market-state.test.ts`, 16 tests. §5.1: the
byte is fixed by `(stationSeed, epoch)`, every good is identical across a whole
epoch, the market re-rolls on the boundary for >95% of the corpus's 117
stations, phase staggers the stations of one system, and two stations in one
system draw unrelated bytes. §2's persistence-identity table is here too,
because it is about the key a *generated* station carries.

**The save round-trip tests** — `tests/deficits.test.ts`, 15 tests. §5.5: lazy
decay on read with nothing written, saturation at ±63, the drop-below-one-unit
rule, a JSON round trip over a 61-row map, and a malformed save that throws
rather than reading as an untouched healthy carrier. They were in
`market-state.test.ts` until #67 moved §5.5's map to `src/deficits.ts` and they
followed it unchanged; the last three of the fifteen are that node's own
structural checks and belong to it rather than to §5.5.

**Three of those tests were written, found unfalsifiable, and replaced** — one
caught here, two in review — which is worth recording because each replacement
is a different *kind* of check from the one it replaced.

A permutation test claimed to prove the market is independent of draw order
while keying both sides on `localCarrierId` — the thing under test. What carries
that claim now is a source scan: nothing in `system.ts` or `galaxy.ts` reaches
`DOMAIN.MARKET`, so the generator does not open the market stream and no market
is a function of how many stations preceded it. A value-comparing test cannot
see that difference, because a market drawn in station order still produces a
plausible byte. **What the scan proves is bounded** — it catches a direct
reference and an indexed one, and a tag destructured under another name or a
fourth file would pass. It is evidence, not a proof of impossibility, and the
test says so where it stands.

A fixity check re-called `stationFluct` with the same arguments and expected the
same answer, which cannot go red for any implementation of a pure function. It
is a *coverage* check now: 5,120 draws must reach more than 250 of the 256 byte
values, which a hash returning `x & 0x0f` fails and a fixity check does not.

And a test titled "adding it moved no other stream" asserted only that the tags
are distinct and that `MARKET` is the largest — which a build that renumbered
`POS` from 1 to 11 passes. The whole table is pinned now, because every seed in
the game is a function of those integers and renumbering one moves every
position, name and station silently.

**#196 delivered §5.6, and what it went looking for came back three times: once
wrong, once answering a question that was not asked, and once as an answer.** The brief
predicted that dear-at-the-rim would reinforce a core-ward pull, and that a spread dear
at high tech level would charge a commander who starts somewhere developed the worst
rates in the game. The route-mix prediction is there in the sweep (§10.3): the arm that
did not ship pulls trade inward as its level rises, 0.612 → 0.509 mean dock radius,
while the shipped arm pushes outward to 0.922.

**The second prediction was first reported as refuted on an experiment that cannot reach
it.** The matched-mean arms sit at floor 0, so both charge nothing at the rim — where
50-93% of the shipped arm's docks land — and D4's question is about the developed (core)
end. A node reported that as the concern not holding, and it was reporting two free rims.
**What reaches the question is the pair at the shipped dials** (`MIRRORED_SHIPPED`: same
floor, same grade, ends swapped), flown from **both** an arbitrary start and the galaxy's
highest-tech market, and what it says is that **D4 was right about the level, and the loop
claim is weaker than this section first wrote it**. The level is arithmetic — a core market
takes **25.0%** of a sale under the shipped law against **10.0%** under the mirror, so a
commander who stays in developed space does pay the wider cut, and §5.6's summary does not
get to imply otherwise. The loop is a measurement, and four galaxies bound it: the same
shipped arm's rate band moves **206-399 → 182-360 → 121-298 Cr/min** across the three start
rules alone, a wider swing than either arm's gap, so the **rates are not the evidence**.
What is left is the paired ordering — the shipped arm reaches the kit first in **6 of the 8
draws** (four worlds, two starts), with one stalled session on the mirror's side — which is
what four worlds can say and no more. **The direction is bought with §4's double-charge
argument and a real 25%-at-the-core cost, not with a rate claim.**

**But the first run of that sweep reported the opposite on the rate half**, and the
reason was in the instrument rather than the world: the two graded arms were
compared against a flat control at the same *floor* and called matched, while their
means sat 1/15 of a grade apart — sage caught that on review, and the fix moved the
ladder's endpoints onto `BID_CUT_FLOOR` and `BID_CUT_GRADE`, which makes a graded
table's mean equal the flat arm's figure by construction. The sweep prints the mean
it reached beside every rung now, so the pairing is checkable off the output rather
than trusted from this paragraph. What survives becoming a matched comparison is
worth more than what only survived being run, and the direction ruling rests on the
matched figure.

The other finding is the one this node was told to report rather than resolve.
The closure figure that follows from §5.2's range — 0.315 — closes the pump and
takes the honest trade loop with it (`flat 0.30`: 1 of 4 galaxies reaches the kit,
2 of 4 stall), so the shipped floor sits at the mark one hold of *tonnage*
leaves and the metals cycle stays open at 1,064.70 Cr a run. Every correction
during the work moved in one direction — a deeper floor closes more pump and
pays for it in loop — which is #25's tell that the axis being swept is the wrong
one. The lever that does not trade those two against each other is the unit §5.2
counts a deficit in, and §11 hands that to a node rather than pretending §5.6
settled it.

---

## 11. What this obliges of other nodes

- **#8 (combat)** — owns legal status, scans, police, and the consequences of
  carrying contraband; owes a ruling on the escape-pod dump (§9). Alien Items
  (§2.4) have no source until combat scooping exists.
- **#9 (docking)** — nothing. Market state is read at the station, not during
  the approach.
- **The HUD node** — owes the illegal-goods marker (§4) and a stock/price
  display that can show a deficit-moved price without implying a bug.
  **Still open. [#70](https://github.com/jcfischer/seelite/issues/70) decided the
  owner and the shape; the screen is not built.** That node had to settle
  ownership first: `hud-and-scanner.md` §0 declined the market at
  the same time this line handed it there, so the screen was owned by nobody for
  as long as neither half was buildable. That spec's **§8** is the answer — the
  marker is M5 (all seventeen rows at every station, the untraded three in a
  named block), the deficit display is M6 (a signed delta against the current
  epoch's base), and M7 records that §5.1's epoch roll is deliberately *not*
  surfaced, because a countdown to it is a countdown to §5.5's measured wait
  exploit. What this line now waits on is `hud-and-scanner.md` §8.6's twelve
  verification obligations, owed by the node that implements the console.
- **`galaxy-generation.md`** — §8's fuel Cost row was wrong and is corrected in
  place, pointing here; §6.1.
- **`station-types.md`** — §3's price-only offset is extended by §3.2 here, and
  §3.2's deferred question about the byte extremes is answered by §2.2 and §3.1.
  The `blackMarket` flag §5.2 specifies **is implemented** in `src/system.ts`,
  landed by [#28](https://github.com/jcfischer/seelite/issues/28) with its own
  `DOMAIN.STATION_FLAGS` tag, and **§4's scope is now enforced in the shipped
  module**: `MarketStation` carries the flag, `listsCommodity` is the rule, and
  `marketRow` throws rather than quoting a shelf for a good the station does not
  sell. A round of this node had that rule living only in
  `scripts/measure-greedy-trader.ts`, which put §4 in the instrument and not in
  the game — the market screen this spec hands the HUD node would have priced
  Narcotics at every station in the galaxy with nothing going red.
- **The ship-roster node** — inherits 20 t and 100 Cr as v1 defaults (§6) and
  owed hull prices (§7). **Both halves are delivered**:
  [#26](https://github.com/jcfischer/seelite/issues/26) settled the roster's
  shape and [#182](https://github.com/jcfischer/seelite/issues/182) priced it in
  §7.1, with §7.2's ceiling and rung count. What that node hands *on* is
  narrower than what it received: the combat axes — hardpoints, integrity,
  thrust — have no price in a trading economy and belong to
  [#8](https://github.com/jcfischer/seelite/issues/8), and whether a shipyard
  lists `patrol` and `raider` is #183's ladder gate (#562 D7) together with
  #565 and #566. **§5.6 re-opens the price half of
  this line.** §7.1's curve was fitted with the pump excluded, which #182 recorded as
  the condition of getting an answer at all; a spread changes what a hold earns, so
  the exponent and the seven prices are owed a fresh run of
  `measure-hull-pricing.ts`. That run was deliberately not folded into #196, which
  would have let a hull price move for two reasons at once, and
  [#383](https://github.com/jcfischer/seelite/issues/383) made it: §7.1's law is
  two segments now, and the level fell by a third.
- **A node nobody has opened yet: the unit §5.2 counts a deficit in.** A sale of
  63 units of Platinum moves the market as though it were 63 *tonnes*, because
  `addDeficit` adds units while `stockResponse` divides by a hold measured in
  tonnes. That is why one purchase of a metal saturates a small hull (§12 joint
  14), why the round trip at one console survives §5.6 at 1,064.70 Cr a cycle (§12
  joint 12), and why closing it with the spread instead costs the trade loop the
  run above. Re-anchoring it re-opens every figure §5.4 was ratified on, which is
  #182's D6 in one sentence, and that is why this is a node and not a patch.
- **The save/load node** — owes the format the sparse deficit map lives in
  (§5.5) and the permadeath stance (§9). The *module* the map lives in is
  settled and is no longer this one: `src/deficits.ts` since
  [#67](https://github.com/jcfischer/seelite/issues/67), once
  [#46](https://github.com/jcfischer/seelite/issues/46)'s persistence envelope
  gave §5.5 a consumer whose whole job is the save. What that node still owes is
  the encoding and where the bytes go, not where the rows are declared.
- **The implement node** — **done, in
  [#25](https://github.com/jcfischer/seelite/issues/25)**, and the split it owed
  was performed rather than a file being moved. `src/market.ts` holds the
  shipped arithmetic — the table, `marketRowAt`, `stockResponse`,
  `shelfQuantity`, `marketEpoch`, §5.2's `decayDeficit` and `addDeficit`,
  `EQUIPMENT` — and
  `tests/helpers/market-math.ts` keeps the measurement surface the game never
  calls: `NARCOTICS_BELL`, the wrapping byte close, `ALL_FLUCT`, `FLUCT_PAIRS`,
  `sweepDomain`, `bestMargin`, `forEachLegalPair`, `surveyResiduals`,
  `runsToExhaustion`, `runTotalCr`. The import direction inverted with it:
  `scripts/` depended on `tests/` for arithmetic the game ships, and both now
  depend on `src/`.

  Three things changed shape rather than moving, and each is a decision:

  - **The `ByteMode` string is gone.** A `"wrap"` branch inside the runtime
    module would be dead code in the game and a live path in the instrument, so
    the close is injected: `SATURATE` is defined in `src/market.ts` and is the
    only one there, and `BELL_WRAP` lives beside the measurements that need it.
    §2.2's rejection stays runnable without shipping.
  - **`marketRow` widened, as this section asked.** `marketRowAt` is the
    sweepable form, taking a fluctuation byte and a station *type*; `marketRow`
    takes a `{ type, seed }` station and a game time, derives §5.1's epoch and
    byte from them, and calls it. One copy of the arithmetic — the second
    function only decides which byte it applies to.
  - **`DOMAIN.MARKET` is a new tag**, for the reason `station-types.md` §5.3
    gives about `STATION_FLAGS`, and **nothing in `system.ts` or `galaxy.ts`
    draws from it**. That is what makes a market independent of station order,
    and §10.3 records why it is asserted structurally rather than by comparing
    values.

  It also landed `Station.localCarrierId` and `LOCAL_CARRIER_ID`.
  `persistent-world-state.md` §2 permits v1 to reuse the id strings `system.ts`
  already assigns but requires the persistence table to be exposed and tested
  rather than inferred from a display key — §5.5's deficit map is keyed on it,
  so a rename of `id` for the map screen must not orphan anybody's market
  memory.

## 12. Weak joints, recorded not reopened

1. **One divergence from Bell's table.** §2.3. Narcotics is retuned because its
   constants require overflow. Every other row is verbatim, and the rejected
   alternatives are on the page with their measurements.
2. **The clamp is a guard that never fires — by one point, on two goods.**
   §2.2. After the retune the shipped table never overflows, so §2.2's price
   arithmetic is a definition rather than a behaviour. But the margin is zero,
   not comfortable: **Computers** (`154 + 3 + 7×14`) **and Luxuries**
   (`196 + 3 + 7×8`) both reach exactly 255 at economy 7, so one point of
   `basePrice`, `gradient` or `mask` on either makes it fire. Kept for that
   reason as much as for the boundary being undefined otherwise; the suite pins
   both, and asserts that no third good comes within ten of the ceiling.
3. **Type differentiation on commodities is still soft.** Inherited from
   `station-types.md` §3.3 — three prices for one transaction. §3.2's quantity
   delta strengthens it slightly; it does not fix it.
4. **The refinery's staple wart survives.** §3.2 makes Food and Furs *more*
   plentiful at a belt refinery as well as cheaper, because staples share the
   extractives' negative gradient. One scalar and a signed slope cannot express
   "cheap ore, dear bread". Recorded in `station-types.md` §3.3 as weak joint 5;
   this spec deepens it rather than introducing it.
5. **`PRICE_ELASTICITY`, `MARKET_PERIOD` and `DEFICIT_HALF_LIFE` are chosen, not
   derived**, and both of their justifications are now measured — one of them
   into a correction. The intra-system exhaustion in 2–3 runs is measured with
   `DEFICIT_HALF_LIFE` in the loop. **"Waiting never beats flying" turned out to
   be false as written**: `scripts/measure-greedy-trader.ts` found waiting
   winning at 4 of 149 decision points, by up to 1.492×, against a median of
   0.132×, and **winning at every dock cost in the sweep** — 3 to 4 wins per
   sweep row, each row being four runs rather than one, with every tail under
   2.3×. §5.5
   records what that is worth, and the answer is not "nothing": the exploit
   exists and is merely rare; §5.5 says "almost never" now and carries the
   distribution. The joint that remains is that the constants are still
   *chosen*: the sim tells you when a change breaks something, not what the
   values should be.
6. **The deficit makes market state unreproducible from the seed.** §5.5. The
   first such state in seelite. It is sparse and bounded, but it is a door that
   is now open.
7. **The prose carries figures the suite does not pin.** §1. The suite asserts
   thresholds so that a legitimate retune does not fail on a stale constant;
   the consequence is that a quoted number can go stale while everything stays
   green. §10.2 is the remedy and it has to actually be run.
8. **The intra-system farm is bounded, not eliminated.** §5.4. The deficit
   cannot close a pair whose sell/buy ratio exceeds 1.920, and 2.32% of legal
   intra-system rows are above it — mostly cheap goods the floor pins at
   0.4 Cr. The richest surviving farm is 7.9 Cr/t (158 Cr a run), against
   291 Cr for an interstellar route farmed to the same saturation, so it is a
   poor use of time rather than an exploit. What the design relies on is that bound, and the suite guards it.
9. **The quantity clamp diverges from Bell, and the sub-tonne goods profit.** §2.2. Four
   goods read differently from `& 0x3F`; Gold is at a permanent 63 where
   txtelite shows 2–16, which makes a sub-tonne precious metal abundant that
   Bell made scarce. Measured, it hands the player 353 Cr a run in Gold and
   1,386 Cr in Platinum, free of the hold — enough that Platinum is the closest
   competitor to contraband in §4's run-value table, 15% behind it. Chosen for consistency with
   the price clamp, recorded because it is a design change rather than a
   transcription, and cheap to revisit: wrapping the quantity byte alone would
   restore Bell exactly.
10. **The contraband premium is 17%.** §4. Narcotics tops the run-value table at
   1,624 Cr against Platinum's 1,386 — a legal good needing no fence and no
   hold space, within 15% of the best smuggling run in the game. #13 §5.2 built
   a rim-weighted fence geography on contraband being worth carrying, and 17%
   is what that geography currently buys. Recorded rather than tuned away:
   raising it means changing Narcotics' constants again or scoping the
   sub-tonne goods, and neither is #7's to decide unprompted.
11. **Per run, a legal cargo out-earns a smuggling cargo.** §4.1. 3,746 Cr
    against 2,314 Cr, because sub-tonne goods stack with a full hold and want
    the opposite economy direction to Narcotics. §4's stated requirement —
    "contraband must out-earn every legal good" — is therefore **not met at the
    run level**, only per good. Left recorded rather than repaired on the
    principal's call: it reaches into #13 §5.2's fence geography and #8's risk
    pricing, and every fix (dropping the hold-check bypass, a second Narcotics
    retune, capping sub-tonne stacking) is a decision past this node's scope.
12. **Selling a hold and buying it straight back is a money pump.** Found by
    [#182](https://github.com/jcfischer/seelite/issues/182)'s hold sweep and
    **not fixed by it**. §10.1 prices a whole transaction at one figure — no
    slippage inside it — and §5.2's response then moves the price for the *next*
    one, so a sale is quoted at the pre-trade mark and the buy-back at the
    post-trade one. The round trip nets `PRICE_ELASTICITY` of the cargo's value,
    **10%, per cycle, unbounded**: measured through `transactAtStation` on a
    2.00 Cr Food row, 20 t sells for 40.0 Cr and buys back for 36.0, and six
    cycles turn 100,000 Cr into 100,024 with the cargo unchanged.

    It is not an artefact of an instrument — the shipped calculator does it, and
    it predates #182 — but it is what made the hold sweep's first curve run
    *backwards*: with the market's memory on, a **stronger** response makes the
    greedy trader earn more, 5.58× at an 8 t hold and 3.35× at 20 t (7.19× and
    3.39× before #316 floored the memory at one shelf, §5.2), because the
    strongest mark is on the sub-tonne goods whose 63-unit stack is twenty holds
    for a small hull. §7.1's curve is therefore measured against a market with
    no memory, and `measure-hull-pricing.ts` section D reports what the memory is
    worth instead of hiding it.

    **Recorded rather than repaired because the repair is #7's to make.**
    Pricing the marginal unit inside a transaction reverses §10.1's ruling and
    moves every figure §5.4 was ratified on, including the exhaustion count and
    the residual bound the design relies on. What it needs is a node, not a
    patch.

    **#196 closed the half of it a spread can reach, and closed means
    measured-at-zero rather than smaller.** A bid cut at or above the mark one full
    hold leaves — `BID_CUT_FLOOR`, 0.10 — makes the second leg cost at least what the
    first gained, and the sweep behind §5.6's ladder counts **0 profitable cycles
    among the tonnage goods** across 98,685 of them: every dockable hull, every good
    the table sells, three priced station types, eight economies, fifteen tech
    levels, both orders, flown through `transactAtStation` with a refused leg
    throwing rather than netting a quiet zero. The row this joint was written
    against — one commander, one console, 20 t of Food out and the same 20 t back,
    six times — no longer prints money at all: a cycle now *costs* the row's mid
    value times `cut − PRICE_ELASTICITY`, the cut less the mark the sale itself
    leaves, which at `displayTL` 8 is 7.5% of the row — `bidCutAtTl(8)` is 0.175, and
    the 8% this line carried was the one-based offset the ladder was rebased off.
    `tests/station-commerce.test.ts` pins that as a formula rather than a transcribed
    balance, so the six trips that turned 100,000 Cr into 100,024 are covered by the
    law and not by a figure that goes stale on a retune.

    **The metals half is open and it is named here, because a joint that read
    "closed" would be the second time this pump was allowed to hide.** 63 units of
    Platinum is 0.2 t of cargo, §5.2's memory counts units, and one purchase
    saturates a hull of 20 t or less — the swing is 0.315, the whole range of the
    response and more than any cut the trade loop survives. Joint 14 is the
    mechanism; §11 carries the node. So **12,073 of the same 98,685 cycles still net
    a credit, all of them metals, the best at 1,064.70 Cr a cycle on 4,964 Cr of
    working capital** against 1,563.79 Cr with no spread at all.
    `tests/station-commerce.test.ts` §5.6 pins that figure with the row that produces
    it — **and that row is the falsifier for a re-anchor, not `tests/market.test.ts`'s
    swing row.** The units are counted in `addDeficit` and `recordTrade`; a row written
    against `stockResponse` alone cannot see either, and said it could until this
    paragraph was checked. What the swing row does pin is the mark's size and the
    cap-to-hold scale. A node that re-anchors the sub-tonne unit should read the till
    row first: it is the one that breaks.
13. **§7.1's price *level* is a choice, and only its shape is measured.** The
    law's exponent is fitted; its baseline is a rate from a trader opening at
    `fullKitCr()` times a window from one opening at §6's 100 Cr. Both arms fly
    the same economy and differ only in that capital, and the difference is what
    gives the level content — from one arm the product is `fullKitCr()` by
    identity and every hull would cost the kit times `(hold / 20)^b`. So "a hull
    costs what its hold earns back over one kit" is a design rule anchored to
    #26's own anchor, and the 1.11× baseline-to-kit ratio is a fact about that
    rule rather than about the economy. Cheap to revisit: the shape is the
    measurement and re-anchoring moves the whole ladder together.
14. **§5.2's hold-invariance is the tonne goods'.** A run of a sub-tonne good is
    Bell's 63 units whatever the ship, so dividing by the hold makes a big hull
    lean *less* on the metals — 31.5% at 20 t against 3.2% at 197 t. Structural
    rather than an oversight (they bypass the hold check, so no hold was given
    up to carry them), pinned by `tests/market.test.ts`, and the reason weak
    joint 12's pump is strongest at a small hold.

    **#196 measured what this joint is worth, and it is worth more than anyone has
    been charging for it.** The obvious way to close the pump joint 12 describes is a
    spread, and a spread that closes it has to exceed the swing this joint creates —
    0.315 — which §5.6 found taking the honest trade loop down to 1 of 4 galaxies
    reaching a Combat Engine in four hours, 2 of 4 sessions stalling outright. So the
    cut shipped at the tonnage closure, 0.10, and this joint now carries a surviving
    pump rather than only an asymmetry: 12,073 profitable cycles in the corpus,
    1,064.70 Cr on the binding one. That reframes what re-anchoring it would buy. It
    is not tidiness and it is not #182's D6 revisited for its own sake; on this node's
    reading it is the *cheapest* lever that could close the metals cycle, because the
    cycle's size *is* this unit error rather than a price the spread is badly set on.
    **That is an argument, not a measurement, and it is stated as one because
    nothing in this PR measures the alternative.** No arm here re-anchors the deficit
    unit and re-runs the corpus, and #182's D6, which the paragraph above cites,
    recorded what re-anchoring costs: it re-opens §5.4's farm calibration. So the
    claim this node is entitled to is the ordering — a cut that closes metals costs
    §8's time-to-kit, and a unit change costs a recalibration whose size is not
    known — not a proven saving. The node §11 opened owes that measurement before it
    ships anything.
