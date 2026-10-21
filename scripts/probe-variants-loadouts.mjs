import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { stopLoop, installViewFraming } from "./lib/view-placement.mjs";
const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
const browser = await launchChromium();
const t = tally();
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	t.watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: 2 }));
	await bootedGame(page);
	await stopLoop(page);
	const result = await page.evaluate(async () => {
		const g = window.__seelite;
		const { npcLoadout, npcFitSeed, npcFittingDrop } = await import(
			"/src/npc-loadout.ts"
		);
		const { fittedCapacity, makeModule, moduleRow } = await import(
			"/src/loadout.ts"
		);
		const { killCredit } = await import("/src/kill-credit.ts");
		const { fullCondition } = await import("/src/ship-condition.ts");
		const { parseSave, serializeSave } = await import("/src/save-envelope.ts");
		g.forceRaider("ahead", 0, 5);
		const e = g.encounter;
		e.origin = "defender";
		e.appearsAtS = g.world.gameTime;
		g.stepRaider(0, { fired: false, damage: 0 }, []);
		const live = g.encounter;
		const seed = npcFitSeed(
			g.world.system.record.seed,
			e.slot.key,
			g.carrierCondition(e.slot.key).instanceOrdinal,
		);
		const expected = npcLoadout("raider", seed);
		const materialized =
			JSON.stringify(live.raider.loadout) === JSON.stringify(expected);
		const capacity = fittedCapacity("raider", expected);
		const defence =
			live.raider.condition.hullMax === capacity.integrity &&
			live.raider.condition.shieldMax === capacity.shieldPool;
		const credit = killCredit(
			{ hull: g.commander.hull, loadout: g.commander.loadout },
			{ hull: "raider", loadout: expected },
		);
		const before = g.ladderPending.combat;
		const expectedDrop = npcFittingDrop(expected, seed);
		g.endEncounter(
			live,
			{ ...live, phase: "over", end: "destroyed" },
			live.raider.flight.ship,
			undefined,
		);
		const actualDrop = g.canisters.find((c) => c.fitting)?.fitting;
		const dropAgrees = expectedDrop
			? JSON.stringify(actualDrop) ===
				JSON.stringify({ ...expectedDrop, purchaseCostCr: 0 })
			: !actualDrop;
		const paid = g.ladderPending.combat - before;
		const module = {
			...makeModule("pulse-laser", 1, "A"),
			variant: "overcharged",
		};
		let dropSeed = 0;
		while (!npcFittingDrop({ h1: module }, dropSeed)) dropSeed++;
		const { dropFittingCanister } = await import("/src/raider-wreck.ts");
		g.canisters = dropFittingCanister(
			{
				systemSeed: g.world.system.record.seed,
				government: 0,
				key: e.slot.key,
				killedAt: g.world.gameTime,
				pos: g.world.ship.pos,
				vel: g.world.ship.vel,
				frameVel: g.world.ship.vel,
				frameBodyId: null,
			},
			npcFittingDrop({ h1: module }, dropSeed),
		);
		g.commander = { ...g.commander, cargo: {}, recoveredFittings: [] };
		g.stepCargoCanisters(0);
		const recovered = g.commander.recoveredFittings?.[0];
		const snapshot = parseSave(serializeSave(g.saveEnvelope()));
		const saved = snapshot.commander.state.recoveredFittings?.[0];
		g.encounter = null;
		g.encounterView = null;
		g.condition = fullCondition(
			g.commander.hull,
			fittedCapacity(g.commander.hull, g.commander.loadout),
		);
		const { observeScan, applyTransition, advanceTo } = await import(
			"/src/world-state.ts"
		);
		const { trafficDestruction } = await import("/src/traffic-engagement.ts");
		const { systemIndexOfKey } = await import("/src/carrier-key.ts");
		const { RAIDER_WRECK_S, RAIDER_REPAIR_S } = await import(
			"/src/raider-wreck.ts"
		);
		const capacityAt = (a, n) =>
			fittedCapacity(
				a.hullId,
				npcLoadout(a.hullId, npcFitSeed(g.trafficHomeRecord(a).seed, a.key, n)),
			).holdT;
		let subject, replacement;
		for (let n = 1; n <= 8 && !subject; n++) {
			subject = g
				.trafficCandidates()
				.find(
					(a) =>
						["patrol", "interceptor"].includes(a.hullId) &&
						capacityAt(a, 0) !== capacityAt(a, n),
				);
			if (subject) replacement = n;
		}
		if (!subject)
			throw Error(
				"No armed carrier with a different replacement hold in the fixture",
			);
		const originalWorld = g.commerceWorld,
			originalTime = g.world.gameTime;
		const galaxy = g.world.system.record.galaxy;
		g.commerceWorld = observeScan(
			g.commerceWorld,
			galaxy,
			subject.key,
			g.world.gameTime,
			{ instanceOrdinal: 0, voyageOrdinal: 0 },
		);
		const recorded = g.recordedReading(subject).manifest;
		for (let n = 0; n < replacement; n++) {
			g.commerceWorld = applyTransition(
				g.commerceWorld,
				galaxy,
				subject.key,
				trafficDestruction(
					systemIndexOfKey(subject.key),
					subject.homeStationId,
					g.world.gameTime,
				),
			);
			g.world.gameTime += RAIDER_WRECK_S + RAIDER_REPAIR_S + 1;
			g.commerceWorld = advanceTo(g.commerceWorld, g.world.gameTime);
		}
		const scanStable =
			g.carrierCondition(subject.key).instanceOrdinal === replacement &&
			JSON.stringify(g.recordedReading(subject).manifest) ===
				JSON.stringify(recorded);
		g.commerceWorld = originalWorld;
		g.world.gameTime = originalTime;
		return {
			materialized,
			defence,
			paid,
			credit,
			dropAgrees,
			scanStable,
			recovered,
			saved,
			canisters: g.canisters.length,
			module,
			damage: moduleRow(module).output.damagePerS,
		};
	});
	t.check(
		"live raider materializes the carrier's seeded fit",
		result.materialized,
	);
	t.check("live raider condition reads fitted defence", result.defence);
	t.check(
		"live kill pays credit against the target's actual fit",
		Math.abs(result.paid - result.credit) < 1e-10,
		JSON.stringify(result),
	);
	t.check(
		"live kill drops the fitting selected from its actual fit",
		result.dropAgrees,
	);
	t.check(
		"a recorded scan keeps its instance's fitted hold after replacement",
		result.scanStable,
	);
	t.check(
		"scooped fitting leaves space and retains trait with zero cost",
		result.canisters === 0 &&
			result.recovered?.variant === "overcharged" &&
			result.recovered?.purchaseCostCr === 0,
	);
	t.check(
		"fitting trait survives the live save snapshot",
		result.saved?.variant === result.recovered?.variant &&
			result.saved?.grade === "A",
	);
	await page.evaluate(async () => {
		const g = window.__seelite;
		const station = g.world.system.bodies.find(
			(b) => b.kind === "station" && b.stationType === "shipyard",
		);
		await window.__parkInBerth(station.id, g.berthIdsOfStation(station.id)[0]);
		g.stationConsoleRevision++;
		g.updateCockpit();
	});
	await page.locator('[data-live-station-tab="Equipment"]').click();
	t.check(
		"carried variant is named on the cockpit Equipment tab",
		await page
			.locator("[data-live-recovered-fitting]")
			.filter({ hasText: "overcharged" })
			.isVisible(),
	);
} finally {
	await browser.close();
}
t.exit();
