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
| Hull roster and prices | the ship-roster node (still fog on the map) |
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
                               × clamp(deficit, ±63)
                               / HOLD_REFERENCE_T))

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
| `PRICE_ELASTICITY` | 0.10 per `HOLD_REFERENCE_T` | §5.3 |
| `HOLD_REFERENCE_T` | 20 t | §6 |

The executable copy is **`src/market.ts`**, where
[#25](https://github.com/jcfischer/seelite/issues/25) moved it. There is one
copy of the **formula**, imported by the suite, by
`tests/helpers/market-math.ts` and by `scripts/`, so no two of them measure
different arithmetic. What stayed behind in `market-math.ts` is the surface that
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

deficit(t) = deficit₀ × 2^(−(t − t₀) / DEFICIT_HALF_LIFE),  clamped to ±63
DEFICIT_HALF_LIFE = 20 min game time

effectiveQuantity = clamp(generatedQuantity − deficit, 0, 63)
priceCr          ×= 1 + PRICE_ELASTICITY × deficit / HOLD_REFERENCE_T
```

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
so one purchase takes 30–55% of a station's stock of that good. In a
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
reference hold moves any good by **10%**, whatever it costs. It applies in
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

**Measured**, over 122 decision points where parking until the next epoch was a
profitable option at all:

| | wait rate / best flight rate |
|---|---|
| median | 0.031× |
| p95 | 0.573× |
| max | **1.785×** |
| points where waiting won | **3 of 123 (2.4%)** |

So the intent holds as a tendency and **not as an absolute**: at three moments
in a hundred and twenty-three, the best thing on offer was to sit still, and the
best of those was worth 1.79× flying. The earlier draft of this paragraph said
"never" and had nothing behind it. What the constants buy is that waiting is
worth 3% of flying at the median — the exploit the pair were chosen to close is
closed, and the residual is a rounding error rather than a strategy.

Changing either constant re-opens the question, and
`scripts/measure-greedy-trader.ts` is now what catches it.

---

## 6. Cargo, credits, and fuel

| | Value | Source |
|---|---|---|
| Starting credits | 100 Cr | Elite |
| Hold | 20 t | Cobra Mk III |
| Large Cargo Bay | +15 t → 35 t | PRXS, 400 Cr |
| Sub-tonne goods | Gold, Platinum, Gem-Stones bypass the hold check | research §2.2 |

The 20 t figure is a **v1 default that the ship-roster node inherits**, not a
decision about hulls. It is fixed here because §8's pump cannot be computed
without it.

The compounding from 100 Cr is faster than the stingy reputation suggests: on
the canonical lane at zero fluctuation — Computers bought at 61.6 Cr and sold at
100.8 — the player is capital-limited for **six runs** and hold-limited from the
seventh. A draft of this section said five and called it arithmetic while
committing none; `runsUntilHoldLimited` derives it now and the suite pins the
six. **The minutes are claimed now, and carefully**: §10.3's sim reaches 400 Cr — the
Large Cargo Bay, §8's first purchase — at **7.3 minutes** of perfect play from
the opening 100 Cr, against a modelled 45 s dock stop. The sim *buys* it at 13.9
minutes, because it keeps an 800 Cr working float back; that float is a property
of the sim, which stops dead without it, and not of the economy, so 7.3 is the
figure this section is about. A draft quoted 13.9 as time-to-the-bay, which was
time to 1,200 Cr wearing a 400 Cr label.

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

The ten universal items are gated at `min(displayTL + 3, 10)` per
`station-types.md` §4.1. Mining and military lasers are not in Elite's cassette
list — `station-types.md` §4.1 introduced them and left the price here; the
figures are the disc/Master ones research §3.1 cites. seelite is therefore on
**cassette economy plus disc laser tiers**, which is what research §6's open
question recommended.

**Type does not discount.** It would need a second pricing mechanism —
equipment has no gradient for §3's delta to multiply — and the exploration
incentive is already carried by availability: shipyards exist only at
`displayTL ≥ 10`, so hulls and military hardware are a core-ward good and the
frontier is where you cannot buy what the frontier requires
(`station-types.md` §4.2). Discounting on top applies the same gradient twice.

**Hull prices are not specified here.** `station-types.md` §4.1 puts hulls at
shipyards, but "one hull with modules vs multiple hulls" is still fog. Whatever
node graduates it prices them.

---

## 8. The progression pump

A full 20 t hold on the canonical lane is ~700 Cr per run at 3–5 minutes. The
Large Cargo Bay is the first purchase and lifts that to ~1,225 Cr.

The twelve items above total **19,125 Cr** — 19,245 with a full missile rack.
Both are `fullKitCr()`, derived from the price list rather than added up in
prose, and asserted.
That is about fifteen clean runs, and the design was aiming at **1.5–2.5 hours**
of trading once §5.2's deficit forces route rotation.

**Measured, the ceiling is faster than the aim.** §10.3's greedy trader fits out
in **51–123 minutes** across four galaxies, at 173–421 Cr/min. Three of the four
land under the target's lower bound and one lands inside the range, so the
1.5–2.5 h figure survives only as a claim about a *human*: it needs a real
player to run at roughly 0.6× the ceiling. That is plausible and unmeasured, and
it is the honest form of the sentence.

**Half the clock is a modelled constant**, so the figure is a claim about that
too. The dock-and-market stop is 45 s in the sim and is specified nowhere — #9
sets docking tolerances, not a duration. Swept: fit-out runs **49 min at 15 s
and 106 min at 90 s**. A reader who thinks 90 s is the right stop should read
this section as met rather than beaten.

---

## 9. Death economics

**The escape pod is death insurance at 1,000 Cr**, Elite's price and Elite's
semantics: you eject, you lose the entire hold, you keep the hull and everything
fitted to it, and you resume at the last station you docked at.

One consequence is recorded because #8 has to reckon with it: **ejecting dumps
contraband**, which makes the pod a panic-button disposal route ahead of a
shipyard scan. Whether that is a legitimate tactic or wants a cost is #8's, not
this spec's.

**What happens without a pod is not decided here.** That is the save/permadeath
question, still fog on the map, and it reaches far past the economy.

---

## 10. Verification obligations

All headless `bun` — none of §1–§9 may require a browser, per #7's own framing.

### 10.1 Suite — `market.test.ts` 38 tests, `market-state.test.ts` 24

`market.test.ts` owns §2–§4 and §6–§7 — the arithmetic, swept over its whole
domain — and is listed below. §5's two properties are not about a formula and
live apart, in `market-state.test.ts`; §10.3 lists them.

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

### 10.2 Instrument (`scripts/measure-market.ts`)

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

It is a **ceiling, not a player**: it sees every price it can reach, fears no
pirate and never misjudges a docking. A target is falsified by a ceiling that is
too slow and merely unproven by one that is too fast.

| | measured, world `0x5ee11e`, four galaxies |
|---|---|
| fit-out, full kit | **51–123 min** against §8's 1.5–2.5 h |
| Cr/min | 173–421 |
| hops chosen: interstellar : intra-system | **121 : 39** |
| fit-out across dock cost 15→90 s | 49 → 106 min |

**Both ends of a trade are quoted at the clock each happens on**, and the first
version of this instrument quoted both at departure. That is not a rounding
error: a leg runs into the tens of minutes against a 30-minute `MARKET_PERIOD`,
so every flight was booked at prices from before it was flown while the wait
option — priced at the epoch it waits for, by construction — got the future it
was asking about. The comparison §5.5 turns on was stale flights against
correctly-timed waits. Fixing it moved every figure in this table and doubled
the rate at which waiting wins.

**Re-run it whenever `MARKET_PERIOD`, `DEFICIT_HALF_LIFE` or `PRICE_ELASTICITY`
moves.** All three are in the loop, and §12.5 is explicit that changing either
of the first two re-opens the exploit with nothing else to catch it.

**The determinism and save round-trip tests** — `tests/market-state.test.ts`,
24 tests. §5.1: the byte is fixed by `(stationSeed, epoch)`, every good is
identical across a whole epoch, the market re-rolls on the boundary for >95% of the
corpus's 117 stations, phase staggers the stations of one system, and two stations in one
system draw unrelated bytes. §5.5: lazy decay on read with nothing written,
saturation at ±63, the drop-below-one-unit rule, a JSON round trip over a 61-row
map, and a malformed save that throws rather than reading as an untouched
healthy carrier.

**Two of those tests were written, found unfalsifiable, and replaced**, which is
worth recording because both replacements are a different *kind* of check.

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

---

## 11. What this obliges of other nodes

- **#8 (combat)** — owns legal status, scans, police, and the consequences of
  carrying contraband; owes a ruling on the escape-pod dump (§9). Alien Items
  (§2.4) have no source until combat scooping exists.
- **#9 (docking)** — nothing. Market state is read at the station, not during
  the approach.
- **The HUD node** — owes the illegal-goods marker (§4) and a stock/price
  display that can show a deficit-moved price without implying a bug.
- **`galaxy-generation.md`** — §8's fuel Cost row was wrong and is corrected in
  place, pointing here; §6.1.
- **`station-types.md`** — §3's price-only offset is extended by §3.2 here, and
  §3.2's deferred question about the byte extremes is answered by §2.2 and §3.1.
  The `blackMarket` flag §5.2 specifies **is implemented** in `src/system.ts`,
  landed by [#28](https://github.com/jcfischer/seelite/issues/28) with its own
  `DOMAIN.STATION_FLAGS` tag; contraband trading was gated on it and no longer
  is.
- **The ship-roster node** — inherits 20 t and 100 Cr as v1 defaults (§6) and
  owes hull prices (§7).
- **The save/load node** — owes the format the sparse deficit map lives in
  (§5.5) and the permadeath stance (§9).
- **The implement node** — **done, in
  [#25](https://github.com/jcfischer/seelite/issues/25)**, and the split it owed
  was performed rather than a file being moved. `src/market.ts` holds the
  shipped arithmetic — the table, `marketRowAt`, `stockResponse`,
  `shelfQuantity`, `marketEpoch`, the deficit functions, `EQUIPMENT` — and
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
   winning at 3 of 123 decision points, by up to 1.785×, against a median of
   0.031×.
   §5.5 says "almost never" now and carries the distribution. The joint that
   remains is that the constants are still *chosen*: the sim tells you when a
   change breaks something, not what the values should be.
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
