import { afterAll } from "bun:test";
import {
	SEVEN_SHIP_FILES,
	type SevenShipHull,
	installShippedSevenShip,
} from "../../scripts/lib/shipped-seven-ships";
import { authoredHullBuilder, installAuthoredHull } from "../../src/ship-mesh";

/**
 * Install the six shipped exteriors of design PR #829 (node #1035) the way the
 * game does, and put back whatever was installed before. A file that measures a
 * hull's metal — vents, muzzles, envelopes, levels — opts in; unrelated files
 * keep the procedural lofts.
 */
export async function useShippedSevenShips(): Promise<void> {
	const previous = new Map<
		SevenShipHull,
		ReturnType<typeof authoredHullBuilder>
	>();
	for (const hull of Object.keys(SEVEN_SHIP_FILES) as SevenShipHull[]) {
		previous.set(hull, authoredHullBuilder(hull));
		await installShippedSevenShip(hull);
	}
	afterAll(() => {
		for (const [hull, builder] of previous) installAuthoredHull(hull, builder);
	});
}
