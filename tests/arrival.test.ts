/**
 * `docs/specs/docking.md` §12's arrival law — the headless half of §12.6.
 *
 * The arrival is a **sim position law**, which is the repo's standing rule
 * rather than a choice §12 made: the authoritative world is float64 kilometres
 * outside the scene graph. So it is arithmetic, and these are the rows §12.6
 * asks of it — 1, 2, 6 and 7. Rows 3, 4, 5, 8 and 9 are about the game's state
 * machine rather than the law, and live in `tests/dock-session.test.ts`.
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
	dockedAxialKm,
	throatDepthKm,
} from "../src/arrival";
import {
	ARRIVAL_SECONDS,
	ARRIVAL_SECONDS_MAX,
	ARRIVAL_SECONDS_MIN,
	apertureFrame,
	evaluateEntry,
	slotBasis,
} from "../src/docking";
import {
	SPIN_RPM_RANGE,
	STATION_GEOMETRY,
	STATION_TYPES,
} from "../src/station";
import { slotPhaseRad } from "../src/station";
import { type Vec3, add, cross, dot, length, scale, v3 } from "../src/vec3";

/** An axis that is not a world axis, so nothing below can pass by accident on a
 *  basis that happens to line up with x, y or z. */
const AXIS = ((): Vec3 => {
	const a = v3(0.4, -0.6, 0.69);
	const n = Math.hypot(a.x, a.y, a.z);
	return v3(a.x / n, a.y / n, a.z / n);
})();

/**
 * The slot's phase-zero direction, which `apertureFrame` now takes rather than
 * deriving (#126). A fixed perpendicular to `AXIS`: in the game it is the
 * station's along-track direction, and what these rows test is the checks'
 * arithmetic against *some* reference, which is what it always was.
 */
const REFERENCE = ((): Vec3 => {
	const seed = v3(0, 0, 1);
	const p = cross(AXIS, seed);
	return scale(p, 1 / length(p));
})();

const frameOf = (type: "trade" | "refinery", phaseRad = 0) =>
	apertureFrame(type, AXIS, phaseRad, REFERENCE);

/** The ship's offset decomposed back onto the station's aperture basis **at the
 *  phase it is being asked about** — which is the whole subject of obligation 7.
 *  A translating-frame law is one whose lateral components, read this way, walk
 *  away from where they started. */
function local(frame: ReturnType<typeof frameOf>, phaseRad: number, rel: Vec3) {
	const at = { ...frame, phaseRad };
	const { across, up } = slotBasis(at);
	return {
		axial: dot(rel, frame.axis),
		across: dot(rel, across),
		up: dot(rel, up),
	};
}

/** A crossing pose near the slot's corner — the offset a centred entry does not
 *  have, and the one a rotating-frame error moves. */
function cornerEntry(
	type: "trade" | "refinery",
	phaseRad: number,
	sx = 1,
	sy = 1,
): Vec3 {
	const frame = frameOf(type, phaseRad);
	const { across, up } = slotBasis(frame);
	const a = STATION_GEOMETRY[type].aperture;
	return add(
		scale(frame.axis, frame.planeKm),
		add(
			scale(across, sx * a.widthKm * 0.45),
			scale(up, sy * a.heightKm * 0.45),
		),
	);
}

/** The four corners of the rectangle. A frozen-basis law escapes through some
 *  of them and not others — the offset is carried round the axis, so which
 *  corner leaves first is a function of the spin's sign. A control that fixed
 *  one corner would be a control that passes or fails on that choice. */
const CORNERS: [number, number][] = [
	[1, 1],
	[1, -1],
	[-1, 1],
	[-1, -1],
];

describe("§12.4 E7/E8 — the throat is a function of the aperture", () => {
	test("every type's throat fits inside its own plane", () => {
		for (const type of STATION_TYPES) {
			const g = STATION_GEOMETRY[type];
			// A throat deeper than the plane would put the docked position on the
			// far side of the station's centre — through the hull and out. Against
			// `aperturePlaneKm` and not the core radius, because since #128 that
			// is the surface the throat is cut back from.
			expect([type, dockedAxialKm(g) > 0]).toEqual([type, true]);
			expect([type, dockedAxialKm(g) < g.aperturePlaneKm]).toEqual([
				type,
				true,
			]);
		}
	});

	test("a slot gets a throat and a pad gets a touchdown", () => {
		// E8: the rule is one and the presentation is two. A pad is an exterior
		// deck with no inside, so its docked offset is a hair rather than a
		// throat-depth — and "a hair" has to be smaller than the shallowest
		// throat, or the two presentations are the same thing.
		const slot = STATION_GEOMETRY.trade;
		const pad = STATION_GEOMETRY.refinery;
		expect(throatDepthKm(slot.aperture)).toBeGreaterThan(
			throatDepthKm(pad.aperture),
		);
		expect(slot.coreRadiusKm - dockedAxialKm(slot)).toBeGreaterThan(
			10 * (pad.coreRadiusKm - dockedAxialKm(pad)),
		);
	});

	test("it is read from the aperture, not from a list of forms", () => {
		// E7: "which forms get a throat is decided by `aperture.kind`, not by a
		// list here". A retune of the slot must move the throat.
		const retuned = { kind: "slot", widthKm: 0.24, heightKm: 0.14 } as const;
		expect(throatDepthKm(retuned)).toBe(
			2 * throatDepthKm(STATION_GEOMETRY.trade.aperture),
		);
	});
});

describe("§12.6 obligation 6 — the duration is inside E3's bounds", () => {
	test("the shipped value is four to six seconds", () => {
		// Without this row the range is prose: "it terminates" is satisfied by an
		// arrival of any length, so a retune to twelve seconds would pass every
		// other row in this file.
		expect(ARRIVAL_SECONDS).toBeGreaterThanOrEqual(ARRIVAL_SECONDS_MIN);
		expect(ARRIVAL_SECONDS).toBeLessThanOrEqual(ARRIVAL_SECONDS_MAX);
	});
});

describe("§12.6 obligation 1 — it terminates at the docked position", () => {
	for (const type of ["trade", "refinery"] as const) {
		test(`${type}: the law ends at the docked position, on the axis`, () => {
			const law = beginArrival(frameOf(type), cornerEntry(type, 0), 0);
			expect(arrivalProgress(law, law.startedAtS + ARRIVAL_SECONDS)).toBe(1);
			// Past the end it stays clamped: an arrival that kept integrating
			// would drive the ship through the far wall.
			expect(arrivalProgress(law, law.startedAtS + 600)).toBe(1);
			const end = local(frameOf(type), 0, arrivalRel(law, 1, 0));
			expect(end.axial).toBeCloseTo(dockedAxialKm(STATION_GEOMETRY[type]), 9);
			expect(end.across).toBeCloseTo(0, 9);
			expect(end.up).toBeCloseTo(0, 9);
		});
	}

	test("it starts where the crossing left the ship", () => {
		const entry = cornerEntry("trade", 0);
		const law = beginArrival(frameOf("trade"), entry, 0);
		const start = local(frameOf("trade"), 0, arrivalRel(law, 0, 0));
		const want = local(frameOf("trade"), 0, entry);
		expect(start.axial).toBeCloseTo(want.axial, 12);
		expect(start.across).toBeCloseTo(want.across, 12);
		expect(start.up).toBeCloseTo(want.up, 12);
	});
});

describe("§12.6 obligation 2 — nothing re-evaluates §3's checks during it", () => {
	test("the arrival never crosses the plane outward", () => {
		// `planeCrossing` only fires on an *inward* crossing, so the law would
		// have to leave and re-enter to re-trigger the checks. This asserts the
		// stronger property: it never leaves at all.
		const law = beginArrival(frameOf("trade"), cornerEntry("trade", 0), 0);
		for (let i = 0; i <= 200; i++) {
			const u = i / 200;
			const axial = dot(arrivalRel(law, u, 0), AXIS);
			expect(axial).toBeLessThanOrEqual(law.frame.planeKm + 1e-12);
		}
	});
});

describe("§12.6 obligation 7 — both traversals are in the rotating frame", () => {
	/**
	 * §12.3 names a translating-frame law as the one way a scripted path still
	 * ends somewhere it was not put, and §12.6 asks for **every sub-step**,
	 * because a law that is right at the endpoints and wrong between them is
	 * exactly what that implementation looks like.
	 *
	 * Run at both ends of §4's spin range, in both directions.
	 */
	for (const rpm of [SPIN_RPM_RANGE.minRpm, SPIN_RPM_RANGE.maxRpm]) {
		for (const kind of ["arrival", "launch"] as const) {
			test(`${kind} at ${rpm} rpm stays inside the throat's cross-section`, () => {
				const a = STATION_GEOMETRY.trade.aperture;
				const t0 = 137.5;
				const phase0 = slotPhaseRad(rpm, t0);
				const law =
					kind === "arrival"
						? beginArrival(
								frameOf("trade", phase0),
								cornerEntry("trade", phase0),
								t0,
							)
						: beginLaunch(frameOf("trade", phase0), t0);
				for (let i = 0; i <= 400; i++) {
					const u = i / 400;
					const t = t0 + u * law.durationS;
					const phase = slotPhaseRad(rpm, t);
					const p = local(
						frameOf("trade", phase),
						phase,
						arrivalRel(law, u, phase),
					);
					expect(Math.abs(p.across)).toBeLessThanOrEqual(a.widthKm / 2 + 1e-12);
					expect(Math.abs(p.up)).toBeLessThanOrEqual(a.heightKm / 2 + 1e-12);
				}
			});
		}
	}

	/**
	 * **The control.** Could the rows above pass on a build that ignored the
	 * thing they check? A law that froze the aperture basis at the phase it
	 * started — the translating-frame implementation — is that build, and this
	 * asserts it *fails*. Without this row, a law that never moves laterally at
	 * all would satisfy every containment assertion above.
	 */
	test("a basis frozen at the start phase leaves the cross-section", () => {
		const rpm = SPIN_RPM_RANGE.maxRpm;
		const a = STATION_GEOMETRY.trade.aperture;
		const t0 = 137.5;
		const phase0 = slotPhaseRad(rpm, t0);
		const escapes = CORNERS.filter(([sx, sy]) => {
			const frozen = beginArrival(
				frameOf("trade", phase0),
				cornerEntry("trade", phase0, sx, sy),
				t0,
			);
			for (let i = 0; i <= 400; i++) {
				const u = i / 400;
				const phase = slotPhaseRad(rpm, t0 + u * frozen.durationS);
				// The frozen-basis position: the law evaluated as though the
				// station never turned, read against the slot as it actually is.
				const p = local(
					frameOf("trade", phase),
					phase,
					arrivalRel(frozen, u, phase0),
				);
				if (
					Math.abs(p.across) > a.widthKm / 2 ||
					Math.abs(p.up) > a.heightKm / 2
				)
					return true;
			}
			return false;
		});
		// Not "all four": the spin carries an offset round the axis, so a corner
		// on the leading side has room to turn into and one on the trailing side
		// does not. What the control has to show is that the frozen build is
		// **detectably** wrong, which one escaping corner does.
		expect(escapes.length).toBeGreaterThan(0);
	});

	test("the ship's attitude turns with the slot", () => {
		const rpm = SPIN_RPM_RANGE.maxRpm;
		const t0 = 0;
		const law = beginArrival(frameOf("trade", 0), cornerEntry("trade", 0), t0);
		// At the end of the arrival the ship is rolled to the slot: its up-vector
		// is the slot's up at that instant, not at the one it entered on.
		const tEnd = t0 + law.durationS;
		const phaseEnd = slotPhaseRad(rpm, tEnd);
		const { up } = arrivalAttitude(law, 1, phaseEnd);
		const slot = slotBasis(frameOf("trade", phaseEnd));
		// **Against `across`, which is what check 4 accepts**: `evaluateEntry`
		// measures the roll as `|dot(shipUp, basis.across)|`. Asserting against
		// `basis.up` is the 90°-out build, and it looked identical to this one in
		// every other row here.
		expect(dot(up, slot.across)).toBeCloseTo(1, 9);
		// And the nose points *into* the station — down the inward axis.
		const { nose } = arrivalAttitude(law, 1, phaseEnd);
		expect(dot(nose, AXIS)).toBeCloseTo(-1, 9);
	});

	/**
	 * **An inverted entry must not collapse the ship's basis.**
	 *
	 * Check 4 compares against the axis *line*, so a ship crossing rolled 180°
	 * passes it — and its up-vector is then antipodal to the one the arrival
	 * settles to. A blend turned through the docking axis puts the up-vector
	 * *on* that axis at the half-way point, collinear with the nose: the
	 * orientation stops being a basis at all, mid-arrival, on a pose the checks
	 * accepted.
	 */
	test("a ship entering rolled 180° keeps a basis all the way in", () => {
		const phase = 0.7;
		const frame = frameOf("trade", phase);
		const slot = slotBasis(frame);
		const law = beginArrival(frame, cornerEntry("trade", phase), 0, {
			nose: scale(AXIS, -1),
			// Rolled 180°: `|dot(up, across)|` is 1, so check 4 passes.
			up: scale(slot.across, -1),
		});
		for (let i = 0; i <= 60; i++) {
			const { nose, up } = arrivalAttitude(law, i / 60, phase);
			// Perpendicular to within the rounding of two unit vectors, at every
			// sub-step — not merely at the ends, which is where a collapse hides.
			expect([i, Math.abs(dot(nose, up)) < 1e-9]).toEqual([i, true]);
		}
	});

	/**
	 * **The row that would have caught the 90°-out build**, and the reason it is
	 * phrased through `evaluateEntry` rather than against a vector: the question
	 * is not "does the attitude equal the one this module computed", which is a
	 * tautology, but "would the docking checks accept the ship where the arrival
	 * parks it". A parked attitude check 4 refuses is a ship lying crossways in
	 * a slot it just passed a roll test to enter.
	 */
	test("the parked attitude is one check 4 accepts", () => {
		for (const rpm of [SPIN_RPM_RANGE.minRpm, SPIN_RPM_RANGE.maxRpm]) {
			const t = 91.25;
			const phase = slotPhaseRad(rpm, t);
			const frame = frameOf("trade", phase);
			const law = beginArrival(frame, cornerEntry("trade", phase), t);
			const { nose, up } = arrivalAttitude(law, 1, phase);
			const evaluation = evaluateEntry(
				frame,
				{
					rel: arrivalRel(law, 1, phase),
					// At rest in the station's frame, which is where §12.2 parks it.
					vRel: v3(0, 0, 0),
					nose,
					up,
				},
				{ hostile: false },
			);
			expect([rpm, evaluation.checks.rollMatch]).toEqual([rpm, true]);
			expect([rpm, evaluation.rollAngleDeg < 1e-6]).toEqual([rpm, true]);
		}
	});
});

describe("§12.2 — launch is the mirror, and it releases outside the plane", () => {
	test("it starts docked and ends clear of the plane, outward", () => {
		const law = beginLaunch(frameOf("trade", 0), 0);
		const start = local(frameOf("trade"), 0, arrivalRel(law, 0, 0));
		expect(start.axial).toBeCloseTo(dockedAxialKm(STATION_GEOMETRY.trade), 9);
		const end = local(frameOf("trade"), 0, arrivalRel(law, 1, 0));
		// **Outward past the plane** — §12.3's boundary in the other direction.
		expect(end.axial).toBeCloseTo(law.frame.planeKm + LAUNCH_RELEASE_KM, 9);
	});

	test("it is monotone outward, so it cannot re-trigger an inward crossing", () => {
		const law = beginLaunch(frameOf("trade", 0), 0);
		let previous = Number.NEGATIVE_INFINITY;
		for (let i = 0; i <= 200; i++) {
			const axial = dot(arrivalRel(law, i / 200, 0), AXIS);
			expect(axial).toBeGreaterThanOrEqual(previous - 1e-12);
			previous = axial;
		}
	});
});

describe("§12.6 obligation 9 — the velocity is the law's own", () => {
	test("it matches a finite difference of the position law", () => {
		// The game hands the ship this velocity, so a velocity that is not the
		// derivative of the position is a ship being carried by one rule and
		// moving by another.
		const rpm = SPIN_RPM_RANGE.maxRpm;
		const spin = (2 * Math.PI * rpm) / 60;
		const t0 = 11;
		const law = beginArrival(
			frameOf("trade", slotPhaseRad(rpm, t0)),
			cornerEntry("trade", slotPhaseRad(rpm, t0)),
			t0,
		);
		const h = 1e-6;
		for (const u of [0.1, 0.37, 0.5, 0.83]) {
			const t = t0 + u * law.durationS;
			const analytic = arrivalRelVelocity(law, u, slotPhaseRad(rpm, t), spin);
			const before = arrivalRel(
				law,
				arrivalProgress(law, t - h),
				slotPhaseRad(rpm, t - h),
			);
			const after = arrivalRel(
				law,
				arrivalProgress(law, t + h),
				slotPhaseRad(rpm, t + h),
			);
			for (const k of ["x", "y", "z"] as const)
				expect(analytic[k]).toBeCloseTo((after[k] - before[k]) / (2 * h), 4);
		}
	});

	test("it is zero at both ends, so the ship is parked rather than drifting", () => {
		const law = beginArrival(frameOf("trade"), cornerEntry("trade", 0), 0);
		for (const u of [0, 1]) {
			const v = arrivalRelVelocity(law, u, 0, 0);
			expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(0, 12);
		}
	});
});
