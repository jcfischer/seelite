/**
 * A file of the game's own bundle, fetched at runtime (#604): the neural
 * voice's model, runtime binary and voices, which are too large to import.
 *
 * The map's Constraints count a same-origin file of the static bundle as the
 * bundle, not a runtime network request (#543, the music worklet), and the
 * neural voice's ruling (2026-10-01) says no request leaves the bundle's
 * origin. This is that rule in code: **a path on this origin or nothing**.
 * `tests/public-site.test.ts` allows only this module, beside the visit
 * counter, to call `fetch` in `src/`; `tests/voice-model.test.ts` holds the
 * refusal; and the runtime's own loaders, which no source scan can see, are
 * held to the origin only by `scripts/measure-neural-voice.mjs`, which
 * records every request — **run by hand** (the principal's ruling, D5 on
 * #606), so a runtime bump that fetched off-origin would pass every gate
 * until someone runs it.
 */

/** Any origin will do: the question is only whether a path leaves it. */
const PLACEHOLDER = "http://bundle.invalid/";

/**
 * A path served by this origin. **Resolved, not pattern-matched**: the URL
 * parser strips tabs and newlines before it reads a path, so `/\t/host`
 * becomes `//host` — another origin — and a pattern on the raw text passed
 * it (sage round 2 on #606).
 */
export function isBundlePath(path: string): boolean {
	if (!path.startsWith("/")) return false;
	try {
		return new URL(path, PLACEHOLDER).origin === new URL(PLACEHOLDER).origin;
	} catch {
		return false;
	}
}

/** Fetch a file of the bundle; anything that is not a bundle path throws. */
export function fetchBundled(path: string): Promise<Response> {
	if (!isBundlePath(path))
		throw new Error(`fetchBundled: ${path} is not a path of this origin`);
	return fetch(path);
}
