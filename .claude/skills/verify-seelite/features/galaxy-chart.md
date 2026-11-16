# Verify the galaxy chart

The galaxy chart shows the current galaxy's systems, the jump neighborhood,
system records, and planned courses. Opening it does not reveal undiscovered
local objectives. See [the chart contract](../../../../docs/specs/galaxy-map.md).

A player faces the left console with 1 in the default keyboard layout, opens
the Galaxy Map tab, and finds a system with the chart's finder or picks it in
the chart. The player can orbit and zoom the chart, inspect the record, and
set a course. The Navigation tab remains the list of bodies in the current
system. All of this stays inside the cockpit.

## Run the available contract check

Complete [the shared preparation](README.md#prepare-a-run), then run:

```sh
node .claude/skills/verify-seelite/control-seelite.mjs probe galaxy-map \
	> /tmp/seelite-node-1138/galaxy-chart.log 2>&1
```

Require exit 0 and `1/1 gating probes passed` in the log. The command dispatches
[probe-galaxy-map.mjs](../../../../scripts/probe-galaxy-map.mjs) through the
existing single-probe runner. It opens fresh desktop and narrow workbenches
at `?galaxy-map=0`, with no live `Game` behind the chart. It checks picking,
projection, and routing behavior. It does not open the player's cockpit tab.

## Capture gap G1

There is no command sequence that opens and captures the live chart with
the current persistent controls. `goto` accepts only `cockpit` and `chase`;
it cannot select a console tab. The chart probe closes its own pages without
writing PNGs. A later `screenshot` command cannot reach those pages.

This run therefore produces `galaxy-chart.log`, not a chart screenshot.
[The feature-map gap](README.md) calls for live-tab navigation and capture
in follow-up control work. Do not substitute the workbench check for that
missing player-route evidence.
