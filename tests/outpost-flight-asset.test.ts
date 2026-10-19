/**
 * Node #1031: the outpost Salvage's flight asset, before the game loads it.
 *
 * `spikes/stations/prepare-flight-asset.mjs` writes it losslessly from
 * `build_model.py -- salvage --flight`. These rows read the shipped file
 * through the browser's loader (`decodeShippedGlb`) and hold what the export
 * promised, in the station's own frame (metres, +z the aperture axis):
 *
 * - the file fits the host and the review density has not come back;
 * - the `aperture-plane` mark lies on the axis at the sim's plane, so the game
 *   draws the model where the sim docks;
 * - the front is redrawn to the sim's pad (principal ruling, 2026-10-19,
 *   option 1): no exterior geometry in the deck the game declares
 *   (`stationInterior("outpost")`), nor in front of it, nor in the corridor
 *   down to the landing well; the deck and every berth the seed can draw are
 *   the model's own, to the sim's figures;
 * - the lane's floor is the model's, behind the sim's landing well, seen
 *   through the deck's hole.
 */
import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import * as THREE from "three";
import { MAX_ASSET_BYTES } from "../scripts/check-dist-sizes.mjs";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { STATION_GEOMETRY } from "../src/station";
import { corridorRadiusKm, stationInterior } from "../src/station-interior";
import { padOpeningFloorKm } from "../src/station-proxy";
import {
	box,
	firstHitDownAxis,
	sceneTriangles,
	triangleHitsBox,
} from "./helpers/pad-geometry";

const PATH = "src/models/outpost-salvage.glb";

/** The review study drew 128 k triangles with its fasteners. A ceiling
 *  against the review density coming back, not a measured render budget. */
const TRIANGLE_CEILING = 250_000;

const PLANE_M = STATION_GEOMETRY.outpost.aperturePlaneKm * 1000;
/** Both seeds: the side berth stands on `port-near` or `starboard-near`. */
const PADS = [0, 1].map((seed) =>
	stationInterior("outpost", STATION_GEOMETRY.outpost.aperturePlaneKm, seed),
);
const PAD = PADS[0];
const BERTHS = [
	...new Map(PADS.flatMap((p) => p.berths).map((b) => [b.id, b])).values(),
];
const DECK_HALF_M = PAD.halfAcrossKm * 1000;
const HOLE_HALF_M = PAD.padHoleHalfKm * 1000;
const CORRIDOR_M = corridorRadiusKm(STATION_GEOMETRY.outpost.aperture) * 1000;
/** The deck's thickness as the game declares it: the outward span the sim
 *  declares (`buildPadDeck`), reaching inward from the plane. */
const DECK_DEPTH_M = (PAD.stagingAxialKm - PAD.mouthAxialKm) * 1000;
const WELL_FLOOR_M = padOpeningFloorKm("outpost") * 1000;

/** The authored pad's parts, which stand in the deck the sim declares, as the
 *  procedural pad's do. */
const isPad = (mesh: string) =>
	mesh.startsWith("interior-") || mesh.startsWith("berth-");

describe(`outpost flight asset (#1031): ${PATH}`, async () => {
	const scene = await decodeShippedGlb(PATH);
	const tris = sceneTriangles(scene);
	const exterior = tris.filter(({ mesh }) => !isPad(mesh));
	const pad = tris.filter(({ mesh }) => isPad(mesh));
	const meshesIn = (
		set: typeof tris,
		min: [number, number, number],
		max: [number, number, number],
	) => {
		const b = box(min, max);
		return [
			...new Set(
				set
					.filter(({ tri }) => triangleHitsBox(tri, b.centre, b.half))
					.map(({ mesh }) => mesh),
			),
		];
	};

	test("fits the host's per-asset limit", () => {
		expect(statSync(PATH).size).toBeLessThan(MAX_ASSET_BYTES);
	});

	test("stays under the triangle ceiling", () => {
		expect(tris.length).toBeGreaterThan(0);
		expect(tris.length).toBeLessThan(TRIANGLE_CEILING);
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
		// The deck the sim declares, and everything over it: the berths, the
		// hover height, the traversal and the corridor, out 2 km.
		expect(
			meshesIn(
				exterior,
				[-DECK_HALF_M, -DECK_HALF_M, PLANE_M - DECK_DEPTH_M],
				[DECK_HALF_M, DECK_HALF_M, PLANE_M + 2000],
			),
		).toEqual([]);
	});

	test("keeps everything out of the corridor down to the landing well", () => {
		// The square that circumscribes the corridor cylinder, as the proxy's
		// keep-out does, from the well's floor outward.
		const r = CORRIDOR_M;
		expect(meshesIn(tris, [-r, -r, WELL_FLOOR_M], [r, r, PLANE_M + 2000])).toEqual(
			[],
		);
	});

	test("lays its deck face on the plane", () => {
		// On the deck ring where nothing stands: between the hole's band and the
		// berths. A ray may meet a plate or, in a seam, the slab under it.
		const all = pad.map(({ tri }) => tri);
		for (const [x, y] of [
			[120, 120],
			[-120, 120],
			[120, -120],
			[-120, -120],
		]) {
			const z = firstHitDownAxis(all, x, y);
			expect([
				x,
				y,
				z !== null && z > PLANE_M - 1.05 && z < PLANE_M + 0.05,
			]).toEqual([x, y, true]);
		}
	});

	test("draws every berth the seed can draw, apart, by the sim's id", () => {
		const names = new Set(pad.map(({ mesh }) => mesh));
		for (const berth of BERTHS)
			expect([
				berth.id,
				[...names].some((n) => n.startsWith(`berth-${berth.id}`)),
			]).toEqual([berth.id, true]);
		expect(BERTHS.map((b) => b.id).sort()).toEqual([
			"deck-near",
			"port-near",
			"starboard-near",
		]);
	});

	test("puts an apron under every berth, and nothing in a berth's upper half", () => {
		for (const berth of BERTHS) {
			const own = pad
				.filter(({ mesh }) => mesh.startsWith(`berth-${berth.id}`))
				.map(({ tri }) => tri);
			const x = berth.centre.across * 1000;
			const y = berth.centre.up * 1000;
			const z = firstHitDownAxis(own, x, y);
			// Laid on the deck: proud of its plates, by less than a metre.
			expect([
				berth.id,
				z !== null && z > PLANE_M + 0.1 && z < PLANE_M + 1,
			]).toEqual([berth.id, true]);
			// The cell's upper half: a parked hull's spine, never the pad's.
			const along = Math.abs(berth.parkedNose.across) > 0.5;
			const hl = (berth.clearLengthKm * 1000) / 2;
			const hb = (berth.clearBeamKm * 1000) / 2;
			const height = berth.clearHeightKm * 1000;
			expect([
				berth.id,
				meshesIn(
					pad,
					[
						x - (along ? hl : hb),
						y - (along ? hb : hl),
						PLANE_M + height / 2,
					],
					[x + (along ? hl : hb), y + (along ? hb : hl), PLANE_M + height],
				),
			]).toEqual([berth.id, []]);
		}
	});

	test("lights its lane edge", () => {
		expect(pad.some(({ mesh }) => mesh.startsWith("interior-lane-edge"))).toBe(
			true,
		);
	});

	test("floors the lane behind the landing well", () => {
		// Seen through the deck's hole: the model's own floor. A docking hull may
		// reach the well's floor below the plane (`padOpeningFloorKm`), so the
		// floor stands behind it, and no deeper than two decks.
		const all = tris.map(({ tri }) => tri);
		for (const fx of [-0.9, -0.45, 0, 0.45, 0.9])
			for (const fy of [-0.9, -0.45, 0, 0.45, 0.9]) {
				const z = firstHitDownAxis(all, fx * HOLE_HALF_M, fy * HOLE_HALF_M);
				expect(z).not.toBeNull();
				expect(z!).toBeLessThan(WELL_FLOOR_M);
				expect(z!).toBeGreaterThan(PLANE_M - 2 * DECK_DEPTH_M);
			}
	});
});
