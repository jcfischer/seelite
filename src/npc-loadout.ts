import type { CarrierKey } from "./carrier-key";
import { carrierInstanceSeed } from "./carrier-standing";
import { DOMAIN } from "./domains";
import { HULL_SPECS, type HullId } from "./hull";
import {
	makeModule,
	moduleFits,
	moduleRow,
	stockLoadout,
	type FittedModule,
	type Loadout,
} from "./loadout";
import { GRADES, type ModuleKind } from "./module-catalog";
import { rollVariant } from "./module-variants";
import { fnv1a, mix, seededRand } from "./rng";

export const armedNpc = (hull: HullId): boolean =>
	["raider", "patrol", "interceptor"].includes(hull);
export const npcFitSeed = (
	systemSeed: number,
	key: CarrierKey,
	instance: number,
): number => carrierInstanceSeed(systemSeed, key, instance, DOMAIN.NPC_LOADOUT);

export function npcLoadout(hull: HullId, seed: number): Loadout {
	if (!armedNpc(hull)) return stockLoadout(hull);
	const spec = HULL_SPECS[hull];
	const fit: Record<string, FittedModule> = {};
	const pickModule = (
		key: string,
		size: 1 | 2 | 3,
		kinds: readonly ModuleKind[],
	) => {
		const itemSeed = mix(seed, fnv1a(key));
		const rand = seededRand(mix(itemSeed, DOMAIN.NPC_LOADOUT));
		const module = makeModule(
			kinds[Math.floor(rand() * kinds.length)],
			size,
			GRADES[Math.floor(rand() * GRADES.length)],
		);
		const rolled = rollVariant(module, itemSeed);
		if (rolled.module === "missile-rack")
			rolled.ammo = moduleRow(rolled).output.missiles;
		return rolled;
	};
	fit.plant = pickModule("plant", spec.plantSize, ["power-plant"]);
	for (const slot of spec.slots) {
		if (slot.kind === "hardpoint" && slot.mount) continue;
		if (slot.kind === "hardpoint") {
			if (
				hull === "raider" &&
				slot.key !== "h1" &&
				mix(seed, DOMAIN.RAIDER_MISSILE_FIT) / 0x1_0000_0000 < 0.35
			)
				fit[slot.key] = pickModule(slot.key, slot.size, ["missile-rack"]);
			else
				fit[slot.key] = pickModule(slot.key, slot.size, [
					"pulse-laser",
					"beam-laser",
					"military-laser",
				]);
		} else if (slot.kind === "utility" && slot.key === "u1") {
			fit[slot.key] = pickModule(slot.key, slot.size, ["shield-booster"]);
		} else if (slot.kind === "internal") {
			const kinds: ModuleKind[] = [
				"armour-plating",
				"extra-energy-unit",
				"cargo-rack",
				"fuel-tank",
			];
			const allowed = kinds.filter((kind) =>
				moduleFits(makeModule(kind, slot.size), slot),
			);
			if (allowed.length)
				fit[slot.key] = pickModule(slot.key, slot.size, allowed);
		}
	}
	return fit;
}

export const NPC_FITTING_DROP_CHANCE = 0.15;
/** At most one fitting, always from the actual fit. Selection does not reroll
 * its grade, trait or remaining ammunition. */
export function npcFittingDrop(
	loadout: Loadout,
	seed: number,
): FittedModule | undefined {
	const rand = seededRand(mix(seed, DOMAIN.NPC_FITTING_DROP));
	if (rand() >= NPC_FITTING_DROP_CHANCE) return undefined;
	const modules = Object.entries(loadout)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, m]) => m);
	return modules.length
		? { ...modules[Math.floor(rand() * modules.length)] }
		: undefined;
}
