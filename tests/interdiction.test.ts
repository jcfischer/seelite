/**
 * `combat-model.md` §3's interdiction contest — the headless half of node #324
 * (b). A heading contest by the principal's ruling (O1): the initiator follows
 * the target's heading at part of its turn authority, and the target breaks
 * the lock by opening the separation.
 *
 * Every row builds from the exported constants and from `flightPerformance`,
 * so a retune of the cone, the factor or a hull's thrust moves the rows with
 * it. `scripts/measure-interdiction-contest.ts` reprints the sweep the
 * constants were chosen from.
 */
import { describe, expect, test } from "bun:test";
import { COMBAT_PROTOTYPE_DEFAULTS } from "../src/combat-prototype";
import type { HullId } from "../src/hull";
import {
	type Contest,
	INTERDICTION_ACQUIRE_S,
	INTERDICTION_CHARGE_S,
	INTERDICTION_LOCK_DEG,
	INTERDICTION_TURN_FACTOR,
	beginContest,
	cruiseTurnRate,
	followHeading,
	headingSeparation,
	interdictionTurnRate,
	lockHeld,
	stepContest,
} from "../src/interdiction";
import { flightPerformance } from "../src/sim";
import { type Vec3, v3 } from "../src/vec3";

const DT = 1 / 60;
const DEG = Math.PI / 180;

/** Rotate about the y axis: a flat turn. */
const yaw = (v: Vec3, rad: number): Vec3 =>
	v3(
		v.x * Math.cos(rad) + v.z * Math.sin(rad),
		v.y,
		-v.x * Math.sin(rad) + v.z * Math.cos(rad),
	);

const AHEAD = v3(0, 0, -1);

describe("the lock", () => {
	test("aligned headings hold it", () => {
		expect(lockHeld(AHEAD, AHEAD)).toBe(true);
	});

	test("the cone's edge holds and a hair past it does not", () => {
		expect(
			lockHeld(AHEAD, yaw(AHEAD, (INTERDICTION_LOCK_DEG - 1e-6) * DEG)),
		).toBe(true);
		expect(
			lockHeld(AHEAD, yaw(AHEAD, (INTERDICTION_LOCK_DEG + 1e-3) * DEG)),
		).toBe(false);
	});

	test("headings are compared as directions, not as lengths", () => {
		expect(lockHeld(v3(0, 0, -5), v3(0, 0, -0.1))).toBe(true);
		expect(headingSeparation(v3(0, 0, -5), v3(3, 0, 0))).toBeCloseTo(
			Math.PI / 2,
			12,
		);
	});
});

describe("the contest", () => {
	const off = yaw(AHEAD, (INTERDICTION_LOCK_DEG + 5) * DEG);

	const run = (c: Contest, seconds: number, a: Vec3, b: Vec3) => {
		let contest = c;
		for (let i = 0; i < Math.round(seconds / DT); i++)
			contest = stepContest(contest, a, b, DT);
		return contest;
	};

	test("the charge is #48's tuned figure", () => {
		expect(INTERDICTION_CHARGE_S).toBe(
			COMBAT_PROTOTYPE_DEFAULTS.interdictionSeconds,
		);
	});

	test("a lock held through the charge succeeds", () => {
		expect(
			run(beginContest(), INTERDICTION_CHARGE_S - 0.1, AHEAD, AHEAD).phase,
		).toBe("charging");
		expect(
			run(beginContest(), INTERDICTION_CHARGE_S + 0.05, AHEAD, AHEAD).phase,
		).toBe("succeeded");
	});

	test("a lock lost during the charge breaks the contest, and it stays broken", () => {
		const charging = run(beginContest(), 1, AHEAD, AHEAD);
		const broken = stepContest(charging, AHEAD, off, DT);
		expect(broken.phase).toBe("broken");
		expect(run(broken, 5, AHEAD, AHEAD).phase).toBe("broken");
	});

	test("an initiator that never gets a lock gives up", () => {
		expect(
			run(beginContest(), INTERDICTION_ACQUIRE_S - 0.1, AHEAD, off).phase,
		).toBe("acquiring");
		expect(
			run(beginContest(), INTERDICTION_ACQUIRE_S + 0.05, AHEAD, off).phase,
		).toBe("lost");
	});

	test("a success is terminal", () => {
		const done = run(
			beginContest(),
			INTERDICTION_CHARGE_S + 0.05,
			AHEAD,
			AHEAD,
		);
		expect(stepContest(done, AHEAD, off, DT).phase).toBe("succeeded");
	});
});

describe("following a heading", () => {
	test("the nose turns no faster than the rate, and reaches the heading when it can", () => {
		const turned = followHeading(AHEAD, v3(1, 0, 0), 1.2, DT);
		expect(headingSeparation(AHEAD, turned)).toBeCloseTo(1.2 * DT, 12);
		const near = yaw(AHEAD, 0.5 * 1.2 * DT);
		expect(headingSeparation(followHeading(AHEAD, near, 1.2, DT), near)).toBe(
			0,
		);
	});

	test("a turn out of the plane stays out of it", () => {
		expect(followHeading(AHEAD, v3(0, 1, -1), 1.2, DT).y).toBeGreaterThan(0);
	});

	test("a reversal still turns rather than stalling", () => {
		expect(
			headingSeparation(AHEAD, followHeading(AHEAD, v3(0, 0, 1), 1.2, DT)),
		).toBeCloseTo(1.2 * DT, 9);
	});

	test("the turn authority is the hull's own, and a lock costs part of it", () => {
		const raider = flightPerformance("raider");
		expect(cruiseTurnRate(raider)).toBe(
			Math.min(raider.angularMax.pitch, raider.angularMax.yaw),
		);
		expect(interdictionTurnRate(raider)).toBe(
			cruiseTurnRate(raider) * INTERDICTION_TURN_FACTOR,
		);
	});
});

/**
 * One contest flown: the initiator follows at its lock rate, the target turns
 * at `turnFraction` of its own authority after `reactS`. Returns the phase.
 */
function fly(
	initiator: HullId,
	target: HullId,
	turnFraction: number,
	reactS: number,
) {
	const follow = interdictionTurnRate(flightPerformance(initiator));
	const turn = cruiseTurnRate(flightPerformance(target)) * turnFraction;
	let a = AHEAD;
	let b = AHEAD;
	let contest = beginContest();
	for (let t = 0; t < 10; t += DT) {
		if (t >= reactS) b = yaw(b, turn * DT);
		a = followHeading(a, b, follow, DT);
		contest = stepContest(contest, a, b, DT);
		if (contest.phase !== "acquiring" && contest.phase !== "charging")
			return { phase: contest.phase, t };
	}
	return { phase: contest.phase, t: 10 };
}

describe("a contest flown between hulls", () => {
	test("a courier holding course is interdicted", () => {
		expect(fly("raider", "courier", 0, 0).phase).toBe("succeeded");
	});

	test("a courier turning at its authority straight away escapes", () => {
		expect(fly("raider", "courier", 1, 0).phase).toBe("broken");
	});

	test("a courier that waits too long is caught", () => {
		// The skill window: past about a second of the charge, a full turn no
		// longer opens the cone before it completes.
		expect(fly("raider", "courier", 1, 1.5).phase).toBe("succeeded");
	});

	test("a courier turning at three quarters of its authority is caught", () => {
		expect(fly("raider", "courier", 0.75, 0).phase).toBe("succeeded");
	});

	test("a freighter cannot out-turn half a raider", () => {
		expect(cruiseTurnRate(flightPerformance("freighter"))).toBeLessThan(
			interdictionTurnRate(flightPerformance("raider")),
		);
		expect(fly("raider", "freighter", 1, 0).phase).toBe("succeeded");
	});

	test("symmetry: the rule is the hulls, not which ship is the player", () => {
		// §9 row 7, as far as a headless row can hold it: `stepContest` and
		// `followHeading` take no role, so the contest a courier runs against a
		// raider is the same arithmetic with the hulls swapped. A raider that
		// holds course is caught by a courier; one that turns escapes it — the
		// mirror of the rows above. That the game calls this one function for
		// both initiators is a wiring question, and the game's own row holds it.
		expect(fly("courier", "raider", 0, 0).phase).toBe("succeeded");
		expect(fly("courier", "raider", 1, 0).phase).toBe("broken");
	});
});
