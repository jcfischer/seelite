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
			text: item.querySelector(".changelog-text")?.textContent ?? "",
			visible: item.checkVisibility(),
		})),
		more: document
			.querySelector('.changelog-home a[href="/field-notes/"]')
			?.checkVisibility(),
		playBottom: play ? play.getBoundingClientRect().bottom : null,
		viewport: window.innerHeight,
		tracker: document.body.innerHTML.includes("github.com"),
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
		for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 600);
		await page.waitForTimeout(300);
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
	])
		check(
			`${name} shows every change it lists, dated (${label})`,
			state.entries.every(
				(entry) =>
					entry.visible &&
					/^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
					entry.text.length > 0,
			),
			JSON.stringify(state.entries),
		);
	for (const [name, state] of [
		["home", home],
		["field-notes", notes],
	])
		check(
			`${name}'s last change can be scrolled to (${label})`,
			state.lastReachable === true,
			String(state.lastReachable),
		);
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
		`no page links a player to the private tracker (${label})`,
		!home.tracker && !notes.tracker,
		`home=${home.tracker} notes=${notes.tracker}`,
	);
}

await browser.close();
exit();
