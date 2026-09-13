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
 * branches and asserts this list matches them, so a fifth workbench is a red
 * run here rather than a probe that waits on an overlay.
 */
export const WORKBENCH_ROUTES = Object.freeze([
	"model-viewer",
	"hud-gallery",
	"galaxy-map",
	"planet-prototype",
]);

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
		if (value === undefined || value === null || value === false) continue;
		if (skip(key)) continue;
		into.append(key, value === true ? "" : String(value));
	}
}

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
 * point a probe at another world, so its seed wins. Either way the result
 * boots direct unless it already names a boot, so a person setting the knob
 * does not get a probe that hangs on the overlay.
 *
 * `boot: null` leaves the parameter off. That is for a probe of the overlay
 * itself, and nothing else should want it.
 *
 * @param {string} origin
 * @param {Params} [params]
 * @param {{ override?: string, boot?: string | null }} [options]
 * @returns {string}
 */
export function gameUrl(
	origin,
	params = {},
	{ override, boot = BOOT_DIRECT } = {},
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
	const base = new globalThis.URL(override ? override : `${origin}/`);
	const query = new URLSearchParams(base.search);
	append(query, params, (key) => query.has(key));
	if (boot !== null && !query.has(BOOT_PARAM)) query.set(BOOT_PARAM, boot);
	const search = render(query);
	return `${base.origin}${base.pathname}${search ? `?${search}` : ""}`;
}

/**
 * The URL of a workbench route. No boot parameter: these build no game.
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
	if (override) {
		const query = new globalThis.URL(override).searchParams;
		if (!WORKBENCH_ROUTES.some((r) => query.has(r)))
			throw new Error(
				`workbenchUrl: override ${override} names no workbench route — ` +
					`that URL boots the game; use gameUrl`,
			);
		return override;
	}
	if (!WORKBENCH_ROUTES.some((r) => r in params))
		throw new Error(
			`workbenchUrl: no workbench route in ${JSON.stringify(Object.keys(params))} — ` +
				`that URL boots the game; use gameUrl`,
		);
	const query = new URLSearchParams();
	append(query, params);
	return `${origin}/?${render(query)}`;
}
