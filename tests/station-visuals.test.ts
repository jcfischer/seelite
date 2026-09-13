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
	SELECTED_FORM,
	STATION_FORMS,
	STATION_SILHOUETTE_KM,
	type StationFormId,
	buildStationForm,
	buildStationMesh,
	setStationDetail,
	updateStationVisuals,
} from "../src/station-mesh";
import {
	DETAIL_RADII,
	SPEC_FIXTURE_NAMES,
	beaconIntensity,
	STATION_VISUALS,
	type StationDetailLevel,
	strobeIntensity,
	flickerIntensity,
	platingTexels,
	stationDetailLevel,
	stationMapSize,
	surfaceTexels,
} from "../src/station-visuals";
import { PLATE_TEXTURE_SIZE } from "../src/surface";
import { HANDOFF_HYSTERESIS, HANDOFF_KM } from "../src/units";
import { instanceBoxes } from "./helpers/instance-boxes";
import { PLAN_SEEDS, isSolvedForm } from "./helpers/solved-forms";
import { reachKm } from "./helpers/station-reach";

// From `station.ts`, not a literal: a fourth station type must reach every
// loop in this file, and a hand-written list is exactly the place it would not.
const TYPES: StationType[] = STATION_TYPES;
const LEVELS: StationDetailLevel[] = ["full", "reduced", "outline"];
const GREY = 0x9aa6b2;

describe("a detail level may not change the outline", () => {
	test("reach is identical at every level", () => {
		for (const type of TYPES) {
			const built = buildStationMesh(type, GREY, 0, 0);
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
			const built = buildStationMesh(type, GREY, 0, 0);
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
			const built = buildStationMesh(type, GREY, 0, 0);
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
			const built = buildStationMesh(type, GREY, 0, 0);
			for (const level of LEVELS) {
				setStationDetail(built, level);
				for (const name of ["core", "aperture", "station-interior"]) {
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
		// The floor is a fraction of the reach of **the member the lamp is bolted
		// to**, which is not the same thing as the form's declared reach and was
		// until #300. That reach is the *frame's* on a form whose frame is most
		// of it: the Gantry declares 1.66 km of boom and its drum is 0.47 km
		// across, so a strobe correctly mounted on the spinning member sits at
		// 0.26 of the declared figure and read as buried. §5 asks the pair to
		// mark the member that turns, so the member that turns is the scale.
		//
		// Every strobe in the pool sits between 0.72 and 0.97 of its own
		// member's reach and the buried case is 0.67 — so this catches a fixture
		// placed well inside and, honestly, cannot see one that is inside by a
		// few metres. That class is caught by the island check and by §5's axis
		// row below, which is why all three exist.
		/** How far the subtree a lamp hangs from reaches, ignoring the lamps —
		 *  a lamp that reached further than its own member would otherwise raise
		 *  the floor it is being measured against. */
		const memberReachKm = (member: THREE.Object3D) => {
			let reach = 0;
			const at = new THREE.Vector3();
			member.updateMatrixWorld(true);
			// **In the member's own frame**, which is the frame a lamp's
			// `position` is already in. A station mesh is authored in kilometres
			// and then divided by its core radius on an inner group, so world
			// space here is normalised radii and comparing the two would be
			// comparing a kilometre against a radius.
			const toMember = member.matrixWorld.clone().invert();
			const corner = new THREE.Vector3();
			member.traverse((child) => {
				if (child.name === "strobe-a" || child.name === "strobe-b") return;
				const mesh = child as THREE.Mesh;
				// **An instanced pool is read through its instances**, which is
				// the whole of `instanceBoxes`' reason for existing: the base
				// geometry of a greeble pool is a unit box at the origin, and
				// walking its `position` attribute reports every pool on every
				// form at √3/2 — larger than three of the four trade hulls, and
				// a floor derived from it fails a correctly mounted lamp.
				if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
					for (const box of instanceBoxes(mesh as THREE.InstancedMesh))
						for (const x of [box.min.x, box.max.x])
							for (const y of [box.min.y, box.max.y])
								for (const z of [box.min.z, box.max.z])
									reach = Math.max(
										reach,
										corner.set(x, y, z).applyMatrix4(toMember).length(),
									);
					return;
				}
				const position = mesh.geometry?.getAttribute("position");
				if (!position) return;
				for (let i = 0; i < position.count; i++)
					reach = Math.max(
						reach,
						at
							.fromBufferAttribute(position, i)
							.applyMatrix4(mesh.matrixWorld)
							.applyMatrix4(toMember)
							.length(),
					);
			});
			return reach;
		};
		for (const type of TYPES) {
			const hasStrobes = STATION_VISUALS[type].activity.strobePeriodS > 0;
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0, 0);
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
					// The member is the lamp's grandparent: `strobePair` returns a
					// group of its own, which is what a form adds.
					const member = lamp.parent?.parent ?? root;
					const memberKm = memberReachKm(member);
					expect([
						type,
						form.id,
						memberKm > 0 && p.length() > memberKm * 0.68,
					]).toEqual([type, form.id, true]);
					expect(p.length()).toBeLessThanOrEqual(form.reachKm);
				}
			}
		}
	});

	/**
	 * **The strobe pair marks rotation, so it has to turn** (§5, #274). The
	 * Gantry's pair sat on its static keel until #300; the review found the
	 * Hangar, the Slipway and the Assembly with the same fault, because only the
	 * selected form had been moved. A form that names no spinner turns whole,
	 * and its spinner is its body.
	 */
	test("every form's strobe pair turns with the member that spins", () => {
		for (const type of TYPES) {
			if (!(STATION_VISUALS[type].activity.strobePeriodS > 0)) continue;
			for (const form of STATION_FORMS[type]) {
				const { root, spinner } = buildStationForm(type, form.id, GREY, 0, 0);
				for (const kind of ["strobe-a", "strobe-b"]) {
					let turns = false;
					root.getObjectByName(kind)?.traverseAncestors((a) => {
						if (a === spinner) turns = true;
					});
					expect([type, form.id, kind, turns]).toEqual([
						type,
						form.id,
						kind,
						true,
					]);
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
		// The map side is the finish's (`worn` doubles it), so the size is
		// read off the finish in force rather than off the base constant.
		const n = stationMapSize() * stationMapSize() * 4;
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
		const mesh = buildStationMesh("refinery", GREY, 0, 0);
		const flare = () =>
			mesh.fixtures.find((f) => f.kind === "flare")?.material
				.emissiveIntensity ?? Number.NaN;
		const farKm = STATION_SILHOUETTE_KM.refinery * DETAIL_RADII.reduced * 4;
		updateStationVisuals(mesh, 11.3, farKm, "high");
		expect(mesh.detail).toBe("outline");
		const a = flare();
		updateStationVisuals(mesh, 11.9, farKm, "high");
		const b = flare();
		updateStationVisuals(mesh, 11.3, farKm, "high");
		// Moving, and a pure function of the clock rather than of the approach —
		// the same clock value gives the same light however it was reached.
		expect(a).not.toBe(b);
		expect(flare()).toBe(a);
	});

	test("a fixture's intensity is its base times its own waveform", () => {
		// The wiring between the two modules, which neither one can assert alone:
		// a fixture driven by the wrong waveform is a light that animates and is
		// still wrong, and nothing about the shape of the frame says so.
		const mesh = buildStationMesh("trade", GREY, 0, 0);
		const closeKm = STATION_SILHOUETTE_KM.trade;
		for (const t of [0.03, 1.1, 7.42]) {
			updateStationVisuals(mesh, t, closeKm, "high");
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

/**
 * §5's placement rule, headless: **no fixture §5 names is wholly hidden from
 * the aperture axis** (#300).
 *
 * `probe-station-visuals.mjs` owns the pixel form of this and is the instrument
 * #274's figures come from. This is the geometric form, and the division
 * between them is exact rather than a duplication. **This row answers only
 * whether *any* of a fixture's own surface can be reached down the axis.** It
 * cannot answer how much, and the attempt to make it — a fraction of reachable
 * surface samples — was flown and does not work: a weld arc buried in the boom
 * it is bolted to scored 0.67 of its front-facing vertices while measuring
 * **0 px**, against a heat ring at 0.53 measuring 526. Eleven metres of a 60 m
 * sphere stood proud of the member, and its vertices do not know that the
 * silhouette they add up to is a sliver. Visible *area* is a pixel question and
 * the probe is where it is answered.
 *
 * What this still buys is the class the probe cannot watch: the probes do not
 * run in CI (#14), and every fixture #274 found was **wholly** occluded rather
 * than thin — the trade station's grid and both its strobes, the refinery's
 * ports. This row is red on all of those and runs on every push.
 *
 * **The samples are the fixture's own front-facing surface**, not its bounding
 * box. A box's corners measure how deeply a fixture is *sunk* rather than
 * whether it shows: a half-sunk lamp reads 4 of 9 corners and a lit pane lying
 * on a deck reads 1 of 9, and both are plainly visible.
 *
 * **A ray cast from outside is legitimate where one cast from inside is not.**
 * `CLAUDE.md`'s warning — a hull mesh is `FrontSide`, so a ray from inside
 * passes straight through — is about the interior checks. Coming the other way,
 * down the axis from the docking approach, the first surface a ray meets is a
 * front face and the cull does not apply.
 *
 * **Every phase, not one.** The trade station and the shipyard turn, so a
 * fixture on a spinning member is somewhere different every frame; #274's whole
 * argument for the +Z diamond is that a lamp there is visible at *every* phase
 * where a rim lamp is occluded at every phase. A row built at rotation zero
 * would be checking one of them.
 */
describe("§5 — no fixture is wholly hidden from the aperture axis", () => {
	/** The probe's `CLOSE_RADII`: docking range, in the station's own radii. */
	const CLOSE_RADII = 3;
	/** Eighths of a turn. A fixture visible at all of them is visible at any. */
	const PHASES = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4);
	/** How many surface points a fixture is sampled at. Enough that a sliver of
	 *  a lamp is represented and few enough that eight phases of three forms
	 *  stay under a second. */
	const SAMPLE_CAP = 48;

	/**
	 * Points on a fixture's own surface that face the eye, in world space.
	 *
	 * Instanced runs are expanded through their instance matrices: the window
	 * grid is one `InstancedMesh` whose base geometry is a single pane at the
	 * origin, and sampling that would ask about a pane the station does not
	 * have.
	 */
	const facingPoints = (object: THREE.Object3D, eye: THREE.Vector3) => {
		const found: { at: THREE.Vector3; out: THREE.Vector3 }[] = [];
		const normalMatrix = new THREE.Matrix3();
		const world = new THREE.Matrix4();
		const instance = new THREE.Matrix4();
		object.traverse((child) => {
			// A light pool lies on the surface round its lamp and reaches past
			// it: sampling it would let a hidden lamp read as reachable (#300).
			if (child.userData.pool) return;
			const mesh = child as THREE.Mesh;
			const positions = mesh.geometry?.getAttribute("position");
			const normals = mesh.geometry?.getAttribute("normal");
			if (!positions || !normals) return;
			const pool = (mesh as THREE.InstancedMesh).isInstancedMesh
				? (mesh as THREE.InstancedMesh)
				: null;
			for (let k = 0; k < (pool ? pool.count : 1); k++) {
				if (pool) {
					pool.getMatrixAt(k, instance);
					world.multiplyMatrices(mesh.matrixWorld, instance);
				} else world.copy(mesh.matrixWorld);
				normalMatrix.getNormalMatrix(world);
				for (let i = 0; i < positions.count; i++)
					found.push({
						at: new THREE.Vector3()
							.fromBufferAttribute(positions, i)
							.applyMatrix4(world),
						out: new THREE.Vector3()
							.fromBufferAttribute(normals, i)
							.applyMatrix3(normalMatrix)
							.normalize(),
					});
			}
		});
		const toEye = new THREE.Vector3();
		const front = found.filter(
			({ at, out }) => out.dot(toEye.copy(eye).sub(at).normalize()) > 0.05,
		);
		const stride = Math.max(1, Math.ceil(front.length / SAMPLE_CAP));
		const sampled: THREE.Vector3[] = [];
		for (let i = 0; i < front.length; i += stride) sampled.push(front[i].at);
		return sampled;
	};

	/** Whether anything that is not this fixture stands between the eye and any
	 *  point of its own surface that faces the eye. */
	const readsFromAxis = (
		root: THREE.Object3D,
		fixture: THREE.Object3D,
		eye: THREE.Vector3,
	) => {
		const raycaster = new THREE.Raycaster();
		const own = new Set<THREE.Object3D>();
		fixture.traverse((child) => own.add(child));
		for (const point of facingPoints(fixture, eye)) {
			const toPoint = point.clone().sub(eye);
			const range = toPoint.length();
			if (range === 0) continue;
			raycaster.set(eye, toPoint.divideScalar(range));
			// Just short of the point itself, so the fixture's own far side
			// cannot be counted as a blocker of its near side.
			raycaster.far = range * 0.9999;
			const blocked = raycaster
				.intersectObject(root, true)
				.some((hit) => !own.has(hit.object));
			if (!blocked) return true;
		}
		return false;
	};

	/** Fixtures of one role that no ray down the axis can reach, at any phase. */
	const hiddenFixtures = (
		station: StationType,
		names: readonly string[],
		{
			move,
			formId = SELECTED_FORM[station],
			assemblySeed = 0,
		}: {
			move?: (root: THREE.Object3D) => void;
			formId?: StationFormId;
			assemblySeed?: number;
		} = {},
	) => {
		const { root, spinner } = buildStationForm(
			station,
			formId,
			GREY,
			0,
			assemblySeed,
		);
		move?.(root);
		// The aperture is on +Z (`station-mesh.test.ts` asserts it), so the eye
		// stands out along +Z at the range the probe frames from — **in core
		// radii**, because that is what the built tree is in (`normalise`). In
		// kilometres it put each role at its own unstated range: the trade
		// station at 1.8 silhouette radii, the refinery at 1.2.
		const eye = new THREE.Vector3(
			0,
			0,
			(STATION_SILHOUETTE_KM[station] * CLOSE_RADII) /
				STATION_GEOMETRY[station].coreRadiusKm,
		);
		const dead: string[] = [];
		for (const phase of spinner ? PHASES : [0]) {
			if (spinner) spinner.rotation.z = phase;
			root.updateMatrixWorld(true);
			for (const name of names) {
				const objects: THREE.Object3D[] = [];
				root.traverse((child) => {
					if (child.name === name) objects.push(child);
				});
				// A name with no object is a failure, not a skip: a renamed
				// fixture must not read as a passing role.
				if (objects.length === 0) {
					dead.push(`${name} (no object of that name)`);
					continue;
				}
				if (!objects.some((o) => readsFromAxis(root, o, eye)))
					dead.push(`${name} @ ${((phase * 180) / Math.PI).toFixed(0)}°`);
			}
		}
		return dead;
	};

	for (const type of TYPES) {
		const names = SPEC_FIXTURE_NAMES[type];
		if (!names) continue;
		test(`the ${type}'s fixtures are all reachable down its own axis, on every plan`, () => {
			// A solved form is a family of plans (#257), and the check on one
			// seed is a check on one plan.
			const seeds = isSolvedForm(type, SELECTED_FORM[type]) ? PLAN_SEEDS : [0];
			for (const assemblySeed of seeds)
				expect([
					type,
					assemblySeed,
					hiddenFixtures(type, names, { assemblySeed }),
				]).toEqual([type, assemblySeed, []]);
		});
	}

	/**
	 * **§5's rule is written against the member that spins, so it holds on
	 * every form, not only the selected one.** The row above builds the forms
	 * the game ships; a re-ranking would ship a form nothing had checked, which
	 * is how the Hangar, the Slipway and the Assembly kept their strobes on
	 * structure that does not turn (#300's review).
	 */
	test("every form's strobe pair is reachable down its own axis", () => {
		for (const type of TYPES) {
			if (!(STATION_VISUALS[type].activity.strobePeriodS > 0)) continue;
			for (const form of STATION_FORMS[type])
				expect([
					type,
					form.id,
					hiddenFixtures(type, ["strobe-a", "strobe-b"], { formId: form.id }),
				]).toEqual([type, form.id, []]);
		}
	});

	/**
	 * **The control, because the row above is the whole of #300's CI cover.**
	 *
	 * Moving the trade station's strobes back where #274 found them — flat
	 * against two opposite equatorial faces — has to make it red, and this is
	 * the exact geometry it found: the sightline from three silhouette radii to
	 * a lamp at `(±face·1.02, 0, face·0.5)` crosses the +Z face plane at
	 * 0.90·face, inside the diamond, so the docking face occludes its own hull
	 * lights at every phase. Without this the row could be asserting a
	 * reachability nothing is ever going to block.
	 */
	test("the axis row goes red when a strobe is put back on the equator", () => {
		const face = STATION_GEOMETRY.trade.coreRadiusKm * 0.95 * Math.SQRT1_2;
		const hidden = hiddenFixtures("trade", ["strobe-a", "strobe-b"], {
			move: (root) => {
				for (const [kind, side] of [
					["strobe-a", -1],
					["strobe-b", 1],
				] as const)
					root
						.getObjectByName(kind)
						?.position.set(side * face * 1.02, 0, face * 0.5);
			},
		});
		expect(hidden.length).toBeGreaterThan(0);
	});
});

/**
 * #300's second sheet: a ring of strobes that runs round a slot's mouth, and a
 * hazard beacon on the plant that does not spin.
 */
describe("the mouth chase and the refinery's beacons", () => {
	test("every slot role rings its mouth with lamps an equal step of the period apart", () => {
		for (const type of ["trade", "shipyard"] as const) {
			const mesh = buildStationMesh(type, GREY, 0, 0);
			const chase = mesh.fixtures.filter((f) => f.kind === "chase");
			const { strobePeriodS } = STATION_VISUALS[type].activity;
			// Enough that the flash reads as running round, not as a few blinks.
			expect([type, chase.length >= 8]).toEqual([type, true]);
			const offsets = chase.map((f) => f.offsetS).sort((a, b) => a - b);
			offsets.forEach((offset, i) =>
				expect(offset).toBeCloseTo((i / chase.length) * strobePeriodS, 9),
			);
		}
	});

	test("the chase runs: at any lit moment one lamp leads and they are not in unison", () => {
		const mesh = buildStationMesh("trade", GREY, 0, 0);
		let sawOne = false;
		for (let i = 0; i < 80; i++) {
			updateStationVisuals(mesh, i * 0.025, 1, "high");
			const lit = mesh.fixtures.filter(
				(f) => f.kind === "chase" && f.material.emissiveIntensity > 0,
			).length;
			// Never the whole ring at once — that would be a flash, not a chase.
			expect(lit).toBeLessThan(
				mesh.fixtures.filter((f) => f.kind === "chase").length,
			);
			if (lit >= 1) sawOne = true;
		}
		expect(sawOne).toBe(true);
	});

	test("a pad role gets no ring, because a pad has no frame round a hole", () => {
		for (const type of ["refinery", "outpost"] as const)
			expect([
				type,
				buildStationMesh(type, GREY, 0, 0).fixtures.filter(
					(f) => f.kind === "chase",
				).length,
			]).toEqual([type, 0]);
	});

	test("the beacon blinks for its duty and is dark on a role that declares none", () => {
		const { beaconPeriodS, beaconDuty } = STATION_VISUALS.refinery.activity;
		expect(beaconPeriodS).toBeGreaterThan(0);
		let lit = 0;
		const samples = 2000;
		for (let i = 0; i < samples; i++)
			if (beaconIntensity("refinery", (i / samples) * beaconPeriodS, 0) > 0)
				lit++;
		expect(lit / samples).toBeCloseTo(beaconDuty, 2);
		for (const type of ["trade", "shipyard", "outpost"] as const)
			expect([type, beaconIntensity(type, 0.1, 0)]).toEqual([type, 0]);
	});

	test("every refinery plan carries a beacon on its headframe and one on its flare stack", () => {
		for (const seed of [0, 1, 2, 3, 4, 5]) {
			const { root } = buildStationForm(
				"refinery",
				SELECTED_FORM.refinery,
				GREY,
				0,
				seed,
			);
			let beacons = 0;
			root.traverse((o) => {
				if (o.name === "obstruction-beacon" && !o.userData.glow) beacons++;
			});
			expect([seed, beacons >= 2]).toEqual([seed, true]);
		}
	});
});
