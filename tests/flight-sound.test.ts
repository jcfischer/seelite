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
} from "../src/flight-sound";

const flying: FlightReading = {
	docked: false,
	regime: "normal",
	spool: 0,
	lever: 0.5,
	drive: 0,
	rcs: 0,
	hullShare: 1,
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
});

test("clicks: off, a steady sparse rate, or reacting to heat and damage", () => {
	const rate = (a: Partial<FlightSoundArms>, r = flying, s = QUIET_FLIGHT) =>
		flightSound(s, r, arms(a), 0.016).mix.clickRate;
	expect(rate({ clicks: "noclicks" })).toBe(0);
	const sparse = rate({ clicks: "sparse" });
	expect(sparse).toBeGreaterThan(0);
	// Sparse does not react.
	expect(rate({ clicks: "sparse" }, { ...flying, hullShare: 0.2 })).toBe(
		sparse,
	);
	// Reactive: a damaged hull ticks more.
	const calm = rate({ clicks: "reactive" });
	expect(
		rate({ clicks: "reactive" }, { ...flying, hullShare: 0.2 }),
	).toBeCloseTo(
		calm +
			(rate({ clicks: "reactive" }, { ...flying, hullShare: 0 }) - calm) * 0.8,
		9,
	);
	// Reactive: a hull cooling after a burn ticks more than one at rest.
	const hot = { ...QUIET_FLIGHT, heat: 0.8 };
	expect(rate({ clicks: "reactive" }, flying, hot)).toBeGreaterThan(calm);
	// ...and not while the burn is still on.
	expect(rate({ clicks: "reactive" }, { ...flying, drive: 0.8 }, hot)).toBe(
		calm,
	);
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
	expect(flightSoundArms("lever,norcs,throb,sparse,docksilent")).toEqual({
		arms: {
			drive: "lever",
			rcs: "norcs",
			clicks: "sparse",
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
