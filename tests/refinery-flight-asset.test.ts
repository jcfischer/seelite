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
import { REFINERY_FORMS, REFINERY_MODEL_NAMES } from "../src/refinery-flight";
import { REFINERY_PAD_FRAME } from "../src/refinery-pad-frame";
import { corridorRadiusKm, stationInterior } from "../src/station-interior";
import { padOpeningFloorKm } from "../src/station-proxy";
import {
	box,
	firstHitDownAxis,
	triangleHitsBox,
} from "./helpers/pad-geometry";

/** The four forms, `a` to `d` (receipt §Current result). */
const NAMES = REFINERY_FORMS.map((form) => REFINERY_MODEL_NAMES[form]);

/** Each review rock's enclosed volume, million cubic metres, measured
 *  2026-10-13 from `spikes/refineries/o{1,2,3,4}.glb`. The flight rocks read
 *  451.2, 682.7, 295.2 and 300.1 against them: the pad's cut takes less than
 *  the review box's bore did. */
const REVIEW_ROCK_MM3: Record<string, number> = {
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
const CORRIDOR_M = corridorRadiusKm(STATION_GEOMETRY.refinery.aperture) * 1000;
/** The deck's thickness as the game draws it: the outward span the sim
 *  declares (`buildPadDeck`), reaching inward from the plane. */
const DECK_DEPTH_M = (PAD.stagingAxialKm - PAD.mouthAxialKm) * 1000;

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
			/** The authored pad's parts (principal, 2026-10-13), which stand in
			 *  the deck the sim declares, as the procedural pad's did. */
			const isPad = (mesh: string) =>
				mesh.startsWith("interior-") || mesh.startsWith("berth-");
			const exterior = tris.filter(({ mesh }) => !isPad(mesh));
			const pad = tris.filter(({ mesh }) => isPad(mesh));

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

			test("stands nothing of the exterior in the deck, nor in front of it", () => {
				// The deck the sim declares, and everything over it: the berths,
				// the hover height, the traversal and the corridor, out 2 km. The
				// pad's own parts are the next rows'.
				const volume = box(
					[-DECK_HALF_M, -DECK_HALF_M, PLANE_M - DECK_DEPTH_M],
					[DECK_HALF_M, DECK_HALF_M, PLANE_M + 2000],
				);
				expect(
					exterior
						.filter(({ tri }) =>
							triangleHitsBox(tri, volume.centre, volume.half),
						)
						.map(({ mesh }) => mesh),
				).toEqual([]);
			});

			test("lays its deck face on the plane", () => {
				// On the deck ring where nothing stands: between the hole's band and
				// the berths. A ray may meet a plate or, in a seam, the slab under it.
				const all = pad.map(({ tri }) => tri);
				for (const [x, y] of [
					[130, 130],
					[-130, 130],
					[130, -130],
					[-130, -130],
				]) {
					const z = firstHitDownAxis(all, x, y);
					expect([
						x,
						y,
						z !== null && z > PLANE_M - 1 && z < PLANE_M + 0.05,
					]).toEqual([x, y, true]);
				}
			});

			test("keeps its pad out of the corridor and the landing well", () => {
				const r = CORRIDOR_M;
				const corridor = box(
					[-r, -r, padOpeningFloorKm("refinery") * 1000],
					[r, r, PLANE_M + 2000],
				);
				expect(
					pad
						.filter(({ tri }) =>
							triangleHitsBox(tri, corridor.centre, corridor.half),
						)
						.map(({ mesh }) => mesh),
				).toEqual([]);
			});

			test("puts an apron under every berth, and nothing in a berth's upper half", () => {
				const all = pad.map(({ tri }) => tri);
				for (const berth of PAD.berths) {
					const x = berth.centre.across * 1000;
					const y = berth.centre.up * 1000;
					const z = firstHitDownAxis(all, x, y);
					expect([
						berth.id,
						z !== null && z > PLANE_M + 1 && z < PLANE_M + 3,
					]).toEqual([berth.id, true]);
					// The cell's upper half: a parked hull's spine, never the pad's.
					const along = Math.abs(berth.parkedNose.across) > 0.5;
					const hl = (berth.clearLengthKm * 1000) / 2;
					const hb = (berth.clearBeamKm * 1000) / 2;
					const top = PLANE_M + berth.clearHeightKm * 1000;
					const cell = box(
						[x - (along ? hl : hb), y - (along ? hb : hl), PLANE_M + 20],
						[x + (along ? hl : hb), y + (along ? hb : hl), top],
					);
					expect([
						berth.id,
						pad
							.filter(({ tri }) => triangleHitsBox(tri, cell.centre, cell.half))
							.map(({ mesh }) => mesh),
					]).toEqual([berth.id, []]);
				}
			});

			test("lights its lane edge", () => {
				expect(
					pad.some(
						({ mesh }) =>
							mesh === "interior-lane-edge" ||
							mesh.startsWith("interior-lane-edge"),
					),
				).toBe(true);
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

			test("puts its frame's face where the lights stand on it", () => {
				// `REFINERY_PAD_FRAME`: the game stands the heat glow on the inner
				// lip, the vent banks on the top border and a lamp at each corner,
				// so a model built to other figures would leave them hanging or
				// buried. Sampled where they stand. (The
				// Collar's side pods stand proud of the side borders' outer half,
				// where no light is.)
				const all = tris.map(({ tri }) => tri);
				const front = REFINERY_PAD_FRAME.frontKm * 1000;
				for (const [x, y] of [
					[0, 201],
					[0, -201],
					[201, 0],
					[-201, 0],
					[0, 234],
					[0, -234],
					[206, 206],
					[-206, 206],
					[206, -206],
					[-206, -206],
				]) {
					const z = firstHitDownAxis(all, x, y);
					expect([x, y, z !== null]).toEqual([x, y, true]);
					// The dark face, or its ochre armour 1.8 m proud of it; the
					// lights stand 2.5 m proud (`buildRefineryPadCues`).
					expect([x, y, z! > front - 0.3 && z! < front + 2]).toEqual([
						x,
						y,
						true,
					]);
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
