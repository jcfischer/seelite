# Depth, replayability and a roguelike layer — a proposal to discuss

Author: Ivy · 2026-10-03
Status: **proposal**, not a game contract. Nothing here is decided until a node
closes on it.

Inputs:

- Video: *The 7 Levels of Elite Dangerous Players* (`-RMm5vA0Ffo`, 8:42),
  transcript read via `yt-dlp` auto-subs. Second video (X4 Foundations): §7.
- Maps #1 and #460 as of today, and #407's product principles.
- Earlier work: open node **#238** (*A run mode: does seelite carry a roguelike
  layer, and on which axis?*) with children **#239** (what a run keeps) and
  **#240** (what bounds a run), from Algorithm run
  `seelite-roguelike-ideation-20260905`.

## 1. What the video says

Seven levels of *understanding*, not of rank:

1. **Observer** — watches, is confused by menus.
2. **Button masher** — boost and pray; learns what flying badly feels like.
3. **Grinder** — progress = credit balance. **Most players plateau here.**
   Ships get bigger, the pilot does not get better.
4. **Builder** — rebuilds the same ship three times because they understood
   something new. Ships become machines, not purchases.
5. **Specialist** — picks a lane, wins fights it should lose on paper, knows why.
6. **Veteran** — disengages from a bad fight early, with zero ego.
7. **Drifter / mentor** — logs in with no destination and still has a great
   session.

The useful idea for us: **depth is what keeps a player moving past level 3.**
A game that rewards only credits holds players at the grinder stage. A game
that rewards understanding moves them on.

## 2. Diagnosis: where seelite is for each level

| Level | What teaches it in seelite today | Gap |
| --- | --- | --- |
| 1 Observer | First useful day (#408), opening cinematic (#535), station control | Small |
| 2 Button masher | Hand docking without a computer (#408), three flight regimes, raiders | Small |
| 3 Grinder | Trade, jobs, three ladders (#183), `hullPriceCr` ladder | The stock deficit stops farming (#7). But the next goal is still *a bigger hull* |
| 4 Builder | Hull choice | `thrust` is a hull's one handling dial (CLAUDE.md). Little to *build* inside a hull — open question Q4 |
| 5 Specialist | Three ladders = three lanes; scanner, bounty, courier families | Good start |
| 6 Veteran | Raiders, relay defender, witnesses, Wanted | **A death costs little** — see F1 |
| 7 Drifter | Rama arc (optional), long-range scanner leads | Few things to *find* when you fly with no plan |

## 3. Findings from the code

- **F1 A death rewinds the whole world, not only the pilot.** A non-permadeath
  death copies the `lastDocked` save over `live` "byte for byte"
  (`src/save-store.ts:557`, `scripts/probe-death.mjs:9-11`). The save is
  `{world, commander}`, so a raider you killed on the fatal leg comes back to
  life. The cost of a death is the time since the last dock. The world
  *forgets* what you did — the opposite of #407's "the world remembers".
- **F2 Escape-pod insurance is specified, not checked here.**
  `docs/specs/combat-model.md:157` names a 1,000 Cr escape-pod model (respawn at
  last dock, cargo and undocked gains lost). I did not verify how much of it is
  built.
- **F3 Permadeath ends the flight, and then nothing follows.**
  `revertToLastDocked` returns `null` for a permadeath commander
  (`src/save-store.ts:560`); the ship stays destroyed and the Commander overlay
  opens (`probe-death.mjs:13-16`). The flag is "stated and not enforced" by
  design: an export or a slot copy brings the pilot back
  (`src/save-envelope.ts:306-314`). The galaxy has no memory of the dead pilot.
- **F4 #238's "verified facts" are stale.** It says no save is written and death
  is unhandled. Both changed (#89, #324, #564). #238 must be re-read against
  today's code before anyone grills it.

## 4. The central conflict

A roguelike **resets**. seelite promises a world that **remembers**.

Proposal: **the galaxy is the persistent thing, the commander is the mortal
thing.** Every roguelike option below is one way to put the line between those
two. This also answers #239's question with a twist: not only knowledge
persists — the *world's changes* persist too.

### 4.1 Principal's rulings (2026-10-03)

- **Q1 — yes.** The galaxy persists and the commander is mortal. That is the
  line.
- **Q2 — all changes stay.** On a death, everything in the world half of the
  save from the fatal leg is kept. Only the commander half goes back to the
  last dock.

What that split means, read from the two records
(`src/world-state.ts:360-369`, `src/save-envelope.ts:290-314`):

| Kept (world) | Reverted to the last dock (commander) |
| --- | --- |
| Kills, struck and diverted carriers, station damage (`objective`, `episodes`) | Credits, cargo, equipment, hull, tank (`state`) |
| Scans and leads (`knowledge`) | The jobs journal, with any kill evidence on it (`requests`) |
| Market deficits from trades on the leg (`deficits`) | Ladder records, so unbanked credit is gone |
| Visited systems (`visited`) | Position (back at the dock), drive charge |
| **Legal heat earned on the leg** (`legalStatus`) | — |

Consequences to check when the node is charted:

- **F5 Heat outlives the death.** An offence on the fatal leg still makes the
  pilot Wanted after the revert. That is the ruling working as intended, and
  the pilot should be told it on the glass.
- **F6 A sale is kept by the market, not by the pilot.** The deficit from a sale
  on the fatal leg stays while its credits are lost. Consistent, but it can
  look like a bug from the cockpit.
- **F7 A Bounty kill is lost to the pilot.** The relay stays destroyed in the
  world while the kill evidence on the request reverts (`src/requests.ts:61-95`).
  The pilot cannot claim it until the replacement relay is killed again. This
  is a cost of dying before docking. Decide whether the job stays open or is
  closed with a reason.
- **No lockout on first visits.** Exploration credit checks the ladder's own
  `visited` list (`src/ladder.ts:313-320`), which reverts with the commander, so
  a first arrival can be earned again.
- **#324's pin changes.** "Live becomes the last dock, byte for byte" becomes
  "the commander becomes the last dock's commander". That is a save-path change
  on #1, and #581 (play time across a death) fits inside it.

## 5. Roguelike options

| # | Shape | What it gives | Map | Save bump |
| --- | --- | --- | --- | --- |
| **O1** | **Stakes, not resets.** A death reverts the commander only; world changes from the fatal leg stay. The ship leaves a **wreck** at the death point (cargo canisters, log). Pod insurance as F2 specifies. | Teaches level 6: disengaging has a reason. Consistent with "the world remembers". | #1 (save mechanism, breaks #324's byte-for-byte pin and touches #581), #460 (what it costs) | Probably yes (wreck row) |
| **O2** | **Lineage.** The permadeath arm extended: a new commander starts in the same galaxy. Inherits world deltas and the map's last-known rows; ladders start at 0 (they never fall *per commander*). The predecessor's wreck is a findable derelict with their log and charts. An **epitaph postcard** at death. | A real roguelite where meta-progression is *knowledge*, not power. No chosen-one: the heir has no special status. | #460 (#238/#239) | Yes |
| **O3** | **Sorties.** A run *inside* the sandbox: a charter from a station into a fragmented cluster (short-tank reachability, #185). Fixed fuel, few or no stations, seeded derelicts and signals, one objective. Return with data, or lose the ship. Bounded by objective and fuel, not by a clock (sim time is never compressed). | FTL-style run structure with zero change to the career. Carries Rama clues. A good **second arc** candidate. | #460 (job family, authored rows per #356) | Maybe (new operand) |
| **O4** | **Seed challenge.** A shareable string: seed + start + permadeath on. Local run history, postcard at the end. | Cheap replay. | #460 / #1 | No |

Ruled out, with reason:

- **Meta-unlocks of hulls or prices** (#238's old O4): fights `hullPriceCr` as a
  law and #183's ladder gates.
- **Daily seeds, streaks**: #407 principle 1.
- **Leaderboards, ghosts**: no backend.
- **Starting backgrounds** (ex-navy, smuggler): conflict with "standing comes
  from actions, never a preassigned identity". A *debt* start could pass; Q6.

## 6. Depth options (not roguelike)

| # | Idea | Why | Map slot |
| --- | --- | --- | --- |
| **O5** | **Nemesis raiders.** Raiders are already named slots with a destroyed → repairing → replaced lifecycle. A raider that *escapes* (or a replaced one) remembers you: hails you by name, comes back refitted. | Story from state, not from a script. Makes fleeing and finishing a fight both mean something. | #460, encounters (#563) |
| **O6** | **The builder layer through mass.** Thrust is the one dial, and #181's law ties handling to mass. If every module has mass, a fitting choice *is* a handling choice: armour makes you slow, a big hold makes you a target. | Gives level 4 something to rebuild without a second tuning system. | #1 (law), #460 (what it costs) — Q4 first |
| **O7** | **Intelligence as cargo.** A lead already carries an age and a source. Make a fresh survey row worth credits at a station; it loses value as it ages. Rumours bought at a bar. | Exploration pays; information has a market. Lead stays provenance, never discovery. | #460 (exploration verbs; sensor reach) |
| **O8** | **Something to find in every system.** Seeded points of interest — derelicts, beacons, ancient signals — as authored rows bound to world state. Each first kind counts on the exploration ladder. | Level 7: a flight with no destination still finds something. Feeds O2's wrecks and O3's sorties. | #460 ("More exploration gameplay") |
| **O9** | **Encounters match learned skill.** An Elo that moves with wins, flees and deaths sets encounter strength. | Keeps pressure after level 3, without a level-scaling world. | #460 (open Elo question) |
| **O10** | **Capstone opens the unreachable.** One system in ~700 has no planet and no station (#23). The capstone could open a sortie (O3) into those — the lore of the empty places. | Gives the capstone a destination, not a reward. No capital, no save end. | #460 (capstone slot) |

## 7. What X4 Foundations adds

Second video: *The Incredible Sci Fi Sandbox That's Been Eating My Life*
(`3LAwODoSe94`, 51:06, Splattercat). Subtitles were rate-limited (HTTP 429), so
I transcribed the audio locally with whisper `base.en`.

The player's own words carry the lesson. Most of X4's depth comes from
**systems that feed into each other**: an economy where everything is built
and carried, factions that remember, missions built on intel that can be
wrong. Its cost is **menus**: "30 to 40 minutes inside of menus", "the UI is
monstrous", and "everything is bounce backable", which means low stakes. We
want the coupling between systems. We do not want the menus or the empire.

| # | X4 mechanism | seelite form | Constraint check | Map slot |
| --- | --- | --- | --- | --- |
| **O11** | **Missions on intel that can be wrong.** A scan job's target was "reinforced far more heavily than mission command would have had you believe." | A request's briefing is built from **last-known** rows with an age and a source. Older intel means a bigger chance that the world has moved, and the pay goes up with that chance. Risk becomes something a pilot can read. | Fits "facts carry an age and a source"; the operands still bind live state (#356) | #460 |
| **O12** | **A carried economy.** A shipyard could not build fighters because the parts had not arrived. Cutting a weapon-parts supply stops the warships. | A station capability (#358) depends on deliveries by **named carriers** (#359). Destroy or divert a convoy and that station's shipyard runs short. Feed it and it recovers sooner. All in one system, so it is not a faction sim. | Must stay a derived baseline plus deltas (#358); no galaxy-wide sim | #460 (what it means), #1 (world-state delta) |
| **O13** | **Satellites for overwatch.** The player deploys satellites to get a live view of a region. | A bought, droppable **relay buoy**: inside its system, leads stay age 0 until something destroys it. A direct answer to #460's open question "does any sensor reach past its own system". | A lead is still provenance, never discovery | #460 (sensor reach) |
| **O14** | **Standing that remembers, and can be repaired.** Kills near a hostile station earned "+8 reputation", and the player won back a faction they had robbed. | **Per-station standing**, not per faction: a station remembers what you did near it (the witnesses from #366 already record this) and how it treats you. Help it while it is under attack, and it forgives you. | Fits "affiliations through requests and reports, no polity sim" | #460 |
| **O15** | **Diablo-style weapon mods from salvage**, plus crafting. | **Seeded module variants** dropped from wrecks and derelicts (O8): one rolled trait and one cost, for example "+20% damage, +30% heat". A modest builder layer that also gives loot a reason. | `hullPriceCr` is untouched, because mods are on modules. Every new item needs a ladder gate (#183) | #460 (with O6) |
| **O16** | **Subsystems and skilled crews.** Shots took out engines ("can't go into travel mode"), and an enemy gunner was "a five star pilot". | Raider **pilot skill** as a property of the named slot (feeds O5 and O9). **Subsystem hits** (drive, scanner) that remove a regime until repaired. | Every regime must still be flyable (#1); damage cannot strand a save (drive regen rule) | #1 (damage model), #460 |

Ruled out for seelite: owning stations and fleets (an empire builder, against
"quiet frontier life" and the human scale in #407), on-foot sabotage (#1 rules
it out), wingmen with orders (multi-ship command UI conflicts with "cockpit
only"; the question is still worth asking, Q8).

## 8. Recommendation

1. **O1 first.** Smallest change, biggest effect on feel: deaths get a cost and
   the world stops forgetting. It is also the base O2 needs.
2. **O11 + O5 next.** Briefings built on aged intel and nemesis raiders use
   state the game already has (leads with age, named raider slots). They add
   risk that a pilot can read, which is the veteran lesson from the first video.
3. **O8 with O15**: something to find, and something worth finding.
4. **O12** as the long lever: it ties trade, combat and station damage
   together, and is X4's main lesson at seelite's scale.
5. **O2** as the meaning of the permadeath toggle; **O3** as the second-arc
   candidate.
6. **Refresh #238** with F4 and this framing before grilling it.

## 9. Risks

- **R1** O1 breaks #324's "live becomes the last dock, byte for byte" pin. A
  partial revert (commander only) must keep the save consistent — e.g. a
  carrier the pilot was docked into, a reserved berth, job state.
- **R2** A harder death may hurt new pilots. Guided first day could exempt the
  first N hours, or the pod cost could scale with the hull.
- **R3** O9 (Elo) and #183's ladders both measure skill. Two numbers for one
  thing can drift.
- **R4** O3 and O8 are content-heavy. Authored rows per #356 limit how fast
  they grow.
- **R5** X4's depth came with an unreadable UI. Each of O11–O16 must fit on an
  existing console tab or the glass; a new system that needs its own screen
  breaks "cockpit-only" and #407's readable surface.
- **R6** O12 makes station state depend on carrier history. That is more
  persisted world state, and the save ceiling measured in #89 must be checked
  again.

## 10. Questions to discuss

- **Q1** ~~Is "galaxy persistent, commander mortal" the line we want?~~
  **Yes** (§4.1).
- **Q2** ~~O1: should a death keep *all* world changes from the fatal leg, or
  only the kills and the wreck?~~ **All changes** (§4.1).
- **Q3** O2: what exactly does an heir inherit — map rows, credits fraction,
  nothing but the world?
- **Q4** What is in the equipment catalogue today, and does a module have mass?
  (I did not check; O6 depends on it.)
- **Q5** Is O3 (sorties) the run mode #238 asks about, so #238 closes on
  "inside the sandbox, on the exploration and combat axis"?
- **Q6** Is a debt start a background (ruled out) or a starting state (allowed)?
- **Q7** O12: is a station that runs short because its convoy died a "derived
  effect" under #358, or a new kind of world delta?
- **Q8** One hired wingman, with no command menu, flying the assist the way a
  raider does: is that inside "the player is always the ship"?
