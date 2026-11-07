import { mkdirSync } from "node:fs";
import { gameUrl } from "./lib/game-url.mjs";
import { placeCapabilityOutage } from "./lib/capability-outage-fixture.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const out = process.env.CAPABILITY_EVIDENCE ?? "/tmp/seelite-capability-1194";
mkdirSync(out, { recursive: true });
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(
		gameUrl(origin, {
			seed: 47,
			system: 2,
			mining: 1,

			"models-full": true,
		}),
	);
	await bootedGame(page, 180000);
	const fixture = await placeCapabilityOutage(page);
	check(
		"actual generated market is naturally disabled",
		!fixture.availability.operational,
		JSON.stringify(fixture),
	);
	check(
		"damage is visible before purchase beside an unrelated notice",
		(await page.locator("[data-live-service-status]").innerText()).includes(
			"market",
		) &&
			(await page.locator("[data-live-station-console]").innerText()).includes(
				"Cargo scoop fitted.",
			),
	);
	await page.screenshot({ path: `${out}/damaged-unrelated.png` });
	await page.locator('[data-live-station-tab="Equipment"]').click();
	await page.locator('[data-live-station-action="buy-fuel"]').click();
	check(
		"fuel remains purchasable during a confirmed natural market outage",
		await page.evaluate(async (key) => {
			const g = window.__seelite;
			const W = await import("/src/world-state.ts");
			return (
				g.commander.fuelLy > 0 &&
				!W.capabilityAvailability(
					g.commerceWorld,
					g.world.system.record.galaxy,
					key,
					g.world.gameTime,
				).operational
			);
		}, fixture.key),
	);
	await page.locator('[data-live-station-tab="Market"]').click();
	const credits = await page.evaluate(() => window.__seelite.commander.credits);
	await page
		.locator(
			'[data-live-station-action="buy-commodity"][data-live-station-name="Food"]',
		)
		.click();
	check(
		"the actual console transaction refuses the damaged service atomically",
		await page.evaluate(
			(credits) =>
				window.__seelite.commander.credits === credits &&
				window.__seelite.stationConsoleMessage ===
					"The market service is damaged.",
			credits,
		),
	);
	await page.evaluate(async (key) => {
		const g = window.__seelite;
		const W = await import("/src/world-state.ts");
		const end = W.capabilityAvailability(
			g.commerceWorld,
			g.world.system.record.galaxy,
			key,
		).naturalEnd;
		g.world.gameTime = end;
		g.commerceWorld = W.advanceTo(g.commerceWorld, end);
		g.updateCockpit();
	}, fixture.key);
	check(
		"natural recovery clears its stale refusal and status",
		await page.evaluate(() => {
			const g = window.__seelite;
			return (
				!g.stationConsoleMessage &&
				!document
					.querySelector("[data-live-service-status]")
					?.textContent.includes("market")
			);
		}),
	);
	const buy = await stockedBuy(page);
	await page
		.locator(
			'[data-live-station-action="buy-commodity"][data-live-station-name="' +
				buy.name +
				'"]',
		)
		.click();
	check(
		"a real commodity purchase succeeds after recovery",
		await page.evaluate((buy) => {
			const c = window.__seelite.commander;
			return c.credits < buy.credits && c.cargo[buy.name] === buy.amount + 1;
		}, buy),
	);
	await page.screenshot({ path: `${out}/recovered.png` });
	const repair = await page.evaluate(async (key) => {
		const g = window.__seelite;
		const W = await import("/src/world-state.ts");
		const R = await import("/src/raider-slots.ts");
		let at = g.world.gameTime + 1;
		while (
			W.capabilityAvailability(
				g.commerceWorld,
				g.world.system.record.galaxy,
				key,
				at,
			).operational
		)
			at += 100;
		g.world.gameTime = at;
		g.commerceWorld = W.advanceTo(g.commerceWorld, at);
		const before = W.capabilityAvailability(
			g.commerceWorld,
			g.world.system.record.galaxy,
			key,
		);
		const cause = {
			causeKind: "repair",
			actorId: "probe-repair",
			playerRole: "direct",
		};
		g.applyCarrierTransition(
			key,
			{ kind: "restore", occurredAt: at, cause },
			null,
		);
		const slot = R.raiderSlots(
			g.world.system.record.index,
			g.world.system.record.government,
		)[0];
		if (!slot) throw new Error("repair fixture needs a raider slot");
		g.world.gameTime = at + 1;
		g.applyCarrierTransition(
			slot.key,
			{
				kind: "disable",
				occurredAt: at + 1,
				cause: {
					causeKind: "player-weapons",
					actorId: "player",
					playerRole: "direct",
				},
			},
			null,
		);
		g.updateCockpit();
		return {
			before,
			after: W.capabilityAvailability(
				g.commerceWorld,
				g.world.system.record.galaxy,
				key,
			),
			condition: g.carrierCondition(key),
		};
	}, fixture.key);
	check(
		"attributed repair survives a real raider pressure mutation",
		repair.after.operational &&
			Math.abs(repair.before.naturalEnd - repair.after.naturalEnd) < 1e-7 &&
			repair.condition.condition === "operational",
		JSON.stringify(repair),
	);

	const savedTiming = await page.evaluate(async () => {
		const g = window.__seelite;
		if (!g.saveStore) throw new Error("outage reload needs a real save store");
		g.saveFlush("quit");
		await g.saveStore.settled();
		return JSON.stringify(
			Object.entries(g.commerceWorld.galaxies[0].capabilityTime.anchors).sort(
				([a], [b]) => a.localeCompare(b),
			),
		);
	});
	await page.goto(
		gameUrl(origin, {
			seed: 47,
			system: 2,

			"models-full": true,
		}),
	);
	await bootedGame(page, 180000);
	check(
		"a mining-on saved timing domain survives real flag-off reload",
		await page.evaluate(
			(expected) =>
				JSON.stringify(
					Object.entries(
						window.__seelite.commerceWorld.galaxies[0].capabilityTime.anchors,
					).sort(([a], [b]) => a.localeCompare(b)),
				) === expected,
			savedTiming,
		),
	);
	const off = await placeCapabilityOutage(page);
	const offBuy = await stockedBuy(page);
	await page
		.locator(
			'[data-live-station-action="buy-commodity"][data-live-station-name="' +
				offBuy.name +
				'"]',
		)
		.click();
	check(
		"flag-off commerce ignores the same natural outage",
		!off.availability.operational &&
			(await page.evaluate((buy) => {
				const c = window.__seelite.commander;
				return (
					c.credits < buy.credits &&
					c.cargo[buy.name] === buy.amount + 1 &&
					!document.querySelector("[data-live-service-status]")
				);
			}, offBuy)),
	);
} finally {
	await browser.close();
}
exit();

async function stockedBuy(page) {
	return page.evaluate(() => {
		const g = window.__seelite;
		const row = g
			.stationConsoleState()
			.market.find(
				(row) =>
					row.listed &&
					!row.commodity.sellOnly &&
					row.quantity > 0 &&
					row.buyCr < g.commander.credits,
			);
		if (!row) throw new Error("fixture has no stocked purchasable commodity");
		return {
			name: row.commodity.name,
			amount: g.commander.cargo[row.commodity.name] ?? 0,
			credits: g.commander.credits,
		};
	});
}
