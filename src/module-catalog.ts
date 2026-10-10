/** Approved #868 catalogue arithmetic, shared by runtime and the instrument.
 * Targets and relative weights are design inputs; solved prices/masses and
 * handling are derived results. Nothing here measures player preference. */
import {
	HULL_IDS,
	HULL_SPECS,
	POWER_PLANT_OUTPUT,
	type HullId,
	type HullSlot,
	type InternalFamily,
	type SlotSize,
} from "./hull";
import { PULSE_LASER } from "./ship-condition";
import { SCAN_RANGE_KM } from "./carrier-scan";
import { RELAY_SIGNAL_RANGE_KM } from "./pirate-relay";

export const GRADES = ["E", "D", "A"] as const;
export type Grade = (typeof GRADES)[number];
export const SIZES: readonly SlotSize[] = [1, 2, 3];
export const POLICY = {
	targetCr: 175_000,
	targetBandCr: [150_000, 200_000],
	// Empty-hold reference E fit loses 15% of the bare hull's acceleration.
	eFitAccelLoss: 0.15,
	priceQuantumCr: 25,
	sizeScale: { 1: 1, 2: 1.5, 3: 2.25 },
	grade: {
		E: { price: 1, mass: 1, output: 1 },
		D: { price: 2, mass: 0.45, output: 0.8 },
		A: { price: 8, mass: 0.8, output: 1.5 },
	},
} as const;

export type ModuleKind =
	| "pulse-laser"
	| "beam-laser"
	| "military-laser"
	| "mining-laser"
	| "missile-rack"
	| "ecm"
	| "identity-scanner"
	| "docking-computer"
	| "escape-pod"
	| "shield-booster"
	| "fuel-scoop"
	| "long-range-scanner"
	| "extra-energy-unit"
	| "cargo-rack"
	| "armour-plating"
	| "fuel-tank"
	| "power-plant";
interface Definition {
	kind: ModuleKind;
	slotKind: HullSlot["kind"] | "core";
	family?: InternalFamily;
	priceWeight: number;
	massWeight: number;
	/** Size 1 E output, with units in keys. Every key is a benefit, except
	 * ejectDelayS, whose reciprocal is the benefit. No hidden generic score. */
	output: Readonly<Record<string, number>>;
	integerOutput?: boolean;
	/** Secondary active-resource costs, not included as benefits in Pareto. */
	drawPerS?: number;
	heatPerS?: number;
}

export const DEFINITIONS: readonly Definition[] = [
	{
		kind: "pulse-laser",
		slotKind: "hardpoint",
		priceWeight: 1,
		massWeight: 1,
		output: { damagePerS: PULSE_LASER.damagePerS },
		drawPerS: PULSE_LASER.energyPerS,
		heatPerS: PULSE_LASER.heatPerS,
	},
	{
		kind: "beam-laser",
		slotKind: "hardpoint",
		priceWeight: 2.5,
		massWeight: 1.3,
		output: { damagePerS: PULSE_LASER.damagePerS * 1.5 },
		drawPerS: PULSE_LASER.energyPerS * 3,
		heatPerS: PULSE_LASER.heatPerS * 3,
	},
	{
		kind: "military-laser",
		slotKind: "hardpoint",
		priceWeight: 6,
		massWeight: 1.6,
		output: { damagePerS: PULSE_LASER.damagePerS * 2 },
		drawPerS: PULSE_LASER.energyPerS * 5,
		heatPerS: PULSE_LASER.heatPerS * 4,
	},
	{
		kind: "mining-laser",
		slotKind: "hardpoint",
		priceWeight: 2,
		massWeight: 1.4,
		output: { extractionTPerS: 0.1 },
		drawPerS: 2,
		heatPerS: 2,
	},
	{
		kind: "missile-rack",
		slotKind: "hardpoint",
		priceWeight: 1.5,
		massWeight: 1,
		output: { missiles: 4 },
		integerOutput: true,
	},
	{
		kind: "ecm",
		slotKind: "utility",
		priceWeight: 1.5,
		massWeight: 0.5,
		output: { radiusKm: 2 },
		drawPerS: 8,
	},
	{
		kind: "identity-scanner",
		slotKind: "utility",
		priceWeight: 1.5,
		massWeight: 0.5,
		output: { rangeKm: SCAN_RANGE_KM },
	},
	// Metrics chosen by the principal on 2026-10-10; values approved in the pricing instrument receipt (#868).
	// A size-3 computer remains within the existing 10,000 km clearance range.
	{
		kind: "docking-computer",
		slotKind: "utility",
		priceWeight: 2,
		massWeight: 0.5,
		output: { engagementRangeKm: 2_000 },
	},
	{
		kind: "escape-pod",
		slotKind: "internal",
		family: "survival",
		priceWeight: 2,
		massWeight: 1,
		output: { ejectDelayS: 1 },
	},
	{
		kind: "shield-booster",
		slotKind: "utility",
		priceWeight: 2,
		massWeight: 1,
		output: { pointsPerPool: 25 },
		drawPerS: 2,
	},
	{
		kind: "fuel-scoop",
		slotKind: "internal",
		family: "fuel",
		priceWeight: 1.5,
		massWeight: 1,
		output: { fuelLyPerS: 0.1 },
		drawPerS: 3,
	},
	{
		kind: "long-range-scanner",
		slotKind: "internal",
		family: "sensor",
		priceWeight: 2,
		massWeight: 0.8,
		output: { signalRangeKm: RELAY_SIGNAL_RANGE_KM },
	},
	{
		kind: "extra-energy-unit",
		slotKind: "internal",
		family: "power",
		priceWeight: 2,
		massWeight: 1.2,
		output: { bankE: POWER_PLANT_OUTPUT.E[1].bankE / 2 },
	},
	{
		kind: "cargo-rack",
		slotKind: "internal",
		family: "cargo",
		priceWeight: 1,
		massWeight: 1.5,
		output: { cargoT: 10 },
		integerOutput: true,
	},
	{
		kind: "armour-plating",
		slotKind: "internal",
		family: "armour",
		priceWeight: 1.5,
		massWeight: 2,
		output: { integrity: 25 },
	},
	{
		kind: "fuel-tank",
		slotKind: "internal",
		family: "fuel",
		priceWeight: 1,
		massWeight: 1,
		output: { fuelLy: 2 },
	},
	{
		kind: "power-plant",
		slotKind: "core",
		priceWeight: 3,
		massWeight: 2,
		output: { ...POWER_PLANT_OUTPUT.E[1] },
	},
];

export interface ModuleRow {
	kind: ModuleKind;
	size: SlotSize;
	grade: Grade;
	slotKind: Definition["slotKind"];
	family?: InternalFamily;
	priceCr: number;
	massT: number;
	output: Record<string, number>;
	drawPerS: number;
	heatPerS: number;
}

/** A price anchor, not a mandated stock fit. Every real slot filled, including
 * the core. Duplicated cargo racks add capacity; no repeated active devices. */
export const REFERENCE_KINDS: Readonly<Record<string, string>> = {
	h1: "military-laser",
	u1: "shield-booster",
	u2: "ecm",
	u3: "docking-computer",
	i1: "cargo-rack",
	i2: "cargo-rack",
	i3: "fuel-tank",
	i4: "escape-pod",
	flex: "extra-energy-unit",
	plant: "power-plant",
};

/** Smaller modules fit larger slots (principal, node #876). Type and internal
 * family still constrain the fit; sizes never resize a module. */
export function fits(row: ModuleRow, slot: HullSlot): boolean {
	return (
		row.size <= slot.size &&
		row.slotKind === slot.kind &&
		(slot.kind !== "internal" ||
			slot.accepts === "any" ||
			(row.family !== undefined && slot.accepts.includes(row.family)))
	);
}

export function referenceFit(rows: readonly ModuleRow[], grade: Grade) {
	const hull = HULL_SPECS.freighter;
	return [...hull.slots, { key: "plant", size: hull.plantSize }].map((slot) => {
		const module = rows.find(
			(r) =>
				r.kind === REFERENCE_KINDS[slot.key] &&
				r.size === slot.size &&
				r.grade === grade,
		);
		if (!module)
			throw new Error(`Reference slot ${slot.key} has no ${grade} row`);
		if (slot.key !== "plant" && !fits(module, slot as HullSlot))
			throw new Error(`Reference slot ${slot.key} refuses ${module.kind}`);
		return { slot: slot.key, module };
	});
}

export function summarizeFit(fit: ReturnType<typeof referenceFit>) {
	return fit.reduce(
		(s, { module: r }) => ({
			priceCr: s.priceCr + r.priceCr,
			massT: s.massT + r.massT,
			cargoT: s.cargoT + (r.output.cargoT ?? 0),
		}),
		{ priceCr: 0, massT: 0, cargoT: 0 },
	);
}

export function deriveProposal(targetCr: number = POLICY.targetCr) {
	if (!Number.isFinite(targetCr) || targetCr <= 0)
		throw new Error("targetCr must be finite and positive");
	const skeleton: ModuleRow[] = DEFINITIONS.flatMap((d) =>
		SIZES.flatMap((size) =>
			GRADES.map((grade) => {
				const s = POLICY.sizeScale[size],
					g = POLICY.grade[grade];
				const baseOutput =
					d.kind === "power-plant"
						? { ...POWER_PLANT_OUTPUT.E[size] }
						: d.output;
				const outputScale = g.output * (d.kind === "power-plant" ? 1 : s);
				return {
					kind: d.kind,
					slotKind: d.slotKind,
					family: d.family,
					size,
					grade,
					priceCr: d.priceWeight * s * g.price,
					massT: d.massWeight * s * g.mass,
					output: Object.fromEntries(
						Object.entries(baseOutput).map(([k, v]) => [
							k,
							d.integerOutput
								? Math.max(1, Math.round(v * outputScale))
								: k === "ejectDelayS"
									? v / outputScale
									: v * outputScale,
						]),
					),
					drawPerS: (d.drawPerS ?? 0) * s * g.output,
					heatPerS: (d.heatPerS ?? 0) * s * g.output,
				};
			}),
		),
	);
	const priceUnitCr =
		targetCr / summarizeFit(referenceFit(skeleton, "A")).priceCr;
	const targetMassT =
		(HULL_SPECS.freighter.massT * POLICY.eFitAccelLoss) /
		(1 - POLICY.eFitAccelLoss);
	const massUnitT =
		targetMassT / summarizeFit(referenceFit(skeleton, "E")).massT;
	const rows = skeleton.map((r) => ({
		...r,
		priceCr: Math.max(
			POLICY.priceQuantumCr,
			Math.round((r.priceCr * priceUnitCr) / POLICY.priceQuantumCr) *
				POLICY.priceQuantumCr,
		),
		massT: r.massT * massUnitT,
	}));
	return { targetCr, priceUnitCr, massUnitT, targetMassT, rows };
}

/** Pareto: no dearer, no heavier, no worse in ANY output, strictly better in
 * at least one. Compare only identical module kinds and sizes. */
export function dominates(a: ModuleRow, b: ModuleRow): boolean {
	if (a.kind !== b.kind || a.size !== b.size) return false;
	const pairs = [
		[-a.priceCr, -b.priceCr],
		[-a.massT, -b.massT],
		...Object.keys(b.output).map((k) =>
			k === "ejectDelayS"
				? [-a.output[k], -b.output[k]]
				: [a.output[k], b.output[k]],
		),
	];
	return pairs.every(([x, y]) => x >= y) && pairs.some(([x, y]) => x > y);
}

/** Independent per-slot cost envelope; repeated devices allowed here. This is
 * an arithmetic bound, not a claim that stacking or every fit is playable. */
export function costEnvelope(
	rows: readonly ModuleRow[],
	hull: HullId,
	grade: Grade,
) {
	const spec = HULL_SPECS[hull];
	const choices = spec.slots.map((slot) =>
		rows.filter((r) => r.grade === grade && fits(r, slot)),
	);
	choices.push(
		rows.filter(
			(r) =>
				r.kind === "power-plant" &&
				r.grade === grade &&
				r.size === spec.plantSize,
		),
	);
	if (choices.some((rs) => rs.length === 0))
		throw new Error(`Unfilled ${hull} slot`);
	return {
		minCr: choices.reduce(
			(n, rs) => n + Math.min(...rs.map((r) => r.priceCr)),
			0,
		),
		maxCr: choices.reduce(
			(n, rs) => n + Math.max(...rs.map((r) => r.priceCr)),
			0,
		),
	};
}

export function validateProposal(rows: readonly ModuleRow[]) {
	for (const r of rows) {
		if (![r.drawPerS, r.heatPerS].every((x) => Number.isFinite(x) && x >= 0))
			throw new Error(`Invalid resource cost ${r.kind}`);
		if (
			![r.priceCr, r.massT, ...Object.values(r.output)].every(
				(x) => Number.isFinite(x) && x > 0,
			)
		)
			throw new Error(`Invalid ${r.kind}`);
		if (rows.some((other) => dominates(other, r)))
			throw new Error(`Dominated ${r.kind}/${r.size}/${r.grade}`);
	}
	for (const hull of HULL_IDS) costEnvelope(rows, hull, "A");
}
