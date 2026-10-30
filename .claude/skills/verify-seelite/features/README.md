# Verify Seelite feature map

Use this map to choose a player feature, run its existing `control-seelite`
commands, and collect the evidence those commands can produce. Run commands
from the checkout root. Read [the control skill](../SKILL.md) for launch,
renderer checks, session lifetime, and cleanup.

| Feature | Route available today | Capture |
| --- | --- | --- |
| [Flight and cockpit](flight-cockpit.md) | Fresh direct-flight session, cockpit camera | `flight-cockpit.png` |
| [Galaxy chart](galaxy-chart.md) | Existing chart workbench probe | **Gap G1:** no live cockpit chart navigation or PNG export through the CLI |
| [Station, docking, and trade](station-docking-trade.md) | Existing Requests probe, starting with the shared berth fixture | **Unverified F1:** boot timeout before any station PNG; expected filenames are in the guide |
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

## Seed run on 2026-10-30

All four documented routes were attempted on the Apple M1 Pro hardware lane.
The cockpit capture passed and `flight-cockpit.png` was inspected. The
galaxy-chart and witchspace probes each reported `1/1 gating probes passed`;
their screenshot gaps remain G1 and G2.

F1: the Requests probe failed at `bootedGame`'s 20-second readiness wait,
before any station screenshot, on the first attempt, its isolated rerun,
and a final unchanged attempt after the host unit suite. The existing Hold
probe, checked as an alternative capture route,
failed at the same readiness wait. The cause within boot readiness is
unattributed; these runs do not prove a docking or trade failure. No tracked
runtime or probe files differ from base commit `02084e636df1d9872d68f1970a9f39ce7a8d3da0`.
The timeout was not changed. The station capture acceptance remains unverified.

The logs are `/tmp/seelite-node-1138/station-docking-trade-first-attempt.log`,
`station-docking-trade-isolated-rerun.log`, `station-docking-trade.log`, and
`station-hold-route.log` in that directory.
There are no station PNGs to attach from this run. Rerun the documented
station command after its existing boot failure is understood.

The full host `npm test` ran once: 7,250 passed and two hit the five-second
test timeout, in `tests/cockpit-model.test.ts` and `tests/exact-amount.test.ts`.
A focused check of those files passed all 27 tests on both this branch and
an archive of the unchanged base. The full-suite result remains red; its
log is `/tmp/seelite-node-1138/npm-test.log`. No test limits were changed.

When finished, run `node .claude/skills/verify-seelite/control-seelite.mjs close`
and stop only the dev server you started. Captures remain outside Git for the
supervisor to attach; the feature map contains the repeatable procedures.
