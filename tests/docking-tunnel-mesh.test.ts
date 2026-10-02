/**
 * The corridor's world lines: `docking-tunnel.ts`'s shape, copied and not
 * re-authored, and depth-tested so the hull can hide it.
 */

import { describe, expect, test } from "bun:test";
import { apertureFrame } from "../src/docking";
import { TUNNEL_RINGS, dockingTunnel } from "../src/docking-tunnel";
import {
	THROAT_STANDOFF_KM,
	buildTunnelLines,
	tunnelLineCounts,
	writeTunnelLines,
} from "../src/docking-tunnel-mesh";
import { type Vec3, add, cross, length, scale, v3 } from "../src/vec3";

const AXIS = ((): Vec3 => {
	const a = v3(0.37, -0.82, 0.44);
	return scale(a, 1 / length(a));
})();
const REFERENCE = ((): Vec3 => {
	const p = cross(AXIS, v3(0, 0, 1));
	return scale(p, 1 / length(p));
})();

const STYLE = {
	throat: { color: 0xffd17a, opacity: 0.9 },
	corridor: { color: 0x78cdf5, opacity: 0.4 },
};

const vertices = (attr: { array: ArrayLike<number>; count: number }) => {
	const out: Vec3[] = [];
	for (let i = 0; i < attr.count; i++)
		out.push(
			v3(attr.array[i * 3], attr.array[i * 3 + 1], attr.array[i * 3 + 2]),
		);
	return out;
};

const near = (a: Vec3, b: Vec3) => length(add(a, scale(b, -1))) < 1e-6;

describe("the corridor's world lines", () => {
	const frame = apertureFrame("trade", AXIS, 0.7, REFERENCE);
	const tunnel = dockingTunnel(frame, { mouthKm: frame.planeKm + 3 });
	const lines = buildTunnelLines(TUNNEL_RINGS);
	writeTunnelLines(lines, tunnel, frame.axis, STYLE);
	const lifted = tunnel.throat.corners.map((c) =>
		add(c, scale(frame.axis, THROAT_STANDOFF_KM)),
	);

	test("the hull hides them, and they hide nothing", () => {
		for (const part of [lines.throat, lines.corridor]) {
			expect(part.material.depthTest).toBe(true);
			expect(part.material.depthWrite).toBe(false);
		}
	});

	test("the throat is the aperture, stood off the plane along the axis", () => {
		const drawn = vertices(lines.throat.geometry.getAttribute("position"));
		expect(drawn).toHaveLength(8);
		for (let k = 0; k < 4; k++) {
			expect(near(drawn[k * 2], lifted[k])).toBe(true);
			expect(near(drawn[k * 2 + 1], lifted[(k + 1) % 4])).toBe(true);
		}
	});

	test("every outer corner of the tunnel is in the corridor's buffer", () => {
		const drawn = vertices(lines.corridor.geometry.getAttribute("position"));
		expect(drawn).toHaveLength(tunnelLineCounts(TUNNEL_RINGS).corridor);
		for (const ring of tunnel.rings.slice(1))
			for (const corner of ring.corners)
				expect(drawn.some((p) => near(p, corner))).toBe(true);
		// And the mouth is the last ring, three kilometres out.
		expect(tunnel.rings.at(-1)?.axialKm).toBeCloseTo(frame.planeKm + 3, 9);
	});

	test("each rail runs from the drawn throat out through every ring", () => {
		const drawn = vertices(lines.corridor.geometry.getAttribute("position"));
		const segmentsOf = (from: Vec3, to: Vec3) =>
			drawn.some(
				(p, i) => i % 2 === 0 && near(p, from) && near(drawn[i + 1], to),
			);
		for (let k = 0; k < 4; k++) {
			expect(segmentsOf(lifted[k], tunnel.rings[1].corners[k])).toBe(true);
			for (let r = 2; r < tunnel.rings.length; r++)
				expect(
					segmentsOf(
						tunnel.rings[r - 1].corners[k],
						tunnel.rings[r].corners[k],
					),
				).toBe(true);
		}
	});

	test("the styles land on the materials", () => {
		expect(lines.throat.material.opacity).toBe(0.9);
		expect(lines.corridor.material.opacity).toBe(0.4);
		expect(lines.throat.material.color.getHex()).toBe(0xffd17a);
	});

	test("a corridor with another ring count is refused, not half-written", () => {
		const other = buildTunnelLines(TUNNEL_RINGS + 1);
		expect(() => writeTunnelLines(other, tunnel, frame.axis, STYLE)).toThrow();
	});
});
