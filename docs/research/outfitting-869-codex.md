# Outfitting tab: progression decisions

Q1 and Q2 approved by the principal, 2026-10-11: “Q1: Approved; Q2: yes, track cost.”
Node: https://github.com/jcfischer/seelite/issues/869.

## Q1: Module gates

Keep existing type gates. For types without a gate, assign the ladder below
at rung zero unless specified otherwise. A grade adds one rung on that ladder;
E and D use the base rung. Stock availability is independent of permission to
buy, so the universal floor remains listed even when a purchase is locked.

| Module | Ladder | E/D rung | Status |
| --- | --- | ---: | --- |
| Pulse laser | Combat | 1 | Existing |
| Beam laser | Combat | 3 | Existing |
| Military laser | Combat | 6 | Existing |
| Mining laser | Trade | 2 | Existing |
| Missile rack | Combat | 1 | Existing |
| ECM | Combat | 2 | Existing |
| Extra energy unit | Combat | 4 | Existing |
| Cargo rack | Trade | 1 | Existing |
| Fuel scoop | Exploration | 1 | Existing |
| Power plant | Combat | 0 | Proposed |
| Shield booster | Combat | 2 | Proposed |
| Armour plating | Combat | 1 | Proposed |
| Fuel tank | Exploration | 0 | Proposed |
| Docking computer | Exploration | 0 | Proposed ladder; base remains open |
| Identity scanner | Exploration | 0 | Proposed ladder; base remains open |
| Long-range scanner | Exploration | 0 | Proposed ladder; base remains open |
| Escape pod | Exploration | 0 | Proposed ladder; base remains open |

## Q2: Resale and trade progression

`ladderAfterMarket` banks the entire credit delta for `sell-recovered`.
Once a pilot can remove bought modules, buy/remove/sell produces trade credit
at a ten-percent cash loss. The current fitted-module and recovered-fitting
records have no purchase-cost provenance.

Approved: carry purchase cost with bought modules through fitting,
removal, hull transfer, saves and wreck recovery; bank only positive resale
profit for them. Salvage continues to earn its proceeds. Save version 14 carries
the optional `purchaseCostCr`; zero means known salvage. An absent cost on a
typed module means unknown provenance and conservatively uses list value.
Untyped legacy salvage keeps its zero basis. Credits and resale values do not
change during migration. Old fitted equipment is never classified as free salvage.

The cash-for-trade-credit conversion was rejected.

## Implementation evidence and scope

- Atomic removal is implemented: a carried fitting occupies 1 t and retains
  grade, variant and ammunition; hold overflow refuses the entire action.
- The mandatory core plant cannot be removed without replacement.
- Module availability is seeded per station and market epoch with a separate
  domain tag; current station exclusives remain intact. The floor is present
  at all market-bearing stations. Outposts currently have no station market.
- Resale at 90% and hull-transfer overflow already exist on the base branch.
- Live jump range is still hull-owned; kill-credit DPS is still constant.
  The UI must show those live values until their behaviour nodes change them.
- The console uses named slots, a preview before committing, and separate
  fuel and rack-rearming services. Verification evidence lives in the PR.

## Verification, 2026-10-11

- Full headless suite: 5,848 passed, zero failed. Typecheck, formatting,
  script lint and production build passed.
- The browser selector chose all 101 probes because this change updates the
  shared canonical capture harness. The full hardware run passed 98/101.
  Commander passed 29/29 on its isolated rerun. Outfitting passed 12/12 after
  keeping native button activation from bubbling into flight commands.
- The remaining red is the station-interior cold-install tail budget. It
  failed 38/39 on the isolated branch rerun and also 38/39 on base commit
  `8b7a5871fde3f73e958fe6ee22c3faa8fbc3b24e`, in the bay view on both.
  This is baseline reproduction, not a green gate or an approved waiver.
- Canonical hardware capture completed all 73 views before and after. The
  base worktree carries only the new capture definitions and harness so both
  revisions expose the same view inventory; its game source is unchanged.
  The local comparison sheet is `/tmp/seelite-869-views/index.html`.
- Principal approved the public changelog sentence and, after reviewing the
  dev server, approved the visual on 2026-10-11. Sage remains pending.
  Sage must wait for the other worktree's browser suite to
  release the machine; the map's delivery SOP forbids overlapping them.

PR: https://github.com/jcfischer/seelite/pull/886. Detailed local logs are
`/tmp/seelite-869-headless-final.log`, `/tmp/seelite-869-browser.log`,
`/tmp/seelite-869-outfitting-rerun.log`, `/tmp/seelite-869-commander-rerun.log`,
`/tmp/seelite-869-interior-rerun.log` and
`/tmp/seelite-869-interior-baseline.log`.
