/**
 * `docs/specs/docking.md` §12 and §13's traversal law — the headless half of
 * §13.5.
 *
 * The traversal is a **sim position law**, which is the repo's standing rule
 * rather than a choice §12 made: the authoritative world is float64 kilometres
 * outside the scene graph. So it is arithmetic, and these are the rows §12.6
 * and §13.5 ask of it. The state machine's rows — the reservation's lifetime,
 * the skip, the docked tick — live in `tests/dock-session.test.ts`.
 *
 * **The route is three legs now**, so several rows below changed shape rather
 * than merely changing numbers: "ends on the axis" was true of a throat and is
 * false of a berth, and what replaces it is "ends at the berth the reservation
 * named".
 */

import { describe, expect, test } from "bun:test";
import {
	LAUNCH_RELEASE_KM,
	arrivalAttitude,
	arrivalProgress,
	arrivalRel,
	arrivalRelVelocity,
	beginArrival,
	beginLaunch,
	berthCentre,
} from "../src/arrival";
import {
	TRAVERSAL_SECONDS_DEEP,
	TRAVERSAL_SECONDS_NEAR,
	apertureFrame,
	evaluateEntry,
	slotBasis,
} from "../src/docking";
import {
	SPIN_RPM_RANGE,
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";
import { slotPhaseRad } from "../src/station";
import {
	type Berth,
	interiorAxialSpanKm,
	stationInterior,
} from "../src/station-interior";
import { type Vec3, add, cross, dot, length, scale, v3 } from "../src/vec3";

/** An axis that is not a world axis, so nothing below can pass by accident on a
 *  basis that happens to line up with x, y or z. */
const AXIS = ((): Vec3 => {
	const a = v3(0.4, -0.6, 0.69);
	const n = Math.hypot(a.x, a.y, a.z);
	return v3(a.x / n, a.y / n, a.z / n);
})();

/**
 * The slot's phase-zero direction, which `apertureFrame` takes rather than
 * deriving (#126). A fixed perpendicular to `AXIS`: in the game it is the
 * station's along-track direction, and what these rows test is the law's
 * arithmetic against *some* reference.
 */
const REFERENCE = ((): Vec3 => {
	const seed = v3(0, 0, 1);
	const p = cross(AXIS, seed);
	return scale(p, 1 / length(p));
})();

const frameOf = (type: StationType, phaseRad = 0) =>
	apertureFrame(type, AXIS, phaseRad, REFERENCE);
const interiorOf = (type: StationType) =>
	stationInterior(type, STATION_GEOMETRY[type].aperturePlaneKm);
const berthNamed = (type: StationType, id: string): Berth => {
	const berth = interiorOf(type).berths.find(
		(candidate) => candidate.id === id,
	);
	if (!berth) throw new Error(`no berth ${id} at ${type}`);
	return berth;
};

/** The pose a clean crossing leaves the ship in: on the axis at the plane,
 *  nose inward, rolled to the slot. */
function entryAt(type: StationType) {
	const frame = frameOf(type);
	return {
		frame,
		rel: scale(frame.axis, frame.planeKm),
		attitude: {
			nose: scale(frame.axis, -1),
			// Check 4's zero (#158): up along the slot's short axis.
			up: slotBasis(frame).up,
		},
	};
}

/** The law for one berth, from a clean crossing. */
function arrivalTo(type: StationType, berthId: string, startedAtS = 0) {
	const { frame, rel, attitude } = entryAt(type);
	return beginArrival(
		frame,
		interiorOf(type),
		berthNamed(type, berthId),
		rel,
		startedAtS,
		attitude,
	);
}

/** The law's endpoint, decomposed back onto the aperture basis. */
function localAt(
	law: ReturnType<typeof arrivalTo>,
	u: number,
	phaseRad = law.frame.phaseRad,
) {
	const rel = arrivalRel(law, u, phaseRad);
	const { across, up } = slotBasis({ ...law.frame, phaseRad });
	return {
		axial: dot(rel, law.frame.axis),
		across: dot(rel, across),
		up: dot(rel, up),
	};
}

describe("§13.3 — the duration is priced on the route", () => {
	test("every route in the game lies inside the ratified band", () => {
		for (const type of STATION_TYPES)
			for (const berth of interiorOf(type).berths) {
				const law = arrivalTo(type, berth.id);
				expect([
					type,
					berth.id,
					law.durationS >= TRAVERSAL_SECONDS_NEAR,
				]).toEqual([type, berth.id, true]);
				expect([
					type,
					berth.id,
					law.durationS <= TRAVERSAL_SECONDS_DEEP,
				]).toEqual([type, berth.id, true]);
			}
	});

	test("a deep berth takes longer than a near one at the same station", () => {
		// **Not a restatement of the constants.** What is under test is that the
		// interpolation reads the route rather than the band's name: a law that
		// returned the near figure for everything would pass the row above.
		const durations = interiorOf("trade").berths.map((berth) => ({
			id: berth.id,
			band: berth.band,
			seconds: arrivalTo("trade", berth.id).durationS,
		}));
		for (const near of durations.filter((row) => row.band === "near"))
			for (const deep of durations.filter((row) => row.band === "deep"))
				expect([near.id, deep.id, deep.seconds > near.seconds]).toEqual([
					near.id,
					deep.id,
					true,
				]);
		// The endpoints are reached rather than merely bounded: the shortest route
		// in the catalogue takes the near figure and the longest the deep one.
		const seconds = durations.map((row) => row.seconds);
		expect(Math.min(...seconds)).toBeCloseTo(TRAVERSAL_SECONDS_NEAR, 9);
		expect(Math.max(...seconds)).toBeCloseTo(TRAVERSAL_SECONDS_DEEP, 9);
	});

	test("a station with one depth band has no spread", () => {
		// The outpost's two berths are both near, so its catalogue offers no
		// longest route to interpolate toward and every arrival takes the near
		// figure. A law dividing by the spread would produce `NaN` here.
		for (const berth of interiorOf("outpost").berths)
			expect(arrivalTo("outpost", berth.id).durationS).toBe(
				TRAVERSAL_SECONDS_NEAR,
			);
	});
});

describe("§13.5 row 7 — it ends at the reserved berth, in the parked pose", () => {
	for (const type of STATION_TYPES)
		test(`${type}: every berth's law parks at that berth's centre`, () => {
			for (const berth of interiorOf(type).berths) {
				const law = arrivalTo(type, berth.id);
				const end = localAt(law, 1);
				const want = berthCentre(berth);
				expect(end.axial).toBeCloseTo(want.axial, 9);
				expect(end.across).toBeCloseTo(want.across, 9);
				expect(end.up).toBeCloseTo(want.up, 9);
			}
		});

	test("the parked pose is the berth's own nose and normal", () => {
		// **Both read off the berth** (#165). In a bay the nose is the aperture
		// axis on every berth — §13.3's "the exit remains straight ahead" — and
		// that was written into the law as a constant. On a pad the *normal* is
		// the axis, so a nose along it as well is not an orientation at all;
		// the berth carries its own, lying in the deck.
		for (const type of STATION_TYPES)
			for (const berth of interiorOf(type).berths) {
				const law = arrivalTo(type, berth.id);
				const { nose, up } = arrivalAttitude(law, 1, law.frame.phaseRad);
				const basis = slotBasis(law.frame);
				const inFrame = (local: {
					axial: number;
					across: number;
					up: number;
				}) =>
					add(
						scale(law.frame.axis, local.axial),
						add(scale(basis.across, local.across), scale(basis.up, local.up)),
					);
				expect([type, berth.id, dot(nose, inFrame(berth.parkedNose))]).toEqual([
					type,
					berth.id,
					expect.closeTo(1, 6),
				]);
				// Up along the berth's own normal, so a wall berth and a deck berth
				// are genuinely different roll attitudes.
				expect([type, berth.id, dot(up, inFrame(berth.normal))]).toEqual([
					type,
					berth.id,
					expect.closeTo(1, 6),
				]);
				// And the two are a basis rather than one direction twice, which
				// is the failure a pad's berth would have produced silently.
				expect([type, berth.id, Math.abs(dot(nose, up)) < 1e-6]).toEqual([
					type,
					berth.id,
					true,
				]);
			}
	});

	test("a deck berth and an overhead berth park upside down from each other", () => {
		// The row above compares each berth with its own normal, which would hold
		// on a law that gave every berth the same one. This compares two.
		const deck = arrivalTo("trade", "deck-near");
		const over = arrivalTo("trade", "overhead-near");
		const a = arrivalAttitude(deck, 1, 0).up;
		const b = arrivalAttitude(over, 1, 0).up;
		expect(dot(a, b)).toBeCloseTo(-1, 6);
	});

	test("it starts where the crossing left the ship", () => {
		const { rel } = entryAt("trade");
		const law = arrivalTo("trade", "port-deep");
		const start = arrivalRel(law, 0, law.frame.phaseRad);
		expect(dot(start, law.frame.axis)).toBeCloseTo(dot(rel, law.frame.axis), 9);
	});
});

describe("§12.6 obligation 2 — nothing re-evaluates §3's checks during it", () => {
	test("an arrival stays on one side of the plane", () => {
		// **The side is the interior's, and a pad's is the far one** (#165).
		// `planeCrossing` only fires on an inward transition, so what makes the
		// obligation hold is that the route never makes one: a bay's stays at or
		// inside the plane it entered through, and a pad's — whose berths stand
		// *on* the deck the plane is cut at — stays at or outside it. Either way
		// the route has no `outside → inside` step in it.
		for (const type of STATION_TYPES) {
			const interior = interiorOf(type);
			const pad = interior.presentation === "pad";
			for (const berth of interior.berths) {
				const law = arrivalTo(type, berth.id);
				for (let i = 0; i <= 100; i++) {
					const axial = localAt(law, i / 100).axial;
					const held = pad
						? axial >= law.frame.planeKm - 1e-9
						: axial <= law.frame.planeKm + 1e-9;
					expect([type, berth.id, held]).toEqual([type, berth.id, true]);
				}
			}
		}
	});
});

describe("§13.5 row 2 — the first leg stays inside the transit lane", () => {
	test("an entry at a corner of the aperture is inside the lane to the staging point", () => {
		// **§12.6's obligation 7, which the polyline changed the shape of.** The
		// lane *is* the aperture rectangle carried inward (§13.1), so a ship that
		// crossed the plane anywhere check 5 admits — a corner included — must
		// still be inside it when it reaches the staging point. An entry on the
		// axis cannot fail this; a corner is where it could.
		for (const type of STATION_TYPES) {
			const interior = interiorOf(type);
			const frame = frameOf(type);
			const basis = slotBasis(frame);
			// Just inside the rectangle, which is where check 5 stops admitting.
			const corner = add(
				scale(frame.axis, frame.planeKm),
				add(
					scale(basis.across, interior.laneHalfAcrossKm * 0.98),
					scale(basis.up, interior.laneHalfUpKm * 0.98),
				),
			);
			for (const berth of interior.berths) {
				const law = beginArrival(frame, interior, berth, corner, 0, {
					nose: scale(frame.axis, -1),
					up: basis.across,
				});
				for (let i = 0; i <= 200; i++) {
					const at = localAt(law, i / 200);
					// **The first leg only, which is what the lane covers.** §13.1
					// runs it "from the open mouth to a staging point"; the transfer
					// leg starts *at* that point and its whole job is to leave the
					// lane for a berth, so a rule applied past it would forbid the
					// manoeuvre §13.3 describes. A near berth's transfer runs at
					// exactly the staging depth, hence the strict comparison.
					if (at.axial <= interior.stagingAxialKm + 1e-9) continue;
					const inside =
						Math.abs(at.across) <= interior.laneHalfAcrossKm + 1e-9 &&
						Math.abs(at.up) <= interior.laneHalfUpKm + 1e-9;
					expect([type, berth.id, i, inside]).toEqual([
						type,
						berth.id,
						i,
						true,
					]);
				}
			}
		}
	});
});

describe("§13.5 rows 2 and 3 — the route stays inside the bay", () => {
	for (const type of STATION_TYPES)
		test(`${type}: every leg stays inside the enclosed volume`, () => {
			const interior = interiorOf(type);
			for (const berth of interior.berths) {
				const law = arrivalTo(type, berth.id);
				const [nearKm, farKm] = interiorAxialSpanKm(interior);
				for (let i = 0; i <= 200; i++) {
					const at = localAt(law, i / 200);
					const inside =
						at.axial <= farKm + 1e-9 &&
						at.axial >= nearKm - 1e-9 &&
						Math.abs(at.across) <= interior.halfAcrossKm + 1e-9 &&
						Math.abs(at.up) <= interior.halfUpKm + 1e-9;
					expect([type, berth.id, i, inside]).toEqual([
						type,
						berth.id,
						i,
						true,
					]);
				}
			}
		});
});

describe("§12.6 obligation 7 — the law runs in the rotating frame", () => {
	const RPM = SPIN_RPM_RANGE.maxRpm;

	test("a spinning station's berth is still hit at the end of the route", () => {
		const berth = berthNamed("trade", "starboard-deep");
		const law = arrivalTo("trade", "starboard-deep");
		const want = berthCentre(berth);
		for (let i = 0; i <= 40; i++) {
			const u = i / 40;
			const phase = slotPhaseRad(RPM, u * law.durationS);
			const at = localAt(law, u, phase);
			// Held in the rotating basis, the components are the law's own
			// regardless of how far the station has turned.
			expect(Math.abs(at.across)).toBeLessThanOrEqual(
				Math.abs(want.across) + 1e-9,
			);
		}
		const end = localAt(law, 1, slotPhaseRad(RPM, law.durationS));
		expect(end.across).toBeCloseTo(want.across, 9);
		expect(end.up).toBeCloseTo(want.up, 9);
	});

	test("a basis frozen at the start phase misses the berth", () => {
		// **The control.** Without it the row above is satisfied by a law that
		// ignores the phase entirely, which is exactly the translating-frame bug
		// §12.3 names.
		const berth = berthNamed("trade", "starboard-deep");
		const law = arrivalTo("trade", "starboard-deep");
		const spun = slotPhaseRad(RPM, law.durationS);
		const rel = arrivalRel(law, 1, spun);
		// Decomposed on the *frozen* basis instead of the turned one, the berth's
		// lateral offset is no longer where the law put it.
		const frozen = slotBasis(law.frame);
		expect(dot(rel, frozen.across)).not.toBeCloseTo(
			berthCentre(berth).across,
			6,
		);
	});

	test("the parked attitude turns with the slot", () => {
		const law = arrivalTo("trade", "port-near");
		const a = arrivalAttitude(law, 1, 0).up;
		const b = arrivalAttitude(law, 1, Math.PI / 2).up;
		expect(dot(a, b)).toBeLessThan(0.99);
	});
});

describe("§12.6 obligation 7 — a rolled entry keeps a basis all the way in", () => {
	test("no berth's arrival collapses the basis, from any roll check 4 admits", () => {
		// **The row the two-direction blend passed and the orientation slerp
		// exists for.** The nose and the up-vector each took their own great
		// circle, and at a wall berth the two circles crossed: an entry rolled to
		// the opposite `across` is antipodal to the parked up-vector, so the roll
		// turned through the slot's `up`; the nose turned from inward to outward
		// through the same plane; and half way in both landed on it. Measured on
		// trade `port-near`, `|dot(nose, up)|` was **1.0000** at u = 0.5.
		//
		// Every berth against every entry roll the slot's own basis offers. Check
		// 4 admits the two `up` rolls (0° and 180°, its own zero since #158) and
		// refuses the two `across` ones; a settle has to be well conditioned from
		// all four, because a ship that fails the check still has to be somewhere.
		for (const type of STATION_TYPES) {
			const { frame, rel } = entryAt(type);
			const basis = slotBasis(frame);
			const rolls: [string, Vec3][] = [
				["+across", basis.across],
				["-across", scale(basis.across, -1)],
				["+up", basis.up],
				["-up", scale(basis.up, -1)],
			];
			for (const berth of interiorOf(type).berths)
				for (const [name, up] of rolls) {
					const law = beginArrival(frame, interiorOf(type), berth, rel, 0, {
						nose: scale(frame.axis, -1),
						up,
					});
					let worst = 0;
					for (let i = 0; i <= 100; i++) {
						const at = arrivalAttitude(law, i / 100, frame.phaseRad);
						worst = Math.max(worst, Math.abs(dot(at.nose, at.up)));
					}
					const label = `${type} ${berth.id} entry ${name}`;
					// A basis, not a line: a tenth is nowhere near a tolerance the
					// old blend could have drifted inside — it reached 1.
					expect([label, worst < 0.1]).toEqual([label, true]);
				}
		}
	});

	test("a ship entering rolled 180° never collapses its own frame", () => {
		const { frame, rel } = entryAt("trade");
		const basis = slotBasis(frame);
		const law = beginArrival(
			frame,
			interiorOf("trade"),
			berthNamed("trade", "deck-near"),
			rel,
			0,
			{ nose: scale(frame.axis, -1), up: scale(basis.across, -1) },
		);
		for (let i = 0; i <= 100; i++) {
			const { nose, up } = arrivalAttitude(law, i / 100, frame.phaseRad);
			expect(length(nose)).toBeCloseTo(1, 6);
			expect(length(up)).toBeCloseTo(1, 6);
			// Nose and up must stay a basis: collinear is a collapsed frame.
			expect(Math.abs(dot(nose, up))).toBeLessThan(0.999);
		}
	});
});

describe("§13.3 — launch is the route run backwards", () => {
	const launchFrom = (type: StationType, berthId: string) =>
		beginLaunch(frameOf(type), interiorOf(type), berthNamed(type, berthId), 0);

	test("it starts at the berth and ends clear of the plane, outward", () => {
		for (const type of STATION_TYPES)
			for (const berth of interiorOf(type).berths) {
				const law = launchFrom(type, berth.id);
				const start = localAt(law, 0);
				const want = berthCentre(berth);
				expect(start.axial).toBeCloseTo(want.axial, 9);
				// **Clear of the plane *and* of the staging point** (#165). On a
				// bay they are the same figure; on a pad the staging point is a
				// clear height outward of the plane, and a release taken from
				// the plane alone would have the ship dip back toward the deck
				// on its way out.
				expect(localAt(law, 1).axial).toBeCloseTo(
					Math.max(law.frame.planeKm, interiorOf(type).stagingAxialKm) +
						LAUNCH_RELEASE_KM,
					9,
				);
			}
	});

	test("its axial run is monotone outward, so it cannot re-trigger a crossing", () => {
		// **Every role, not just the trade station** (#165). A pad's route rises
		// off the deck, crosses to the axis at the hover height and leaves from
		// there; get the release wrong and the last leg runs *inward*, which is
		// the one shape this row exists to catch and which no bay could produce.
		for (const type of STATION_TYPES)
			for (const berth of interiorOf(type).berths) {
				const law = launchFrom(type, berth.id);
				let previous = Number.NEGATIVE_INFINITY;
				for (let i = 0; i <= 200; i++) {
					const axial = localAt(law, i / 200).axial;
					expect([type, berth.id, axial >= previous - 1e-12]).toEqual([
						type,
						berth.id,
						true,
					]);
					previous = axial;
				}
			}
	});

	test("it settles the roll onto check 4's reference rather than turning the nose", () => {
		const law = launchFrom("trade", "overhead-deep");
		const basis = slotBasis(law.frame);
		const start = arrivalAttitude(law, 0, law.frame.phaseRad);
		const end = arrivalAttitude(law, 1, law.frame.phaseRad);
		// The nose points out at both ends — no 180° turn inside the bay.
		expect(dot(start.nose, law.frame.axis)).toBeCloseTo(1, 6);
		expect(dot(end.nose, law.frame.axis)).toBeCloseTo(1, 6);
		// And the released ship is square with the slot, which is the attitude
		// check 4 measures.
		expect(Math.abs(dot(end.up, basis.up))).toBeCloseTo(1, 6);
		const evaluation = evaluateEntry(
			law.frame,
			{
				rel: arrivalRel(law, 1, law.frame.phaseRad),
				vRel: scale(law.frame.axis, -0.01),
				nose: scale(end.nose, -1),
				up: end.up,
			},
			{ hostile: false },
		);
		expect(evaluation.checks.rollMatch).toBe(true);
	});

	test("a rotating overhead launch keeps one half-turn direction between ticks", () => {
		// The overhead berth starts with its up-vector opposite the slot's up and
		// therefore asks quaternion interpolation for an exact 180-degree roll.
		// That roll has two equally short directions. Recomputing it in the
		// rotating station frame must choose the same one at every authority tick;
		// otherwise a tiny sign change around a zero quaternion dot makes the ship
		// roll out for one 10 Hz sample and immediately roll back on the next.
		for (const berthId of ["overhead-near", "overhead-deep"]) {
			const law = launchFrom("trade", berthId);
			let previous = arrivalAttitude(law, 0, law.frame.phaseRad);
			for (let tick = 1; tick <= Math.ceil(law.durationS * 10); tick++) {
				const elapsedS = Math.min(law.durationS, tick / 10);
				const phase = slotPhaseRad(SPIN_RPM_RANGE.maxRpm, elapsedS);
				const current = arrivalAttitude(law, elapsedS / law.durationS, phase);
				const label = `${berthId} at ${elapsedS.toFixed(1)}s`;
				// Five degrees covers the station's own 1.8-degree step plus the
				// eased traversal roll. The defect is a near-half-turn discontinuity.
				expect([label, dot(previous.up, current.up) > 0.996]).toEqual([
					label,
					true,
				]);
				previous = current;
			}
		}
	});
});

describe("§12.6 obligation 9 — the velocity is the law's own", () => {
	test("it matches a finite difference of the position law", () => {
		const law = arrivalTo("trade", "starboard-deep");
		const spinRadPerS = (2 * Math.PI * SPIN_RPM_RANGE.maxRpm) / 60;
		const h = 1e-4;
		// Sampled away from the waypoints: the speed is continuous and the
		// direction turns a corner at each of them, which is what a polyline is.
		for (const u of [0.12, 0.3, 0.62, 0.88]) {
			const phase = slotPhaseRad(SPIN_RPM_RANGE.maxRpm, u * law.durationS);
			const dPhase = spinRadPerS * h;
			const a = arrivalRel(law, u - h / law.durationS, phase - dPhase);
			const b = arrivalRel(law, u + h / law.durationS, phase + dPhase);
			const numeric = scale(add(b, scale(a, -1)), 1 / (2 * h));
			const analytic = arrivalRelVelocity(law, u, phase, spinRadPerS);
			expect(length(add(numeric, scale(analytic, -1)))).toBeLessThan(1e-4);
		}
	});

	test("it is zero at both ends, so the ship is parked rather than drifting", () => {
		const law = arrivalTo("trade", "deck-deep");
		expect(
			length(arrivalRelVelocity(law, 0, law.frame.phaseRad, 0)),
		).toBeCloseTo(0, 9);
		expect(
			length(arrivalRelVelocity(law, 1, law.frame.phaseRad, 0)),
		).toBeCloseTo(0, 9);
	});
});

describe("§12.6 obligation 6 — progress is clamped", () => {
	test("it is 0 before the start and 1 from the end onward", () => {
		const law = arrivalTo("trade", "deck-near", 10);
		expect(arrivalProgress(law, 9)).toBe(0);
		expect(arrivalProgress(law, 10)).toBe(0);
		expect(arrivalProgress(law, 10 + law.durationS)).toBe(1);
		expect(arrivalProgress(law, 1e6)).toBe(1);
	});
});
