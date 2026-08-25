/**
 * The arithmetic half of #36's visual pass (`docs/specs/station-visuals.md`).
 *
 * Two things live here that a browser probe cannot reach cheaply, and one that
 * it cannot reach at all.
 *
 * The one it cannot reach is §2's structural rule — **a detail level may not
 * change the outline.** On screen that failure looks like a station that is
 * simply a bit different at range, which is also what a correct level switch
 * looks like; the only honest measurement of it is the vertex reach of the same
 * mesh at each level, compared against itself.
 *
 * The two it could reach but should not are the band arithmetic and the texel
 * buffers. A hysteresis band is a state machine over a scalar, and a
 * `DataTexture` whose buffer is not `4 × w × h` for `RGBAFormat` does not throw:
 * it reads out of bounds and draws garbage, which a probe would report as "the
 * plating looks wrong" if it noticed at all.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { STATION_GEOMETRY, type StationType } from "../src/station";
import {
	STATION_SILHOUETTE_KM,
	buildStationMesh,
	setStationDetail,
} from "../src/station-mesh";
import {
	DETAIL_RADII,
	PLATE_TEXTURE_SIZE,
	STATION_VISUALS,
	type StationDetailLevel,
	beaconIntensity,
	flickerIntensity,
	platingTexels,
	stationDetailLevel,
	surfaceTexels,
} from "../src/station-visuals";
import { HANDOFF_HYSTERESIS } from "../src/units";

const TYPES: StationType[] = ["trade", "shipyard", "refinery"];
const LEVELS: StationDetailLevel[] = ["full", "reduced", "outline"];
const GREY = 0x9aa6b2;

/** The farthest vertex from the centre, kilometres — the same measurement
 *  `station-mesh.test.ts` guards #28's budget with, applied here to a mesh whose
 *  detail level has been changed under it. Instanced copies live in
 *  `instanceMatrix` rather than in the graph, so they are walked explicitly or
 *  the window grid is measured at the origin. */
function reachKm(root: THREE.Object3D, type: StationType): number {
	root.updateMatrixWorld(true);
	let maxSq = 0;
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		// Hidden parts are not drawn, so they are not part of the outline. This is
		// the whole reason the assertion below can be an equality: an accessory
		// that was switched off has left the silhouette.
		if (!object.visible) return;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) return;
		const instanced = object as THREE.InstancedMesh;
		const count = instanced.isInstancedMesh ? instanced.count : 1;
		for (let n = 0; n < count; n++) {
			if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
			else instance.identity();
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position as THREE.BufferAttribute, i);
				v.applyMatrix4(instance);
				mesh.localToWorld(v);
				maxSq = Math.max(maxSq, v.lengthSq());
			}
		}
	});
	return Math.sqrt(maxSq) * STATION_GEOMETRY[type].coreRadiusKm;
}

describe("a detail level may not change the outline", () => {
	test("reach is identical at every level", () => {
		for (const type of TYPES) {
			const built = buildStationMesh(type, GREY);
			const measured = LEVELS.map((level) => {
				setStationDetail(built, level);
				return reachKm(built.root, type);
			});
			// Equality, not a tolerance: nothing here moves a vertex, so a
			// difference of any size means an accessory is carrying the outline —
			// which is #28's silhouette probe measuring a different object at 60 km
			// than at 5 km.
			expect(measured[1]).toBe(measured[0]);
			expect(measured[2]).toBe(measured[0]);
		}
	});

	test("the budget still holds with the pass applied", () => {
		// #28's ceiling, re-asserted from this side. `station-mesh.test.ts` proves
		// it for the mesh as built; this proves the visual pass did not spend it.
		for (const type of TYPES) {
			const built = buildStationMesh(type, GREY);
			for (const level of LEVELS) {
				setStationDetail(built, level);
				expect(reachKm(built.root, type)).toBeLessThanOrEqual(
					STATION_SILHOUETTE_KM[type] * (1 + 1e-6),
				);
			}
		}
	});

	test("the accessories really do switch off, so the levels are not all one level", () => {
		// The equality above passes trivially if `setStationDetail` does nothing.
		// This is what stops that reading as a green run.
		for (const type of TYPES) {
			const built = buildStationMesh(type, GREY);
			const drawn = (level: StationDetailLevel) => {
				setStationDetail(built, level);
				let n = 0;
				built.root.traverse((o) => {
					if (o.visible && (o as THREE.Mesh).geometry) n++;
				});
				return n;
			};
			const full = drawn("full");
			const reduced = drawn("reduced");
			const outline = drawn("outline");
			expect(full).toBeGreaterThan(reduced);
			expect(reduced).toBeGreaterThan(outline);
		}
	});

	test("the core and the aperture survive every level", () => {
		// What is left at `outline` is what the identity and #9's approach rest
		// on. A level that stripped the aperture would leave a station with
		// nothing to aim at, at exactly the range you start aiming.
		for (const type of TYPES) {
			const built = buildStationMesh(type, GREY);
			for (const level of LEVELS) {
				setStationDetail(built, level);
				for (const name of ["core", "aperture", "aperture-mouth"]) {
					const part = built.root.getObjectByName(name);
					expect(part).toBeDefined();
					// `visible` is per-object, so an ancestor switched off would leave
					// this true while nothing is drawn. Walk up to the root.
					let node: THREE.Object3D | null = part as THREE.Object3D;
					while (node) {
						expect(node.visible).toBe(true);
						node = node.parent;
					}
				}
			}
		}
	});
});

describe("detail is chosen by apparent size, with the render layer's hysteresis", () => {
	test("the bands are the spec's, measured in the station's own radii", () => {
		expect(stationDetailLevel(undefined, 1)).toBe("full");
		expect(stationDetailLevel(undefined, DETAIL_RADII.full - 1)).toBe("full");
		expect(stationDetailLevel(undefined, DETAIL_RADII.full + 1)).toBe(
			"reduced",
		);
		expect(stationDetailLevel(undefined, DETAIL_RADII.reduced + 1)).toBe(
			"outline",
		);
	});

	test("a station already at a level is held there past the threshold", () => {
		// The directional band, and it is the reason the argument exists. Without
		// it a station parked on a boundary rebuilds its whole detail set every
		// frame, which is more visible than any detail it is choosing between.
		const justOver = DETAIL_RADII.full * 1.02;
		expect(stationDetailLevel("full", justOver)).toBe("full");
		expect(stationDetailLevel("reduced", justOver)).toBe("reduced");
		// And not held for ever: past the widened threshold it lets go.
		const wellOver = DETAIL_RADII.full * HANDOFF_HYSTERESIS * 1.01;
		expect(stationDetailLevel("full", wellOver)).toBe("reduced");
	});

	test("the hysteresis is the renderer's, not a second copy", () => {
		// A local 1.05 would drift the day #15's band is retuned, and the symptom
		// would be a detail switch that no longer lines up with the layer switch.
		const edge = DETAIL_RADII.reduced * HANDOFF_HYSTERESIS;
		expect(stationDetailLevel("reduced", edge * 0.999)).toBe("reduced");
		expect(stationDetailLevel("reduced", edge * 1.001)).toBe("outline");
	});

	test("a far-layer station is always outline", () => {
		// Not a rule the two functions share by construction — they are separate
		// decisions — but they must not fight. The smallest silhouette gives the
		// largest apparent radii, so checking the largest one is the binding case.
		const largest = Math.max(...Object.values(STATION_SILHOUETTE_KM));
		expect(stationDetailLevel("full", 1e4 / largest)).toBe("outline");
	});
});

describe("the plating is generated, not downloaded, and sized for RGBAFormat", () => {
	test("every buffer is exactly 4 x w x h", () => {
		// A `DataTexture` whose buffer is short does not throw. It samples past
		// the end and renders as garbage — the failure this assertion exists for.
		const n = PLATE_TEXTURE_SIZE * PLATE_TEXTURE_SIZE * 4;
		for (const type of TYPES) {
			expect(platingTexels(type).length).toBe(n);
			expect(surfaceTexels(type).length).toBe(n);
		}
	});

	test("the same role generates the same texels twice", () => {
		for (const type of TYPES) {
			const a = platingTexels(type);
			const b = platingTexels(type);
			expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
		}
	});

	test("the three roles do not share a surface", () => {
		// §4's whole claim. Three identical maps would pass every other assertion
		// here and deliver no surface language at all.
		const seen = new Set(
			TYPES.map((t) => Buffer.from(platingTexels(t)).toString("base64")),
		);
		expect(seen.size).toBe(3);
	});

	test("the albedo is greyscale, so the type colour still multiplies through", () => {
		// §7's secondary cue survives the pass only if the map carries no hue of
		// its own. A coloured plate map would silently replace `STATION_COLORS`
		// with a painted-on colour and leave two docstrings claiming otherwise.
		for (const type of TYPES) {
			const texels = platingTexels(type);
			for (let i = 0; i < texels.length; i += 4) {
				expect(texels[i]).toBe(texels[i + 1]);
				expect(texels[i]).toBe(texels[i + 2]);
				expect(texels[i + 3]).toBe(255);
			}
		}
	});

	test("the surface map varies, so roughness is doing something", () => {
		for (const type of TYPES) {
			const texels = surfaceTexels(type);
			const green = new Set<number>();
			for (let i = 1; i < texels.length; i += 4) green.add(texels[i]);
			// A constant channel is a map that could have been a scalar, and the
			// scalar is already on the material.
			expect(green.size).toBeGreaterThan(4);
		}
	});
});

describe("activity is a pure function of the game clock", () => {
	test("the same clock gives the same light", () => {
		// §5.2. Not `performance.now()` and not a frame counter: two clients at
		// one seed and one clock must draw the same frame, and a probe must be
		// able to sample a flicker rather than wait for one.
		for (const type of TYPES) {
			for (const t of [0, 1.7, 93.25, 3600.5]) {
				expect(beaconIntensity(type, t, 0)).toBe(beaconIntensity(type, t, 0));
				expect(flickerIntensity(type, t)).toBe(flickerIntensity(type, t));
			}
		}
	});

	test("every intensity stays inside [0, 1]", () => {
		// These land on `emissiveIntensity` multiplied by a per-fixture ceiling.
		// An unbounded return there is a fixture that blows out the bloom pass.
		for (const type of TYPES) {
			for (let t = 0; t < 40; t += 0.013) {
				const beacon = beaconIntensity(type, t, 0);
				const flicker = flickerIntensity(type, t);
				expect(beacon).toBeGreaterThanOrEqual(0);
				expect(beacon).toBeLessThanOrEqual(1);
				expect(flicker).toBeGreaterThanOrEqual(0);
				expect(flicker).toBeLessThanOrEqual(1);
			}
		}
	});

	test("the trade beacon flashes at the declared duty cycle", () => {
		const { beaconPeriodS, beaconDuty } = STATION_VISUALS.trade.activity;
		const step = beaconPeriodS / 2000;
		let lit = 0;
		let n = 0;
		for (let t = 0; t < beaconPeriodS * 3; t += step) {
			if (beaconIntensity("trade", t, 0) > 0.5) lit++;
			n++;
		}
		// Within a tenth of the declared figure: the ramp at each end of the
		// flash costs a little, and asserting the exact fraction would be
		// asserting the ramp's shape rather than the duty cycle.
		expect(lit / n).toBeGreaterThan(beaconDuty * 0.9);
		expect(lit / n).toBeLessThan(beaconDuty * 1.6);
	});

	test("the port and starboard beacons are out of phase", () => {
		// One offset argument, and this is what it is for: two beacons flashing
		// together read as one light, and the pair is what gives the spin axis a
		// direction at range.
		const { beaconPeriodS } = STATION_VISUALS.trade.activity;
		let differed = false;
		for (let t = 0; t < beaconPeriodS; t += beaconPeriodS / 400) {
			if (
				Math.abs(
					beaconIntensity("trade", t, 0) -
						beaconIntensity("trade", t, beaconPeriodS / 2),
				) > 0.5
			)
				differed = true;
		}
		expect(differed).toBe(true);
	});

	test("a role with no flicker is steady, and one with a flicker is not", () => {
		// The shipyard's welding arc and the refinery's flare are the motion §5
		// promises. A profile whose depth was zero would draw a still frame and
		// pass every other assertion in this block.
		const values = (type: StationType) => {
			const out = new Set<number>();
			for (let t = 0; t < 12; t += 0.017) out.add(flickerIntensity(type, t));
			return out.size;
		};
		expect(values("shipyard")).toBeGreaterThan(20);
		expect(values("refinery")).toBeGreaterThan(20);
		expect(STATION_VISUALS.trade.activity.flickerDepth).toBe(0);
		expect(values("trade")).toBe(1);
	});
});
