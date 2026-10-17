/** Catalogue-backed laser rates. The armed group spends one bank and heat gauge. */
import type { FireGroup } from "./fire-group";
import { HULL_SPECS, type HullId } from "./hull";
import { moduleRow, type Loadout } from "./loadout";
import type { LaserRates } from "./ship-condition";

/** Preserve the physical port: H2 alone must still fire from port 2. */
export function groupMuzzleIndices(
	hull: HullId,
	group: FireGroup | undefined,
): number[] {
	if (group?.kind !== "lasers") return [];
	return HULL_SPECS[hull].slots
		.filter((s) => s.kind === "hardpoint")
		.flatMap((slot, index) => (group.slots.includes(slot.key) ? [index] : []));
}

export function groupLaserRates(
	loadout: Loadout,
	group: FireGroup | undefined,
): LaserRates {
	const rates = { damagePerS: 0, energyPerS: 0, heatPerS: 0 };
	if (group?.kind !== "lasers") return rates;
	for (const slot of group.slots) {
		const module = loadout[slot];
		if (!module) continue;
		const row = moduleRow(module);
		rates.damagePerS += row.output.damagePerS ?? 0;
		rates.energyPerS += row.drawPerS;
		rates.heatPerS += row.heatPerS;
	}
	return rates;
}
