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
| `npm test` | Round 4: 5,567 pass, 0 fail, 303 files |
| `npm run build` | Pass, including TypeScript; existing large-chunk warning |
| `npm run format:check` | Pass |
| `npm run lint` | Pass |
| `npm run check:wiring` | Pass |
| `git diff --check` | Pass |
| `npm run probe:one -- death-wreck` | Pass: real death/reload, death-point row, immediate contact, painted hull pixels and live scoop into the saved hold |
| Round 2 affected `death`, `derelict`, `system-sweep` probes | Pass through the canonical GPU runner |
| Round 2 selected `save` probe | 36/37; IndexedDB connection-upgrade check failed, cause unestablished |
| Round 2 solo `save` rerun | Pass with no source changes; does not erase the selected-run failure |
| Round 3 affected `death-wreck`, `derelict`, `raider-consequence` probes | 3/3 pass through the canonical GPU runner; partial run |
| Round 4 semantic selection | 17/18 pass; navigation-console timed out during boot before its assertions |
| Round 4 solo `navigation-console` rerun | 1/1 pass with no source changes; does not erase the selected-run failure |

The death-wreck headless tests cover deterministic item draws, list-order
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

Round 3 restores the pre-node tonne-only rule for ordinary drifting canisters.
Native kg/g recovery now uses the explicit `recoverWreckCargo` path from the
wreck scoop only. Regression checks cover ordinary kg/g refusals with an empty
or full hold, and full-hold wreck recovery of Gold, Platinum and Gem-Stones
with the purchase basis preserved. `npm test` passed 5,566 tests in 303 files;
build, format, lint, launcher wiring and whitespace checks passed.

The round 3 selector again requested the whole catalog because the branch
changes shared probe infrastructure. The worker contract limits this lane to
affected probes: the runner received `PROBE_SELECTION=1` and exactly
`probe-death-wreck.mjs,probe-derelict.mjs,probe-raider-consequence.mjs` in
`PROBE_FILES`, with `PROBE_CONCURRENCY=1`. The sandboxed launch failed before
any probe ran; the retry with Chromium launch permissions passed all three
on ANGLE Metal / Apple M1 Pro, peak load 11.7. The other 92 probes were not run.
Round 3 does not replace the round 2 save evidence or establish its failed
check's cause.

Round 4 reserves `commander-wreck` in the canonical CarrierKey namespace and
documents its non-generated identity in the CarrierKey and Wreck glossary.
Generic knowledge writes and bulk relay reports preserve the source and time
of own-loss knowledge. A red-first headless regression observes the own wreck
through derelict identification, revisit, scan and relay report, then
round-trips every result through the save parser. All 16 death-wreck tests pass.

The round 4 selector received the five changed code/spec/test paths and an
intent written for this repair. It evaluated 95 contracts in semantic mode;
the canonical `probe:pr` retry selected 18. The sandboxed Chromium launch
aborted before checks; the launch-permitted retry used ANGLE Metal / Apple
M1 Pro and ran one probe at a time. Seventeen passed, including death-wreck,
death, derelict, carrier-scan, relay, save and system-sweep. Navigation-console
timed out in `bootedGame` (20 s wait), with its probe reporting peak load 99.8;
the selected run reported peak load 164.6. Once the lock was absent,
`npm run probe:one -- navigation-console` passed alone in 8.5 s, peak load 99.4,
without source changes. The timeout's cause is unestablished. These are partial
runs; 77 of 95 probes were outside the selected run.

The full browser suite, review, principal approval and
`cp-seelite-death-wreck` remain delivery gates owned by the supervisor and
principal. This receipt does not close the graph node.

## Sage round 6 — explicit death-container units

Schema 12 now persists an explicit native `unit` on every death container.
The parser requires a good's unit to match `commodity(id).unit` and requires
`t` for fittings. Generated derelict rows retain their tonne-only wire form.
A red-first regression checks all three units, partial remaining quantities,
and missing, unknown or mismatched units with valid recomputed checksums.
The existing sweep test now includes wreck-free, other-system and removed-wreck
negative controls; the source already filtered those cases correctly.

Verification: `npm test` passed 5,568 tests across 303 files, 0 failures;
`npm run build`, format, lint, launcher wiring and whitespace checks passed.
The semantic selector chose boot, death-wreck, death, derelict, hold,
raider-consequence and traffic-engagement. The canonical GPU runner ran that
exact seven-probe selection sequentially: 7/7 passed in 104 s, peak load 49.6,
on ANGLE Metal / Apple M1 Pro. The death-wreck probe now checks that the real
reload preserves the explicit units before the live scoop recovers the cargo.
The initial sandboxed browser launch aborted before any probe ran; the
launch-permitted retry produced the passing result. This is partial evidence:
88 of 95 probes were not run, and the supervisor owns the full-suite gate.

The optional Holdings/simulation boundary refactor, parser profiles, validation
extraction, ordinal helper and shared decrement are deferred to avoid broadening
this schema repair. Notice-unit hoisting and the probe lookup helper are deferred
as cosmetic cleanup. No graph node or map was edited.
