import { CHANGELOG, HOME_CHANGELOG_COUNT, changelogList } from "./changelog";

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

/**
 * The home trailer's player, built only when the poster is pressed. The page
 * draws its own poster, so nothing loads from YouTube until the player asks:
 * the principal's click-to-play ruling of 2026-10-03, and the Trust page names
 * it. A thumbnail from YouTube would be a request on load, which is the thing
 * the poster exists to avoid.
 */
const TRAILER_EMBED =
	"https://www.youtube-nocookie.com/embed/cExmJYQ-cwQ?autoplay=1&rel=0";

const trailer = `<figure class="trailer"><button type="button" class="trailer-play" aria-label="Play the trailer. This loads YouTube’s player."><span class="trailer-glyph" aria-hidden="true">▶</span><span class="trailer-label">Play the trailer</span><span class="trailer-note">Loads YouTube’s player</span></button></figure>`;

export const PUBLIC_PAGES: readonly PublicPage[] = [
	{
		slug: "",
		entry: "index.html",
		nav: "Home",
		eyebrow: "A browser spaceflight game",
		title: "The Far Between",
		dek: "A little ship. A large sky. Work worth doing between the two.",
		content: `<div class="threshold-actions">${play}<a class="button button--quiet" href="/about/">Find your bearings</a></div>
			<p class="threshold-note">No accounts. No cookies. No advertising.</p>
			<div class="instrument" aria-label="A quiet frontier transmission"><span>SECTOR: UNCHARTED</span><span>LOCAL: 03:17</span><span>SIGNAL: FAINT</span></div>
			<div class="channels"><a href="https://www.youtube.com/@the-far-between" rel="noreferrer">Watch on YouTube <span aria-hidden="true">→</span></a><a href="https://discord.gg/qRVgSqMkh8" rel="noreferrer">Join the Discord <span aria-hidden="true">→</span></a></div>
			${trailer}
			<section class="changelog-home" aria-labelledby="changelog-home"><h2 id="changelog-home">Recent changes</h2>${changelogList(CHANGELOG.slice(0, HOME_CHANGELOG_COUNT))}<a class="changelog-more" href="/field-notes/">All changes <span aria-hidden="true">→</span></a></section>`,
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
		content: `<h2>Changes</h2>
			${changelogList(CHANGELOG)}
			${play}`,
	},
	{
		// **Every key this page prints goes in `<kbd data-command="…">`.** The
		// attribute is the only thing tying the manual to `controls-catalogue.ts`,
		// and `tests/public-site.test.ts` derives from it: a key left loose in the
		// prose turns that file red, and a key marked for a command that does not
		// bind it turns it red too.
		slug: "manual",
		entry: "manual/index.html",
		nav: "Manual",
		eyebrow: "Manual",
		title: "Enough to leave the berth.",
		dek: "A short reference for the moments when you want an answer without leaving the game behind.",
		content: `<label class="manual-search">Search this page <input type="search" placeholder="Try “dock” or “cruise”" autocomplete="off" /></label>
			<p class="manual-note">Every key below is the one this game ships with. Keys are remappable, and the Controls tab in the cockpit shows the ones you fly with.</p>
			<section data-topic><h2>Fly</h2><p>Pitch is <kbd data-command="fly.pitchDown">W</kbd> and <kbd data-command="fly.pitchUp">S</kbd>, yaw is <kbd data-command="fly.yawPort">A</kbd> and <kbd data-command="fly.yawStarboard">D</kbd>, roll is <kbd data-command="fly.rollPort">Q</kbd> and <kbd data-command="fly.rollStarboard">E</kbd>. The arrows strafe: <kbd data-command="fly.strafePort">←</kbd> and <kbd data-command="fly.strafeStarboard">→</kbd> slide the ship sideways, <kbd data-command="fly.strafeDorsal">↑</kbd> and <kbd data-command="fly.strafeVentral">↓</kbd> lift and drop it. With flight assist on, <kbd data-command="fly.throttleUp">Shift</kbd> and <kbd data-command="fly.throttleDown">Ctrl</kbd> move the throttle; with it off, they fire the main drive and the retro thrusters while you hold them. <kbd data-command="fly.assist">X</kbd> switches flight assist on a press, and keeps a combat-speed ceiling while it is on; switch it off when you want to drift. Held, <kbd data-command="fight.fireBeam">X</kbd> fires the beam. The green cue marks where you are going, not only where the ship points.</p><p>If you fly pitch and yaw on the mouse, Settings offers a second keyboard layout, Mouse flight. It puts forward, back, sideways, up and down under the left hand, so you can thrust on all three at once. The Controls tab then lists its keys. On Windows and Linux, Chrome closes the tab on one of its key combinations, and the Settings row says which.</p></section>
			<section data-topic><h2>Panels and controls</h2><p>Press <kbd data-command="view.reference">?</kbd> to open the Controls tab and see the complete, remappable control reference. <kbd data-command="view.headPort">1</kbd> opens the left panel, <kbd data-command="view.headForward">2</kbd> faces the forward panel, and <kbd data-command="view.headStarboard">3</kbd> opens the right panel. Press the same key again to return your view to flight. <kbd data-command="system.postcard">6</kbd> opens the Postcard screen: save the view as an image, or copy a link that rebuilds it for someone else.</p></section>
			<section data-topic><h2>Travel</h2><p><kbd data-command="fight.targetNext">T</kbd> and <kbd data-command="fight.targetPrevious">G</kbd> step through targets, <kbd data-command="fight.faceTarget">F</kbd> faces the one you selected, and <kbd data-command="fly.cruise">J</kbd> engages or drops cruise. <kbd data-command="fly.jump">&#96;</kbd> winds up the jump to another system. Cruise is for distance; ordinary flight is for arriving, fighting, and docking.</p></section>
			<section data-topic><h2>Dock</h2><p><kbd data-command="dock.clearance">C</kbd> asks for clearance, and you need it before you enter the aperture. Follow the director, align with the aperture, and fly gently through the mouth. <kbd data-command="dock.computer">U</kbd> turns the docking computer on and off. <kbd data-command="dock.launch">Enter</kbd> launches you from a berth, and while an arrival or a departure is running it skips the rest of it.</p></section>
			<section data-topic><h2>Work</h2><p>Requests, trade, and opportunities emerge from the state of the system. Take what suits you; none of them are compulsory. In Requests, <kbd data-command="panel.cursorUp">↑</kbd> and <kbd data-command="panel.cursorDown">↓</kbd> walk the cursor and <kbd data-command="panel.activate">Enter</kbd> opens the row; the mouse does the same.</p></section>
			${play}`,
	},
	{
		slug: "trust",
		entry: "trust/index.html",
		nav: "Trust",
		eyebrow: "Trust",
		title: "Your flight is yours.",
		dek: "The Far Between is private by default, immediate by design, and intentionally small in what it asks of you.",
		content: `<ul class="promise"><li>No accounts, cookies, or advertising.</li><li>Each page load and each game launch is counted once, by a self-hosted Counterscale counter. Like any web request, it arrives with your IP address and browser headers. The counter records the page’s path, the site you came from, your browser, device type and country — not your IP address. Nothing the game does after launch leaves your machine, with one exception you choose: the natural voice. To show you its size, the game reads a short list of its files from this site; if you take it, your browser downloads it from this site and keeps it (a private window keeps nothing, so there it is downloaded at each start), and on each start reads that list again: when the game ships a new version of the voice, that version is downloaded in its place. Every line it speaks is made in your browser.</li><li>The trailer on the home page is a picture this site draws until you press it. Pressing it loads YouTube’s player from youtube-nocookie.com, and from then on YouTube’s privacy policy applies to that player.</li><li>Saves live locally in your browser and can be exported as portable data.</li></ul>
			<p>There is no behavioural telemetry. The project learns through direct feedback and conversation.</p>`,
	},
	{
		slug: "credits",
		entry: "credits/index.html",
		nav: "Credits",
		eyebrow: "Credits",
		title: "Made in the long wake of old space games.",
		dek: "The Far Between is built with care for the people, tools, and games that made a small ship against a large sky feel possible.",
		content: `<p>Created by Jens-Christian Fischer. Built with TypeScript, Vite, Three.js, and WebAudio.</p>
			<p>The natural voice is Kokoro-82M by hexgrad, under the Apache License 2.0, run in your browser by Microsoft’s onnxruntime-web, under the MIT License; both licences ship with the voice. Its pronunciations were prepared with eSpeak NG.</p>
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

/** A page the site shell carries that is not one of `PUBLIC_PAGES`. */
export type PublicNotice = Pick<
	PublicPage,
	"eyebrow" | "title" | "dek" | "content"
> & { modifier: string };

function mountShell(page: PublicNotice, current: PublicPage | null): void {
	document.title = `${page.title} — The Far Between`;
	document.body.classList.add("public-site");
	document.body.innerHTML = `<main class="site-shell">
		<header class="site-header"><a class="wordmark" href="/" aria-label="The Far Between home">THE FAR<br />BETWEEN</a>
		<nav aria-label="Public site">${PUBLIC_PAGES.map((candidate) => `<a href="${href(candidate)}"${candidate === current ? ' aria-current="page"' : ""}>${candidate.nav}</a>`).join("")}</nav></header>
		<article class="page page--${page.modifier}"><p class="eyebrow">${page.eyebrow}</p><h1>${page.title}</h1><p class="dek">${page.dek}</p><div class="page-content">${page.content}</div></article>
		<footer><span>THE FAR BETWEEN</span><span>PLAY IN YOUR BROWSER</span><a href="/trust/">Privacy</a></footer>
	</main>`;
}

/**
 * A notice in the site's own shell: a refused postcard link (#406) is the one
 * today. It stands on the root URL, so it highlights no page in the nav.
 */
export function mountPublicNotice(notice: PublicNotice): void {
	mountShell(notice, null);
}

/** The play link the site's pages carry, for a notice that offers one. */
export const PLAY_LINK = play;

export function mountPublicSite(slug: string): void {
	const page = PUBLIC_PAGES.find((candidate) => candidate.slug === slug);
	if (!page) throw new Error(`Unknown public page: ${slug}`);
	mountShell({ ...page, modifier: page.slug || "home" }, page);
	const poster = document.querySelector<HTMLButtonElement>(".trailer-play");
	if (poster)
		poster.addEventListener(
			"click",
			() => {
				const frame = document.createElement("iframe");
				frame.src = TRAILER_EMBED;
				frame.title = "The Far Between — trailer";
				frame.allow =
					"autoplay; encrypted-media; picture-in-picture; fullscreen";
				frame.allowFullscreen = true;
				poster.replaceWith(frame);
				frame.focus();
			},
			{ once: true },
		);
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
