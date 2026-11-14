import { afterAll, beforeAll } from "bun:test";
import {
	AFTER_BOOT_HULL_IDS,
	type AfterBootHullId,
	type AuthoredHullBuilder,
	authoredHullBuilder,
	installAuthoredHull,
} from "../../src/ship-mesh";

/**
 * For a file whose rows hold the **procedural** hull language — lofts,
 * finishes, plating, greeble zones — over every hull and variant: every
 * after-boot hull (the courier, and the tug since node #814) is drawn as its
 * procedural loft while the file runs, and whatever model was installed is put
 * back after it, because bun runs every file in one process. The authored
 * hulls' own rows are `tests/courier-hull.test.ts`'s and `tests/tug-hull.test.ts`'s.
 */
/** Run `work` with every after-boot hull drawn as its procedural loft, and put
 *  back whatever was installed. For a row whose subject *is* the loft — the
 *  variant-selection rule scores three lofts, and an installed model answers
 *  with its one box for all three. */
export function withProceduralHulls<T>(work: () => T): T {
	const installed = new Map<AfterBootHullId, AuthoredHullBuilder | undefined>();
	for (const id of AFTER_BOOT_HULL_IDS) {
		installed.set(id, authoredHullBuilder(id));
		installAuthoredHull(id, undefined);
	}
	try {
		return work();
	} finally {
		for (const [id, builder] of installed) installAuthoredHull(id, builder);
	}
}

export function useProceduralHulls(): void {
	const installed = new Map<AfterBootHullId, AuthoredHullBuilder | undefined>();
	beforeAll(() => {
		for (const id of AFTER_BOOT_HULL_IDS) {
			installed.set(id, authoredHullBuilder(id));
			installAuthoredHull(id, undefined);
		}
	});
	afterAll(() => {
		for (const [id, builder] of installed) installAuthoredHull(id, builder);
	});
}
