# Verify Seelite feature map

Use this map to choose a player feature, run its existing `control-seelite`
commands, and collect the evidence those commands can produce. Run commands
from the checkout root. Read [the control skill](../SKILL.md) for launch,
renderer checks, session lifetime, and cleanup.

| Feature | Route available today | Capture |
| --- | --- | --- |
| [Flight and cockpit](flight-cockpit.md) | Fresh direct-flight session, cockpit camera | `flight-cockpit.png` |
| [Galaxy chart](galaxy-chart.md) | Existing chart workbench probe | **Gap G1:** no live cockpit chart navigation or PNG export through the CLI |
| [Station, docking, and trade](station-docking-trade.md) | Existing Requests probe, starting with the shared berth fixture | `station/00-before-market.png`, `station/40-hold-line.png`, `station/41-refusal.png` |
| [Witchspace and jump](witchspace-jump.md) | Existing real-jump probe | **Gap G2:** no jump input or held-phase PNG capture through the CLI |

The probe routes run in their own fresh browser contexts. They do not operate
the persistent camera session. `screenshot` captures only that persistent
session, so running it after a probe does not capture the probe's chart, berth,
or jump. A probe that reads pixels without writing a PNG supplies contract
checks, not an attachable screenshot.

## Prepare a run

Start the dev server in a separate terminal and keep its process handle:

```sh
npm run dev -- --host 127.0.0.1 --port 5183 --strictPort
```

Wait for Vite's ready message. In the terminal for the feature commands, set:

```sh
export CONTROL_SEELITE_ORIGIN=http://127.0.0.1:5183
export CONTROL_SEELITE_SESSION=node-1138-features
export PROBE_ORIGIN=http://127.0.0.1:5183
export PROBE_URL=http://127.0.0.1:5183
mkdir -p /tmp/seelite-node-1138
node .claude/skills/verify-seelite/control-seelite.mjs doctor \
	> /tmp/seelite-node-1138/doctor.json
```

Require `ok: true` for the server, Playwright, and hardware renderer before
continuing. Use a free port and a different session name for another checkout.
`PROBE_URL` tells the delegated single-probe runner which server to use; it
passes `PROBE_ORIGIN` to the probe while preserving that probe's seed.

Inspect browser selection before running the feature commands:

```sh
npm run probe:select -- --base origin/main --head HEAD
```

These Markdown guides change no game or probe code. Their documented probe
commands exercise the named features for this node's acceptance check; they
are not a full PR browser-gate run. Follow `CLAUDE.md` for the final PR gate.

Run the four feature files in table order, serially. Stop on a nonzero exit.
Exit 75 and `NOT RUN` mean another run owns the machine's browser lock. Wait
for it to finish and retry; do not count that attempt as a feature run.
The cockpit procedure closes the previous session before booting, so it does
not reuse an earlier game's state. Each delegated probe creates its own game
or workbench and closes its browser on completion.

## Collect review evidence

Attach the available PNGs and command logs from `/tmp/seelite-node-1138` to
the PR. Inspect each PNG before treating it as evidence. Preserve the doctor
result and cockpit JSON beside the captures. Probe logs report checks and
the renderer lane; they are not the camera CLI's JSON responses. After a
probe failure, read its log and treat any PNGs already written as partial
evidence, not a passing run.

G1 and G2 need follow-up control work before all four features can produce
screenshots through this CLI. G1 needs a way to open the live Galaxy Map tab
and capture it. G2 needs a way to select a reachable system, start a jump,
and capture a defined transition phase. **Gap G3** is a continuous player
route from flight through clearance, docking, and trade: the persistent CLI
has no steering, clearance, or market input. The existing station probe
instead owns a berth fixture. Do not add a temporary Playwright script,
substitute an unrelated cockpit PNG, or claim the workbench is the live
chart. New control verbs are outside node #1138.

## Verification run on 2026-11-06

The doctor confirmed this checkout's server and the Apple M5 Pro hardware
renderer. The cockpit route produced `flight-cockpit.png`; its JSON reports
`view: "cockpit"`, `dockPhase: "flying"`, settled models, and an empty bake
queue. The PNG was inspected for the cockpit and flight instruments.

All four documented routes ran. Each delegated probe reported `1/1 gating
probes passed`: galaxy chart in `galaxy-chart.log`, station in
`station-docking-trade.log`, and jump in `witchspace-jump.log`. These are
three separate single-probe runs, not a full-suite pass. Probe selection at
`43dfd37b10b01260fb10f19faeb57e4a31524013` against
`7a69e5b5e029a0f9d28702d0f3e94d1c99fee68d` selected no probes for the
documentation-only diff; the three runs above verify the documented routes.

Build, format, script lint, and comment lint passed. The required full host
`npm test` ran once: 7,448 passed and four exceeded their five-second test
limits across 461 files. The failures were the edited-geometry and instanced
cast cases in `tests/aperture-raycast-memo.test.ts`, the deterministic visual
archetype case in `tests/ship-mesh.test.ts`, and the sold-into market-cycle
case in `tests/station-commerce.test.ts`. The full log is `npm-test.log` in
the evidence directory. Runtime, scripts, tests, and package files match
`origin/main`; no timeout was changed.

Focused runs of those three files passed all 49 tests on this branch and on
an archive of `origin/main` at `7a69e5b5`; their logs are
`branch-focused-tests.log` and `base-focused-tests.log`. These isolated
passes do not replace the red full-suite result or establish its cause.
The supervisor's full base comparison remains the check for that result.

The station route produced all three Market PNGs listed above. They were
inspected: the initial market shows an empty 20 t hold; the next capture
shows 8 t entrusted and 12 t free; the refusal capture says there is no room
with 8 t entrusted to a job. These are the existing probe's controlled states,
not a manual docking flight.

The earlier 2026-10-30 run timed out in boot readiness before any station
capture. This run reached the capture steps without changing runtime code,
probe code, or timeouts. That establishes the current capture route; it does
not identify the cause of the earlier timeout.

Current command logs and captures are in `/tmp/seelite-node-1138` for the
supervisor to attach to the PR. G1, G2, and G3 remain control gaps; the
feature map does not claim four feature screenshots or a continuous flown
docking route.

When finished, run `node .claude/skills/verify-seelite/control-seelite.mjs close`
and stop only the dev server you started. Captures remain outside Git for the
supervisor to attach; the feature map contains the repeatable procedures.
