/** bun scripts/measure-module-pricing.ts [--json]
 * Fresh deterministic derivation for #868. Rendered Markdown is an output,
 * never a second constants table. --json includes the full hull mass sweep. */
import { HULL_IDS, HULL_SPECS } from "../src/hull";
import { threshold } from "../src/ladder";
import {
	DEFINITIONS,
	GRADES,
	POLICY,
	SIZES,
	costEnvelope,
	deriveProposal,
	dominates,
	fits,
	massImpact,
	referenceFit,
	summarizeFit,
	validateProposal,
} from "./lib/module-pricing";

const proposal = deriveProposal();
validateProposal(proposal.rows);
const fitsByGrade = GRADES.map((grade) => {
	const slots = referenceFit(proposal.rows, grade),
		total = summarizeFit(slots);
	return {
		grade,
		slots,
		...total,
		empty: massImpact("freighter", total.massT),
		laden: massImpact(
			"freighter",
			total.massT,
			HULL_SPECS.freighter.holdT + total.cargoT,
		),
	};
});
const sweep = proposal.rows.flatMap((r) =>
	HULL_IDS.map((hull) => ({
		kind: r.kind,
		size: r.size,
		grade: r.grade,
		hull,
		fits:
			r.slotKind === "core"
				? HULL_SPECS[hull].plantSize === r.size
				: HULL_SPECS[hull].slots.some((s) => fits(r, s)),
		...massImpact(hull, r.massT),
	})),
);
if (process.argv.includes("--json")) {
	console.log(
		JSON.stringify(
			{
				policy: POLICY,
				definitions: DEFINITIONS,
				...proposal,
				fitsByGrade,
				sweep,
			},
			null,
			2,
		),
	);
} else {
	const n = (x: number, digits = 2) =>
		x.toLocaleString("en-GB", { maximumFractionDigits: digits });
	console.log("# Module pricing proposal — fresh derivation\n");
	console.log(
		"Status: proposed, not installed. Prices, masses and new output metrics require principal approval. Units are in every output key. Flat prices; no station or ladder enters pricing.\n",
	);
	console.log("## Inputs and solution\n");
	console.log(
		`A reference freighter budget: ${n(proposal.targetCr)} Cr; accepted target band ${POLICY.targetBandCr.map((v) => n(v)).join("–")} Cr. Price rounding: ${POLICY.priceQuantumCr} Cr.`,
	);
	console.log(
		`E reference fit mass chosen to cost ${n(POLICY.eFitAccelLoss * 100)}% bare-hull acceleration with an empty hold. Solved fit mass ${n(proposal.targetMassT)} t; one mass-weight unit ${n(proposal.massUnitT, 6)} t; one E price-weight unit ${n(proposal.priceUnitCr, 6)} Cr.\n`,
	);
	console.log(
		"These are constrained design choices, not an empirical economic optimum. Relative kind weights are explicit below. Grade multipliers are price / mass / output:",
	);
	for (const g of GRADES)
		console.log(`- ${g}: ${Object.values(POLICY.grade[g]).join(" / ")}`);
	console.log(
		`\nSize multipliers: ${SIZES.map((s) => `${s}: ${POLICY.sizeScale[s]}`).join(", ")}. Mass and price use these; plant outputs read the shipped E table. Integer capacities round to nearest whole unit. Eject delay divides by the output multiplier (lower is better).\n`,
	);
	console.log(
		"## Relative kind weights\n\n| Kind | Price | Mass |\n|---|---:|---:|",
	);
	for (const d of DEFINITIONS)
		console.log(`| ${d.kind} | ${d.priceWeight} | ${d.massWeight} |`);
	console.log(
		"\n## Every proposed row\n\n| Kind | Size | Grade | Cr | t | Output | Energy/s active | Heat/s |\n|---|---:|---|---:|---:|---|---:|---:|",
	);
	for (const r of proposal.rows)
		console.log(
			`| ${r.kind} | ${r.size} | ${r.grade} | ${n(r.priceCr)} | ${n(r.massT, 3)} | ${Object.entries(
				r.output,
			)
				.map(([k, v]) => `${k}=${n(v, 3)}`)
				.join("; ")} | ${n(r.drawPerS)} | ${n(r.heatPerS)} |`,
		);
	console.log("\n## Grade Pareto checks (price, mass, every output)\n");
	for (const d of DEFINITIONS) {
		const peers = proposal.rows.filter((r) => r.kind === d.kind);
		console.log(
			`- ${d.kind}: ${SIZES.map((size) => `${size}: ${peers.filter((r) => r.size === size).every((r) => !peers.some((other) => dominates(other, r))) ? "PASS" : "FAIL"}`).join("; ")}`,
		);
	}
	console.log(
		"\n## Reference freighter, all slots and the core\n\n| Slot | Module | Size | A Cr | A t |\n|---|---|---:|---:|---:|",
	);
	for (const { slot, module: r } of referenceFit(proposal.rows, "A"))
		console.log(
			`| ${slot} | ${r.kind} | ${r.size} | ${n(r.priceCr)} | ${n(r.massT, 3)} |`,
		);
	console.log(
		"\n| Grade | Gross module Cr | Fitted t | Extra hold t | Empty-hold accel km/s² | Full expanded hold accel km/s² |\n|---|---:|---:|---:|---:|---:|",
	);
	for (const f of fitsByGrade)
		console.log(
			`| ${f.grade} | ${n(f.priceCr)} | ${n(f.massT)} | ${n(f.cargoT)} | ${n(f.empty.fitted, 4)} | ${n(f.laden.fitted, 4)} |`,
		);
	console.log(
		`\nBare freighter: ${n(massImpact("freighter", 0).bare, 4)} km/s². Full hold includes hull hold plus fitted racks. Hull purchase, fuel, ammunition, resale and working capital are excluded from gross module cost. Trade rung 6: ${n(threshold("trade", 6))} Cr realised margin; rung 7: ${n(threshold("trade", 7))} Cr. Margin is not a wallet balance or a prediction of time to afford this fit.\n`,
	);
	console.log(
		"## Freighter A price sensitivity\n\n| Budget input Cr | Rounded fit Cr |\n|---:|---:|",
	);
	for (const target of [
		POLICY.targetBandCr[0],
		POLICY.targetCr,
		POLICY.targetBandCr[1],
	])
		console.log(
			`| ${n(target)} | ${n(summarizeFit(referenceFit(deriveProposal(target).rows, "A")).priceCr)} |`,
		);
	console.log(
		"\n## Full-fit price envelope, A grade\n\nEach slot chooses independently from same-size, family-compatible modules. This permits repeated active devices: bounds only, not a stacking policy or proven playable loadout. The reference budget cannot constrain every possible fit.\n\n| Hull | Minimum Cr | Maximum Cr |\n|---|---:|---:|",
	);
	for (const h of HULL_IDS) {
		const e = costEnvelope(proposal.rows, h, "A");
		console.log(`| ${h} | ${n(e.minCr)} | ${n(e.maxCr)} |`);
	}
	console.log(
		"\n## Each module's marginal acceleration cost on each hull\n\nBare hull plus one module, empty cargo, undamaged vents. Entries: fitted km/s² (loss %). An asterisk means a compatible slot exists; unstarred cells are counterfactual mass measurements, not fit permissions. This calls shipped flightPerformance.\n",
	);
	console.log(
		`| Module | ${HULL_IDS.join(" | ")} |\n|---|${HULL_IDS.map(() => "---:").join("|")}|`,
	);
	for (const r of proposal.rows)
		console.log(
			`| ${r.kind}/${r.size}/${r.grade} | ${sweep
				.filter(
					(s) => s.kind === r.kind && s.size === r.size && s.grade === r.grade,
				)
				.map((s) => `${n(s.fitted, 4)} (${n(s.lossPct)}%)${s.fits ? "*" : ""}`)
				.join(" | ")} |`,
		);
	console.log(
		"\n## Scope of the proposal\n\nOutput metrics describe proposed future behaviours. No runtime module uses this table yet. Weapon output is burst damage, not sustained DPS; energy and heat draw are exposed, but encounter balance and simultaneous hardpoints belong to the laser child. Missile capacity excludes ammunition; scoop/mining rates require their future extraction conditions. Armour and shield bonuses are additive. Fuel-tank output is added range/capacity, not a new mass-to-range law. Scanner range does not grant discovery: flown identification still does. Docking clearance remains required. Escape survival/loss rules remain unchanged. Variants, fit migration, resale, smaller-in-larger slots, active-device stacking and runtime wiring stay with their build nodes.",
	);
}
