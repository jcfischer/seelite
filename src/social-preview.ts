/**
 * The preview a social network shows for a link to this site (#714).
 *
 * A crawler fetches the page's HTML, reads the Open Graph and Twitter card
 * tags in its head, and fetches the one image they name. It runs no script and
 * draws no WebGL, so the preview has to be a static file the host serves, and
 * the tags have to be in the HTML as built.
 *
 * **One preview for the whole site, postcard links included.** A postcard's
 * recipe rides the URL fragment (#406), which no browser sends, so a crawler
 * sees every postcard link as the home page. A preview per postcard would need
 * the recipe in the path and a server to draw or store it, which the map's
 * no-backend constraint and #406's "the host learns nothing" both refuse.
 *
 * **Written once.** `socialPreview()` is a vite plugin that adds the block to
 * every HTML entry at build; a dev server is never crawled, and leaving dev
 * alone keeps every probe's page as it was. No entry carries its own copy, and
 * `tests/social-preview.test.ts` goes red if one does. The title is the page's
 * own `<title>` and the description its `dek` from `PUBLIC_PAGES`, so the
 * preview says what the page says and adds no copy of its own. Both are HTML
 * text already — a `<title>` is parsed as HTML and a `dek` is written into
 * the page as markup — so only the attribute's own quote is escaped; escaping
 * them again would print an entity as its spelling.
 */
import type { Plugin } from "vite";
import { PUBLIC_PAGES } from "./public-site";

/**
 * The public origin. Facebook and LinkedIn refuse a relative image URL, and
 * the site's own name is the one a preview should carry: `seelite.pages.dev`
 * serves the same build, but farbetween.ch is the address the site announces.
 */
export const SITE_ORIGIN = "https://farbetween.ch";

/**
 * The image: `public/<file>`, served at the site root.
 *
 * 1200 x 630 is the 1.91:1 frame X, LinkedIn, Facebook and Discord show
 * uncropped; the 3:2 postcard card would lose its foot band to their crop.
 * `maxBytes` keeps it well under the smallest crawler limit (X: 5 MB).
 *
 * **It is a frame of the Docking Waltz film, the principal's choice (#714).**
 * Frame 1650 (27.5 s) of the 2560 x 1440 capture, cut to 1.91:1 by dropping
 * 48 rows top and bottom and scaled down. The film is drawn by the game's own
 * code — the courier, the terran planet shader, the starfield — but its
 * station is Station-X, the Wheel trade form with the film's detail pass,
 * which the running game does not place yet. So the frame cannot be rebuilt
 * from a postcard recipe; `source` names where it came from instead.
 */
export const SOCIAL_PREVIEW = {
	file: "social-preview.jpg",
	width: 1200,
	height: 630,
	alt: "A courier approaching a spinning wheel station above a cloud-covered planet.",
	source:
		"The Far Between — The Docking Waltz, capture frame 01650 (t = 27.5 s): crop=2560:1344:0:48, scale=1200:630 lanczos, JPEG q2",
	maxBytes: 400_000,
} as const;

/**
 * `html` with the preview block added before `</head>`. Throws on an entry
 * `PUBLIC_PAGES` does not list, or on a page without a `<title>` or a head,
 * so a new page cannot ship without a preview by passing through untouched.
 */
export function socialPreviewTags(html: string, entry: string): string {
	const page = PUBLIC_PAGES.find((p) => p.entry === entry);
	if (!page) throw new Error(`social preview: ${entry} is not a public page`);
	const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
	if (title === undefined || !html.includes("</head>"))
		throw new Error(`social preview: ${entry} has no <title> or </head>`);
	const tags: [string, string, string][] = [
		["property", "og:type", "website"],
		["property", "og:site_name", "The Far Between"],
		["property", "og:title", title],
		["property", "og:description", page.dek],
		["property", "og:url", `${SITE_ORIGIN}/${page.slug && `${page.slug}/`}`],
		["property", "og:image", `${SITE_ORIGIN}/${SOCIAL_PREVIEW.file}`],
		["property", "og:image:width", String(SOCIAL_PREVIEW.width)],
		["property", "og:image:height", String(SOCIAL_PREVIEW.height)],
		["property", "og:image:alt", SOCIAL_PREVIEW.alt],
		["name", "twitter:card", "summary_large_image"],
	];
	const block = tags
		.map(
			([attr, key, value]) =>
				`<meta ${attr}="${key}" content="${value.replaceAll('"', "&quot;")}" />`,
		)
		.join("\n    ");
	return html.replace("</head>", `    ${block}\n  </head>`);
}

/** The vite plugin: every HTML entry gets the block, at build. */
export function socialPreview(): Plugin {
	return {
		name: "seelite-social-preview",
		apply: "build",
		transformIndexHtml(html, ctx) {
			return socialPreviewTags(html, ctx.path.replace(/^\//, ""));
		},
	};
}
