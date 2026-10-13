import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	createRefineryBuilder,
	REFINERY_FORMS,
	REFINERY_MODEL_NAMES,
} from "../../src/refinery-flight";
import { installRefineryBuilder } from "../../src/station-mesh";
import { decodeShippedGlb } from "./shipped-glb";

/** Each form's shipped model. */
export const SHIPPED_REFINERY_FILES = Object.fromEntries(
	REFINERY_FORMS.map((form) => [
		form,
		`src/models/refinery-${REFINERY_MODEL_NAMES[form]}.glb`,
	]),
) as Readonly<Record<(typeof REFINERY_FORMS)[number], string>>;

/** A shipped model's SHA-256, which the proxies record as their source. */
export function refineryModelHash(form: keyof typeof SHIPPED_REFINERY_FILES) {
	return createHash("sha256")
		.update(readFileSync(SHIPPED_REFINERY_FILES[form]))
		.digest("hex");
}

const builders = new Map<string, ReturnType<typeof createRefineryBuilder>>();

/**
 * Install the four shipped refineries (node #819) the way the game does, from
 * `src/models/refinery-*.glb` through the browser's loader, as
 * `installShippedShipyards` installs the shipyards. A test that measures what
 * the game draws for a refinery, or the proxy generator, awaits it first.
 */
export async function installShippedRefineries(): Promise<void> {
	for (const form of REFINERY_FORMS) {
		let builder = builders.get(form);
		if (!builder) {
			builder = createRefineryBuilder(
				form,
				await decodeShippedGlb(SHIPPED_REFINERY_FILES[form]),
			);
			builders.set(form, builder);
		}
		installRefineryBuilder(form, builder);
	}
}

/** Put the procedural stand-ins back, for a test that measures those. */
export function uninstallRefineries(): void {
	for (const form of REFINERY_FORMS) installRefineryBuilder(form, null);
}
