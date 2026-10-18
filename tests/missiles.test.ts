import { expect, test } from "bun:test";
import { makeModule, parseLoadout, stockLoadout } from "../src/loadout";
import {
	MISSILE,
	acquireMissileLock,
	launchMissile,
	missileAmmo,
	pulseEcm,
	fittedEcm,
	stepMissile,
	seededRaiderLoadout,
} from "../src/missiles";
import { applyDamage, fullCondition } from "../src/ship-condition";
import { v3 } from "../src/vec3";
import { MissileCombat, missileVisible } from "../src/missile-combat";

test("solid blocks acquisition; changing target or breaking cone drops lock at the press", () => {
	const combat = new MissileCombat();
	const t = { id: "t", pos: v3(0, 0, -5), vel: v3(), radiusKm: 0.03 };
	const solid = { id: "station", pos: v3(0, 0, -2), radiusKm: 1 };
	expect(missileVisible(v3(), t, [solid])).toBe(false);
	expect(missileVisible(v3(), t, [{ ...solid, pos: v3(0, 0, -5.5) }])).toBe(
		false,
	);
	expect(missileVisible(v3(), t, [{ ...solid, pos: v3(0, 0, -7) }])).toBe(true);
	combat.acquire(t, v3(), v3(0, 0, -1), [solid], 10);
	expect(combat.lock?.seconds).toBe(0);
	combat.acquire(t, v3(), v3(0, 0, -1), [], 10);
	expect(combat.lock?.seconds).toBe(MISSILE.lockS);
	combat.acquire(t, v3(), v3(0, 0, 1), [], 0);
	expect(
		combat.launch(
			{ h1: makeModule("missile-rack", 1) },
			t,
			v3(),
			v3(0, 0, 1),
			0,
		),
	).toBeNull();
});

test("AI uses the shared lock and empties its seeded rack, one round per launch", () => {
	const seed = Array.from({ length: 64 }, (_, i) => i).find(
		(i) => missileAmmo(seededRaiderLoadout(i)) > 0,
	)!;
	const combat = new MissileCombat(),
		pilot = { id: "player", pos: v3(0, 0, -5), vel: v3(), radiusKm: 0.03 };
	const initial = missileAmmo(seededRaiderLoadout(seed));
	for (let now = 0; now <= 80; now++) {
		combat.launchEnemy(seed, v3(), v3(0, 0, -1), pilot, [], now, 1);
		if (now < 8) expect(combat.missiles).toHaveLength(0);
		if (combat.missiles.length) {
			expect(combat.missiles).toHaveLength(1);
			combat.missiles = [];
		}
	}
	expect(missileAmmo(combat.enemy!.loadout)).toBe(0);
	expect(initial).toBeGreaterThan(0);
	combat.reset();
	expect(combat.enemy).toBeNull();
	expect(combat.lock).toBeNull();
});

const target = { id: "target", pos: v3(0, 0, -5), vel: v3(), radiusKm: 0.03 };
const rack = () => ({
	...stockLoadout("courier"),
	h1: makeModule("missile-rack", 1),
});
const locked = () => acquireMissileLock(null, target.id, true, MISSILE.lockS);

test("lock is uninterrupted, target-specific, and breaks with visibility or cone", () => {
	let lock = acquireMissileLock(null, "a", true, MISSILE.lockS / 2);
	expect(lock.seconds).toBeLessThan(MISSILE.lockS);
	lock = acquireMissileLock(lock, "b", true, 0.1);
	expect(lock).toEqual({ targetId: "b", seconds: 0.1 });
	expect(acquireMissileLock(lock, "b", false, 1).seconds).toBe(0);
	expect(acquireMissileLock(lock, null, true, 1).seconds).toBe(0);
	expect(launchMissile(rack(), lock, target, v3(), v3(0, 0, -1))).toBeNull();
});

test("launch spends exactly one fitted round, preserves other racks, and saves the count", () => {
	const loadout = rack();
	const out = launchMissile(loadout, locked(), target, v3(), v3(0, 0, -1))!;
	expect(out).not.toBeNull();
	expect(missileAmmo(out.loadout)).toBe(missileAmmo(loadout) - 1);
	expect(loadout.h1.ammo).toBe(4);
	expect(parseLoadout(out.loadout, "courier").h1.ammo).toBe(3);
	const two = { ...loadout, h2: makeModule("missile-rack", 1, "D") };
	const pair = launchMissile(two, locked(), target, v3(), v3(0, 0, -1))!;
	expect(pair.loadout.h2).toBe(two.h2);
	expect(missileAmmo(pair.loadout)).toBe(missileAmmo(two) - 1);
	expect(
		launchMissile(
			{ ...loadout, h1: { ...loadout.h1, ammo: 0 } },
			locked(),
			target,
			v3(),
			v3(0, 0, -1),
		),
	).toBeNull();
	expect(
		launchMissile(
			loadout,
			locked(),
			{ ...target, id: "other" },
			v3(),
			v3(0, 0, -1),
		),
	).toBeNull();
});

test("swept missile hit cannot tunnel; normal damage kills a light ship but a freighter survives", () => {
	const m = launchMissile(
		rack(),
		locked(),
		target,
		v3(),
		v3(0, 0, -1),
	)!.missile;
	expect(stepMissile(m, target, v3(), 1).hit).toBe(true);
	expect(
		applyDamage(fullCondition("courier"), MISSILE.damage, "fore").hull,
	).toBe(0);
	expect(
		applyDamage(fullCondition("freighter"), MISSILE.damage, "fore").hull,
	).toBeGreaterThan(0);
});

test("a jink behind the seeker and an expired missile miss; translation preserves flight", () => {
	const m = launchMissile(
		rack(),
		locked(),
		target,
		v3(),
		v3(0, 0, -1),
	)!.missile;
	expect(
		stepMissile(m, { ...target, pos: v3(0, 0, 5) }, v3(), 0.1).missile,
	).toBeNull();
	expect(stepMissile({ ...m, leftS: 0 }, target, v3(), 0.1).missile).toBeNull();
	const velocity = v3(30, 12, 3);
	const a = stepMissile(m, target, v3(), 0.1);
	const b = stepMissile(m, { ...target, vel: velocity }, velocity, 0.1);
	expect(b.missile!.pos.x - a.missile!.pos.x).toBeCloseTo(3);
});

test("ECM reads fitted radius and grade cooldown, spends the bank, and only defeats incoming in range", () => {
	const e = { u1: makeModule("ecm", 1, "E") };
	const a = { u1: makeModule("ecm", 3, "A") };
	expect(fittedEcm(e).radiusKm).toBe(2);
	expect(fittedEcm(a).radiusKm).toBe(6.75);
	expect(fittedEcm(a).cooldownS).toBeLessThan(fittedEcm(e).cooldownS);
	const m = launchMissile(
		rack(),
		locked(),
		target,
		v3(0, 0, -2),
		v3(0, 0, -1),
	)!.missile;
	const shots = [
		{ ...m, targetId: "player" },
		{ ...m, pos: v3(0, 0, -2.001), targetId: "player" },
		{ ...m, targetId: "other" },
	];
	const pulse = pulseEcm(e, 100, 0, 10, "player", v3(), shots);
	expect(pulse.fired).toBe(true);
	expect(pulse.energy).toBe(92);
	expect(pulse.missiles).toEqual(shots.slice(1));
	expect(pulseEcm(e, 7, 0, 10, "player", v3(), shots).fired).toBe(false);
	expect(pulseEcm(e, 100, pulse.readyAt, 10, "player", v3(), shots).fired).toBe(
		false,
	);
	expect(pulseEcm({}, 100, 0, 10, "player", v3(), shots).fired).toBe(false);
	expect(pulseEcm(a, 100, 0, 10, "player", v3(), shots).missiles).toEqual(
		shots.slice(2),
	);
	expect(
		pulseEcm(e, 100, pulse.readyAt, pulse.readyAt, "player", v3(), shots).fired,
	).toBe(true);
});

test("seeded raider racks are catalogue fits with finite ammunition, and not every raider carries one", () => {
	const ammo = Array.from({ length: 64 }, (_, seed) => {
		const fit = seededRaiderLoadout(seed);
		expect(parseLoadout(fit, "raider")).toEqual(fit);
		expect(seededRaiderLoadout(seed)).toEqual(fit);
		return missileAmmo(fit);
	});
	expect(ammo.some((n) => n > 0)).toBe(true);
	expect(ammo.some((n) => n === 0)).toBe(true);
});
