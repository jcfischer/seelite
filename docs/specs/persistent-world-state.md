# Persistent world state

**Status:** Ratified decision for work-graph node “Persistent world changes: what state survives?”  
**Binds:** the operational-consequence doctrine; later carrier, combat, mission, save/load, map, and HUD work  
**Does not decide:** save encoding or slots, permadeath, carrier-specific repair durations, general faction simulation

## 1. Decision

seelite regenerates its immutable universe from the world seed and authoritative game clock, then overlays sparse player-relevant state. The save never copies generated carrier geometry, type, orbit, capability tables, positions, or derived downstream modifiers.

The overlay is a canonical snapshot, not an event-sourced second universe. It stores only facts that cannot be recovered from the seed and clock: player knowledge, current carrier deviations, bounded causal provenance, market deficits, visited flags, legal status, and other typed domains approved later.

Untouched systems have no carrier or knowledge rows. An absent objective row means the original generated carrier is operational with no scheduled recovery.

## 2. Identity and namespace

A generated carrier has a structured identity:

`CarrierKey = (galaxyIndex, systemIndex, localCarrierId)`

- `galaxyIndex` is in `0..7`.
- `systemIndex` is in `0..255`.
- `localCarrierId` is the stable ID emitted by that system's generator, such as `station-trade`.
- Display names, positions, array order, and raw seeds are not identities.

The key names a **carrier slot**, not one lifetime of an object. The original carrier has `instanceOrdinal = 0`; each completed replacement increments that ordinal. A replacement can later be disabled, destroyed, or repaired without losing the fact that it is a replacement.

A recovery process gets a deterministic identity from its carrier key, causal-episode ordinal, and process kind. Recovery actors are derived from that descriptor rather than added to an unbounded persistent actor registry.

## 3. Two independent state axes

### 3.1 Player knowledge

Knowledge and physical condition are independent.

- No knowledge row means **undiscovered**.
- A knowledge row means **known** and stores the observed instance ordinal, observed operational condition, `observedAt`, and the observation or report source.
- When the observed condition is repairing, the row also snapshots `observedRecovery`: process identity, kind, consequence area, `startedAt`, and `completesAt`. It is last-known intelligence, not a live reference to the objective recovery descriptor.
- Objective events outside the player's information channels do not update knowledge or `observedRecovery` automatically.
- A player-caused transition updates knowledge immediately. Otherwise a revisit, report, relay, or later explicit intelligence mechanic updates it.
- The galaxy map presents this as timestamped “last known” information, not unexplained live omniscience.

### 3.2 Objective condition

A carrier instance has one operational condition:

- **operational** — its generated capability is available;
- **disabled** — it remains present but its capability is unavailable;
- **destroyed** — the instance is wreckage and its capability is unavailable;
- **repairing** — a named recovery process is active and the capability remains unavailable unless a later carrier specification explicitly defines a partial capability.

**Replaced** is retained as a player-facing lifecycle concept and a provenance-bearing transition, but not as an exclusive physical condition. Replacement completion increments `instanceOrdinal`; the new instance is then operational and can enter the other conditions normally.

No generic “partly operational” state exists in v1. A future carrier that needs degradation must define the concrete capability split rather than add a percentage health modifier to this model.

## 4. Transitions and recovery

Allowed transition families are:

- operational → disabled or destroyed;
- disabled → operational, destroyed, or repairing;
- destroyed → repairing;
- repairing → operational after repair, or operational on the next instance ordinal after replacement;
- repairing → repairing when assistance, opposition, or another intervention changes the active recovery descriptor;
- repairing → disabled or destroyed when the recovery process is interrupted;
- any operational replacement instance may repeat the same cycle.

A repair or replacement stores a recovery-process descriptor: process kind, deterministic process identity, consequence area, `startedAt`, `completesAt`, and initiating provenance. Later carrier specifications choose durations and in-world actors.

Starting a recovery opens the next monotonically increasing causal-episode ordinal for that carrier slot. Assistance, opposition, or rescheduling that continues the same uninterrupted process retains its process identity and episode ordinal. Interruption closes that process; any later restart opens the next episode and therefore gets a new deterministic process identity, even when its kind is unchanged.

Recovery is derived lazily from the authoritative `gameTime`. There is no ticking countdown and no continuous simulation of unvisited systems. Reading or serializing at or after `completesAt` materializes the deterministic completion before applying a new event at that same timestamp. The completion's `occurredAt` is exactly `completesAt`; access or serialization time is never persisted and cannot alter process identity, provenance, episode ordinal, or canonical output. Interruption or assistance changes the schedule through another explicit transition.

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

The authoritative world state is not a full event log. Each carrier slot retains at most one current delta and one compact latest **causal episode**. The episode preserves its initiating transition and cause, the initiating intervention when one exists, its latest outcome, times, and player role so later world evidence and the ship log can still explain “this is different because of what I did.”

## 6. Bounds and compaction

State growth is bounded by the finite generated carrier set, not by hours played:

- at most one current objective delta per carrier key;
- at most one latest causal-episode summary per carrier key;
- at most one last-known knowledge row per carrier key;
- no persistent row for a derived recovery actor.

Superseded transitions collapse into the latest episode summary. An original carrier that is operational again with no scheduled process drops its current objective delta. A replacement keeps its instance ordinal, and disabled, destroyed, or repairing state never expires merely to reduce save size.

A recent chronological ship-log ring may provide UI history, but it is bounded and non-authoritative. Dropping a log line cannot change mechanics or erase the latest per-carrier attribution.

Existing domains keep their own bounds: market deficits decay lazily and drop below one unit; visited state has a fixed system-sized representation; legal status has a fixed per-galaxy representation. Carrier compaction does not rewrite or duplicate those facts.

## 7. Typed per-galaxy persistence envelope

Each galaxy owns separate typed domains for:

- carrier objective deltas and causal episodes;
- player knowledge and visited state;
- sparse market stock deficits;
- player legal status;
- later explicitly approved domains.

The galaxy envelope supplies `galaxyIndex`. Every station-keyed domain uses `(systemIndex, localStationId)` inside that envelope, equivalent to the full `CarrierKey`; `economy-trade.md` §5.5's `stationId` therefore means this composite identity, never `Station.id` alone. Any serialized embedded galaxy index must match its containing envelope or fail loudly.

The domains share the galaxy namespace and authoritative game clock but not a generic lowest-common-denominator event schema. Capabilities and UI projections may read multiple domains; they do not save duplicate modifier flags.

The eventual save system must snapshot world seed, `gameTime`, current location/player state, and all eight galaxy envelopes atomically. Save slots, autosave cadence, rollback, and permadeath remain undecided. Any later policy may retain, rewind, or delete a whole snapshot, but may not selectively reset carrier consequences while retaining the rest of that timeline.

## 8. Derived effects

Capabilities and consequences are projections of generated carrier definitions plus effective objective condition at `gameTime`. Route safety, services, traffic, enemy capabilities, prices, and map presentation are never persisted merely because they can be derived from those facts.

A wider effect still requires a carrier whose fiction defines that consequence area. This representation does not create territory ownership, influence bars, fleet command, or autonomous faction simulation.

## 9. Verification obligations

The implementation node owes headless tests proving:

1. **Namespace uniqueness:** every generated carrier across all eight galaxies has one unique structured key; local IDs may repeat only across different system keys; station-keyed market rows use the same composite namespace; and repeated interrupt/restart cycles produce distinct recovery-process identities.
2. **Baseline purity:** an empty overlay reproduces the generated world byte-for-byte at the model boundary and never mutates generated records.
3. **Transition table:** every allowed transition works, every invalid transition fails loudly, knowledge combines independently with every objective condition, and repeated destroy/replace cycles preserve instance ordinals.
4. **Lazy recovery boundaries:** immediately before, exactly at, and after `completesAt` produce the specified condition and replacement ordinal without a tick loop. A due completion first materialized at different later access times always records `occurredAt = completesAt` and produces identical canonical snapshots.
5. **Order independence:** the same seed, snapshot, and `gameTime` yield the same effective state and canonical sorted projection regardless of map insertion order, access order, or which systems were visited first.
6. **Round trip:** model serialization and deserialization preserve objective state, last-known state including `observedRecovery`, recovery descriptors, provenance, market deficits, visited flags, legal status, and all eight galaxy namespaces. Byte-format compatibility is deferred to the save-format decision.
7. **Compaction equivalence:** compacting transitions cannot change effective capabilities, scheduled recovery, latest attribution, or last-known information including `observedRecovery`.
8. **Hard bounds:** active objective rows, causal summaries, and knowledge rows never exceed one each per generated carrier; repeated destroy/replace and interrupt/restart cycles do not increase that bound.
9. **Atomicity:** a round trip cannot combine `gameTime` or one galaxy envelope from one snapshot with state from another.

All arithmetic and state-machine checks are headless. A later carrier's visible world evidence or map/HUD presentation also owes the repository's browser probe tier.

## 10. Deferred decisions

This model deliberately does not choose:

- save file encoding, schema migration, slots, autosave cadence, cloud storage, or permadeath;
- which infrastructure carriers v1 ships;
- carrier-specific repair/replacement duration, cost, or spawned actor geometry;
- a full mission, traffic, faction, or economy simulation;
- permanent story-state categories beyond the same sparse typed-domain rule.
