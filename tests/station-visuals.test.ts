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
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";
import {
	STATION_FORMS,
	STATION_SILHOUETTE_KM,
	buildStationForm,
	buildStationMesh,
	setStationDetail,
	updateStationVisuals,
} from "../src/station-mesh";
import {
	DETAIL_RADII,
	STATION_VISUALS,
	type StationDetailLevel,
	strobeIntensity,
	flickerIntensity,
	platingTexels,
	stationDetailLevel,
	surfaceTexels,
} from "../src/station-visuals";
import { PLATE_TEXTURE_SIZE } from "../src/surface";
import { HANDOFF_HYSTERESIS, HANDOFF_KM } from "../src/units";

// From `station.ts`, not a literal: a fourth station type must reach every
// loop in this file, and a hand-written list is exactly the place it would not.
const TYPES: StationType[] = STATION_TYPES;
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
	// An explicit stack rather than `traverse`, because the two behave
	// differently at the point this test rests on: returning early from a
	// `traverse` callback skips that node and **still visits its children**, so a
	// hidden group with drawn-looking descendants would have been measured. That
	// holds today only because every tagged accessory happens to be a leaf, which
	// is not something this assertion should depend on.
	const stack: THREE.Object3D[] = [root];
	while (stack.length) {
		const object = stack.pop() as THREE.Object3D;
		// Hidden parts are not drawn, so neither they nor anything under them is
		// part of the outline. This is what lets the assertion below be an
		// equality rather than a tolerance.
		if (!object.visible) continue;
		for (const child of object.children) stack.push(child);
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) continue;
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
	}
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
			expect([type, measured[1]]).toEqual([type, measured[0]]);
			expect([type, measured[2]]).toEqual([type, measured[0]]);
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

describe("a fixture is on the station it is mounted on", () => {
	test("both strobes sit out on the hull, on every form that has them", () => {
		// #28 could assert this exactly — its hull was an octahedron, whose
		// surface is the single plane |x| + |y| + |z| = r, so "on the hull" was an
		// equation. Twelve forms share no such equation, and the first
		// generalisation was too weak to be worth having: a floor at 0.3 of the
		// core radius passes the very defect its own comment recounted, a lamp at
		// (0.45, 0, 0.45)·r buried inside the hull at a length of 0.64·r.
		//
		// The floor is a fraction of the form's **own declared reach** now, which
		// is the only per-form scale there is. Every strobe in the pool sits
		// between 0.72 and 0.97 of it, and the buried case is 0.67 — so this
		// catches a fixture placed well inside the hull and, honestly, cannot see
		// one that is inside by a few metres. That class is caught by the island
		// check instead, which is why both exist.
		for (const type of TYPES) {
			const hasStrobes = STATION_VISUALS[type].activity.strobePeriodS > 0;
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY);
				root.updateMatrixWorld(true);
				for (const kind of ["strobe-a", "strobe-b"]) {
					const lamp = root.getObjectByName(kind);
					// Asserted either way, so a role that quietly lost its strobes
					// reports it rather than skipping the loop and passing.
					expect([type, form.id, kind, Boolean(lamp)]).toEqual([
						type,
						form.id,
						kind,
						hasStrobes,
					]);
					if (!lamp) continue;
					const p = (lamp as THREE.Object3D).position;
					expect([type, form.id, p.length() > form.reachKm * 0.68]).toEqual([
						type,
						form.id,
						true,
					]);
					expect(p.length()).toBeLessThanOrEqual(form.reachKm);
				}
			}
		}
	});
});

describe("detail is chosen by apparent size, with the render layer's hysteresis", () => {
	test("the bands are the spec's, measured in the station's own radii", () => {
		expect(stationDetailLevel(undefined, 1)).toBe("full");
		expect(stationDetailLevel(undefined, DETAIL_RADII.full - 1)).toBe("full");
		// The edges themselves, which the spec's table states as `≤`. Asserted
		// either side only, an off-by-one in the comparison would leave the
		// documented boundary unverified while everything else stayed green.
		expect(stationDetailLevel(undefined, DETAIL_RADII.full)).toBe("full");
		expect(stationDetailLevel(undefined, DETAIL_RADII.reduced)).toBe("reduced");
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
		// `HANDOFF_KM` imported, not restated: retuned downward, a literal 1e4
		// here would keep asserting the old range and this invariant would stop
		// being checked while staying green.
		expect(stationDetailLevel("full", HANDOFF_KM / largest)).toBe("outline");
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
		// §4's whole claim. Identical maps would pass every other assertion
		// here and deliver no surface language at all.
		const seen = new Set(
			TYPES.map((t) => Buffer.from(platingTexels(t)).toString("base64")),
		);
		expect(seen.size).toBe(TYPES.length);
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
				expect(strobeIntensity(type, t, 0)).toBe(strobeIntensity(type, t, 0));
				expect(flickerIntensity(type, t)).toBe(flickerIntensity(type, t));
			}
		}
	});

	test("every intensity stays inside [0, 1]", () => {
		// These land on `emissiveIntensity` multiplied by a per-fixture ceiling.
		// An unbounded return there is a fixture that blows out the bloom pass.
		for (const type of TYPES) {
			for (let t = 0; t < 40; t += 0.013) {
				const strobe = strobeIntensity(type, t, 0);
				const flicker = flickerIntensity(type, t);
				expect(strobe).toBeGreaterThanOrEqual(0);
				expect(strobe).toBeLessThanOrEqual(1);
				expect(flicker).toBeGreaterThanOrEqual(0);
				expect(flicker).toBeLessThanOrEqual(1);
			}
		}
	});

	test("the trade strobe flashes at the declared duty cycle", () => {
		const { strobePeriodS, strobeDuty } = STATION_VISUALS.trade.activity;
		const step = strobePeriodS / 2000;
		let lit = 0;
		let n = 0;
		for (let t = 0; t < strobePeriodS * 3; t += step) {
			if (strobeIntensity("trade", t, 0) > 0.5) lit++;
			n++;
		}
		// Within a tenth either way. The ramp at each end of the flash costs a
		// little — measured, the lit fraction is about 0.92 of the duty — so the
		// exact fraction would be asserting the ramp's shape. A looser upper
		// bound would let the duty cycle grow by half before this noticed, which
		// is the failure a duty-cycle test exists to catch.
		expect(lit / n).toBeGreaterThan(strobeDuty * 0.9);
		expect(lit / n).toBeLessThan(strobeDuty * 1.1);
	});

	test("the two strobes are out of phase", () => {
		// One offset argument, and this is what it is for: two lights flashing
		// together read as one light, and it is the alternation — sweeping round
		// with the spinning hull — that shows the station turns and how fast.
		const { strobePeriodS } = STATION_VISUALS.trade.activity;
		let differed = false;
		for (let t = 0; t < strobePeriodS; t += strobePeriodS / 400) {
			if (
				Math.abs(
					strobeIntensity("trade", t, 0) -
						strobeIntensity("trade", t, strobePeriodS / 2),
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

describe("what the renderer drives, at every range", () => {
	test("the refinery's flare keeps tracking the clock at outline range", () => {
		// The blocker sage's HonestOracle lens caught. The update skipped the
		// waveforms once a station reached `outline`, on the reasoning that
		// nothing clock-driven is drawn out there — but the flare is deliberately
		// *untagged* — it was a flame then, and its tip was the refinery's
		// outermost vertex, so hiding it would have changed the outline. It stayed
		// on screen with a frozen intensity: a distant refinery's flare depended
		// on how close that client had been, which is precisely what §5.2
		// promises it does not. The flare is a lit throat now and is tagged like
		// any other accessory, so this asserts the general rule — every fixture is
		// driven at every level — rather than the one case that forced it.
		const mesh = buildStationMesh("refinery", GREY);
		const flare = () =>
			mesh.fixtures.find((f) => f.kind === "flare")?.material
				.emissiveIntensity ?? Number.NaN;
		const farKm = STATION_SILHOUETTE_KM.refinery * DETAIL_RADII.reduced * 4;
		updateStationVisuals(mesh, 11.3, farKm);
		expect(mesh.detail).toBe("outline");
		const a = flare();
		updateStationVisuals(mesh, 11.9, farKm);
		const b = flare();
		updateStationVisuals(mesh, 11.3, farKm);
		// Moving, and a pure function of the clock rather than of the approach —
		// the same clock value gives the same light however it was reached.
		expect(a).not.toBe(b);
		expect(flare()).toBe(a);
	});

	test("a fixture's intensity is its base times its own waveform", () => {
		// The wiring between the two modules, which neither one can assert alone:
		// a fixture driven by the wrong waveform is a light that animates and is
		// still wrong, and nothing about the shape of the frame says so.
		const mesh = buildStationMesh("trade", GREY);
		const closeKm = STATION_SILHOUETTE_KM.trade;
		for (const t of [0.03, 1.1, 7.42]) {
			updateStationVisuals(mesh, t, closeKm);
			const first = mesh.fixtures.find((f) => f.kind === "strobe-a");
			const second = mesh.fixtures.find((f) => f.kind === "strobe-b");
			const { strobePeriodS } = STATION_VISUALS.trade.activity;
			expect(first?.material.emissiveIntensity).toBeCloseTo(
				(first?.base ?? 0) * strobeIntensity("trade", t, 0),
				9,
			);
			expect(second?.material.emissiveIntensity).toBeCloseTo(
				(second?.base ?? 0) * strobeIntensity("trade", t, strobePeriodS / 2),
				9,
			);
		}
	});
});
