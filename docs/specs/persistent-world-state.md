# Persistent world state

**Status:** Decision record for work-graph node “Persistent world changes: what state survives?”  
**Binds:** the operational-consequence doctrine in work-graph node [“Operational consequences: what can the player change?”](https://github.com/jcfischer/seelite/issues/41); later carrier, combat, mission, save/load, map, and HUD work  
**Does not decide:** save encoding or slots, permadeath, carrier-specific repair durations, general faction simulation

## 1. Decision

seelite regenerates its immutable universe from the world seed and authoritative game clock, then overlays sparse player-relevant state. The save never copies generated carrier geometry, type, orbit, capability tables, positions, or derived capability projections.

The overlay is a canonical snapshot, not an event-sourced second universe. It stores only facts that cannot be recovered from the seed and clock: player knowledge, current carrier deviations, bounded causal provenance, market deficits, visited flags, legal status, and other typed domains approved later.

Untouched systems have no carrier or knowledge rows. An absent objective row means the original generated carrier is operational with no scheduled recovery.

## 2. Identity and namespace

A generated carrier has a structured identity:

`CarrierKey = (galaxyIndex, systemIndex, localCarrierId)`

- `galaxyIndex` is in `0..7`.
- `systemIndex` is in `0..255`.
- `localCarrierId` is a dedicated stable system-local carrier-slot persistence ID emitted by the generator, separate in contract from display names and incidental lookup keys. Stations use the fixed IDs in `src/system.ts` — `station-trade`, `station-refinery`, and `station-shipyard`; #148's Traffic actors extend their home station with a roster ordinal, for example `station-trade/traffic-00`. #324's raider encounter slots belong to the system rather than to a station — `raider-00` upward, one to four per system by its government (`src/raider-slots.ts`) — and have no parent. The implementation must expose and test the persistence table explicitly. #43's pirate relay is `relay-00`, one per system that has a station, with no parent, and its repair tender is `relay-00/tender`, parented to it; #351 enumerated both at `worldGeneratorVersion` 7 (`src/relay-slot.ts`). A relay's generated placement is its plan — the station it watches, its lead along that orbit and its offset from the plane — and a tender, like a raider, has none. Whether a system's relay is *active* is a runtime roll (`relayActive`, #351), not a generator fact, so re-tuning its chance moves no identity and owes no bump.
- Renaming a persistence ID requires a save migration. Every snapshot carries `worldSchemaVersion` for the mutable-state schema and `worldGeneratorVersion` for the seeded baseline. Any generator change that can alter a carrier's identity, type, parent, or generated placement must bump the generator version; the save/load decision owns migration policy and rejection of unsupported versions. A bump that only **adds** carriers — every older slot unmoved in identity, type, parent and placement — migrates by relabelling, because an older row still names the carrier it named: `LEGACY_WORLD_GENERATOR_VERSIONS` lists those versions, and 6 → 7 (#351) is the first. `tests/world-state.test.ts` holds each listed version against its own golden fingerprints.
- Display names, positions, array order, and raw seeds are not identities.

The key names a **carrier slot**, not one lifetime of an object. The original carrier has `instanceOrdinal = 0`; each completed replacement increments that ordinal. A replacement can later be disabled, destroyed, or repaired without losing the fact that it is a replacement.

A recovery process gets a deterministic identity from its carrier key, causal-episode ordinal, and process kind. Recovery actors are derived from that descriptor rather than added to an unbounded persistent actor registry.

## 3. Two independent state axes

### 3.1 Player knowledge

Knowledge and physical condition are independent.

- No knowledge row means **undiscovered**.
- A knowledge row means **known**, and carries one or both of two observations.
  A **condition observation** is the observed instance ordinal and the observed
  operational condition; they describe one reading and travel together, so a row
  that carries half of one is refused rather than repaired. A **scan
  observation** (#364, `carrier-identity.md` §5) is `observedAt`, its source, and
  the instance and voyage ordinals the reading was taken at. Alongside them the
  row carries the row's own `observedAt` and source: its **last contact**, by
  whichever channel wrote it last.
- **A row may carry a scan and no condition at all**, which is what makes a
  Traffic actor knowable: an ordinary carrier that has been scanned is known, and
  nothing about the scan read its hull. Writing `operational` because a ship is
  visibly flying would put knowledge on the galaxy map that no verb granted, so
  the fields relaxed rather than a value being invented.
- A `scan` observation **records no condition and no recovery snapshot**, and
  never clears either: a carrier docked at in repair stays known to be in repair
  however it is later scanned, and a scanned carrier that is then docked at keeps
  its scan. Re-scanning replaces the scan observation; a row holds one of each.
- When the observed condition is repairing, the row also snapshots `observedRecovery`: process identity, kind, consequence area, `startedAt`, and `completesAt`. It is last-known intelligence, not a live reference to the objective recovery descriptor.
- Objective events outside the player's information channels do not update knowledge or `observedRecovery` automatically.
- A player-caused explicit transition updates knowledge immediately. A lazily materialized completion changes objective condition only, even when the player initiated its recovery; the player knew the schedule, not its successful outcome. Otherwise a revisit, report, relay, or later explicit intelligence mechanic updates knowledge.
- The galaxy map presents this as timestamped “last known” information, not unexplained live omniscience.
- Condition intelligence and learned private facility facts are independent inside
  one carrier's knowledge row. An optional
  `knownPrivateFacts.blackMarket` marker stores only `learnedAt` and its report
  source. The black-market value itself remains generated baseline data: once
  the marker exists, the generated refinery flag supplies known-present or
  known-absent; without it, the fact is unchecked. The marker is invalid for a
  non-refinery carrier. **A row is not legal with none of the three**: the three
  are independent members, and the parser admits each one only when it is there,
  which is also what stopped an
  empty private-facts container from being serialized with a member invented
  inside it and then refused by its own reader.
- The scan observation's **voyage ordinal may be Traffic's own "no flown voyage
  yet" sentinel**, because that is what the verb was shown for a carrier that has
  not departed, and `carrierManifest` is asked with the same value on the Flight
  console. Storing what was read rather than a count that was not read is what
  keeps the record and the console one answer.
- A `system-relay` observation, received on initial world establishment and
  every later system entry, refreshes condition intelligence for every station
  in that system while preserving learned private-fact markers. A `docking`
  observation refreshes that station and adds its refinery black-market marker.
  Neither map opening nor elapsed time observes anything.

### 3.2 Objective condition

A carrier instance has one operational condition:

- **operational** — its generated capability is available;
- **disabled** — it remains present but its capability is unavailable;
- **destroyed** — the instance is wreckage and its capability is unavailable;
- **repairing** — a named recovery process is active and the capability remains unavailable.

**Replaced** is retained as a player-facing carrier-instance concept and a provenance-bearing transition, but not as an exclusive physical condition. Replacement completion increments `instanceOrdinal`; the new instance is then operational and can enter the other conditions normally.

No generic “partly operational” state exists in v1. A carrier that needs degradation expresses it as a concrete per-capability projection while retaining one objective condition; it does not add a percentage-health condition to this model.

## 4. Transitions and recovery

Allowed transition families are:

- operational → disabled or destroyed;
- disabled → operational, destroyed, or repairing;
- destroyed → repairing through `replacement-start`; a destroyed instance returns to operational only through the later `replacement-complete`;
- repairing → operational through `repair-complete`, retaining `instanceOrdinal`;
- repairing → operational through `replacement-complete`, incrementing `instanceOrdinal`;
- repairing → repairing when assistance, opposition, or another intervention changes the active recovery descriptor;
- repairing → disabled or destroyed when the recovery process is interrupted;
- any operational replacement instance may repeat the same cycle.

A repair or replacement stores a recovery-process descriptor: process kind, deterministic process identity, consequence area, `startedAt`, `completesAt`, and initiating provenance. Process kind fixes the valid completion: `repair-start` may close only with `repair-complete`, and `replacement-start` only with `replacement-complete`; a repair completion is invalid for a destroyed-origin replacement episode. Later carrier specifications choose durations and in-world actors.

The initiating operational transition that opens a causal episode allocates the next monotonically increasing ordinal for that carrier slot. A recovery started to address that transition remains in the same episode and derives its process identity from that ordinal. Assistance, opposition, or rescheduling that continues the same uninterrupted process retains both identities. Interruption closes the process and episode; any later restart opens the next episode and therefore gets a new deterministic process identity, even when its kind is unchanged.

**A destruction may schedule its own replacement** ([#324](https://github.com/jcfischer/seelite/issues/324) part d, by the principal's ruling). The `destroy` transition then carries a scheduled recovery: its process identity (fixed at the destruction, from its episode), consequence area, `startsAt`, `completesAt`, and the provenance of the actor that does the work. `startsAt` is strictly after the destruction and `completesAt` strictly after `startsAt`. The carrier stays **destroyed** until `startsAt`. At `startsAt` a `replacement-start` materializes lazily, exactly as a completion does, and joins the destruction's episode as its intervention. The carrier then repairs until the `replacement-complete` at `completesAt`. An explicit `replacement-start` before `startsAt` replaces the schedule. Only a destroyed row may carry a schedule. The reason for the rule: an explicit start cannot be applied at a time before the clock, so without a lazy start, a carrier destroyed in a system the player then leaves could never begin its recovery on time. **The destroyed phase of a schedule cannot yet be opposed.** `interrupt` and `recovery-change` still refuse a destroyed row, so until `startsAt` only an explicit start can change the schedule. The started process is opposable like any other. A node that lets the player fly at a replacement before it starts must widen those two transitions first.

Recovery is derived lazily from the authoritative `gameTime`. There is no ticking countdown and no continuous simulation of unvisited systems. Reading or serializing at or after `completesAt` materializes the deterministic completion before applying a new event at that same timestamp. Completions sharing a timestamp materialize in canonical `CarrierKey` order before any new explicit event at that timestamp. The completion's `occurredAt` is exactly `completesAt`; access or serialization time is never persisted and cannot alter process identity, provenance, episode ordinal, or canonical output. Interruption or assistance changes the schedule through another explicit transition.

Because the process is named, later flight can expose a convoy, repair ship, construction stage, or equivalent target. A timestamp without an interruptible process does not satisfy the operational-consequence doctrine.

## 5. Provenance and attribution

Every transition that changes objective condition or a recovery plan carries provenance. This includes disablement, destruction, repair or replacement start, interruption, assistance, and completion.

The bounded transition fact records:

- carrier key, instance ordinal, and causal-episode ordinal;
- transition kind and `occurredAt`;
- cause kind and responsible actor identity;
- player role: `direct`, `assisted`, `opposed`, or `none`;
- the recovery process it starts, changes, or completes, when applicable.

A lazy completion links to the recovery transition that scheduled it; it does not invent an unrelated cause. Routine orbital motion, market epochs, NPC movement, and mere observations are not operational transitions.

The authoritative world state is not a full event log. Each carrier slot retains at most one current delta and one compact latest **causal episode**. The episode preserves its initiating transition and cause, the initiating intervention when one exists, its latest outcome, times, and player role so later world evidence and the ship log can explain the current consequence. A later unrelated episode, including one with player role `none`, replaces that summary; losing older attribution is the accepted cost of the one-episode bound, and any optional recent ship log remains non-authoritative.

## 6. Bounds and compaction

Authoritative carrier-state growth is bounded by the finite generated carrier set, not by hours played:

- at most one current objective delta per carrier key;
- at most one latest causal-episode summary per carrier key;
- at most one last-known knowledge row per carrier key;
- no persistent row for a derived recovery actor.

Superseded transitions collapse into the latest episode summary. An original carrier that is operational again with no scheduled process drops its current objective delta. A carrier with an active recovery descriptor always retains its objective delta. A replacement keeps its instance ordinal, and disabled, destroyed, or repairing state never expires merely to reduce save size.

A recent chronological ship-log ring may provide UI history, but it is non-authoritative and belongs to the later save/UI decision, which must declare a fixed capacity before adopting it. Dropping a log line cannot change mechanics or erase the latest per-carrier attribution.

Existing domains keep their own bounds. Economy §5.5 already makes market deficits decay lazily and drop below one unit. The save/load decision owes fixed bounds for the map's per-galaxy visited and legal-status state. Carrier compaction does not rewrite or duplicate any of those facts.

## 7. Typed per-galaxy persistence envelope

Each galaxy owns separate typed domains for:

- carrier objective deltas and causal episodes;
- player knowledge and visited state;
- sparse market stock deficits;
- player legal status;
- later explicitly approved domains.

The galaxy envelope supplies `galaxyIndex`. Every station-keyed domain stores the envelope-relative pair `(systemIndex, localCarrierId)`; combining it with the containing `galaxyIndex` reconstructs the full `CarrierKey`. `economy-trade.md` §5.5 records the same pair without inventing a second key name. A bare `Station.id` is not persistent identity. Any serialized embedded galaxy index must match its containing envelope or fail loudly. Sparse absence is meaningful, so the save format must carry domain integrity validation and reject a truncated or partially written snapshot atomically; the model must not reinterpret corruption as an untouched healthy carrier.

**The legal-status domain grew a member after #89 fixed this format, and it grew
without a schema bump** (`civilian-combat.md` H6, built by #366). A per-galaxy
list of witness `CarrierKey`s now sits beside the heat pair it shares a clock
with, holding the stations that have seen this pilot commit an offence. It cannot
be recovered from seed and clock, so it belongs here. A lawful pilot's list is
empty, and `canonicalEnvelope` **omits an empty list** rather than writing
`witnesses: []`, so the bytes of every save written before the member existed are
still the bytes that save hashes to, and `parseWorld` reads an absent list as the
empty one.

**The omission is the whole of what makes no-bump honest, not the member's
optionality.** Writing `witnesses: []` on every envelope would have changed the
hash of every pre-existing save, and a hash that no longer matches is an
*integrity* failure — a message telling the player their save is corrupt, when
what changed was the game. §9.10 is the contrast and not the precedent: the
private-fact marker had to bump `WORLD_SCHEMA_VERSION` because a knowledge row
with the field missing means something *different* from one with it false, which
is exactly the ambiguity a version exists to refuse. An absent witness list means
precisely what an empty one means, so there is nothing for a version to
disambiguate.

The list holds a full `CarrierKey` per station — a berth saw the offence, and a
`Station.id` is not persistent identity — and at most one entry per station per
galaxy. `measure-save-size.ts` carries that bound through the ceiling tiers, so
what it costs is reprinted by a run rather than quoted from here.

The domains share the galaxy namespace and authoritative game clock but not a generic lowest-common-denominator event schema. Capabilities and UI projections may read multiple domains; they do not save duplicate capability projections.

The eventual save system must snapshot `worldSchemaVersion`, `worldGeneratorVersion`, world seed, `gameTime`, current location/player state, and all eight galaxy envelopes atomically. Slots, autosave cadence and permadeath were decided by node #89 and implemented by #90; see §10. **Rollback was decided and is not yet reached**: #89's correction makes a non-permadeath death restore the last dock, `SaveStore.restoreAfterDeath` implements it, and nothing calls it because the game has no death path — #90 wired the flag and the record, not the death. Stated here rather than left to read as shipped, which is the class of false assertion §10 was corrected for. Any later policy may retain, rewind, or delete a whole snapshot, but may not selectively reset carrier consequences while retaining the rest of that timeline.

## 8. Derived effects

Capabilities and consequences are projections of generated carrier definitions plus effective objective condition at `gameTime`. Route safety, services, traffic, enemy capabilities, prices, and map presentation are never persisted merely because they can be derived from those facts.

A wider effect still requires a carrier whose fiction defines that consequence area. This representation does not create territory ownership, influence bars, fleet command, or autonomous faction simulation.

## 9. Verification obligations

The implementation node owes headless tests proving:

1. **Namespace and baseline stability:** every generated carrier across all eight galaxies has one unique structured key; local IDs may repeat only across different system keys; and station-keyed market rows use the same composite namespace. A golden persistence-ID table and fixed-seed carrier-baseline fingerprint fail if an identity, type, parent, or generated placement changes without an explicit `worldGeneratorVersion` bump and migration.
2. **Baseline purity and exclusion:** an empty overlay produces structurally identical generated records at the model boundary and never mutates generated records. The serialized state model accepts only declared typed state domains and contains no generated geometry, type, orbit, capability table, position, or derived capability projection.
3. **Transition table:** every allowed transition works, every invalid transition fails loudly, knowledge combines independently with every objective condition, repeated destroy/replace cycles preserve instance ordinals, and repeated interrupt/restart cycles produce distinct recovery-process identities. The sequence destroyed → repairing → assisted or rescheduled → replacement complete retains one episode ordinal and the original player attribution through completion.
4. **Lazy recovery boundaries:** immediately before, exactly at, and after `completesAt` produce the specified condition and replacement ordinal without a tick loop. A due completion first materialized at different later access times always records `occurredAt = completesAt` and produces identical canonical snapshots.
5. **Order independence:** the same seed, snapshot, and `gameTime` yield the same effective state and canonical sorted projection regardless of map insertion order, access order, or which systems were visited first; same-timestamp completions resolve in canonical `CarrierKey` order.
6. **Round trip:** model serialization and deserialization preserve `worldSchemaVersion`, `worldGeneratorVersion`, objective state, last-known state including `observedRecovery`, recovery descriptors, provenance, market deficits, visited flags, `LegalStatus`, and all eight galaxy namespaces. #275 extends this guarantee to learned private-fact markers. #366 extends it in the other direction, to a snapshot that *predates* a member: an envelope holding no witnesses must serialize to the bytes it arrived with, which is what §7's omit-when-empty rule exists to buy. Byte-format compatibility and migration policy were the save-format decision, taken in #89: a version mismatch refuses with a named message and leaves the record untouched on disk, and the migration table becomes mandatory from the v1.0 public release.
7. **Compaction equivalence:** compacting transitions cannot change effective capabilities, scheduled recovery, latest attribution, or last-known information including `observedRecovery`.
8. **Hard bounds:** active objective rows, causal summaries, and knowledge rows never exceed one each per generated carrier; repeated destroy/replace and interrupt/restart cycles do not increase that bound.
9. **Atomicity and integrity:** a round trip cannot combine `gameTime` or one galaxy envelope from one snapshot with state from another, and truncated or partially written typed domains fail validation rather than reading as absent rows.
10. **Facility knowledge:** public station roles require no knowledge row; initial
    establishment and system entry observe every local station through
    `system-relay`; docking observes one station and marks a refinery's
    black-market fact checked. Later condition observations preserve that
    marker, the marker survives replacement of the carrier instance, and the
    snapshot never persists the generated black-market boolean itself. A
    generated false flag with a marker is known-absent; the same flag without a
    marker is unchecked.
    Adding the marker changes the serialized knowledge-row shape, so the
    implementation bumps `WORLD_SCHEMA_VERSION`; it does not silently accept a
    version-1 snapshot as though the new field had always been present.

All arithmetic and state-machine checks are headless. A later carrier's visible world evidence or map/HUD presentation also owes the repository's browser probe tier.

**The pre-#116 portions of obligations 1–9 are implemented in
`src/world-state.ts` and the leaf `src/carrier-key.ts`, checked by
`tests/world-state.test.ts`.** Its `describe` blocks are titled after this list:
nine titled `§9.1` … `§9.9`, one for each implemented obligation above, plus `§7
the envelope's writers` — what §7 asks of the write path rather than of the model,
titled so that counting blocks against this list does not read as a mismatch.
**The count is not written down here**, because it has been wrong in this
paragraph before: #275 added §9.10, #364 added §3.1, and `tests/headless.test.ts`
and the file itself are where the blocks actually are. The
legal-status domain is present as the typed per-galaxy field §7 requires and
nothing more — thresholds, decay and the Clean/Wanted/Fugitive label belong to
the combat node, and being derived, the label is a §8 projection that must not
be saved.

## 10. Deferred decisions

**Save encoding, migration, slots, autosave cadence and permadeath were on
this list and are not deferred any more.** Node #89 chose all five, so the line that
carried them was a false assertion in a ratified spec for as long as it stood.

**What #90 shipped and what it did not, because "decided" and "reached" are
different claims and this paragraph made only one of them for a round.**
Encoding, migration and the autosave cadence are shipped and exercised by the
game: IndexedDB, a version refusal that leaves the record readable, and a
debounced write with four unconditional flushes. **Permadeath, slots and
export/import were decided and implemented before a player could reach them**,
and #306 made them reachable: §11's Commander overlay chooses
permadeath at New game and lists, loads, exports, imports, renames and deletes
Commanders through `CommanderCatalog`. `?permadeath` survives only under
`?boot=direct` (§11.6). This paragraph said "not reachable" until then, and the
same flip removed the matching note from `main.ts`'s boot block.
The choices live in #89's resolution and are
implemented in `src/save-store.ts` and `src/save-envelope.ts`, whose headers
carry the reasoning; they are **not restated here**, because a third copy of a
decision is the drift this document warns about elsewhere. Cloud storage is not
deferred either — it is ruled out by the map's browser-only, no-backend, no
runtime network constraint, which is a constraint rather than an open question.

This model deliberately does not choose:

- which infrastructure carriers v1 ships;
- carrier-specific repair/replacement duration, cost, or spawned actor geometry;
- a full mission, traffic, faction, or economy simulation;
- permanent story-state categories beyond the same sparse typed-domain rule.

## 11. The Commander overlay

Decided in [#304](https://github.com/jcfischer/seelite/issues/304) (S1–S7), with
four points #304 left open settled on
[#305](https://github.com/jcfischer/seelite/issues/305). **Specified here, built
by [#306](https://github.com/jcfischer/seelite/issues/306)**. The overlay, the boot,
every operation below and §11.5's in-play badge are reachable. A **Commander** is what the player
sees of one save slot (`CONTEXT.md`); `SaveStore`'s slot vocabulary is storage
and does not change.

### 11.1 What it is, and why it is not a second grammar

A plain-DOM overlay beside the settings screen (`settings-panel.ts`), out of the
fiction. The map's #70 constraint gives every *game* screen a cockpit wall or a
tab; settings is the precedent for a surface that is neither station business nor
fiction, and the Commander overlay is the second such surface rather than a
second grammar (S1). It opens on `system.commander`, which is an ordinary
command in the binding registry since #381 S5 — `9` by default and movable like
any other, with the `Controls` tab's Commanders door as the route no rebind can
lock. (It opened on a key the flight bindings did not hold until then, and the
registry offered that key for rebinding while the overlay went on reading its
own constant.) While open it is a `modal` pad context, so `readPadContext`
answers `modal` for either screen (`docs/gamepad.md`).

### 11.2 Boot

**Every boot opens the overlay first** (S2), with the game already constructed
behind it — except a boot that consumes §11.3's one-shot continue, which the
player's own choice on the overlay wrote:

1. Read the **active-Commander pointer** (§11.4) and what lies beside it. **A
   pending new game is consumed first**, before any slot is read or any fallback
   applies (§11.3): its slot has no record yet by design. Otherwise, with no
   pointer, the slot is `default`, which is where every save before §11 lives.
2. Read and parse that slot's `live` record exactly as today, with D9's faults.
3. Construct the `Game` from it, or fresh when there is nothing to load or the
   load failed — as today.
4. Open the overlay. **The world clock does not advance while the boot overlay
   is open** (S7): the frame loop may draw, but the step receives no time. A save
   carries its `gameTime` and no time passes while the page is closed, so holding
   the clock here is the same as the page not yet being open — neither a pause
   nor compressed time.
5. **No `SaveStore` is attached until the player chooses.** `flush("quit")`
   writes unconditionally on `pagehide`, so a store attached behind the boot
   overlay would write a `live` record for a Commander nobody picked if the tab
   were closed there. This is D9's "a refused load leaves the fresh game with no
   store" extended to every boot.

**Continue** attaches the store to the active Commander and releases the clock.
It is selected by default. **It is absent when the Commander has no save to
continue** — a fresh profile — and shown disabled, under the fault that says
why, when a save exists and will not load. Once in play, the overlay opened by key keeps settings' rule:
the world runs under it.

### 11.3 Operations (S3)

**New game, Load and Import end in a page reload** into the Commander the
pointer names, because the only `new Game(` is the boot's and nothing rebuilds a
game in the page. Nothing here changes that. **Export, Rename and Delete do not
reload**: they update the overlay in place. A reload straight after Export could
cancel the download on D9's rescue path, and Rename and Delete change no game.

**A switch out of a game in play awaits its flush.** When a store is attached,
New game, Load and Import first await `flush("quit")` on the outgoing Commander,
and a flush that fails refuses the switch with the fault. `pagehide`'s own quit
flush is best-effort — a page torn down mid-transaction loses that write — so a
switch the player chose does not rely on it.

**A reload the overlay caused does not open the overlay again.** New game, Load
and Import write a **one-shot continue** beside the pointer (§11.4) before
reloading; the boot that reads it consumes it and continues straight into the
pointed Commander, attaching the store and releasing the clock as Continue does.
The player has just chosen that Commander on the overlay, and asking again is
the same question twice. Any other reload — the player's own, a crash, a new
tab — finds no one-shot and opens the overlay, which is S2. A one-shot naming a
Commander whose load fails, or whose slot lock another tab took in the meantime,
is discarded and the overlay opens with the fault.

**One rule for names.** New game, Import and Rename all **refuse a name already
in `slots()`** and say so on the overlay. A slot is the whole save, so writing to
a taken name would replace that Commander rather than create one.

- **New game** takes three choices (S5): a **name**, pre-filled with a free
  default; a **galaxy seed**, pre-filled with a random seed the player can keep,
  retype or re-roll — there is no canonical seed, and `seedFromQuery` gives a
  random one today; and **permadeath**, on or off. **The choice is on disk
  before the reload, as a pending new game rather than a save**: name, seed and
  #89's D7 flag, written to the pointer's store (§11.4) with the one-shot
  continue. No envelope is built there — a `SaveEnvelope` needs a world and a
  flight, and only a constructed `Game` has those. The boot that consumes the
  pending new game constructs a fresh `Game` from its seed and flag, awaits its
  first `live` write into the named slot, and only then clears the pending
  record and continues. A tab closed at any point in that sequence loses nothing
  the player chose: either the pending record or the first save is on disk.
- **Load / switch** requests the chosen slot's Web Lock without waiting and
  refuses when another tab holds it; otherwise it sets the pointer, writes the
  one-shot continue, and reloads.
- **Export** hands the player `exportSlot`'s file. It is offered for any slot,
  including one whose record this build refuses — D9's rescue path.
- **Import** asks for a name and runs `importSlot` into a **new** slot, under
  the name rule above. `parseSave`'s integrity and version refusals are what
  import refuses a file on. Then the pointer names it, the one-shot continue is
  written, and the page reloads.
- **Rename** is copy-then-delete: both records to the new name, then
  `deleteSlot` on the old one. A failure between the two leaves two Commanders,
  never zero.
- **Delete** asks for confirmation.
- **Rename and delete refuse any Commander a tab has a store attached to** —
  this tab's or another's. The pointer is shared by every tab of the origin, but
  a store attaches per tab, so refusing only the one the pointer names lets tab B
  delete the Commander tab A is still writing, and tab A's next write recreates
  it with a `live` record alone. An attached store holds an **exclusive Web Lock
  named by its slot** for the life of the tab; Rename and Delete request that
  lock without waiting and refuse when it is held. The same lock refuses
  Continue into a Commander already open in another tab, which is two stores
  writing one slot.

The delete and rename `SaveStore` did not have land on `CommanderCatalog`, beside
the pointer, the one-shot, the pending new game and import. The catalog is built
from the backend and the locks alone, because the boot reads the pointer before
it can build a store for the Commander the pointer names. `SaveBackend` already
has `deleteSlot`.

### 11.4 Names and the active pointer

**A Commander's name is its slot key** (#305). `CommanderRecord` has no name
field, and adding one bumps `SAVE_SCHEMA_VERSION`, which `parseSave` refuses —
every existing save would stop loading. As the key it costs no schema change,
and it matches `exportSlot`'s rule that the file names no slot, which is why
import asks for a name. `assertSlot` refuses an empty name and the record key's
NUL separator, and nothing else: a space in a name is harmless to a record key,
a Web Lock name and an export (`tests/source-bytes.test.ts` records why a space
was once refused). The
overlay says so rather than failing silently.

**The active-Commander pointer** — and §11.3's one-shot continue beside it —
lives in the same IndexedDB database as the slots, **outside `SaveEnvelope` and
outside its integrity hash**. #89's one hash covers `{ world, commander }`; the
pointer is neither, and a cleared profile clears it with the slots it names. A
pointer naming a slot that no longer exists falls back to `default` and says so — **except while a pending new game names
it**: that slot is empty because its first save has not been written, not
because it was deleted.

**It is a second object store, not a key in `slots`.** `indexedDbSaveBackend`
files a record under its slot name, a separator and its kind, and `slots()`
lists the distinct prefixes of every key in that store — so a pointer stored
there would be listed as a Commander, and `deleteSlot` could match it. The
pointer gets its own store, which is a `SAVE_DB_VERSION` bump from 1 to 2; the
upgrade creates the new store and leaves `slots` and every record in it
untouched. `SaveBackend` gains the pointer's read and write, and the in-memory
backend implements them so the headless tier checks the policy — but not the
separation: an in-memory pointer is disjoint from the slots by construction, so
the collision it guards against is checked against the real IndexedDB backend
(§11.7).

**A blocked upgrade is a named fault, not a hang.** A tab still open on the
version-1 build holds the database, and the upgrade waits for it. `openSaveDb`
has no `onblocked` handler today, and the boot awaits the read before it builds
the game, so an unhandled block never boots at all. The open refuses on
`onblocked` with a message naming the cause — another seelite tab is open — and
D9's path takes over: a fresh game, no store, and the overlay says why. The
version-1 tab's connection gets `onversionchange` and closes, so its next write
fails and raises its own badge rather than blocking the upgrade forever.

### 11.5 Faults (S4)

- **At boot**: a refused load opens the overlay with the message, and Export of
  the slot it concerns. `?seed`'s set-aside is a fault **only under
  `?boot=direct`** (§11.6); without it, `?seed` sets nothing aside.
- **In play**: the save-fault badge (`hud-and-scanner.md` §5.3) is raised by a
  debounced write that has failed `SAVE_RETRY_LIMIT` times **or by any failed
  dock, undock or jump flush**. The second half came with the badge: before it,
  `saveFlush` only logged a failed flush (`main.ts`, its `.catch`), so the dock
  flush — the write that lays down `lastDocked` — could fail with no player
  surface at all. A failed `quit` flush on a tab close has no frame left to
  draw it in and stays a log line; one before a switch refuses the switch
  (§11.3), play goes on, and the store holds it like any other failed flush.
  The badge opens the overlay, which names the failure still
  held for each kind (`Game.saveFaultText`) — not the last failure, which may be
  a write that has since landed.
  **With no store attached, a `saveFault` is itself the badge**: a
  `?boot=direct` boot whose attach failed plays on with nothing that will write
  (`heldSaveFault`, `src/save-badge.ts`).
  **It is held per record kind, and each kind clears only on a write of that
  kind.** A debounced write carries `live` alone; a dock flush writes `live` and
  `lastDocked` in one transaction. So a `live` fault clears on the next write
  that lands, and a `lastDocked` fault clears only on the next dock flush that
  lands — clearing it on a debounced write would hide the fault while a
  non-permadeath death still restores the older dock. The badge shows while
  either is held.
- **The overlay's words name the Commander, never the slot.** Some `saveFault`
  messages are built with the storage word today — `?seed`'s set-aside reads
  `slot "default" holds seed …` (`main.ts`, the boot block) — and the overlay
  shows `saveFault`. #306 rewords every `saveFault` message the overlay can
  display, so `CONTEXT.md`'s "the player never sees the word" is true of the
  shipped text and not only of the labels.
- **A fault reads as a sentence, then its detail.** The sentence is what the
  player acts on; the thrown reason — often a field name and a value, such as
  `saveSchemaVersion undefined is not 2` — follows on a dimmer line. The storage
  modules' own `save: ` error prefix is for the console and is not shown
  (`messageOf`, `commander-flow.ts`).

### 11.6 Probes and view capture

A boot that always waits blocks every browser script that loads the game's
default route, and `capture-views`. **A dedicated query parameter, `?boot=direct`,
boots as the game does before §11**: no overlay, the clock running, the store
attached as today (#305). `?seed`, `?permadeath` and `?no-save` keep their
current meaning under it.

**Every script builds its URL through `scripts/lib/game-url.mjs`** (#306, PR
#308): `gameUrl` for a boot of the game, `workbenchUrl` for the workbench routes
(`?model-viewer`, `?galaxy-map`, `?planet-prototype`, `?hud-gallery`).
`tests/game-url.test.ts` fails on any `.goto(` whose URL is not one of the two.
**A workbench URL carries `?boot=direct` too**, although a workbench builds no
game: its close drops only its own route and assigns the rest of the URL, which
is a boot of the default route, so a probe that closes back to flight would
otherwise land on the overlay.

**Without `?boot=direct`, a `?seed` pre-fills the new-game seed field and does
nothing else**: it does not skip the overlay, and it does not set the active
Commander aside, so Continue stays available. Today's set-aside exists because a
boot straight into a save could not ask which world was wanted; the overlay does
ask, so the rule applies only where nothing asks — under `?boot=direct`.

**`?system=<index>` names the system a *new* game boots in** (#432), and a boot
that names one **writes nothing**, as `?no-save` does. It exists for the view
capture: `startSystem` is the most central well-stocked and orderly system, and
the derived sky's arm (§11 of `galaxy-generation.md`) is directional, so a
canonical frame of the cluster's light cannot be taken there — reaching a rim
system means booting at one, not spending a tank and three systems to fly to it.
Everything else about such a boot is what a new game is: galaxy 0, clock 0, the
ship on the arrival point, its `visit` recorded, and only the system named. An
index outside the galaxy is **refused and said**, never clamped — a frame
captioned with the system that was asked for is the whole use of the affordance,
and `capture-views` reads the booted index back and refuses a page that booted
somewhere else.

**The storage rule is not a copy of `?no-save`'s, and the reason is the
set-aside.** `?seed` protects a Commander by *disagreeing* with it, and under
`?boot=direct` a mismatch sets that Commander aside. A named system carries no such
disagreement: `?seed=<the save's own seed>&system=161` matches, loads, attaches,
and the first dirty event writes a Commander who started at a rim star over the one
who did not. So the boot plan answers `writesNothing` for both causes and the shell
reads that, rather than re-deriving the permission from one of them at the call
site.

**A postcard link is a fourth route, and it constructs no catalog at all**
([#406](https://github.com/jcfischer/seelite/issues/406)). A URL whose fragment
starts `#postcard=` is parsed in `entry.ts` before the game is imported: a
refused recipe mounts a notice and boots nothing, and an accepted one boots the
read-only viewer, which builds its `Game` from the recipe with no backend, no
lock, no catalog and no store — and no input listener or frame loop that could
reach the settings or the layout. So its guarantee is not `writesNothing` read
at four call sites; there is nothing for those sites to be handed.
`scripts/probe-postcard.mjs` holds it against a store that has a Commander and a
setting in it, byte for byte. **Visit this universe** leaves the viewer for
`/?seed=N`, the overlay's ordinary New game with the seed filled in.

### 11.7 Verification obligations

Headless: the active pointer's read, write and fallback; a boot that names a system
reading nothing and writing nothing even beside a save at its own seed, leaving the
pointer and the continue for the boot after it, and the parameter refusing an
unusable index with a word said; the one-shot continue
consumed by exactly one boot, into the slot the pointer names after New game,
Load and Import alike; a pending new game surviving until its first `live` write
lands; a switch refused when its awaited flush fails; Export, Rename and Delete
causing no reload;
a rename interrupted between copy and delete leaving two; delete and rename
refusing a Commander whose slot lock is held, through an injected lock since bun
has no Web Locks; a pending new game whose pointer names an empty slot booting
into that game and not falling back to `default`; no `saveFault` message the
overlay can show containing the word `slot`; new game, import and rename each
refusing a taken
name; import refusing a record `parseSave` refuses; a `lastDocked` fault
surviving a successful debounced write and clearing on a dock flush; `gameTime`
unchanged across frames while the boot overlay is open; no store attached before
the choice; `?seed` without `?boot=direct` setting nothing aside; the URL builder
row.

Browser: the overlay opens at boot with the clock held; Continue releases it; a
boot fault shows its message and offers Export; a forced `live` write failure
raises the badge in flight and while docked and a good debounced write clears it;
a forced dock-flush failure raises it and a good debounced write does **not**
clear it, while the next good dock flush does; the pad drives the overlay as
`modal`. Against the real IndexedDB backend: a version-1 database already holding
saves opens under version 2 with every record intact and `slots()` listing the
slots and not the pointer's store; a version-1 connection left open produces the
named blocked fault and a boot, not a hang; and a second tab refuses Continue,
Load, Rename and Delete on a Commander the first tab holds, and a one-shot boot
into a Commander another tab took opens the overlay with that fault.

**And a look at a rendered frame** of the overlay and of the badge in both states
before either is called done — #94's rule for anything drawn on the glass.
