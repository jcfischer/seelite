import { afterAll, beforeAll } from "bun:test";
import {
	type AuthoredHullBuilder,
	authoredHullBuilder,
	installAuthoredHull,
} from "../../src/ship-mesh";

/**
 * For a file whose rows hold the **procedural** hull language — lofts,
 * finishes, plating, greeble zones — over every hull and variant: the courier
 * is drawn as the procedural Kestrel while the file runs, and whatever model
 * was installed is put back after it, because bun runs every file in one
 * process. The authored courier's own rows are `tests/courier-hull.test.ts`'s.
 */
export function useProceduralCourier(): void {
	let installed: AuthoredHullBuilder | undefined;
	beforeAll(() => {
		installed = authoredHullBuilder("courier");
		installAuthoredHull("courier", undefined);
	});
	afterAll(() => installAuthoredHull("courier", installed));
}
