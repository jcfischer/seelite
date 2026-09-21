# Station-X, Voyager and Rama: a proposed expedition arc

Author: Codex / Ivy · 2026-09-15 · Status: proposal, not an approved game contract.

> **Read as a dated record, not as current repo state.** The body landed
> unedited on 2026-09-21, as the story source that [#460](https://github.com/jcfischer/seelite/issues/460)'s Notes link to; this
> header note is the only addition. Two consequences.
>
> Its present-tense claims about the codebase — `SELECTED_FORM.trade`, what the
> relay slice implements, what UI exists — were read at local main `c0a89ac` on
> 2026-09-15 and have **not** been re-checked. Verify any of them before acting.
>
> And it was written without `CONTEXT.md`'s §Language open, so four of its words
> are that section's Avoid aliases: *legal status* and *reputation* for
> **Standing**, *pirate bases* for **Pirate relay**, and *active-request* for
> **Tracked request**. A node written against this document uses the glossary's
> words. The other flags a reviewer will get here are the alias rule firing on
> ordinary English, which `CONTEXT.md`'s **Berth** entry warns about by name:
> *slot* is canonical in `Carrier slot` and `Raider slot`, the *beacon* in
> "human observation beacon" is not a pirate relay, and *mission* is an alias
> only for an unconfirmed **Lead** — the spec is called
> `missions-and-requests.md`.

Principal correction, same day: **the pirate sensor relay prototype is partly built, and mission selection UI does not exist yet.** The next step is to inspect and finish the existing relay slice while providing its request/lead interface. References below to a first prototype describe the desired complete loop, not a proposal to restart it. The Babylon 5 extension at the end revises the sequence accordingly.

## Recommendation

Give seelite an optional expedition story running through its trade–fight–explore sandbox. Station-X is the effort's home, Voyager is its moving human presence, and Rama is the unanswered question pulling it outward. First prove that a player can change one route and recognize that change on return. Then use the same pattern to make the expedition possible.

The proposed premise: **civilization has learned to cross the stars without learning who else crossed them first.** An anomalous cylinder passes through the frontier. Its signal resembles fragments in old survey records. A fragile research expedition tries to follow it while commerce, piracy and competing claims continue around it. The player's importance comes from actions that make the expedition work, rather than a preassigned chosen-one identity.

## Current evidence and boundaries

- The [v1 map](https://github.com/jcfischer/seelite/issues/1) aims for a seeded trade–fight–explore browser sandbox. Missions remain unspecified; Rama's entity type, discovery and entry are explicitly fogged. Voyager's placement, operators and capital servicing are separately fogged. There is no settled overarching story in the material reviewed; the premise above is new.
- I interpret **Station-X** as the new [Wheel trade form](https://github.com/jcfischer/seelite/issues/332), after Space Station V. That node calls it `trade/e`, Wheel, rather than Station-X. It has one finished rim and one lattice rim under construction. It is **unselected**: `SELECTED_FORM.trade` remains `a`. Its availability as a model does not place a unique Station-X in play.
- [Voyager](https://github.com/jcfischer/seelite/issues/331) is the `expedition` hull; its selected model is Odyssey. It is a non-purchasable capital, fits no station aperture and has no current expedition placement. Do not widen berths to accommodate it.
- [Rama](https://github.com/jcfischer/seelite/issues/333) is a 50 × 20 km review model with no simulation role. Three modeled airlocks do not establish playable entrances or an interior.
- Combat's [first interdiction slice](https://github.com/jcfischer/seelite/issues/324) is being completed separately. Parts a–c and firing/controller work are merged; consequence and cargo payoff are in open PR #330 at this snapshot. Tutorial, pirate bases, police, legal status, bounties and rating are outside that slice. The combat node's opening description predates these merges.
- `CONTEXT.md`, `persistent-world-state.md` and `world-state.ts` already establish CarrierKey, operational condition, causal episodes, recovery and independent Last-known state. Those are usable foundations, not evidence that missions, survey knowledge or new infrastructure effects are already implemented.

Keep cockpit-only play, all flight regimes, deterministic generation, the real-rate game clock and sparse state. New UI belongs on a cockpit wall or console tab. Facts from unvisited places arrive through a defined information channel, with age and source; opening a map must not reveal hidden objective state.

## Three places with three different jobs

### Station-X: the unfinished promise

**Story:** a trade station turned expedition assembly point. Its second wheel is unfinished because funding and shipments have become unreliable. The station hosts a research coordinator, local haulers and a salvage broker; these are initially affiliations expressed through requests and reports, not a general faction simulation.

**Activities:** bring machinery and research supplies; investigate overdue shipments; practice combat on production rules in a station training tab; accept survey commissions; choose between a well-paid private claim and publishing a discovery. Existing commodity trading continues alongside these jobs.

**Consequences:** repairing a named construction service enables an expedition-support berth or service; restoring a supply route permits Voyager's next departure; a returned survey produces a usable lead. Tie each reward to a specific capability. Ordinary market sales must not secretly advance a mission: explicitly committing a shipment owns cargo consumption and progress.

**First version:** one coordinator and one outbound request. Keep the Wheel geometry fixed. Construction progress appears in the service's condition, reports and supporting activity; showing the second wheel becoming complete is a later visual decision with its own review. The early payoff should arrive after one local sortie rather than a long shopping grind.

**Placement proposal:** one designated trade Carrier slot per galaxy hosts Station-X, selected deterministically from reachable, suitable systems. Its form override must preserve the selected docking contract and be checked geometrically; rendering an unselected form is not enough. Do not rename every Wheel station Station-X or change every trade station's role.

### Voyager: the expedition you can actually meet

**Story:** a vulnerable expedition capital pursuing the signal. Its crew has a working hypothesis rather than the answer. Stable identity and callsigns make later meetings recognizable.

**Activities:** rendezvous at a known holding point; carry a replacement component; scout its next survey location; return a recorder lost by a probe; eventually protect a departure or inspect a radio-silent Voyager. A cold, intact ship with an incomplete report can be more interesting than another enemy group.

**Consequences:** a repaired communications carrier yields a fresh survey report; an assisted recovery enables the next rendezvous; loss of a probe denies a particular observation until replaced. Save mission commitments and changed carrier conditions, derive routine location from a bounded itinerary and the game clock. A new expedition schedule is a design to settle, not an automatic reuse of station Traffic.

**Capital interaction:** initially operate through Station-X and a small dockable courier. The player can approach and identify Voyager, but it does not dock at a station or accept player docking by implication. Close-range component transfer, matching its velocity, capital outfitting and attached service craft need explicit interaction rules before expansion.

**First version:** one stationary in-system rendezvous and one report returned through the ordinary station console. Avoid a required multi-jump escort while inter-system Traffic is unresolved. The capital should be a recurring character before it becomes an elaborate mobile base.

### Rama: an encounter with something outside the economy

**Story:** a silent alien vessel whose behavior is physically observable but whose purpose remains uncertain. It is neither a commodity warehouse nor a raid boss. Voyager and Station-X disagree about the implications of the evidence, which creates choices without requiring Rama to speak.

**Activities:** follow a sourced rumor to a search region; identify a candidate object; approach its vast hull; take readings at separated external features; recover a human probe near it; compare those observations with Voyager's records. Survey should involve useful piloting—viewing geometry, line of sight and relative velocity—rather than a scanner button held while stationary.

**Consequences:** a triangulated track produces a reliable next intercept lead; an external survey establishes a safe approach bearing; repairing a human observation beacon refreshes local tracking. Decide whether to publish the track for independent researchers or sell an exclusive early report. Later implementation can make publication enable additional expeditions and private sale fund an exclusive service; those effects need carriers and explicit knowledge-sharing rules.

**Entity recommendation:** a unique, persistent physical landmark carrier, with generated trajectory and geometry, separately projected into target selection and rendering. It needs an authoritative collision/keep-out representation and cruise arrival rules; a display contact alone cannot supply those because current cruise and mass guards are body-based. It should not enter the ordinary planet distribution or commodity-station pool.

**First version:** exterior survey only, on a stable encounter segment. Keep Rama reachable while the player learns. Entry is a later decision: a ship-scale access chamber could honor cockpit-only play, but modeled airlocks prove neither fit nor navigable interior. The full inhabited cylinder would be a separate major project.

**Later option:** a predictable flyby with a published game-clock observation window. Introduce this only after a generous, repeatable first encounter. Deadline failure loses an observation or changes a rendezvous; it must not erase the entire story for a pilot who took time to learn.

## How the story unfolds

1. **A small job, a strange report.** At an ordinary trade station, a request leads to Station-X. A recovered survey record contains an anomalous bearing. The player still chooses how to earn their living.
2. **Make the route usable.** Station-X needs a relay or observation installation restored or hostile surveillance disabled. Returning reveals the concrete difference: a missing pirate detection capability, a refreshed report, or an available departure.
3. **Meet the people following it.** Voyager is encountered at a rendezvous. Its report narrows the search; a small contribution helps its next observation rather than filling an abstract reputation bar.
4. **The object becomes real.** Rama changes from rumor to an enormous physical presence. Survey reveals something that does not fit the human hypothesis. Place a rewarding partial discovery early; delay a fuller explanation rather than delaying all access.
5. **Choose what happens to the evidence.** Publish, sell privately, or withhold a specific report for another observation. Distinct later capabilities and information access make the choice legible. No universal moral score is necessary.
6. **An expedition can end while the sandbox continues.** Deliver a coherent survey result and enable the expedition's next stage. An ending can show the installations and people changed by the player while leaving Rama's builders unresolved.

Use authored episode structures with seeded places, personnel and clue variants. Procedural everything can still include carefully written text and rules; avoid random prose generation as a substitute for causal continuity. These are seelite's own story roles inspired by the models, not a commitment to merge the books' and film's canon.

## What would improve interest next

| Priority | Improvement | Why it earns the work | Boundary |
|---|---|---|---|
| 1 | Finish the partly built discover → intervene → persist → revisit route | Makes the world remember something beyond inventory and a duel | Inspect and reuse the existing [pirate sensor relay prototype](https://github.com/jcfischer/seelite/issues/43); integrate production combat consequences |
| 2 | Provide mission selection: one station request, one tracked lead, one attributable report | Gives a flight a purpose and makes its result understandable | UI is absent; derive only the mission abstractions the existing slice needs |
| 3 | Voyager rendezvous and one external survey | Adds a peaceful activity using the same flight skills | Fixed local rendezvous first; no capital docking or escort AI implied |
| 4 | Resolve [rating and endgame](https://github.com/jcfischer/seelite/issues/183) | Hull gates already depend on it; accomplishments need a useful meaning | Keep combat rating distinct from trade/exploration access; do not require kill grinding for Rama |
| 5 | Pirate infrastructure and repair operations | Connects tactical victory to a reason threats return; eventually supports hunt, protect and restore jobs | Build from the relay result, not a universal base/faction framework |
| 6 | Tutorial and sensory feedback | Helps pilots understand the flight/combat loop and makes successful actions readable | Production combat rules; focused synthesized cues for lock break, survey completion and service recovery |
| Later | Run mode, inter-system escort, full Rama entry | Could deepen replay and discovery once the core loop earns replay | Existing run-mode and inter-system Traffic decisions remain unresolved |

Vary what the player is trying to accomplish, not just enemy count. A dangerous shipment, a cold-ship investigation, a precision survey and an infrastructure repair create different decisions using the same flight world. Rewards should include knowledge and access as well as credits. Let traders fund and transport, fighters remove threats, and explorers establish routes; none must become all three to see the mystery.

The reported economy ceiling reaches a full kit quickly, so adding expensive gear alone is a weak long-term motivation. Exploration needs questions with usable answers; trade needs requests connected to visible needs; combat needs objectives whose aftermath matters. Revisit rewards should be local and believable, not galaxy-wide peace after one relay kill.

## Recommended first playable slice: the missing survey shipment

Use the relay prototype's existing question as the mechanical experiment. Proposed fiction: a survey shipment bound for Station-X was tracked through a pirate sensor relay. A broker offers its last report and asks the player to make that route usable. This is a framing proposal for that node, not its approved resolution.

**Scope:** one fixed generated system, one route, one relay Carrier slot, one minimal request and one return report. An initial temporary console treatment is sufficient. No Rama placement, Voyager behavior, faction simulation or general mission generator is required. Station-X can appear in the request text while live Wheel placement is separately resolved.

**Loop:** receive a sourced lead → observe the relay's effect → reach and disable it with production combat verbs → observe the immediate loss of that capability → leave or save/reload → return → receive an attributable route report → learn that the shipment carried observations of an unknown cylinder.

**Before implementation, settle the capability.** Prefer one concrete detection dependency: this relay enables a specified raider slot to initiate interdiction on this named route. Disabling it removes that initiation capability while it is unavailable. Other raiders and other routes remain dangerous. Existing encounters must not disappear mid-duel. The system-wide leg encounter draw needs an explicit route association for this experiment; attaching a new object to world-state alone will not change combat behavior.

**Proposed acceptance checks:**

- The lead supplies enough information to find the target without debug placement.
- The relay demonstrably enables one named threat capability before intervention and denies it afterward, with encounter cases controlled for seed, route and carrier availability.
- The disablement records player provenance under a stable CarrierKey; duplicate submission cannot consume cargo or pay twice if a shipment/reward is included.
- Departure, return and save/reload preserve the operational consequence. Knowledge of off-screen recovery refreshes only through the declared information channel.
- Any recovery is a named, visible, interruptible process on the authoritative game clock, with identity linked to the same causal episode.
- The return report and in-world evidence let the pilot explain what changed and why. The principal flies the before/after route and judges whether it was worth doing.

Do not infer success from a quest-complete banner or a green serialization test. If the route feels identical, revise the capability before broadening content.

## Decisions sharpened for the map

These questions should be settled individually with the principal; this proposal does not answer checkpoint gates or close fog.

1. **Rama as a physical landmark:** approve its entity contract, discoverability and exterior-only first encounter before implementing trajectory, cruise arrival and collision behavior.
2. **Voyager as an NPC expedition capital:** settle one local rendezvous and station-mediated support before capital servicing or a moving multi-system itinerary.
3. **Station-X as a unique Wheel trade station:** confirm the name/model interpretation, deterministic placement and which named expedition service it hosts.
4. **One expedition request and return report:** derive the smallest commitment, reward and knowledge state from the successful relay slice; new typed save domains require schema/version policy.

Attach implementation work beneath the decision that produced it. Keep the combat branch's ownership intact. Existing [inter-system Traffic](https://github.com/jcfischer/seelite/issues/262), [rating](https://github.com/jcfischer/seelite/issues/183) and run-mode questions retain their own scope.

## Verification of this proposal

- Grounding: live map and nodes 41, 43, 183, 324, 331, 332; merged model PRs 334–336; open combat-payoff PR 330; local main at `c0a89ac`; relevant specs and implementation seams read on 2026-09-15.
- Coverage: every model has a story role, cockpit activity, attributable consequence and bounded first version. The next slice has a dependency boundary and proposed playtest checks.
- Limit: this is source-backed design analysis. Fun, balance, mission duration and renderer performance have not been measured. No game behavior, tracker state or approved contract was changed.

## Babylon 5 inspiration: a frontier built on someone else's history

The useful transfer is a relationship between everyday work, competing institutions and ancient history. The following seelite concepts are original proposals; the cited Babylon 5 material supplies inspiration rather than shared canon.

### A neutral station with people worth returning to

Babylon 5 brings multiple civilizations and continuing political conflicts into one recurring station setting. Its story changes that setting over time ([series setting and synopsis](https://en.wikipedia.org/wiki/Babylon_5)).

For Station-X, neutrality is an operational promise: pilots with competing patrons can use the same trade station. Three recurring contacts are enough initially: the station coordinator wants supplies and stability; Voyager's scientist wants evidence; a salvage broker wants exclusive claims. They remember the current request's result through sourced reports. Each should sometimes be useful and sometimes disagree with the others.

A request to repair an observation service now has a political consequence: is its data available to all pilots, or only the organization paying for the repair? A rival can offer a better price to receive the recorder privately. Both offers describe their consequences before acceptance; neither needs a diplomacy screen or galaxy-wide influence number.

### A commercial survey that becomes first contact

In "Mind War," independent surveyor Catherine Sakai takes a commercial survey near Sigma 957 and encounters an enormous unknown vessel ([episode account](https://pages.astro.umd.edu/~mhayesge/Reviews/B5/s1-mindwar.html)). This is the closest fit to seelite's existing loop.

Start with a well-defined paid task: collect observations at three exterior positions near a reported object. During the job, the object changes orientation or emits a patterned signal. The player completes useful piloting and leaves with one observation the client cannot explain. A second contact recognizes a fragment of the pattern. This makes mystery emerge from a flight, with an answer useful for the next flight.

Rama's indifference is part of the encounter. Its first response could be to an observation beacon rather than to the player's weapons. Give pilots measurable observations and clear safe-approach cues while leaving the interpretation uncertain. High combat power need not be the solution to an ancient encounter.

### Voyager as a frontier explorer with recurring needs

"A Distant Star" features the Explorer ship Cortez resupplying at Babylon 5 and later needing rescue ([episode account](https://pages.astro.umd.edu/~mhayesge/Reviews/B5/s2-adistantstar.html)). Voyager can play this recurring explorer role without borrowing its exact crisis or Babylon 5's travel rules.

Voyager returns from survey work with depleted stores, damaged probes and partial reports. A player may resupply it as a trader, retrieve a recorder as an explorer, or make an approach route safer as a fighter. A local radio-silent rendezvous can begin as an investigation rather than an escort battle. Its captain and scientist provide continuity through brief messages, using the same stable ship identity across episodes.

### Ancient machinery that grants information, with conditions

Babylon 5's Great Machine records distant events and requires a living custodian; it offers a useful example of ancient technology as infrastructure rather than merely a weapon ([Babylon 5 Encyclopedia preview](https://b5books.com/wp-content/uploads/2017/09/B5-Encyclopedia-Preview-B5books_Com-1.pdf)).

Proposed seelite interpretation: Rama may be a mobile caretaker of a much older observation network. The relics initially mistaken for abandoned installations still exchange signals. Pirate equipment has tapped one of those channels. Recovering a recorder from the partly built relay slice can provide the first hint; this should not change the relay's approved mechanics without a decision.

Repairing one human interface to the network could yield a fresh local track or warning. Each station remains a bounded information source: coverage, timestamp and missing observations are explicit. The player restores a useful capability without unlocking an omniscient galaxy map. Rama's custodians, if any, can remain unseen.

### Offers of help that ask the player to surrender something

Babylon 5's older powers use younger civilizations in a proxy conflict; the central themes include imposed order, conflict and the younger races' independence ([series themes and season-four synopsis](https://en.wikipedia.org/wiki/Babylon_5)).

Initially represent this through two human patrons interpreting ancient material differently. A charter authority offers reliable services and protected research under restricted distribution. Independent prospectors offer open survey access and valuable private claims, with fewer guarantees. Over time the evidence can suggest that their assumptions were influenced by different ancient sources. Establish observable human stakes before declaring a cosmic war.

An example request pair: the authority will fund an observation installation if it controls the reports; an independent group will help restore it for public use if the pilot delivers a missing component. The later difference is who can receive a report and which expedition can use it. A third solution may emerge from the player's recovered evidence rather than always appearing as the best menu option.

### Discovery can create a problem that must be contained

"Thirdspace" revolves around an ancient artifact whose activation opens a dangerous gateway ([film plot](https://en.wikipedia.org/wiki/Babylon_5:_Thirdspace)). The transferable idea is that restoring an artifact is a consequential choice.

For a later seelite episode, powering an ancient signal repeater might expose Voyager's location to an unknown listener. The pilot then has to retrieve the diagnostic recorder, evacuate a courier or disable the human interface. Make activation an explicit action with prior warning signs. The first version can change one local threat or information capability; a new dimension, new jump physics and enormous enemy fleets are not prerequisites.

## Revised next step: a Requests tab that exposes the work already underway

The mission interface is the missing bridge between existing mechanics and these stories. Proposed first home: **Requests**, beside Market and Equipment on the docked station console. Its first content is authored around the existing relay slice.

The selection flow is list → details → explicit acceptance. Each offer shows:

- Who is requesting the work and why.
- The action, known target or search region, and source/age of the lead.
- Expected danger, cargo/equipment requirements and whether the target is currently reachable.
- Payment plus the concrete service or information consequence.
- Any deadline, exclusivity or commitment that applies; uncertainty is named rather than hidden.

Separate **offers**, **accepted work** and **unconfirmed leads**. Reading a rumor does not accept a contract, and accepting a request does not reveal the hidden target's exact position. In flight, a small active-request entry gives the next action and permits tracking its known target or search region. If an exact target is learned later, tracking can update then. A return/report action on the station console owns completion and prevents duplicate rewards.

Proposed initial scope: one active request; a supported cancel path with plainly stated consequences; a compact stage-based record persisted under a stable request identity. Persist commitments and acquired observations, derive offered work from the world where possible. If a target is destroyed or unavailable, report the changed situation and permit the appropriate failure or alternate return; never leave an impossible marker as the only instruction.

**Revised sequence:** inspect what the relay prototype already implements → design the smallest Requests tab and active-work cue → complete the relay's before/after route and report → add a local Voyager survey/resupply episode → resolve Rama's physical entity and exterior survey → introduce rival patrons when two distinct consequences actually exist.

The resulting opening could be: a routine relay job yields an anomalous recording; Voyager identifies a related observation; Station-X offers a paid follow-up survey; the pilot meets Rama; two patrons offer different ways to use the evidence. This provides a gradual increase in significance through ordinary flying, with a recognizable home and recurring people.

Verification of this extension: the principal supplied the partial-relay/UI correction; base-checkout source search did not reveal a mission-selection implementation. Lore was checked against the linked sources. The extent and authoritative branch of the partial relay work still need direct inspection before implementation. No runtime or tracker changes were made.
