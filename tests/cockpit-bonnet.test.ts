/**
 * #204's bonnet: the front of the ship, seen from the cockpit.
 *
 * The real hull cannot be it. The cabin is drawn at about a hundred times life
 * size and the camera sits inside the life-size hull, so the hull's own nose
 * is either behind the canopy or culled from the inside. The bonnet is a proxy
 * in the cabin's frame, and these are the geometric promises it has to keep —
 * where it must be for the eye to find it at all, and where it must not be.
 *
 * Whether it reads as *the ship* is the contact sheet's question.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	BONNET_LIFE_SCALE,
	BONNET_RINGS,
	buildBonnet,
	sillSightline,
} from "../src/cockpit-bonnet";
import { CANOPY_FRAME, CANOPY_Z_KM } from "../src/cockpit-canopy";
import { uvUnitsOf } from "../src/loft";
import { NEAR_NEAR_KM } from "../src/units";

const paint = new THREE.MeshStandardMaterial();

/** Every vertex of the built bonnet, in the cabin's frame. */
function vertices() {
	const mesh = buildBonnet(paint);
	mesh.updateMatrixWorld(true);
	const position = mesh.geometry.getAttribute(
		"position",
	) as THREE.BufferAttribute;
	const out: THREE.Vector3[] = [];
	for (let i = 0; i < position.count; i++)
		out.push(
			new THREE.Vector3()
				.fromBufferAttribute(position, i)
				.applyMatrix4(mesh.matrixWorld),
		);
	return out;
}

/** The sill's top face, which is the edge the eye looks over at the nose. */
const sillTopY = CANOPY_FRAME.sill.position[1] + CANOPY_FRAME.sill.size[1] / 2;

describe("where the bonnet is", () => {
	test("wholly ahead of the canopy, outside the cabin", () => {
		for (const v of vertices()) expect(v.z).toBeLessThan(CANOPY_Z_KM);
	});

	test("beyond the near plane, so a head turn cannot slice it", () => {
		for (const v of vertices())
			expect(v.length()).toBeGreaterThan(NEAR_NEAR_KM);
	});

	test("below the sill, and its farthest point lowest of all", () => {
		// A nose that rose above the sill would stand in the flight view like a
		// bowsprit; the node's line is that it sits below the sill's y.
		const all = vertices();
		for (const v of all) expect(v.y).toBeLessThan(sillTopY);
		const farthest = all.reduce((a, b) => (b.z < a.z ? b : a));
		expect(farthest.y).toBeLessThan(CANOPY_FRAME.sill.position[1]);
	});

	test("its forward part is above the sightline over the sill", () => {
		// **Below the sill and still visible**: the eye looks over the sill's
		// front edge, so a point below that line is hidden behind the sill and a
		// bonnet made only of such points draws nothing. The tip is what must
		// clear it — the node's "the nose in frame".
		const tip = BONNET_RINGS[0];
		const topOfTip = (tip.y ?? 0) + tip.h;
		expect(topOfTip).toBeGreaterThan(sillSightline(tip.z));
	});

	test("the sightline is the line over the sill's front top edge", () => {
		// The helper the check above leans on, checked against the sill itself:
		// at the sill's own front face it returns the sill's top.
		const front = CANOPY_FRAME.sill.position[2] - CANOPY_FRAME.sill.size[2] / 2;
		expect(sillSightline(front)).toBeCloseTo(sillTopY, 12);
	});
});

describe("what the bonnet is", () => {
	test("a lofted hull section, nose first, tapering to the tip", () => {
		for (let i = 1; i < BONNET_RINGS.length; i++) {
			expect(BONNET_RINGS[i].z).toBeGreaterThan(BONNET_RINGS[i - 1].z);
			expect(BONNET_RINGS[i].w).toBeGreaterThan(BONNET_RINGS[i - 1].w);
		}
	});

	test("in the paint it was handed", () => {
		expect(buildBonnet(paint).material).toBe(paint);
	});

	test("its plates are the hull's size at life scale, not a hundred times smaller", () => {
		// `hullLoft` writes UVs in the geometry's own kilometres, and this
		// geometry is a hundred times life size; handed to the hull's plating as
		// they stand, every plate would be a hundredth of the hull's.
		const mesh = buildBonnet(paint);
		expect(uvUnitsOf(mesh.geometry)).toBe("plate");
		const bare = buildBonnet(paint, { plate: false }).geometry;
		const uv = mesh.geometry.getAttribute("uv") as THREE.BufferAttribute;
		const raw = bare.getAttribute("uv") as THREE.BufferAttribute;
		const i = raw.count - 1;
		const ratio = raw.getY(i) / uv.getY(i);
		// km-in-the-cabin to plates: ÷ the life scale, ÷ the panel size.
		expect(ratio).toBeGreaterThan(BONNET_LIFE_SCALE * 0.001);
		expect(ratio).toBeLessThan(BONNET_LIFE_SCALE * 0.1);
	});

	test("named, so a probe can find it", () => {
		expect(buildBonnet(paint).name).toBe("cockpit-bonnet");
	});
});
