# Station damage

Author: Ivy · 2026-09-16
Status: E1–E7 are agreed. The detailed contract becomes ratified on
principal-approved merge recorded in the linked decision's resolution.
Decision node: [What breaks, how often, and what a broken thing stops being
able to do](https://github.com/jcfischer/seelite/issues/358).

This spec owns **what breaks in the world, how often, and what a broken thing
stops being able to do**. It is the prerequisite
[Ordinary work](https://github.com/jcfischer/seelite/issues/356) named: that
spec's §4 **repair** row is the load-bearing case for its D4, and it cannot
work until this one ships.

## What this spec does not own

| Fact | Owner |
| --- | --- |
| Job families, offer derivation, the courier floor, what each job's mark is | `ordinary-requests.md` (node #356) |
| Per-carrier state bounds, transitions, recovery, provenance, the six galaxy domains | `persistent-world-state.md` §3–§8 |
| Raider slots, their counts, lifecycle and leg chance | `combat-model.md` §3 and §4 |
| Which equipment is universal and which is a type exclusive | `station-types.md` §4.1 |
| Station generation — which roles a system gets and when | `src/system.ts`'s `generateContents` |
| The request lifecycle a repair job runs through | `missions-and-requests.md` |

## The state of the code this is written against

Verified on `main` at `f591f1b`, 2026-09-16. Recorded because three of these
findings changed a decision rather than decorating it.

- **`disable | restore` is written and dead for stations.** `disabled` appears
  only inside `src/world-state.ts`'s own transition machinery; no generator and
  no station code writes it.
- **`src/station-commerce.ts` reads no carrier condition at all**, so a disabled
  station currently loses nothing. `transactAtStation` is the single entry point
  and already refuses with a named reason, which is where the projection lands.
- **`carrierBaselineFingerprint` hashes identity, type, parent and placement —
  never condition.** So damage expressed as a *property* of an existing carrier
  would need no generator bump. E1 forgoes that, deliberately, and §7 says why.
- **Only `destroy` can schedule anything.** `world-state.ts` gates scheduling as
  `event.kind === "destroy" && event.schedule`, and `ObjectiveDelta.scheduled`
  is documented "on a destroyed row only". A lazily-materialising *disable* does
  not exist and is not added here.
- **Compaction does not run on save.** `serializeWorld` is `canonicalBody` plus
  an integrity hash; `compactWorld` and `canonicalSnapshot` appear only in
  `tests/world-state.test.ts`. §5's collision is therefore **latent**, and bites
  the moment compaction is wired into the save path. It is fixed here anyway,
  because a latent save-corrupting bug is worse than a live one.

### Figures, and what they are worth

Measured this session by a throwaway count over `enumerateCarriers` and
`generateGalaxy` at **world seed 42, galaxy 0** — one galaxy of eight, one seed.

| Figure | Value |
| --- | --- |
| Carriers enumerated | 3,523 — 410 stations, 2,352 traffic, 761 raiders |
| Systems | 256: **124 with one station**, 110 with two, 22 with three, none with zero |
| Stations by government | gov 2–4 holds 261 of 410; gov 5–7 holds 53; gov 0–1 holds 96 |
| Systems eligible as a start (`displayTL ≥ 8`, `government ≥ 5`) | 21 |

**A figure from one seeded world owes its spread, and these have none.** They
are quoted to size a decision, not as properties of the galaxy. The
implementation owes a committed instrument that reprints them across seeds and
galaxies, in the shape `scripts/measure-clamp-bite.ts` already uses; until that
exists, no test may assert against these numbers.

## Agreed decisions

Principal evidence throughout is a live grilling session on 2026-09-16, one
question at a time, each decision selected explicitly.

### E1 — Independent capabilities, each its own carrier

A station's capabilities fail **independently**. Because a carrier holds exactly
one objective condition (`persistent-world-state.md` §3.2, which forbids a
"partly operational" state outright), independence means each capability is its
own **carrier**, parented to its station.

The principal was offered a single role-defining capability, the whole commerce
surface, docking denial, and independent capabilities, and chose the last —
knowing it was the largest of the four.

`stationTrafficRoster` is the precedent: it already yields sub-carriers under a
station, sized conditionally from the berth catalogue. Capability carriers
follow its shape rather than inventing one.

**What this costs, stated where the decision is.** New carriers enter
`enumerateCarriers`, therefore `carrierBaselineFingerprint`, therefore a
`WORLD_GENERATOR_VERSION` bump — see §7. Three slots over 410 stations is
roughly +1,230 carriers against 3,523, about +35%.

### E2 — Three fixed slots, and fuel is not one

| Slot | Trade | Refinery | Shipyard |
| --- | --- | --- | --- |
| **market** | yes | yes | yes |
| **equipment** (the 10 universal items) | yes | yes | yes |
| **exclusive** | **absent** | fuel scoops, mining laser | extra energy unit, military laser, hulls |

Trade's exclusive slot is absent because trade *has* no exclusive — §5.1.1 calls
it "the station that expresses the system unmodified", and that is its identity
rather than an omission.

**Fuel is deliberately not a slot.** 124 of 256 systems in the measured galaxy
have exactly one station; a disabled fuel seller there strands a pilot with an
empty tank, which is the unwinnable save the drive-charge regeneration rule
(#10) exists to prevent. Fuel is always available at any station that admits
you.

**The roster is a fixed present-or-absent list, never consumed in push order.**
This is `domains.ts`'s `STATION_NAME` hazard one level along — that tag exists
so "an absent refinery cannot hand its name to the shipyard". A capability
roster built by pushing only the slots that apply would let a trade station's
missing exclusive shift every later capability's draw.

### E3 — The seeded floor is government-keyed, 12% to 3%

The share of capability slots that begin disabled is **linear in government:
12% at anarchy (0) falling to 3% at corporate state (7)**, expressed as a
**factor on the odds** and never as an offset on a bounded index.

The principal was offered this, a gentler 6%–2%, a tech-level axis, and a flat
rate, and chose this one.

The odds-factor form is the map's standing constraint from #13 — *a per-type
modifier on a bounded index gets clamped away where that type lives*, which bit
three times in that node alone. It is also the shape `raiderLegChance` already
uses, at 60%/20% linear in the same axis, ratified by the principal on
2026-09-15.

**Arithmetic over the measured distribution** — not a simulation — puts this at
about 35 of 410 stations per slot, near 105 disabled slots in a galaxy.

**The start system is protected by construction, with no special case.**
`startSystem` takes the most central system with `displayTL ≥ 8` and
`government ≥ 5`, which is the low-damage end of this very axis.

Tech level was rejected as the axis on two grounds: it tracks radius and so
double-counts a gradient the economy already carries, and shipyards generate
only at `displayTL ≥ 10`, so a TL-keyed rate could never damage one.

### E4 — A derived baseline with a persisted override

A capability slot's condition is a **pure function of the world seed, the slot's
identity, its system's raider slots, and the game clock**. A repair writes an
`ObjectiveDelta` that **overrides** that function.

The principal was offered this, extending the transition model with a scheduled
disable, damage only in view, and no raider damage at all, and chose this.

Two consequences are accepted openly. **The damage has no provenance and nothing
to interrupt** — only the repair is a caused transition. And the seeded floor
(E3) and raider-caused damage are not two systems that interact; they are
**terms in one function**, which is why this spec has no "how the two rates
combine" section. That question dissolved rather than being answered.

No scheduled-disable is added. The model restricts scheduling to `destroy` by
deliberate design, and widening it is a larger change than this node needs.

### E5 — Compaction drops what equals the baseline

`compactWorld`'s `derivable` predicate changes from **"the condition is
operational"** to **"the row equals the derived baseline"**.

Today the predicate is
`condition === "operational" && instanceOrdinal === 0 && recovery === undefined
&& scheduled === undefined` — which is *exactly* the row a repair writes. Under
E4 that row is not derivable at all, so compaction would drop it and the next
read would fall back to a baseline that says disabled: **every repair erased on
save**.

The principal was offered this redefinition, exempting capability carriers from
compaction, and abandoning the derived baseline for rows written at generation,
and chose the redefinition.

It preserves the invariant's intent rather than special-casing around it — the
existing comment already says compaction drops "the one that is *derivable*",
and E4 simply changes what derivable means. It generalises: for every carrier
whose baseline is operational, the new predicate and the old agree exactly.

### E6 — The baseline heals

The derived function carries a **time term**, so a capability nobody repairs
returns on its own. Damage is a slow oscillation, not a ratchet.

The principal was offered this, damage static until repaired, and a
government-keyed heal rate, and chose self-healing on its own timescale.

Two things follow. Repair work **regenerates**, so the galaxy does not run out
of jobs — the alternative bounded them at roughly 105 per galaxy, shrinking.
And a repair's value is **time-limited**, which is consistent with the game's
other durable mark: `economy-trade.md` §5.5's stock deficit already decays.

The government-keyed heal rate was rejected to stop government driving a third
mechanism. It already drives this floor and the raider slot count; a third use
would be one gradient counted three times.

### E7 — One shared generator bump

The implementation takes **`WORLD_GENERATOR_VERSION` 7**, shared with the relay
production node's enrolment of `relay-00`, and **`WORLD_SCHEMA_VERSION` 3** for
E5's compaction semantics. **Whichever lands first writes the migration**; the
second adds its carriers to the same version.

The principal was offered this, letting the relay go first and taking 8 behind
it, and a dedicated migration node owning both, and chose the shared bump.

The reason is that two independent bumps cost two migrations for changes landing
in the same period. [The relay production
node](https://github.com/jcfischer/seelite/issues/351) is open and unclaimed at
the time of writing; whoever takes it inherits this arrangement.

## Detailed contract proposed for ratification

No implementation is delivered by this document.

### 1. Capability carrier identity

A capability carrier is parented to its station and keyed by the existing
`CarrierKey` scheme. Its `localCarrierId` is its station's own id plus the slot
name, so identity is derivable from the station and the fixed slot list and
needs no new namespace.

`GeneratedCarrier` gains a `capability` kind carrying the slot name and the
parent station's type. It has no independent placement: a capability is at its
station, and the fingerprint must not pin placeholder coordinates for it — the
same correction the raider kind already carries.

`enumerateCarriers` yields each station's capability slots immediately after the
station, in fixed slot order, skipping absent slots. Skipping is safe for the
*fingerprint* because the slot name is hashed; it is **not** safe for any RNG
draw, which is what E2's sub-stream rule is about.

### 2. The baseline function

```
baselineCondition(worldSeed, galaxyIndex, capabilityKey, raiderState, gameTime)
  -> "operational" | "disabled"
```

Pure, deterministic, and **never persisted** — it is recomputed on read, exactly
as `persistent-world-state.md` §8 requires of a projection. It takes a new
`DOMAIN` tag, drawn per capability slot rather than per station, so a station's
absent slot cannot shift its siblings.

Its terms: E3's government-keyed floor, a raider-pressure term reading the
system's raider slots, and E6's heal term on the clock. The implementation owes
their exact forms and a committed instrument that prints the resulting
distribution across seeds and galaxies.

### 3. The override, and what compaction does with it

A repair writes an `ObjectiveDelta` for the capability carrier through the
existing `restore` transition, carrying the player's provenance — so a repair is
a caused, attributable transition even though the damage is not.

Compaction keeps that row while it differs from `baselineCondition` at the
compaction clock, and drops it when the two agree. Because the baseline heals
(E6), a repaired slot's row is dropped naturally once the baseline catches up,
which is what keeps the domain sparse without anything expiring on a timer.

### 4. The projection into commerce

`transactAtStation` gains a condition check per action and refuses with a named
reason, in the style of its existing `equipment-unavailable`:

| Action | Slot consulted |
| --- | --- |
| `buy-commodity`, `sell-commodity` | market |
| `buy-equipment`, universal item | equipment |
| `buy-equipment`, type exclusive | exclusive |
| `buy-fuel` | none — never refused on condition |

Hull purchase is the `buy-hull` `StationAction` since
[#583](https://github.com/jcfischer/seelite/issues/583), and it reads the
exclusive slot **once this spec's condition exists** — it does not yet.
[#556](https://github.com/jcfischer/seelite/issues/556) D9 places the damaged
exclusive slot second in a hull row's refusal order, after the rung lock; with
no slot condition built there is nothing to read, so `hullOffer` carries no such
refusal, and the node that builds this projection adds it there.

The docked console must show a disabled capability as unavailable **before** the
player attempts it, and say the station is damaged rather than that the item is
missing — those are different facts and a market that merely looks empty is the
unread-screen tax `station-types.md` §3.3 avoids elsewhere.

### 5. Verification obligations

This document is a contract and claims no test run. What its implementation
owes:

| Case | Required evidence |
| --- | --- |
| The baseline is deterministic | Headless: the same inputs give the same condition twice, across a process boundary |
| A slot's draw is independent | Headless: a trade station's absent exclusive does not change any other slot's condition |
| The floor matches its axis | A committed instrument printing the disabled share by government across seeds and galaxies, with its spread |
| Fuel is never refused on condition | Headless: every slot disabled, `buy-fuel` still accepted |
| A repair survives a save | Headless: repair, serialize, parse, and read the slot still operational |
| A repair survives compaction | Headless: repair, `compactWorld`, and the row is retained while it differs from the baseline |
| Compaction is unchanged where the baseline is operational | Headless: for every carrier kind that existed before, the old and new predicates agree |
| The baseline heals | Headless: a disabled slot left alone reads operational at a later clock |
| A one-station system stays playable | Headless: every slot disabled, the station still admits docking and still sells fuel |
| The console says damaged, not empty | Browser probe on the docked console, plus the principal reading a damaged station |
| The migration | Headless: a version-6 world loads, and an unsupported version is refused untouched |

The arithmetic and state halves are headless. The console is the browser tier's.
**A doc-only change is not probed**; these attach to the implementation node.

## Scope

This decides what breaks, how often, and what it costs. It does not build the
job catalogue, police AI, bounty economics, or carrier naming and the scan,
which is its sibling node. It does not reopen the request contract, the combat
model, the law model or the economy.
