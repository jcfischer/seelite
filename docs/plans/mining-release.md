# Plan: bring mining to the game

Written 2026-11-06 at main `dda0b64`. Delete this file when the release node closes.

**Goal:** every pilot can find asteroid fields, survey, cut or drill, scoop, sell raw ore or refine it and sell the product, with no flag and with figures the principal ratified.

This file gives the order of work and how to walk it. It holds no status and no decisions:

- **Status** lives on the work graph. Run the command under [Where things stand](#where-things-stand).
- **Decisions** live on the node that made them. Where this file and a node disagree, the node wins.
- **Constraints and the delivery SOP** live on maps #1 and #460. Read both, as `CLAUDE.md` says.

## Where things stand

```bash
for n in 1148 937 1190 922 923 1191 1192 1194 1193 1195 1196 1043 1143 1173 1198 1197; do
  soma graph node $n --repo jcfischer/seelite | sed -n '/^node:/p;/^title:/p;/^status:/p;/^assignees:/p;/^blocked by:/p'
done
```

`--repo jcfischer/seelite` is required on every `soma graph` verb. Without it, the verb silently reads another repo's node of the same number.

**On main behind `?mining=1`:** the rock survey, the laser cut, fragments, the scoop, the Mining Laser mounts, the Equipment extraction row and the Longwall drill (#1099, #1127, #1147, #1149, #1150).

**On main without the flag:** the fields themselves, their collision and the deposit save domain (#965 to #971).

**Missing:** mined ore is a session-only field (`minedOre` in `src/main.ts`), which the Hold page labels "no market yet". There is no market, no refinery and no field discovery, and every mining figure is provisional.

## The route

```text
#1148 survey fixes ────────────────────────────────────────────┐
#1043 field shape* ────────────────────────────────────────────┤
#1143 cockpit study*, #1173 probe fix ──→ #1198 cockpit build ─┤
#1190 discovery decision* ──→ #1191 discovery build ───────────┤
#937 outage decision* ──┬──→ #1194 outages build ─────┐        │
                        └──→ #922 measure ──→ #923 ratify*     │
                                               │      │        │
                                               ▼      │        │
                                 #1192 wallet and pools        │
                                               │      │        │
                                               ▼      │        │
                                 #1193 ore as goods   │        │
                                               │      │        │
                                               ▼      ▼        │
                                 #1195 refinery submission     │
                                               │               │
                                               ▼               │
                                 #1196 refinery collection     │
                                               │               │
                                               ▼               ▼
                                 #1197 release: the flag comes off
```

`*` marks a decision only the principal can make. The arrows are `--blocked-by` edges on the graph, so the frontier enforces this order. #1197 also lists each earlier build directly.

## The steps

### 1. Finish the survey: [#1148](https://github.com/jcfischer/seelite/issues/1148)

A draft PR, #1154, is open. Items 1 and 2 stand alone. Item 3, the rocks in the Navigation console, needs the principal's ruling first. If there is no ruling, the PR says item 3 is absent, as the brief allows.

### 2. Get two decisions: [#937](https://github.com/jcfischer/seelite/issues/937) and [#1190](https://github.com/jcfischer/seelite/issues/1190)

These are grillings. The agent prepares the facts and options, and the principal rules. **The agent never answers for the principal.** They can run in either order.

- #937 is the bottleneck: it blocks #922, and so everything economic.
- On closing #937, amend #1194's brief with the rulings. Split it if the carriers and the query can be judged apart.
- On closing #1190, amend #1191's brief with the rulings.
- Both builds tell their worker to stop if the rulings are absent. Use `soma graph edit` to amend them.

### 3. Measure and ratify: [#922](https://github.com/jcfischer/seelite/issues/922), then [#923](https://github.com/jcfischer/seelite/issues/923)

An agent can build the #922 instrument unattended. It changes no runtime balance. #923 is the principal's approval of an exact table against an exact instrument revision.

If no candidate meets the target, #923 goes back to the implicated decision with the evidence. Do not start any step below on unratified figures.

#923's body still lists its production slices as "still to file". They are now #1191 and #1193 to #1197.

### 4. Shared accounting: [#1192](https://github.com/jcfischer/seelite/issues/1192)

The exact wallet and the commodity pools from #935. **This is the only node that runs without the flag**: it migrates every save and changes the trading-rating rule for every pilot. Its PR says so. Take it alone, and read #935's contract and instrument, which are linked from the brief.

### 5. Outages: [#1194](https://github.com/jcfischer/seelite/issues/1194)

It is takeable as soon as #937 closes and can run alongside the steps above. #1195 needs it.

### 6. Ore as goods: [#1193](https://github.com/jcfischer/seelite/issues/1193)

This is the widest node. #917's compatibility inventory lists each consumer, and it was written against an older commit, so recheck it. The trap is `src/raider-wreck.ts`: extending `COMMODITIES` adds ore to raider loot unless it is explicitly excluded.

### 7. The refinery: [#1195](https://github.com/jcfischer/seelite/issues/1195), then [#1196](https://github.com/jcfischer/seelite/issues/1196)

#1195 is the first consumer of `SaveStore.commit`, so the Game-level Saving state comes with it (#936). Build the console from the #921 prototype; the principal has already approved its layout. Both nodes carry `ranger:needs-eye`, so the principal merges them.

### 8. Discovery: [#1191](https://github.com/jcfischer/seelite/issues/1191)

It is independent of the economy, so it can land at any point after #1190. It carries `ranger:needs-eye`.

### 9. Field shape: [#1043](https://github.com/jcfischer/seelite/issues/1043)

The principal ruled on 2026-11-07 that this lands before release. It is a prototype, and the principal approves the look on the view set. If its close files a separate build, add that build as a blocker of #1197. A profile change bumps `FIELD_GENERATOR_VERSION`, and #951 drops the saved deposits of changed fields.

### 10. The Longwall's cockpit: [#1143](https://github.com/jcfischer/seelite/issues/1143), then [#1198](https://github.com/jcfischer/seelite/issues/1198)

The principal ruled on 2026-11-07 that this lands before release. #1143 is assigned to the principal, so it does not appear on the frontier. On closing it, amend #1198's brief with the approved study.

#1198 is also blocked by [#1173](https://github.com/jcfischer/seelite/issues/1173), because `probe-live-cockpit` crashes on main at its alternate-cabin row. #1173 is takeable now. #1198 re-measures the bridge eye's occlusion table, as #920 requires.

### 11. Release: [#1197](https://github.com/jcfischer/seelite/issues/1197)

Remove the flag and run the whole loop as a fresh commander. This node's autonomy is `approve`, and the principal's yes on the canonical view set is required. The gate will expand to all probes. An unattended worker runs that fallback; in an interactive session, ask the principal before running the full suite.

## Open calls for the principal

| Code | Call | Recommendation |
|---|---|---|
| Q3 | Which rocks does the Navigation console list, and in what order (#1148 item 3)? | The principal's call |
| Q4 | Can [#803](https://github.com/jcfischer/seelite/issues/803) close? #815 integrated the Longwall B and #1150 shipped the drill. | The principal's call |

## Working a node

1. Run the status command above, then claim one node with `soma graph claim <id> --repo jcfischer/seelite`.
2. Read the node, its parent's resolution and maps #1 and #460. Read `docs/pitfalls.md` for the subsystems you touch.
3. Follow map #1's delivery SOP. A PR says `Refs #N`, never a closing keyword, because a closing keyword skips the close gate.
4. Keep the flag rule: without `?mining=1`, a merge does not change play. Each PR names any shared change that runs without the flag.
5. Run the gates in `CLAUDE.md`. Each new probe goes in `scripts/lib/probe-catalog.mjs`; each brief names its live probe.
6. Close with `soma graph close <id> --resolution-file <path> --gist "<line>" --repo jcfischer/seelite`, then run `soma graph decisions 460 --write --repo jcfischer/seelite`.

**Stop and escalate on the node when:**

- A brief's assumption turns false.
- A brief leaves a design choice open.
- A figure would have to be invented. No build worker chooses recipes, prices, contact rules or transaction policy (#872).

## Done

- #1197 is closed with the principal's yes.
- `git grep MINING_ON -- src` finds nothing.
- This file is deleted.
