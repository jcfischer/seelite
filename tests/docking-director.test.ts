/**
 * `docs/specs/hud-and-scanner.md` §3's docking director — the headless half.
 *
 * The director exists because `docking.md` §3.2 records that check 2's 35° and
 * check 4's 50° were set wide **partly because the instruments do not exist**.
 * A cue that measured a slightly different angle from the check would leave
 * them wide for a second reason, so every row below asserts the cue against
 * `evaluateEntry` rather than against a hand-typed number: the director reads
 * the shipped evaluation, and these tests are the assertion that it agrees.
 *
 * Tolerances are data (`docking.test.ts`'s rule), never the literals 35 and 50.
 */

import { describe, expect, test } from "bun:test";
import {
	AXIS_TOLERANCE_DEG,
	GRANT_WINDOW_S,
	ROLL_TOLERANCE_DEG,
	V_GATE_KMS,
	VICINITY_KM,
	type ApertureFrame,
	type DockingState,
	type EntryPose,
	apertureFrame,
	evaluateEntry,
	newDockingState,
	slotBasis,
} from "../src/docking";
import {
	DIRECTOR_RANGE_KM,
	directorEngaged,
	dockingDirector,
} from "../src/docking-director";
import { TUNNEL_MOUTH_FRACTION } from "../src/docking-tunnel";
import { type Vec3, add, dot, length, scale, v3 } from "../src/vec3";

const DEG = Math.PI / 180;

/**
 * The angles a cue sweep visits: a 0.25° pass over the whole range, and a
 * 0.005° pass through the half-degree either side of the tolerance.
 *
 * The coarse grid alone was the first version, and it could not see the defect
 * it was sold as catching: a director whose tolerance was 35.1° disagrees with
 * the gate only on (35°, 35.1°], which a 0.25° grid steps straight over. The
 * exact boundary is skipped in both passes — `evaluateEntry` compares cosines
 * with a 1e-12 slack and the cue compares degrees, so the two may legitimately
 * differ within about 1e-6° of it.
 */
function sweepAngles(toleranceDeg: number): number[] {
	const angles: number[] = [];
	for (let deg = 0; deg <= 90; deg += 0.25) angles.push(deg);
	for (let deg = toleranceDeg - 0.5; deg <= toleranceDeg + 0.5; deg += 0.005)
		angles.push(deg);
	return angles.filter((deg) => Math.abs(deg - toleranceDeg) > 1e-6);
}

/** Awkward on purpose, for `docking.test.ts`'s reason: a world axis lets a sign
 *  error hide behind coordinates that happen to agree. */
const AXIS = ((): Vec3 => {
	const a = v3(0.37, -0.82, 0.44);
	return scale(a, 1 / length(a));
})();

const frameFor = (
	type: "trade" | "refinery" = "trade",
	phaseRad = 0.7,
): ApertureFrame => apertureFrame(type, AXIS, phaseRad);

function nominal(
	frame: ApertureFrame,
	over: Partial<EntryPose> = {},
): EntryPose {
	const basis = slotBasis(frame);
	return {
		rel: scale(frame.axis, frame.planeKm),
		vRel: scale(frame.axis, -V_GATE_KMS / 2),
		nose: scale(frame.axis, -1),
		up: basis.across,
		...over,
	};
}

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

const PERP = slotBasis(apertureFrame("trade", AXIS, 0)).up;

const granted = (expiresAtS: number): DockingState => ({
	...newDockingState(),
	clearance: { kind: "granted", expiresAtS },
});

const director = (
	frame: ApertureFrame,
	pose: EntryPose,
	over: {
		state?: DockingState;
		gameTime?: number;
		stationId?: string;
	} = {},
) =>
	dockingDirector({
		stationId: over.stationId ?? "station-a",
		// Not the origin: the tunnel is placed by adding this, so a zero would let
		// a renderer that forgot to add it look correct.
		stationPos: v3(1_400, -900, 320),
		frame,
		pose,
		state: over.state ?? granted(GRANT_WINDOW_S),
		gameTime: over.gameTime ?? 0,
	});

describe("§3: the axis-alignment cue reads check 2's own angles", () => {
	test("a nominal approach is aligned, with both halves inside the tolerance", () => {
		const frame = frameFor();
		const d = director(frame, nominal(frame));
		expect(d.axis.position.toleranceDeg).toBe(AXIS_TOLERANCE_DEG);
		expect(d.axis.nose.toleranceDeg).toBe(AXIS_TOLERANCE_DEG);
		expect(d.axis.position.within).toBe(true);
		expect(d.axis.nose.within).toBe(true);
		expect(d.aligned).toBe(true);
	});

	test("the cue's angles are the evaluation's, not a second computation", () => {
		const frame = frameFor();
		const nose = rotate(scale(frame.axis, -1), PERP, 12 * DEG);
		const rel = rotate(scale(frame.axis, frame.planeKm), PERP, 20 * DEG);
		const pose = nominal(frame, { nose, rel });
		const e = evaluateEntry(frame, pose, { hostile: false });
		const d = director(frame, pose);
		expect(d.axis.nose.deg).toBe(e.noseAngleDeg);
		expect(d.axis.position.deg).toBe(e.positionAngleDeg);
	});

	test("the nose half can fail alone, and the cue says which half", () => {
		const frame = frameFor();
		const nose = rotate(
			scale(frame.axis, -1),
			PERP,
			(AXIS_TOLERANCE_DEG + 5) * DEG,
		);
		const d = director(frame, nominal(frame, { nose }));
		expect(d.axis.position.within).toBe(true);
		expect(d.axis.nose.within).toBe(false);
		expect(d.aligned).toBe(false);
	});

	/**
	 * The anti-drift row. `evaluateEntry` compares cosines and the cue compares
	 * degrees, so the two could disagree in a band around the tolerance without
	 * either being wrong on its own terms. This sweeps the whole range and
	 * requires agreement everywhere outside a 1e-6° band, which is the width the
	 * cosine comparison's own 1e-12 slack projects to.
	 */
	test("the nose cue's verdict agrees with check 2 across the sweep", () => {
		const frame = frameFor();
		for (const deg of sweepAngles(AXIS_TOLERANCE_DEG)) {
			const nose = rotate(scale(frame.axis, -1), PERP, deg * DEG);
			const pose = nominal(frame, { nose });
			const e = evaluateEntry(frame, pose, { hostile: false });
			const d = director(frame, pose);
			expect(d.axis.position.within && d.axis.nose.within).toBe(
				e.checks.axisAlignment,
			);
		}
	});

	/**
	 * The position half needs its **own** sweep, and the first version of this
	 * file did not have one: the sweep above holds `rel` nominal, so
	 * `axis.position.within` is `true` at every step and the conjunction is
	 * driven by the nose alone. A position cue bound to the wrong tolerance
	 * passed the whole file.
	 */
	test("the position cue's verdict agrees with check 2 across its own sweep", () => {
		const frame = frameFor();
		const nominalRel = scale(frame.axis, frame.planeKm);
		for (const deg of sweepAngles(AXIS_TOLERANCE_DEG)) {
			const rel = rotate(nominalRel, PERP, deg * DEG);
			const pose = nominal(frame, { rel });
			const e = evaluateEntry(frame, pose, { hostile: false });
			const d = director(frame, pose);
			expect(d.axis.position.deg).toBe(e.positionAngleDeg);
			expect(d.axis.position.within && d.axis.nose.within).toBe(
				e.checks.axisAlignment,
			);
		}
	});
});

describe("§3: the roll-match ring reads check 4's own angle", () => {
	test("a slot carries a ring at check 4's tolerance", () => {
		const frame = frameFor("trade");
		const d = director(frame, nominal(frame));
		expect(d.roll).not.toBeNull();
		expect(d.roll?.toleranceDeg).toBe(ROLL_TOLERANCE_DEG);
		expect(d.roll?.within).toBe(true);
	});

	test("a pad has no ring, because check 4 does not apply to it", () => {
		const frame = frameFor("refinery");
		const d = director(frame, nominal(frame));
		expect(d.roll).toBeNull();
		// And that absence is not a failure: a pad approach is still aligned.
		expect(d.aligned).toBe(true);
	});

	test("a mis-rolled slot fails the ring and the alignment", () => {
		const frame = frameFor("trade");
		const up = rotate(
			slotBasis(frame).across,
			frame.axis,
			(ROLL_TOLERANCE_DEG + 5) * DEG,
		);
		const pose = nominal(frame, { up });
		const e = evaluateEntry(frame, pose, { hostile: false });
		const d = director(frame, pose);
		expect(d.roll?.within).toBe(false);
		expect(d.roll?.deg).toBe(e.rollAngleDeg);
		expect(d.aligned).toBe(false);
	});

	/**
	 * Check 4 is unsigned by design — it compares against the axis *line* — and
	 * an unsigned cue is a guess-and-widen loop for the pilot. These two rows
	 * are why the director carries a signed roll beside it, and the first
	 * asserts the two agree rather than assuming it.
	 */
	test("the signed roll has check 4's magnitude and the pose's direction", () => {
		const frame = frameFor("trade");
		for (const deg of [-40, -12, 0, 12, 40]) {
			const up = rotate(slotBasis(frame).across, frame.axis, deg * DEG);
			const pose = nominal(frame, { up });
			const d = director(frame, pose);
			expect(d.rollSignedDeg).toBeCloseTo(deg, 6);
			expect(Math.abs(d.rollSignedDeg as number)).toBeCloseTo(
				d.roll?.deg as number,
				6,
			);
		}
	});

	test("the signed roll folds the long way round to the short one", () => {
		const frame = frameFor("trade");
		// 170° out is 10° out the other way: a slot is symmetric, and an
		// instrument saying "roll 170°" sends the pilot around the houses.
		const up = rotate(slotBasis(frame).across, frame.axis, 170 * DEG);
		const d = director(frame, nominal(frame, { up }));
		expect(d.rollSignedDeg).toBeCloseTo(-10, 6);
	});

	test("a pad carries no signed roll either", () => {
		const frame = frameFor("refinery");
		expect(director(frame, nominal(frame)).rollSignedDeg).toBeNull();
	});

	test("the ring's verdict agrees with check 4 across the sweep", () => {
		const frame = frameFor("trade");
		for (const deg of sweepAngles(ROLL_TOLERANCE_DEG)) {
			const up = rotate(slotBasis(frame).across, frame.axis, deg * DEG);
			const pose = nominal(frame, { up });
			const e = evaluateEntry(frame, pose, { hostile: false });
			const d = director(frame, pose);
			expect(d.roll?.within).toBe(e.checks.rollMatch);
			// The signed roll is the module's one independent computation, so the
			// agreement is asserted **at every angle** rather than at a handful of
			// samples inside the fold-free band, where a fold error cannot show.
			expect(Math.abs(d.rollSignedDeg as number)).toBeCloseTo(
				e.rollAngleDeg,
				9,
			);
		}
	});

	/**
	 * The degenerate pose, and the one place the signed cue deliberately
	 * declines to agree.
	 *
	 * `evaluateEntry` guards on `length(projected) === 0` — an exact zero — and
	 * an up-vector *set* to the docking axis does not produce one: `dot(up,
	 * axis)` is 1 to within a rounding error, so a residue of order 1e-17
	 * survives and an angle taken from it is float noise. Measured here the
	 * shipped check reads 86.78° where the same arithmetic signed reads 51.26°.
	 * Neither is wrong; both are noise. So the director reports no angle rather
	 * than drawing a tick nobody measured, and this row pins that divergence
	 * instead of hiding it behind a loose tolerance.
	 */
	/**
	 * The sweep above holds the up-vector exactly in the slot plane and the nose
	 * on the axis — one degree of freedom, and not the one the projection guard
	 * exists for. A real approach has neither: the nose is off-axis while it is
	 * being corrected, and the up-vector has a component along the docking axis
	 * for the whole of that. This sweeps both at once, because the claim being
	 * made is about `signedRollDeg`'s *conditioning*, and a pose that is always
	 * perfectly conditioned cannot test it.
	 */
	test("cue and check agree with the nose off-axis and the up-vector out of plane", () => {
		const frame = frameFor("trade");
		const basis = slotBasis(frame);
		for (const noseDeg of [0, 20, 34, 48]) {
			const nose = rotate(scale(frame.axis, -1), PERP, noseDeg * DEG);
			for (const tiltDeg of [-70, -25, 25, 70]) {
				for (const rollDeg of [-80, -47, -3, 0, 3, 47, 80]) {
					const inPlane = rotate(basis.across, frame.axis, rollDeg * DEG);
					// Tilted about the slot's own `across`, which takes the vector out
					// of the plane and gives it the axial component the guard reads.
					const up = rotate(inPlane, basis.across, tiltDeg * DEG);
					const pose = nominal(frame, { nose, up });
					const e = evaluateEntry(frame, pose, { hostile: false });
					const d = director(frame, pose);
					expect(d.roll?.deg).toBe(e.rollAngleDeg);
					expect(d.roll?.within).toBe(e.checks.rollMatch);
					expect(Math.abs(d.rollSignedDeg as number)).toBeCloseTo(
						e.rollAngleDeg,
						9,
					);
				}
			}
		}
	});

	test("an up-vector along the docking axis reports no signed roll", () => {
		const frame = frameFor("trade");
		const pose = nominal(frame, { up: frame.axis });
		const e = evaluateEntry(frame, pose, { hostile: false });
		const d = director(frame, pose);
		// The check still answers, off a projection that is rounding error.
		expect(d.roll?.deg).toBe(e.rollAngleDeg);
		expect(d.roll?.within).toBe(e.checks.rollMatch);
		// The cue does not.
		expect(Number.isNaN(d.rollSignedDeg as number)).toBe(true);
	});
});

describe("§3: clearance, grant window, and blocking states", () => {
	test("a live grant shows the remaining window and blocks nothing", () => {
		const frame = frameFor();
		const d = director(frame, nominal(frame), {
			state: granted(GRANT_WINDOW_S),
			gameTime: GRANT_WINDOW_S - 42,
		});
		expect(d.blocking).toBeNull();
		expect(d.grantRemainingS).toBe(42);
	});

	test("an expired grant is no grant, and the director says so", () => {
		const frame = frameFor();
		const d = director(frame, nominal(frame), {
			state: granted(GRANT_WINDOW_S),
			gameTime: GRANT_WINDOW_S,
		});
		expect(d.grantRemainingS).toBeNull();
		expect(d.blocking?.kind).toBe("no-clearance");
	});

	test("no clearance at all blocks with a written reason", () => {
		const frame = frameFor();
		const d = director(frame, nominal(frame), { state: newDockingState() });
		expect(d.blocking?.kind).toBe("no-clearance");
		// §3: "a red mark alone never carries the consequence".
		expect(d.blocking?.text).toMatch(/do not enter/i);
		expect(d.blocking?.text).toMatch(/clearance/i);
	});

	test("a queued request names its position rather than reading as denial", () => {
		const frame = frameFor();
		const d = director(frame, nominal(frame), {
			state: {
				...newDockingState(),
				clearance: { kind: "queued", position: 3 },
			},
		});
		expect(d.blocking?.kind).toBe("no-clearance");
		expect(d.blocking?.text).toMatch(/queue/i);
		expect(d.blocking?.text).toContain("3");
	});

	test("a contraband denial names contraband", () => {
		const frame = frameFor();
		const d = director(frame, nominal(frame), {
			state: {
				...newDockingState(),
				clearance: { kind: "denied", reason: "contraband" },
			},
		});
		expect(d.blocking?.kind).toBe("denied");
		expect(d.blocking?.text).toMatch(/contraband/i);
	});

	/**
	 * §4's attention order is "blocking danger or failed clearance" first, and
	 * hostility is the danger. A build that reported the denial reason would be
	 * telling the pilot about paperwork while the station shoots at them.
	 */
	test("hostility outranks every other blocking state", () => {
		const frame = frameFor();
		const d = director(frame, nominal(frame), {
			state: {
				hostile: true,
				hostileUntilS: 600,
				clearance: { kind: "denied", reason: "hostile" },
			},
		});
		expect(d.blocking?.kind).toBe("hostile");
		expect(d.blocking?.text).toMatch(/hostile/i);
	});

	/**
	 * The order §9's constraint fixes: `grantLive && !hostile`, in that order.
	 * A station that turns hostile while holding a live grant is still blocking.
	 */
	test("a station that turns hostile blocks despite a live grant", () => {
		const frame = frameFor();
		const d = director(frame, nominal(frame), {
			state: { ...granted(GRANT_WINDOW_S), hostile: true, hostileUntilS: 600 },
			gameTime: 0,
		});
		expect(d.grantRemainingS).toBe(GRANT_WINDOW_S);
		expect(d.blocking?.kind).toBe("hostile");
	});
});

describe("§3: when the director is on the glass at all", () => {
	/**
	 * The rule the first build got wrong. It gated on `VICINITY_KM` — §6's
	 * *clearance-request* range, ten thousand kilometres — so a funnel was on
	 * glass through most of ordinary in-system flight. It is a director; there
	 * is nothing to direct from a tenth of an AU out.
	 */
	test("beyond the approach range it is off, however good the clearance", () => {
		const frame = frameFor();
		const far = nominal(frame, {
			rel: scale(frame.axis, DIRECTOR_RANGE_KM * 2),
		});
		const d = director(frame, far, { state: granted(GRANT_WINDOW_S) });
		expect(d.inVicinity).toBe(true);
		expect(directorEngaged(d)).toBe(false);
	});

	test("inside the range it needs the protocol engaged, not just proximity", () => {
		const frame = frameFor();
		const unasked = director(frame, nominal(frame), {
			state: newDockingState(),
		});
		expect(unasked.rangeKm).toBeLessThan(DIRECTOR_RANGE_KM);
		// Requesting clearance is what turns the instrument on.
		expect(directorEngaged(unasked)).toBe(false);
		expect(
			directorEngaged(
				director(frame, nominal(frame), { state: granted(GRANT_WINDOW_S) }),
			),
		).toBe(true);
	});

	test("a queued or denied station keeps it, because the refusal is the point", () => {
		const frame = frameFor();
		for (const clearance of [
			{ kind: "queued", position: 2 } as const,
			{ kind: "denied", reason: "contraband" } as const,
		])
			expect(
				directorEngaged(
					director(frame, nominal(frame), {
						state: { ...newDockingState(), clearance },
					}),
				),
			).toBe(true);
	});

	/**
	 * §3's blocking state is the one thing a pilot must not lose by looking
	 * away, and a station can turn hostile without ever having been asked.
	 */
	test("a hostile station keeps it even with no clearance ever requested", () => {
		const frame = frameFor();
		const d = director(frame, nominal(frame), {
			state: { ...newDockingState(), hostile: true, hostileUntilS: 600 },
		});
		expect(d.clearanceKind).toBe("none");
		expect(directorEngaged(d)).toBe(true);
	});
});

describe("§3: the corridor the director carries", () => {
	test("its mouth stops short of the ship rather than at it", () => {
		const frame = frameFor();
		const axialKm = 12;
		const d = director(
			frame,
			nominal(frame, {
				rel: scale(frame.axis, axialKm),
			}),
			{ state: granted(GRANT_WINDOW_S) },
		);
		const mouth = d.tunnel.rings.at(-1) as { axialKm: number };
		expect(mouth.axialKm).toBeCloseTo(axialKm * TUNNEL_MOUTH_FRACTION, 9);
		// Ahead of the pilot, which is the whole of why it is a tunnel to fly
		// into: a mouth at the eye projects its corners to the frame edges.
		expect(mouth.axialKm).toBeLessThan(axialKm);
		expect(d.tunnel.throat.axialKm).toBeCloseTo(frame.planeKm, 9);
	});

	test("it is placed at the station, not at the origin", () => {
		const frame = frameFor();
		const d = director(frame, nominal(frame));
		// The renderer adds `stationPos` to every corner. A director that left it
		// at the origin would draw the corridor at the centre of the system.
		expect(d.stationPos).not.toEqual(v3(0, 0, 0));
	});
});

describe("§3: range and closing speed", () => {
	test("the closing cue reads check 6's gate", () => {
		const frame = frameFor();
		const d = director(frame, nominal(frame));
		expect(d.closing.gateKms).toBe(V_GATE_KMS);
		expect(d.closing.kms).toBeCloseTo(V_GATE_KMS / 2, 12);
		expect(d.closing.within).toBe(true);
	});

	test("closing faster than the gate falls outside the cue", () => {
		const frame = frameFor();
		const pose = nominal(frame, {
			vRel: scale(frame.axis, -V_GATE_KMS * 2),
		});
		const d = director(frame, pose);
		expect(d.closing.within).toBe(false);
	});

	test("beyond the clearance range the director is out of the vicinity", () => {
		const frame = frameFor();
		const near = director(frame, nominal(frame));
		expect(near.inVicinity).toBe(true);
		const far = director(
			frame,
			nominal(frame, { rel: scale(frame.axis, VICINITY_KM * 2) }),
		);
		expect(far.inVicinity).toBe(false);
		expect(far.rangeKm).toBeCloseTo(VICINITY_KM * 2, 6);
	});
});
