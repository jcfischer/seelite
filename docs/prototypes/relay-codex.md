# The pirate sensor relay: one consequence loop, flown

Author: Claude / Ivy · 2026-09-16
Node: [Prototype: pirate sensor relay consequence loop](https://github.com/jcfischer/seelite/issues/43)
Doctrine: [operational consequences](https://github.com/jcfischer/seelite/issues/41), `docs/specs/persistent-world-state.md`
Status: prototype, in development builds only. The node closes on the
principal flying the loop and judging it, not on this document or its probe.

## Replay

The branch is `node-43-relay` (PR #350), checked out in the worktree
`.worktrees/seelite-43`. A dev server for that worktree runs on port 5431 while
the session that built it is alive:

```
http://127.0.0.1:5431/?boot=direct&seed=42&relay-prototype=1
```

Two other servers listen on this machine — 5330 serves `main` and 5343 the
merged #343 worktree — and belong to other sessions; leave them. If 5431 is
gone, start it from the worktree with its own vite cache, because
`node_modules` is a symlink shared with those servers and two servers
optimising one cache leave pages that never boot:

```bash
cd .worktrees/seelite-43
cat > /tmp/vite-43.config.mjs <<'EOF'
import base from "/Users/fischer/work/cyphr/spark/seelite/.worktrees/seelite-43/vite.config.ts";
export default { ...base, root: "/Users/fischer/work/cyphr/spark/seelite/.worktrees/seelite-43", cacheDir: "/tmp/vite-cache-43" };
EOF
node node_modules/vite/bin/vite.js --config /tmp/vite-43.config.mjs --port 5431 --strictPort
```

Once merged, it is `npm run dev` and
`http://localhost:5173/?boot=direct&seed=42&relay-prototype=1`.

Seed 42 starts in RAAQU (system 58, government 6, one raider slot), which has
a trade station and a shipyard on one orbit round its inner planet. The relay
watches the **trade station** and stands about 670 km ahead of it along its
orbit, 120 km below the orbital plane, moving with it. Everything below is
behind `?relay-prototype=1`, which is `false` in a production build so its
branches fold — the relay modules, the mesh and the cue's aside are still in
the bundle, inert. The relay's carrier key exists regardless, so a save does
not depend on the flag.

The loop, as a pilot flies it:

1. **Before.** Set the trade station as target and cruise to it. Every leg
   meets a raider. Cruise to the shipyard instead: about one leg in four does,
   the law for this government.
2. **Find it.** Fly to the trade station's approach. Inside 2,500 km of the
   relay a cue appears on the right of the glass: `PIRATE RELAY SIGNAL`, five
   bars of strength, degrees off the nose and an arrow. It never shows a range
   or a marker. Turn to put the bearing on the nose and fly until the bars
   fill; the search region is a thousand kilometres round the station.
3. **Identify it.** Inside 150 km the cue changes to `PIRATE RELAY ·
   IDENTIFIED` with a range, the relay becomes a scanner contact, a target
   (`RELAY · HOSTILE` on the Target panel) and a marker, and the Galaxy Map's
   station card would carry the row under `IDENTIFIED` if it listed relays.
   That is the knowledge write.
4. **Destroy it.** Select it, close to a few kilometres, and hold fire. Ten
   seconds of pulse fire spend its hull. The cue reads `DESTROYED`, the dish
   drops and the lamp goes out, and the Communications console logs
   `Pirate relay destroyed`.
5. **After.** Cruise to the trade station: no leg meets a raider. Cruise to
   the shipyard: the law as before. A raider already on you is not made to
   vanish.
6. **Leave and return.** Jump to a neighbour and back, or save and reload.
   The relay is still destroyed, still identified, still drawn as a wreck.
7. **Recovery.** Twenty minutes after the kill the log reads `under repair`;
   an hour after it, `back in service`, the relay is drawn lit again, and the
   trade route is watched again.

`?raider` still forces a raider onto every leg, so use it for a reach check
and never for reading the before and after.

## The decisions taken as proposals

Each is the agent's, taken so the loop could be flown; each is the principal's
to reverse at the close.

- **D1 — The capability is one dial on the leg law.** A leg whose target is
  the watched station is `certain` while the relay is operational and `none`
  while it is not; every other leg is `law`. Certain and none rather than a
  softer shift, because the node's question is causal legibility and a
  26% → 0% change is invisible to a pilot who flies the route twice. The
  relay does not conjure a raider: `certain` still needs an operational slot.
- **D2 — One relay per system, watching the trade station.** The station
  every player returns to, so the route is the one they fly. Where a system
  has no trade station the first station is watched; where it has none, there
  is no relay.
- **D3 — Placement is hundreds of kilometres, not thousands.** 400–800 km
  along the station's orbit, 120 km off its plane, co-moving. Normal flight
  is capped at 2 km/s, so a search is a few minutes and not a commute.
- **D4 — Discovery is a signal, identification is a range.** The cue reads
  strength and bearing inside 2,500 km and hides the position; the relay is a
  contact and a target only inside 150 km, well under scanner range, so the
  scanner cannot find it first.
- **D5 — The intervention is the pulse laser, and the kill is a destroy.**
  60 hull points, no shields, against a 60 m hit sphere: ten seconds of fire.
  `destroy` rather than `disable` because only a destroy carries a scheduled
  replacement in the world-state model, which is what puts the recovery on
  the game clock and in the log without a new mechanism.
- **D6 — Recovery is the raider's lifecycle at twice its length.** Twenty
  minutes destroyed, forty repairing, then a replacement. Visible in the log
  and in the drawn wreck; there is no repair convoy to meet yet.
- **D7 — Not enrolled in the carrier namespace.** `relay-00` is written
  under a reserved id and is not in `enumerateCarriers` or the golden table,
  because `parseWorld` refuses a `worldGeneratorVersion` it does not know and
  a bump refuses every existing save until a migration exists. Enrolment, the
  fingerprint, version 7 and the migration graduate with the node that makes
  the relay production content, which is not yet charted (#344 consumes this
  result and is not that node). The missions spec gave this node that
  decision; this is it, deferred with its reason.

## What is measured

`bun run scripts/measure-relay-route.ts 42 2000`:

```
law for this government: 25.7% of legs
route                       relay up   relay down
to station-trade            100.0%       0.0%
to station-shipyard          25.4%      25.4%
```

`scripts/probe-relay.mjs` flies the loop in the running game, 20 checks: the
arrival point reads nothing; six legs to the trade station all meet a raider
and twenty-four to the shipyard meet some and not all; the cue inside the
signal and the identification inside its range; the kill in 100 steps on the
recorded run, asserted within 90–130,
with the player's provenance and the route as its consequence area; six legs
after meet nothing and the control route is untouched; a forced raider in a
duel is not nulled; the cue's range agrees with the Target panel's, both
read at the clock as it stands; the serialized world parses back destroyed; a jump to
QUARAT and back finds the wreck; hiding the wreck's mesh moves 1,343 pixels;
the log's three lines on the clock and the replacement drawn lit. On
SwiftShader.

## What is simulated, and what is not

- The relay's hull is flight state. Leave the system with it half-spent and
  it is whole when you return.
- There is no repair convoy, no NPC that rebuilds the relay in view, and no
  way to interrupt the replacement. The doctrine wants recovery interruptible;
  the prototype has it visible and caused, and stops there.
- Identification is by range alone. No scan, no module, no time on target.
- The relay does not shoot back, call raiders, or move.
- Every system has a relay, and every trade route in the game is `certain`
  while the flag is on. That is a prototype dial for judging the loop, not a
  tuning proposal: with the flag off nothing changes.
- The canonical view set is untouched. `HEADED=1 node scripts/probe-relay.mjs`
  writes five 1440x900 captures under `/tmp/seelite-43-evidence` for the
  principal's look; they are not a contact sheet and claim no lever.

## What the Requests trial can point at

#343's `Clear the survey route` offer describes this relay. Its fixture stages
(search, identify, disable) are still fixtures: wiring them to the knowledge
row, the destroy episode and the route's detection is #344's, which consumes
this result rather than restarting it.
