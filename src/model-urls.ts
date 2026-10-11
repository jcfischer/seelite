/**
 * The game's models, served under content-hashed names (#834).
 *
 * `new URL(literal, import.meta.url)` is what vite rewrites at build time:
 * each file is emitted to `dist/assets/` with a hash of its bytes in its
 * name, and `public/_headers` marks `/assets/*` immutable for a year. So a
 * repeat visit loads a model from the browser cache with no request, and a
 * re-encoded model gets a new URL rather than a stale cached copy. A model
 * kept under `public/` instead would be served at a fixed name, which a
 * browser must revalidate on every boot.
 */
export const CORIOLIS_GLB_URL = new URL(
	"./models/coriolis.glb",
	import.meta.url,
).href;
export const COURIER_COCKPIT_GLB_URL = new URL(
	"./models/courier-cockpit.glb",
	import.meta.url,
).href;
/** Prepared by `spikes/courier-hull/prepare-game-asset.mjs` (node #812). */
export const COURIER_HULL_GLB_URL = new URL(
	"./models/courier-hull.glb",
	import.meta.url,
).href;
/** Prepared by `spikes/bollard-hull/prepare-flight-asset.mjs` (node #814). */
export const BOLLARD_TUG_GLB_URL = new URL(
	"./models/bollard-tug.glb",
	import.meta.url,
).href;
export const LONGWALL_MINER_GLB_URL = new URL(
	"./models/longwall-miner.glb",
	import.meta.url,
).href;

/** Accepted per-fitting station interiors, node #843. */
export const STATION_INTERIORS_GLB_URL = new URL(
	"./models/station-interiors.glb",
	import.meta.url,
).href;
