# Salvage

Author: Ivy · 2026-10-06
Status: S1–S27 are agreed. The detailed contract becomes ratified on
principal-approved merge recorded in the linked decision's resolution.
Decision node: [Salvage's owed verb: what a drifting wreck is, what the pilot
does at it, and how it is found](https://github.com/jcfischer/seelite/issues/466).

This spec owns **what a wreck is, what a pilot does at it, how it is found, and
what a Salvage job asks for**. It discharges the one new mechanic
`ordinary-requests.md` D7 left owed, and it is the wreck that
`economy-trade.md` §9 (#660 D7, D8, D8b, D11) said a death and an eject leave.
There is **one kind of wreck**; the death wreck is a source of it, not a second
kind.

The S numbers are #466's D1–D27 in order, renamed so they do not collide with
the D numbers of the specs this one points at.

<!-- glossary-ignore: slot -->

## What this spec does not own

| Fact | Owner |
| --- | --- |
| Which share of a death's losses survives into its wreck, the roll and its stream | `economy-trade.md` §9 (#660 D8, D8b, D11), built by #705 |
| Leads, accepted requests, report, entrusted cargo, free cancellation | `missions-and-requests.md` (#337) |
| The sweep, its tab, its lead rows, the passive close cue | `hud-and-scanner.md` and #468 |
| Per-carrier bounds, transitions, recovery, knowledge rows, compaction | `persistent-world-state.md` |
| The scoop gate, canisters and their lifetime | `combat-model.md` §4.1 |
| The ladder kinds, credit and the equipment gate | #183, #562, `src/ladder.ts` |
| A capital derelict that can be entered | its own node; it consumes S3, it does not invent a second verb |

## 1. What a wreck is

**S1 — Two sources.** A wreck comes from a **derelict slot**, seeded per system
and enumerated in the carrier set beside traffic and raider slots, or from a
**death or an eject**, one per commander. A new death replaces that commander's
earlier wreck. Both are **one row shape** — a condition and, per container, an id and
the tonnes left — under two keys: the derelict slot's carrier key,
and the commander's wreck key. A derelict's contents are drawn at its loss (S6); a death
wreck's are #660's seeded share, fixed at the death and stored on its row.
The verb, the drawing and the finding rules are shared. A destroyed carrier row is **not** a source: it draws nothing,
it is `destroyed` for `RAIDER_WRECK_S` only, and its manifest already dropped as
canisters at the kill (#362 H11), so salvaging it would pay the same cargo
twice. `ordinary-requests.md` D7's "re-derived from its carrier's destroyed row"
is amended by this.

**S2 — A wreck stays until it is stripped.** A wreck is stripped when every
container's tonnes are zero, and stripping writes a `salvaged` condition on its
row. A derelict slot then waits for its next loss (S16). A
death wreck goes when it is stripped or when a new death replaces it. S16
amends this for derelict slots only.

**S6 — What a derelict holds.** One to four manifest containers, one per line,
each holding that line's tonnes, and sometimes one **fitting** container. The
contents are **drawn at the loss** from their own `DOMAIN` tag, keyed on (slot
key, `instanceOrdinal`), and **stored on the row**: per container, its good or
fitting id and the tonnes left (S20). At most five entries, so the bound of one
row per slot holds. Nothing is re-derived after the loss, so neither a generator
bump nor a module appended to the catalogue changes a wreck that already exists;
they reach new instances only (S18).

**S11 — Where it sits.** At rest in a local frame. A death wreck keeps the
frame the pilot flew in at death (#529's frame) and its offset there; a
derelict takes a seeded offset in a seeded body's frame. "Drifting" is a slow
drawn tumble, never a ballistic path.

**S12 — A death inside a station's space** places its wreck at the nearest point
outside the corridor cylinder and the station's keep-out, in the station frame.
The placement is derived, so one death gives one point.

**S13 — Collision.** The hull collides through a proxy from its built envelope,
as a live ship does. Containers do not collide (`collision.md`'s canister row),
and they are tethered outside a margin around the hull so that every container
is reachable inside the scoop gate without touching the hull.

**S26 — The look.** A dark roster hull: lamps off, a slow tumble, a scorched
`worn` finish. No new geometry. A broken-hull look is its own visual node.

## 2. The verb

**S3 — Proximity scoop.** The pilot scoops a tethered container exactly as a
canister is scooped: the gate is `CANISTER_SCOOP_RADIUS_KM` and
`CANISTER_SCOOP_SPEED_KMS` (`combat-model.md` §4.1 owns them). The containers
are drawn from the wreck row and have **no lifetime**; persistence lives on the
row, not on a canister, so #324's choice that canisters are flight state stands.
No fitted equipment is needed.

**S20 — A container larger than the free hold.** An owned container takes what
fits, as H11's scoop does, and the remainder stays tethered; the row stores the
tonnes left per container. A job's **entrusted** item goes aboard whole or not
at all, and the refusal names the free hold and the container's tonnes.

**S4 — No job is needed.** Any pilot strips any wreck they find. A Salvage job
is one reason to go to a wreck, not the key to it.

**S24 — Always lawful.** Stripping a wreck is never an offence (#396 defines an
offence as violence on a clock). A home station's claim only shows as its offer
withdrawing (S17).

**S5 — The hold boundary.** Goods taken with no job are **owned**: free salvage,
or a pilot's own losses back from their death wreck. With a job, the item the
job names becomes **entrusted** when it is scooped, belongs to the poster, and
reaches the destination only by the Deliver act. Every other container on that
wreck is owned.

**S7 — A fitting** goes into the hold as an item, takes its tonnage, and is fitted
or sold at a station's Equipment tab. Nothing is fitted in flight.

**S8 — The ladder gate holds for salvage.** A fitting above the pilot's rung can
be carried and sold but not fitted; the Equipment tab shows the locked row with
its reason, as #183 requires.

**S19 — Scooped, then a death before docking.** The world keeps the scooped
tonnes (#654), and the commander reverts to its launch. Owned goods scooped on
that leg are part of what the death took and may return in the death wreck's
seeded share. An entrusted job item never goes into a wreck (#660 D8), so the
job fails with a readable reason.

A reload in mid-recovery needs no rule of its own once the derelict-row build
puts the row in the save: the `live` record holds the world and the
commander in one envelope and is rewritten after every change once it settles
(`src/save-store.ts`'s debounce, #89 D4). A reload restores the row and the
hold from the same write, so a scoop inside the debounce is lost from both, never
from one.

## 3. Finding a wreck

**S9 — A derelict is found on the relay's path, with a visual floor.** The
Long-Range Scanner's sweep writes a region lead and its passive cue reads on
approach, as for the relay (#468, #481). Without the scanner a derelict gives no
lead and no cue, but a pilot inside a short **visual floor** identifies the hull
anyway. Identification is the knowledge write that makes it a contact and a
target (#460: a lead is provenance, never discovery).

**S10 — A death writes its own knowledge row**, with the source "own loss" and the
age from the death. The death wreck is that commander's contact at once, from
anywhere in its system, with no scanner.

**S22 — A lead is a past reading.** A lead whose wreck is gone stays as written,
with its age; a new sweep replaces that system's lead rows. An absence writes
nothing.

**S25 — The ladder.** The first wreck identified adds one first-time kind to the
exploration measure (#183 D4). Not one per wreck: S16 makes the supply
endless. Salvaged goods count as trade margin when sold; a fitting counts
nothing until it is sold.

## 4. Losses, and the Salvage job

**S21 — How many slots.** A system's derelict slot count is keyed on its
government, as raider slots are (`raiderSlotCount`): more in the lawless
governments, fewer in the lawful.

**S16 — Where new losses come from.** A slot starts empty. Its losses run on a
seeded schedule: the first loss is seeded across the future, and after a strip
the next follows a seeded gap. A derelict left unstripped for the **salvager
time**, counted from its loss, is taken by other salvagers: its row reads `salvaged` with no player
provenance, and the slot's next loss follows. A death wreck has no salvager
time.

**S14 — The poster is the derelict's home station.** Every derelict draws a home
station: the station that lost it. That station alone posts "recover our lost
X", naming one container: the fitting when there is one, otherwise the line of
highest value. Not every station posts, so boards differ.

**S15 — The offer window.** The offer shows for a seeded window after the loss.
After it the derelict is free salvage (S4). An accepted job stays valid after
its window closes. The offer shows the named container's tonnes, and acceptance
refuses with a reason when they exceed the pilot's whole hold, since an
entrusted item goes aboard whole (S20).

**S23 — What the job tells the pilot.** A lead: the region, the posting station
as its source and the age since the loss (#337 D5). The pilot searches by sweep
or by the visual floor. A Salvage job does **not** need the scanner; the relay
Bounty does (#489), and the difference is deliberate.

**S17 — The mark and the job's end.** The named container's tonnes reaching zero
is the mark: "the wreck's recoverable item is gone, once" (`ordinary-requests.md` §4).
A new instance has a new ordinal and new containers, so a repeat visit cannot
pay twice. If the named item is gone before the job is accepted, the offer
withdraws. If other salvagers take an accepted job's wreck while the named
container still holds tonnes, the job fails with a readable reason and is
cancelled free; once the item is aboard, the wreck's fate does not touch the
job.

**S18 — The operand.** A wreck reference — slot key, `instanceOrdinal`,
container index — plus a **snapshot** of the named item: its good or fitting id
and tonnes. Delivery is checked against the snapshot. The job pays 1.5 × the item's price at the posting station at acceptance, also kept in the snapshot, so the job pays more than selling the same item at the posting station. The contents are stored
on the row at the loss (S6), so the snapshot guards only the job against its own
record; the fitting list stays **append-only** so an id never names a second
module.

## 5. Starting figures

These are starting values, not measurements. The wreck build declares each as a
named constant and the principal's flight tunes them, as #660 D8b's 50% is
tuned by #705.

| Figure | Start |
| --- | --- |
| Derelict slots by government (S21) | 3 for governments 0–2, 2 for 3–5, 1 for 6–7 |
| First loss of a slot (S16) | seeded over the first 48 h of game time |
| Gap from a strip to the next loss (S16) | seeded, 6–24 h |
| Salvager time (S16) | 72 h |
| Offer window (S15) | 2 h |
| Visual floor (S9) | 10 km |
| Fitting container chance (S6) | 25% of instances |
| Salvage job pay (S18) | 1.5 × the item's price at the posting station |

## 6. Builds (S27)

### Death wreck implementation (node #705)

The starting survival share remains **50%**, not a measured balance result.
`DOMAIN.DEATH_WRECK` gives each owned cargo lot and each fitting its own draw,
keyed on world seed, exact death time and item identity. Adding or reordering an
item moves no sibling roll. The dying inventory is the input, so owned salvage
collected since launch is eligible (S19). Entrusted Requests lots, the hull and
every Escape Pod are excluded. Eject excludes fitted equipment; unfitted items
carried in the hold are lost cargo and remain eligible.

One optional `deathWreck` row sits in its galaxy's world envelope. The same
container row and scoop law serve both sources. Death adds only the lost hull
as a drawing recipe, a frame id and a translating offset; the hull is never
recoverable cargo. A death replaces the prior row and its own-loss knowledge
across all eight galaxies. A complete strip removes both. There is no expiry
and no other-salvager timer; a roll with no survivors leaves no row. The save
schema is **12**; versions 2–11 migrate without a death wreck, and a pre-12
record carrying one refuses. The optional empty domain is omitted, preserving
older world hashes without a world-schema or generator bump.

The pilot's actual frame is kept, including the relay's own translating frame.
A station-space death projects to the nearest centre outside both the station
proxy's keep-out sphere and its corridor cylinder, enlarged to clear the wreck
and tethers. The nearest-point tie on the axis uses the aperture reference.
The wreck's slow tumble changes no trajectory.

Own-loss knowledge is written at death with that time as its age. Later
observations preserve that source and time; only replacing or stripping the
wreck changes its knowledge row. It makes a
contact immediately anywhere in the same system, without a scanner. The
scanner's sweep and passive cue also read the row; sweep provenance can remain
after recovery. Recovered fittings consume hold space and use the existing
Equipment tab: an incompatible fit refuses with the hull-mount reason, while
selling remains available. No automatic sale or fitting happens in flight.
Gold, Platinum and Gem-Stones recover in their native kg/g quantities and, as
ordinary trade already does, consume no tonne hold space. A death container
persists its drawn line as `amount`, not `tonnes`, and `amount` and `left` carry
quantities in its explicit `unit` (`t`, `kg` or `g`). A generated derelict row
keeps `tonnes`, which it is and which schema 9 shipped. The parser requires that unit to match the commodity
table; fittings require `t`. Older generated derelict containers omit `unit`
and remain tonne-only.
This native-unit recovery belongs to wreck containers only; ordinary drifting
canisters retain their tonne-only scoop rule.

`tests/death-wreck.test.ts` covers the roll, save, placement and recovery law.
`scripts/probe-death-wreck.mjs` covers the real death/reload, painted wreck and
the live proximity scoop; its return is a controlled placement, not proof of
an approach flown by a person.

| Build | Carries |
| --- | --- |
| The derelict row: slots, schedule, contents and the save | S1, S2, S6, S16, S18's draw, S21 — and the amendments it owes `persistent-world-state.md`: §2's carrier namespace gains the derelict slot, §3.2's conditions gain `salvaged` |
| The wreck in the cockpit: drawn, placed, collidable and scooped | S3, S4, S5, S7, S8, S11, S13, S19, S20, S24, S26 |
| Finding a wreck: the sweep, the visual floor and the ladder kind | S9, S22, S25 |
| #705, the death wreck | S10, S12, and the commander-keyed row of the shape above, in world state (a death keeps the world, #654); it owes `persistent-world-state.md` §2 the commander wreck key |
| The Salvage family | S14, S15, S17, S18's operand, S23 |
| The broken-hull look | S26's second half |
