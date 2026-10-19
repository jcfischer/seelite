import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	createOutpostBuilder,
	OUTPOST_FORMS,
	OUTPOST_MODEL_NAMES,
} from "../../src/outpost-flight";
import { installOutpostBuilder } from "../../src/station-mesh";
import { decodeShippedGlb } from "./shipped-glb";

/** Each form's shipped model. */
export const SHIPPED_OUTPOST_FILES = Object.fromEntries(
	OUTPOST_FORMS.map((form) => [
		form,
		`src/models/outpost-${OUTPOST_MODEL_NAMES[form]}.glb`,
	]),
) as Readonly<Record<(typeof OUTPOST_FORMS)[number], string>>;

/** A shipped model's SHA-256, which the proxies record as their source. */
export function outpostModelHash(form: keyof typeof SHIPPED_OUTPOST_FILES) {
	return createHash("sha256")
		.update(readFileSync(SHIPPED_OUTPOST_FILES[form]))
		.digest("hex");
}

const builders = new Map<string, ReturnType<typeof createOutpostBuilder>>();

/**
 * Install the shipped authored outposts (nodes #1031, #1032) the way the game does, from
 * `src/models/outpost-*.glb` through the browser's loader, as
 * `installShippedRefineries` installs the refineries. A test that measures
 * what the game draws for an outpost, or the proxy generator, awaits it first.
 */
export async function installShippedOutposts(): Promise<void> {
	for (const form of OUTPOST_FORMS) {
		let builder = builders.get(form);
		if (!builder) {
			builder = createOutpostBuilder(
				form,
				await decodeShippedGlb(SHIPPED_OUTPOST_FILES[form]),
			);
			builders.set(form, builder);
		}
		installOutpostBuilder(form, builder);
	}
}

/** Put the procedural stand-in back, for a test that measures it. */
export function uninstallOutposts(): void {
	for (const form of OUTPOST_FORMS) installOutpostBuilder(form, null);
}
