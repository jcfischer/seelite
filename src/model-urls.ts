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
