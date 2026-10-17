import {
	type AuthoredHullBuilder,
	installAuthoredHull,
} from "../../src/ship-mesh";
import { createTugHullBuilder } from "../../src/tug-hull";
import { decodeShippedGlb } from "./shipped-glb";

let builder: AuthoredHullBuilder | undefined;

/**
 * Install the shipped Bollard tug (node #814) the way the game does, from
 * `src/models/bollard-tug.glb` through the browser's loader, as
 * `installShippedCourierHull` installs the courier. Every test file runs with
 * it installed (`tests/setup/tug-hull.ts`, the bun preload), so a row reading
 * a figure measured off the tug's mesh — its envelope, its vents, its muzzle —
 * measures the hull the game draws. A script that builds ships awaits it itself.
 */
export async function installShippedTugHull(): Promise<void> {
	builder ??= await createTugHullBuilder(
		await decodeShippedGlb("src/models/bollard-tug.glb"),
	);
	installAuthoredHull("tug", builder);
}
