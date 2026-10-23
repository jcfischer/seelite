import { expect, test } from "bun:test";
import { HULL_IDS } from "../src/hull";
import {
	moduleRows,
	moduleRow,
	makeModule,
	parseLoadout,
	parseModule,
	stockLoadout,
	type Loadout,
} from "../src/loadout";
import { rollVariant, VARIANT_TABLE } from "../src/module-variants";
import { npcLoadout, npcFittingDrop, npcFitSeed } from "../src/npc-loadout";
import { strength, killCredit } from "../src/kill-credit";
import { carrierKey } from "../src/carrier-key";
import { derelictContents } from "../src/derelict-slots";
import { fittedCapacity } from "../src/loadout";
import { combatFit, raiderAtDrop, stepDuel } from "../src/duel";
import { fullCondition } from "../src/ship-condition";
import { steadyFrame } from "../src/sim";
import { v3 } from "../src/vec3";
import {
	applyHoldEvent,
	holdingsAfterDeath,
	type Holdings,
} from "../src/holdings";
import {
	newCommanderRecord,
	serializeSave,
	parseSave,
} from "../src/save-envelope";
import { newWorld } from "../src/world-state";
import { deathWreckContents } from "../src/death-wreck";
import { emptyRequests } from "../src/requests";
import { emptyLadderRecord, emptyPending } from "../src/ladder";
import { dropFittingCanister, stepCanisters } from "../src/raider-wreck";
import { engage, stepEngagement } from "../src/traffic-engagement";
import { launchMissile, MISSILE } from "../src/missiles";
import {
	ejectWarningDue,
	EJECT_WARNING_HULL,
	EJECT_WARNING_WINDOW_S,
} from "../src/death-cost";

test("each catalogue kind has valid single tradeoffs without mutating its base row", () => {
	for (const row of moduleRows()) {
		const base = makeModule(row.kind, row.size, row.grade);
		for (const trait of VARIANT_TABLE[row.kind]) {
			const m = { ...base, variant: trait.id };
			const projected = moduleRow(m);
			expect(parseModule(m)).toEqual(m);
			expect(projected).toEqual(moduleRow(m));
			expect(moduleRow(base)).toEqual(row);
			const changes =
				["massT", "priceCr", "drawPerS", "heatPerS"].filter(
					(k) => projected[k as "massT"] !== row[k as "massT"],
				).length +
				Object.keys(row.output).filter(
					(k) => projected.output[k] !== row.output[k],
				).length;
			expect(changes).toBe(2);
		}
	}
});

test("laser tradeoff changes actual rates once and rejects unknown or stacked traits", () => {
	const base = makeModule("pulse-laser", 1);
	const hot = { ...base, variant: "overcharged" };
	expect(moduleRow(hot).output.damagePerS).toBeCloseTo(
		moduleRow(base).output.damagePerS * 1.2,
	);
	expect(moduleRow(hot).heatPerS).toBeCloseTo(moduleRow(base).heatPerS * 1.3);
	expect(() =>
		parseModule({ ...base, variant: "overcharged+overcharged" }),
	).toThrow();
	expect(() => parseModule({ ...base, variant: ["overcharged"] })).toThrow();
	const rolled = rollVariant(hot, 47);
	expect(rolled).toEqual(hot);
});

test("derelict variants are independently seeded and one fitting in three", () => {
	let fittings = 0,
		variants = 0;
	for (let seed = 0; seed < 12000; seed++) {
		const key = carrierKey(0, "derelict-0");
		const contents = derelictContents(seed, 0, key, 0);
		expect(contents.filter((c) => c.kind === "good")).toEqual(
			derelictContents(seed, 0, key, 0, []).filter((c) => c.kind === "good"),
		);
		expect(contents).toEqual(derelictContents(seed, 0, key, 0));
		for (const c of contents)
			if (c.kind === "fitting") {
				fittings++;
				expect(c.fitting).toBeDefined();
				expect(c.fitting?.purchaseCostCr).toBe(0);
				if (c.fitting?.variant) variants++;
			}
	}
	expect(variants / fittings).toBeGreaterThan(0.31);
	expect(variants / fittings).toBeLessThan(0.36);
});

test("the flown NPC gun pays its fitted heat and energy and delivers variant damage", () => {
	const loadout = {
		...stockLoadout("raider"),
		h1: { ...makeModule("military-laser", 1, "A"), variant: "overcharged" },
	};
	const ship = { pos: v3(), vel: v3() };
	const pilot = {
		ship,
		nose: v3(0, 0, -1),
		aimOrigin: v3(),
		aimNose: v3(0, 0, -1),
		hull: 100,
		frame: steadyFrame(v3()),
		solids: [],
	};
	const condition = fullCondition("raider", fittedCapacity("raider", loadout));
	const combat = combatFit("raider", loadout);
	const step = stepDuel(
		{
			flight: { ...raiderAtDrop(v3(0, 0, -3), ship, 47), phase: "attack" },
			condition,
			combat,
		},
		pilot,
		{ fired: false, damage: 0 },
		0.01,
	);
	const row = moduleRow(loadout.h1);
	expect(step.raiderHit?.amount).toBeCloseTo(row.output.damagePerS * 0.01);
	expect(step.raider.condition.heat).toBeCloseTo(row.heatPerS * 0.01);
	expect(step.raider.condition.energy).toBeCloseTo(
		condition.energy - row.drawPerS * 0.01,
	);
	expect(step.raider.combat).toBe(combat);
	const facts = {
		podFitted: true,
		permadeath: false,
		flying: true,
		alive: true,
		hull: EJECT_WARNING_HULL + 1,
	};
	expect(ejectWarningDue(facts)).toBe(false);
	expect(
		ejectWarningDue({ ...facts, hostileDamagePerS: row.output.damagePerS }),
	).toBe(true);
	expect(
		ejectWarningDue({
			...facts,
			hull: row.output.damagePerS * EJECT_WARNING_WINDOW_S + 1,
			hostileDamagePerS: row.output.damagePerS,
		}),
	).toBe(false);
});

test("fitting canisters recover atomically with their trait and zero cost, and refuse a full hold", () => {
	const module = {
		...makeModule("pulse-laser", 1, "A"),
		variant: "overcharged",
	};
	const canisters = dropFittingCanister(
		{
			systemSeed: 47,
			government: 0,
			key: carrierKey(0, "raider-0"),
			killedAt: 10,
			pos: v3(),
			vel: v3(),
			frameVel: v3(),
			frameBodyId: null,
		},
		module,
	);
	expect(canisters).toHaveLength(1);
	const world = newWorld(47);
	const record = newCommanderRecord("courier");
	let h: Holdings = {
		commander: record.state,
		requests: emptyRequests(),
		ladders: emptyLadderRecord(),
		ladderPending: emptyPending(),
	};
	const recovered = stepCanisters(
		canisters,
		{ pos: v3(), vel: v3() },
		0,
		10,
		(c) => {
			const outcome = applyHoldEvent(h, world, {
				kind: "scoop",
				commodity: c.commodity,
				tonnes: c.tonnes,
				fitting: c.fitting,
			});
			const took = outcome.holdings !== h;
			h = outcome.holdings;
			return took ? 1 : 0;
		},
		() => steadyFrame(v3()),
	);
	expect(recovered.kept).toHaveLength(0);
	expect(h.commander.recoveredFittings?.[0]).toMatchObject({
		...module,
		tonnes: 1,
		purchaseCostCr: 0,
	});
	const full = {
		...h,
		commander: {
			...h.commander,
			cargo: { Food: fittedCapacity("courier", h.commander.loadout).holdT - 1 },
		},
	};
	expect(
		applyHoldEvent(full, world, {
			kind: "scoop",
			commodity: "fitting",
			tonnes: 1,
			fitting: module,
		}).holdings,
	).toBe(full);
});

test("a death wreck and save round trip preserve the exact variant, and do not roll it again", () => {
	const commander = newCommanderRecord("courier");
	const module = {
		...makeModule("pulse-laser", 1, "A"),
		variant: "overcharged",
		purchaseCostCr: 300,
	};
	commander.state = {
		...commander.state,
		loadout: { ...commander.state.loadout, h1: module },
	};
	let containers: ReturnType<typeof deathWreckContents> = [];
	for (
		let seed = 0;
		seed < 100 && !containers.some((c) => c.fitting?.variant);
		seed++
	)
		containers = deathWreckContents(seed, 10, commander.state, "destroyed");
	expect(containers.find((c) => c.fitting?.variant)?.fitting).toEqual(module);
	const world = newWorld(47);
	const saved = parseSave(serializeSave({ world, commander }));
	expect(saved.commander.state.loadout.h1).toEqual(module);
	expect(moduleRow(saved.commander.state.loadout.h1)).toEqual(
		moduleRow(module),
	);
	expect(rollVariant(saved.commander.state.loadout.h1, 99)).toEqual(module);
	let at = 10;
	while (
		!deathWreckContents(47, at, commander.state, "destroyed").some(
			(c) => c.fitting?.variant,
		)
	)
		at++;
	const death = holdingsAfterDeath(
		commander,
		{ world: { ...newWorld(47), gameTime: at }, commander },
		"destroyed",
	);
	const restored = parseSave(serializeSave(death));
	expect(
		restored.world.galaxies[0].deathWreck?.containers.find(
			(c) => c.fitting?.variant,
		)?.fitting,
	).toEqual(module);
});

test("NPC fits are valid, repeatable, varied, and strength reads the supplied fit", () => {
	const draws = new Set<string>();
	for (const hull of HULL_IDS)
		for (let seed = 0; seed < 40; seed++) {
			const loadout = npcLoadout(hull, seed);
			expect(parseLoadout(loadout, hull)).toEqual(loadout);
			expect(loadout).toEqual(npcLoadout(hull, seed));
			if (hull === "raider") draws.add(JSON.stringify(loadout));
		}
	expect(draws.size).toBeGreaterThan(10);
	const target = { hull: "raider" as const, loadout: npcLoadout("raider", 47) };
	expect(killCredit(target, target)).toBeCloseTo(1);
	const own = { hull: "courier" as const, loadout: stockLoadout("courier") };
	expect(killCredit(own, target)).toBeCloseTo(
		(2 * strength(target)) / (strength(own) + strength(target)),
	);
	expect(
		killCredit(own, {
			hull: "raider",
			loadout: { plant: target.loadout.plant },
		}),
	).toBe(0);
});

test("raiders drop exactly one of their fittings at fifteen percent on an independent stream", () => {
	let drops = 0;
	const loadout = npcLoadout("raider", 47);
	for (let seed = 0; seed < 12000; seed++) {
		const drop = npcFittingDrop(loadout, seed);
		expect(drop).toEqual(npcFittingDrop(loadout, seed));
		if (drop) {
			drops++;
			expect(Object.values(loadout)).toContainEqual(drop);
		}
	}
	expect(drops / 12000).toBeGreaterThan(0.14);
	expect(drops / 12000).toBeLessThan(0.16);
	const key = carrierKey(0, "raider-0");
	expect(npcFitSeed(47, key, 0)).not.toBe(npcFitSeed(47, key, 1));
});

test("armed traffic flies its seeded defence and fires every fitted combat laser", () => {
	for (const hull of ["patrol", "interceptor"] as const) {
		const key = carrierKey(0, "station-trade/traffic-02");
		const seed = npcFitSeed(47, key, 0);
		const loadout = npcLoadout(hull, seed);
		const engagement = engage(
			{
				key,
				hullId: hull,
				pos: v3(0, 0, -3),
				vel: v3(),
				nose: v3(0, 0, 1),
				up: v3(0, 1, 0),
				voyageOrdinal: 0,
				loadout,
			},
			seed,
			{ assaultAlreadyCharged: false, byPilot: true },
		);
		expect(engagement.condition).toEqual(
			fullCondition(hull, fittedCapacity(hull, loadout)),
		);
		const dt = 0.01;
		const step = stepEngagement(
			{
				...engagement,
				flight: { ...engagement.flight, phase: "attack" },
			},
			{
				ship: { pos: v3(), vel: v3() },
				nose: v3(0, 0, -1),
				aimOrigin: v3(),
				aimNose: v3(0, 0, -1),
				hull: 100,
				frame: steadyFrame(v3()),
				solids: [],
			},
			{ fired: false, damage: 0 },
			dt,
		);
		const lasers = Object.values(loadout).filter((m) =>
			["pulse-laser", "beam-laser", "military-laser"].includes(m.module),
		);
		const damage = lasers.reduce(
			(sum, m) => sum + moduleRow(m).output.damagePerS,
			0,
		);
		const heat = lasers.reduce((sum, m) => sum + moduleRow(m).heatPerS, 0);
		const energy = lasers.reduce((sum, m) => sum + moduleRow(m).drawPerS, 0);
		expect(step.returnFire?.amount).toBeCloseTo(damage * dt);
		expect(step.engagement.condition.heat).toBeCloseTo(heat * dt);
		expect(step.engagement.condition.energy).toBeCloseTo(
			engagement.condition.energy - energy * dt,
		);
		expect(step.engagement.loadout).toBe(loadout);
		expect(step.engagement.combat).toBe(engagement.combat);
	}
});

test("a dropped NPC missile rack keeps its trait and spent ammunition through recovery and save", () => {
	const rack = { ...makeModule("missile-rack", 1, "A"), variant: "precise" };
	rack.ammo = moduleRow(rack).output.missiles;
	let loadout: Loadout = { h1: rack };
	const fire = () =>
		launchMissile(
			loadout,
			{ targetId: "player", seconds: MISSILE.lockS },
			{ id: "player", pos: v3(0, 0, -3), vel: v3(), radiusKm: 0.01 },
			v3(),
			v3(0, 0, -1),
		);
	for (let shot = 0; shot < rack.ammo; shot++) {
		const launched = fire();
		expect(launched).not.toBeNull();
		loadout = launched!.loadout;
	}
	expect(loadout.h1.ammo).toBe(0);
	let drop: ReturnType<typeof npcFittingDrop>;
	for (let seed = 0; seed < 100 && !drop; seed++)
		drop = npcFittingDrop(loadout, seed);
	expect(drop).toEqual({ ...rack, ammo: 0 });
	const commander = newCommanderRecord("courier");
	const holdings: Holdings = {
		commander: commander.state,
		requests: emptyRequests(),
		ladders: emptyLadderRecord(),
		ladderPending: emptyPending(),
	};
	const world = newWorld(47);
	const recovered = applyHoldEvent(holdings, world, {
		kind: "scoop",
		commodity: "fitting",
		tonnes: 1,
		fitting: drop,
	});
	const saved = parseSave(
		serializeSave({
			world: recovered.world,
			commander: { ...commander, state: recovered.holdings.commander },
		}),
	);
	expect(saved.commander.state.recoveredFittings?.[0]).toMatchObject({
		...rack,
		ammo: 0,
		tonnes: 1,
		purchaseCostCr: 0,
	});
	expect(fire()).toBeNull();
});
