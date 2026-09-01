/**
 * `docs/specs/docking.md` §9.1 — the headless half of the docking obligation.
 *
 * Nine of the eleven rows §9.1 lists are here. The other two are older than
 * this module and already shipped, so restating them would be a second copy to
 * keep in step: §9.1.7's spin range and its 10,000-station distribution bound
 * live in `tests/station.test.ts`, and §9.1.8's "`radiusKm` shifts no stream"
 * is `tests/station-orbits.test.ts`'s committed fixture.
 *
 * **Tolerances are data, not literals repeated per test** (§9.1.1). Every row
 * below builds its pose *from* `AXIS_TOLERANCE_DEG`, `ROLL_TOLERANCE_DEG` and
 * `V_GATE_KMS` rather than from 35, 50 and 0.10 — so retuning the spec moves
 * one constant and the boundary rows follow it, instead of going red against
 * numbers that used to be true.
 */

import { describe, expect, test } from "bun:test";
import {
	AXIS_TOLERANCE_DEG,
	COMPUTER_CONE_TAN,
	COMPUTER_CORRIDOR_KM,
	COMPUTER_RUN_IN_MAX_KMS,
	COMPUTER_RUN_IN_MIN_KMS,
	COMPUTER_STANDOFF_KM,
	DAMAGE_FLOOR,
	GRANT_WINDOW_S,
	HOSTILE_COOLDOWN_S,
	INTERIM_DAMAGE_SCALE,
	ROLL_TOLERANCE_DEG,
	V_GATE_KMS,
	VICINITY_KM,
	type ApertureFrame,
	type EntryPose,
	apertureFrame,
	applyDamage,
	attemptEntry,
	dockingComputerStep,
	approachSpeed,
	entryDamage,
	evaluateEntry,
	fullCondition,
	grantLive,
	insideCorridor,
	isAlive,
	newDockingState,
	releaseBerth,
	orthonormalise,
	planeCrossing,
	poolOf,
	repel,
	requestClearance,
	slewToward,
	slotBasis,
	tickDocking,
} from "../src/docking";
import { ASSIST_CAP_KMS } from "../src/sim";
import { HULL_SPECS } from "../src/hull";
import { STATION_GEOMETRY, slotPhaseRad } from "../src/station";
import { stationInterior } from "../src/station-interior";
import {
	type Vec3,
	add,
	cross,
	dot,
	length,
	scale,
	sub,
	v3,
} from "../src/vec3";
import { PLAYER_BASELINE_HULL } from "../src/hull";
import { flyTheComputer as fly } from "./helpers/fly-the-computer";

/**
 * The traffic a clearance request is answered against (§13.2).
 *
 * A grant reserves a berth now, so the protocol needs the catalogue and the
 * envelope it has to fit. Empty occupancy is the live game's state — NPC
 * traffic is #8's — and the rows that need a full station build their own set
 * rather than moving this one.
 */
const INTERIOR = stationInterior(
	"trade",
	STATION_GEOMETRY.trade.aperturePlaneKm,
);
const TRAFFIC = {
	interior: INTERIOR,
	hull: HULL_SPECS.courier.env,
	occupied: new Set<string>(),
	// No ship of ours is at this station in most rows; the one that is says so.
	sessionHere: false,
};

const DEG = Math.PI / 180;

/**
 * A deliberately awkward axis, not a world axis.
 *
 * Every check below is stated in the aperture frame, so an axis-aligned fixture
 * would let a sign error in `slotBasis` hide behind coordinates that happen to
 * agree. This one agrees with nothing.
 */
const AXIS = ((): Vec3 => {
	const a = v3(0.37, -0.82, 0.44);
	return scale(a, 1 / length(a));
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

const frameFor = (
	type: "trade" | "refinery" = "trade",
	phaseRad = 0.7,
): ApertureFrame => apertureFrame(type, AXIS, phaseRad, REFERENCE);

/**
 * A textbook entry: on the axis, nose down it, rolled to the slot, inbound at
 * half the gate.
 *
 * Every fixture below is a named deviation from this one, which is what makes a
 * failing row name the check it broke rather than a pose.
 */
function nominal(
	frame: ApertureFrame,
	over: Partial<EntryPose> = {},
): EntryPose {
	const basis = slotBasis(frame);
	return {
		rel: scale(frame.axis, frame.planeKm),
		vRel: scale(frame.axis, -V_GATE_KMS / 2),
		nose: scale(frame.axis, -1),
		// Check 4's zero: the ship's up along the slot's **short** axis, so its
		// beam lies along the long one (#158).
		up: basis.up,
		...over,
	};
}

/** Rotate `v` about `axis` by `rad` (Rodrigues). Used to build the boundary
 *  rows *from* the tolerances rather than from hand-typed vectors. */
function rotate(v: Vec3, axis: Vec3, rad: number): Vec3 {
	const k = scale(axis, 1 / length(axis));
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	const kv = v3(
		k.y * v.z - k.z * v.y,
		k.z * v.x - k.x * v.z,
		k.x * v.y - k.y * v.x,
	);
	return add(add(scale(v, c), scale(kv, s)), scale(k, dot(k, v) * (1 - c)));
}

/** Some direction perpendicular to `AXIS`, for tilting things off it. */
const PERP = ((): Vec3 => {
	const b = slotBasis(apertureFrame("trade", AXIS, 0, REFERENCE));
	return b.up;
})();

// ---------------------------------------------------------------------------
// §9.1.1 — the six checks, table-driven, with the boundary rows
// ---------------------------------------------------------------------------

describe("§9.1.1 the six checks", () => {
	test("a nominal entry passes every row", () => {
		const frame = frameFor();
		const e = evaluateEntry(frame, nominal(frame), { hostile: false });
		expect(e.checks).toEqual({
			notHostile: true,
			axisAlignment: true,
			inbound: true,
			rollMatch: true,
			containment: true,
			closingSpeed: true,
		});
		expect(e.passed).toBe(true);
	});

	test("check 1: a hostile station refuses an otherwise perfect entry", () => {
		const frame = frameFor();
		const e = evaluateEntry(frame, nominal(frame), { hostile: true });
		expect(e.checks.notHostile).toBe(false);
		expect(e.passed).toBe(false);
		// Only that row. A hostile flip that also reddened the geometry would
		// make the diagnostics useless for saying why an entry failed.
		expect(e.checks.axisAlignment).toBe(true);
		expect(e.checks.containment).toBe(true);
	});

	test("check 2 is two angles: the nose alone can fail it", () => {
		const frame = frameFor();
		// Position dead on the axis, nose 5° past the tolerance. A purely
		// positional cone would pass this, which is the hole §3 names.
		const nose = rotate(
			scale(frame.axis, -1),
			PERP,
			(AXIS_TOLERANCE_DEG + 5) * DEG,
		);
		const e = evaluateEntry(frame, nominal(frame, { nose }), {
			hostile: false,
		});
		expect(e.checks.axisAlignment).toBe(false);
		expect(e.noseAngleDeg).toBeCloseTo(AXIS_TOLERANCE_DEG + 5, 6);
		expect(e.positionAngleDeg).toBeCloseTo(0, 9);
	});

	test("check 2 boundary: exactly the tolerance passes, a hair past fails", () => {
		const frame = frameFor();
		const at = rotate(scale(frame.axis, -1), PERP, AXIS_TOLERANCE_DEG * DEG);
		const past = rotate(
			scale(frame.axis, -1),
			PERP,
			(AXIS_TOLERANCE_DEG + 1e-6) * DEG,
		);
		expect(
			evaluateEntry(frame, nominal(frame, { nose: at }), { hostile: false })
				.checks.axisAlignment,
		).toBe(true);
		expect(
			evaluateEntry(frame, nominal(frame, { nose: past }), { hostile: false })
				.checks.axisAlignment,
		).toBe(false);
	});

	test("check 3 reads a velocity sign, and outbound fails", () => {
		const frame = frameFor();
		const out = nominal(frame, {
			vRel: scale(frame.axis, V_GATE_KMS / 2),
		});
		const e = evaluateEntry(frame, out, { hostile: false });
		expect(e.checks.inbound).toBe(false);
		// The axial *position* is zero relative to the plane by construction at
		// the crossing instant, so nothing here may read a side-of-plane test.
		expect(dot(out.rel, frame.axis) - frame.planeKm).toBeCloseTo(0, 12);
	});

	test("check 4 boundary: exactly the roll tolerance passes, a hair past fails", () => {
		const frame = frameFor();
		const basis = slotBasis(frame);
		const at = rotate(basis.up, frame.axis, ROLL_TOLERANCE_DEG * DEG);
		const past = rotate(
			basis.up,
			frame.axis,
			(ROLL_TOLERANCE_DEG + 1e-6) * DEG,
		);
		expect(
			evaluateEntry(frame, nominal(frame, { up: at }), { hostile: false })
				.checks.rollMatch,
		).toBe(true);
		expect(
			evaluateEntry(frame, nominal(frame, { up: past }), { hostile: false })
				.checks.rollMatch,
		).toBe(false);
	});

	test("check 4 compares an axis-line: a ship rolled exactly 180° passes", () => {
		// §9.1.1's named row. The slot is a rectangle, so a 180° roll is the
		// geometrically identical entry; an oriented-vector comparison rejects it
		// for no physical reason.
		const frame = frameFor();
		const basis = slotBasis(frame);
		const e = evaluateEntry(
			frame,
			nominal(frame, { up: scale(basis.up, -1) }),
			{ hostile: false },
		);
		expect(e.rollAngleDeg).toBeCloseTo(0, 9);
		expect(e.checks.rollMatch).toBe(true);
		expect(e.passed).toBe(true);
	});

	test("check 5: a crossing on the aperture edge is inside, a hair out is not", () => {
		const frame = frameFor();
		const basis = slotBasis(frame);
		const half = frame.aperture.widthKm / 2;
		const on = nominal(frame, {
			rel: add(scale(frame.axis, frame.planeKm), scale(basis.across, half)),
		});
		const out = nominal(frame, {
			rel: add(
				scale(frame.axis, frame.planeKm),
				scale(basis.across, half * (1 + 1e-9)),
			),
		});
		expect(
			evaluateEntry(frame, on, { hostile: false }).checks.containment,
		).toBe(true);
		expect(
			evaluateEntry(frame, out, { hostile: false }).checks.containment,
		).toBe(false);
	});

	test("check 5 is not redundant with check 2: the hull-face approach fails", () => {
		// §9.1.1's other named row, and §3's blocker. At the trade station's
		// 0.6 km core, 35° admits ~0.42 km of lateral offset — four times the
		// slot's half-length — so without containment a ship flying squarely into
		// the hull face satisfies every angle, every sign and the gate.
		const frame = frameFor();
		const basis = slotBasis(frame);
		const offsetKm = frame.planeKm * Math.tan(AXIS_TOLERANCE_DEG * DEG);
		expect(offsetKm).toBeGreaterThan(frame.aperture.widthKm * 2);
		const rel = add(
			scale(frame.axis, frame.planeKm),
			scale(basis.across, offsetKm),
		);
		// Nose and velocity both straight down the axis: everything but
		// containment is nominal, which is what makes this the hole rather than a
		// generally bad approach.
		const e = evaluateEntry(frame, nominal(frame, { rel }), { hostile: false });
		expect(e.positionAngleDeg).toBeCloseTo(AXIS_TOLERANCE_DEG, 6);
		expect(e.checks.axisAlignment).toBe(true);
		expect(e.checks.inbound).toBe(true);
		expect(e.checks.closingSpeed).toBe(true);
		expect(e.checks.rollMatch).toBe(true);
		expect(e.checks.containment).toBe(false);
		expect(e.passed).toBe(false);
	});

	test("check 6 boundary: exactly the gate passes, a hair over fails", () => {
		const frame = frameFor();
		const at = nominal(frame, { vRel: scale(frame.axis, -V_GATE_KMS) });
		const over = nominal(frame, {
			vRel: scale(frame.axis, -V_GATE_KMS * (1 + 1e-9)),
		});
		expect(
			evaluateEntry(frame, at, { hostile: false }).checks.closingSpeed,
		).toBe(true);
		expect(
			evaluateEntry(frame, over, { hostile: false }).checks.closingSpeed,
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// §9.1.2 — the frame regression
// ---------------------------------------------------------------------------

describe("§9.1.2 the gate is measured in the station's frame", () => {
	/** A station at 1 AU, carried at ~30 km/s — fifteen times #5's assist cap. */
	const STATION_VEL = scale(
		v3(0.31, 0.95, -0.05),
		30 / length(v3(0.31, 0.95, -0.05)),
	);

	test("a ship co-moving with the station at 0.05 km/s relative passes", () => {
		const frame = frameFor();
		const shipVel = add(STATION_VEL, scale(frame.axis, -0.05));
		const pose = nominal(frame, { vRel: sub(shipVel, STATION_VEL) });
		const e = evaluateEntry(frame, pose, { hostile: false });
		expect(e.speedKms).toBeCloseTo(0.05, 12);
		expect(e.passed).toBe(true);
	});

	test("a ship stationary in star-centred coordinates fails", () => {
		// #10 §11.1's warning as a test: "throttle to zero" beside a station means
		// stopping relative to the *star* while the station leaves at 30 km/s.
		const frame = frameFor();
		const pose = nominal(frame, { vRel: sub(v3(), STATION_VEL) });
		const e = evaluateEntry(frame, pose, { hostile: false });
		expect(e.speedKms).toBeCloseTo(30, 9);
		expect(e.checks.closingSpeed).toBe(false);
		// And the damage it would take is the reckless end of §2.1, not a graze.
		expect(entryDamage(e.speedKms)).toBeGreaterThan(poolOf(fullCondition()));
	});
});

// ---------------------------------------------------------------------------
// §9.1.3 — |v_rel| is read consistently
// ---------------------------------------------------------------------------

test("§9.1.3 the gate and the damage read the same scalar", () => {
	// 0.05 km/s axial and 1 km/s lateral. Reading the axial component alone
	// passes the gate and charges 0.25× the damage; reading the magnitude fails
	// it and charges 100×. The two differ by 400×, which is why this is a test
	// and not a comment.
	const frame = frameFor();
	const basis = slotBasis(frame);
	const vRel = add(scale(frame.axis, -0.05), scale(basis.across, 1));
	const e = evaluateEntry(frame, nominal(frame, { vRel }), { hostile: false });

	expect(e.speedKms).toBeCloseTo(Math.hypot(0.05, 1), 12);
	expect(e.checks.inbound).toBe(true);
	expect(e.checks.closingSpeed).toBe(false);

	const axialOnly = entryDamage(0.05);
	expect(entryDamage(e.speedKms) / axialOnly).toBeCloseTo(
		// (|v|/V_GATE)² against the floor the axial-only reading would have hit.
		(e.speedKms / V_GATE_KMS) ** 2 / DAMAGE_FLOOR,
		6,
	);
	expect(entryDamage(e.speedKms)).toBeGreaterThan(axialOnly * 300);
});

// ---------------------------------------------------------------------------
// §9.1.4 — a failed entry repels and keeps its grant
// ---------------------------------------------------------------------------

describe("§9.1.4 a failed entry repels and keeps its grant", () => {
	test("the ship ends outside the plane with v_axial reversed and halved", () => {
		const frame = frameFor();
		const basis = slotBasis(frame);
		const vAxial = -V_GATE_KMS / 2;
		const pose = nominal(frame, {
			vRel: add(scale(frame.axis, vAxial), scale(basis.across, 0.01)),
		});
		const out = repel(frame, pose);

		expect(dot(out.rel, frame.axis)).toBeGreaterThan(frame.planeKm);
		expect(dot(out.vRel, frame.axis)).toBeCloseTo(-vAxial / 2, 12);
		// Lateral motion is untouched: a bounce, not a reset.
		expect(dot(out.vRel, basis.across)).toBeCloseTo(0.01, 12);
	});

	test("a live grant survives the bounce, and the station stays friendly", () => {
		const frame = frameFor();
		const granted = requestClearance(newDockingState(), {
			gameTime: 0,
			rangeKm: 500,
			...TRAFFIC,
		});
		const outcome = attemptEntry({
			frame,
			// Mis-rolled: a piloting error, not a protocol violation.
			pose: nominal(frame, {
				up: rotate(slotBasis(frame).up, frame.axis, 90 * DEG),
			}),
			state: granted,
			gameTime: 10,
		});
		expect(outcome.docked).toBe(false);
		expect(outcome.barged).toBe(false);
		expect(outcome.state.hostile).toBe(false);
		expect(grantLive(outcome.state, 10)).toBe(true);
		expect(outcome.repelled).not.toBeNull();
		expect(dot(outcome.repelled!.rel, frame.axis)).toBeGreaterThan(
			frame.planeKm,
		);
	});
});

// ---------------------------------------------------------------------------
// §9.1.5 — the damage floor bites
// ---------------------------------------------------------------------------

test("§9.1.5 a 90°-mis-rolled entry at 0.01 km/s still costs the floor", () => {
	const frame = frameFor();
	const outcome = attemptEntry({
		frame,
		pose: nominal(frame, {
			vRel: scale(frame.axis, -0.01),
			up: rotate(slotBasis(frame).up, frame.axis, 90 * DEG),
		}),
		state: requestClearance(newDockingState(), {
			gameTime: 0,
			rangeKm: 500,
			...TRAFFIC,
		}),
		gameTime: 0,
	});
	expect(outcome.docked).toBe(false);
	// Pure quadratic scaling would charge 1% of the gate-speed damage here.
	const quadratic = INTERIM_DAMAGE_SCALE * (0.01 / V_GATE_KMS) ** 2;
	expect(quadratic / entryDamage(V_GATE_KMS)).toBeCloseTo(0.01, 9);
	expect(outcome.damage).toBeCloseTo(DAMAGE_FLOOR * entryDamage(V_GATE_KMS), 9);
	expect(outcome.damage / quadratic).toBeCloseTo(25, 9);
});

// ---------------------------------------------------------------------------
// §9.1.6 — the pad is the slot minus check 4
// ---------------------------------------------------------------------------

describe("§9.1.6 the pad is the slot minus check 4", () => {
	/**
	 * Both interactions over one fixture, and the *aperture* is held constant.
	 *
	 * The refinery's pad is 0.15 × 0.15 km against the slot's 0.12 × 0.07, so
	 * running the real geometries against a mis-rolled fixture would differ on
	 * containment as well and prove nothing about check 4. Holding the rectangle
	 * still leaves `kind` as the only difference, which is the claim.
	 */
	const slot = frameFor("trade");
	const pad: ApertureFrame = {
		...slot,
		aperture: { ...slot.aperture, kind: "pad" },
		phaseRad: slot.phaseRad,
	};

	test.each([0, 30, 50, 90, 180])(
		"rolled %i°, the roll row is the only outcome that differs",
		(deg) => {
			const pose = nominal(slot, {
				up: rotate(slotBasis(slot).up, slot.axis, deg * DEG),
			});
			const a = evaluateEntry(slot, pose, { hostile: false });
			const b = evaluateEntry(pad, pose, { hostile: false });
			const strip = (c: typeof a.checks) => ({ ...c, rollMatch: null });
			expect(strip(b.checks)).toEqual(strip(a.checks));
			expect(b.checks.rollMatch).toBe(true);
			expect(a.checks.rollMatch).toBe(
				deg <= ROLL_TOLERANCE_DEG || deg >= 180 - ROLL_TOLERANCE_DEG,
			);
		},
	);

	test("a real refinery pad does not spin, so it has no phase to match", () => {
		const spun = apertureFrame("refinery", AXIS, 1.234, REFERENCE);
		expect(STATION_GEOMETRY.refinery.spins).toBe(false);
		expect(spun.phaseRad).toBe(0);
		const e = evaluateEntry(spun, nominal(spun), { hostile: false });
		expect(e.rollAngleDeg).toBeNaN();
		expect(e.passed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// §9.1.9 — the clearance state machine
// ---------------------------------------------------------------------------

describe("§9.1.9 the clearance state machine", () => {
	const REQ = { gameTime: 0, rangeKm: 500, ...TRAFFIC };

	test("granted opens a 600 s window that expires back to none", () => {
		const s = requestClearance(newDockingState(), REQ);
		expect(s.clearance).toEqual({
			kind: "granted",
			expiresAtS: GRANT_WINDOW_S,
		});
		expect(grantLive(s, GRANT_WINDOW_S - 1)).toBe(true);
		expect(grantLive(s, GRANT_WINDOW_S)).toBe(false);
		expect(tickDocking(s, GRANT_WINDOW_S, TRAFFIC).clearance).toEqual({
			kind: "none",
		});
		// §13.2: the reservation goes with the lapsed grant.
		expect(tickDocking(s, GRANT_WINDOW_S, TRAFFIC).berthId).toBeNull();
	});

	test("out of range is not a reply at all", () => {
		const s = requestClearance(newDockingState(), {
			...REQ,
			rangeKm: VICINITY_KM * 1.001,
		});
		expect(s.clearance).toEqual({ kind: "none" });
		// And exactly at the range it is.
		expect(
			requestClearance(newDockingState(), { ...REQ, rangeKm: VICINITY_KM })
				.clearance.kind,
		).toBe("granted");
	});

	test("a station with no free berth queues, and frees into a grant", () => {
		// §6.1 and §13.2: driven by an injected occupancy, so the branch is
		// exercised code from the day it is written rather than waiting on #8's
		// traffic. Every berth held is the only state that queues now — a grant
		// *is* a reservation, so there is nothing to grant.
		const full = new Set(INTERIOR.berths.map((berth) => berth.id));
		const queued = requestClearance(newDockingState(), {
			...REQ,
			occupied: full,
		});
		expect(queued.clearance).toEqual({
			kind: "queued",
			position: full.size,
		});
		expect(queued.berthId).toBeNull();
		expect(grantLive(queued, 0)).toBe(false);
		const still = tickDocking(queued, 30, { ...TRAFFIC, occupied: full });
		expect(still.clearance.kind).toBe("queued");
		const promoted = tickDocking(still, 60, TRAFFIC);
		expect(promoted.clearance).toEqual({
			kind: "granted",
			expiresAtS: 60 + GRANT_WINDOW_S,
		});
		expect(promoted.berthId).not.toBeNull();
	});

	test("releasing the berth spends the grant with it", () => {
		// §13.2: the grant *is* the reservation, so a grant that outlived its
		// berth is a clearance no berth answers for — and `attemptEntry` would
		// dock on it and hand the arrival a null berth. Caught exactly that way,
		// by a capture that launched and flew a second entry inside the same
		// 600 s window.
		const granted = requestClearance(newDockingState(), REQ);
		expect(grantLive(granted, 0)).toBe(true);
		const spent = releaseBerth(granted);
		expect(spent.berthId).toBeNull();
		expect(spent.clearance).toEqual({ kind: "none" });
		expect(grantLive(spent, 0)).toBe(false);
		// A denial is not a grant and is left alone: releasing a berth must not
		// quietly forgive a station that refused you.
		const denied = requestClearance(newDockingState(), {
			...REQ,
			scanFails: true,
		});
		expect(releaseBerth(denied).clearance).toEqual(denied.clearance);
	});

	test("a hull no berth fits is refused, not queued forever", () => {
		// **A queue and a refusal are different answers**, and `chooseBerth`
		// returns one `null` for both. A hull too big for every berth got
		// `queued` at position 0 — a reply `tickDocking` re-evaluates every frame
		// and can never promote, because no departure frees a berth that would
		// fit. §13.2 refuses such a hull by the fit predicate.
		const denied = requestClearance(newDockingState(), {
			...REQ,
			hull: HULL_SPECS.carrier.env,
		});
		expect(denied.clearance).toEqual({
			kind: "denied",
			reason: "no berth that fits",
		});
		expect(denied.berthId).toBeNull();
		// A tick does not turn it into a grant, which is the half that made the
		// queued reply wrong rather than merely unhelpful.
		expect(
			tickDocking(denied, 60, { ...TRAFFIC, hull: HULL_SPECS.carrier.env })
				.clearance,
		).toEqual({ kind: "denied", reason: "no berth that fits" });
		// And a full station still *queues* a hull that would fit, which is the
		// distinction this row exists for.
		const full = new Set(INTERIOR.berths.map((berth) => berth.id));
		expect(
			requestClearance(newDockingState(), { ...REQ, occupied: full }).clearance
				.kind,
		).toBe("queued");
	});

	test("a lapsed grant does not evict the ship standing in the berth", () => {
		// §13.2 holds the reservation "through arrival, docking and launch", and
		// a grant is only 600 s — so a player who sat docked for eleven minutes
		// lost the berth they were parked in. `tickDocking` has no view of the
		// dock session, so the caller supplies the one bit it needs.
		const granted = requestClearance(newDockingState(), REQ);
		const held = tickDocking(granted, GRANT_WINDOW_S, {
			...TRAFFIC,
			sessionHere: true,
		});
		expect(held.clearance).toEqual({ kind: "none" });
		expect(held.berthId).toBe(granted.berthId);
		// And with no ship there, the lapsed grant still gives the berth back.
		const freed = tickDocking(granted, GRANT_WINDOW_S, TRAFFIC);
		expect(freed.berthId).toBeNull();
	});

	test("a grant reserves one berth, and a bounce does not give it back", () => {
		const granted = requestClearance(newDockingState(), REQ);
		expect(granted.berthId).not.toBeNull();
		// §13.2: the reservation survives a failed entry while the grant is live.
		const bounced = attemptEntry({
			frame: frameFor(),
			pose: nominal(frameFor()),
			state: granted,
			gameTime: 1,
		});
		expect(bounced.state.berthId).toBe(granted.berthId);
	});

	test("a failed shipyard scan denies, and the denial is hostile with an exit", () => {
		const denied = requestClearance(newDockingState(), {
			...REQ,
			scanFails: true,
		});
		expect(denied.clearance).toEqual({ kind: "denied", reason: "contraband" });
		expect(denied.hostile).toBe(true);
		expect(denied.hostileUntilS).toBe(HOSTILE_COOLDOWN_S);
		// A hostile station denies on request rather than silently granting.
		expect(requestClearance(denied, { ...REQ, gameTime: 5 }).clearance).toEqual(
			{ kind: "denied", reason: "hostile" },
		);
	});

	test("barging without a grant is a failed entry AND turns the station hostile", () => {
		const frame = frameFor();
		// A geometrically perfect entry, so nothing but the missing grant can be
		// what refuses it — which is the read-ordering §6 names.
		const outcome = attemptEntry({
			frame,
			pose: nominal(frame),
			state: newDockingState(),
			gameTime: 100,
		});
		expect(outcome.docked).toBe(false);
		expect(outcome.barged).toBe(true);
		expect(outcome.state.hostile).toBe(true);
		expect(outcome.damage).toBeGreaterThan(0);
		// The flip lands *before* the checks read it: check 1 must see it.
		expect(outcome.evaluation.checks.notHostile).toBe(false);
	});

	test("the interim hostility cooldown is an exit, not a permanent lock-out", () => {
		// §6 and §11.5: without one, a lapsed grant plus one barge locks the
		// player out of a system's only station forever, on #8's timetable.
		const barged = attemptEntry({
			frame: frameFor(),
			pose: nominal(frameFor()),
			state: newDockingState(),
			gameTime: 100,
		}).state;
		expect(
			tickDocking(barged, 100 + HOSTILE_COOLDOWN_S - 1, TRAFFIC).hostile,
		).toBe(true);
		const cleared = tickDocking(barged, 100 + HOSTILE_COOLDOWN_S, TRAFFIC);
		expect(cleared.hostile).toBe(false);
		expect(cleared.hostileUntilS).toBeNull();
		expect(
			requestClearance(cleared, { ...REQ, gameTime: 800 }).clearance.kind,
		).toBe("granted");
	});
});

// ---------------------------------------------------------------------------
// §9.1.10 — the damage predicate
// ---------------------------------------------------------------------------

describe("§9.1.10 the damage predicate", () => {
	test("it is monotonic in closing speed", () => {
		let last = -1;
		for (let v = 0; v <= 2; v += 0.01) {
			const d = entryDamage(v);
			expect(d).toBeGreaterThanOrEqual(last);
			last = d;
		}
	});

	/**
	 * D1 as a checkable predicate, written against the scale as a **parameter**
	 * so it constrains #8 rather than waiting for it (§9.1.10, §10).
	 *
	 * The bound is the *inequality*, and it is asserted over a swept range of
	 * candidate scales: a test written against one number would pass on that
	 * number and say nothing about the one #8 ships. §10 additionally puts the
	 * obligation to assert the **exported** constant on #8, because a
	 * parameterised test can never fail on a value it is not given.
	 */
	test("at V_GATE a failed entry from full health leaves three quarters of the pool", () => {
		const full = fullCondition();
		const quarter = poolOf(full) / 4;
		// `damageScale`, not `scale`: `scale` is the vec3 helper every other
		// fixture in this file uses, and a loop variable shadowing it inside a
		// test that happens not to need vector arithmetic is a trap for the next
		// row added here.
		for (const damageScale of [1, 10, 25, 40, 50]) {
			const after = applyDamage(full, entryDamage(V_GATE_KMS, damageScale));
			expect(poolOf(full) - poolOf(after)).toBeLessThanOrEqual(quarter);
			expect(isAlive(after)).toBe(true);
		}
		// The scale this node ships is inside the bound with the margin §2.1 asks
		// for — and this is the one row that names it, so a retune past the bound
		// reddens here rather than silently.
		expect(entryDamage(V_GATE_KMS, INTERIM_DAMAGE_SCALE)).toBeLessThanOrEqual(
			quarter,
		);
	});

	test("recklessness still kills: the assist cap is 400x the gate", () => {
		// §2.1.3. 2 km/s is 20x the gate, so the quadratic charges 400x.
		expect(entryDamage(ASSIST_CAP_KMS) / entryDamage(V_GATE_KMS)).toBeCloseTo(
			400,
			6,
		);
		expect(
			isAlive(applyDamage(fullCondition(), entryDamage(ASSIST_CAP_KMS))),
		).toBe(false);
	});

	test("damage lands on shields first and hull after", () => {
		const c = applyDamage(fullCondition(), 120);
		expect(c.shield).toBe(0);
		expect(c.hull).toBe(80);
	});
});

// ---------------------------------------------------------------------------
// §9.1.11 — the docking computer satisfies §3
// ---------------------------------------------------------------------------

/**
 * §9.1.11's runs, flown through the shared harness.
 *
 * The loop moved to `tests/helpers/fly-the-computer.ts` in #181, which gave it
 * a second caller: this file asks whether the computer satisfies §3, and
 * `tests/hull-docking.test.ts` asks whether every hull on #26's roster can fly
 * the same profile. The fixture axis and reference are still this file's, so
 * both callers fly the same deliberately awkward frame.
 *
 * These rows fly the **baseline hull**, which is what they always flew: before
 * #181 nothing varied, so "the ship" and "the courier" were the same statement.
 */
const flyTheComputer = (opts: {
	spinRpm: number;
	type?: "trade" | "refinery";
	hostile?: boolean;
	granted?: boolean;
}) =>
	fly({
		...opts,
		hull: PLAYER_BASELINE_HULL,
		axis: AXIS,
		reference: REFERENCE,
	});

describe("§7's two tuning surfaces, pinned without flying anything", () => {
	const frame = frameFor();
	const at = (axialKm: number, offKm: number): EntryPose =>
		nominal(frame, {
			rel: add(scale(frame.axis, axialKm), scale(slotBasis(frame).up, offKm)),
		});

	test("the corridor is a cone: loose at the standoff, tight at the plane", () => {
		// The property, not the numbers: whatever the cone is retuned to, what
		// it must not become is a cylinder — the shape that never got met.
		const atPlane = COMPUTER_CORRIDOR_KM;
		const atStandoff =
			COMPUTER_CORRIDOR_KM + COMPUTER_CONE_TAN * COMPUTER_STANDOFF_KM;
		expect(atStandoff).toBeGreaterThan(atPlane * 4);

		expect(insideCorridor(frame, at(frame.planeKm, atPlane * 0.9))).toBe(true);
		expect(insideCorridor(frame, at(frame.planeKm, atPlane * 1.1))).toBe(false);
		const standoff = frame.planeKm + COMPUTER_STANDOFF_KM;
		expect(insideCorridor(frame, at(standoff, atStandoff * 0.9))).toBe(true);
		expect(insideCorridor(frame, at(standoff, atStandoff * 1.1))).toBe(false);
		// The measured lag that killed the cylinder — 12 to 33 m — is inside the
		// cone at the standoff and outside it at the plane. That pair is the
		// whole reason the shape changed.
		expect(insideCorridor(frame, at(standoff, 0.033))).toBe(true);
		expect(insideCorridor(frame, at(frame.planeKm, 0.033))).toBe(false);
	});

	test("a ship already inside the plane is not lined up", () => {
		expect(insideCorridor(frame, at(frame.planeKm - 0.01, 0))).toBe(false);
	});

	test("the run-in has a floor and the line-up does not", () => {
		// Without the floor the run-in converges on the plane asymptotically and
		// the approach completes in the limit rather than in a frame.
		expect(approachSpeed(0, true, ASSIST_CAP_KMS)).toBe(
			COMPUTER_RUN_IN_MIN_KMS,
		);
		expect(approachSpeed(1e6, true, ASSIST_CAP_KMS)).toBe(
			COMPUTER_RUN_IN_MAX_KMS,
		);
		// And the run-in cap is under the gate, so a crossing this commands
		// cannot fail check 6 on a rounding.
		expect(COMPUTER_RUN_IN_MAX_KMS).toBeLessThan(V_GATE_KMS);

		// With a floor the line-up orbits the point it is trying to reach, which
		// is the 600 s dither §7 records.
		expect(approachSpeed(0, false, ASSIST_CAP_KMS)).toBe(0);
		expect(approachSpeed(1e6, false, ASSIST_CAP_KMS)).toBe(ASSIST_CAP_KMS);
	});

	test("the run-in aims inside the plane, so the nose stays defined at the crossing", () => {
		// What this pins is the *mechanism*, not the dynamics: at the crossing
		// the ship sits at the plane with a small lateral error (the browser
		// probe's measured crossing: ~2 m off-axis). An aim exactly *on* the
		// plane makes the target and the position coincide, so the nose it
		// orders reduces to the lateral error alone — sideways, ~90° off the
		// axis — and check 2's 35° nose row fails a clean position. Node #32's
		// orbit floor exposed that degeneracy in the browser (probe-docking
		// §9.2.3, 37.4° nose at a 0.2° position); the browser probe carries the
		// full approach dynamics end-to-end, and this static pose pins the
		// arithmetic that makes the aim safe there: a hair inside
		// (`COMPUTER_AIM_INSIDE_KM`) so the nose it orders stays "straight in"
		// through the crossing.
		const basis = slotBasis(frame);
		const lateral = scale(basis.up, 0.002); // the probe's ~2 m crossing error
		const cmd = dockingComputerStep({
			frame,
			pose: nominal(frame, {
				rel: add(scale(frame.axis, frame.planeKm), lateral),
			}),
			state: requestClearance(newDockingState(), {
				gameTime: 0,
				rangeKm: 500,
				...TRAFFIC,
			}),
			gameTime: 0,
			maxSpeedKms: ASSIST_CAP_KMS,
		});
		expect(cmd.engaged).toBe(true);
		// The commanded nose points inward along the axis, not sideways at the
		// lateral error — comfortably under the 35° tolerance.
		const noseAngleDeg =
			(Math.acos(Math.min(1, Math.max(-1, -dot(cmd.nose, frame.axis)))) * 180) /
			Math.PI;
		expect(noseAngleDeg).toBeLessThan(10);
	});
});

describe("§9.1.11 the docking computer", () => {
	test.each([0.6, 2.0, 3.0])(
		"it flies from the vicinity to docked at %f rpm, violating no check",
		(rpm) => {
			const run = flyTheComputer({ spinRpm: rpm });
			expect(run.refused).toBeNull();
			expect(run.violations).toBe(0);
			expect(run.docked).toBe(true);
			// A run that "docked" on step one would pass the line above without
			// having flown anything.
			expect(run.steps).toBeGreaterThan(50);
		},
	);

	test("it docks at the refinery's fixed pad too", () => {
		const run = flyTheComputer({ spinRpm: 0, type: "refinery" });
		expect(run.docked).toBe(true);
		expect(run.violations).toBe(0);
	});

	test("it refuses at a hostile station", () => {
		const run = flyTheComputer({ spinRpm: 1.5, hostile: true });
		expect(run.docked).toBe(false);
		expect(run.refused).toBe("hostile");
	});

	test("it refuses without clearance — it never bypasses §6", () => {
		const run = flyTheComputer({ spinRpm: 1.5, granted: false });
		expect(run.docked).toBe(false);
		expect(run.refused).toBe("no-clearance");
	});

	test("it refuses outside VICINITY_KM", () => {
		const frame = frameFor();
		const cmd = dockingComputerStep({
			frame,
			pose: nominal(frame, { rel: scale(AXIS, VICINITY_KM * 1.1) }),
			state: requestClearance(newDockingState(), {
				gameTime: 0,
				rangeKm: 500,
				...TRAFFIC,
			}),
			gameTime: 0,
			maxSpeedKms: ASSIST_CAP_KMS,
		});
		expect(cmd.engaged).toBe(false);
		expect(cmd.refused).toBe("out-of-range");
	});
});

// ---------------------------------------------------------------------------
// The plane crossing itself
// ---------------------------------------------------------------------------

describe("orthonormalise is the one attitude law", () => {
	test("it corrects an up that has drifted off perpendicular", () => {
		const nose = v3(0, 0, -1);
		const drifted = add(v3(0, 1, 0), scale(nose, 0.4));
		const a = orthonormalise(nose, drifted);
		expect(a).not.toBeNull();
		expect(dot(a!.nose, a!.up)).toBeCloseTo(0, 12);
		expect(length(a!.up)).toBeCloseTo(1, 12);
		// The nose is authoritative and the up is what moves: an autopilot that
		// let the roll pull the nose round would be flying a different approach
		// from the one it commanded.
		expect(a!.nose).toEqual(nose);
	});

	test("parallel directions are not an attitude", () => {
		expect(orthonormalise(v3(0, 0, -1), v3(0, 0, -2))).toBeNull();
	});
});

describe("the plane crossing is interpolated, not sampled", () => {
	test("it finds the crossing between two frames", () => {
		const frame = frameFor();
		const outside = nominal(frame, {
			rel: scale(frame.axis, frame.planeKm + 0.02),
		});
		const inside = nominal(frame, {
			rel: scale(frame.axis, frame.planeKm - 0.02),
		});
		const at = planeCrossing(frame, outside, inside);
		expect(at).not.toBeNull();
		expect(dot(at!.rel, frame.axis)).toBeCloseTo(frame.planeKm, 12);
	});

	test("leaving through the plane is not a crossing", () => {
		const frame = frameFor();
		const inside = nominal(frame, {
			rel: scale(frame.axis, frame.planeKm - 0.02),
		});
		const outside = nominal(frame, {
			rel: scale(frame.axis, frame.planeKm + 0.02),
		});
		expect(planeCrossing(frame, inside, outside)).toBeNull();
	});
});
