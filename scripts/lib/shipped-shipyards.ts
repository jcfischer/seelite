import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	createShipyardBuilder,
	SHIPYARD_FORMS,
} from "../../src/shipyard-flight";
import { installShipyardBuilder } from "../../src/station-mesh";
import { decodeShippedGlb } from "./shipped-glb";

/** Each form's shipped model. */
export const SHIPPED_SHIPYARD_FILES = {
	a: "src/models/shipyard-gantry.glb",
	b: "src/models/shipyard-foundry.glb",
	c: "src/models/shipyard-slipway.glb",
} as const;

/** A shipped model's SHA-256, which the proxies record as their source. */
export function shipyardModelHash(form: keyof typeof SHIPPED_SHIPYARD_FILES) {
	return createHash("sha256")
		.update(readFileSync(SHIPPED_SHIPYARD_FILES[form]))
		.digest("hex");
}

const builders = new Map<string, ReturnType<typeof createShipyardBuilder>>();

/**
 * Install the three shipped shipyards (node #818) the way the game does, from
 * `src/models/shipyard-*.glb` through the browser's loader, as
 * `installShippedTugHull` installs the tug. A test that measures what the game
 * draws for a shipyard, or the proxy generator, awaits it first.
 */
export async function installShippedShipyards(): Promise<void> {
	for (const form of SHIPYARD_FORMS) {
		let builder = builders.get(form);
		if (!builder) {
			builder = createShipyardBuilder(
				form,
				await decodeShippedGlb(SHIPPED_SHIPYARD_FILES[form]),
			);
			builders.set(form, builder);
		}
		installShipyardBuilder(form, builder);
	}
}

/** Put the procedural stand-ins back, for a test that measures those. */
export function uninstallShipyards(): void {
	for (const form of SHIPYARD_FORMS) installShipyardBuilder(form, null);
}
