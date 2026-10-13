/**
 * Node #819: the refinery flight assets, before the game loads them.
 *
 * `spikes/refineries/prepare-flight-asset.mjs` writes them losslessly from
 * `build_model.py --flight`. These rows read the shipped files through the
 * browser's loader (`decodeShippedGlb`) and hold what the export promised, in
 * the station's own frame (metres, +z the aperture axis):
 *
 * - the file fits the host and the review density has not come back;
 * - the `aperture-plane` mark lies on the axis at the sim's plane, so the game
 *   draws the model where the sim docks;
 * - the recessed pad (principal ruling, 2026-10-13) holds the sim's pad: no
 *   model geometry in the deck the game draws (`stationInterior("refinery")`),
 *   nor anywhere in front of it, where the berths, the traversal and the
 *   approach corridor are;
 * - the lane's floor is the model's, behind the sim's landing well, seen
 *   through the deck's hole;
 * - a frame surrounds the deck.
 */
import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import * as THREE from "three";
import { MAX_ASSET_BYTES } from "../scripts/check-dist-sizes.mjs";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { STATION_GEOMETRY } from "../src/station";
import { stationInterior } from "../src/station-interior";
import { padOpeningFloorKm } from "../src/station-proxy";

/** The four forms, `a` to `d` (receipt §Current result). */
const NAMES = ["warren", "collar", "spar", "works"] as const;

/** Each review rock's enclosed volume, million cubic metres, measured
 *  2026-10-13 from `spikes/refineries/o{1,2,3,4}.glb`. The flight rocks read
 *  451.2, 682.7, 295.2 and 300.1 against them: the pad's cut takes less than
 *  the review box's bore did. */
const REVIEW_ROCK_MM3: Record<(typeof NAMES)[number], number> = {
	warren: 450.3,
	collar: 666.1,
	spar: 292.3,
	works: 300.1,
};

/** The review studies drew 158 k to 492 k triangles. A ceiling against the
 *  review density coming back, not a measured render budget. */
const TRIANGLE_CEILING = 250_000;

const PLANE_M = STATION_GEOMETRY.refinery.aperturePlaneKm * 1000;
const PAD = stationInterior(
	"refinery",
	STATION_GEOMETRY.refinery.aperturePlaneKm,
);
const DECK_HALF_M = PAD.halfAcrossKm * 1000;
const HOLE_HALF_M = PAD.padHoleHalfKm * 1000;
/** The deck's thickness as the game draws it: the outward span the sim
 *  declares (`buildPadDeck`), reaching inward from the plane. */
const DECK_DEPTH_M = (PAD.stagingAxialKm - PAD.mouthAxialKm) * 1000;

/** Separating-axis test of a triangle against an axis-aligned box. */
function triangleHitsBox(
	tri: THREE.Vector3[],
	centre: THREE.Vector3,
	half: THREE.Vector3,
): boolean {
	const v = tri.map((p) => p.clone().sub(centre));
	const e = [
		v[1].clone().sub(v[0]),
		v[2].clone().sub(v[1]),
		v[0].clone().sub(v[2]),
	];
	const axes: THREE.Vector3[] = [
		new THREE.Vector3(1, 0, 0),
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(0, 0, 1),
		e[0].clone().cross(e[1]),
	];
	for (const edge of e)
		for (const unit of axes.slice(0, 3)) axes.push(unit.clone().cross(edge));
	for (const axis of axes) {
		if (axis.lengthSq() < 1e-18) continue;
		const p = v.map((q) => q.dot(axis));
		const r =
			half.x * Math.abs(axis.x) +
			half.y * Math.abs(axis.y) +
			half.z * Math.abs(axis.z);
		if (Math.min(...p) >= r || Math.max(...p) <= -r) return false;
	}
	return true;
}

/** A box from its min and max corners. */
function box(min: [number, number, number], max: [number, number, number]) {
	const lo = new THREE.Vector3(...min);
	const hi = new THREE.Vector3(...max);
	return {
		centre: lo.clone().add(hi).multiplyScalar(0.5),
		half: hi.clone().sub(lo).multiplyScalar(0.5),
	};
}

/** Where a ray down −z from (x, y, far in front) first meets a triangle. */
function firstHitDownAxis(
	tris: THREE.Vector3[][],
	x: number,
	y: number,
): number | null {
	let best: number | null = null;
	for (const [a, b, c] of tris) {
		const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
		if (Math.abs(d) < 1e-9) continue;
		const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / d;
		const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / d;
		if (u < 0 || v < 0 || u + v > 1) continue;
		const z = u * a.z + v * b.z + (1 - u - v) * c.z;
		if (best === null || z > best) best = z;
	}
	return best;
}

describe("refinery flight assets (#819)", () => {
	for (const name of NAMES) {
		const path = `src/models/refinery-${name}.glb`;
		describe(path, async () => {
			const scene = await decodeShippedGlb(path);
			scene.updateMatrixWorld(true);
			const tris: { mesh: string; tri: THREE.Vector3[] }[] = [];
			scene.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const g = o.geometry as THREE.BufferGeometry;
				const position = g.getAttribute("position");
				const index = g.getIndex()!;
				for (let i = 0; i < index.count; i += 3)
					tris.push({
						mesh: o.name,
						tri: [0, 1, 2].map((k) =>
							new THREE.Vector3()
								.fromBufferAttribute(position, index.getX(i + k))
								.applyMatrix4(o.matrixWorld),
						),
					});
			});
			const hits = (b: ReturnType<typeof box>) =>
				tris
					.filter(({ tri }) => triangleHitsBox(tri, b.centre, b.half))
					.map(({ mesh }) => mesh);

			test("fits the host's per-asset limit", () => {
				expect(statSync(path).size).toBeLessThan(MAX_ASSET_BYTES);
			});

			test("stays under the triangle ceiling", () => {
				expect(tris.length).toBeGreaterThan(0);
				expect(tris.length).toBeLessThan(TRIANGLE_CEILING);
			});

			test("carries its rock, whole", () => {
				// The flight export's cut once wrote the asteroid's node with no mesh,
				// and once (the float solver on the Works) left a ring of fragments
				// of more than 5 000 triangles. So the rock's enclosed volume is held
				// against the review's.
				const rock = scene.getObjectByName("quarried-asteroid");
				expect(rock).toBeDefined();
				let volume = 0;
				rock!.traverse((o) => {
					if (!(o instanceof THREE.Mesh)) return;
					const p = o.geometry.getAttribute("position");
					const ix = o.geometry.getIndex()!;
					const [a, b, c] = [0, 1, 2].map(() => new THREE.Vector3());
					for (let i = 0; i < ix.count; i += 3) {
						a.fromBufferAttribute(p, ix.getX(i)).applyMatrix4(o.matrixWorld);
						b.fromBufferAttribute(p, ix.getX(i + 1)).applyMatrix4(
							o.matrixWorld,
						);
						c.fromBufferAttribute(p, ix.getX(i + 2)).applyMatrix4(
							o.matrixWorld,
						);
						volume += a.dot(b.clone().cross(c)) / 6;
					}
				});
				expect(volume / 1e6).toBeGreaterThan(0.8 * REVIEW_ROCK_MM3[name]);
			});

			test("marks its aperture plane on the axis at the sim's figure", () => {
				const mark = scene.getObjectByName("aperture-plane");
				expect(mark).toBeDefined();
				const p = mark!.getWorldPosition(new THREE.Vector3());
				expect(Math.abs(p.x)).toBeLessThan(0.01);
				expect(Math.abs(p.y)).toBeLessThan(0.01);
				expect(Math.abs(p.z - PLANE_M)).toBeLessThan(0.01);
			});

			test("stands nothing in the deck, nor in front of it", () => {
				// The deck the game draws, and everything over it: the berths, the
				// hover height, the traversal and the corridor, out 2 km.
				const pad = box(
					[-DECK_HALF_M, -DECK_HALF_M, PLANE_M - DECK_DEPTH_M],
					[DECK_HALF_M, DECK_HALF_M, PLANE_M + 2000],
				);
				expect(hits(pad)).toEqual([]);
			});

			test("floors the lane behind the landing well", () => {
				// Seen through the deck's hole: the model's own floor. A docking hull
				// may reach the well's floor below the plane (`padOpeningFloorKm`),
				// so the floor stands behind it, and no deeper than two decks.
				const all = tris.map(({ tri }) => tri);
				const well = padOpeningFloorKm("refinery") * 1000;
				for (const fx of [-0.9, -0.45, 0, 0.45, 0.9])
					for (const fy of [-0.9, -0.45, 0, 0.45, 0.9]) {
						const z = firstHitDownAxis(all, fx * HOLE_HALF_M, fy * HOLE_HALF_M);
						expect(z).not.toBeNull();
						expect(z!).toBeLessThan(well);
						expect(z!).toBeGreaterThan(PLANE_M - 2 * DECK_DEPTH_M);
					}
			});

			test("frames the deck", () => {
				// Just outside the deck's edge, on each side, the frame stands in
				// front of the plane.
				const all = tris.map(({ tri }) => tri);
				const edge = DECK_HALF_M + 25;
				for (const [x, y] of [
					[edge, 0],
					[-edge, 0],
					[0, edge],
					[0, -edge],
				]) {
					const z = firstHitDownAxis(all, x, y);
					expect(z).not.toBeNull();
					expect(z!).toBeGreaterThan(PLANE_M);
				}
			});
		});
	}
});
