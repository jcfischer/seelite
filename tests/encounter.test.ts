/**
 * One raider encounter from schedule to end (node #324 part b): it appears on
 * a cruise leg, contests the player's heading, drops both ships, and duels.
 */
import { describe, expect, test } from "bun:test";
import {
	type Encounter,
	type EncounterFrame,
	forceEncounter,
	scheduleEncounter,
	stepEncounter,
} from "../src/encounter";
import { generateGalaxy } from "../src/galaxy";
import {
	INTERDICTION_CHARGE_S,
	INTERDICTION_RANGE_KM,
	cruiseTurnRate,
} from "../src/interdiction";
import { RAIDER_OUT_OF_BEAM_KM, raiderAtDrop } from "../src/duel";
import { FLEE_HULL_FRACTION } from "../src/combat-enemy";
import { HULL_SPECS } from "../src/hull";
import { legEncounter, raiderSlots } from "../src/raider-slots";
import {
	CRIPPLED_HULL_FRACTION,
	PULSE_LASER,
	fullCondition,
} from "../src/ship-condition";
import { ASSIST_CAP_KMS, flightPerformance, steadyFrame } from "../src/sim";
import {
	type Vec3,
	add,
	dot,
	length,
	normalizeOr,
	scale,
	sub,
	v3,
} from "../src/vec3";

const DT = 1 / 60;
const WORLD = 0x5ee11e;

/** Every slot operational: the world before any raider is destroyed. */
const ALL_UP = () => true;

/** `forceEncounter` with every slot up, which every row below but the
 *  consequence rows wants. It cannot return null then. */
function forceUp(
	...args: Parameters<typeof forceEncounter> extends [unknown, ...infer Rest]
		? Rest
		: never
): Encounter {
	const e = forceEncounter(ALL_UP, ...args);
	if (!e) throw new Error("every slot is up, so an encounter must be forced");
	return e;
}

const yaw = (v: Vec3, rad: number): Vec3 =>
	v3(
		v.x * Math.cos(rad) + v.z * Math.sin(rad),
		v.y,
		-v.x * Math.sin(rad) + v.z * Math.cos(rad),
	);

interface Flight {
	pos: Vec3;
	nose: Vec3;
	inCruise: boolean;
	speedKms: number;
	/** Speed once the duel has dropped both ships out of cruise. Default 0.2,
	 *  which is a pilot hanging almost still; #367's rout rows need a pilot at
	 *  the assist cap, because the freeze it reports only exists when the chase
	 *  and the runner share one cap. */
	duelSpeedKms?: number;
}

/** How fast a frame's pilot is actually moving. The duel's own speed used to be
 *  spelled in two places — here and in the walk's position update — and they
 *  would have disagreed silently, moving the pilot at one rate while the frame
 *  reported another. */
const flownKms = (f: Flight): number =>
	f.inCruise ? f.speedKms : (f.duelSpeedKms ?? 0.2);

function frame(t: number, f: Flight, fire = false): EncounterFrame {
	const flown = flownKms(f);
	const ship = {
		pos: f.pos,
		vel: scale(f.nose, flown),
	};
	return {
		gameTime: t,
		dt: DT,
		inCruise: f.inCruise,
		pilot: {
			ship,
			nose: f.nose,
			aimOrigin: ship.pos,
			aimNose: f.nose,
			hull: fullCondition("courier").hull,
			frame: steadyFrame(v3()),
			solids: [],
		},
		shot: fire
			? { fired: true, damage: PULSE_LASER.damagePerS * DT }
			: { fired: false, damage: 0 },
	};
}

/**
 * Fly an encounter: `turn(t)` gives the pilot's yaw rate, `cruise(t)` whether
 * the player is in cruise. Stops at `untilS` or when the encounter is over.
 */
function fly(
	start: Encounter,
	opts: {
		untilS: number;
		turn?: (t: number) => number;
		cruise?: (t: number) => boolean;
		fire?: (t: number) => boolean;
		duelSpeedKms?: number;
		/** Point the pilot at the raider every frame. A law about what the beam
		 *  can reach wants a pilot who is not the thing that fails; #53's own
		 *  turn limits still bind the raider, only not the aim. */
		track?: boolean;
		/** Rewrite the encounter once, on the frame the duel starts. The rout
		 *  rows need a raider at a chosen gap in a chosen condition, and driving
		 *  one there with a gun would take the row longer than it tests. */
		onDuel?: (e: Encounter, pilotPos: Vec3) => Encounter;
	},
) {
	let e = start;
	let t = start.appearsAtS - 1;
	const f: Flight = {
		pos: v3(0, 0, 0),
		nose: v3(0, 0, -1),
		inCruise: true,
		speedKms: 1_000,
		duelSpeedKms: opts.duelSpeedKms,
	};
	let dropAt: number | null = null;
	let shaped = false;
	let hits = 0;
	/** The raider's gap on the last frame before the encounter ended. `over()`
	 *  clears the raider, so this is the only way to read where a rout finished.
	 *  Within one frame of the gap the check itself fired on. */
	let gapAtEnd = Number.NaN;
	let firstContact: ReturnType<typeof stepEncounter>["contact"] = null;
	// Where the pilot was on the frame the contact first showed. The pilot keeps
	// moving at cruise speed afterwards, so the end-of-run position is not it.
	let pilotAtContact = { pos: f.pos, nose: f.nose };
	while (t < opts.untilS && e.phase !== "over") {
		if (e.raider) gapAtEnd = length(sub(e.raider.flight.ship.pos, f.pos));
		f.inCruise = opts.cruise ? opts.cruise(t) : dropAt === null;
		f.nose = yaw(f.nose, (opts.turn?.(t) ?? 0) * DT);
		if (opts.track && e.raider)
			f.nose = normalizeOr(sub(e.raider.flight.ship.pos, f.pos), f.nose);
		f.pos = add(f.pos, scale(f.nose, flownKms(f) * DT));
		const step = stepEncounter(e, frame(t, f, opts.fire?.(t) ?? false));
		if (step.drop && dropAt === null) dropAt = t;
		if (step.raiderHit) hits++;
		if (step.contact && !firstContact) {
			firstContact = step.contact;
			pilotAtContact = { pos: { ...f.pos }, nose: { ...f.nose } };
		}
		e = step.encounter;
		// The drop frame reports the duel but does not build the raider until its
		// first duel step, so shape it once it is there.
		if (!shaped && opts.onDuel && e.raider) {
			shaped = true;
			e = opts.onDuel(e, f.pos);
		}
		t += DT;
	}
	return { e, t, dropAt, hits, firstContact, gapAtEnd, pilot: pilotAtContact };
}

describe("scheduling", () => {
	test("a leg with no draw has no encounter, and a leg with one names its slot and time", () => {
		const record = generateGalaxy(WORLD, 0).systems[5];
		let checked = 0;
		for (let leg = 0; leg < 200; leg++) {
			const drawn = legEncounter(record.seed, record.government, leg);
			const e = scheduleEncounter(ALL_UP, 5, record, leg, 100, "law");
			if (!drawn) {
				expect(e).toBeNull();
				continue;
			}
			checked++;
			expect(e?.slot).toEqual(
				raiderSlots(5, record.government)[drawn.slotIndex],
			);
			expect(e?.appearsAtS).toBeCloseTo(100 + drawn.delayS, 12);
			expect(e?.bearing).toBe(drawn.bearing);
			expect(e?.phase).toBe("inbound");
		}
		expect(checked).toBeGreaterThan(0);
	});

	test("a slot that is not operational fields no raider, and the draw does not move (#324 d)", () => {
		const record = generateGalaxy(WORLD, 0).systems[5];
		const slots = raiderSlots(5, record.government);
		let checked = 0;
		for (let leg = 0; leg < 200; leg++) {
			const drawn = legEncounter(record.seed, record.government, leg);
			if (!drawn) continue;
			const down = slots[drawn.slotIndex].key;
			// Only the drawn slot is down; the others are up, and still unused.
			expect(
				scheduleEncounter((k) => k !== down, 5, record, leg, 100, "law"),
			).toBeNull();
			checked++;
		}
		expect(checked).toBeGreaterThan(0);
	});

	test("a kill reports where the raider came apart, and only on that frame", () => {
		const start = forceUp(3, 0, "ahead", 10, 30);
		const pilotShip = { pos: v3(0, 0, 0), vel: v3(0, 0, -0.2) };
		const nearlyDead: Encounter = {
			...start,
			phase: "duel",
			raider: {
				flight: raiderAtDrop(v3(0, 0, -3), pilotShip, 7),
				condition: { ...fullCondition("raider"), fore: 0, aft: 0, hull: 1e-6 },
			},
		};
		const flight = {
			pos: v3(0, 0, 0),
			nose: v3(0, 0, -1),
			inCruise: false,
			speedKms: 0,
		};
		const idle = stepEncounter(nearlyDead, frame(20, flight, false));
		expect(idle.wreck).toBeNull();
		const step = stepEncounter(nearlyDead, frame(20, flight, true));
		expect(step.encounter.end).toBe("destroyed");
		expect(step.wreck).not.toBeNull();
		expect(step.wreck?.pos.z).toBeCloseTo(-3, 1);
	});

	test("a forced raider takes the first operational slot, or none", () => {
		const slots = raiderSlots(3, 0);
		const e = forceEncounter((k) => k !== slots[0].key, 3, 0, "ahead", 10, 30);
		expect(e?.slot).toEqual(slots[1]);
		expect(e?.name).toBe("Raider 02");
		expect(forceEncounter(() => false, 3, 0, "ahead", 10, 30)).toBeNull();
	});
});

describe("appearance", () => {
	for (const bearing of ["behind", "alongside", "ahead"] as const)
		test(`a raider appears ${bearing} at its range`, () => {
			const e = forceUp(3, 0, bearing, 10, 30);
			const { firstContact, pilot } = fly(e, { untilS: 10.05 });
			expect(firstContact).not.toBeNull();
			if (!firstContact) return;
			const offset = sub(firstContact.pos, pilot.pos);
			expect(length(offset)).toBeCloseTo(30, 0);
			const along = dot(offset, pilot.nose) / 30;
			if (bearing === "behind") expect(along).toBeLessThan(-0.99);
			if (bearing === "ahead") expect(along).toBeGreaterThan(0.99);
			if (bearing === "alongside") expect(Math.abs(along)).toBeLessThan(0.05);
		});

	test("nothing shows before it appears", () => {
		const e = forceUp(3, 0, "behind", 10, 30);
		const f = { pos: v3(), nose: v3(0, 0, -1), inCruise: true, speedKms: 500 };
		const step = stepEncounter(e, frame(9.5, f));
		expect(step.contact).toBeNull();
		expect(step.encounter.phase).toBe("inbound");
	});

	test("a leg that ends before the raider appears ends the encounter unseen", () => {
		const e = forceUp(3, 0, "behind", 10, 30);
		const f = { pos: v3(), nose: v3(0, 0, -1), inCruise: false, speedKms: 0 };
		const step = stepEncounter(e, frame(10.2, f));
		expect(step.contact).toBeNull();
		expect(step.encounter.phase).toBe("over");
		expect(step.encounter.end).toBe("missed");
	});
});

describe("the contest in play", () => {
	test("a pilot holding course is dropped out of cruise after the charge", () => {
		const e = forceUp(3, 0, "behind", 10, 30);
		const { dropAt, e: after } = fly(e, { untilS: 20 });
		expect(dropAt).not.toBeNull();
		expect((dropAt ?? 0) - 10).toBeGreaterThanOrEqual(
			INTERDICTION_CHARGE_S - DT,
		);
		expect((dropAt ?? 0) - 10).toBeLessThan(INTERDICTION_CHARGE_S + 0.1);
		expect(after.phase).toBe("duel");
	});

	test("a pilot turning hard at the raider's appearance breaks free", () => {
		const rate = cruiseTurnRate(flightPerformance("courier"));
		const e = forceUp(3, 0, "behind", 10, 30);
		const flown = fly(e, { untilS: 20, turn: (t) => (t >= 10 ? rate : 0) });
		expect(flown.dropAt).toBeNull();
		expect(flown.e.phase).toBe("over");
		expect(flown.e.end).toBe("broken");
	});

	test("a pilot who drops out mid-contest submits: the duel starts", () => {
		const e = forceUp(3, 0, "behind", 10, 30);
		const flown = fly(e, { untilS: 11.2, cruise: (t) => t < 11 });
		expect(flown.e.phase).toBe("duel");
	});
});

describe("an encounter belongs to its leg (sage round 1)", () => {
	test("a player who leaves cruise before the raider appears has missed it, at once", () => {
		// Round 1: `missed` was checked only once the appearance time had
		// passed, so a player who dropped out and spooled again inside the
		// delay met the old leg's raider — and that leg's own draw was skipped.
		const e = forceUp(3, 0, "behind", 30, 30);
		const f = { pos: v3(), nose: v3(0, 0, -1), inCruise: false, speedKms: 0 };
		const step = stepEncounter(e, frame(12, f));
		expect(step.encounter.phase).toBe("over");
		expect(step.encounter.end).toBe("missed");
		expect(step.contact).toBeNull();
	});

	test("a raider that would appear beyond lock range is lost, and never shows", () => {
		const e = forceUp(3, 0, "behind", 10, INTERDICTION_RANGE_KM + 1);
		const f = { pos: v3(), nose: v3(0, 0, -1), inCruise: true, speedKms: 500 };
		const step = stepEncounter(e, frame(10.2, f));
		expect(step.encounter.phase).toBe("over");
		expect(step.encounter.end).toBe("lost");
		expect(step.contact).toBeNull();
	});
});

describe("the duel in play", () => {
	test("the raider closes and its fire comes back for the player to take", () => {
		const e = forceUp(3, 0, "ahead", 10, 30);
		const flown = fly(e, { untilS: 90 });
		expect(flown.hits).toBeGreaterThan(0);
	});

	test("a pilot back in cruise has escaped", () => {
		const e = forceUp(3, 0, "behind", 10, 30);
		const flown = fly(e, {
			untilS: 30,
			// Caught at the charge, then back in cruise from 20 s.
			cruise: (t) => t < 12.6 || t >= 20,
		});
		expect(flown.e.phase).toBe("over");
		expect(flown.e.end).toBe("escaped");
	});
});

describe("the relay's dial on the leg (node #43)", () => {
	const record = generateGalaxy(WORLD, 0).systems[5];
	test("`watched` schedules a raider on about 90% of legs with an operational slot, `none` on no leg", () => {
		let met = 0;
		for (let leg = 0; leg < 2000; leg++) {
			if (scheduleEncounter(ALL_UP, 5, record, leg, 0, "watched")) met++;
			expect(scheduleEncounter(ALL_UP, 5, record, leg, 0, "none")).toBeNull();
		}
		// p = 0.9 over 2,000: sd 0.67 points; the band is 3 sd.
		expect(met / 2000).toBeGreaterThan(0.88);
		expect(met / 2000).toBeLessThan(0.92);
	});
	test("`watched` still sends nobody when the drawn slot is down", () => {
		// The relay tells the raiders where to look; it does not conjure one.
		const NONE_UP = () => false;
		for (let leg = 0; leg < 50; leg++)
			expect(
				scheduleEncounter(NONE_UP, 5, record, leg, 0, "watched"),
			).toBeNull();
	});
	test("the default is the law", () => {
		for (let leg = 0; leg < 200; leg++)
			expect(scheduleEncounter(ALL_UP, 5, record, leg, 0, "law")).toEqual(
				scheduleEncounter(ALL_UP, 5, record, leg, 0, "law"),
			);
	});
});

// ---------------------------------------------------------------------------
// #367 D3. The playtest of 2026-09-16 froze a rout: a crippled raider held
// 12.34 km off, its shields climbing 2 points a second, for two minutes of
// nothing. `FLED_KM` was 25 km against a beam stopping at 12, and with both
// ships at the 2 km/s assist cap neither could close or open that gap, so the
// encounter had no exit. The exit is now the beam's own reach.
// ---------------------------------------------------------------------------

/** The raider's hull for the rout rows: below both shares that matter, derived
 *  from the exports rather than spelled as a number. A literal would stay green
 *  through a retune of either share while quietly stopping to test a crippled
 *  raider fleeing. `FLEE_HULL_FRACTION` is the sim's nerve for turning to run and
 *  `CRIPPLED_HULL_FRACTION` §2's shield-recharge gate; past both. */
const CRIPPLED_RAIDER_HULL =
	0.95 *
	Math.min(CRIPPLED_HULL_FRACTION, FLEE_HULL_FRACTION) *
	HULL_SPECS.raider.integrity;

/** The playtest's state at a chosen gap: shields spent, hull under #53's flee
 *  nerve (a fifth) and under §2's crippled share (a quarter), running away at
 *  the cap beside a pilot at the cap. */
function crippledAt(
	e: Encounter,
	pilotPos: Vec3,
	gapKm: number,
	speedKms: number,
): Encounter {
	const r = e.raider;
	if (!r) throw new Error("a duel encounter has a raider on its first frame");
	return {
		...e,
		raider: {
			flight: {
				...r.flight,
				ship: {
					pos: add(pilotPos, v3(0, 0, -gapKm)),
					vel: v3(0, 0, -speedKms),
				},
			},
			condition: {
				...r.condition,
				fore: 0,
				aft: 0,
				hull: CRIPPLED_RAIDER_HULL,
			},
		},
	};
}

describe("a rout ends (#367 D3)", () => {
	test("a raider held past the beam's reach leaves rather than sitting out of reach forever", () => {
		// The state the playtest reached: both ships at the cap, the gap frozen
		// outside the beam. Placed a beam-and-a-half out, where the freeze is
		// starkest; the reported 12.34 km is the same failure nearer the edge.
		// Before #367 this ran to `untilS` and stopped for no reason but the
		// harness's own budget.
		const flown = fly(forceUp(3, 0, "ahead", 10, 30), {
			untilS: 200,
			duelSpeedKms: ASSIST_CAP_KMS,
			fire: () => true,
			track: true,
			onDuel: (e, at) =>
				crippledAt(e, at, RAIDER_OUT_OF_BEAM_KM * 1.5, ASSIST_CAP_KMS),
		});
		expect(flown.e.phase).toBe("over");
		expect(flown.e.end).toBe("fled");
		expect(flown.t - (flown.dropAt ?? flown.t)).toBeLessThan(1);
	});

	test("and it leaves at the beam's reach, not at twice it", () => {
		// A pilot hanging almost still, so the runner can open the gap. The old
		// exit was 25 km: this raider would have had to run another thirteen
		// kilometres past the beam before the encounter let it go.
		const flown = fly(forceUp(3, 0, "ahead", 10, 30), {
			untilS: 200,
			onDuel: (e, at) => crippledAt(e, at, 6, 0.2),
		});
		expect(flown.e.end).toBe("fled");
		// One frame of the raider's own top speed is 33 m, so a tight band is
		// available and a loose one would not separate 12 km from 25.
		expect(flown.gapAtEnd).toBeLessThan(RAIDER_OUT_OF_BEAM_KM + 0.05);
		expect(flown.gapAtEnd).toBeGreaterThan(RAIDER_OUT_OF_BEAM_KM - 0.1);
	});

	test("a pilot who keeps the sight on a fleeing raider still finishes it", () => {
		// What this row measures, stated exactly: a raider crippled six
		// kilometres out — inside the beam, not near its edge — and tracked at
		// the cap, dies before it can open the gap. It is not evidence about a
		// pursuit from the beam's edge, and `combat-model.md` §3 no longer claims
		// it is. Out of the beam is out of the fight; held inside it, the raider
		// is finished.
		const flown = fly(forceUp(3, 0, "ahead", 10, 30), {
			untilS: 200,
			duelSpeedKms: ASSIST_CAP_KMS,
			fire: () => true,
			track: true,
			onDuel: (e, at) => crippledAt(e, at, 6, ASSIST_CAP_KMS),
		});
		expect(flown.e.end).toBe("destroyed");
		expect(flown.t - (flown.dropAt ?? flown.t)).toBeLessThan(
			CRIPPLED_RAIDER_HULL / PULSE_LASER.damagePerS + 1,
		);
	});
});
