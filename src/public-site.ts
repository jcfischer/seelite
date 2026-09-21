export type PublicPage = {
	slug: "" | "about" | "field-notes" | "manual" | "trust" | "credits";
	entry: string;
	nav: string;
	eyebrow: string;
	title: string;
	dek: string;
	content: string;
};

const play =
	'<a class="button button--primary" href="/?boot=overlay">Play now <span aria-hidden="true">→</span></a>';

export const PUBLIC_PAGES: readonly PublicPage[] = [
	{
		slug: "",
		entry: "index.html",
		nav: "Home",
		eyebrow: "A browser spaceflight game",
		title: "The Far Between",
		dek: "A little ship. A large sky. Work worth doing between the two.",
		content: `<div class="threshold-actions">${play}<a class="button button--quiet" href="/about/">Find your bearings</a></div>
			<p class="threshold-note">No accounts. No tracking. No analytics.<br />No runtime network calls.</p>
			<div class="instrument" aria-label="A quiet frontier transmission"><span>SECTOR: UNCHARTED</span><span>LOCAL: 03:17</span><span>SIGNAL: FAINT</span></div>`,
	},
	{
		slug: "about",
		entry: "about/index.html",
		nav: "About",
		eyebrow: "About the Far Between",
		title: "A frontier with room to breathe.",
		dek: "The Far Between is a solo space game about flying, trading, taking work, getting into trouble, and noticing what is out there.",
		content: `<p>The game rewards attention, not homework. Start immediately in your browser; follow useful work, quiet travel, combat, or the trail of something stranger when you want to.</p>
			<p>There are no streaks, campaigns to keep up with, or lore exams. Your work leaves marks. The world remembers.</p>
			<p>Made by <a href="https://invisible.ch" rel="noreferrer">invisible.ch</a>.</p>
			${play}`,
	},
	{
		slug: "field-notes",
		entry: "field-notes/index.html",
		nav: "Field Notes",
		eyebrow: "Field Notes",
		title: "Occasional signals from the frontier.",
		dek: "Screens, postcards, release notes, and worthwhile observations arrive here when there is something real to show.",
		content: `<p>The first note is still in flight. Until then, the game is the better place to find out what is waiting.</p>
			${play}`,
	},
	{
		slug: "manual",
		entry: "manual/index.html",
		nav: "Manual",
		eyebrow: "Manual",
		title: "Enough to leave the berth.",
		dek: "A short reference for the moments when you want an answer without leaving the game behind.",
		content: `<label class="manual-search">Search this page <input type="search" placeholder="Try “dock” or “cruise”" autocomplete="off" /></label>
			<section data-topic><h2>Fly</h2><p>Pitch is W and S, yaw is A and D, roll is Q and E, and the arrow keys pitch and yaw as well. Shift and Ctrl move the throttle. X switches flight assist, which keeps a combat-speed ceiling; switch it off when you want to drift. The green cue marks where you are going, not only where the ship points.</p></section>
			<section data-topic><h2>Panels and controls</h2><p>Press ? to open the Controls tab and see the complete, remappable control reference. 1 opens the left panel, 2 faces the forward panel, and 3 opens the right panel. Press the same key again to return your view to flight.</p></section>
			<section data-topic><h2>Travel</h2><p>T and G step through targets, F faces the one you selected, and J engages or drops cruise. The &#96; key winds up the jump to another system. Cruise is for distance; ordinary flight is for arriving, fighting, and docking.</p></section>
			<section data-topic><h2>Dock</h2><p>C asks for clearance, and you need it before you enter the aperture. Follow the director, align with the slot, and fly gently through the mouth. U switches the docking computer. Enter launches, and skips the traversal.</p></section>
			<section data-topic><h2>Work</h2><p>Requests, trade, and opportunities emerge from the state of the system. Take what suits you; none of them are compulsory. In Requests, the up and down arrows walk the cursor and Enter opens the row; the mouse does the same.</p></section>
			${play}`,
	},
	{
		slug: "trust",
		entry: "trust/index.html",
		nav: "Trust",
		eyebrow: "Trust",
		title: "Your flight is yours.",
		dek: "The Far Between is private by default, immediate by design, and intentionally small in what it asks of you.",
		content: `<ul class="promise"><li>No accounts, tracking, analytics, advertising, or runtime network calls.</li><li>Saves live locally in your browser and can be exported as portable data.</li></ul>
			<p>There is no behavioural telemetry. The project learns through direct feedback, opt-in reports where they make sense, and conversation.</p>`,
	},
	{
		slug: "credits",
		entry: "credits/index.html",
		nav: "Credits",
		eyebrow: "Credits",
		title: "Made in the long wake of old space games.",
		dek: "The Far Between is built with care for the people, tools, and games that made a small ship against a large sky feel possible.",
		content: `<p>Created by Jens-Christian Fischer. Built with TypeScript, Vite, Three.js, and WebAudio.</p>
			<p>With gratitude to the classic spaceflight games that taught us a cockpit can be a whole world, and to every pilot who finds a route through the dark.</p>`,
	},
];

export function pageForPath(pathname: string): PublicPage | undefined {
	const normalised = pathname.replace(/^\/+|\/+$/g, "");
	return PUBLIC_PAGES.find((page) => page.slug === normalised);
}

function href(page: PublicPage): string {
	return page.slug === "" ? "/" : `/${page.slug}/`;
}

export function mountPublicSite(slug: string): void {
	const page = PUBLIC_PAGES.find((candidate) => candidate.slug === slug);
	if (!page) throw new Error(`Unknown public page: ${slug}`);
	document.title = `${page.title} — The Far Between`;
	document.body.classList.add("public-site");
	document.body.innerHTML = `<main class="site-shell">
		<header class="site-header"><a class="wordmark" href="/" aria-label="The Far Between home">THE FAR<br />BETWEEN</a>
		<nav aria-label="Public site">${PUBLIC_PAGES.map((candidate) => `<a href="${href(candidate)}"${candidate === page ? ' aria-current="page"' : ""}>${candidate.nav}</a>`).join("")}</nav></header>
		<article class="page page--${page.slug || "home"}"><p class="eyebrow">${page.eyebrow}</p><h1>${page.title}</h1><p class="dek">${page.dek}</p><div class="page-content">${page.content}</div></article>
		<footer><span>THE FAR BETWEEN</span><span>PLAY IN YOUR BROWSER</span><a href="/trust/">Privacy</a></footer>
	</main>`;
	const search = document.querySelector<HTMLInputElement>(
		".manual-search input",
	);
	if (search)
		search.addEventListener("input", () => {
			const needle = search.value.trim().toLocaleLowerCase();
			for (const topic of document.querySelectorAll<HTMLElement>(
				"[data-topic]",
			))
				topic.hidden =
					needle !== "" &&
					!topic.textContent?.toLocaleLowerCase().includes(needle);
		});
}
