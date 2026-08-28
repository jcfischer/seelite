# seelite Domain Language

This glossary defines vocabulary for seelite's planned causal world model and points to the specs that own structural details. The core consequence terms originate in work-graph node [“Operational consequences: what can the player change?”](https://github.com/jcfischer/seelite/issues/41). The work-graph map (`soma graph node 1`) remains authoritative for constraints and delivery rules.

## Language

**Carrier**:
A named physical asset, actor, or condition in the universe that enables a capability in a bounded consequence area.
_Avoid_: Modifier, influence point

**Carrier slot**:
The persistent identity for a generated place that survives destruction and replacement of its occupying carrier instance. `docs/specs/persistent-world-state.md` §2 owns its key structure.
_Avoid_: Bare global object ID, display name

**Station name**:
What a station is **called** — `ENBILATE Gateway`. A third thing beside its `id`
(a lookup key) and its **Carrier slot** (what a save row is filed under), and
`docking.md` §12.5's decision E9 is where it was ratified as one: derived from
the system name and the station type, never drawn from a stream, and unique
within a system by construction. `src/station-name.ts` owns the derivation.
_Avoid_: any wording that could be read as the persistence identity — that is the **Carrier slot**, and the two are deliberately different things.

**CarrierKey**:
The canonical persisted identity of a carrier slot; a galaxy envelope may store its system-local pair and supplies the galaxy component. `docs/specs/persistent-world-state.md` §2 and §7 own the structure.

**Carrier instance**:
The original or a numbered replacement occupying a carrier slot.
_Avoid_: Replacement state

**Instance ordinal**:
The stable sequence number distinguishing the original carrier instance from its replacements. `docs/specs/persistent-world-state.md` §2 owns its allocation rule.

**Capability**:
What a carrier enables while it has a particular operational condition.
_Avoid_: Bonus, percentage effect

**Intervention**:
A player action that changes a carrier's operational condition or recovery process.
_Avoid_: Command, influence spend

> **Scope of the `Command` alias** (added by [#71](https://github.com/jcfischer/seelite/pull/71), and it is that PR's reading rather than a ruling from [#41](https://github.com/jcfischer/seelite/issues/41), which introduced the term and did not address the question). Every term in this file is a term of the **consequence model**, so the alias bans "Command" as a name for *a player act on a carrier* — not as an English word. `Game.command(key)` dispatches a keypress and `ComputerCommand` is one frame of an autopilot's output; neither is an intervention on a carrier, and renaming them would make the canonical term mean two things. If the model's owner reads the alias more widely than this, this note is what should be corrected.

**Operational condition**:
A carrier instance's objective physical condition. `docs/specs/persistent-world-state.md` §3.2 owns the enumeration.
_Avoid_: Status flag, lifecycle

**Last-known state**:
The player's timestamped knowledge of a carrier instance and its observed operational condition. It may differ from the objective condition when events happen out of sight.
_Avoid_: Live map state, discovery status

**Recovery process**:
A named, visible, and interruptible in-world process that repairs a carrier instance or replaces it with a new one.
_Avoid_: Respawn timer

> **`repairing` is the persisted spelling of "a recovery process is live"** — both kinds, repair and replacement. A carrier awaiting a replacement is `repairing` in `docs/specs/persistent-world-state.md` §3.2's enumeration and in `src/world-state.ts`, which is narrower than this entry reads. The descriptor's own `kind` says which process it is, and §4 makes the kind decide the valid completion. Renaming the condition is a `worldSchemaVersion` bump, so it is a decision rather than a tidy-up.

**Causal episode**:
The bounded provenance unit for the latest related operational transitions at one carrier slot. `docs/specs/persistent-world-state.md` §5 owns its retained facts and compaction rule.
_Avoid_: Full event log

**Causal-episode ordinal**:
The stable sequence number distinguishing successive causal episodes at one carrier slot. `docs/specs/persistent-world-state.md` §4 owns allocation; §5 owns retention and compaction.

**Consequence area**:
The station, system, or named route affected by a carrier's capability.
_Avoid_: Territory

**Aperture frame**:
The station-local frame the docking checks are stated in: the outward aperture axis, the slot's current roll, and the aperture rectangle. `docs/specs/docking.md` §3 and §5 own its content; `src/docking.ts` is the one place it is built. Every tolerance is measured in the station's *velocity* frame, never the star's.
_Avoid_: Docking port, world-space approach vector

**Closing-speed gate**:
The bound on `|v_rel|` at the instant of crossing the aperture plane, measured in the station's frame. `docs/specs/docking.md` §3 owns the figure; §3.1 owns why it is that figure.
_Avoid_: Approach speed limit, docking speed

**Clearance grant**:
A station's time-boxed permission to enter, and a **precondition** rather than one of the checks. Crossing without a live one is a failed entry *and* turns the station hostile. `docs/specs/docking.md` §6 owns the protocol and its queued and denied replies.
_Avoid_: Docking permission flag, landing request

**Failed entry**:
A crossing of the aperture plane that does not satisfy every check. It repels the ship, damages it, and keeps its clearance grant; unless it was a barge it does not turn the station hostile. Damage is quadratic in the closing speed above a floor, so a failed entry at the gate speed is survivable by design while one flown at the assist cap is not — "it costs you something, not everything" is a claim about the gate, not a guarantee at any speed. `docs/specs/docking.md` §2 owns the model.
_Avoid_: Crash, docking failure

**Operational consequence**:
A mechanically different later situation produced by an intervention and attributable through world evidence and a persistent record.
_Avoid_: Flavour text, global influence
