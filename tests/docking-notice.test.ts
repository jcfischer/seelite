/**
 * #597 — what a pilot is told when an entry fails or the docking computer
 * lets go. Both were invisible: `lastEntry` and the computer's refusal were
 * recorded and nothing on the glass read them.
 *
 * Tolerances are data, never the literals 35, 50 and 0.10.
 */

import { describe, expect, test } from "bun:test";
import {
	AXIS_TOLERANCE_DEG,
	ROLL_TOLERANCE_DEG,
	V_GATE_KMS,
	type EntryChecks,
	type EntryEvaluation,
	type EntryOutcome,
	newDockingState,
} from "../src/docking";
import { DIRECTOR_RANGE_KM } from "../src/docking-director";
import {
	computerNotice,
	entryNotice,
	stepDockingNotice,
} from "../src/docking-notice";

const PASSING: EntryChecks = {
	notHostile: true,
	axisAlignment: true,
	inbound: true,
	rollMatch: true,
	containment: true,
	closingSpeed: true,
};

function evaluation(
	checks: Partial<EntryChecks> = {},
	diag: Partial<EntryEvaluation> = {},
): EntryEvaluation {
	const all = { ...PASSING, ...checks };
	return {
		checks: all,
		passed: Object.values(all).every(Boolean),
		speedKms: V_GATE_KMS / 2,
		positionAngleDeg: 1,
		noseAngleDeg: 1,
		rollAngleDeg: 1,
		offsetAcrossKm: 0,
		offsetUpKm: 0,
		...diag,
	};
}

function outcome(
	ev: EntryEvaluation,
	extra: Partial<EntryOutcome> = {},
): EntryOutcome {
	const docked = ev.passed && !extra.barged && !extra.laneBlocked;
	return {
		docked,
		evaluation: ev,
		state: newDockingState(),
		damage: docked ? 0 : 1,
		repelled: null,
		barged: false,
		laneBlocked: false,
		...extra,
	};
}

const AT = { stationId: "s1", rangeKm: 0.5 };

describe("entryNotice", () => {
	test("a dock says nothing: approach control's welcome is the cue", () => {
		expect(entryNotice(outcome(evaluation()), AT)).toBeNull();
	});

	test("a geometry failure is amber and names the failed check against its tolerance", () => {
		const n = entryNotice(
			outcome(
				evaluation(
					{ axisAlignment: false },
					{ noseAngleDeg: AXIS_TOLERANCE_DEG + 6.2 },
				),
			),
			AT,
		);
		expect(n?.tone).toBe("action");
		expect(n?.text).toBe(
			`ENTRY FAILED · nose ${AXIS_TOLERANCE_DEG + 7}° of ${AXIS_TOLERANCE_DEG}°`,
		);
	});

	test("check 2 says which half failed", () => {
		const n = entryNotice(
			outcome(
				evaluation(
					{ axisAlignment: false },
					{ positionAngleDeg: AXIS_TOLERANCE_DEG + 3 },
				),
			),
			AT,
		);
		expect(n?.text).toContain(`off axis ${AXIS_TOLERANCE_DEG + 3}°`);
		expect(n?.text).not.toContain("nose");
	});

	test("a failed value never reads as equal to its tolerance", () => {
		const n = entryNotice(
			outcome(
				evaluation(
					{ rollMatch: false, closingSpeed: false },
					{
						rollAngleDeg: ROLL_TOLERANCE_DEG + 0.1,
						speedKms: V_GATE_KMS + 0.0001,
					},
				),
			),
			AT,
		);
		expect(n?.text).toContain(
			`roll ${ROLL_TOLERANCE_DEG + 1}° of ${ROLL_TOLERANCE_DEG}°`,
		);
		expect(n?.text).toContain(
			`speed ${(V_GATE_KMS + 0.01).toFixed(2)} of ${V_GATE_KMS.toFixed(2)} km/s`,
		);
	});

	test("the line carries at most two reasons, in §3's order", () => {
		const n = entryNotice(
			outcome(
				evaluation(
					{
						axisAlignment: false,
						rollMatch: false,
						containment: false,
						closingSpeed: false,
					},
					{
						noseAngleDeg: 60,
						rollAngleDeg: 80,
						speedKms: 0.5,
					},
				),
			),
			AT,
		);
		expect(n?.text).toBe(
			`ENTRY FAILED · nose 60° of ${AXIS_TOLERANCE_DEG}° · roll 80° of ${ROLL_TOLERANCE_DEG}°`,
		);
	});

	test("a failed axis check at exactly its tolerance still names the axis", () => {
		const n = entryNotice(
			outcome(
				evaluation(
					{ axisAlignment: false },
					{ positionAngleDeg: AXIS_TOLERANCE_DEG, noseAngleDeg: 1 },
				),
			),
			AT,
		);
		expect(n?.text).toBe("ENTRY FAILED · off axis");
	});

	test("containment and inbound name what happened, not a number", () => {
		expect(
			entryNotice(outcome(evaluation({ containment: false })), AT)?.text,
		).toBe("ENTRY FAILED · missed the slot");
		expect(entryNotice(outcome(evaluation({ inbound: false })), AT)?.text).toBe(
			"ENTRY FAILED · not inbound",
		);
	});

	test("a busy lane is a turn-back, not a fault, and not red", () => {
		const n = entryNotice(
			outcome(evaluation(), { laneBlocked: true, damage: 0 }),
			AT,
		);
		expect(n?.tone).toBe("action");
		expect(n?.text).toBe("TURNED BACK · lane busy · no damage");
	});

	test("a busy lane with a bad entry reports the entry", () => {
		const n = entryNotice(
			outcome(evaluation({ containment: false }), { laneBlocked: true }),
			AT,
		);
		expect(n?.text).toBe("ENTRY FAILED · missed the slot");
	});

	test("a barge is a refusal, and red", () => {
		const n = entryNotice(outcome(evaluation(), { barged: true }), AT);
		expect(n?.tone).toBe("refused");
		expect(n?.text).toBe("ENTRY REFUSED · no clearance · station hostile");
	});

	test("a hostile station with a live grant is a refusal, and red", () => {
		const n = entryNotice(outcome(evaluation({ notHostile: false })), AT);
		expect(n?.tone).toBe("refused");
		expect(n?.text).toBe("ENTRY REFUSED · station hostile");
	});
});

describe("computerNotice", () => {
	test("no refusal, no notice", () => {
		expect(computerNotice(null, AT)).toBeNull();
	});

	test("a missing grant and a hostile station are refusals", () => {
		expect(computerNotice("no-clearance", AT)).toMatchObject({
			tone: "refused",
			text: "AUTOPILOT OFF · no live clearance",
		});
		expect(computerNotice("hostile", AT)).toMatchObject({
			tone: "refused",
			text: "AUTOPILOT OFF · station hostile",
		});
	});

	test("out of range is something to act on, not a refusal", () => {
		expect(
			computerNotice("out-of-range", { stationId: "s1", rangeKm: 2e4 }),
		).toMatchObject({ tone: "action", text: "AUTOPILOT OFF · out of range" });
	});
});

describe("stepDockingNotice", () => {
	const near = entryNotice(outcome(evaluation({ containment: false })), AT);

	test("stays up inside the director's range", () => {
		expect(stepDockingNotice(near, DIRECTOR_RANGE_KM)).toBe(near);
	});

	test("clears once the ship leaves the director's range", () => {
		expect(stepDockingNotice(near, DIRECTOR_RANGE_KM + 1)).toBeNull();
	});

	// Sage round 1: a let-go posted beyond the director's range had no exit
	// but an engage or a request, and held the prompt line for a whole flight.
	describe("a notice posted beyond the director's range", () => {
		const POSTED_KM = 2e4;
		const far = computerNotice("out-of-range", {
			stationId: "s1",
			rangeKm: POSTED_KM,
		});

		test("is not cleared by the range it was posted at", () => {
			expect(stepDockingNotice(far, POSTED_KM)).toBe(far);
		});

		test("clears once the ship has moved a director's range further out", () => {
			expect(
				stepDockingNotice(far, POSTED_KM + DIRECTOR_RANGE_KM + 1),
			).toBeNull();
		});

		test("clears once the ship has closed into the director's range", () => {
			expect(stepDockingNotice(far, DIRECTOR_RANGE_KM)).toBeNull();
		});
	});

	test("no notice stays no notice", () => {
		expect(stepDockingNotice(null, 0)).toBeNull();
	});
});
