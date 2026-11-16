// Refinery submit and saved queue probe: https://github.com/jcfischer/seelite/issues/1195
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
const shots = process.env.REFINERY_EVIDENCE ?? "/tmp/seelite-1195-refinery";
await mkdir(shots, { recursive: true });
try {
	const page = await browser.newPage({
		viewport: { width: 1600, height: 1000 },
	});
	watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	const url = gameUrl(origin, {
		seed: 1,
		raider: "off",
		"models-full": true,
	});
	await page.goto(url);
	await bootedGame(page, 180000);
	check(
		"a player boot has a real writable save store",
		await page.evaluate(() => window.__seelite.saveStore !== null),
	);
	const setup = await page.evaluate(async () => {
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
		const good = "Silicate ore STD";
		setCommanderFixture(g, { credits: 50000, cargo: { [good]: 6 } });
		g.setHeadLook("forward");
		g.stationConsoleTab = "Refinery";
		g.stationConsoleRevision++;
		g.updateCockpit();
		return {
			stationKey: g.stationKey(station),
			galaxy: record.galaxy,
			good,
			at,
		};
	});
	await page.waitForFunction(
		() => document.querySelector("[data-live-station-console]") !== null,
		undefined,
		{ timeout: 60000 },
	);
	const tabs = await page.locator("[data-live-station-tab]").allInnerTexts();
	check(
		"the Refinery tab appears at a refinery",
		tabs.includes("Refinery"),
		JSON.stringify(tabs),
	);
	await page.locator('[data-live-station-tab="Refinery"]').click();
	await page.locator("[data-live-refinery-tonnes]").fill("2");
	await page.locator('[data-live-refinery-action="quote"]').click();
	const quote = await page.evaluate(() => ({
		fee: document.querySelector("[data-live-refinery-fee]")?.textContent ?? "",
		output:
			document.querySelector("[data-live-refinery-quote] strong")
				?.textContent ?? "",
		cargo: { ...window.__seelite.commander.cargo },
	}));
	check(
		"the quote names the output and a credit fee",
		quote.fee.includes("Cr") &&
			quote.output.includes("Minerals") &&
			quote.cargo["Silicate ore STD"] === 6,
		JSON.stringify(quote),
	);
	await page.screenshot({ path: `${shots}/quote.png` });
	await page.locator("[data-live-refinery-tonnes]").fill("3");
	await page.locator('[data-live-refinery-action="submit"]').click();
	await page.waitForFunction(
		() =>
			document
				.querySelector("[data-live-refinery-notice]")
				?.textContent?.includes("quote changed") ?? false,
		undefined,
		{ timeout: 15000 },
	);
	const stale = await page.evaluate(() => ({
		cargo: { ...window.__seelite.commander.cargo },
		quote: document.querySelector("[data-live-refinery-quote]") !== null,
	}));
	check(
		"a changed quantity is refused until the quote is reviewed again",
		stale.cargo["Silicate ore STD"] === 6 && !stale.quote,
		JSON.stringify(stale),
	);
	await page.locator("[data-live-refinery-tonnes]").fill("2");
	await page.locator('[data-live-refinery-action="quote"]').click();
	await page.locator('[data-live-refinery-action="submit"]').click();
	await page.waitForFunction(
		(setup) => {
			const g = window.__seelite;
			const queue =
				g.commerceWorld.galaxies[setup.galaxy].refineries[setup.stationKey];
			return (queue?.jobs.length ?? 0) === 1 && g.refinerySaving === false;
		},
		setup,
		{ timeout: 30000 },
	);
	await page.evaluate(async () => {
		const g = window.__seelite;
		await g.saveStore.settled();
	});
	const submitted = await page.evaluate((setup) => {
		const g = window.__seelite;
		const queue =
			g.commerceWorld.galaxies[setup.galaxy].refineries[setup.stationKey];
		return {
			cargo: { ...g.commander.cargo },
			credits: g.commander.credits,
			jobs: queue.jobs.map((job) => ({ ...job })),
			view: g.refineryView,
			saving: g.refinerySaving,
			notice:
				document.querySelector("[data-live-refinery-notice]")?.textContent ??
				"",
		};
	}, setup);
	check(
		"submitting debits the ore and queues one job only after the save lands",
		submitted.cargo["Silicate ore STD"] === 4 &&
			submitted.jobs.length === 1 &&
			submitted.jobs[0].tonnes === 2 &&
			submitted.notice.includes("Submission saved"),
		JSON.stringify(submitted),
	);
	const durable = await page.evaluate(async (setup) => {
		const g = window.__seelite;
		const live = await g.save.backend.read(g.save.defaultSlot, "live");
		const dock = await g.save.backend.read(g.save.defaultSlot, "lastDocked");
		const jobs = (record) =>
			record?.world?.galaxies?.[setup.galaxy]?.refineries?.[setup.stationKey]
				?.jobs ?? [];
		return {
			live: jobs(live).length,
			dock: jobs(dock).length,
			liveCargo: live?.commander?.state?.cargo?.[setup.good],
			dockCargo: dock?.commander?.state?.cargo?.[setup.good],
		};
	}, setup);
	check(
		"the dock checkpoint carries the job and the paid ore",
		durable.live === 1 &&
			durable.dock === 1 &&
			durable.liveCargo === 4 &&
			durable.dockCargo === 4,
		JSON.stringify(durable),
	);
	const progress = await page.evaluate(async (setup) => {
		const W = await import("/src/world-state.ts");
		const g = window.__seelite;
		const queue =
			g.commerceWorld.galaxies[setup.galaxy].refineries[setup.stationKey];
		const before = queue.jobs[0].work;
		const from = g.commerceWorld.gameTime;
		g.world.gameTime = from + 20;
		g.commerceWorld = W.advanceTo(g.commerceWorld, g.world.gameTime);
		const after =
			g.commerceWorld.galaxies[setup.galaxy].refineries[setup.stationKey]
				.jobs[0].work;
		const operational = W.operationalDuration(
			g.commerceWorld,
			setup.galaxy,
			(await import("/src/capability-slots.ts"))
				.capabilitySlots(
					g.world.system.record.index,
					g.world.system.contents.stations.find((s) => s.type === "refinery"),
				)
				.find((s) => s.service === "exclusive").key,
			from,
			g.world.gameTime,
		);
		g.updateCockpit();
		return { before, after, operational };
	}, setup);
	check(
		"only operational game time advances the listed job",
		progress.before - progress.after ===
			Math.min(progress.before, progress.operational),
		JSON.stringify(progress),
	);
	await page.screenshot({ path: `${shots}/jobs.png` });
	await page.evaluate(async () => {
		const g = window.__seelite;
		g.saveFlush("quit");
		await g.saveStore.settled();
	});
	await page.goto(url);
	await bootedGame(page, 180000);
	const reloadedState = await page.evaluate(async (setup) => {
		const g = window.__seelite;
		g.setHeadLook("forward");
		g.stationConsoleTab = "Refinery";
		g.refineryView = "jobs";
		g.stationConsoleRevision++;
		g.updateCockpit();
		return {
			queue:
				g.commerceWorld.galaxies[setup.galaxy].refineries[setup.stationKey]
					?.jobs.length ?? 0,
			docked: g.dock.phase,
		};
	}, setup);
	await page.locator('[data-live-station-tab="Refinery"]').click();
	await page.locator('[data-live-refinery-action="view-jobs"]').click();
	await page
		.locator("[data-live-refinery-job]")
		.first()
		.waitFor({ timeout: 15000 });
	const reloaded = {
		...reloadedState,
		jobRows: await page.locator("[data-live-refinery-job]").allInnerTexts(),
	};
	check(
		"a reload restores the docked refinery tab and its saved queue",
		reloaded.jobRows.length === 1 &&
			reloaded.queue === 1 &&
			reloaded.jobRows[0].includes("Silicate ore STD") &&
			reloaded.docked === "docked",
		JSON.stringify(reloaded),
	);
	await page.screenshot({ path: `${shots}/reloaded.png` });
	await page.goto(
		gameUrl(origin, { seed: 1, raider: "off", "models-full": true }),
	);
	await bootedGame(page, 180000);
	const plain = await page.evaluate(() => {
		const g = window.__seelite;
		g.setHeadLook("forward");
		g.stationConsoleRevision++;
		g.updateCockpit();
		return {
			station: g.dockedStationContext()?.station.type ?? null,
			tabs: [...document.querySelectorAll("[data-live-station-tab]")].map(
				(tab) => tab.textContent,
			),
			refinery: g.stationConsoleState()?.refinery ?? null,
		};
	});
	check(
		"the docked console offers its Refinery tab only where the station is a refinery",
		plain.station === "refinery"
			? plain.tabs.includes("Refinery") && plain.refinery !== null
			: !plain.tabs.includes("Refinery") && plain.refinery === null,
		JSON.stringify(plain),
	);
} finally {
	await browser.close();
}
exit();
