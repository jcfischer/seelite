/**
 * #204's canopy: a pane with thickness, seated in the frame round it, and a
 * glass the cabin's lights cannot reach.
 *
 * What is deliberately not here: whether the reflection is *faint enough* or
 * the pane *reads* as glass. Those are the contact sheet's, and the probe reads
 * the live material's environment off the page.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	CANOPY_FRAME,
	CANOPY_GLASS,
	CANOPY_OUTLINE,
	CANOPY_SIDE_RAILS,
	CANOPY_Z_KM,
	canopyGlassMaterial,
	canopyPaneGeometry,
} from "../src/cockpit-canopy";

const box = (geometry: THREE.BufferGeometry) => {
	geometry.computeBoundingBox();
	return geometry.boundingBox as THREE.Box3;
};

describe("the pane", () => {
	test("has thickness, and it is centred on the canopy plane", () => {
		// The pane was a flat `ShapeGeometry`: no edge for the eye to find.
		const b = box(canopyPaneGeometry());
		expect(b.max.z - b.min.z).toBeCloseTo(CANOPY_GLASS.thicknessKm, 6);
		expect((b.max.z + b.min.z) / 2).toBeCloseTo(CANOPY_Z_KM, 6);
	});

	test("is the outline, and nothing wider", () => {
		const b = box(canopyPaneGeometry());
		const xs = CANOPY_OUTLINE.map(([x]) => x);
		const ys = CANOPY_OUTLINE.map(([, y]) => y);
		expect(b.min.x).toBeCloseTo(Math.min(...xs), 6);
		expect(b.max.x).toBeCloseTo(Math.max(...xs), 6);
		expect(b.min.y).toBeCloseTo(Math.min(...ys), 6);
		expect(b.max.y).toBeCloseTo(Math.max(...ys), 6);
	});
});

describe("the frame the pane is seated in", () => {
	test("each side rail runs between two corners of the outline", () => {
		// The rails and the pane used to be two sets of literals typed
		// separately; derived from one outline they cannot drift apart.
		const corners = CANOPY_OUTLINE.map(([x, y]) => `${x},${y}`);
		for (const rail of CANOPY_SIDE_RAILS) {
			expect(corners).toContain(`${rail.from[0]},${rail.from[1]}`);
			expect(corners).toContain(`${rail.to[0]},${rail.to[1]}`);
			expect(rail.from[2]).toBe(CANOPY_Z_KM);
			expect(rail.to[2]).toBe(CANOPY_Z_KM);
		}
	});

	test("the sill and the header cover the whole of the edge they sit on", () => {
		// A frame member shorter than its edge leaves the pane's corner in open
		// space, which is the "floating" read #105 closed the frame to remove.
		const bottom = CANOPY_OUTLINE.filter(([, y]) => y === CANOPY_FRAME.sill.position[1]);
		const top = CANOPY_OUTLINE.filter(([, y]) => y === CANOPY_FRAME.header.position[1]);
		expect(bottom).toHaveLength(2);
		expect(top).toHaveLength(2);
		const covers = (member: typeof CANOPY_FRAME.sill, edge: typeof bottom) => {
			const half = member.size[0] / 2;
			for (const [x] of edge) expect(Math.abs(x - member.position[0])).toBeLessThanOrEqual(half);
		};
		covers(CANOPY_FRAME.sill, bottom);
		covers(CANOPY_FRAME.header, top);
	});

	test("the pane's thickness is buried in the sill and the header", () => {
		// The pane's edge sits *in* the frame rather than in front of or behind
		// it; a pane thicker than a member would show its edge standing proud.
		for (const member of [CANOPY_FRAME.sill, CANOPY_FRAME.header]) {
			const halfDepth = member.size[2] / 2;
			expect(member.position[2]).toBe(CANOPY_Z_KM);
			expect(CANOPY_GLASS.thicknessKm / 2).toBeLessThan(halfDepth);
		}
	});
});

describe("the glass", () => {
	test("is a class no light reaches", () => {
		// `MeshBasicMaterial` rather than the physical glass the node proposed:
		// the key light is 27 m from the canopy header against a 50 m range and
		// the fill 36 m against 65, so a standard-family pane would be lit by
		// both — the thing the node's own "Do not" list forbids. The class keeps
		// it off, with no exclusion list to maintain, and keeps it out of #201's
		// occlusion walk, which also excludes by class.
		const glass = canopyGlassMaterial();
		expect(glass).toBeInstanceOf(THREE.MeshBasicMaterial);
		expect(glass.transparent).toBe(true);
		expect(glass.depthWrite).toBe(false);
	});

	test("adds the reflection rather than mixing it in", () => {
		// Mix would *replace* the pane's tint with the environment in proportion
		// to `reflectivity`; add lays it over the tint, which is a reflection.
		const glass = canopyGlassMaterial();
		expect(glass.combine).toBe(THREE.AddOperation);
		expect(glass.reflectivity).toBe(CANOPY_GLASS.reflectivity);
		expect(glass.opacity).toBe(CANOPY_GLASS.opacity);
	});

	test("a faint pane, still: more than the flat one, far from a mirror", () => {
		expect(CANOPY_GLASS.opacity).toBeGreaterThan(0.08);
		expect(CANOPY_GLASS.opacity).toBeLessThan(0.2);
		expect(CANOPY_GLASS.reflectivity).toBeGreaterThan(0);
		expect(CANOPY_GLASS.reflectivity).toBeLessThanOrEqual(1);
	});
});
