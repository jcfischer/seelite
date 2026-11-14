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
const shots =
	process.env.MINING_GOODS_EVIDENCE ?? "/tmp/seelite-1193-mining-goods";
await mkdir(shots, { recursive: true });
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(
		gameUrl(origin, {
			seed: 0x5ee11e,
			system: 173,
			hull: "miner",
			mining: "1",
			raider: "off",
		}),
	);
	await bootedGame(page, 90000);
	const setup = await page.evaluate(async () => {
		const { rockPose } = await import("/src/asteroid-field.ts");
		const { rockDirectionNow } = await import("/src/rock-target.ts");
		const { HULL_SPECS } = await import("/src/hull.ts");
		const { beamHit } = await import("/src/rock-extraction.ts");
		const { DRILL, ANCHOR, seatPose } = await import("/src/rock-drill.ts");
		const { add, scale } = await import("/src/vec3.ts");
		const { oreCargoName } = await import("/src/ore-goods.ts");
		const g = window.__seelite;
		g.clockHeld = true;
		const draw = g.fields[0];
		const rock = draw?.rocks.find(
			(r) =>
				g.rockContentsOf({ plan: draw.plan, rock: r }).deepT > 0 &&
				r.radiusKm > ANCHOR.gripRadiusKm,
		);
		if (!rock) throw Error("no large deep deposit");
		const ref = {
			id: `rock:${draw.plan.id}:${rock.slot}`,
			plan: draw.plan,
			rock,
			...rockPose(draw.plan, rock, g.world.gameTime),
			distKm: 0,
		};
		const contents = g.rockContentsOf(ref);
		const mouth = rockDirectionNow(ref, contents.deepDir, g.world.gameTime);
		const hit = beamHit(
			add(ref.pos, scale(mouth, rock.radiusKm * 2)),
			scale(mouth, -1),
			g.rockTargets([ref]),
			rock.radiusKm * 3,
		);
		if (!hit) throw Error("no drill seat");
		const seat = seatPose(
			hit.point,
			hit.normal,
			{ x: 0, y: 1, z: 0 },
			HULL_SPECS.miner.cutter,
		);
		await window.__placeShipAt(
			add(seat.pos, scale(hit.normal, ANCHOR.reachKm * 0.5)),
			ref.vel,
		);
		g.setAttitude(seat.nose, seat.up);
		g.throttle = 0;
		return {
			name: oreCargoName(contents.family, contents.grade),
			groups: g.fireGroups.length,
			deployS: DRILL.deployS,
			rock: ref.id,
			before: g.rockDepositRow(ref)?.deep ?? 0,
		};
	});
	for (let i = 0; i < setup.groups - 1; i++) await page.keyboard.press("b");
	await page.evaluate((deploy) => {
		const g = window.__seelite;
		for (let t = 0; t < deploy + 0.2; t += g.units.MAX_DT)
			g.step(g.units.MAX_DT);
	}, setup.deployS);
	await page.keyboard.press("4");
	await page.evaluate(() => {
		const g = window.__seelite;
		for (let t = 0; t < 4.3; t += g.units.MAX_DT) g.step(g.units.MAX_DT);
	});
	await page.keyboard.down("Space");
	const mined = await page.evaluate(async (setup) => {
		const g = window.__seelite;
		for (let t = 0; t < 1; t += g.units.MAX_DT) g.step(g.units.MAX_DT);
		const row = g.rockDepositRow(g.rockRef(setup.rock));
		g.rightTab = "Hold";
		g.setHeadLook("right");
		g.updateCockpit();
		await new Promise((r) =>
			requestAnimationFrame(() => requestAnimationFrame(r)),
		);
		return {
			cargo: { ...g.commander.cargo },
			debit: (row?.deep ?? 0) - setup.before,
			hold: document.querySelector(`[data-live-hold-row="${setup.name}"]`)
				?.textContent,
		};
	}, setup);
	await page.keyboard.up("Space");
	check(
		"real field drilling credits whole commander tonnes and paints their family and grade",
		mined.cargo[setup.name] > 0 &&
			Number.isInteger(mined.cargo[setup.name]) &&
			mined.cargo[setup.name] === mined.debit &&
			mined.hold?.includes(`${mined.debit} t`),
		JSON.stringify(mined),
	);
	await page.screenshot({ path: `${shots}/hold.png` });
	const flushed = await page.evaluate(async () => {
		const g = window.__seelite;
		g.saveFlush("quit");
		await g.saveStore?.settled();
		const stored = await g.save.backend.read(g.save.defaultSlot, "live");
		return stored?.commander.state.cargo;
	});
	check(
		"the live IndexedDB envelope holds the mined cargo",
		JSON.stringify(flushed) === JSON.stringify(mined.cargo),
		JSON.stringify(flushed),
	);
	await page.goto(gameUrl(origin, { seed: 0x5ee11e, raider: "off" }));
	await bootedGame(page, 90000);
	const flagless = await page.evaluate(() => ({
		...window.__seelite.commander.cargo,
	}));
	check(
		"a flagless reload keeps every ore tonne aboard",
		JSON.stringify(flagless) === JSON.stringify(mined.cargo),
		JSON.stringify(flagless),
	);
	await page.goto(
		gameUrl(origin, { seed: 0x5ee11e, mining: "1", raider: "off" }),
	);
	await bootedGame(page, 90000);
	const reloaded = await page.evaluate(() => ({
		...window.__seelite.commander.cargo,
	}));
	check(
		"a mining reload restores the same family, grade and quantity",
		JSON.stringify(reloaded) === JSON.stringify(mined.cargo),
		JSON.stringify(reloaded),
	);
	const docked = await page.evaluate(async () => {
		const g = window.__seelite;
		g.clockHeld = true;
		const station = g.world.system.bodies.find(
			(b) => b.kind === "station" && b.stationType === "refinery",
		);
		if (!station) throw Error("no refinery");
		await window.__parkInBerth(station.id, g.berthIdsOfStation(station.id)[0]);
		g.setHeadLook("forward");
		g.stationConsoleTab = "Market";
		g.updateCockpit();
		return g.dock.phase;
	});
	check(
		"clearance and the fitted docking computer deliver a docked market",
		docked === "docked",
		docked,
	);
	const row = page.locator(`[data-live-market-row="${setup.name}"]`);
	await row.waitFor();
	const before = Number.parseFloat(
		await page.locator("[data-live-commander]").innerText(),
	);
	const bid = Number.parseFloat(
		await row.locator("[data-live-sell]").innerText(),
	);
	const held = await row.locator("[data-live-held]").innerText();
	check(
		"the market lists the mined good and its saved HELD amount",
		Number.parseFloat(held) === mined.cargo[setup.name] && Number.isFinite(bid),
		`${setup.name}: ${held}, bid ${bid}`,
	);
	await row.locator('[data-live-station-action="sell-commodity"]').click();
	const after = Number.parseFloat(
		await page.locator("[data-live-commander]").innerText(),
	);
	const sale = await page.evaluate((name) => {
		const g = window.__seelite;
		return {
			quantity: g.commander.cargo[name] ?? 0,
			trade: g.commander.accounting.bankedTrade > 0n,
		};
	}, setup.name);
	check(
		"the Market SELL button credits exactly the bid read from the page",
		Math.abs(after - before - bid) < 1e-8 &&
			sale.quantity === mined.cargo[setup.name] - 1 &&
			sale.trade,
		JSON.stringify({ before, bid, after, ...sale }),
	);
	await page.screenshot({ path: `${shots}/sold.png` });
	await page.goto(gameUrl(origin, { seed: 0x5ee11e, raider: "off" }));
	await bootedGame(page, 90000);
	await page.evaluate(() => {
		const g = window.__seelite;
		g.setHeadLook("forward");
		g.stationConsoleTab = "Market";
		g.updateCockpit();
	});
	const off = await page
		.locator("[data-live-market-row]")
		.evaluateAll((rows) =>
			rows.map((r) => r.getAttribute("data-live-market-row")),
		);
	check(
		"without mining the docked market retains exactly its original seventeen rows",
		off.length === 17 && !off.some((name) => name.includes("ore")),
		JSON.stringify(off),
	);
} finally {
	await browser.close();
}
exit();
