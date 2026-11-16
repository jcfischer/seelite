/**
 * https://github.com/jcfischer/seelite/issues/1197
 * The mining release, end to end, with no URL flag.
 *
 * A courier at trade rung 2 buys a Mining Laser at a refinery berth through the
 * live Equipment tab (its cargo scoop is the stock 1E), flies to a charted
 * field, surveys a deep rock, cuts it, scoops the fragments and sells the ore
 * raw through the Market tab. It then buys the Longwall and does the other
 * half: a surveyed deep deposit feeds the skips through the built-in drill, a
 * docked refinery turns the ore into a paid job, a real save and reload keep
 * the deposit debit, the reading, the job and the custody, and the collected
 * product sells.
 *
 * The three gates are the ones this node's acceptance names: the loop with no
 * flag, the figures the page reads off the ratified table, and a save that
 * survives the reload in the middle of it.
 */
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
	process.env.MINING_RELEASE_EVIDENCE ?? "/tmp/seelite-1197-mining-release";
await mkdir(shots, { recursive: true });
const SEED = 0x5ee11e;

const dockAt = (page, stationType, tab) =>
	page.evaluate(
		async ({ stationType, tab }) => {
			const g = window.__seelite;
			const station = g.world.system.bodies.find(
				(b) =>
					b.kind === "station" &&
					(stationType === null || b.stationType === stationType),
			);
			if (!station) throw Error(`no ${stationType ?? "trade"} station`);
			await window.__parkInBerth(
				station.id,
				g.berthIdsOfStation(station.id)[0],
			);
			g.stationConsoleRevision++;
			g.stationConsoleTab = tab;
			g.setHeadLook("forward");
			g.updateCockpit();
			return { docked: g.dock.phase };
		},
		{ stationType, tab },
	);

const sellOne = async (page, name) => {
	const row = page.locator(`[data-live-market-row="${name}"]`);
	await row.waitFor();
	const before = Number.parseFloat(
		await page.locator("[data-live-commander]").innerText(),
	);
	const bid = Number.parseFloat(
		await row.locator("[data-live-sell]").innerText(),
	);
	await row.locator('[data-live-station-action="sell-commodity"]').click();
	await page.waitForFunction(
		(before) =>
			Number.parseFloat(
				document.querySelector("[data-live-commander]")?.textContent ?? "",
			) > before,
		before,
	);
	const sale = await page.evaluate(async (name) => {
		const g = window.__seelite;
		const { displayAmount, accountOf } = await import(
			"/src/commodity-pools.ts"
		);
		return {
			credits: g.commander.credits,
			left: g.commander.cargo[name] ?? 0,
			trade: displayAmount(accountOf(g.commander).bankedTrade),
		};
	}, name);
	return { before, bid, sale };
};

try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
	await bootedGame(page, 180000);

	const WORK_SYSTEM = 9;
	const boot = await page.evaluate(async (workSystem) => {
		const g = window.__seelite;
		const Sim = await import("/src/sim.ts");
		const W = await import("/src/world-state.ts");
		const { threshold } = await import("/src/ladder.ts");
		g.clockHeld = true;
		g.launch();
		Sim.jumpWorldTo(g.world, g.world.galaxy.systems[workSystem]);
		g.rebuildSystem();
		g.adoptWorld(W.visit(g.commerceWorld, 0, workSystem));
		const refinery = g.world.system.bodies.find(
			(b) => b.kind === "station" && b.stationType === "refinery",
		);
		if (!refinery) throw Error("the work system has no refinery");
		await window.__parkInBerth(
			refinery.id,
			g.berthIdsOfStation(refinery.id)[0],
		);
		g.ladders = {
			...g.ladders,
			banked: {
				combat: threshold("combat", 0),
				trade: threshold("trade", 4),
				exploration: threshold("exploration", 0),
			},
		};
		(await import("/scripts/lib/commander-fixture.ts")).setCommanderFixture(g, {
			credits: 100_000,
		});
		g.stationConsoleRevision++;
		g.stationConsoleTab = "Equipment";
		g.setHeadLook("forward");
		g.updateCockpit();
		return {
			query: window.location.search,
			system: g.world.system.record.index,
			docked: g.dock.phase,
			rung: g.rungs().trade,
			hull: g.flownHull,
			credits: g.commander.credits,
			scoop: Object.values(g.commander.loadout).some(
				(m) => m.module === "cargo-scoop",
			),
			mining: Object.values(g.commander.loadout).some(
				(m) => m.module === "mining-laser",
			),
			groups: g.fireGroups.map((group) => group.kind),
			survey: g.surveyState(),
			recovery: (await import("/src/deposit-state.ts")).RECOVERY_T_PER_H,
		};
	}, WORK_SYSTEM);
	check(
		"the page boots with no mining flag and mining is live in a system it jumped to",
		!boot.query.includes("mining") &&
			boot.system === 9 &&
			boot.docked === "docked" &&
			boot.groups.includes("lasers") &&
			boot.survey !== null &&
			boot.recovery === 10,
		JSON.stringify({
			query: boot.query,
			groups: boot.groups,
			r: boot.recovery,
		}),
	);
	check(
		"the pilot stands at trade rung 2 or above and flies the courier's stock scoop",
		boot.rung >= 2 && boot.scoop && !boot.mining,
		JSON.stringify({ rung: boot.rung, scoop: boot.scoop, mining: boot.mining }),
	);

	await page.locator('[data-live-station-tab="Equipment"]').click();
	await page.locator('[data-outfit-slot="h1"]').click();
	const stock1 = await page.evaluate(() => ({
		stock: [...document.querySelectorAll(".lc-outfit-stock")].map(
			(button) => button.textContent,
		),
		preview: document.querySelector("[data-live-outfit-preview]")?.textContent,
	}));
	check(
		"the h1 stock lists a Mining laser",
		stock1.stock.some((text) => text.includes("Mining laser")),
		JSON.stringify(stock1),
	);
	await page
		.locator(".lc-outfit-stock")
		.filter({ hasText: "Mining laser" })
		.first()
		.click();
	const selected = await page.evaluate(() => ({
		preview: document.querySelector("[data-live-outfit-preview]")?.textContent,
		actions: [...document.querySelectorAll("[data-live-station-action]")].map(
			(button) => button.getAttribute("data-live-station-action"),
		),
	}));
	check(
		"selecting the Mining laser offers the purchase",
		selected.actions.includes("buy-module"),
		JSON.stringify(selected),
	);
	await page.locator('[data-live-station-action="buy-module"]').click();
	const bought = await page.evaluate(async () => {
		const g = window.__seelite;
		const { moduleRow } = await import("/src/loadout.ts");
		const fitted = Object.entries(g.commander.loadout).find(
			([, m]) => m.module === "mining-laser",
		);
		return {
			credits: g.commander.credits,
			slot: fitted?.[0] ?? null,
			grade: fitted?.[1].grade ?? null,
			price: fitted ? moduleRow(fitted[1]).priceCr : null,
			scoop: Object.values(g.commander.loadout).some(
				(m) => m.module === "cargo-scoop",
			),
			groups: g.fireGroups.map((group) => group.label),
			figures: g.surveyState().figures,
		};
	});
	check(
		"the bought Mining Laser fits a hardpoint, costs its catalogue price and arms the survey",
		bought.slot === "h1" &&
			bought.credits === boot.credits - bought.price &&
			bought.scoop &&
			bought.groups.some((label) => label.includes("MINING LASER")) &&
			bought.figures !== null,
		JSON.stringify(bought),
	);

	const launch = await page.evaluate(async () => {
		const g = window.__seelite;
		g.launch();
		const dt = g.units.MAX_DT;
		for (let s = 0; s < 180 && g.dock.phase !== "flying"; s += dt) g.step(dt);
		return g.dock.phase;
	});
	check(
		"the launch clears the berth before the field run",
		launch === "flying",
		String(launch),
	);
	const flight = await page.evaluate(async () => {
		const A = await import("/src/asteroid-field.ts");
		const S = await import("/src/rock-survey.ts");
		const T = await import("/src/rock-target.ts");
		const D = await import("/src/rock-drill.ts");
		const g = window.__seelite;
		g.clockHeld = true;
		const draw = g.fields.find((f) => f.plan.profile === "charted");
		if (!draw) throw Error("no charted field");
		const deep = (rock) =>
			S.rockContents(
				g.world.system.record.seed,
				draw.plan.slot,
				draw.plan.profile,
				rock,
			).deepT > 0;
		const rock = draw.rocks
			.filter((r) => deep(r) && r.radiusKm > D.ANCHOR.gripRadiusKm)
			.sort((a, b) => b.radiusKm - a.radiusKm)[0];
		if (!rock) throw Error("no deep rock");
		const id = T.rockTargetId(draw.plan, rock.slot);
		const away = { x: 0.6, y: 0.48, z: 0.64 };
		window.__standOff = async (km) => {
			const ref = T.resolveRock([draw], id, g.world.ship.pos, g.world.gameTime);
			const p = A.rockPose(draw.plan, rock, g.world.gameTime);
			await window.__placeShipAt(
				{
					x: p.pos.x + away.x * (rock.radiusKm + km),
					y: p.pos.y + away.y * (rock.radiusKm + km),
					z: p.pos.z + away.z * (rock.radiusKm + km),
				},
				p.vel,
			);
			const V = g.nearScene.position.constructor;
			g.orientation.setFromUnitVectors(
				new V(0, 0, -1),
				new V(-away.x, -away.y, -away.z),
			);
			g.targetId = id;
			for (let i = 0; i < 2; i++)
				await new Promise((r) => requestAnimationFrame(r));
			return ref;
		};
		g.view = "cockpit";
		g.setHeadLook("forward");
		await window.__standOff(2);
		return {
			phase: g.dock.phase,
			fieldId: draw.plan.id,
			id,
			rocks: draw.rocks.length,
			known: g
				.navigationTargets()
				.some((row) => row.id === draw.plan.id || row.id === id),
			target: g.surveyState().target?.id ?? null,
			block: g.surveyState().block,
			designation: g.surveyState().designation,
		};
	});
	check(
		"in flight, the charted field is known and the rock in the reticle is the target",
		flight.phase === "flying" &&
			flight.rocks > 0 &&
			flight.known &&
			flight.target === flight.id &&
			flight.block === null,
		JSON.stringify(flight),
	);
	const surveyed = await page.evaluate(async () => {
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		const dwellS = g.surveyState().figures.dwellS;
		for (let s = 0; s < dwellS + 0.5; s += dt) g.step(dt);
		for (let i = 0; i < 2; i++)
			await new Promise((r) => requestAnimationFrame(r));
		return {
			row: g.surveyState().row ?? null,
			designation: g.surveyState().designation,
			deep: g.deepCueRender !== null,
		};
	});
	check(
		"a held survey writes a reading with a deep deposit and marks its mouth",
		typeof surveyed.row?.surveyedAt === "number" &&
			/DEEP \d+ T/.test(surveyed.designation ?? "") &&
			surveyed.deep,
		JSON.stringify(surveyed),
	);
	await page.screenshot({ path: `${shots}/survey.png` });

	const cut = await page.evaluate(async () => {
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		const before = g.surveyState().row?.surface ?? 0;
		g.keys.add(" ");
		for (let s = 0; s < 90 && g.miningLog.released < 1; s += dt) {
			g.step(dt);
			if (Math.round(s / 2) !== Math.round((s - dt) / 2))
				await window.__standOff(1);
		}
		g.keys.delete(" ");
		for (let i = 0; i < 2; i++)
			await new Promise((r) => requestAnimationFrame(r));
		return {
			rock: g.miningLog.cutRockId,
			released: g.miningLog.released,
			before,
			after: g.surveyState().row?.surface ?? 0,
			ore: g.fragmentPlaces().filter((place) => place.ore).length,
			beam: g.miningBeam?.hit?.rockId ?? null,
			painted: g.fragmentRender !== null,
			energy: g.condition.energy,
		};
	});
	check(
		"the Mining Laser cuts the surveyed rock and each tonne leaves the deposit",
		cut.rock === flight.id &&
			cut.released >= 1 &&
			cut.after - cut.before === cut.released &&
			cut.beam === flight.id &&
			cut.ore === cut.released &&
			cut.painted,
		JSON.stringify(cut),
	);
	await page.screenshot({ path: `${shots}/cut.png` });

	const scooped = await page.evaluate(async () => {
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		const aboard = () =>
			Object.entries(g.commander.cargo).filter(([, t]) => t > 0);
		for (let attempt = 0; attempt < 20 && aboard().length === 0; attempt++) {
			const ore = g.fragmentPlaces().find((place) => place.ore);
			if (!ore) {
				for (let i = 0; i < 3; i++) g.step(dt);
				continue;
			}
			await window.__placeShipAt(ore.pos, ore.vel);
			for (let i = 0; i < 3; i++) g.step(dt);
		}
		if (aboard().length === 0)
			return {
				taken: g.miningLog.taken,
				cargo: [],
				row: null,
				fragments: g.fragmentPlaces().length,
				log: { ...g.miningLog },
			};
		g.rightTab = "Hold";
		g.setHeadLook("right");
		g.updateCockpit();
		await new Promise((r) =>
			requestAnimationFrame(() => requestAnimationFrame(r)),
		);
		const cargo = Object.entries(g.commander.cargo).filter(([, t]) => t > 0);
		return {
			taken: g.miningLog.taken,
			cargo,
			row: cargo[0]
				? (document.querySelector(`[data-live-hold-row="${cargo[0][0]}"]`)
						?.textContent ?? null)
				: null,
		};
	});
	check(
		"a scooped fragment lands in the hold as its family and grade",
		scooped.taken >= 1 &&
			scooped.cargo.length === 1 &&
			(scooped.row ?? "").includes("raw ore"),
		JSON.stringify(scooped),
	);
	await page.screenshot({ path: `${shots}/hold.png` });

	const oreName = scooped.cargo[0][0];
	await dockAt(page, null, "Market");
	const raw = await sellOne(page, oreName);
	check(
		"docked, the Market SELL button pays the quoted bid for the raw ore",
		Math.abs(raw.sale.credits - raw.before - raw.bid) < 0.11 &&
			raw.sale.left === scooped.taken - 1,
		JSON.stringify(raw),
	);
	await page.screenshot({ path: `${shots}/raw-sale.png` });

	const longwall = await page.evaluate(async () => {
		const g = window.__seelite;
		const W = await import("/src/world-state.ts");
		const C = await import("/src/capability-slots.ts");
		const Sim = await import("/src/sim.ts");
		const shipyard = g.world.system.contents.stations.find(
			(s) => s.type === "shipyard",
		);
		if (!shipyard) throw Error("the work system has no shipyard");
		const galaxy = g.world.system.record.galaxy;
		const key = C.capabilitySlots(g.world.system.record.index, shipyard).find(
			(slot) => slot.service === "exclusive",
		).key;
		let at = g.world.gameTime;
		const availability = () =>
			W.capabilityAvailability(g.commerceWorld, galaxy, key, at);
		if (!availability().operational) {
			at = availability().naturalEnd;
			Sim.advanceWorldClock(g.world, at - g.world.gameTime);
			g.adoptWorld(W.advanceTo(g.commerceWorld, at));
		}
		await window.__parkInBerth(
			shipyard.id,
			g.berthIdsOfStation(shipyard.id)[0],
		);
		g.stationConsoleTab = "Shipyard";
		g.stationConsoleRevision++;
		g.setHeadLook("forward");
		g.updateCockpit();
		return { hull: g.flownHull, docked: g.dock.phase };
	});
	check(
		"a shipyard berth opens the Shipyard tab",
		longwall.docked === "docked" && longwall.hull === "courier",
		JSON.stringify(longwall),
	);
	await page.locator('[data-live-station-tab="Shipyard"]').click();
	const yard = await page.evaluate(() => ({
		rows: [...document.querySelectorAll("[data-live-hull-row]")].map((row) => ({
			hull: row.getAttribute("data-live-hull-row"),
			reason: row.getAttribute("data-live-hull-reason"),
			text: row.textContent,
		})),
		credits: window.__seelite.commander.credits,
	}));
	check(
		"the Shipyard tab offers the Longwall",
		yard.rows.some((row) => row.hull === "miner" && row.reason === ""),
		JSON.stringify(yard),
	);
	await page
		.locator(
			'[data-live-station-action="buy-hull"][data-live-station-name="miner"]',
		)
		.click();
	const flown = await page.evaluate(async () => {
		const g = window.__seelite;
		const { makeModule } = await import("/src/loadout.ts");
		const { HULL_SPECS } = await import("/src/hull.ts");
		const utility = HULL_SPECS.miner.slots.find(
			(slot) => slot.kind === "utility",
		);
		g.commander = {
			...g.commander,
			loadout: {
				...g.commander.loadout,
				[utility.key]: makeModule("docking-computer", utility.size),
			},
		};
		g.launch();
		g.clockHeld = true;
		return {
			hull: g.commander.hull,
			groups: g.fireGroups.map((group) => group.label),
			skips: g.minedHold().capacityT,
		};
	});
	check(
		"the bought Longwall flies, arms its built-in drill and carries 3,000 t of skips",
		flown.hull === "miner" &&
			flown.groups.includes("BUILT-IN DRILL") &&
			flown.skips === 3000,
		JSON.stringify(flown),
	);

	const drilled = await page.evaluate(async (targetId) => {
		const A = await import("/src/asteroid-field.ts");
		const S = await import("/src/rock-survey.ts");
		const T = await import("/src/rock-target.ts");
		const H = await import("/src/hull.ts");
		const E = await import("/src/rock-extraction.ts");
		const D = await import("/src/rock-drill.ts");
		const V = await import("/src/vec3.ts");
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		g.clockHeld = true;
		const draw = g.fields.find((f) =>
			targetId.startsWith(`rock:${f.plan.id}:`),
		);
		if (!draw) throw Error("the surveyed field is gone");
		const contents = (rock) =>
			S.rockContents(
				g.world.system.record.seed,
				draw.plan.slot,
				draw.plan.profile,
				rock,
			);
		const slot = Number(targetId.slice(targetId.lastIndexOf(":") + 1));
		const rock = draw.rocks.find((r) => r.slot === slot);
		if (!rock) throw Error("the surveyed rock is gone");
		const id = targetId;
		const seatNow = () => {
			const ref = {
				id,
				plan: draw.plan,
				rock,
				...A.rockPose(draw.plan, rock, g.world.gameTime),
				distKm: 0,
			};
			const mouth = T.rockDirectionNow(
				ref,
				contents(rock).deepDir,
				g.world.gameTime,
			);
			const hit = E.beamHit(
				V.add(ref.pos, V.scale(mouth, rock.radiusKm * 2)),
				V.scale(mouth, -1),
				g.rockTargets([ref]),
				rock.radiusKm * 3,
			);
			if (!hit) throw Error("no drill seat");
			const seat = D.seatPose(
				hit.point,
				hit.normal,
				{ x: 0, y: 1, z: 0 },
				H.HULL_SPECS.miner.cutter,
			);
			return {
				pos: V.add(seat.pos, V.scale(hit.normal, D.ANCHOR.reachKm * 0.5)),
				vel: ref.vel,
				nose: seat.nose,
				up: seat.up,
				ref,
			};
		};
		const standOnSeat = async () => {
			const seat = seatNow();
			await window.__placeShipAt(seat.pos, seat.vel);
			g.setAttitude(seat.nose, seat.up);
			g.throttle = 0;
			return seat;
		};
		for (let n = 0; n < g.fireGroups.length; n++) {
			if (g.fireGroups[n].kind === "drill") break;
			g.armedFireGroup.cycle(g.fireGroups);
		}
		for (let t = 0; t < 40 && g.drill.extension < 1; t += dt) {
			g.step(dt);
			if (Math.round(t / 2) !== Math.round((t - dt) / 2)) await standOnSeat();
		}
		await standOnSeat();
		g.toggleDrillHold();
		for (let t = 0; t < D.ANCHOR.seatS + 5; t += dt) g.step(dt);
		const before = g.minedT;
		const debit = g.rockDepositRow(seatNow().ref)?.deep ?? 0;
		g.keys.add(" ");
		for (let t = 0; t < 6; t += dt) g.step(dt);
		g.keys.delete(" ");
		const ref = seatNow().ref;
		const out = {
			id,
			armed: g.armedFireGroup
				.current(g.fireGroups)
				?.label?.startsWith("BUILT-IN DRILL"),
			surveyed: typeof g.rockDepositRow(seatNow().ref)?.surveyedAt === "number",
			before,
			after: g.minedT,
			debit,
			debitAfter: g.rockDepositRow(ref)?.deep ?? 0,
			skips: Object.entries(g.commander.cargo).filter(
				([name, t]) => name.includes("ore") && t > 0,
			),
		};
		if (g.drill.held) g.toggleDrillHold();
		g.armedFireGroup.reset();
		for (let t = 0; t < D.DRILL.deployS + 4; t += dt) g.step(dt);
		await window.__placeShipAt(
			{ x: ref.pos.x + 60, y: ref.pos.y + 30, z: ref.pos.z + 60 },
			{ x: 0, y: 0, z: 0 },
		);
		return out;
	}, flight.id);
	check(
		"the Longwall's drill feeds the skips exactly what the surveyed deposit loses",
		drilled.surveyed === true &&
			drilled.armed === true &&
			drilled.after > drilled.before &&
			drilled.debitAfter - drilled.debit === drilled.after - drilled.before,
		JSON.stringify(drilled),
	);
	await page.screenshot({ path: `${shots}/drill.png` });

	const submittedDock = await dockAt(page, "refinery", "Refinery");
	const submitted = await page.evaluate(() => ({
		ore: Object.entries(window.__seelite.commander.cargo)
			.filter(([, t]) => t > 0)
			.map(([name, tonnes]) => [name, tonnes]),
	}));
	check(
		"the docked refinery offers the mined ore",
		submittedDock.docked === "docked" && submitted.ore.length > 0,
		JSON.stringify({ ...submittedDock, ...submitted }),
	);
	await page.locator('[data-live-station-tab="Refinery"]').click();
	await page.locator("[data-live-refinery-tonnes]").fill("4");
	await page.locator('[data-live-refinery-action="quote"]').click();
	const fee = await page.locator("[data-live-refinery-fee]").innerText();
	await page.locator('[data-live-refinery-action="submit"]').click();
	await page.waitForFunction(async () => {
		const W = await import("/src/world-state.ts");
		const g = window.__seelite;
		const galaxy = g.world.system.record.galaxy;
		const queues =
			W.serializeWorld(g.commerceWorld).galaxies[galaxy]?.refineries ?? {};
		return Object.values(queues).flatMap((queue) => queue.jobs).length === 1;
	});
	const queued = await page.evaluate(() => {
		const g = window.__seelite;
		g.stationConsoleRevision++;
		g.updateCockpit();
		const view = g.stationConsoleState()?.refinery ?? null;
		return {
			view: view ? { jobs: view.jobs.length, queue: view.queueCount } : null,
			ore: g.commander.cargo,
			notice: g.refineryNotice ?? null,
			message: g.stationConsoleMessage ?? null,
			saving: g.refinerySaving ?? null,
		};
	});
	const submittedName = submitted.ore[0][0];
	const submittedTonnes = submitted.ore[0][1];
	check(
		"SUBMIT & PAY takes four tonnes and the fee into one queue job",
		queued.view?.jobs === 1 &&
			queued.view.queue === 1 &&
			queued.ore[submittedName] === submittedTonnes - 4 &&
			fee.includes("Cr"),
		JSON.stringify({
			view: queued.view,
			ore: queued.ore,
			fee,
			notice: queued.notice,
			message: queued.message,
			saving: queued.saving,
		}),
	);
	await page.screenshot({ path: `${shots}/refinery.png` });

	const beforeReload = await page.evaluate(async () => {
		const g = window.__seelite;
		const W = await import("/src/world-state.ts");
		const deposits = W.serializeWorld(g.commerceWorld).galaxies.map(
			(galaxy) => galaxy.deposits,
		);
		g.saveFlush("quit");
		await g.saveStore.settled();
		return {
			deposits: JSON.stringify(deposits),
			cargo: JSON.stringify(g.commander.cargo),
		};
	});
	await page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
	await bootedGame(page, 180000);
	const afterReload = await page.evaluate(async () => {
		const g = window.__seelite;
		g.clockHeld = true;
		const W = await import("/src/world-state.ts");
		const galaxy = g.world.system.record.galaxy;
		const queues =
			W.serializeWorld(g.commerceWorld).galaxies[galaxy]?.refineries ?? {};
		return {
			deposits: JSON.stringify(
				W.serializeWorld(g.commerceWorld).galaxies.map(
					(entry) => entry.deposits,
				),
			),
			cargo: JSON.stringify(g.commander.cargo),
			jobs: Object.values(queues).flatMap((queue) => queue.jobs).length,
			hull: g.flownHull,
		};
	});
	check(
		"a reload keeps the deposit debit, the job, the custody and the flown hull",
		afterReload.deposits === beforeReload.deposits &&
			afterReload.cargo === beforeReload.cargo &&
			afterReload.jobs === 1 &&
			afterReload.hull === "miner",
		JSON.stringify({ jobs: afterReload.jobs, hull: afterReload.hull }),
	);

	await page.evaluate(async () => {
		const g = window.__seelite;
		const W = await import("/src/world-state.ts");
		const Sim = await import("/src/sim.ts");
		const advance = g.world.gameTime + 600;
		Sim.advanceWorldClock(g.world, advance - g.world.gameTime);
		g.adoptWorld(W.advanceTo(g.commerceWorld, advance));
	});
	const sold = await dockAt(page, "refinery", "Refinery");
	check(
		"the refinery berth is still open after the pass",
		sold.docked === "docked",
	);
	await page.locator('[data-live-station-tab="Refinery"]').click();
	await page.locator('[data-live-refinery-action="view-jobs"]').click();
	const collect = page.locator("[data-live-refinery-collect]").first();
	await collect.waitFor({ timeout: 30000 });
	await collect.click();
	await page.waitForFunction(async () => {
		const { oreGood } = await import("/src/ore-goods.ts");
		const cargo = window.__seelite.commander.cargo;
		return Object.keys(cargo).some(
			(name) => (cargo[name] ?? 0) > 0 && !oreGood(name),
		);
	});
	const collected = await page.evaluate(async () => {
		const { oreGood } = await import("/src/ore-goods.ts");
		const cargo = { ...window.__seelite.commander.cargo };
		return {
			cargo,
			product: Object.keys(cargo).find(
				(name) => (cargo[name] ?? 0) > 0 && !oreGood(name),
			),
		};
	});
	check(
		"COLLECT puts the refined product in the hold",
		collected.product !== undefined,
		JSON.stringify(collected.cargo),
	);
	await page.locator('[data-live-station-tab="Market"]').click();
	const product = await page.evaluate(async () => {
		const { oreGood } = await import("/src/ore-goods.ts");
		const cargo = window.__seelite.commander.cargo;
		return Object.keys(cargo).find(
			(name) => (cargo[name] ?? 0) > 0 && !oreGood(name),
		);
	});
	if (!product) throw Error("no refined product in the hold");
	const productSale = await sellOne(page, product);
	check(
		"the refined product sells at its quoted bid and banks trading rating",
		Math.abs(productSale.sale.credits - productSale.before - productSale.bid) <
			0.11 &&
			productSale.sale.left === (collected.cargo[product] ?? 0) - 1 &&
			productSale.sale.trade > 0,
		JSON.stringify(productSale),
	);
	await page.screenshot({ path: `${shots}/product-sale.png` });
} finally {
	await browser.close();
}
exit();
