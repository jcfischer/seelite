# Station capability operational time

Refs #937. Approved in conversation on 2026-11-07: D1–D5 individually,
then the complete contract draft (Q6). This is a decision contract, not shipped
station outages. The graph resolution owns the decisions; this spec owns the
structural detail. It supersedes station-damage.md E3's initial-only reading,
E4's stateless projection, E5's pointwise compaction and E7's obsolete versions.

## Gameplay and rates

Natural outages last 600–1,200 seconds of **game time**, drawn per capability
and cycle. A pilot can leave, do other work and return. Refinery processing
pauses; new submissions refuse, but completed output remains collectable.
Fuel remains available wherever the pilot can dock. Capabilities fail
independently; an absent capability is not a disabled one.

With government `g` in 0..7 and no raider pressure:

```text
p0 = 0.12 - 0.09 * g / 7
o0 = p0 / (1 - p0)
m  = 1 + operationalRaiderSlots / totalRaiderSlots
p  = m * o0 / (1 + m * o0)
```

For an empty raider roster, use `m = 1`. Validate counts, do not clamp corrupt
state. The pressure multiplier ranges from 1 to 2. At full pressure, disabled
time is approximately 21.43% in anarchy and 5.83% in corporate systems; these
are approved design figures calculated from the odds, not measured gameplay.
`p` is the initial stationary share and the long-run share at **constant**
pressure. It is not a promise about a population immediately after pressure
changes. Repair interventions can also reduce actual disabled time.

Clearing raiders reduces future outage frequency. An ongoing outage keeps its
original natural end, whatever the raiders subsequently do. A repair restores
service immediately through that original end, without advancing the underlying
cycle or protecting against later outages. Pressure changes cannot resurrect
the repaired cycle. Repair rewards and refinery custody after destruction or
relocation remain outside this decision.

## Deterministic alternating intervals

An outage cycle has a duration `D` and an operational-work budget `B = D / o0`.
Its cycle ordinal is distinct from the world's provenance-bearing Causal-episode
ordinal; it does not replace or increment that existing state.
While naturally operational, consume remaining budget at `m` units per second.
On exhaustion, the service is disabled for exactly `D` seconds. At its natural
end, start the next cycle's full budget. A repaired outage supplies service
while its original disabled clock continues; it does not consume the next
budget early. At constant pressure the cycle's operational time is
`D / (m * o0)`, so its disabled share is exactly `p`.

Production adds an independent append-only RNG domain for capability timing.
Derive each capability seed from world seed, galaxy, stable station carrier key
and fixed slot name, then split phase, remaining position and cycle-duration
draws. The decision instrument uses a local independent hash, not a production
domain allocation. Adding an absent slot or another capability consumes no
sibling draw. For later cycles draw `D = 600 + 600*u`, `u` in [0,1).
Require a safe cycle ordinal; never wrap its high bits into an earlier cycle.

The initial cycle is length-biased because a random observation is more
likely to fall in a longer cycle:

```text
D_initial = sqrt(600^2 + u * (1200^2 - 600^2))
phase = disabled with probability p, otherwise operational
remaining fraction = 1 - independentUniformDraw
```

Conditional remaining time is uniform within the selected phase. An initial
outage can have fewer than 600 seconds **left**; its complete duration still
meets the range. Initial raiders use their generated operational roster.
Subsequent causal changes advance the phase; visits, reads and save frequency
never reseed it. Intervals are half-open `[start,end)`. At a shared timestamp,
settle the elapsed interval and natural completions before applying external
mutations in the world's deterministic order. A repair exactly at natural
completion cannot suppress the following cycle.

## Causal anchors and retained queries

Seed, current raiders and the clock cannot reconstruct discarded pressure
history. Retain at most one causal timing anchor per generated capability:
anchor time, cycle ordinal, natural phase, remaining operational budget or
fixed outage end, and live repair suppression. Read government, seed, roster
and parent from generated identity; do not duplicate them as authoritative save
values. Untouched capabilities derive their phase from genesis. Reads project
without writing frame-by-frame snapshots. Causal pressure changes re-anchor
affected capabilities, including those the pilot has never visited.

Before a raider mutation, lazy recovery, repair, migration or compaction removes
needed facts, settle dependent work through that boundary using the **old**
availability. Then project and retain the replacement causal anchor. A large
clock advance handles all intervening lazy recoveries in chronological order,
including across systems. A small-step run and that large advance must agree.
No unbounded event/outage history and no scheduled-disable transition are added.

`operationalDuration(capability, from, to)` is defined only from the retained
anchor onward; it splits at known recovery boundaries. Queries into discarded
history fail explicitly. The build brief's former promise of any historical
interval is withdrawn. The queue's settled work is what replaces that history.
An absent capability cannot be queried as operational; invalid identity, times,
counts, phases or causal rows fail validation rather than silently granting time.
Future queries are conditional projections, never authority to grant progress
beyond the authoritative world clock or the next unresolved causal boundary.

Each refinery queue carries `accountedThrough` and remaining FIFO work. Consume
only operational seconds after that cursor, in submission order. Settle an
existing queue before adding another job; new work cannot receive old service
time. An empty queue discards unused service time. Splitting the same work among
jobs does not increase throughput. Exact recipe work units and settlement remain
the balance/accounting nodes' contracts; this node supplies service seconds.

Compaction requires **temporal** equivalence, not just matching conditions now.
A repair override cannot disappear until its original outage ends and dependents
are settled. A pressure anchor remains while its removal changes future timing;
retaining it indefinitely is bounded by the capability roster. Never erase it
merely because the service is currently operational.

## Current catalogue mapping

| Station type | Present capability slots |
| --- | --- |
| Trade | market, equipment |
| Refinery | market, equipment, exclusive |
| Shipyard | market, equipment, exclusive |
| Outpost | none while its berths and market remain unavailable |

Use fixed slot identities, not push order. Market gates commodity purchases and
sales. Equipment gates universal equipment purchases and module kinds without a
legacy type scope. Exclusive gates type-scoped purchases: refinery Fuel Scoops
and Mining Laser; shipyard Extra Energy Unit, Military Laser, Identity Scanner,
Long-Range Scanner and hull purchases. Preserve the hull refusal order: rung
lock before damaged exclusive capability.

Use the current catalogue's scope, not the old spec's count of ten items. Where
the legacy Equipment path already offers a Mining Laser at a shipyard under
`?mining=1`, exclusive gates that purchase too. `moduleStock` currently checks
only its refinery scope; do not broaden either path's stock in this work.
Removing/fitting owned equipment and selling recovered fittings are outside the
purchase gates. Outpost commerce remains its existing separate unbuilt decision.

## Migration and rollout

Instrument base `804c60f`: world generator 10, world schema 3, envelope schema
17. Production adds capability carriers without changing any old carrier key,
type, parent or placement. It takes generator 11, world schema 4 and envelope
18, with an explicit migration of currently accepted legacy envelopes/worlds.
If another change consumes those next versions first, rebase and allocate the
next versions; do not reuse a version for incompatible bytes.

Validate the old envelope and its world integrity hashes under the old format
before migration; re-encode and hash the migrated state only after validation.
Preserve all existing domains, identities, cash, cargo, clocks and docked state.
At migration time initialize capability timing from the stationary distribution
for then-current raiders and anchor it at that clock. There was no old refinery
queue to award service time to. Refuse impossible or malformed rows and retain
the original stored record on failure. Round-trip supported old saves and the
new format, including loading a mining save without the flag.

The carriers/schema migration are shared infrastructure and must be named as
such in the PR. Save/load preserves causal state regardless of flag. The new
commerce refusals and availability UI are enabled behind `?mining=1` until the
release node removes that flag. The causal timeline is shared infrastructure;
queue consumers settle at
all causal boundaries even while not visible. Loading without the flag must not
erase timing or progress or award disabled time to an already submitted queue.
The production PR must prove that the flag-off commerce path retains its old
behavior; the release node owns the deliberate all-player behavior change.

## Evidence and remaining production checks

Run `node --test docs/prototypes/capability-outages-937.test.mjs` for the decision
instrument and `node docs/prototypes/capability-outages-937.mjs` for sampled
stationary shares and complete-cycle integration. Run
`bun docs/prototypes/capability-outages-937-corpus.ts` for actual generated roster
counts and populated candidate anchor sizes. The [receipt](../receipts/node-937-capability-operational-time.md)
states the measured scope and limits, including the bounded protocol model.

The production build must repeat these checks against its real module and save
envelope. Extend `scripts/measure-save-size.ts` with untouched, partly affected
and every-capability-anchored cases across all eight galaxies, plus every
refinery's eight-job queue, completed custody and maximum supported payloads.
Report new-domain and complete-envelope bytes separately, preserve old-format
readback, and demonstrate that repeated events replace anchors rather than grow
history. The decision corpus measures candidate timing records only; it neither
proves the complete save ceiling nor creates a browser storage quota.

Keep capability generation, timing/query and causal settlement boundaries in
one coherent build (node #1194): carriers alone would leave a second transient
availability authority. The refinery build consumes its boundary API; it does
not choose another timing function.
