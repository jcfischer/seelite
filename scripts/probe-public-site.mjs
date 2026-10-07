import { mkdirSync } from "node:fs";
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";
import { publicUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const PAGES = [
	["", "The Far Between", "Play now"],
	["about", "A frontier with room to breathe.", "Play now"],
	["field-notes", "Occasional signals from the frontier.", "Play now"],
	["manual", "Enough to leave the berth.", "Search this page"],
	["trust", "Your flight is yours.", "No accounts, cookies, or advertising."],
	[
		"credits",
		"Made in the long wake of old space games.",
		"Created by Jens-Christian Fischer.",
	],
];

/** Where the changelog captures go (#573); unset writes none. */
const out = process.env.CHANGELOG_EVIDENCE ?? null;
if (out) mkdirSync(out, { recursive: true });

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

for (const [route, heading, promise] of PAGES) {
	const page = await browser.newPage({
		viewport: { width: 1100, height: 740 },
	});
	watch(page);
	const response = await page.goto(publicUrl(ORIGIN, route), {
		waitUntil: "load",
	});
	await page.waitForSelector("h1");
	const state = await page.evaluate(() => ({
		heading: document.querySelector("h1")?.textContent?.trim(),
		body: document.body.textContent,
		game: "__seelite" in window,
		nav: Array.from(document.querySelectorAll("nav a"), (link) =>
			link.getAttribute("href"),
		),
		play: document
			.querySelector('a[href="/?boot=overlay"]')
			?.getAttribute("href"),
	}));
	check(
		`${route || "home"} is a static public document`,
		response?.status() === 200,
		`status=${response?.status()}`,
	);
	check(
		`${route || "home"} renders its intended heading`,
		state.heading === heading,
		String(state.heading),
	);
	check(
		`${route || "home"} carries its public promise`,
		state.body?.includes(promise) === true,
		promise,
	);
	check(
		`${route || "home"} does not start the game`,
		state.game === false,
		`game=${state.game}`,
	);
	check(
		`${route || "home"} exposes all public destinations`,
		state.nav?.length === PAGES.length,
		JSON.stringify(state.nav),
	);
	if (route === "")
		check(
			"Play now opens the existing game overlay",
			state.play === "/?boot=overlay",
			String(state.play),
		);
	await page.close();
}

/**
 * Whether the last entry is under the pointer once the page has been scrolled
 * the way a player scrolls it. `checkVisibility` passes an entry clipped by an
 * ancestor's overflow, and the home page is the game's document, whose `html`
 * hides its overflow; `scrollIntoView` would scroll an `overflow: hidden` box
 * that a wheel cannot.
 */
function lastEntryUnderPointer() {
	const items = document.querySelectorAll(".changelog li");
	const last = items[items.length - 1];
	if (!last) return false;
	const box = last.getBoundingClientRect();
	const x = box.left + box.width / 2;
	const y = box.top + box.height / 2;
	if (y < 0 || y > window.innerHeight) return false;
	const hit = document.elementFromPoint(x, y);
	return hit !== null && last.contains(hit);
}

/**
 * The changelog (#573): the home threshold shows the latest few, Field Notes
 * shows them all. Every expectation is read off the pages rather than copied
 * from `src/changelog.ts`, so a new entry does not turn this red.
 */
function readChangelog() {
	const items = Array.from(document.querySelectorAll(".changelog li"));
	const play = document.querySelector('a[href="/?boot=overlay"]');
	return {
		entries: items.map((item) => ({
			date: item.querySelector("time")?.getAttribute("datetime") ?? "",
			shown: item.querySelector("time")?.textContent?.trim() ?? "",
			text: item.querySelector(".changelog-text")?.textContent ?? "",
			visible: item.checkVisibility(),
		})),
		more: document
			.querySelector('.changelog-home a[href="/field-notes/"]')
			?.checkVisibility(),
		playBottom: play ? play.getBoundingClientRect().bottom : null,
		viewport: window.innerHeight,
		tracker: document.body.innerHTML.includes("github.com"),
		channels: Array.from(document.querySelectorAll(".channels a"), (link) => ({
			href: link.getAttribute("href"),
			visible: link.checkVisibility(),
		})),
	};
}

for (const [label, viewport] of [
	["desktop", { width: 1100, height: 740 }],
	["phone", { width: 390, height: 844 }],
]) {
	const read = async (route) => {
		const page = await browser.newPage({ viewport });
		watch(page);
		await page.goto(publicUrl(ORIGIN, route), { waitUntil: "load" });
		await page.waitForSelector(".changelog li");
		const state = await page.evaluate(readChangelog);
		// Viewport frames, not `fullPage`: the home document hides its overflow
		// and scrolls its body, so a full-page capture paints black below the
		// first screen. One frame at the top, one after a player's scroll.
		const name = `${out}/${route || "home"}-${label}`;
		if (out) await page.screenshot({ path: `${name}-top.png` });
		await page.mouse.move(viewport.width / 2, viewport.height / 2);
		// Wheel until the page stops moving, not a fixed distance: six turns
		// of 600 px stopped short of Field Notes on a phone once the list
		// passed 3600 px of scroll (4336 px at 30 entries), which is the
		// red a new entry must not cause. The cap only bounds a page that
		// never settles.
		const scrolled = () =>
			page.evaluate(
				() =>
					(document.scrollingElement?.scrollTop ?? 0) + document.body.scrollTop,
			);
		for (let i = 0, last = -1; i < 40; i++) {
			await page.mouse.wheel(0, 600);
			await page.waitForTimeout(150);
			const now = await scrolled();
			if (now === last) break;
			last = now;
		}
		state.lastReachable = await page.evaluate(lastEntryUnderPointer);
		if (out) await page.screenshot({ path: `${name}-end.png` });
		await page.close();
		return state;
	};
	const home = await read("");
	const notes = await read("field-notes");
	check(
		`home shows between one and three changes (${label})`,
		home.entries.length >= 1 && home.entries.length <= 3,
		`count=${home.entries.length}`,
	);
	for (const [name, state] of [
		["home", home],
		["field-notes", notes],
	]) {
		check(
			`${name} shows every change it lists, dated (${label})`,
			state.entries.every(
				(entry) =>
					entry.visible &&
					/^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
					/^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(entry.shown) &&
					entry.text.length > 0,
			),
			JSON.stringify(state.entries),
		);
		check(
			`${name}'s last change can be scrolled to (${label})`,
			state.lastReachable === true,
			String(state.lastReachable),
		);
	}
	check(
		`home links to the full list on Field Notes (${label})`,
		home.more === true,
		String(home.more),
	);
	check(
		`Field Notes carries the home entries first, then the rest (${label})`,
		notes.entries.length >= home.entries.length &&
			home.entries.every(
				(entry, i) =>
					entry.date === notes.entries[i]?.date &&
					entry.text === notes.entries[i]?.text,
			),
		`home=${home.entries.length} notes=${notes.entries.length}`,
	);
	check(
		`Play now stays above the fold on the threshold (${label})`,
		home.playBottom !== null && home.playBottom <= home.viewport,
		`bottom=${home.playBottom} viewport=${home.viewport}`,
	);
	check(
		`home shows its YouTube and Discord links (${label})`,
		home.channels.length === 2 &&
			home.channels.every(
				(link) =>
					link.visible &&
					/^https:\/\/(www\.youtube\.com|discord\.gg)\//.test(link.href),
			),
		JSON.stringify(home.channels),
	);
	check(
		`no page links a player to the private tracker (${label})`,
		!home.tracker && !notes.tracker,
		`home=${home.tracker} notes=${notes.tracker}`,
	);
}

/**
 * The home trailer (2026-10-03) is click-to-play: the page draws its own
 * poster and asks YouTube for nothing until the poster is pressed. So the
 * page is read twice — after load, when no request may have left its origin,
 * and after the press, when the player's frame must be YouTube's no-cookie
 * embed. YouTube's hosts are answered here with an empty page, so the probe
 * needs no network and a press is still a request the page made.
 */
const YOUTUBE =
	/^https:\/\/([a-z0-9-]+\.)*(youtube-nocookie\.com|youtube\.com|ytimg\.com|googlevideo\.com|google\.com|gstatic\.com|doubleclick\.net)\//;
for (const [label, viewport] of [
	["desktop", { width: 1100, height: 740 }],
	["phone", { width: 390, height: 844 }],
]) {
	const page = await browser.newPage({ viewport });
	watch(page);
	const requests = [];
	page.on("request", (request) => requests.push(request.url()));
	await page.route(YOUTUBE, (route) =>
		route.fulfill({
			status: 200,
			contentType: "text/html",
			body: "<!doctype html><title>stub</title>",
		}),
	);
	await page.goto(publicUrl(ORIGIN, ""), { waitUntil: "load" });
	await page.waitForSelector(".trailer-play");
	await page.waitForTimeout(500);
	const origin = new URL(page.url()).origin;
	const foreign = () =>
		requests.filter(
			(url) => /^https?:/.test(url) && new URL(url).origin !== origin,
		);
	const before = await page.evaluate(() => {
		const box = (selector) =>
			document.querySelector(selector)?.getBoundingClientRect().toJSON() ??
			null;
		return {
			frames: document.querySelectorAll("iframe").length,
			poster: box(".trailer-play"),
			title: box("h1"),
			play: box('a[href="/?boot=overlay"]'),
		};
	});
	const foreignBefore = foreign();
	check(
		`the home page asks nothing of another origin before the trailer is pressed (${label})`,
		foreignBefore.length === 0 && before.frames === 0,
		`frames=${before.frames} ${JSON.stringify(foreignBefore)}`,
	);
	if (label === "desktop")
		check(
			"the trailer stands to the right of the title (desktop)",
			before.poster !== null &&
				before.title !== null &&
				before.poster.left >= before.title.right &&
				before.poster.top < before.title.bottom &&
				before.poster.bottom > before.title.top,
			`poster=${JSON.stringify(before.poster)} title=${JSON.stringify(before.title)}`,
		);
	else
		check(
			"the trailer follows Play now (phone)",
			before.poster !== null &&
				before.play !== null &&
				before.poster.top >= before.play.bottom,
			`poster=${before.poster?.top} play=${before.play?.bottom}`,
		);
	if (out)
		await page.screenshot({ path: `${out}/home-trailer-${label}-before.png` });
	await page.click(".trailer-play");
	await page.waitForSelector(".trailer iframe");
	const after = await page.evaluate(() => {
		const frame = document.querySelector(".trailer iframe");
		return {
			src: frame?.getAttribute("src") ?? null,
			poster: document.querySelectorAll(".trailer-play").length,
			focused: document.activeElement === frame,
		};
	});
	check(
		`pressing the poster swaps it for YouTube's no-cookie player (${label})`,
		after.poster === 0 &&
			after.focused &&
			after.src?.startsWith(
				"https://www.youtube-nocookie.com/embed/cExmJYQ-cwQ",
			) === true &&
			foreign().some((url) =>
				url.startsWith("https://www.youtube-nocookie.com/"),
			),
		JSON.stringify(after),
	);
	if (out)
		await page.screenshot({ path: `${out}/home-trailer-${label}-after.png` });
	await page.close();
}

await browser.close();
exit();
