/**
 * The docking tunnel — `hud-and-scanner.md` §3's director, rebuilt as world
 * geometry after #69's glass version was flown.
 *
 * **The tunnel is deliberately narrower than every tolerance it helps with, and
 * that is the whole design.** Check 2's position half admits a 35° cone, and a
 * cone drawn truthfully is always a 70°-wide object on screen — its rim sits
 * 35° from the station from wherever you are standing, which is exactly what
 * made #69's glass ring unusable. So this draws the corridor a pilot should
 * *fly*, not the boundary they must not leave: being inside it is a sufficient
 * condition for the position half and for containment, never the gate itself.
 * The gate stays `evaluateEntry`'s.
 *
 * Every row below asserts that sufficiency against the shipped checks rather
 * than against a hand-typed angle.
 */

import { describe, expect, test } from "bun:test";
import {
	AXIS_TOLERANCE_DEG,
	type ApertureFrame,
	type EntryPose,
	V_GATE_KMS,
	apertureFrame,
	evaluateEntry,
	slotBasis,
} from "../src/docking";
import {
	TUNNEL_FLARE_DEG,
	TUNNEL_RINGS,
	dockingTunnel,
} from "../src/docking-tunnel";
import { type Vec3, add, dot, length, scale, sub, v3 } from "../src/vec3";

/** Awkward on purpose: a world axis lets a sign error hide behind coordinates
 *  that happen to agree (`docking.test.ts`'s rule). */
const AXIS = ((): Vec3 => {
	const a = v3(0.37, -0.82, 0.44);
	return scale(a, 1 / length(a));
})();

const frameFor = (
	type: "trade" | "refinery" = "trade",
	phaseRad = 0.7,
): ApertureFrame => apertureFrame(type, AXIS, phaseRad);

/** A pose that is *at* a station-relative point, nose and speed nominal, so the
 *  only thing under test is where the ship is. */
const poseAt = (frame: ApertureFrame, rel: Vec3): EntryPose => ({
	rel,
	vRel: scale(frame.axis, -V_GATE_KMS / 2),
	nose: scale(frame.axis, -1),
	up: slotBasis(frame).across,
});

describe("the corridor's shape", () => {
	test("it spans from the aperture plane to the mouth it was asked for", () => {
		const frame = frameFor();
		const tunnel = dockingTunnel(frame, { mouthKm: 8 });
		expect(tunnel.rings).toHaveLength(TUNNEL_RINGS);
		expect(tunnel.rings[0].axialKm).toBeCloseTo(frame.planeKm, 9);
		expect(tunnel.rings.at(-1)?.axialKm).toBeCloseTo(8, 9);
		// Monotonic, so nothing doubles back on itself.
		for (let i = 1; i < tunnel.rings.length; i++)
			expect(tunnel.rings[i].axialKm).toBeGreaterThan(
				tunnel.rings[i - 1].axialKm,
			);
	});

	test("the throat is the aperture itself, exactly", () => {
		const frame = frameFor();
		const tunnel = dockingTunnel(frame, { mouthKm: 8 });
		expect(tunnel.throat).toBe(tunnel.rings[0]);
		expect(tunnel.throat.halfWidthKm).toBeCloseTo(
			frame.aperture.widthKm / 2,
			12,
		);
		expect(tunnel.throat.halfHeightKm).toBeCloseTo(
			frame.aperture.heightKm / 2,
			12,
		);
	});

	test("it flares at the stated angle and keeps the aperture's aspect", () => {
		const frame = frameFor();
		const tunnel = dockingTunnel(frame, { mouthKm: 8 });
		const aspect = frame.aperture.heightKm / frame.aperture.widthKm;
		for (const ring of tunnel.rings) {
			const expected =
				frame.aperture.widthKm / 2 +
				(ring.axialKm - frame.planeKm) *
					Math.tan((TUNNEL_FLARE_DEG * Math.PI) / 180);
			expect(ring.halfWidthKm).toBeCloseTo(expected, 12);
			// The aspect is held all the way out, because the rectangle's shape is
			// what carries check 4's roll reference — a corridor that squared off
			// with distance would stop being a roll cue exactly where the pilot is
			// still able to fix the roll cheaply.
			expect(ring.halfHeightKm / ring.halfWidthKm).toBeCloseTo(aspect, 12);
		}
	});
});

describe("the corridor is sufficient for the checks it guides", () => {
	/**
	 * The row the design rests on. A ship anywhere on the corridor's surface —
	 * its worst case, the corners — is inside check 2's position half, at every
	 * ring. If this fails, the tunnel is showing a pilot a path that does not
	 * dock.
	 */
	test("every corner of every ring passes check 2's position half", () => {
		for (const type of ["trade", "refinery"] as const) {
			for (const mouthKm of [2, 8, 30]) {
				const frame = frameFor(type);
				const tunnel = dockingTunnel(frame, { mouthKm });
				for (const ring of tunnel.rings)
					for (const corner of ring.corners) {
						const e = evaluateEntry(frame, poseAt(frame, corner), {
							hostile: false,
						});
						expect(e.positionAngleDeg).toBeLessThan(AXIS_TOLERANCE_DEG);
					}
			}
		}
	});

	test("the corridor is genuinely tighter than the gate, not merely inside it", () => {
		const frame = frameFor();
		const tunnel = dockingTunnel(frame, { mouthKm: 8 });
		const worst = Math.max(
			...tunnel.rings.flatMap((ring) =>
				ring.corners.map(
					(corner) =>
						evaluateEntry(frame, poseAt(frame, corner), { hostile: false })
							.positionAngleDeg,
				),
			),
		);
		// Half the tolerance is the claim `docking.md` §3.2 wants: an instrument
		// that only just fits inside a wide gate leaves the gate wide.
		expect(worst).toBeLessThan(AXIS_TOLERANCE_DEG / 2);
	});

	test("a ship on the throat's corner is contained; a hair outside is not", () => {
		const frame = frameFor();
		const tunnel = dockingTunnel(frame, { mouthKm: 8 });
		for (const corner of tunnel.throat.corners) {
			const inside = evaluateEntry(frame, poseAt(frame, corner), {
				hostile: false,
			});
			expect(inside.checks.containment).toBe(true);
			// Pushed out along its own lateral direction, which is the direction
			// containment measures — scaling the whole vector would move it along
			// the axis too and test something else.
			const lateral = sub(corner, scale(frame.axis, frame.planeKm));
			const past = add(scale(frame.axis, frame.planeKm), scale(lateral, 1.001));
			expect(
				evaluateEntry(frame, poseAt(frame, past), { hostile: false }).checks
					.containment,
			).toBe(false);
		}
	});
});

describe("the corridor carries the roll", () => {
	test("its rectangle turns with the slot's phase", () => {
		const across = (phaseRad: number) => {
			const frame = frameFor("trade", phaseRad);
			const tunnel = dockingTunnel(frame, { mouthKm: 8 });
			const corner = tunnel.throat.corners[0];
			const lateral = sub(corner, scale(frame.axis, frame.planeKm));
			return scale(lateral, 1 / length(lateral));
		};
		const at0 = across(0);
		const atQuarter = across(Math.PI / 2);
		// A quarter turn of the slot turns the corridor's corner with it: the two
		// directions are no longer the same, and the rectangle is the roll cue.
		expect(Math.abs(dot(at0, atQuarter))).toBeLessThan(0.999);
	});

	test("a pad's corridor is square, because check 4 does not apply to it", () => {
		const frame = frameFor("refinery");
		const tunnel = dockingTunnel(frame, { mouthKm: 8 });
		expect(frame.aperture.kind).toBe("pad");
		for (const ring of tunnel.rings)
			expect(ring.halfHeightKm).toBeCloseTo(ring.halfWidthKm, 12);
	});
});

describe("the mouth is clamped rather than trusted", () => {
	test("a mouth inside the plane still produces a corridor at the plane", () => {
		const frame = frameFor();
		const tunnel = dockingTunnel(frame, { mouthKm: frame.planeKm / 2 });
		for (const ring of tunnel.rings)
			expect(ring.axialKm).toBeGreaterThanOrEqual(frame.planeKm);
		expect(tunnel.throat.halfWidthKm).toBeCloseTo(
			frame.aperture.widthKm / 2,
			12,
		);
	});
});
