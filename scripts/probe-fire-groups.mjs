// Drives the bound cycle while holding the trigger; reads the row actually painted.
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { stopLoop } from "./lib/view-placement.mjs";
const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
for (const width of [900, 390]) {
	const page = await browser.newPage({ viewport: { width, height: 780 } });
	watch(page);
	await page.goto(gameUrl(origin, { seed: 42 }));
	await bootedGame(page);
	await stopLoop(page);
	await page.evaluate(async () => {
		const g = window.__seelite;
		const { makeModule, stockLoadout } = await import("/src/loadout.ts");
		g.commander = {
			...g.commander,
			hull: "patrol",
			loadout: {
				...stockLoadout("patrol"),
				h2: makeModule("military-laser", 1),
				u1: makeModule("identity-scanner", 1),
			},
		};
		g.armedFireGroup.reset();
		g.floorFit = null;
		g.render(0);
	});
	const first = await page.evaluate(() => window.__seelite.floorRender);
	check(
		`${width}: all lasers named on glass`,
		first.duelRow.at(-1).value === "ALL LASERS · 1/4",
		JSON.stringify(first.duelRow),
	);
	await page.keyboard.down(" ");
	const shot = await page.evaluate(() => {
		const g = window.__seelite;
		g.step(0.05);
		return g.condition.heat;
	});
	check(`${width}: laser group fires`, shot > 0, shot);
	for (let i = 0; i < 3; i++) await page.keyboard.press("b");
	const scanner = await page.evaluate(() => {
		const g = window.__seelite;
		const before = g.condition.heat;
		g.step(0.05);
		g.render(0);
		return { before, heat: g.condition.heat, row: g.floorRender.duelRow };
	});
	check(
		`${width}: held trigger switches immediately to silent scanner`,
		scanner.heat < scanner.before &&
			scanner.row.at(-1).value === "IDENTITY SCANNER · 4/4",
		JSON.stringify(scanner),
	);
	await page.keyboard.up(" ");
	// Measure the longest group together with combat detail at this viewport.
	const fit = await page.evaluate(() => {
		const g = window.__seelite;
		g.cycleFireGroup();
		g.cycleFireGroup();
		g.cycleFireGroup();
		g.duelRowShown = () => true;
		g.render(0);
		return g.floorRender;
	});
	check(
		`${width}: longest label and combat readings fit`,
		fit.overflowPx === 0 &&
			fit.duelBox.x >= fit.marginPx &&
			fit.duelBox.x + fit.duelBox.width <= width - fit.marginPx,
		JSON.stringify({
			row: fit.duelRow,
			box: fit.duelBox,
			overflow: fit.overflowPx,
		}),
	);
	await page.screenshot({ path: `/tmp/seelite-893-${width}.png` });
	await page.close();
}
await browser.close();
exit();
