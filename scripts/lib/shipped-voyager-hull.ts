import {
	type AuthoredHullBuilder,
	installAuthoredHull,
} from "../../src/ship-mesh";
import { createVoyagerHullBuilder } from "../../src/voyager-hull";
import { decodeShippedGlb } from "./shipped-glb";

let builder: AuthoredHullBuilder | undefined;

/**
 * Install the shipped Discovery / Voyager A (node #820) the way the game does,
 * from `src/models/discovery-voyager.glb` through the browser's loader, as
 * `installShippedTugHull` installs the tug. Every test file runs with it
 * installed (`tests/setup/voyager-hull.ts`, the bun preload), so a row reading
 * a figure measured off the voyager's mesh — its envelope, its vents, its
 * muzzle — measures the hull the game draws. A script that builds ships awaits
 * it itself.
 */
export async function installShippedVoyagerHull(): Promise<void> {
	builder ??= await createVoyagerHullBuilder(
		await decodeShippedGlb("src/models/discovery-voyager.glb"),
	);
	installAuthoredHull("voyager", builder);
}
