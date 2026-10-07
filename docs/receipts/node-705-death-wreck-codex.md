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
| `npm test` | 5,560 pass, 0 fail, 303 files |
| `npm run build` | Pass, including TypeScript; existing large-chunk warning |
| `npm run format:check` | Pass |
| `npm run lint` | Pass |
| `npm run check:wiring` | Pass |
| `git diff --check` | Pass |
| `npm run probe:one -- death-wreck` | Pass: real death/reload, death-point row, immediate contact, painted hull pixels and live scoop into the saved hold |
| Affected `death`, `derelict`, `system-sweep`, `save` probes | All pass through the canonical GPU runner |

The nine new headless tests cover independent item draws over 1,000 deaths,
entrusted-lot exclusion for both death causes, replacement across galaxies,
no expiry, frame placement and station clearance, partial tonne recovery,
whole fittings, native kg/g recovery, migration/refusals and the actual
SaveStore death path.

Browser selection was performed before the runs. Shared infrastructure changes
selected the broad catalog; the worker contract explicitly restricts this lane
to affected probes, so only the five named probes ran. They used ANGLE Metal on
Apple M1 Pro hardware. The new probe writes
`view-set/node-705/death-wreck.png`; the captured dark hull and tethers were
visually inspected. The probe's return uses controlled placement, not a
human-flown approach. The 50% share is a starting figure, not measured balance.

The full browser suite, review, principal approval and
`cp-seelite-death-wreck` remain delivery gates owned by the supervisor and
principal. This receipt does not close the graph node.
