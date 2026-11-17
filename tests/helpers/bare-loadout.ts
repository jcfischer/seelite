import { HULL_SPECS } from "../../src/hull";
import type { Loadout } from "../../src/loadout";

export const withoutStockMiningLaser = (loadout: Loadout): Loadout => {
	const mount = HULL_SPECS.miner.slots.find(
		(s) => s.kind === "hardpoint" && s.mount,
	)!;
	const { [mount.key]: _mining, ...rest } = loadout;
	return rest;
};
