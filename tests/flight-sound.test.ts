/**
 * The flight sound step (#544): flight state in, loop levels and cues out.
 * What the loops *sound* like is `audio.ts`'s and the principal's ear; this
 * holds the mapping, which is checkable without listening (#542 D3).
 */
import { expect, test } from "bun:test";
import {
	DEFAULT_FLIGHT_ARMS,
	type FlightReading,
	type FlightSoundArms,
	flightSound,
	flightSoundArms,
	QUIET_FLIGHT,
	CRUISE_C_SHARE,
	cruiseSpeedShare,
} from "../src/flight-sound";

const flying: FlightReading = {
	docked: false,
	regime: "normal",
	spool: 0,
	lever: 0.5,
	drive: 0,
	rcs: 0,
	hullShare: 1,
	cruiseSpeed: 0,
	held: false,
	hushed: false,
};
const arms = (over: Partial<FlightSoundArms> = {}): FlightSoundArms => ({
	...DEFAULT_FLIGHT_ARMS,
	...over,
});

test("the hum is always there in flight, in every regime", () => {
	for (const regime of ["normal", "spool", "cruise"] as const)
		expect(
			flightSound(QUIET_FLIGHT, { ...flying, regime }, arms(), 0.016).mix.hum,
		).toBe(1);
});

test("the drive follows applied thrust, or the lever, by arm", () => {
	// Assist on, holding speed: the lever is open and the drive is idle.
	const holding = { ...flying, lever: 0.8, drive: 0 };
	expect(flightSound(QUIET_FLIGHT, holding, arms(), 0.016).mix.drive).toBe(0);
	expect(
		flightSound(QUIET_FLIGHT, holding, arms({ drive: "lever" }), 0.016).mix
			.drive,
	).toBe(0.8);
	const burning = { ...flying, lever: 0.8, drive: 1 };
	expect(flightSound(QUIET_FLIGHT, burning, arms(), 0.016).mix.drive).toBe(1);
});

test("the drive is off in cruise, where the cruise bed replaces it", () => {
	const cruise = { ...flying, regime: "cruise" as const, lever: 1, drive: 1 };
	const { mix } = flightSound(QUIET_FLIGHT, cruise, arms(), 0.016);
	expect(mix.drive).toBe(0);
	expect(mix.cruise).toBeGreaterThan(0);
	for (const lever of [0, 1])
		expect(
			flightSound(QUIET_FLIGHT, { ...cruise, lever }, arms(), 0.016).mix.cruise,
		).toBeGreaterThan(0);
});

test("the cruise voice is the arm's", () => {
	for (const cruise of ["shimmer", "throb"] as const)
		expect(
			flightSound(QUIET_FLIGHT, flying, arms({ cruise }), 0.016).mix
				.cruiseVoice,
		).toBe(cruise);
});

test("thrusters are heard, or not, by arm", () => {
	const turning = { ...flying, rcs: 0.7 };
	expect(flightSound(QUIET_FLIGHT, turning, arms(), 0.016).mix.rcs).toBe(0.7);
	expect(
		flightSound(QUIET_FLIGHT, turning, arms({ rcs: "norcs" }), 0.016).mix.rcs,
	).toBe(0);
});

test("the spool is heard only while spooling, rising with it", () => {
	const at = (spool: number) =>
		flightSound(
			{ ...QUIET_FLIGHT, regime: "spool" },
			{ ...flying, regime: "spool", spool },
			arms(),
			0.016,
		).mix.spool;
	expect(at(0.2)).toBeLessThan(at(0.9));
	expect(flightSound(QUIET_FLIGHT, flying, arms(), 0.016).mix.spool).toBe(0);
});

test("cruise engages from a spool and drops to normal, one cue each", () => {
	const spool = { ...QUIET_FLIGHT, regime: "spool" as const };
	const engage = flightSound(
		spool,
		{ ...flying, regime: "cruise" },
		arms(),
		0.016,
	);
	expect(engage.cues).toEqual([{ kind: "cruiseEngage" }]);
	// The next frame in cruise owes nothing.
	expect(
		flightSound(engage.state, { ...flying, regime: "cruise" }, arms(), 0.016)
			.cues,
	).toEqual([]);
	const drop = flightSound(engage.state, flying, arms(), 0.016);
	expect(drop.cues).toEqual([{ kind: "cruiseDrop" }]);
});

test("a cancelled spool is no cue", () => {
	const spool = { ...QUIET_FLIGHT, regime: "spool" as const };
	expect(flightSound(spool, flying, arms(), 0.016).cues).toEqual([]);
});

test("docked: the hum by arm, and nothing of flight", () => {
	const docked = { ...flying, docked: true, lever: 1, drive: 1, rcs: 1 };
	const hum = flightSound(QUIET_FLIGHT, docked, arms(), 0.016).mix;
	expect(hum.hum).toBeGreaterThan(0);
	expect(hum.hum).toBeLessThan(1);
	expect([hum.drive, hum.rcs, hum.spool, hum.cruise]).toEqual([0, 0, 0, 0]);
	const silent = flightSound(
		QUIET_FLIGHT,
		docked,
		arms({ docked: "docksilent" }),
		0.016,
	).mix;
	expect(silent.hum).toBe(0);
	expect(silent.clickRate).toBe(0);
	expect(silent.faintClickRate).toBe(0);
});

test("clicks: loud ones react, faint ones stay sparse and steady", () => {
	const mix = (r = flying, st = QUIET_FLIGHT, a = arms()) =>
		flightSound(st, r, a, 0.016).mix;
	// At rest and whole: no loud clicks, and the faint layer ticks on.
	expect(mix().clickRate).toBe(0);
	const faint = mix().faintClickRate;
	expect(faint).toBeGreaterThan(0);
	// A damaged hull ticks loud, in proportion to the damage...
	expect(mix({ ...flying, hullShare: 0.2 }).clickRate).toBeCloseTo(
		mix({ ...flying, hullShare: 0 }).clickRate * 0.8,
		9,
	);
	// ...and the faint layer does not react.
	expect(mix({ ...flying, hullShare: 0.2 }).faintClickRate).toBe(faint);
	// A hull cooling after a burn ticks loud, and not while the burn is on.
	const hot = { ...QUIET_FLIGHT, heat: 0.8 };
	expect(mix(flying, hot).clickRate).toBeGreaterThan(0);
	expect(mix({ ...flying, drive: 0.8 }, hot).clickRate).toBe(0);
	// `noclicks` silences both layers.
	const none = mix(
		{ ...flying, hullShare: 0 },
		hot,
		arms({ clicks: "noclicks" }),
	);
	expect([none.clickRate, none.faintClickRate]).toEqual([0, 0]);
});

test("the cruise bed follows cruise speed, not the lever", () => {
	const at = (cruiseSpeed: number, lever: number) =>
		flightSound(
			QUIET_FLIGHT,
			{ ...flying, regime: "cruise", cruiseSpeed, lever },
			arms(),
			0.016,
		).mix;
	expect(at(0.2, 1).cruise).toBeLessThan(at(0.9, 1).cruise);
	expect(at(0.5, 0).cruise).toBe(at(0.5, 1).cruise);
	expect(at(0.7, 1).cruiseSpeed).toBe(0.7);
	expect(at(0, 0).cruise).toBeGreaterThan(0);
	// Out of cruise the speed is nothing to the bed.
	expect(
		flightSound(QUIET_FLIGHT, { ...flying, cruiseSpeed: 1 }, arms(), 0.016).mix
			.cruiseSpeed,
	).toBe(0);
});

test("cruise speed is a log share with light speed as the knee", () => {
	const C = 299792.458;
	const share = (kms: number) => cruiseSpeedShare(kms, 100, C, 23 * C);
	expect(share(100)).toBe(0);
	expect(share(50)).toBe(0);
	expect(share(C)).toBeCloseTo(CRUISE_C_SHARE, 9);
	expect(share(23 * C)).toBeCloseTo(1, 9);
	expect(share(1e3 * C)).toBe(1);
	// The principal's complaint: 1 to 30 c moved nothing an ear could find.
	// Now it is most of the travel, and each step up is a real move.
	expect(share(23 * C) - share(C)).toBeGreaterThan(0.6);
	for (const [lo, hi] of [
		[1, 2],
		[2, 5],
		[5, 10],
		[10, 20],
	])
		expect(share(hi * C) - share(lo * C)).toBeGreaterThan(0.1);
});

test("heat rises under a burn and falls after it, frame-rate independent", () => {
	const burn = { ...flying, drive: 1 };
	const run = (
		dt: number,
		seconds: number,
		r: FlightReading,
		s = QUIET_FLIGHT,
	) => {
		let state = s;
		for (let t = 0; t < seconds - 1e-9; t += dt)
			state = flightSound(state, r, arms(), dt).state;
		return state;
	};
	const a = run(1 / 60, 10, burn);
	const b = run(1 / 20, 10, burn);
	expect(a.heat).toBeGreaterThan(0.3);
	expect(Math.abs(a.heat - b.heat)).toBeLessThan(1e-6);
	expect(run(1 / 60, 10, flying, a).heat).toBeLessThan(a.heat);
});

test("the URL picks arms by token, and says what it did not know", () => {
	expect(flightSoundArms(null)).toEqual({
		arms: DEFAULT_FLIGHT_ARMS,
		unknown: [],
	});
	expect(flightSoundArms("legacy")).toEqual({ arms: "legacy", unknown: [] });
	expect(flightSoundArms("lever,norcs,throb,noclicks,docksilent")).toEqual({
		arms: {
			drive: "lever",
			rcs: "norcs",
			clicks: "noclicks",
			docked: "docksilent",
			cruise: "throb",
		},
		unknown: [],
	});
	expect(flightSoundArms("lever,loud")).toEqual({
		arms: { ...DEFAULT_FLIGHT_ARMS, drive: "lever" },
		unknown: ["loud"],
	});
});

test("the opening is silent: no ship sound under it, and no regime cue", () => {
	// The principal's ruling on #544: no hum under the opening.
	const step = flightSound(
		{ ...QUIET_FLIGHT, regime: "spool", heat: 0.9 },
		{
			...flying,
			hushed: true,
			regime: "cruise",
			drive: 1,
			rcs: 1,
			cruiseSpeed: 1,
			hullShare: 0,
		},
		arms(),
		0.016,
	);
	const m = step.mix;
	expect([
		m.hum,
		m.drive,
		m.rcs,
		m.spool,
		m.cruise,
		m.clickRate,
		m.faintClickRate,
	]).toEqual([0, 0, 0, 0, 0, 0, 0]);
	expect(step.cues).toEqual([]);
	// The regime is still tracked, so the first frame after it cues nothing.
	expect(step.state.regime).toBe("cruise");
});

test("paused: the motion goes quiet, the ship's own hum and ticks stay", () => {
	// The principal's ruling on #544: a paused burn does not keep its drive.
	const held = { ...flying, held: true, drive: 1, rcs: 1, lever: 1 };
	for (const regime of ["normal", "spool", "cruise"] as const) {
		const m = flightSound(
			QUIET_FLIGHT,
			{ ...held, regime, spool: 0.5, cruiseSpeed: 1 },
			arms({ drive: "lever" }),
			0,
		).mix;
		expect([m.drive, m.rcs, m.spool, m.cruise]).toEqual([0, 0, 0, 0]);
		expect(m.hum).toBe(1);
		expect(m.faintClickRate).toBeGreaterThan(0);
	}
});
