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
import { raiderAtDrop } from "../src/duel";
import { legEncounter, raiderSlots } from "../src/raider-slots";
import { PULSE_LASER, fullCondition } from "../src/ship-condition";
import { flightPerformance } from "../src/sim";
import { type Vec3, add, dot, length, scale, sub, v3 } from "../src/vec3";

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
}

function frame(t: number, f: Flight, fire = false): EncounterFrame {
	const ship = {
		pos: f.pos,
		vel: scale(f.nose, f.inCruise ? f.speedKms : 0.2),
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
			frameVel: v3(),
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
	},
) {
	let e = start;
	let t = start.appearsAtS - 1;
	const f: Flight = {
		pos: v3(0, 0, 0),
		nose: v3(0, 0, -1),
		inCruise: true,
		speedKms: 1_000,
	};
	let dropAt: number | null = null;
	let hits = 0;
	let firstContact: ReturnType<typeof stepEncounter>["contact"] = null;
	// Where the pilot was on the frame the contact first showed. The pilot keeps
	// moving at cruise speed afterwards, so the end-of-run position is not it.
	let pilotAtContact = { pos: f.pos, nose: f.nose };
	while (t < opts.untilS && e.phase !== "over") {
		f.inCruise = opts.cruise ? opts.cruise(t) : dropAt === null;
		f.nose = yaw(f.nose, (opts.turn?.(t) ?? 0) * DT);
		f.pos = add(f.pos, scale(f.nose, (f.inCruise ? f.speedKms : 0.2) * DT));
		const step = stepEncounter(e, frame(t, f, opts.fire?.(t) ?? false));
		if (step.drop && dropAt === null) dropAt = t;
		if (step.raiderHit) hits++;
		if (step.contact && !firstContact) {
			firstContact = step.contact;
			pilotAtContact = { pos: { ...f.pos }, nose: { ...f.nose } };
		}
		e = step.encounter;
		t += DT;
	}
	return { e, t, dropAt, hits, firstContact, pilot: pilotAtContact };
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
	test("`certain` schedules a raider on every leg with an operational slot, `none` on no leg", () => {
		for (let leg = 0; leg < 200; leg++) {
			expect(
				scheduleEncounter(ALL_UP, 5, record, leg, 0, "certain"),
			).not.toBeNull();
			expect(scheduleEncounter(ALL_UP, 5, record, leg, 0, "none")).toBeNull();
		}
	});
	test("`certain` still sends nobody when the drawn slot is down", () => {
		// The relay tells the raiders where to look; it does not conjure one.
		const NONE_UP = () => false;
		for (let leg = 0; leg < 50; leg++)
			expect(
				scheduleEncounter(NONE_UP, 5, record, leg, 0, "certain"),
			).toBeNull();
	});
	test("the default is the law", () => {
		for (let leg = 0; leg < 200; leg++)
			expect(scheduleEncounter(ALL_UP, 5, record, leg, 0, "law")).toEqual(
				scheduleEncounter(ALL_UP, 5, record, leg, 0, "law"),
			);
	});
});
