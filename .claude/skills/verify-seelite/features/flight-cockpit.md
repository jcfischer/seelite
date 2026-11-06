# Capture flight and the cockpit

The cockpit presents the pilot's flight instruments, target cues, and console
panels while the ship flies through the current system. Ordinary flight,
cruise, and inter-system jumps are separate travel regimes.

A player chooses a guided or free new game. Guided starts docked after the
opening flight; Enter launches from the berth. Free starts in flight. In the
default keyboard layout, 2 faces forward, 1 and 3 open the side panels, and V
changes between cockpit and outside views. The Controls tab lists remapped
keys. See the [public manual source](../../../../src/public-site.ts).

## Run the capture

Complete [the shared preparation](README.md#prepare-a-run), then run:

```sh
node .claude/skills/verify-seelite/control-seelite.mjs close
node .claude/skills/verify-seelite/control-seelite.mjs goto cockpit \
	> /tmp/seelite-node-1138/flight-goto.json
node .claude/skills/verify-seelite/control-seelite.mjs wait-settle \
	> /tmp/seelite-node-1138/flight-settle.json
node .claude/skills/verify-seelite/control-seelite.mjs snapshot \
	> /tmp/seelite-node-1138/flight-snapshot.json
node .claude/skills/verify-seelite/control-seelite.mjs screenshot \
	/tmp/seelite-node-1138/flight-cockpit.png \
	> /tmp/seelite-node-1138/flight-screenshot.json
node .claude/skills/verify-seelite/control-seelite.mjs close
```

The [driver](../driver.mjs) boots seed 47 with `boot=direct`, raiders off,
and the full model catalog in an isolated context. This captures free flight,
not the guided opening or a manual flight maneuver. The camera route uses
the existing player-view helper.

Require `ok: true`, `view: "cockpit"`, and `dockPhase: "flying"` in the
capture result. Require settled models and an empty bake queue. Inspect
`flight-cockpit.png` for the cockpit frame and flight instruments over the
system sky. The PNG proves the view was reached and drawn; it does not test
thrust, combat, or docking.
