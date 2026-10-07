# Node #705 — death wreck verification

Author: ivy-agent / Codex. Date: 2026-10-07.

The dying inventory now seeds one persistent own-loss wreck through the existing
salvage drawing, collision and proximity scoop. Each eligible cargo lot or
fitting has an independent 50% survival roll; the hull, pod and entrusted lots
never become recoverable contents. An eject excludes fitted equipment. The
save schema is 12, with one optional death row across all eight galaxies.
`docs/specs/salvage.md` and `persistent-world-state.md` record the bounds,
placement, discovery and fitting policy.

## Checks

| Check | Result |
| --- | --- |
| `npm test` | 5,566 pass, 0 fail, 303 files |
| `npm run build` | Pass, including TypeScript; existing large-chunk warning |
| `npm run format:check` | Pass |
| `npm run lint` | Pass |
| `npm run check:wiring` | Pass |
| `git diff --check` | Pass |
| `npm run probe:one -- death-wreck` | Pass: real death/reload, death-point row, immediate contact, painted hull pixels and live scoop into the saved hold |
| Affected `death`, `derelict`, `system-sweep`, `save` probes | All pass through the canonical GPU runner |

The fifteen death-wreck headless tests cover deterministic item draws, list-order
and sibling-inventory invariance, per-item survival counts over 1,000 deaths,
entrusted-lot exclusion for both death causes, replacement across galaxies,
no expiry, frame placement and station clearance, partial tonne recovery,
whole fittings, native kg/g recovery, migration/refusals and the actual
SaveStore death path, and the authoritative writer's clock, bounds, empty
replacement and immutability. The survival-count check measures each item's
marginal rate; it does not establish statistical independence between items.

Round 2 moves all death-row and own-loss knowledge writes into
`world-state.ts`'s `withDeathWreck`. `death-wreck.ts` constructs contents and
placement only; Holdings calls the writer directly, without a guard exemption.
The probe indexes its saved-world assertion by the live galaxy, parser refusals
name the death wreck, station clearance takes a named keep-out object, and the
unused assist-frame kind is removed.

Browser selection was performed before the runs. Shared infrastructure changes
selected the broad catalog; the worker contract explicitly restricts this lane
to affected probes. The completed affected runs used ANGLE Metal on
Apple M1 Pro hardware. The new probe writes
`view-set/node-705/death-wreck.png`; the captured dark hull and tethers were
visually inspected. The probe's return uses controlled placement, not a
human-flown approach. The 50% share is a starting figure, not measured balance.

Round 2's first filter invocation omitted `PROBE_SELECTION=1` and was stopped
after four unrelated probes completed; the in-progress audio probe was killed.
The corrected runner explicitly selected the five named affected probes. No
full-suite result is claimed from the interrupted run.

The corrected five-probe run passed death-wreck, death, derelict and
system-sweep. Its save probe passed 36/37 checks but failed the IndexedDB
connection-upgrade row at a reported peak load of 63.5. After `npm test`
finished, `npm run probe:one -- save` passed alone (peak load 22.9), with no
source changes between runs. The failure's cause was not established.

The full browser suite, review, principal approval and
`cp-seelite-death-wreck` remain delivery gates owned by the supervisor and
principal. This receipt does not close the graph node.
