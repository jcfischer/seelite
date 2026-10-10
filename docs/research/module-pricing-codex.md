# Module pricing proposal

Node: [Derive module prices, mass and output](https://github.com/jcfischer/seelite/issues/868).
Author: Codex. Status: proposal awaiting principal approval.

Run `bun scripts/measure-module-pricing.ts` for the complete Markdown table, or
append `--json` for unrounded values and the full module-by-hull mass sweep.
`scripts/lib/module-pricing.ts` is the sole home of the proposed tuning. This
document carries the rationale, not another copy of its numbers. Nothing in
`src/` imports the proposal. The live equipment prices, mass and behaviours do
not change in this PR.

## What is derived

The instrument fills the freighter's actual slots with a declared trading and
defence fit, including the core power plant. It solves one price unit from the
A-grade budget, then applies the same unit to every kind, size and grade. It
also solves a mass unit from a chosen empty-hold E-fit acceleration penalty.
The resulting masses go through the shipped `flightPerformance` function.

The budget, handling penalty, kind weights and grade multipliers are **design
inputs**. They are not discovered by a market simulation. The instrument
derives their consequences, checks that no grade dominates another, and exposes
the sensitivity to the target budget. It does not establish that the chosen
weights or output rates feel good in play.

The reference is a full fit, not the most expensive collection of modules. The
per-hull minimum/maximum price bounds choose each slot independently. They
permit duplicate active devices, so they are arithmetic envelopes, not a ruling
on stacking or a promise that every combination is playable. The compatibility
check uses exact sizes; the smaller-in-larger question remains open.

## Output choices for review

Each output has a concrete unit. Existing pulse-laser, E-plant and scanner
baselines are imported from their owners. New module outputs and the differences
between grades are candidate values. The instrument reports active energy draw
and weapon heat beside benefits; the Pareto check covers price, mass and all
output benefits, not a claim about combat effectiveness.

The principal requested graded performance for the formerly binary modules and
chose docking-computer engagement range and escape-pod eject delay on 2026-10-10.
Their numeric values remain proposed. Both keep the existing clearance
requirement and survival/loss outcome rules. A delay would still expose the
ship to damage for longer; that consequence requires explicit approval.
The computer's proposed ranges are narrower than today's engagement ceiling,
including A grade. These are behavioural changes for the future module nodes,
not descriptions of the current devices.

Cargo capacity and missile count round to whole units. Armour adds integrity;
the shield booster adds points to each pool while active. Fuel output is
capacity/range, not a newly introduced mass-to-range law. The extra energy unit
adds bank capacity; regeneration remains the core plant's job. A scanner's
longer signal range does not grant discovery or replace flown identification.

## What the price target does not establish

The target is gross module purchase cost, excluding the hull, resale, fuel,
ammunition and trading capital. Trade ladder thresholds measure realised
margin, not available money. Showing the cost beside those thresholds does not
prove when a pilot can afford the fit. Extra cargo racks may accelerate earnings;
that feedback is not simulated here. The A-grade full-hold handling figure
includes its larger cargo capacity, so it cannot isolate the mass difference
between grades; empty-hold figures do isolate that difference.

Weapon rows describe burst damage. Heat lock, energy competition, multiple
hardpoints, encounter strength and kill credit need the laser child's actual
combat loop. Mining, scooping, missile ammunition and variants likewise require
their gameplay nodes. No proposal row claims those behaviours are already wired.

## Verification

`tests/module-pricing.test.ts` checks catalogue coverage, every grade's benefit
ordering and Pareto status, deliberately dominated rows, stock E-plant fidelity,
the real reference slots, budget sensitivity, mass calibration, and the shipped
handling result for every module on every hull. Unfittable combinations are
marked as counterfactual mass measurements in the report.

Approval is of the input policy and its generated table together. A change to
an input re-derives the whole proposal; it must not be made by hand-editing a
generated row. Runtime catalogue and migration work consume an approved result
later. This node remains open until that approval and its delivery gate.
