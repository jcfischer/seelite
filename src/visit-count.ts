/**
 * One count per public page load, one per game launch (#569) and one per
 * opened postcard link (#714).
 *
 * The principal's ruling, which reverses part of map #1's first Constraint:
 * *"I just want to see how many people are playing, so counterscale on public
 * pages and launch is enough."* Counterscale is the principal's own counter on
 * a Cloudflare Worker, the one his other websites already load.
 *
 * **Two sites, not two paths.** The tracker records `location.pathname` and
 * reads the query string only for UTM tags, so the threshold at `/` and the
 * game at `/?boot=overlay` would both land as `/` and the one figure asked for
 * would disappear. A launch is counted under its own site id instead.
 *
 * **A postcard open is the third (#714).** A postcard link opens at `/` with
 * its recipe in the fragment, which the tracker never reads, so under the page
 * site it would read as a visit to the threshold. It is the link a player posts,
 * and the principal asked for it to be counted on its own: the tracker's
 * referrer column names the site that sent it when the browser passes a
 * referrer, and an open without one lands with no source. The recipe is not
 * sent — the tracker reports `pathname` and the UTM tags, never the hash.
 *
 * **Production only.** The tracker skips its report on localhost but still
 * fetches `tracker.js` from the Worker, so an unconditional tag would put an
 * internet round trip into every dev session, probe and view capture. The gate
 * is the build's `PROD` flag; nothing here runs under `npm run dev` or bun.
 *
 * **Once per page load.** The tracker also counts `history.pushState` and
 * `popstate`; this game calls neither, so nothing after launch is reported, and
 * `tests/public-site.test.ts` goes red on the spellings of either it knows.
 */
export const COUNTER_ORIGIN =
	"https://counterscale.jens-christian-66c.workers.dev";

export const VISIT_SITES = {
	page: "the-far-between",
	launch: "the-far-between-play",
	postcard: "the-far-between-postcard",
} as const;

export type VisitKind = keyof typeof VISIT_SITES;

/**
 * The attributes Counterscale's `tracker.js` looks itself up by: it finds
 * `#counterscale-script`, takes the site id from `data-site-id`, and derives
 * its report URL by replacing `tracker.js` in the element's `src`.
 */
export function counterScript(kind: VisitKind): Record<string, string> {
	return {
		id: "counterscale-script",
		src: `${COUNTER_ORIGIN}/tracker.js`,
		"data-site-id": VISIT_SITES[kind],
	};
}

type Tag = { setAttribute(name: string, value: string): void };

/** The two things `countVisit` needs of a document, so a test can stand in. */
type TagSink<E extends Tag> = {
	head: { append(el: E): void };
	createElement(tag: "script"): E;
};

export function countVisit<E extends Tag = HTMLScriptElement>(
	kind: VisitKind,
	{
		enabled = import.meta.env?.PROD === true,
		doc = globalThis.document as unknown as TagSink<E>,
	}: { enabled?: boolean; doc?: TagSink<E> } = {},
): void {
	if (!enabled) return;
	const script = doc.createElement("script");
	for (const [name, value] of Object.entries(counterScript(kind)))
		script.setAttribute(name, value);
	doc.head.append(script);
}
