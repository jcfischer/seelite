# Capture a station's docked trade console

A station grants clearance, receives a ship into a berth, and presents its
services on the forward cockpit console. The Market tab exchanges the
pilot's cargo for credits and shows shelf stock, hold capacity, and purchase
refusals. Entrusted job cargo occupies the hold and cannot be sold as the
pilot's own goods.

A guided new game starts docked at its trade station. From free flight, a
player selects a station, faces it with F, and cruises toward it with J in
the default keyboard layout. Near the station, C requests clearance. The
player follows the director and flies through the aperture slowly, aligned
with its opening. A new ship has no docking computer; U works only after
one is fitted. At the berth, the player opens Market and uses its buy and
sell controls. Enter launches. See [the docking contract](../../../../docs/specs/docking.md)
and [the public manual source](../../../../src/public-site.ts).

## Run the existing docked capture route

Complete [the shared preparation](README.md#prepare-a-run), then run:

```sh
REQUESTS_EVIDENCE=/tmp/seelite-node-1138/station \
	node .claude/skills/verify-seelite/control-seelite.mjs probe requests \
	> /tmp/seelite-node-1138/station-docking-trade.log 2>&1
```

Require exit 0 and `1/1 gating probes passed` in the log. The command dispatches
[probe-requests.mjs](../../../../scripts/probe-requests.mjs), which boots a
fresh seed-42 game and uses the existing shared `__parkInBerth` fixture to
reach a real station console. It exercises the live Requests and Market
tabs, hold readouts, and a refused purchase through their DOM controls.
The probe also exercises delivery and settlement; it is broader than a
Market-only capture.

Inspect these PNGs in `/tmp/seelite-node-1138/station`:

- `00-before-market.png`: the initial docked station console and Market tab.
- `40-hold-line.png`: the Market tab with hold capacity and entrusted cargo.
- `41-refusal.png`: the visible no-room purchase refusal on the Market tab.

Attach these captures with `station-docking-trade.log`. The probe writes
additional request-lifecycle captures in the same directory.

The seed run on 2026-10-30 did not reach this capture step. All three probe
attempts timed out in `bootedGame` before any PNG was written.
[F1 in the README](README.md#seed-run-on-2026-10-30) records the failed checks
and the unverified acceptance. The filenames above are expected outputs,
not evidence delivered by that run.

This is a scripted berth fixture, not a continuous hand-flown approach from
the fresh arrival point. Some refusal cases set the commander's purse and
manifest before clicking the real control. The persistent CLI has no verbs
for steering, clearance, or buying goods. Those direct player actions need
follow-up controls if a future verification requires a continuous journey;
the existing delegated probe supplies the docked feature capture today.
