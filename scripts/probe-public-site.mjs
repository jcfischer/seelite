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

await browser.close();
exit();
