import heightfieldUrl from "./models/rock-heightfields.bin?url&inline";
import { ASTEROIDS_GLB_URL } from "./model-urls";
import { decodeRockHeightfields } from "./rock-heightfields";

// Vite's forced inline asset import works in dev and production, regardless
// of assetsInlineLimit. Decode synchronously; no fetch or model install.
const base64 = heightfieldUrl.slice(heightfieldUrl.indexOf(",") + 1);
if (!heightfieldUrl.startsWith("data:") || !heightfieldUrl.includes(";base64,"))
	throw new Error("Rock heightfields must be inlined as base64");
export const ROCK_ASSETS = {
	heightfields: decodeRockHeightfields(
		Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
	),
	/** Emitted with a content hash; drawing/installation follows in field integration. */
	glbUrl: ASTEROIDS_GLB_URL,
};
