# Verify witchspace and an inter-system jump

A jump charges the drive for travel to another system, plays the witchspace
transition, rebuilds the destination system, and finishes with the arrival
rift. It is separate from the J-key cruise used within a system.

A player launches if docked, opens the left console's Galaxy Map tab, and
sets a course to a destination. Back in normal flight, with enough fuel for
the next hop, the player presses the jump key (backtick in the default
layout) to start the charge and waits through the transition. Drop out of
cruise before charging. The Controls tab shows the current binding.
See [the galaxy travel contract](../../../../docs/specs/galaxy-generation.md)
and [the chart's course contract](../../../../docs/specs/galaxy-map.md#8-the-course).

## Run the available real-jump check

Complete [the shared preparation](README.md#prepare-a-run), then run:

```sh
node .claude/skills/verify-seelite/control-seelite.mjs probe witchspace \
	> /tmp/seelite-node-1138/witchspace-jump.log 2>&1
```

Require exit 0 and `1/1 gating probes passed` in the log. The command dispatches
[probe-witchspace.mjs](../../../../scripts/probe-witchspace.mjs). It boots a
fresh direct-flight game, uses the existing nearest-system charge helper,
and checks a real jump across the system rebuild. It also checks drawn
pixels around the cut, cancellation, and the arrival-only path. These are
controlled probe states, not keyboard input from the persistent CLI.

## Capture gap G2

The existing probe reads frames into memory for its checks but saves no PNG.
It closes its browser before returning. The persistent controls cannot
select a destination, start a charge, or hold a transition phase for a
screenshot. `goto cockpit` followed by `screenshot` captures ordinary flight
in a different game.

This run therefore produces `witchspace-jump.log`, not a jump screenshot.
[The feature-map gap](README.md) calls for destination selection, jump input,
and capture at a defined transition phase in follow-up control work.
