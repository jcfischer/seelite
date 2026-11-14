import type { HullId } from "../../src/hull";
import {
	type SevenShipRole,
	createSevenShipBuilder,
} from "../../src/seven-ships-hulls";
import type { AuthoredHullBuilder } from "../../src/ship-mesh";
import { installAuthoredHull } from "../../src/ship-mesh";
import { decodeShippedGlb } from "./shipped-glb";

/** The five of design PR #829 (node #1035), with the file each ships. */
export const SEVEN_SHIP_FILES = {
	patrol: "src/models/warden-patrol.glb",
	raider: "src/models/shiv-raider.glb",
	carrier: "src/models/bastion-carrier.glb",
	prospector: "src/models/sluice-prospector.glb",
	dreadnought: "src/models/rampart-dreadnought.glb",
} as const satisfies Partial<Record<HullId, string>>;

export type SevenShipHull = keyof typeof SEVEN_SHIP_FILES;

const builders = new Map<SevenShipHull, AuthoredHullBuilder>();

/**
 * Install one shipped exterior the way the game does — from `src/models/`
 * through the browser's loader — so a headless row measures the hull a pilot is
 * drawn. Memoised per hull, as `installShippedTugHull` is, because each build
 * simplifies two extra levels.
 */
export async function installShippedSevenShip(
	hull: SevenShipHull,
): Promise<void> {
	let builder = builders.get(hull);
	if (!builder) {
		builder = await createSevenShipBuilder(
			hull as SevenShipRole,
			await decodeShippedGlb(SEVEN_SHIP_FILES[hull]),
		);
		builders.set(hull, builder);
	}
	installAuthoredHull(hull, builder);
}

/** Install all five. A script measuring placements across the roster awaits it. */
export async function installShippedSevenShips(): Promise<void> {
	for (const hull of Object.keys(SEVEN_SHIP_FILES) as SevenShipHull[])
		await installShippedSevenShip(hull);
}
