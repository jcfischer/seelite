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
			JSON.stringify(live.loadout) === JSON.stringify(expected) &&
			!Object.hasOwn(live.raider, "loadout");
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
		const replaceInstance = (key, transition) => {
			g.commerceWorld = applyTransition(
				g.commerceWorld,
				galaxy,
				key,
				transition,
			);
			g.world.gameTime += RAIDER_WRECK_S + RAIDER_REPAIR_S + 1;
			g.commerceWorld = advanceTo(g.commerceWorld, g.world.gameTime);
		};
		for (let n = 0; n < replacement; n++) {
			replaceInstance(
				subject.key,
				trafficDestruction(
					systemIndexOfKey(subject.key),
					subject.homeStationId,
					g.world.gameTime,
				),
			);
		}
		const scanStable =
			g.carrierCondition(subject.key).instanceOrdinal === replacement &&
			JSON.stringify(g.recordedReading(subject).manifest) ===
				JSON.stringify(recorded);
		g.commerceWorld = originalWorld;
		g.world.gameTime = originalTime;
		const { engage } = await import("/src/traffic-engagement.ts");
		const trafficKills = [];
		const originalCanisters = g.canisters;
		for (const hull of ["patrol", "interceptor"]) {
			const candidates = g.trafficCandidates().filter((a) => a.hullId === hull);
			const actor =
				candidates.find((a) =>
					npcFittingDrop(
						g.npcFitFor(hull, a.key),
						npcFitSeed(
							g.trafficHomeRecord(a).seed,
							a.key,
							g.carrierCondition(a.key).instanceOrdinal,
						),
					),
				) ?? candidates[0];
			if (!actor) throw Error(`No ${hull} carrier in the fixture`);
			for (let attempt = 0; attempt < 100; attempt++) {
				const instance = g.carrierCondition(actor.key).instanceOrdinal;
				if (
					npcFittingDrop(
						g.npcFitFor(hull, actor.key),
						npcFitSeed(g.trafficHomeRecord(actor).seed, actor.key, instance),
					)
				)
					break;
				replaceInstance(
					actor.key,
					trafficDestruction(
						systemIndexOfKey(actor.key),
						actor.homeStationId,
						g.world.gameTime,
					),
				);
			}
			const ordinal = g.carrierCondition(actor.key).instanceOrdinal;
			const fit = g.npcFitFor(hull, actor.key);
			const fitSeed = npcFitSeed(
				g.trafficHomeRecord(actor).seed,
				actor.key,
				ordinal,
			);
			const engagement = engage(
				{
					key: actor.key,
					hullId: hull,
					pos: g.world.ship.pos,
					vel: g.world.ship.vel,
					nose: { x: 0, y: 0, z: -1 },
					up: { x: 0, y: 1, z: 0 },
					voyageOrdinal: g.trafficVoyage(actor),
					loadout: fit,
				},
				fitSeed,
				{ assaultAlreadyCharged: false, byPilot: true },
			);
			g.trafficEngagements.set(actor.key, engagement);
			g.canisters = [];
			const beforeCredit = g.ladderPending.combat;
			const expectedCredit = killCredit(
				{ hull: g.commander.hull, loadout: g.commander.loadout },
				{ hull, loadout: fit },
			);
			const expectedFitting = npcFittingDrop(fit, fitSeed);
			g.destroyTrafficCarrier(actor, engagement);
			const fittings = g.canisters.filter((c) => c.fitting);
			trafficKills.push({
				hull,
				creditAgrees:
					Math.abs(g.ladderPending.combat - beforeCredit - expectedCredit) <
					1e-10,
				dropAgrees: expectedFitting
					? fittings.length === 1 &&
						JSON.stringify(fittings[0].fitting) ===
							JSON.stringify({ ...expectedFitting, purchaseCostCr: 0 })
					: fittings.length === 0,
				dropped: fittings.length,
				removed: !g.trafficEngagements.has(actor.key),
			});
		}
		g.canisters = originalCanisters;
		g.commerceWorld = originalWorld;
		g.world.gameTime = originalTime;
		return {
			materialized,
			defence,
			paid,
			credit,
			dropAgrees,
			scanStable,
			trafficKills,
			recovered,
			saved,
			canisters: g.canisters.length,
			module,
			damage: moduleRow(module).output.damagePerS,
		};
	});
	t.check(
		"live encounter owns the seeded fit without a second copy on the raider",
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
		"armed traffic kills pay credit against their actual seeded fits",
		result.trafficKills.every((row) => row.creditAgrees && row.removed),
		JSON.stringify(result.trafficKills),
	);
	t.check(
		"armed traffic drops retain exactly the fitting selected from their fit",
		result.trafficKills.every((row) => row.dropAgrees) &&
			result.trafficKills.some((row) => row.dropped === 1),
		JSON.stringify(result.trafficKills),
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
	const spentRack = await page.evaluate(async () => {
		const g = window.__seelite;
		const originalTime = g.world.gameTime;
		const originalWorld = g.commerceWorld;
		const { makeModule, moduleRow, stockLoadout } = await import(
			"/src/loadout.ts"
		);
		const { npcFitSeed, npcFittingDrop } = await import("/src/npc-loadout.ts");
		const { applyTransition, advanceTo } = await import("/src/world-state.ts");
		const { raiderDestruction, RAIDER_WRECK_S, RAIDER_REPAIR_S } = await import(
			"/src/raider-wreck.ts"
		);
		const { MISSILE } = await import("/src/missiles.ts");
		const { parseSave, serializeSave } = await import("/src/save-envelope.ts");
		const rack = { ...makeModule("missile-rack", 1, "A"), variant: "precise" };
		rack.ammo = moduleRow(rack).output.missiles;
		const fit = { ...stockLoadout("raider"), h2: rack };
		g.world.gameTime += RAIDER_WRECK_S + RAIDER_REPAIR_S + 1;
		g.commerceWorld = advanceTo(g.commerceWorld, g.world.gameTime);
		g.forceRaider("ahead", 0, 5);
		const encounter = g.encounter;
		if (!encounter) throw Error("No operational raider after replacement");
		const record = g.world.system.record;
		const replaceInstance = (key, transition) => {
			g.commerceWorld = applyTransition(
				g.commerceWorld,
				record.galaxy,
				key,
				transition,
			);
			g.world.gameTime += RAIDER_WRECK_S + RAIDER_REPAIR_S + 1;
			g.commerceWorld = advanceTo(g.commerceWorld, g.world.gameTime);
		};
		let found = false;
		for (let attempt = 0; attempt < 200; attempt++) {
			const seed = npcFitSeed(
				record.seed,
				encounter.slot.key,
				g.carrierCondition(encounter.slot.key).instanceOrdinal,
			);
			if (npcFittingDrop(fit, seed)?.module === "missile-rack") {
				found = true;
				break;
			}
			replaceInstance(
				encounter.slot.key,
				raiderDestruction(record.index, g.world.gameTime),
			);
		}
		if (!found) throw Error("No rack drop in the bounded raider fixture");
		encounter.origin = "defender";
		encounter.appearsAtS = g.world.gameTime;
		encounter.loadout = fit;
		g.stepRaider(0, { fired: false, damage: 0 }, []);
		g.stepMissileCombat(0, []);
		const enemy = g.missileCombat.enemy;
		enemy.lock = { targetId: "player", seconds: MISSILE.lockS };
		enemy.launchAt = g.world.gameTime;
		g.stepMissileCombat(0.05, []);
		const combat = g.encounter.raider.combat;
		g.stepRaider(0.01, { fired: false, damage: 0 }, []);
		const live = g.encounter;
		const cachedCombat = live.raider.combat === combat;
		const remaining = live.loadout.h2.ammo;
		const launched = g.missileCombat.missiles.some(
			(m) => m.targetId === "player",
		);
		g.canisters = [];
		g.endEncounter(
			live,
			{ ...live, phase: "over", end: "destroyed" },
			live.raider.flight.ship,
			undefined,
		);
		const dropped = g.canisters.find((c) => c.fitting);
		if (!dropped) throw Error("The selected rack was not dropped");
		g.world.ship.pos = { ...dropped.pos };
		g.world.ship.vel = { ...dropped.vel };
		g.stepCargoCanisters(0);
		const saved = parseSave(serializeSave(g.saveEnvelope()));
		g.world.gameTime = originalTime;
		g.commerceWorld = originalWorld;
		g.missileCombat.reset();
		return {
			launched,
			cachedCombat,
			remaining,
			expectedAmmo: rack.ammo - 1,
			dropped: dropped.fitting,
			saved: saved.commander.state.recoveredFittings?.find(
				(f) => f.module === "missile-rack",
			),
		};
	});
	t.check(
		"live raider launch spends ammunition on the actual fitted variant rack",
		spentRack.launched &&
			spentRack.cachedCombat &&
			spentRack.remaining === spentRack.expectedAmmo,
		JSON.stringify(spentRack),
	);
	t.check(
		"a live kill, scoop and save retain the rack's trait and spent ammunition",
		spentRack.dropped?.variant === "precise" &&
			spentRack.dropped?.ammo === spentRack.expectedAmmo &&
			spentRack.saved?.variant === "precise" &&
			spentRack.saved?.ammo === spentRack.expectedAmmo &&
			spentRack.saved?.purchaseCostCr === 0,
		JSON.stringify(spentRack),
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
