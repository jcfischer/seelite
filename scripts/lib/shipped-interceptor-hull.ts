import { createInterceptorHullBuilder } from "../../src/interceptor-hull";
import {
	type AuthoredHullBuilder,
	installAuthoredHull,
} from "../../src/ship-mesh";
import { decodeShippedGlb } from "./shipped-glb";

let builder: AuthoredHullBuilder | undefined;

/**
 * Install the shipped Lance (node #1034) the way the game does, from
 * `src/models/lance-interceptor.glb` through the browser's loader, as
 * `installShippedTugHull` installs the tug. Every test file runs with it
 * installed (`tests/setup/interceptor-hull.ts`, the bun preload), so a row
 * reading a figure measured off the interceptor's mesh — its envelope, its
 * vents, its muzzles — measures the hull the game draws. A script that builds
 * ships awaits it itself.
 */
export async function installShippedInterceptorHull(): Promise<void> {
	builder ??= await createInterceptorHullBuilder(
		await decodeShippedGlb("src/models/lance-interceptor.glb"),
	);
	installAuthoredHull("interceptor", builder);
}
