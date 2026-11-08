# Longwall dedicated ore skips

Refs #1210. Capacity is principal-approved; the economic table remains unratified on #923.

## Problem and ideal state

The measured Longwall skips have roughly 3,142 m³ of backing-mesh volume, while the mining preview shared a 40 t general hold. The principal approved 3,000 t of dedicated raw-ore storage and faster gathering. The general hold remains 40 t; ordinary goods, entrusted lots, fittings and refined products do not gain skip capacity.

## Decisions

- D1: `HullSpec.oreHoldT` owns dedicated capacity. `miningHold` supplies both scoop and drill admission; `withOre` supplies the independent Hold-page readout. Other hulls continue sharing their general hold with ore.
- D2: Session ore adds its actual tonnes to flown mass. Hull dry mass, thrust, ordinary hold, module catalogue and hull pricing are unchanged. A commerce result which would strand ore is refused before adopting either owner state.
- D3: Built-in drilling rises from 0.5 to a provisional 37.5 t/s. This scales the nominal 80 powered seconds for 40 t to 3,000 t; it is not an elapsed fill-time promise. Energy, heat, positioning, surveys and reserve availability still matter. Mining-laser catalogue rates do not change.
- D4: The offline instrument separates raw-ore capacity from general trading/product capacity. Positioning uses actual carried raw ore. Its new explicit `mining-economy-longwall-skips-v2.json` candidate retains unratified status. The historical v1 input and node-922 receipt remain historical evidence tied to their instrument revisions.
- D5: This remains the `?mining=1` preview. Ore persistence, sale/refinery integration and unloading are outside this change. No public changelog entry announces an unreleased mining mechanic; the mining release remains separate work.

## Criteria and verification

C1: Exactly 3,000 t of raw ore fits independently of general cargo. Unit boundaries exercise 2,999 t, full skips and reserve exhaustion; the mining-drill browser contract exercises real Game extraction and the Hold-page readout.

C2: Ore contributes flown mass and cannot silently overfill a replacement hull. The browser contract measures the 3,000 t mass increment; existing general-hold tests retain their stock/fitted capacity assertions. `transactAtStation` checks the resulting capacity before returning its immutable result; shipyard offers include the same ore fact.

C3: Faster extraction retains exact deposit/cargo accounting. Affected headless tests: 130 passed across seven files. TypeScript, formatting, script lint, comment lint and build passed before independent review. Final browser/CI/review evidence is recorded on the PR before merge.

C4: No final balance approval is implied. The comparison labels itself `candidate-comparison` with `approvedBalance: false`.

## Measurement and limits

The explicit v2 comparison ran with clean source revision `f99e3a1fe7d333137b5928f86ec1915628c7b683`; output is `/tmp/seelite1210-comparison.json`. The corpus retains three seeds, two galaxies and four refinery systems per world, with twelve fits and a one-hour horizon.

For the 24 charted miner/3/A raw scenarios, no cargo was unloaded before the horizon: 570–2,964 t remained aboard, so realised cash return was zero. The policy waits for full skips or an exhausted field. This is a limitation of that candidate's return policy, not proof that carried ore has zero value. Final balancing must compare earlier partial-load returns as well as reserve, service throughput and pricing; increasing storage and drill rate alone does not establish the target return. No unsold cargo is counted as cash.

The runtime still stores preview ore in `Game.minedOre`, with no save/market/refinery custody integration. The capacity change does not claim to finish the mining release.
