/**
 * Node 865. The flown mass in a running game: what the ship carries reaches
 * the handling the frame loop flies.
 *
 * Headless rows own the arithmetic (`tests/flown-mass.test.ts`): the law, the
 * ratio, the stepper dividing by the laden mass, and `flownMassT`'s sum. This
 * owns what only the page can show — that the commander the game holds is the
 * one weighed, that `playerHull.performance` (the struct every flight call in
 * `main.ts` reads) follows a change of cargo inside a session, and that
 * emptying the hold gives the empty ship's handling back exactly.
 *
 * Every figure — the hull's mass and hold, the expected handling — is read off
 * the page's own modules, never restated here. What is typed in is the
 * scenario: a full hold of Food.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin = process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5343";
const headed = process.env.HEADED === "1";
await guardedOrigin(origin);
const browser = await launchChromium({ headless: !headed });
const t = tally();
let passed = 0;
const check = (name, ok, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
	if (!ok) throw new Error(name);
	passed += 1;
};

/** The flown ship as the frame loop sees it, beside what the modules say it
 *  should be for the cargo the commander holds. */
const reading = (page) =>
	page.evaluate(async () => {
		const g = window.__seelite;
		const H = await import("/src/hull.ts");
		const S = await import("/src/sim.ts");
		const id = g.playerHull.id;
		const hullT = H.HULL_SPECS[id].massT;
		const flown = g.playerHull.performance;
		const expected = S.flightPerformance(id, {}, g.playerHull.massT);
		return {
			id,
			hullT,
			holdT: H.HULL_SPECS[id].holdT,
			massT: g.playerHull.massT,
			flownMassT: flown.massT,
			thrustKms2: flown.thrustKms2,
			yawAuthority: flown.angularAuthority.yaw,
			emptyThrustKms2: S.flightPerformance(id).thrustKms2,
			matches: JSON.stringify(flown) === JSON.stringify(expected),
		};
	});

const context = await browser.newContext({
	viewport: { width: 1280, height: 800 },
});
try {
	const page = await context.newPage();
	t.watchShaders(page, "flown-mass");
	page.on("pageerror", (e) => {
		throw e;
	});
	await page.goto(gameUrl(origin, { seed: 2 }), { waitUntil: "load" });
	await bootedGame(page);

	const empty = await reading(page);
	check(
		"a fresh ship weighs its hull and flies the empty handling",
		empty.massT === empty.hullT &&
			empty.flownMassT === empty.hullT &&
			empty.thrustKms2 === empty.emptyThrustKms2 &&
			empty.matches,
		`${empty.id} ${empty.massT} t, ${empty.thrustKms2.toFixed(4)} km/s²`,
	);

	await page.evaluate(async () => {
		const g = window.__seelite;
		const H = await import("/src/hull.ts");
		g.commander = {
			...g.commander,
			cargo: { Food: H.HULL_SPECS[g.playerHull.id].holdT },
		};
	});
	const full = await reading(page);
	const ratio = full.thrustKms2 / empty.thrustKms2;
	const law = full.hullT / (full.hullT + full.holdT);
	check(
		"a full hold weighs hull plus hold, and the frame loop flies that mass",
		full.massT === full.hullT + full.holdT &&
			full.flownMassT === full.massT &&
			full.matches,
		`${full.massT} t`,
	);
	check(
		"the laden ship is slower to accelerate and to turn, by the mass ratio",
		full.thrustKms2 < empty.thrustKms2 &&
			full.yawAuthority < empty.yawAuthority &&
			Math.abs(ratio - law) < 1e-12,
		`thrust ×${ratio.toFixed(4)} against ${law.toFixed(4)}`,
	);

	await page.evaluate(() => {
		const g = window.__seelite;
		g.commander = { ...g.commander, cargo: {} };
	});
	const emptied = await reading(page);
	check(
		"emptying the hold gives the empty handling back, and is not slower",
		emptied.massT === empty.massT &&
			emptied.thrustKms2 === empty.thrustKms2 &&
			emptied.yawAuthority === empty.yawAuthority &&
			emptied.matches,
		`${emptied.thrustKms2.toFixed(4)} km/s²`,
	);
} finally {
	await context.close();
	await browser.close();
}
// `check` throws, so reaching here means every one passed; `watchShaders` is
// what is left to read.
console.log(`\n${passed}/${passed} checks passed`);
if (t.failures) process.exit(1);
