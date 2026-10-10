/**
 * The one way a browser script builds the URL it loads
 * (`persistent-world-state.md` §11.6).
 *
 * #306 opens the Commander overlay in front of every boot of the default route.
 * A script that loads that route and waits for a booted game would wait on an
 * overlay nobody answers, so `gameUrl` adds `?boot=direct`, which boots as the
 * game did before §11. Workbench routes build no game and need nothing, but go
 * through `workbenchUrl` so that a navigation is always one of the two calls —
 * which is what lets `tests/game-url.test.ts` refuse everything else by reading
 * the source.
 *
 * Before this file every script wrote its own `goto` with its own template
 * string, and there was nowhere to add a parameter to all of them.
 *
 * The parameter's spelling is also in `src/boot-mode.ts`, which the page reads.
 * This file runs under node and cannot import TypeScript, so the test asserts
 * the two agree rather than one importing the other.
 */

export const BOOT_PARAM = "boot";
export const BOOT_DIRECT = "direct";

/**
 * The routes `main.ts` mounts instead of the game. The test reads `main.ts`'s
 * branches and asserts this list matches them, so a new workbench is a red
 * run here rather than a probe that waits on an overlay.
 */
export const WORKBENCH_ROUTES = Object.freeze([
	"model-viewer",
	"music-lab",
	"strings-lab",
	"voice-lab",
	"hud-gallery",
	"galaxy-map",
	"planet-prototype",
]);

/** The static, public pages. These routes never boot the game. */
export const PUBLIC_ROUTES = Object.freeze([
	"",
	"about",
	"field-notes",
	"manual",
	"trust",
	"credits",
]);

/** A static public-page URL, refusing an accidental game or workbench query. */
export function publicUrl(origin, route = "") {
	if (!PUBLIC_ROUTES.includes(route))
		throw new Error(`publicUrl: unknown public route "${route}"`);
	return new globalThis.URL(route === "" ? "/" : `/${route}/`, origin).href;
}

/**
 * @typedef {string | number | boolean | undefined | null} ParamValue
 * @typedef {Record<string, ParamValue>} Params
 */

/**
 * `?a=1&b` from `{ a: 1, b: true }`, in the order given.
 *
 * Written out rather than through `URLSearchParams`, which spells a flag
 * `b=` — the game reads its flags with `has`, so both work, but a URL a person
 * reads in a failure message should look like the one they would type.
 *
 * @param {URLSearchParams} into
 * @param {Params} params
 * @param {(key: string) => boolean} [skip]
 */
function append(into, params, skip = () => false) {
	for (const [key, value] of Object.entries(params)) {
		if (!present(value)) continue;
		if (skip(key)) continue;
		into.append(key, value === true ? "" : String(value));
	}
}

/**
 * Whether a parameter value reaches the URL. `append` leaves the others off, so
 * every guard that asks "does this URL carry X" asks it through this.
 *
 * @param {ParamValue} value
 */
const present = (value) =>
	value !== undefined && value !== null && value !== false;

/** @param {URLSearchParams} query */
const render = (query) =>
	[...query]
		.map(([k, v]) =>
			v === ""
				? encodeURIComponent(k)
				: `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
		)
		.join("&");

/**
 * The URL of a boot of the game.
 *
 * `override` is the `PROBE_URL` knob several probes read: when it is a
 * non-empty string it replaces the origin and the query, and the caller's
 * parameters fill in only what it does not already set — the knob exists to
 * point a probe at another world, so its seed wins. `force` names the
 * parameters that win over it anyway, for an arm whose whole point is one flag.
 * Either way the result boots direct unless it already names a boot, so a
 * person setting the knob does not get a probe that hangs on the overlay.
 *
 * `boot: null` leaves the parameter off. That is for a probe of the overlay
 * itself, and nothing else should want it.
 * Direct measurement boots wait for the interior kit so a background swap
 * cannot change a frame halfway through a comparison. Download probes pass
 * `"interiors-full": false`; player/overlay boots keep the normal loading policy.
 *
 * @param {string} origin
 * @param {Params} [params]
 * @param {{ override?: string, force?: string[], boot?: string | null }} [options]
 * @returns {string}
 */
export function gameUrl(
	origin,
	params = {},
	{ override, force = [], boot = BOOT_DIRECT } = {},
) {
	if (BOOT_PARAM in params)
		throw new Error(
			`gameUrl: set "${BOOT_PARAM}" through the boot option, not the parameters`,
		);
	const route = WORKBENCH_ROUTES.find((r) => r in params);
	if (route)
		throw new Error(
			`gameUrl: "${route}" is a workbench route and boots no game — use workbenchUrl`,
		);
	const unset = force.find((key) => !present(params[key]));
	if (unset !== undefined)
		throw new Error(
			`gameUrl: force names "${unset}", which the parameters do not set`,
		);
	const base = new globalThis.URL(override ? override : `${origin}/`);
	const query = new URLSearchParams(base.search);
	// The knob is held to the same rule as the parameters: an override naming a
	// workbench route builds no game, and the probe would hang in its boot wait.
	const overridden = WORKBENCH_ROUTES.find((r) => query.has(r));
	if (overridden)
		throw new Error(
			`gameUrl: override ${override} names the workbench route "${overridden}" and boots no game — use workbenchUrl`,
		);
	for (const key of force) query.delete(key);
	append(query, params, (key) => query.has(key));
	if (boot !== null && !query.has(BOOT_PARAM)) query.set(BOOT_PARAM, boot);
	if (
		query.get(BOOT_PARAM) === BOOT_DIRECT &&
		!("interiors-full" in params) &&
		!query.has("interiors-full")
	)
		query.set("interiors-full", "");
	const search = render(query);
	return `${base.origin}${base.pathname}${search ? `?${search}` : ""}`;
}

/**
 * The URL of a workbench route.
 *
 * **It boots direct too**, although a workbench builds no game. Both closes
 * (`model-viewer.ts`, `state-gallery.ts`) drop their own route and assign the
 * rest of the URL, which is a boot of the default route — so a probe that
 * closes a workbench back to flight needs the parameter already there, and the
 * page ignores it until then.
 *
 * Refuses parameters that name no workbench route, because those load the
 * default route — a game boot written as a workbench URL is the hand-built URL
 * this file exists to stop.
 *
 * `override` is the same `PROBE_URL` knob `gameUrl` takes, and replaces the
 * whole URL — but it is held to the same rule, so pointing a workbench probe at
 * a game URL through the knob is refused rather than left to hang.
 *
 * @param {string} origin
 * @param {Params} params
 * @param {{ override?: string }} [options]
 * @returns {string}
 */
export function workbenchUrl(origin, params, { override } = {}) {
	// As in `gameUrl`: a `boot` in the parameters would survive the close and
	// send the page it closes to wherever that value says.
	if (BOOT_PARAM in params)
		throw new Error(
			`workbenchUrl: "${BOOT_PARAM}" is set by the builder, not the parameters`,
		);
	const base = new globalThis.URL(override ? override : `${origin}/`);
	const query = new URLSearchParams(base.search);
	if (override)
		assertWorkbench(
			WORKBENCH_ROUTES.filter((r) => query.has(r)),
			`override ${override}`,
		);
	else {
		assertWorkbench(
			WORKBENCH_ROUTES.filter((r) => present(params[r])),
			JSON.stringify(Object.keys(params)),
		);
		append(query, params);
	}
	if (!query.has(BOOT_PARAM)) query.set(BOOT_PARAM, BOOT_DIRECT);
	return `${base.origin}${base.pathname}?${render(query)}`;
}

/**
 * The one refusal both arms of `workbenchUrl` make.
 *
 * @param {string[]} routes the workbench routes the URL would actually carry
 * @param {string} described what was asked for, for the message
 */
function assertWorkbench(routes, described) {
	if (routes.length === 0)
		throw new Error(
			`workbenchUrl: no workbench route in ${described} — that URL boots the game; use gameUrl`,
		);
}

/**
 * What a postcard link's fragment starts with (#406). The page's spelling is
 * `POSTCARD_FRAGMENT_PREFIX` in `src/postcard.ts`; this file runs under node and
 * cannot import it, so `tests/game-url.test.ts` pins the two together.
 */
export const POSTCARD_PREFIX = "#postcard=";

/**
 * A postcard link: the site's root with the recipe in the **fragment** and no
 * query at all — the shape the Postcard screen copies, and the one the viewer
 * is reached by. `fragment` is the recipe's spelling without its `#`. It is not
 * parsed here: a probe of the refusal has to be able to build a damaged link.
 *
 * @param {string} origin
 * @param {string} fragment
 * @returns {string}
 */
export function postcardUrl(origin, fragment) {
	const hash = `#${fragment}`;
	if (!hash.startsWith(POSTCARD_PREFIX))
		throw new Error(
			`postcardUrl: a postcard fragment starts "${POSTCARD_PREFIX.slice(1)}", not "${fragment.slice(0, 16)}"`,
		);
	return `${new globalThis.URL("/", origin).href}${hash}`;
}
