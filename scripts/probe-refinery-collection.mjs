// Refinery collection probe: https://github.com/jcfischer/seelite/issues/1196
import { mkdir } from "node:fs/promises";
import { gameUrl } from "./lib/game-url.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const shots = process.env.REFINERY_EVIDENCE ?? "/tmp/seelite-1196-collection";
await mkdir(shots, { recursive: true });
const ORE = "Metallic ore STD";
try {
	const page = await browser.newPage({
		viewport: { width: 1600, height: 1000 },
	});
	watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	const url = gameUrl(origin, {
		seed: 1,
		mining: "1",
		raider: "off",
		"models-full": true,
	});
	await page.goto(url);
	await bootedGame(page, 180000);
	const setup = await page.evaluate(async (ore) => {
		const W = await import("/src/world-state.ts");
		const C = await import("/src/capability-slots.ts");
		const { setCommanderFixture } = await import(
			"/scripts/lib/commander-fixture.ts"
		);
		const g = window.__seelite;
		g.clockHeld = true;
		const record = g.world.system.record;
		const station = g.world.system.contents.stations.find(
			(s) => s.type === "refinery",
		);
		if (!station) throw new Error("the start system has no refinery");
		await window.__parkInBerth(station.id, g.berthIdsOfStation(station.id)[0], {
			headLook: "right",
		});
		const exclusive = C.capabilitySlots(record.index, station).find(
			(s) => s.service === "exclusive",
		).key;
		let at = g.world.gameTime;
		for (
			let attempt = 0;
			attempt < 10000 &&
			!W.capabilityAvailability(g.commerceWorld, record.galaxy, exclusive, at)
				.operational;
			attempt++
		)
			at += 100;
		g.world.gameTime = at;
		g.commerceWorld = W.advanceTo(g.commerceWorld, at);
		setCommanderFixture(g, { credits: 50000, cargo: { [ore]: 8 } });
		g.setHeadLook("forward");
		g.stationConsoleTab = "Refinery";
		g.stationConsoleRevision++;
		g.updateCockpit();
		return {
			stationKey: g.stationKey(station),
			galaxy: record.galaxy,
		};
	}, ORE);
	await page.waitForFunction(
		() => document.querySelector("[data-live-station-console]") !== null,
		undefined,
		{ timeout: 60000 },
	);
	await page.locator('[data-live-station-tab="Refinery"]').click();
	await page.locator("[data-live-refinery-tonnes]").fill("8");
	await page.locator('[data-live-refinery-action="quote"]').click();
	await page.locator('[data-live-refinery-action="submit"]').click();
	await page.waitForFunction(
		(s) =>
			(window.__seelite.commerceWorld.galaxies[s.galaxy].refineries[
				s.stationKey
			]?.jobs.length ?? 0) === 1 && window.__seelite.refinerySaving === false,
		setup,
		{ timeout: 30000 },
	);
	const advanced = await page.evaluate(async (s) => {
		const W = await import("/src/world-state.ts");
		const g = window.__seelite;
		g.world.gameTime += 100000;
		g.commerceWorld = W.advanceTo(g.commerceWorld, g.world.gameTime);
		const job =
			g.commerceWorld.galaxies[s.galaxy].refineries[s.stationKey].jobs[0];
		return { work: job.work, output: job.outputGrams };
	}, setup);
	check(
		"an advanced clock finishes the 8 t job at 3.2 t of Alloys",
		advanced.work <= 0 && advanced.output === 3200000,
		JSON.stringify(advanced),
	);
	await page.evaluate(async () => {
		const P = await import("/src/commodity-pools.ts");
		const { money } = await import("/src/exact-amount.ts");
		const g = window.__seelite;
		const capacity = (await import("/src/station-commerce.ts")).commanderHold(
			g.commander,
			0,
		).capacityT;
		const filler = Math.max(0, capacity - 2 - (g.commander.cargo.Food ?? 0));
		g.commander = P.withAccount(
			g.commander,
			P.acquire(P.accountOf(g.commander), "Food", filler, money.fromNumber(0)),
		);
		g.refineryView = "jobs";
		g.stationConsoleRevision++;
		g.updateCockpit();
	});
	await page.locator('[data-live-refinery-action="view-jobs"]').click();
	await page
		.locator('[data-live-refinery-collectable="Alloys"]')
		.waitFor({ timeout: 15000 });
	await page.screenshot({ path: `${shots}/before.png` });
	await page.locator('[data-live-refinery-collect="Alloys"]').click();
	await page.waitForFunction(() => window.__seelite.refinerySaving === false, {
		timeout: 30000,
	});
	await page.evaluate(() => window.__seelite.saveStore.settled());
	const partial = await page.evaluate((s) => {
		const g = window.__seelite;
		const job =
			g.commerceWorld.galaxies[s.galaxy].refineries[s.stationKey].jobs[0];
		return {
			alloys: g.commander.cargo.Alloys,
			left: job.outputGrams - (job.taken ?? 0),
			notice:
				document.querySelector("[data-live-refinery-notice]")?.textContent ??
				"",
		};
	}, setup);
	check(
		"a short hold takes 2 t and leaves 1.2 t in custody",
		partial.alloys === 2 && partial.left === 1200000,
		JSON.stringify(partial),
	);
	await page.screenshot({ path: `${shots}/partial.png` });
	await page.evaluate(async () => {
		const g = window.__seelite;
		g.saveFlush("quit");
		await g.saveStore.settled();
	});
	await page.goto(url);
	await bootedGame(page, 180000);
	await page.evaluate(async () => {
		const P = await import("/src/commodity-pools.ts");
		const g = window.__seelite;
		const food = g.commander.cargo.Food ?? 0;
		g.commander = P.withAccount(
			g.commander,
			P.remove(P.accountOf(g.commander), "Food", food).account,
		);
		g.setHeadLook("forward");
		g.stationConsoleTab = "Refinery";
		g.refineryView = "jobs";
		g.stationConsoleRevision++;
		g.updateCockpit();
	});
	await page.locator('[data-live-station-tab="Refinery"]').click();
	await page.locator('[data-live-refinery-action="view-jobs"]').click();
	await page
		.locator('[data-live-refinery-collect="Alloys"]')
		.waitFor({ timeout: 15000 });
	await page.locator('[data-live-refinery-collect="Alloys"]').click();
	await page.waitForFunction(() => window.__seelite.refinerySaving === false, {
		timeout: 30000,
	});
	await page.evaluate(() => window.__seelite.saveStore.settled());
	const rest = await page.evaluate((s) => {
		const g = window.__seelite;
		const queue = g.commerceWorld.galaxies[s.galaxy].refineries[s.stationKey];
		return {
			alloys: g.commander.cargo.Alloys,
			jobs: queue.jobs.length,
			pool: queue.pool ?? null,
		};
	}, setup);
	check(
		"after a reload 1 t more is collected, the 0.2 t fraction is pooled and the slot is freed",
		rest.alloys === 3 && rest.jobs === 0 && rest.pool?.Alloys?.grams === 200000,
		JSON.stringify(rest),
	);
	await page.locator('[data-live-station-tab="Market"]').click();
	const sold = await page.evaluate(async () => {
		const g = window.__seelite;
		const before = g.commander.credits;
		document
			.querySelector(
				'[data-live-market-row="Alloys"] [data-live-station-action="sell-commodity"]',
			)
			?.click();
		await new Promise((r) => setTimeout(r, 500));
		return {
			before,
			after: g.commander.credits,
			alloys: g.commander.cargo.Alloys ?? 0,
		};
	});
	check(
		"the collected Alloys sell at the refinery's market",
		sold.after > sold.before && sold.alloys < 3,
		JSON.stringify(sold),
	);
	await page.screenshot({ path: `${shots}/sold.png` });
} finally {
	await browser.close();
}
exit();
