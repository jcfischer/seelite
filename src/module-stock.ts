/** Station availability, not inventory: buying never consumes a stock row. */
import { DOMAIN } from "./domains";
import { LEGACY_MODULES, moduleRows } from "./loadout";
import { EQUIPMENT, marketEpoch, type MarketStation } from "./market";
import { fnv1a, mix, seededRand } from "./rng";
import type { ModuleRow } from "./module-catalog";
import type { FittedModule } from "./loadout";
import {
	gateOf,
	RUNG_NAMES,
	type Gate,
	type GateRefusal,
	type Rungs,
} from "./ladder";

/** Principal-approved gate assignments, node #869. Legacy type gates remain
 * owned by the ladder catalogue; these fill only its previously ungated kinds. */
const NEW_GATES: Record<string, Gate> = {
	"power-plant": { ladder: "combat", rung: 0 },
	"shield-booster": { ladder: "combat", rung: 2 },
	"armour-plating": { ladder: "combat", rung: 1 },
	"fuel-tank": { ladder: "exploration", rung: 0 },
	"docking-computer": { ladder: "exploration", rung: 0 },
	"identity-scanner": { ladder: "exploration", rung: 0 },
	"long-range-scanner": { ladder: "exploration", rung: 0 },
	"escape-pod": { ladder: "exploration", rung: 0 },
};
export function moduleGate(m: FittedModule): Gate {
	const legacy = Object.keys(LEGACY_MODULES).find(
		(k) => LEGACY_MODULES[k] === m.module,
	);
	const base = (legacy ? gateOf(legacy) : null) ?? NEW_GATES[m.module];
	if (!base) throw Error(`No module gate for ${m.module}`);
	return { ...base, rung: base.rung + (m.grade === "A" ? 1 : 0) };
}
export function moduleLocked(
	m: FittedModule,
	rungs: Rungs,
): GateRefusal | null {
	const g = moduleGate(m);
	return rungs[g.ladder] < g.rung
		? { ...g, name: RUNG_NAMES[g.ladder][g.rung] }
		: null;
}

export interface ModuleStockInput {
	station: MarketStation;
	displayTL: number;
	economy: number;
	gameTimeMin: number;
}

export const moduleKey = (row: ModuleRow): string =>
	`${row.kind}/${row.size}/${row.grade}`;

export function moduleStock(input: ModuleStockInput): readonly ModuleRow[] {
	const { station, displayTL, economy, gameTimeMin } = input;
	const epoch = marketEpoch(station.phaseMin, gameTimeMin);
	const seed = mix(mix(station.seed, DOMAIN.MODULE_STOCK), epoch);
	return moduleRows().filter((row) => {
		if (
			row.size === 1 &&
			row.grade === "E" &&
			["pulse-laser", "cargo-rack", "fuel-tank", "power-plant"].includes(
				row.kind,
			)
		)
			return true;
		const legacy = EQUIPMENT.find((e) => LEGACY_MODULES[e.name] === row.kind);
		if (legacy && legacy.scope !== "universal" && legacy.scope !== station.type)
			return false;
		// Technology raises the odds, while size and grade lower them. Type and
		// economy tilt odds, rather than clamping away their effect at either end.
		const logOdds =
			(displayTL - 7) / 5 -
			(row.size - 1) * 0.55 -
			(row.grade === "A" ? 1.1 : row.grade === "D" ? 0.3 : 0) +
			(station.type === "shipyard" ? 0.5 : 0) +
			(3.5 - economy) * 0.1;
		const chance = 1 / (1 + Math.exp(-logOdds));
		// Key each row separately: adding a catalogue row moves no existing draw.
		return seededRand(mix(seed, fnv1a(moduleKey(row))))() < chance;
	});
}
