import type { ModuleKind, ModuleRow } from "./module-catalog";
import { DOMAIN } from "./domains";
import { mix, seededRand } from "./rng";

interface Change {
	metric: string;
	scale: number;
}
interface Trait {
	id: string;
	benefit: Change;
	cost: Change;
}
const light: Trait = {
	id: "lightweight",
	benefit: { metric: "massT", scale: 0.8 },
	cost: { metric: "priceCr", scale: 0.7 },
};
const output = (id: string, metric: string): Trait => ({
	id,
	benefit: { metric, scale: 1.2 },
	cost: { metric: "massT", scale: 1.3 },
});
const laser: readonly Trait[] = [
	{
		id: "overcharged",
		benefit: { metric: "damagePerS", scale: 1.2 },
		cost: { metric: "heatPerS", scale: 1.3 },
	},
	light,
];
export const VARIANT_TABLE: Readonly<Record<ModuleKind, readonly Trait[]>> = {
	"pulse-laser": laser,
	"beam-laser": laser,
	"military-laser": laser,
	"mining-laser": [output("productive", "extractionTPerS"), light],
	"missile-rack": [
		{
			...output("precise", "missiles"),
			benefit: { metric: "missiles", scale: 1.25 },
		},
		light,
	],
	ecm: [output("wideband", "radiusKm"), light],
	"identity-scanner": [output("long-focus", "rangeKm"), light],
	"docking-computer": [light],
	"escape-pod": [light],
	"shield-booster": [output("reinforced", "pointsPerPool"), light],
	"fuel-scoop": [output("high-flow", "fuelLyPerS"), light],
	"long-range-scanner": [output("long-focus", "signalRangeKm"), light],
	"extra-energy-unit": [output("deep-bank", "bankE"), light],
	"cargo-rack": [output("expanded", "cargoT"), light],
	"cargo-scoop": [output("wide-mouth", "scoopRadiusKm"), light],
	"armour-plating": [output("reinforced", "integrity"), light],
	"fuel-tank": [output("expanded", "fuelLy"), light],
	"power-plant": [output("high-output", "regenPerS"), light],
};

export function variantRow(
	row: ModuleRow,
	variant: string | undefined,
): ModuleRow {
	if (variant === undefined) return row;
	const trait = VARIANT_TABLE[row.kind].find((t) => t.id === variant);
	if (!trait) throw Error(`Unknown ${row.kind} variant ${variant}`);
	const result = { ...row, output: { ...row.output } };
	for (const { metric, scale } of [trait.benefit, trait.cost]) {
		if (metric in result.output) {
			const value = result.output[metric] * scale;
			result.output[metric] = ["missiles", "cargoT"].includes(metric)
				? Math.max(1, Math.round(value))
				: value;
		} else {
			const key = metric as "massT" | "priceCr" | "drawPerS" | "heatPerS";
			result[key] *= scale;
		}
	}
	return result;
}

/** The seed is the item's identity, not a shared generator's draw position.
 * Calling again on a variant preserves it, including after a death. */
export function rollVariant<T extends { module: ModuleKind; variant?: string }>(
	module: T,
	seed: number,
	chance = 1 / 3,
): T {
	if (module.variant !== undefined) return module;
	const rand = seededRand(mix(seed, DOMAIN.MODULE_VARIANT));
	if (rand() >= chance) return module;
	const table = VARIANT_TABLE[module.module];
	return { ...module, variant: table[Math.floor(rand() * table.length)].id };
}
