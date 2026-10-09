import { createCourierHullBuilder } from "../../src/courier-hull";
import {
	type AuthoredHullBuilder,
	installAuthoredCourier,
} from "../../src/ship-mesh";
import { decodeShippedGlb } from "./shipped-glb";

let builder: AuthoredHullBuilder | undefined;

/**
 * Install the shipped courier exterior (node #812) the way the game does,
 * from `src/models/courier-hull.glb` through the browser's loader. Every
 * test file runs with it installed (`tests/setup-courier-hull.ts`, the bun
 * preload), so a row that reads a figure measured off the courier's mesh —
 * its envelope, its vent placement, its muzzle — measures the hull the
 * player flies. Textures are stripped (bun decodes no images); geometry,
 * names and materials are the shipped ones.
 *
 * Here rather than in the test tree because `scripts/measure-vent-placement.ts`
 * calls it too; the test-only half is `tests/helpers/procedural-courier.ts`.
 */
export async function installShippedCourierHull(): Promise<void> {
	builder ??= await createCourierHullBuilder(
		await decodeShippedGlb("src/models/courier-hull.glb"),
	);
	installAuthoredCourier(builder);
}
