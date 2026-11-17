import type { Loadout } from "../../src/loadout";

export const withoutStockMiningLaser = (loadout: Loadout): Loadout => {
	const { h2: _mining, ...rest } = loadout;
	return rest;
};
