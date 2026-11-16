# Mining release: the flag comes off

Refs #1197. `?mining=1` is gone. Every pilot can survey, cut or drill, scoop,
sell raw ore and refine it, and the figures are the table #923 ratified.

## What changed

- **The flag.** `MINING_ON` and the `?mining` read are deleted from
  `src/main.ts`; the mining surfaces, the fire groups, the Hold page's ore bay,
  the market's ore rows, the Refinery tab, the equipment scope and the service
  outages are unconditional. `?rock-pick`, `?survey-interrupt`, `?survey-range`
  and `?survey-dwell` are removed with it; the survey decays and the front rock
  is the pick.
- **The boot no longer hands out a Mining Laser.** `fitPrototypeMiningLaser`
  stays as the probe seam; a pilot buys the module at a refinery or shipyard
  (trade rung 2), and every stock hull already carries its 1E cargo scoop.
- **The ratified figures.** `RECOVERY_T_PER_H` moves from 1 to 10; the survey
  lifetime (24 h), the 35% refinery fee, 1 s/t throughput, the 0.35 raw value
  share with 0.5 elasticity, the 8–63 t raw stock, the 37.5 t/s drill at 6 E/s
  and 2.5 heat/s, the 0.1 t/s grade-E Mining Laser with its 0.5/0.4/0.75 ore
  shares, the 3,000 t skips and the field population were already the ratified
  values. The provisional notes in `rock-extraction.ts`, `rock-drill.ts`,
  `rock-survey.ts`, `asteroid-field.ts`, `scoop-window.ts` and
  `deposit-state.ts` are gone.
- **A deposit row never carries a zero debit.** `debitSurface` and `debitDeep`
  rebase both debits and now drop one that has fully recovered. Before this, a
  rock cut and then drilled after its surface debit had recovered wrote
  `surface: 0`, which the save parser refuses — the refinery's commit then
  failed with "Nothing committed". Found by the release probe.
- **The changelog and the manual.** The principal's approved sentence is the
  newest changelog entry, and the manual has a Mine section.

## Evidence

- `scripts/probe-mining-release.mjs` (new, in the catalog): a courier at trade
  rung 2 buys a Mining Laser through the live Equipment tab at a refinery berth,
  surveys a deep charted rock, cuts it, scoops the ore, docks and sells it raw
  from the Market tab; then buys the Longwall at a shipyard, drills the same
  surveyed deposit into its skips, submits a refinery job, saves and reloads
  with the deposit debit, the reading, the job and the custody intact, collects
  the product and sells it. 21 checks, no URL flag.
- `tests/mining-release.test.ts`: the ratified table, a mined → refined → sold
  reconciliation through #935's cost recovery, a pre-release save that loads
  with nothing lost, and a source scan for `MINING_ON` and the removed query
  parameters.
- The mining probes run with no flag: `probe-mining-survey` (including a
  `?mining=0` page that behaves identically), `probe-mining-drill`,
  `probe-mining-mounts`, `probe-mining-goods`, `probe-refinery-jobs`,
  `probe-refinery-collection`, `probe-field-discovery`, `probe-capability-outage`,
  `probe-miner-cockpit` and `probe-laser-origin`.

## Defaults taken

- The survey decays when the hold is dropped (the old default), and the front
  rock is the target pick (the old default).
- A hull change auto-sells raw ore from a shared hold like any other legal
  cargo; a dedicated ore bay is still never auto-sold.
- `scripts/measure-mining-nav-budget.mjs` keeps its two-page arm structure; its
  `?mining` parameter is now inert, so both pages are the same page. The
  instrument's node (#1234) is closed and its budget was met with mining on.

## Not done here

- The canonical view set and the principal's yes on it. This node carries
  `ranger:needs-eye`; the supervisor's PR gate runs the expanded probe set.
