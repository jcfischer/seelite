/**
 * A file of the game's own bundle, fetched at runtime (#604): the neural
 * voice's model, runtime binary and voices, which are too large to import.
 *
 * The map's Constraints count a same-origin file of the static bundle as the
 * bundle, not a runtime network request (#543, the music worklet), and the
 * neural voice's ruling (2026-10-01) says no request leaves the bundle's
 * origin. This is that rule in code: **a path on this origin or nothing**, and
 * `tests/public-site.test.ts` allows this module, beside the visit counter,
 * to call `fetch`.
 */

/** A path served by this origin: one leading slash, no scheme, no host. */
export const isBundlePath = (path: string): boolean =>
	/^\/(?![/\\])/.test(path) && !/^[a-z][a-z0-9+.-]*:/i.test(path);

/** Fetch a file of the bundle; anything that is not a bundle path throws. */
export function fetchBundled(path: string): Promise<Response> {
	if (!isBundlePath(path))
		throw new Error(`fetchBundled: ${path} is not a path of this origin`);
	return fetch(path);
}
