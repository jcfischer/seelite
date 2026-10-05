# Requests

Author: Codex / Ivy · 2026-09-15
Status: D1–D8 are agreed. The detailed proposal becomes ratified on principal-approved merge recorded in the linked decision's resolution.
Decision node: [How a pilot chooses, accepts, tracks and reports a request](https://github.com/jcfischer/seelite/issues/337).

## Agreed decisions

### D1 — Multiple accepted requests

The pilot may accept multiple requests concurrently. The first version must not impose the starting proposal's one-active-request limit.

Principal evidence, 2026-09-15: asked whether the first version should allow one active request while collecting leads and browsing offers, or multiple active requests; the principal selected **“Multiple active requests”**.

### D2 — One manually tracked request

The pilot manually chooses one accepted request to supply the cockpit next-action cue. Tracking is independent of commitment and progress: every accepted request can progress when its conditions are met, and accepting another request does not change tracking.

Principal evidence, 2026-09-15: the principal selected **“Manually track one request (Recommended)”** after being offered that behavior versus showing cues for every accepted request.

### D3 — Free cancellation with disclosed special terms

The pilot can cancel an accepted request anywhere. Requests have no deadline or reputation penalty by default; special terms must be disclosed in the offer before acceptance. Entrusted cargo requires an explicit return or loss settlement rather than becoming free player property on cancellation.

Principal evidence, 2026-09-15: the principal selected **“Free cancellation; special terms disclosed (Recommended)”** after being offered that policy versus a failure penalty on every accepted job. The question explicitly included settlement for entrusted cargo; D7 subsequently settled its ownership and return rule.

### D4 — Return to the requester to report

For the first relay request, intervention changes the world immediately and satisfying the objective marks the request ready to report. The pilot must return to the requester and explicitly report the result to receive payment once; remote reporting from flight does not complete the request.

Principal evidence, 2026-09-15: after the recommendation described immediate world consequence, ready-to-report state and explicit one-time payment, the principal was asked whether return should be required or reporting allowed remotely; the principal replied **“return required”**.

### D5 — Search before exact target tracking

The first relay request supplies a sourced lead and search region instead of an exact hidden-target position. Accepting the request does not disclose the relay's coordinates. Once the pilot identifies the relay through the search, tracking may point to the known object.

Principal evidence, 2026-09-15: asked whether the first relay job should require a search using a sourced regional lead or provide a known target position immediately; the principal replied **“needs search”**.

### D6 — Requests on the existing consoles

While docked, Requests is the third station-console tab beside Market and Equipment. In flight, a Requests tab on the left console lets the pilot review accepted jobs and manually change tracking. A compact cockpit cue shows the tracked request's next action. The interface uses the existing cockpit and controller focus grammar.

Principal evidence, 2026-09-15: the principal answered **“yes, good”** to that placement, including the docked tab, in-flight left-console tab and compact tracked-job cue.

### D7 — Entrusted cargo remains requester-owned

Cargo entrusted by a requester occupies the ship's hold and cannot be sold. Cancelling ends the job, but entrusted cargo remains aboard and marked for return to its requester. Lost cargo incurs only a fee disclosed before acceptance. The first relay request requires no entrusted cargo.

Principal evidence, 2026-09-15: the principal answered **“yes”** to that ownership rule, including hold occupancy, no sale, return after cancellation, disclosed loss fees and no entrusted cargo in the first relay job.

### D8 — Reaccept cancelled unfinished work

A cancelled, unfinished request may be accepted again later. Completed work cannot pay again. Outstanding entrusted cargo from the previous acceptance must be settled before another lot is issued.

Principal evidence, 2026-09-15: asked **“Should a cancelled, unfinished request be available to accept again later?”**, the principal selected **“Allow reacceptance of unfinished work (Recommended)”**. The question expressly included protection against repeated completed-work payment and settlement before another cargo issuance. It did not ask to reopen failed requests.

### Clarification — No invented competing intervention

The first relay contract must not assume another player or an NPC can disable the relay. This is a single-player game, and no autonomous competing relay intervention has been established. The proposed “already resolved by someone else” outcome and reconnaissance-payment policy are withdrawn, not agreed decisions.

Principal evidence, 2026-09-15: the principal challenged that scenario: **“this is a single player game, so no one else would be able to disable the relay (unless I am missing something)”**. Existing generic recovery and provenance types are not evidence that such an actor exists for this relay. Any relay repair or replacement remains subject to the relay prototype's explicitly chosen recovery behavior.

### Clarification — Relay is unbuilt

The relay is treated as unbuilt. Reuse the existing carrier persistence, knowledge, recovery and raider encounter foundations, but do not claim they constitute an implemented relay. Building the relay and proving its route effect remain work of the [pirate sensor relay prototype](https://github.com/jcfischer/seelite/issues/43).

Principal evidence, 2026-09-15: after the agent could not locate a dedicated relay implementation and asked where the reported partial prototype lived, the principal clarified **“afaik the relay was never built”**. This supersedes the earlier partial-build assumption in the request node and related follow-ups.

## Current implementation evidence

- `src/station-console.ts` defines `StationConsoleTab` as `Market | Equipment`; `src/live-cockpit.ts` renders those two tabs. Requests selection is an extension to this existing docked station console.
- `src/pad-bindings.ts` provides console row navigation, shoulder-button tab changes, activate and back. `src/panel-focus.ts` owns the reusable focus behavior.
- `src/save-envelope.ts` carries world and commander in one save envelope and owns `SAVE_SCHEMA_VERSION`. `src/world-state.ts` separately owns `WORLD_SCHEMA_VERSION` and `WORLD_GENERATOR_VERSION`. A request-state addition must identify which boundary changes rather than bump every version indiscriminately.
- `src/world-state.ts` already owns carrier condition, causal episodes, recovery and sourced knowledge. `src/raider-slots.ts` supplies stable raider slots and per-spool encounter draws. These are available reuse foundations; they do not by themselves prove a pirate sensor relay is implemented or linked to a named route.
- No dedicated pirate sensor relay implementation was located in the inspected main source and local nested worktrees; the principal subsequently clarified it was never built as far as they know. Do not confuse it with `observeSystemRelay`, the existing public station-information channel.

## Detailed contract proposed for ratification

The following rules complete D1–D8. They are proposed implementation rules until the principal ratifies this document through the linked decision. No relay, Requests UI or request runtime is delivered by this specification.

### 1. Offers, requests and leads

- An **offer** is work available from a named requester. Opening its row shows details; only its explicit Accept action creates an **accepted request**. Reading an offer, rumor or lead does not accept work.
- A **lead** is sourced intelligence, independent of acceptance. It may be unconfirmed or identify a learned object. The pilot may retain leads without accepting their associated offers.
- Each offer has a stable identity inside the saved world's namespace: galaxy index, requester CarrierKey and authored offer slot. The existing envelope's seed supplies world scope; it is not duplicated as an object identity. A fixed first-episode offer is not regenerated on docking, tab changes or clock epochs. Display names and list positions never supply identity.
- An accepted request is keyed by that offer identity and pins its content revision and terms at acceptance. Changing the available offer later cannot change promised payment, penalties or objective conditions for an accepted job.
- A lead has a stable signal/report identity within the world namespace, source identity, observation time on the authoritative game clock, learned region and optional identified carrier reference using the full galaxy-scoped identity below. A newer observation refreshes that lead; UI reads derive its age from the clock. Updating intelligence does not silently accept work or change tracking.
- Requester, target, identified-lead and objective-evidence references reuse the full logical CarrierKey `(galaxyIndex, systemIndex, localCarrierId)` owned by `persistent-world-state.md` §2 and §7. In current code, `src/carrier-key.ts` brands only the envelope-relative `systemIndex:localCarrierId` string. Since this journal is outside a galaxy envelope, serialize each reference as `{ galaxyIndex, carrierKey }`, carrying that unchanged validated string and its explicit galaxy index. This is the existing identity with its containing galaxy restored, not a new key encoding or namespace. Identical local keys in different galaxies must not collide; names are display labels only.
- The first content set is finite and authored. Multiple offers may be accepted concurrently; there is no implicit single-request limit. Repeating content requires a separately designed episode identity, not clearing the completed row or rerolling the same offer.

`OfferId` is a branded canonical string with format `request-v1/<galaxyIndex>/<systemIndex>/<encodedLocalCarrierId>/<encodedAuthoredOfferSlot>`. Numeric components use their canonical decimal form within the existing galaxy/system bounds; the two textual components use canonical `encodeURIComponent` encoding and must decode to an existing carrier identity and supported authored offer entry. Carrier components reuse `carrier-key.ts`; this introduces a request key, not a replacement carrier key. The saved world's namespace supplies the seed. Loading requires each `byId` key to equal its row's `offerId` and all lot/evidence references to resolve consistently.

### 2. Required offer details

Before acceptance, show all of these fields, with “none” or “unknown” where applicable:

| Field | Meaning |
| --- | --- |
| Requester and report location | Named source of the job and the station to which the pilot must return |
| Purpose and action | What is needed and the exact action or observation that satisfies it |
| Known region and intelligence | System, search-region description, source and age; no unlearned exact hidden coordinates |
| Danger | Expected threat and uncertainty, without claiming information the requester lacks |
| Cargo | Player-procured or entrusted; quantity, hold usage, reservation and return/loss terms |
| Equipment | Required equipment and any currently missing requirement |
| Payment | Fixed credit amount and any expressly promised report/access reward; when it is paid |
| Concrete consequence | The local capability the action changes, distinct from the credit reward |
| Special terms | Deadline, exclusivity, loss fee or other failure penalty; default is none |

Acceptance is an atomic eligibility check. Refuse with a readable reason if requirements, hold capacity, an explicit exclusivity rule or offer availability fail, or the offer already has an accepted, ready-to-report or terminal row. A cancelled row uses Reaccept instead of creating another row. A refusal changes neither commitment, cargo nor credits. Offer browsing remains available even when acceptance is ineligible.

The first relay offer has no deadline, exclusivity rule, entrusted cargo or loss fee. Broader exclusive-report choices belong to the competing-evidence decision, not to an invented multiplayer race. Later special terms require explicit offer text and authored predicates; a missing field never means an undisclosed penalty.

### 3. State transitions and progress

| Event | Preconditions | Result |
| --- | --- | --- |
| Read offer/lead | Visible known information | Open details or retain a lead; no accepted request, cargo transfer or payment |
| Accept | Valid available offer; no existing request row; requirements and special terms pass | Create accepted request at its first unsatisfied stage with acceptance ordinal 1; pin terms; transfer any entrusted cargo once |
| Reaccept cancelled work | Same unfinished offer; requirements pass; prior entrusted-cargo obligations settled before any new issuance | Reactivate the same request identity and pinned terms; increment acceptance ordinal; retain valid non-cargo evidence and re-evaluate cargo stages for the current issuance; do not change tracking |
| Track | Named request has accepted or ready-to-report status | Change the single tracked request; no progress, target discovery or flight-target change |
| Untrack | Any request tracked | Clear the tracked cue; commitments remain |
| Identify | Explicit observation satisfies the authored identification rule | Record sourced knowledge; search stage advances; a known target becomes eligible for exact tracking |
| Satisfy objective | Authored condition and any required player provenance are met | Store bounded objective evidence; advance stage or mark ready to report; world consequence takes effect when intervention occurs |
| Report success | Ready to report; docked at the named report station; no prior settlement | Atomically settle committed cargo, pay pinned reward, mark completed, clear tracking if this request is tracked and expose any promised report once |
| Cancel | Request has accepted or ready-to-report status | Mark cancelled anywhere; clear tracking if this request is tracked; release player-cargo reservations; retain entrusted-cargo return obligations; no success reward |
| Return entrusted cargo | Docked at its requester; unsettled return obligation | Remove returned goods from the hold and mark their lot settled once; retain the lot record until a new issuance supersedes it; do not revive the cancelled job or pay its success reward |
| Settle lost entrusted cargo | Loss is established; disclosed settlement terms apply | Apply the disclosed fee once and settle the lost portion; cancellation itself does not declare aboard cargo lost |
| Meet disclosed failure condition | Request has accepted or ready-to-report status; authored deadline or other explicitly accepted failure condition occurs | Mark failed with a reason; clear tracking if this request is tracked; release player-cargo reservations and apply only disclosed terms; retain any unsettled cargo obligations |

The first relay's authored objective stages are **search → identify → disable**. Satisfying all three moves the request to ready-to-report status; successful reporting moves it to completed status. These are authored objectives, not elapsed scan-button timers. Search detection range and identification mechanics are experiment details owned by the relay prototype; the interface cannot claim discovery from a fixture that already exposes the target.

`stageId` names the first unsatisfied authored objective, or retains the final objective's ID when all are satisfied; it never contains a request-status value. Bounded evidence determines which objectives are satisfied. The transition boundary updates stage and status together: an ongoing request is accepted while an objective remains, and ready to report when all are satisfied. Completed, cancelled and failed statuses record settlement or disposition and retain their objective evidence. Load validation rejects disagreement with those rules rather than treating stage and readiness as separate authorities. The glossary's Accepted request is the umbrella commitment term; action preconditions use the explicit status values where that distinction matters.

Every accepted request listens for qualifying progress independently of tracking. One action may satisfy several distinct compatible requests, but a particular cargo unit cannot be delivered or reserved twice. Rewards are per distinct authored contract, not per repeated button press.

Completed and failed rows are terminal; a cancelled row may return to accepted or ready-to-report through explicit Reaccept. The fixed first relay offer cannot pay again after success settlement. Reaccept uses the same identity and pinned terms: it does not clone the job, erase success receipts or retroactively record interventions performed while cancelled. Valid evidence earned while previously accepted remains available, so cancelling a ready-to-report relay request does not require inventing a replacement relay to resume it. A future repeatable completed offer must name a new episode and must not pay for evidence already settled under a previous episode.

For reacceptance, unfinished means no successful report settlement, including satisfied objectives awaiting report. Reaccept is offered only for cancelled rows; failed rows remain terminal under these proposed transition rules.

Once a qualifying intervention is recorded after acceptance, its success evidence persists. A later repair does not revoke that success unless the offer explicitly required a condition to remain true at reporting. The first relay offer rewards the disabling intervention; it does not require the relay to remain disabled indefinitely. This rule permits an explicitly designed recovery later without inventing one now.

### 4. Cargo and reward ownership

Entrusted cargo is a separate request-owned lot, linked to its request, requester and return location. It occupies hold space alongside ordinary cargo but is excluded from market sale. No cancellation, save/load or commodity-name merge converts it into the player's property. Partial loss distinguishes aboard and lost quantities; aboard goods cannot be removed by paying a fictitious loss fee.

Player-procured cargo remains player-owned until delivery. If the offer explicitly commits quantities, reserve those quantities per request; commerce and other deliveries may use only the unreserved remainder. Cancellation releases those reservations. Offer details distinguish these goods from entrusted cargo before acceptance.

The existing hold capacity and commodity units remain authoritative. Every capacity consumer—purchase, scoop, request acceptance, equipment/hull changes and hold readout—must account for entrusted tonnes without duplicating cargo in `CommanderState.cargo`. The present `station-commerce.ts` helpers count ordinary commodity cargo only, so an implementation must extend their shared boundary before adding entrusted-cargo lots; a display-only hold deduction is insufficient.

A future entrusted-cargo offer must name the implemented event that establishes actual loss and disclose its settlement rule before acceptance. That event moves only the affected units from aboard to lost, retaining issuance identity and provenance; opening Requests or pressing Cancel cannot establish loss. A hull/equipment change that would leave insufficient capacity is refused atomically instead of silently discarding goods. If a disclosed loss fee exceeds available credits, settlement is refused without mutation and the obligation remains; this contract introduces no debt balance. The first relay offer has neither entrusted cargo nor a cargo-loss event.

Success settlement is one state transition spanning request status, credits, cargo obligations and promised report/access evidence. A completed status is the durable receipt for this fixed offer; do not maintain a second, independently mutable “paid” flag. Settled cargo lots also have durable settlement state. Repeated Report, Return or loss settlement is a no-op with an explanatory result. Credits are an authored request reward applied to the commander; no requester balance, commodity-market depletion or faction treasury is invented by this contract.

Cargo issuance identity includes the request's monotonically increasing acceptance ordinal and authored cargo slot. Retain at most the current or most recently settled lot for each slot; a new issuance atomically supersedes its settled predecessor after eligibility passes. Actions carry issuance identity and reject stale ordinals, preventing duplicate old return/loss settlement without retaining an unbounded cancellation history. Reaccept resets cancellation outcome metadata, but never resets a completed offer's success receipt or applies a previous issuance's cargo evidence to a new lot.

### 5. Changed or unavailable targets

Do not refresh hidden target state by reading the objective world into the request UI. Leads retain their source and age until an explicit observation/report channel updates them. Off-screen repair must not be revealed by opening Requests or loading a save.

If the pilot knows a target is unavailable before objective satisfaction, retain the job and show the reason plus useful actions: use a known, explicitly scheduled recovery if one exists, return to the requester for clarification, or cancel. The first relay has no established competing actor, autonomous disablement or recovery schedule. Missing content during implementation is an integration fault, not a fictional “someone beat you to it” outcome.

If a completed intervention already has valid evidence, retain ready-to-report state despite later target changes. A lost learned target may leave a last-observed location rather than a live exact-position marker; the UI distinguishes stale intelligence from a current observation.

The existing carrier model permits disabled or destroyed stations; this specification grants the requester no exemption. If its report station becomes inaccessible, keep the job and earned evidence, refuse Report while docking is unavailable, and show only learned availability information. Offer the same known recovery or cancellation actions as for an unavailable target. Once docking there becomes available again, explicit return/report can settle the existing evidence; no remote payment, replacement requester, automatic failure or invented recovery schedule is implied. The first prototype begins with an operational ordinary requesting station and must also exercise this unavailable-report path.

### 6. Interface and focus flow

**Current and Past (node #690):** the Requests list is two tabs, on the station console and the flight console alike. **Current** holds the accepted and ready-to-report requests — `isAcceptedRequest` is the whole rule, so ready-to-report work stays until it is reported — beside the available offers (docked only) and retained leads as their own sections, never mixed into the accepted ones. **Past** holds completed, cancelled and failed requests with their status and details. A journal row is classified by its status before it is a lead or an offer, so a cancelled job still posted at its requester is an outcome and an accepted lead is a job. Requests opens on Current: a press that opens the tab, a new surface (docking at a station, launching) and a fresh boot. The tab is transient view state on `Game` and is not saved.

A press that moves a request across the partition takes the list with it — Report and Cancel show it under Past, where Return and Accept again are, and Accept again shows it under Current, where Track is. A change the pilot did not press, such as a failure, moves the row and leaves the tab alone. Details are drawn only for a row the visible tab lists; a selection on the other tab leaves a tab-specific empty pane rather than an actionable one, and returns when its tab is shown again. Entrusted goods still aboard for a cancelled job are named on Current, so moving the job into history does not hide the obligation. Each tab has an empty state, and so does every section it always shows; Kept for later is drawn only while a lead is kept, so it has none. Switching tabs changes no request, tracking, cargo, credits or learned information. The tabs are request actions on the existing focus walk, carry `role="tab"` and `aria-selected`, and are not console tabs: the shoulder buttons still step the console.

**Docked:** Requests is the third tab on the forward station console. It contains available offers, accepted requests, retained leads and outcomes/return obligations as distinct list sections, split across Current and Past as above. Rows open details. Details show Accept only for an offer, Reaccept for eligible cancelled unfinished work, Track/Untrack and Cancel for an accepted request, and Report only when docked at its report station with valid success evidence. Reading a retained lead can identify a search region, never create a commitment. *Retained lead* is this document's term; the screen's own wording, and the ruling behind it, are `CONTEXT.md` §Language **Lead**. <!-- glossary-ignore: Accepted request -->

**In flight:** Requests on the left console reviews accepted jobs and retained leads under Current, and their outcomes under Past. Selecting a row opens details; Track chooses the one compact next-action cue. With nothing tracked, show no objective marker and a neutral “no request tracked” entry. No automatic tracking occurs on acceptance, completion or cancellation: completing or cancelling the tracked request clears the cue and invites manual selection of another.

**Cue:** show job title, next action and the known search region, learned target or report station. Before identification, the cue describes the search region and never draws a hidden-object point marker. A search-region indication must be visually distinct from a precise target. Tracking never overwrites the pilot's selected flight target, set course, amber target marker or green prograde cue. Reuse the existing target/travel actions when the pilot explicitly chooses a learned target or known report station; acceptance and tracking do not start cruise or steer the ship.

**Focus:** use `panel-focus.ts`'s stable row identity plus remembered index, including refresh after list changes; request identity survives resorting. Use the existing `pad-bindings.ts` console law: D-pad walks focus, shoulder buttons change tabs, A activates and B backs out of request details. Preserve the station console's established handling at its top level and its launch-hold actions. Keyboard and mouse use the same action boundary and focus identity.

Opening a detail view cannot consume the same activation press as Accept or Report. Changing tabs or restoring focus cannot accept, cancel, report or initiate flight. Cancellation shows its cargo obligations and disclosed terms before its explicit action. Requests inherit the existing docked/flight simulation and input-focus laws rather than introducing a separate full-screen application or pause regime.

### 7. Minimal typed saved state

Add a player request journal to `CommanderRecord`, beside its existing commander and flight fields. World condition, causal episodes and recovery stay in `WorldState`; neither request stage nor settlement can duplicate a world's objective delta as another authority. Proposed saved shape:

```ts
type RequestStatus = "accepted" | "ready-to-report" | "completed" | "cancelled" | "failed";
type OfferId = string & { readonly __offerId: unique symbol };

interface RequestsState {
  byId: Record<OfferId, SavedRequest>;
  leadsById: Record<string, SavedLead>;
  entrustedByLotId: Record<string, SavedEntrustedLot>;
  trackedRequestId: string | null;
}

interface SavedRequest {
  offerId: OfferId;                // canonical §1 identity; equals containing byId key
  contentRevision: number;
  acceptedAt: number;              // authoritative game clock
  lastAcceptedAt: number;
  acceptanceOrdinal: number;       // starts at 1; increases on successful explicit reaccept
  status: RequestStatus;
  stageId: string;
  pinnedTerms: AcceptedTerms;      // reward, requirements and disclosed special terms
  evidence: ObjectiveEvidence[];   // bounded by authored stages, not an event log
  reservedPlayerCargo: Record<string, number>;
  settledAt: number | null;        // successful report time; non-null iff completed
  outcomeReason: string | null;
}
```

`AcceptedTerms` has the required offer facts from §2, requester/report references and authored objective predicates with their revision; accept-time snapshots contain no live target coordinates. `ObjectiveEvidence` records stage identity, observation/intervention time, galaxy and carrier identity, instance/episode identity where applicable, source and qualifying player role. Keep at most the evidence required for each authored stage; do not depend on a world episode summary surviving forever to prove payment eligibility.

`SavedLead` carries stable lead identity, source identity, observed time, known region, confirmation state and an optional identified carrier reference with explicit galaxy index as in §1. It is retained report provenance and an opportunity to search, not another last-known carrier-condition row. The per-galaxy knowledge row in `WorldState` remains authoritative for discovery, observed condition and recovery. Identification writes that row through the explicitly authorized observation channel; exact targeting requires its learned identity. A lead's confirmation records whether its report was corroborated and cannot independently grant discovery or refresh condition. System relay updates continue to reach only their existing station knowledge rows; they neither rewrite a broker's dated report nor reveal a pirate sensor relay. Current known-target cues read WorldState knowledge, while the lead preserves its own source/age. Validate every reference against its named world galaxy and carrier even though the journal is outside the galaxy envelope.

`SavedEntrustedLot` carries lot/request/requester identity, report/return station, item description, per-unit hold usage, aboard quantity, lost quantity and settlement state. Settlement must represent `return-required`, `loss-settlement-required`, `both-required` and `settled`, including goods returned while a lost portion remains unpaid and the inverse. Retain bounded returned/loss-settled quantities and the loss-fee receipt so quantity sums and outstanding portions can be validated, and the disclosed fee cannot be charged again for the same lot. Return removes only aboard goods; loss settlement removes no aboard goods. Fully settled means no outstanding return or loss portion. These are finite typed records, not arbitrary JSON extensions. The first relay leaves all cargo maps empty.

Validate identities, supported content revisions, enum values, finite nonnegative quantities, clock bounds, acceptance ordinals, region geometry, stage/evidence consistency, reserve totals and lot ownership at load. `settledAt` is non-null exactly when status is completed and is null for every other status; it describes the successful report, not cancellation or outstanding cargo settlement. `reservedPlayerCargo` is empty unless status is accepted or ready-to-report. A tracked ID must refer to an accepted or ready-to-report request. Refuse incompatible or inconsistent saves with a useful reason; do not silently drop requests, obligations or settlement receipts. Loaded ready-to-report requests remain ready; loading does not pay or perform turn-in.

Persist only commitment, learned information, bounded evidence, ownership/settlement and the tracked request identity. Derive list ordering, text, next-action projection, lead age, eligibility, current known-target marker and route from authoritative saved state plus the seeded world. Do not save DOM focus, marker coordinates, route chains or countdown copies.

**Versioning:** adding `CommanderRecord.requests` requires a `SAVE_SCHEMA_VERSION` bump, with an explicit compatible migration from the pre-journal envelope to an empty journal. The implementation must pin that supported source revision from `src/save-envelope.ts` in its migration and fixtures. Verify the original envelope's hash before parsing/migrating it; migrate a copy, retain the stored original until the normal complete-envelope save succeeds, and leave unsupported versions untouched and exportable. No permissive default may silently discard request state from a newer unsupported schema.

Request journal additions alone do not change `WORLD_SCHEMA_VERSION` or `WORLD_GENERATOR_VERSION`. A newly generated persistent relay carrier will separately require the generator-baseline version/fingerprint decision owned by its prototype; world-state shape changes require a world-schema migration. Do not conflate these boundaries.

Use the existing debounced dirty-save path and complete `{world, commander}` envelope in one IndexedDB transaction. Acceptance, observation, stage/evidence, tracking, cancellation and cargo/reward settlement mark dirty. Existing docking, undocking, jump arrival and quit flush boundaries remain in force. There is no separate request storage or per-domain hash. Across a process crash before the debounce, the whole earlier envelope may return; request payment and credits must never return from different snapshots.

### 8. First relay-request example

This is an illustrative authored offer for the future prototype, not live content or approved economy tuning:

| Field | Example |
| --- | --- |
| Title / requester | **Clear the survey route** — a named broker at a reachable ordinary trade station |
| Purpose | Stop hostile surveillance of a named local survey-shipment route |
| Action | Search the reported region, identify the pirate relay and disable it using the combat model's verbs |
| Lead | Broker's dated last signal report; a bounded region near a known body in the same generated system |
| Danger | Pirates may intercept traffic on this route; the report is unconfirmed |
| Requirements | No cargo transfer; an operational weapon able to perform the prototype's chosen disablement action |
| Payment | Example **250 Cr**, fixed and displayed before acceptance, paid once after return/report; final amount is prototype tuning |
| Consequence | Deny the relay-dependent raider capability on this named route while the relay is unavailable; exact dependency and before/after proof belong to the relay prototype |
| Special terms | None: no deadline, exclusivity or cancellation fee |
| Report location | Return and dock at the offering station; choose Report in Requests |

The pilot can read and retain the report before accepting. After acceptance they may keep another request tracked, then explicitly track this job. Its cue directs the search without an exact relay point. A real observation identifies the carrier; a qualifying disablement immediately changes its world condition and stores request evidence. The pilot can leave, save/load and return; reporting settles 250 Cr exactly once in this example. Any mystery report consumed by the story episode must be separately authored and does not expose unlearned Rama coordinates.

The UI prototype may use documented fixtures to exercise this sequence. A fixture cannot prove discoverability, combat disablement, persistence of relay geometry or the named route's changed threat capability.

### 9. Verification cases for follow-up implementation

| Case | Required evidence |
| --- | --- |
| Browse and retain a lead without acceptance | Headless state check plus normal docked browser flow; no commitment/cargo/payment |
| Accept two distinct offers | Both persist; acceptance of the second does not change tracking |
| Manual track/untrack and background progress | Only one compact cue; untracked request still advances; clearing tracking preserves jobs |
| Invalid or duplicate acceptance | Atomic refusal; no duplicate cargo or journal row |
| Search before discovery | Normal cockpit search and headed frames; no exact hidden marker, debug placement or leaked target knowledge |
| Identify target | Explicit observation records source/time; exact tracking becomes eligible only then |
| Qualifying disablement | Headless provenance/stage check; live relay experiment separately proves immediate world consequence |
| Premature/wrong-station/remote Report | Refused; no money, cargo settlement or outcome report |
| Report station inaccessible | Keep ready-to-report evidence and manual tracking; no hidden availability refresh or automatic payment/failure; refuse Report until docking is available; cancellation/reacceptance preserves valid evidence |
| Return and Report twice | One completed row, one credit transfer, one report and no duplicate cargo consumption |
| Cancel while flying | Cancelled state; no default penalty; no automatic switch to another tracked job |
| Reaccept cancelled unfinished work | Same offer identity and terms; valid prior non-cargo evidence retained; no duplicate success reward or tracking change |
| Reaccept after entrusted cargo cancellation | Outstanding old lot blocks new issuance; return/loss settles once; new ordinal rejects old actions and cannot reuse old cargo evidence |
| Entrusted cargo aboard on cancellation | Still consumes hold, cannot sell; return action settles once at requester |
| Entrusted partial loss | Authored implemented loss event establishes affected units and provenance; aboard and lost quantities remain distinct; only disclosed fee applied once; insufficient-credit refusal leaves obligation intact |
| Committed player cargo across two requests | No double reservation/delivery; cancellation releases only its reservation |
| Hold consumers | Buy, scoop, request acceptance and load/ship changes agree on total ordinary plus entrusted hold usage |
| Changed target / optional authored repair | No hidden off-screen knowledge refresh; recorded success survives unless pinned offer explicitly says otherwise |
| Save/load every transition | Commitments, chosen tracking, objective evidence, terminal receipts and cargo obligations round-trip together |
| Old/unsupported/corrupt save | Valid supported pre-journal migration starts empty; unsupported or corrupt originals remain untouched/exportable; no paid status/credit graft |
| Stage/status consistency | Objective IDs contain no status values; evidence, first unsatisfied stage and readiness agree; Report/Cancel/failure clear a tracked terminal row atomically; report timestamp exists iff completed and inactive rows retain no player-cargo reservation |
| Input focus and repeated activation | Mouse, keyboard and controller reach list/details/actions; one press opening details cannot accept/report; stable focus survives resorting |
| Names and galaxy namespaces | Renaming display labels does not orphan work; identical local carrier keys in different galaxies stay distinct |
| Live relay payoff | Separate relay-node before/after route experiment and principal play judgment; UI fixtures never count as this proof |

Headless tests verify arithmetic, ownership, transitions, parsing and atomic refusal/settlement. Guarded browser probes verify normal UI reachability and spatial/visible behavior; headed canonical-viewport captures and principal operation judge legibility. No implementation test is claimed as run by this design-only document.

### 10. Handoff

- [Prototype the Requests tab and the in-flight active-request cue](https://github.com/jcfischer/seelite/issues/343) remains below this decision and blocked by it. Its old one-active-request boundary is superseded by D1/D2: prototype at least two distinct accepted offers to prove concurrency and one manual cue. One relay-related offer may remain the first content example.
- [Prototype: pirate sensor relay consequence loop](https://github.com/jcfischer/seelite/issues/43) builds the unbuilt relay, its discovery/identification rule and named route capability; it retains the before/after experiment and principal flight judgment.
- [Prototype one complete relay request whose return report introduces the Rama mystery](https://github.com/jcfischer/seelite/issues/344) consumes those separately delivered results and its story-parent decisions. Its partial-build assumption is superseded by the principal clarification above.

## Scope

This document decides the request contract. The UI prototype belongs to its existing follow-up beneath this decision; relay route capability and the before/after flight experiment remain owned by the relay prototype. General request generation, faction simulation and a full campaign are outside this decision.
