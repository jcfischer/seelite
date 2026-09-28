/**
 * Weapons and damage, by ear (#545): the mapping from one step's gun, shields,
 * hull and target to the combat cues and loops. What each sounds like is
 * `AudioFX`'s and the principal's ear; this holds *when* each one plays.
 */
import { describe, expect, test } from "bun:test";
import type { Cue } from "../src/audio-cue";
import {
	type WeaponReading,
	type WeaponSoundArms,
	type WeaponSoundState,
	weaponSound,
	weaponSoundArms,
	DEFAULT_WEAPON_ARMS,
	GIVEN_REARM_S,
	HIT_REARM_S,
	QUIET_WEAPONS,
	SIZZLE_HOLD_S,
	SIZZLE_QUIET_S,
} from "../src/weapon-sound";

const DT = 1 / 60;
const POOL = 20;

const whole: WeaponReading = {
	fired: false,
	shotSound: false,
	trigger: false,
	heatLocked: false,
	heat: 0,
	own: { fore: POOL, aft: POOL, hull: 30, poolMax: POOL, sinceStruckS: 9 },
	target: null,
};

/** `reading` with the player's own condition changed, struck this step. */
const struck = (
	over: Partial<WeaponReading["own"]>,
	from: WeaponReading = whole,
): WeaponReading => ({
	...from,
	own: { ...from.own, ...over, sinceStruckS: 0 },
});

const arms = (value: string): WeaponSoundArms => {
	const parsed = weaponSoundArms(value);
	if (parsed.arms === "legacy" || parsed.unknown.length)
		throw new Error(`bad arms ${value}`);
	return parsed.arms;
};

/** Run readings in order from a settled first one; hand back every cue and
 *  the last mix. */
function run(readings: WeaponReading[], a: WeaponSoundArms | "legacy") {
	let state: WeaponSoundState = QUIET_WEAPONS;
	const cues: Cue[] = [];
	let mix = weaponSound(state, readings[0], a, DT);
	state = mix.state;
	for (const r of readings.slice(1)) {
		mix = weaponSound(state, r, a, DT);
		state = mix.state;
		cues.push(...mix.cues);
	}
	return { cues, mix: mix.mix, state };
}

describe("the arms", () => {
	test("an empty value is the defaults, and a default is not a ruling", () => {
		expect(weaponSoundArms(null)).toEqual({
			arms: DEFAULT_WEAPON_ARMS,
			unknown: [],
		});
	});

	test("tokens pick arms, and unknown ones are handed back", () => {
		const { arms: a, unknown } = weaponSoundArms("beam,onepool,nope");
		expect(a).toEqual({
			...DEFAULT_WEAPON_ARMS,
			laser: "beam",
			pools: "onepool",
		});
		expect(unknown).toEqual(["nope"]);
	});

	test("legacy is the build before #545", () => {
		expect(weaponSoundArms("crack,legacy").arms).toBe("legacy");
	});
});

describe("the laser", () => {
	const shot: WeaponReading = {
		...whole,
		fired: true,
		shotSound: true,
		trigger: true,
	};

	test("crack and pew are a paced shot cue, each in its own voice", () => {
		expect(run([whole, shot], arms("crack")).cues).toEqual([
			{ kind: "laser", voice: "crack" },
		]);
		expect(run([whole, shot], arms("pew")).cues).toEqual([
			{ kind: "laser", voice: "pew" },
		]);
		// A fired step between paced sounds is silent.
		expect(
			run([whole, { ...shot, shotSound: false }], arms("crack")).cues,
		).toEqual([]);
	});

	test("the beam is a loop while the gun fires, and no shot cue", () => {
		const { cues, mix } = run([whole, shot], arms("beam"));
		expect(cues).toEqual([]);
		expect(mix.beam).toBe(1);
		expect(run([whole, whole], arms("beam")).mix.beam).toBe(0);
	});

	test("the beam follows the gun, not the trigger: a locked gun held is quiet", () => {
		const locked = { ...whole, trigger: true, heatLocked: true, heat: 1 };
		expect(run([whole, locked], arms("beam")).mix.beam).toBe(0);
	});

	test("heat colours the beam on heatrise, and not on heatflat", () => {
		const hot = { ...shot, heat: 0.8 };
		expect(run([whole, hot], arms("beam")).mix.heat).toBe(0.8);
		expect(run([whole, hot], arms("beam,heatflat")).mix.heat).toBe(0);
	});

	test("a pull on a locked gun clicks once, and again on the next pull", () => {
		const locked = { ...whole, trigger: true, heatLocked: true };
		const released = { ...whole, heatLocked: true };
		const { cues } = run(
			[whole, locked, locked, locked, released, locked],
			arms("lockclick"),
		);
		expect(cues).toEqual([{ kind: "gunLocked" }, { kind: "gunLocked" }]);
		expect(run([whole, locked, released, locked], arms("nolock")).cues).toEqual(
			[],
		);
	});
});

describe("hits taken", () => {
	test("a struck fall in a shield pool names the pool and what is left", () => {
		const { cues } = run([whole, struck({ aft: 5 })], DEFAULT_WEAPON_ARMS);
		expect(cues).toEqual([
			{ kind: "shieldHit", pool: "aft", share: 0.25, sided: true },
		]);
	});

	test("onepool drops the side, flat drops the share", () => {
		expect(
			run([whole, struck({ fore: 5 })], arms("onepool,flat")).cues,
		).toEqual([{ kind: "shieldHit", pool: "fore", share: 1, sided: false }]);
	});

	test("a struck fall in hull is a hull hit in the arm's voice", () => {
		const bare = { ...whole, own: { ...whole.own, fore: 0 } };
		expect(run([bare, struck({ hull: 20 }, bare)], arms("clang")).cues).toEqual(
			[{ kind: "hullHit", voice: "clang" }],
		);
		expect(run([bare, struck({ hull: 20 }, bare)], arms("thud")).cues).toEqual([
			{ kind: "hullHit", voice: "thud" },
		]);
	});

	test("a hit through the shield onto the hull is both", () => {
		const { cues } = run(
			[whole, struck({ fore: 0, hull: 25 })],
			DEFAULT_WEAPON_ARMS,
		);
		expect(cues.map((c) => c.kind)).toEqual(["shieldHit", "hullHit"]);
	});

	test("a fall with no strike is not a hit: a condition replaced downward", () => {
		// `Game.play` owed this gate before #545 (#552): the delta reads any fall,
		// so a whole ship swapped for a lesser one would have cued. `applyDamage`
		// zeroes `sinceStruckS`; a replacement does not.
		const replaced: WeaponReading = {
			...whole,
			own: { fore: 10, aft: 10, hull: 12, poolMax: POOL, sinceStruckS: 4 },
		};
		expect(run([whole, replaced], DEFAULT_WEAPON_ARMS).cues).toEqual([]);
	});

	test("recharge is not a hit", () => {
		const low = struck({ fore: 2, aft: 3 });
		const settled = { ...low, own: { ...low.own, sinceStruckS: 0.5 } };
		const up = {
			...settled,
			own: { ...settled.own, fore: 4, sinceStruckS: 5 },
		};
		expect(run([settled, up], DEFAULT_WEAPON_ARMS).cues).toEqual([]);
	});

	/** One second of a held beam on the fore pool: a fall every frame. */
	const heldBeam = (seconds: number): WeaponReading[] => {
		const out: WeaponReading[] = [whole];
		for (let i = 1; i <= Math.round(seconds / DT); i++)
			out.push(struck({ fore: POOL - i * 0.1 }));
		return out;
	};

	test("rearm: a held beam cues once per re-arm, not per frame", () => {
		const { cues } = run(heldBeam(1), arms("rearm"));
		expect(cues.length).toBe(Math.ceil(1 / HIT_REARM_S));
		expect(run(heldBeam(1), arms("rearm")).mix.sizzleFore).toBe(0);
	});

	test("sizzle: a held beam is one impact and then a loop on its pool", () => {
		const { cues, mix } = run(heldBeam(1), arms("sizzle"));
		expect(cues.length).toBe(1);
		expect(mix.sizzleFore).toBe(1);
		expect(mix.sizzleAft).toBe(0);
	});

	test("sizzle lets go when the fire stops, and a fresh volley is a new impact", () => {
		const beam = heldBeam(0.5);
		const last = beam[beam.length - 1];
		const quiet: WeaponReading = {
			...last,
			own: { ...last.own, sinceStruckS: 1 },
		};
		const gap = Array.from(
			{ length: Math.ceil(SIZZLE_QUIET_S / DT) + 1 },
			() => quiet,
		);
		const again = struck({ fore: last.own.fore - 1 }, quiet);
		const { cues, state } = run([...beam, ...gap], arms("sizzle"));
		expect(cues.length).toBe(1);
		const after = weaponSound(state, quiet, arms("sizzle"), DT);
		expect(after.mix.sizzleFore).toBe(0);
		expect(weaponSound(state, again, arms("sizzle"), DT).cues.length).toBe(1);
		expect(SIZZLE_HOLD_S).toBeLessThan(SIZZLE_QUIET_S);
	});

	test("the re-arm is kept per pool, so a hit aft is not swallowed by one fore", () => {
		const fore = struck({ fore: 9 });
		const both = struck({ fore: 9, aft: 9 }, fore);
		expect(run([whole, fore, both], arms("rearm")).cues).toEqual([
			{ kind: "shieldHit", pool: "fore", share: 0.45, sided: true },
			{ kind: "shieldHit", pool: "aft", share: 0.45, sided: true },
		]);
	});
});

describe("hits landed", () => {
	const target = (id: string, fore: number, hull = 30) => ({
		id,
		fore,
		aft: POOL,
		hull,
	});
	const on = (t: WeaponReading["target"]): WeaponReading => ({
		...whole,
		target: t,
	});

	test("a fall on the selected target is a landed hit, shield then hull", () => {
		const { cues } = run(
			[on(target("r", 20)), on(target("r", 10))],
			DEFAULT_WEAPON_ARMS,
		);
		expect(cues).toEqual([{ kind: "hitLanded", on: "shield" }]);
		const bare = run(
			[on(target("r", 0, 30)), on(target("r", 0, 25))],
			DEFAULT_WEAPON_ARMS,
		);
		expect(bare.cues).toEqual([{ kind: "hitLanded", on: "hull" }]);
	});

	test("switching to a weaker target is not a hit", () => {
		expect(
			run([on(target("a", 20)), on(target("b", 2))], DEFAULT_WEAPON_ARMS).cues,
		).toEqual([]);
		// Nor is picking one after none.
		expect(
			run([on(null), on(target("b", 2))], DEFAULT_WEAPON_ARMS).cues,
		).toEqual([]);
	});

	test("landed hits re-arm, and nogiven is silent", () => {
		const readings = [on(target("r", 20))];
		for (let i = 1; i <= 60; i++) readings.push(on(target("r", 20 - i * 0.2)));
		expect(run(readings, DEFAULT_WEAPON_ARMS).cues.length).toBe(
			Math.ceil(1 / GIVEN_REARM_S),
		);
		expect(run(readings, arms("nogiven")).cues).toEqual([]);
	});
});

describe("legacy", () => {
	test("is the pew per paced shot, and every hit silent", () => {
		const shot = { ...whole, fired: true, shotSound: true, trigger: true };
		const { cues, mix } = run(
			[whole, shot, struck({ fore: 2, hull: 3 }, shot)],
			"legacy",
		);
		expect(cues).toEqual([
			{ kind: "laser", voice: "pew" },
			{ kind: "laser", voice: "pew" },
		]);
		expect(mix).toEqual({ beam: 0, heat: 0, sizzleFore: 0, sizzleAft: 0 });
	});
});
