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
/** Authored rock archetypes (node #966); loading/drawing follows separately. */
export const ASTEROIDS_GLB_URL = new URL(
	"./models/asteroids.glb",
	import.meta.url,
).href;
export const CORIOLIS_GLB_URL = new URL(
	"./models/coriolis.glb",
	import.meta.url,
).href;

/** Full authored Assembly kit, exported in kilometres (node #1073). */
export const ASSEMBLY_GLB_URL = new URL(
	"./models/trade-assembly.glb",
	import.meta.url,
).href;

/** Flight exports of the approved trade studies, node #1033. */
export const TRADE_GLB_URLS = {
	b: new URL("./models/trade-ring.glb", import.meta.url).href,
	c: new URL("./models/trade-drum.glb", import.meta.url).href,
	e: new URL("./models/trade-wheel.glb", import.meta.url).href,
} as const;
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
/** Prepared by `spikes/discovery/prepare-flight-asset.mjs` (node #820). */
export const DISCOVERY_VOYAGER_GLB_URL = new URL(
	"./models/discovery-voyager.glb",
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

/** The three shipyards (node #818), prepared by
 *  `spikes/shipyards/prepare-flight-asset.mjs`: form `a` Gantry Works, `b`
 *  Foundry Hangar, `c` Crescent Slipway. */ // glossary-ignore: Hangar
export const SHIPYARD_GLB_URLS = {
	a: new URL("./models/shipyard-gantry.glb", import.meta.url).href,
	b: new URL("./models/shipyard-foundry.glb", import.meta.url).href,
	c: new URL("./models/shipyard-slipway.glb", import.meta.url).href,
} as const;

/** Each shipyard's baked work lights (node #818, principal 2026-10-12), an
 *  8-bit sRGB lightmap for the model's second UV set, written beside it by
 *  `spikes/shipyards/prepare-flight-asset.mjs`. */
export const SHIPYARD_LIGHTMAP_URLS = {
	a: new URL("./models/shipyard-gantry-lightmap.webp", import.meta.url).href,
	b: new URL("./models/shipyard-foundry-lightmap.webp", import.meta.url).href,
	c: new URL("./models/shipyard-slipway-lightmap.webp", import.meta.url).href,
} as const;

/** Each shipyard's work lights sampled on a grid through the yard, float16,
 *  for the ships inside it (`src/ship-work-light.ts`, node #818). */
export const SHIPYARD_PROBE_URLS = {
	a: new URL("./models/shipyard-gantry-probes.bin", import.meta.url).href,
	b: new URL("./models/shipyard-foundry-probes.bin", import.meta.url).href,
	c: new URL("./models/shipyard-slipway-probes.bin", import.meta.url).href,
} as const;

/** The four refineries (node #819), prepared by
 *  `spikes/refineries/prepare-flight-asset.mjs`: form `a` Warren, `b` Collar,
 *  `c` Spar, `d` Works. */
export const REFINERY_GLB_URLS = {
	a: new URL("./models/refinery-warren.glb", import.meta.url).href,
	b: new URL("./models/refinery-collar.glb", import.meta.url).href,
	c: new URL("./models/refinery-spar.glb", import.meta.url).href,
	d: new URL("./models/refinery-works.glb", import.meta.url).href,
} as const;

/** Prepared by the Porter study (node #813). */
export const PORTER_GLB_URL = new URL("./models/porter.glb", import.meta.url)
	.href;

/** The authored outposts, prepared by
 *  `spikes/stations/prepare-flight-asset.mjs`: forms `a`–`d` (node #1032) and
 *  the Salvage, `e` (node #1031). */
export const OUTPOST_GLB_URLS = {
	a: new URL("./models/outpost-derrick.glb", import.meta.url).href,
	b: new URL("./models/outpost-buoy.glb", import.meta.url).href,
	c: new URL("./models/outpost-rig.glb", import.meta.url).href,
	d: new URL("./models/outpost-cluster.glb", import.meta.url).href,
	e: new URL("./models/outpost-salvage.glb", import.meta.url).href,
} as const;
