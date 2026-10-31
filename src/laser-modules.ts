/** Catalogue-backed laser rates. The armed group spends one bank and heat gauge. */
import type { Vec3 } from "./vec3";
import type { FireGroup } from "./fire-group";
import { HULL_SPECS, type HullId } from "./hull";
import { moduleRow, type Loadout } from "./loadout";
import type { LaserRates } from "./ship-condition";

export function hardpointKeys(hull: HullId): string[] {
	return HULL_SPECS[hull].slots
		.filter((slot) => slot.kind === "hardpoint")
		.map((slot) => slot.key);
}

/** Preserve the physical port: H2 alone must still fire from port 2. */
export function groupMuzzleIndices(
	hull: HullId,
	group: FireGroup | undefined,
): number[] {
	if (group?.kind !== "lasers") return [];
	return hardpointKeys(hull).flatMap((key, index) =>
		group.slots.includes(key) ? [index] : [],
	);
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

/** The Mining Laser beams of a fired group: one per fitted mining laser, from its own slot's muzzle, along the nose (D-D11). */
export function miningBeamRays<T>(
	lasers: readonly (T & { muzzleIndex: number })[],
	muzzlesWorld: readonly Vec3[],
	nose: Vec3,
): (T & { origin: Vec3; aim: Vec3 })[] {
	return lasers.flatMap((laser) => {
		const origin = muzzlesWorld[laser.muzzleIndex];
		return origin ? [{ ...laser, origin, aim: nose }] : [];
	});
}

/** The fired hardpoints that draw a tracer from the glass: with the mounts (`?mining=1`) a Mining Laser draws its beam from its mount instead (round 9, F1). */
export function glassTracerIndices(
	hull: HullId,
	loadout: Loadout,
	fired: readonly number[],
	mounts: boolean,
): number[] {
	if (!mounts) return [...fired];
	const keys = hardpointKeys(hull);
	return fired.filter((i) => loadout[keys[i] ?? ""]?.module !== "mining-laser");
}
