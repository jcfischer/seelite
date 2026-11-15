import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
	formsInPlay,
} from "../src/station";
import {
	STATION_FORMS,
	type StationFormId,
	buildStationForm,
	stationSilhouetteKm,
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
import { FORMS_IN_PLAY, formLabel } from "./helpers/forms-in-play";
import { HANDOFF_HYSTERESIS, HANDOFF_KM } from "../src/units";
import { instanceBoxes } from "./helpers/instance-boxes";
import { PLAN_SEEDS, isSolvedForm } from "./helpers/solved-forms";
import { reachKm } from "./helpers/station-reach";

const TYPES: StationType[] = STATION_TYPES;
const LEVELS: StationDetailLevel[] = ["full", "reduced", "outline"];
const GREY = 0x9aa6b2;

describe("a detail level may not change the outline", () => {
	test("reach is identical at every level", () => {
		for (const [type, formId] of FORMS_IN_PLAY) {
			const built = buildStationForm(type, formId, GREY, 0, 0);
			const measured = LEVELS.map((level) => {
				setStationDetail(built, level);
				return reachKm(built.root, type);
			});
			expect([type, measured[1]]).toEqual([type, measured[0]]);
			expect([type, measured[2]]).toEqual([type, measured[0]]);
		}
	});

	test("the budget still holds with the pass applied", () => {
		for (const [type, formId] of FORMS_IN_PLAY) {
			const built = buildStationForm(type, formId, GREY, 0, 0);
			for (const level of LEVELS) {
				setStationDetail(built, level);
				expect(reachKm(built.root, type)).toBeLessThanOrEqual(
					stationSilhouetteKm(type, formId) * (1 + 1e-6),
				);
			}
		}
	});

	test("the accessories really do switch off, so the levels are not all one level", () => {
		for (const [type, formId] of FORMS_IN_PLAY) {
			const built = buildStationForm(type, formId, GREY, 0, 0);
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
		for (const [type, formId] of FORMS_IN_PLAY) {
			const built = buildStationForm(type, formId, GREY, 0, 0);
			for (const level of LEVELS) {
				setStationDetail(built, level);
				for (const name of ["core", "aperture", "station-interior"]) {
					const part = built.root.getObjectByName(name);
					expect(part).toBeDefined();
					let selfOrAncestor: THREE.Object3D | null = part as THREE.Object3D;
					while (selfOrAncestor) {
						expect(selfOrAncestor.visible).toBe(true);
						selfOrAncestor = selfOrAncestor.parent;
					}
				}
			}
		}
	});
});

describe("a fixture is on the station it is mounted on", () => {
	test("both strobes sit out on the hull, on every form that has them", () => {
		const isLamp = (o: THREE.Object3D) =>
			o.name === "strobe-a" || o.name === "strobe-b";
		const memberReachWithoutLampsKm = (member: THREE.Object3D) => {
			let reach = 0;
			const at = new THREE.Vector3();
			member.updateMatrixWorld(true);
			const worldToMemberFrame = member.matrixWorld.clone().invert();
			const corner = new THREE.Vector3();
			member.traverse((child) => {
				if (isLamp(child)) return;
				const mesh = child as THREE.Mesh;
				if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
					for (const box of instanceBoxes(mesh as THREE.InstancedMesh))
						for (const x of [box.min.x, box.max.x])
							for (const y of [box.min.y, box.max.y])
								for (const z of [box.min.z, box.max.z])
									reach = Math.max(
										reach,
										corner
											.set(x, y, z)
											.applyMatrix4(worldToMemberFrame)
											.length(),
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
							.applyMatrix4(worldToMemberFrame)
							.length(),
					);
			});
			return reach;
		};
		const floorJustAboveBuriedLampShare = 0.68;
		for (const type of TYPES) {
			const hasStrobes = STATION_VISUALS[type].activity.strobePeriodS > 0;
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY, 0, 0);
				root.updateMatrixWorld(true);
				for (const kind of ["strobe-a", "strobe-b"]) {
					const lamp = root.getObjectByName(kind);
					expect([type, form.id, kind, Boolean(lamp)]).toEqual([
						type,
						form.id,
						kind,
						hasStrobes,
					]);
					if (!lamp) continue;
					const p = (lamp as THREE.Object3D).position;
					const strobePairGroup = lamp.parent;
					const member = strobePairGroup?.parent ?? root;
					const memberKm = memberReachWithoutLampsKm(member);
					expect([
						type,
						form.id,
						memberKm > 0 &&
							p.length() > memberKm * floorJustAboveBuriedLampShare,
					]).toEqual([type, form.id, true]);
					expect(p.length()).toBeLessThanOrEqual(form.reachKm);
				}
			}
		}
	});

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
		const justOver = DETAIL_RADII.full * 1.02;
		expect(stationDetailLevel("full", justOver)).toBe("full");
		expect(stationDetailLevel("reduced", justOver)).toBe("reduced");
		const wellOver = DETAIL_RADII.full * HANDOFF_HYSTERESIS * 1.01;
		expect(stationDetailLevel("full", wellOver)).toBe("reduced");
	});

	test("the hysteresis is the renderer's, not a second copy", () => {
		const edge = DETAIL_RADII.reduced * HANDOFF_HYSTERESIS;
		expect(stationDetailLevel("reduced", edge * 0.999)).toBe("reduced");
		expect(stationDetailLevel("reduced", edge * 1.001)).toBe("outline");
	});

	test("a far-layer station is always outline", () => {
		const largestSilhouetteKm = Math.max(
			...FORMS_IN_PLAY.map(([type, formId]) =>
				stationSilhouetteKm(type, formId),
			),
		);
		const fewestRadiiAtHandoff = HANDOFF_KM / largestSilhouetteKm;
		expect(stationDetailLevel("full", fewestRadiiAtHandoff)).toBe("outline");
	});
});

describe("the plating is generated, not downloaded, and sized for RGBAFormat", () => {
	test("every buffer is exactly 4 x w x h", () => {
		const rgbaBytesPerMap = stationMapSize() * stationMapSize() * 4;
		for (const type of TYPES) {
			expect(platingTexels(type).length).toBe(rgbaBytesPerMap);
			expect(surfaceTexels(type).length).toBe(rgbaBytesPerMap);
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
		const seen = new Set(
			TYPES.map((t) => Buffer.from(platingTexels(t)).toString("base64")),
		);
		expect(seen.size).toBe(TYPES.length);
	});

	test("the albedo is greyscale, so the type colour still multiplies through", () => {
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
			expect(green.size).toBeGreaterThan(4);
		}
	});
});

describe("activity is a pure function of the game clock", () => {
	test("the same clock gives the same light", () => {
		for (const type of TYPES) {
			for (const t of [0, 1.7, 93.25, 3600.5]) {
				expect(strobeIntensity(type, t, 0)).toBe(strobeIntensity(type, t, 0));
				expect(flickerIntensity(type, t)).toBe(flickerIntensity(type, t));
			}
		}
	});

	test("every intensity stays inside [0, 1]", () => {
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
		const rampSlackEitherWay = 0.1;
		expect(lit / n).toBeGreaterThan(strobeDuty * (1 - rampSlackEitherWay));
		expect(lit / n).toBeLessThan(strobeDuty * (1 + rampSlackEitherWay));
	});

	test("the two strobes are out of phase", () => {
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
		const mesh = buildStationForm("refinery", "d", GREY, 0, 0);
		const flare = () =>
			mesh.fixtures.find((f) => f.kind === "flare")?.material
				.emissiveIntensity ?? Number.NaN;
		const farKm = mesh.silhouetteKm * DETAIL_RADII.reduced * 4;
		updateStationVisuals(mesh, 11.3, farKm, "high");
		expect(mesh.detail).toBe("outline");
		const a = flare();
		updateStationVisuals(mesh, 11.9, farKm, "high");
		const b = flare();
		updateStationVisuals(mesh, 11.3, farKm, "high");
		expect(a).not.toBe(b);
		expect(flare()).toBe(a);
	});

	test("a fixture's intensity is its base times its own waveform", () => {
		const mesh = buildStationForm("trade", "a", GREY, 0, 0);
		const closeKm = mesh.silhouetteKm;
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

describe("§5 — no fixture is wholly hidden from the aperture axis", () => {
	const PROBE_CLOSE_RADII = 3;
	const EIGHTH_TURN_PHASES = [0, 1, 2, 3, 4, 5, 6, 7].map(
		(i) => (i * Math.PI) / 4,
	);
	const FACING_SAMPLES_PER_FIXTURE = 48;

	const facingSurfacePoints = (object: THREE.Object3D, eye: THREE.Vector3) => {
		const found: { at: THREE.Vector3; out: THREE.Vector3 }[] = [];
		const normalMatrix = new THREE.Matrix3();
		const world = new THREE.Matrix4();
		const instance = new THREE.Matrix4();
		object.traverse((child) => {
			const lightPoolReachesPastItsLamp = child.userData.pool;
			if (lightPoolReachesPastItsLamp) return;
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
		const stride = Math.max(
			1,
			Math.ceil(front.length / FACING_SAMPLES_PER_FIXTURE),
		);
		const sampled: THREE.Vector3[] = [];
		for (let i = 0; i < front.length; i += stride) sampled.push(front[i].at);
		return sampled;
	};

	const readsFromAxis = (
		root: THREE.Object3D,
		fixture: THREE.Object3D,
		eye: THREE.Vector3,
	) => {
		const raycaster = new THREE.Raycaster();
		const own = new Set<THREE.Object3D>();
		fixture.traverse((child) => own.add(child));
		for (const point of facingSurfacePoints(fixture, eye)) {
			const toPoint = point.clone().sub(eye);
			const range = toPoint.length();
			if (range === 0) continue;
			raycaster.set(eye, toPoint.divideScalar(range));
			const justShortOfThePoint = 0.9999;
			raycaster.far = range * justShortOfThePoint;
			const blocked = raycaster
				.intersectObject(root, true)
				.some((hit) => !own.has(hit.object));
			if (!blocked) return true;
		}
		return false;
	};

	const hiddenFixtures = (
		station: StationType,
		names: readonly string[],
		{
			move,
			formId,
			assemblySeed = 0,
		}: {
			move?: (root: THREE.Object3D) => void;
			formId: StationFormId;
			assemblySeed?: number;
		},
	) => {
		const { root, spinner } = buildStationForm(
			station,
			formId,
			GREY,
			0,
			assemblySeed,
		);
		move?.(root);
		const eyeRangeInCoreRadii =
			(stationSilhouetteKm(station, formId) * PROBE_CLOSE_RADII) /
			STATION_GEOMETRY[station].coreRadiusKm;
		const eyeOnApertureAxis = new THREE.Vector3(0, 0, eyeRangeInCoreRadii);
		const dead: string[] = [];
		for (const phase of spinner ? EIGHTH_TURN_PHASES : [0]) {
			if (spinner) spinner.rotation.z = phase;
			root.updateMatrixWorld(true);
			for (const name of names) {
				const objects: THREE.Object3D[] = [];
				root.traverse((child) => {
					if (child.name === name) objects.push(child);
				});
				if (objects.length === 0) {
					dead.push(`${name} (no object of that name)`);
					continue;
				}
				if (!objects.some((o) => readsFromAxis(root, o, eyeOnApertureAxis)))
					dead.push(`${name} @ ${((phase * 180) / Math.PI).toFixed(0)}°`);
			}
		}
		return dead;
	};

	for (const [type, formId] of FORMS_IN_PLAY) {
		const names = SPEC_FIXTURE_NAMES[type];
		if (!names) continue;
		test(`the ${type} ${formId}'s fixtures are all reachable down its own axis, on every plan`, () => {
			const seeds = isSolvedForm(type, formId) ? PLAN_SEEDS : [0];
			for (const assemblySeed of seeds)
				expect([
					type,
					assemblySeed,
					hiddenFixtures(type, names, { formId, assemblySeed }),
				]).toEqual([type, assemblySeed, []]);
		});
	}

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

	test("the axis row goes red when a strobe is put back on the equator", () => {
		const face = STATION_GEOMETRY.trade.coreRadiusKm * 0.95 * Math.SQRT1_2;
		const hidden = hiddenFixtures("trade", ["strobe-a", "strobe-b"], {
			formId: "a",
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

const SLOT_FORMS = FORMS_IN_PLAY.filter(
	([type]) => type === "trade" || type === "shipyard",
);

describe("the mouth chase and the refinery's beacons", () => {
	test("every slot role rings its mouth with lamps an equal step of the period apart", () => {
		const fewestLampsThatReadAsRunning = 8;
		for (const [type, formId] of SLOT_FORMS) {
			const mesh = buildStationForm(type, formId, GREY, 0, 0);
			const chase = mesh.fixtures.filter((f) => f.kind === "chase");
			const { strobePeriodS } = STATION_VISUALS[type].activity;
			const label = formLabel(type, formId);
			expect([label, chase.length >= fewestLampsThatReadAsRunning]).toEqual([
				label,
				true,
			]);
			const offsets = chase.map((f) => f.offsetS).sort((a, b) => a - b);
			offsets.forEach((offset, i) =>
				expect(offset).toBeCloseTo((i / chase.length) * strobePeriodS, 9),
			);
		}
	});

	test("the chase runs: at any lit moment one lamp leads and they are not in unison", () => {
		for (const [type, formId] of SLOT_FORMS) {
			const mesh = buildStationForm(type, formId, GREY, 0, 0);
			const ring = mesh.fixtures.filter((f) => f.kind === "chase").length;
			let sawOne = false;
			let unison = 0;
			for (let i = 0; i < 80; i++) {
				updateStationVisuals(mesh, i * 0.025, 1, "high");
				const lit = mesh.fixtures.filter(
					(f) => f.kind === "chase" && f.material.emissiveIntensity > 0,
				).length;
				if (lit >= ring) unison++;
				if (lit >= 1) sawOne = true;
			}
			const label = formLabel(type, formId);
			expect([label, unison, sawOne]).toEqual([label, 0, true]);
		}
	});

	test("a pad role gets no ring, because a pad has no frame round a hole", () => {
		for (const type of ["refinery", "outpost"] as const)
			for (const formId of formsInPlay(type))
				expect([
					type,
					formId,
					buildStationForm(type, formId, GREY, 0, 0).fixtures.filter(
						(f) => f.kind === "chase",
					).length,
				]).toEqual([type, formId, 0]);
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
			const { root } = buildStationForm("refinery", "d", GREY, 0, seed);
			let beacons = 0;
			root.traverse((o) => {
				if (o.name === "obstruction-beacon" && !o.userData.glow) beacons++;
			});
			expect([seed, beacons >= 2]).toEqual([seed, true]);
		}
	});
});
