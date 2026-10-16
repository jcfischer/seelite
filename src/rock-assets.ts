import heightfieldUrl from "./models/rock-heightfields.bin?url&inline";
import { ASTEROIDS_GLB_URL } from "./model-urls";
import {
	decodeRockHeightfields,
	type RockHeightfields,
} from "./rock-heightfields";

// Vite's forced inline asset import works in dev and production, regardless
// of assetsInlineLimit. Importing this module does not decode the data.
let heightfields: RockHeightfields | undefined;
/** Three-free access for collision consumers; no fetch or model install. */
export function getRockHeightfields(): RockHeightfields {
	if (heightfields) return heightfields;
	if (
		!heightfieldUrl.startsWith("data:") ||
		!heightfieldUrl.includes(";base64,")
	)
		throw new Error("Rock heightfields must be inlined as base64");
	const binary = atob(heightfieldUrl.slice(heightfieldUrl.indexOf(",") + 1));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	heightfields = decodeRockHeightfields(bytes);
	return heightfields;
}

/** Lazy render-side handle; collision code can call getRockHeightfields directly. */
export const ROCK_ASSETS = {
	get heightfields(): RockHeightfields {
		return getRockHeightfields();
	},
	/** Emitted with a content hash; drawing/installation follows in field integration. */
	glbUrl: ASTEROIDS_GLB_URL,
};
