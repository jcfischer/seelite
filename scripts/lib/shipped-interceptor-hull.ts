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
 * `installShippedTugHull` installs the tug. Mesh-dependent test files opt in
 * through `tests/setup/interceptor-hull.ts`; unrelated tests keep the stand-in.
 * A script that builds ships awaits it itself.
 */
export async function installShippedInterceptorHull(): Promise<void> {
	builder ??= await createInterceptorHullBuilder(
		await decodeShippedGlb("src/models/lance-interceptor.glb"),
	);
	installAuthoredHull("interceptor", builder);
}
