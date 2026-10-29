---
name: verify-seelite
description: Drive a local Seelite game with control-seelite, capture screenshots and state, and run the existing measurements and browser probes.
---

# Verify Seelite

Read `CLAUDE.md` for the PR gates and probe selection policy. This skill wraps
the existing helpers and scripts. It does not replace their acceptance checks.
The feature map is separate work under the work graph.

## Launch

From the checkout you are verifying, start `npm run dev -- --host 127.0.0.1
--port 5183 --strictPort`. Keep that process handle for cleanup. Set
`CONTROL_SEELITE_ORIGIN=http://127.0.0.1:5183` for every control command.
Use a different port for another checkout. Wait for Vite's ready message.

The executable is `.claude/skills/verify-seelite/control-seelite.mjs`.
Run it directly or with `node`. Commands below use the checkout-relative path.

## Doctor

Run `.claude/skills/verify-seelite/control-seelite.mjs doctor` first. It checks
the server's declared checkout, Playwright's browser launch and the actual GPU
renderer. A failure exits non-zero and names the failed checks in JSON.
Playwright resolution honors the existing `PLAYWRIGHT_DIR` and
`PLAYWRIGHT_MODULE` settings from `scripts/probe-guard.mjs`.

## Drive

Run these as separate commands, with the same origin and session:

```sh
.claude/skills/verify-seelite/control-seelite.mjs goto cockpit
.claude/skills/verify-seelite/control-seelite.mjs wait-settle
.claude/skills/verify-seelite/control-seelite.mjs screenshot /tmp/seelite-evidence/cockpit.png
.claude/skills/verify-seelite/control-seelite.mjs snapshot
.claude/skills/verify-seelite/control-seelite.mjs goto chase
```

`goto` names the game's camera view: `cockpit` or `chase`. Canonical shot names
such as `station-approach` still belong to `npm run views`. The CLI uses the
existing `setView` helper and the player's view key, not a property assignment.
It boots seed 47 in direct flight with raiders off and the full model catalog.
This is a controlled verification fixture, not the guided new-game journey.

The first `goto` starts an isolated browser context in a local driver process.
Subsequent commands keep that game. `wait-settle` waits for the sky, models,
cube bake queue and settle frames. Screenshots also settle before capture.
The game loop pauses between commands to avoid loading other verification runs.
The driver exits after ten idle minutes. Set `CONTROL_SEELITE_SESSION` to a
distinct name when you need separate sessions in one checkout.

Browser commands take the machine probe lock without waiting. Exit 75 means
`NOT RUN` because another run holds it. Retry after that run finishes.

## Measurements and probes

```sh
.claude/skills/verify-seelite/control-seelite.mjs measure aperture-fit 5
.claude/skills/verify-seelite/control-seelite.mjs probe boot
.claude/skills/verify-seelite/control-seelite.mjs probe boot --dry-run
```

`measure <name> [args]` runs the existing `scripts/measure-<name>` script with
Node or Bun according to its extension. `probe <name> [args]` runs
`npm run probe:one -- probe-<name>`, preserving its machine lock and GPU lane.
Both pass through the script's output and exit status. Unknown names list
available matches. `--dry-run` prints the planned command without running it.

The origin setting controls the private game session only. For delegated
measurements and probes, supply the target script's documented origin setting
as well, usually `PROBE_URL=http://127.0.0.1:5183`. Check the script before
running it: some measurements own their server or accept positional arguments.

## Evidence

Control commands emit one JSON result on stdout. Diagnostics go to stderr.
Screenshots report their absolute path, view and measured renderer. `snapshot`
reports the view, position in kilometres, clock, docking phase and readiness.
Save those JSON lines alongside the PNG. A fixture screenshot proves that
view was captured; use the relevant existing probe for gameplay claims.

## Cleanup

Run `.claude/skills/verify-seelite/control-seelite.mjs close`, then stop only
the Vite process you started. Evidence files remain after cleanup. `help`
prints the session socket path; its directory holds `driver.log` for failures.
If a killed driver leaves a stale socket, confirm the driver is gone before
removing that socket. Do not delete a live session's socket.
