/**
 * The pages `main.ts` serves that are not the game: the labs, the viewers
 * and the galaxy map, each named by a bare query parameter (`?voice-lab`).
 * The entry reads this list so a page reaches `main.ts` without the `boot`
 * or `seed` the game needs, and `tests/page-routes.test.ts` holds it equal
 * to `main.ts`'s own route chain. Imports nothing.
 */
export const PAGE_ROUTES = [
	"model-viewer",
	"music-lab",
	"strings-lab",
	"voice-lab",
	"hud-gallery",
	"galaxy-map",
	"planet-prototype",
] as const;

/** Whether the URL asks for one of those pages. */
export const isPageRoute = (query: URLSearchParams) =>
	PAGE_ROUTES.some((r) => query.has(r));
