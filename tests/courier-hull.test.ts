/**
 * Node #812: the authored O4 courier is the courier the game draws.
 *
 * The preload (`tests/setup-courier-hull.ts`) installs the shipped model, so
 * every other row reading the courier's mesh — its envelope (`hull.test.ts`),
 * its vent placement and shares (`vent-placement.test.ts`, `vents.test.ts`),
 * its collision box — already measures this hull. What is held here is what
 * only the integration owns: that the shipped file is the approved geometry,
 * how the study's frame is carried into the hull's, and the parts the game
 * needs that the study did not have.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { buildDerelictMesh } from "../src/derelict-mesh";
import { DETAIL_RADII } from "../src/detail-level";
import {
	AuthoredLevelMesh,
	LEVEL_REACHED_ERROR_KM,
	reducedLevel,
} from "../src/authored-levels";
import {
	COURIER_ALLOY_MATERIAL,
	COURIER_ALLOY_ROUGHNESS,
	COURIER_LENGTH_INSET_KM,
	COURIER_FRAME_NAME,
	COURIER_LEVEL_NAMES,
	FIXTURE_SCREEN_PREFIX,
	courierLevelErrorKm,
} from "../src/courier-hull";
import { HULL_SPECS } from "../src/hull";
import { EMISSIVE_CEILING } from "../src/light-rig";
import {
	HULL_REACH_KM,
	authoredCourierBuilder,
	buildShipMesh,
	installAuthoredCourier,
	isDriveBell,
	shipMuzzlesKm,
	updateShipVisuals,
} from "../src/ship-mesh";
import { isLevelStandIn } from "../src/ship-detail";
import {
	DEFAULT_HULL_FINISH,
	HULL_FINISH_IDS,
	setHullFinish,
} from "../src/ship-surface";
import { ventThroats } from "../src/vent-plumes";
import { meshStats } from "../scripts/lib/mesh-stats.mjs";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";

const courier = () => {
	const root = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
	root.updateMatrixWorld(true);
	return root;
};

/** The approved model's meshes and the glows: a reduced level is drawn,
 *  never measured, and its own rows are below. */
const meshesOf = (root: THREE.Object3D) => {
	const out: THREE.Mesh[] = [];
	root.traverse((o) => {
		if (o instanceof THREE.Mesh && !isLevelStandIn(o)) out.push(o);
	});
	return out;
};

const triangles = (object: THREE.Object3D) => meshStats([object]).triangles;

/** How many times `run` calls the raycaster's `method`. */
const countCalls = (
	method: "intersectObject" | "intersectObjects",
	run: () => void,
): number => {
	// Either method, so one loose type over the two signatures.
	const proto = THREE.Raycaster.prototype as unknown as Record<
		typeof method,
		(...args: unknown[]) => unknown
	>;
	const original = proto[method];
	let n = 0;
	proto[method] = function (this: THREE.Raycaster, ...args: unknown[]) {
		n++;
		return original.apply(this, args);
	};
	try {
		run();
	} finally {
		proto[method] = original;
	}
	return n;
};

afterEach(() => setHullFinish(DEFAULT_HULL_FINISH));

describe("the shipped file is the approved study", () => {
	test("shipped vertex attributes use KHR_mesh_quantization", () => {
		const file = readFileSync("src/models/courier-hull.glb");
		const json = JSON.parse(
			file.subarray(20, 20 + file.readUInt32LE(12)).toString(),
		);
		expect(json.extensionsUsed).toContain("KHR_mesh_quantization");
		expect(json.extensionsRequired).toContain("KHR_mesh_quantization");
		// The unquantised asset on this node's base commit.
		expect(file.byteLength).toBeLessThan(15_940_136);
		for (const mesh of json.meshes)
			for (const primitive of mesh.primitives) {
				expect(
					json.accessors[primitive.attributes.POSITION].componentType,
				).toBe(5126);
				expect(json.accessors[primitive.attributes.NORMAL].componentType).toBe(
					5122,
				);
			}
	});
	test("every triangle and position is exact; normals and UVs have bounded quantisation error", async () => {
		const study = await decodeShippedGlb(
			"spikes/courier-hull/courier-hull.glb",
		);
		const shipped = await decodeShippedGlb("src/models/courier-hull.glb");
		const shape = (scene: THREE.Object3D) =>
			meshesOf(scene)
				.map((m) => {
					const position = m.geometry.getAttribute("position");
					const normal = m.geometry.getAttribute("normal");
					const uv = m.geometry.getAttribute("uv");
					const index = m.geometry.getIndex();
					const triangles = [];
					const count = index ? index.count : position.count;
					for (let i = 0; i < count; i += 3) {
						const corners = [0, 1, 2].map((k) => {
							const v = index ? index.getX(i + k) : i + k;
							return {
								key: [
									position.getX(v),
									position.getY(v),
									position.getZ(v),
								].join(","),
								attributes: [
									normal.getX(v),
									normal.getY(v),
									normal.getZ(v),
									uv.getX(v),
									uv.getY(v),
								],
							};
						});
						// Rotate the first corner without reversing the winding.
						const first = corners.findIndex(
							(c) => c.key === corners.map((c) => c.key).sort()[0],
						);
						const ordered = [
							corners[first],
							corners[(first + 1) % 3],
							corners[(first + 2) % 3],
						];
						triangles.push({
							key: ordered.map((c) => c.key).join("|"),
							attributes: ordered.flatMap((c) => c.attributes),
						});
					}
					return {
						name: m.name,
						triangles: triangles.sort((a, b) => a.key.localeCompare(b.key)),
					};
				})
				.sort((a, b) => a.name.localeCompare(b.name));
		const a = shape(study);
		const b = shape(shipped);
		expect(b.map((m) => m.name)).toEqual(a.map((m) => m.name));
		expect(b.length).toBe(36);
		expect(b.reduce((n, m) => n + m.triangles.length, 0)).toBe(353_954);
		for (let i = 0; i < a.length; i++) {
			expect(b[i].triangles.map((t) => t.key)).toEqual(
				a[i].triangles.map((t) => t.key),
			);
			let normalError = 0;
			let uvError = 0;
			for (let j = 0; j < a[i].triangles.length; j++) {
				const expected = a[i].triangles[j].attributes;
				b[i].triangles[j].attributes.forEach((value, k) => {
					const error = Math.abs(value - expected[k]);
					if (k % 5 < 3) normalError = Math.max(normalError, error);
					else uvError = Math.max(uvError, error);
				});
			}
			// Signed 16-bit normals and unsigned 16-bit UVs: one interval,
			// allowing float32's original normalisation error as well.
			expect([a[i].name, normalError <= 1 / 32767 + 1e-6]).toEqual([
				a[i].name,
				true,
			]);
			expect([a[i].name, uvError <= 1 / 65535]).toEqual([a[i].name, true]);
		}
	}, 60_000);
});

describe("the study's frame carried into the hull's", () => {
	test("one uniform scale, so the approved silhouette is kept", () => {
		const frame = courier().getObjectByName(COURIER_FRAME_NAME);
		expect(frame).toBeDefined();
		const { x, y, z } = (frame as THREE.Object3D).scale;
		expect(y).toBe(x);
		expect(z).toBe(x);
	});

	test("the length is the roster's reference, and the scale is what holds it", () => {
		// Every hull's turn rate is solved against the courier's length
		// (`referenceHandling`), so the model fits the declared length rather
		// than the declaration following the model.
		expect(HULL_SPECS.courier.env.lengthKm).toBe(0.0575);
		const size = new THREE.Box3()
			.setFromObject(courier())
			.getSize(new THREE.Vector3());
		expect(size.z).toBeCloseTo(
			HULL_SPECS.courier.env.lengthKm - COURIER_LENGTH_INSET_KM,
			12,
		);
	});

	test("the box sits on envCentre: the collision box's frame is the old one", () => {
		const centre = new THREE.Box3()
			.setFromObject(courier())
			.getCenter(new THREE.Vector3());
		const c = HULL_SPECS.courier.envCentre;
		// Starboard +x, dorsal +y, forward −z.
		expect(centre.x).toBeCloseTo(c.rightKm, 12);
		expect(centre.y).toBeCloseTo(c.upKm, 12);
		expect(centre.z).toBeCloseTo(-c.foreKm, 12);
	});

	test("the nose is −z: the canopy is forward and above, the drives aft", () => {
		const root = courier();
		const canopy = new THREE.Box3()
			.setFromObject(root.getObjectByName("canopy-glass") as THREE.Object3D)
			.getCenter(new THREE.Vector3());
		const box = new THREE.Box3().setFromObject(root);
		const centre = box.getCenter(new THREE.Vector3());
		expect(canopy.z).toBeLessThan(centre.z);
		expect(canopy.y).toBeGreaterThan(centre.y);
		const bells = meshesOf(root).filter(isDriveBell);
		for (const bell of bells) {
			const at = new THREE.Box3()
				.setFromObject(bell)
				.getCenter(new THREE.Vector3());
			expect(at.z).toBeGreaterThan(centre.z + 0.4 * (box.max.z - centre.z));
		}
	});

	test("every vertex is inside the declared display reach", () => {
		let farthest = 0;
		const v = new THREE.Vector3();
		for (const mesh of meshesOf(courier())) {
			const position = mesh.geometry.getAttribute("position");
			for (let i = 0; i < position.count; i++)
				farthest = Math.max(
					farthest,
					v
						.fromBufferAttribute(position, i)
						.applyMatrix4(mesh.matrixWorld)
						.length(),
				);
		}
		expect(farthest).toBeLessThan(HULL_REACH_KM.courier);
	});

	test("no finish moves the envelope: a finish changes only the drive glow", () => {
		const boxes = HULL_FINISH_IDS.map((id) => {
			setHullFinish(id);
			return new THREE.Box3().setFromObject(courier());
		});
		for (const box of boxes) {
			expect(box.min.distanceTo(boxes[0].min)).toBeLessThan(1e-12);
			expect(box.max.distanceTo(boxes[0].max)).toBeLessThan(1e-12);
		}
	});
});

describe("what the game needs that the study did not carry", () => {
	test("two drive glows, one per nacelle, that the plumes and the throttle find", () => {
		for (const finish of HULL_FINISH_IDS) {
			setHullFinish(finish);
			const root = courier();
			const bells = meshesOf(root).filter(isDriveBell);
			expect([finish, bells.map((b) => b.name).sort()]).toEqual([
				finish,
				["courier-port-exhaust", "courier-starboard-exhaust"],
			]);
			const xs = bells.map(
				(b) =>
					new THREE.Box3().setFromObject(b).getCenter(new THREE.Vector3()).x,
			);
			// Port is the mesh's −x.
			const port = bells.findIndex((b) => b.name === "courier-port-exhaust");
			expect(xs[port]).toBeLessThan(0);
			expect(xs[1 - port]).toBeGreaterThan(0);
			const main = ventThroats(root, "courier").filter(
				(t) => t.family === "main",
			);
			expect(main.length).toBe(2);
			for (const drive of main) expect(drive.placed).toBe("bell");
		}
		// Each finish measures its throats once, about half a second on the
		// model, which a loaded machine stretches past bun's 5 s default.
	}, 60_000);

	test("a bowl glow's faces wind outward, so the back-sided finish draws its far wall", () => {
		setHullFinish(DEFAULT_HULL_FINISH);
		const bell = meshesOf(courier()).find(isDriveBell) as THREE.Mesh;
		expect((bell.material as THREE.Material).side).toBe(THREE.BackSide);
		const geometry = bell.geometry;
		const position = geometry.getAttribute("position");
		const index = geometry.getIndex() as THREE.BufferAttribute;
		const a = new THREE.Vector3();
		const b = new THREE.Vector3();
		const c = new THREE.Vector3();
		let inward = 0;
		let faces = 0;
		for (let f = 0; f < index.count; f += 3) {
			a.fromBufferAttribute(position, index.getX(f));
			b.fromBufferAttribute(position, index.getX(f + 1));
			c.fromBufferAttribute(position, index.getX(f + 2));
			const n = b.clone().sub(a).cross(c.clone().sub(a));
			if (n.length() < 1e-9) continue;
			// The geometry is built about its own z axis; the mesh's position
			// carries it onto its nacelle.
			const radial = new THREE.Vector3(
				(a.x + b.x + c.x) / 3,
				(a.y + b.y + c.y) / 3,
				0,
			);
			if (radial.length() < 1e-6) continue;
			faces++;
			if (n.dot(radial) < 0) inward++;
		}
		expect(faces).toBeGreaterThan(0);
		expect(inward).toBe(0);
	});

	test("the study's fixture screens are unpowered, and no lamp is over white", () => {
		const root = courier();
		const screens = meshesOf(root).filter((m) =>
			m.name.startsWith(FIXTURE_SCREEN_PREFIX),
		);
		expect(screens.map((s) => s.name).sort()).toEqual([
			"interior-screen-flight",
			"interior-screen-radar",
			"interior-screen-systems",
			"interior-screen-target",
		]);
		for (const screen of screens) {
			const material = screen.material as THREE.MeshBasicMaterial;
			expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
			expect(material.map).toBeNull();
			expect(material.color.getHex()).toBe(0x01090b);
		}
		for (const mesh of meshesOf(root)) {
			const material = mesh.material as THREE.MeshStandardMaterial;
			if (material.emissiveIntensity !== undefined)
				expect([
					mesh.name,
					material.emissiveIntensity <= EMISSIVE_CEILING,
				]).toEqual([mesh.name, true]);
		}
	});

	test("the machined alloy is rough enough not to flash under a bay flood (#843)", () => {
		const alloy = meshesOf(courier())
			.map((mesh) => mesh.material as THREE.MeshStandardMaterial)
			.filter((material) => material.name === COURIER_ALLOY_MATERIAL);
		expect(alloy.length).toBeGreaterThan(0);
		for (const material of alloy)
			expect(material.roughness).toBe(COURIER_ALLOY_ROUGHNESS);
		expect(COURIER_ALLOY_ROUGHNESS).toBeGreaterThanOrEqual(0.4);
	});

	test("every courier draws the one loaded model", () => {
		const first = meshesOf(courier());
		const second = meshesOf(courier());
		expect(second.length).toBe(first.length);
		for (let i = 0; i < first.length; i++) {
			expect(second[i].geometry).toBe(first[i].geometry);
			expect(second[i].material).toBe(first[i].material);
		}
	});

	test("the one gun is on the nose, on metal", () => {
		const root = courier();
		const box = new THREE.Box3().setFromObject(root);
		const size = box.getSize(new THREE.Vector3());
		const muzzles = shipMuzzlesKm("courier", HULL_SPECS.courier.variant);
		expect(muzzles.length).toBe(HULL_SPECS.courier.hardpoints);
		const caster = new THREE.Raycaster();
		for (const m of muzzles) {
			// Forward of the box's centre, inside the box.
			expect(m.z).toBeLessThan(box.getCenter(new THREE.Vector3()).z);
			expect(box.containsPoint(new THREE.Vector3(m.x, m.y, m.z))).toBe(true);
			// On metal: a ray from ahead along the gun's own line meets the
			// hull first where the muzzle is, not in the open channel beside it.
			caster.set(
				new THREE.Vector3(m.x, m.y, box.min.z - size.z),
				new THREE.Vector3(0, 0, 1),
			);
			const hit = caster.intersectObject(root, true).find((h) => h.face);
			expect(hit).toBeDefined();
			expect(Math.abs((hit as THREE.Intersection).point.z - m.z)).toBeLessThan(
				1e-6,
			);
		}
	});
});

describe("the courier's throats are measured once (node #812, sage round 1)", () => {
	/** Count the raycasts `ventThroats` makes while `run` runs. */
	const raycasts = (run: () => void) => countCalls("intersectObjects", run);
	/** The throats measured afresh: the same build, not marked authored. */
	const measured = () => {
		const root = courier();
		root.userData.authored = false;
		return ventThroats(root, "courier");
	};

	test("a second courier reads them without a raycast, and they are the measured ones", () => {
		// Each finish measures afresh once, about half a second on the model.
		for (const finish of HULL_FINISH_IDS) {
			setHullFinish(finish);
			ventThroats(courier(), "courier");
			let cached: ReturnType<typeof ventThroats> = [];
			expect([
				finish,
				raycasts(() => {
					cached = ventThroats(courier(), "courier");
				}),
			]).toEqual([finish, 0]);
			const fresh = measured();
			expect(cached.length).toBe(fresh.length);
			for (let i = 0; i < fresh.length; i++) {
				expect(cached[i].slot).toBe(fresh[i].slot);
				expect(cached[i].at.distanceTo(fresh[i].at)).toBeLessThan(1e-12);
				expect(cached[i].exhaust.distanceTo(fresh[i].exhaust)).toBeLessThan(
					1e-12,
				);
			}
		}
	}, 60_000);

	test("a finish's main throats are its own glow's", () => {
		// The bowl and the disc have different centres, so a cache that kept
		// one finish's answer for another would move the main drive.
		const mains = HULL_FINISH_IDS.map((finish) => {
			setHullFinish(finish);
			return ventThroats(courier(), "courier")
				.filter((t) => t.family === "main")
				.map((t) => t.at.z);
		});
		const fresh = HULL_FINISH_IDS.map((finish) => {
			setHullFinish(finish);
			return measured()
				.filter((t) => t.family === "main")
				.map((t) => t.at.z);
		});
		expect(mains).toEqual(fresh);
	}, 60_000);

	test("a root built under one finish keeps its own glow's throats after a switch (sage round 7)", () => {
		// The glow is chosen at build; the finish in force at the query is
		// not what the root carries. Every ordered pair whose glows differ.
		const mainsOf = (root: THREE.Object3D) =>
			ventThroats(root, "courier")
				.filter((t) => t.family === "main")
				.map((t) => t.at.z);
		let pairs = 0;
		for (const built of HULL_FINISH_IDS)
			for (const asked of HULL_FINISH_IDS) {
				setHullFinish(built);
				const root = courier();
				const own = courier();
				own.userData.authored = false;
				const fresh = mainsOf(own);
				setHullFinish(asked);
				if (courier().userData.courierGlow === root.userData.courierGlow)
					continue;
				pairs++;
				expect([built, asked, mainsOf(root)]).toEqual([built, asked, fresh]);
			}
		expect(pairs).toBeGreaterThan(0);
	}, 120_000);

	test("what one caller does to its throats does not reach the next", () => {
		const first = ventThroats(courier(), "courier");
		const before = first[0].at.clone();
		first[0].at.x += 1;
		first[0].exhaust.negate();
		const second = ventThroats(courier(), "courier");
		expect(second[0].at.distanceTo(before)).toBe(0);
		expect(second[0].exhaust.distanceTo(first[0].exhaust)).toBeGreaterThan(1);
	});

	test("taking the model out and putting it back keeps its nav lights (sage round 7)", () => {
		// What the cost instrument does around every Kestrel arm.
		// `addNavLights` casts one ray per light through `intersectObject`.
		const placements = (run: () => void) => countCalls("intersectObject", run);
		courier();
		const installed = authoredCourierBuilder();
		installAuthoredCourier(undefined);
		try {
			// The Kestrel places its own lights; that is not what is counted.
			buildShipMesh("courier", HULL_SPECS.courier.variant);
		} finally {
			installAuthoredCourier(installed);
		}
		expect(placements(() => courier())).toBe(0);
	});

	test("the procedural courier is measured, not handed the model's throats", () => {
		const installed = authoredCourierBuilder();
		installAuthoredCourier(undefined);
		try {
			const root = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
			expect(raycasts(() => ventThroats(root, "courier"))).toBeGreaterThan(0);
		} finally {
			installAuthoredCourier(installed);
		}
	});
});

describe("every Traffic courier is the model, so the detail band switches it (sage round 2)", () => {
	const levelsOf = (root: THREE.Object3D) => {
		const frame = root.getObjectByName(COURIER_FRAME_NAME) as THREE.Object3D;
		const named = (name: string) =>
			frame.children.find((c) => c.name === name) as THREE.Object3D;
		return {
			full: named(COURIER_LEVEL_NAMES.full),
			reduced: named(COURIER_LEVEL_NAMES.reduced),
			outline: named(COURIER_LEVEL_NAMES.outline),
		};
	};
	const reachKm = HULL_REACH_KM.courier;
	const drawn = (root: THREE.Object3D) =>
		Object.entries(levelsOf(root))
			.filter(([, o]) => o.visible)
			.map(([k]) => k);

	test("a mesh's children survive its level, whether or not it is reduced (sage round 4)", () => {
		// The shipped model nests no mesh in another; this holds the rule for
		// one that would. A cabin mesh gets no reduced geometry, and a hull
		// mesh does: a child of either keeps its place on the hull.
		const template = new THREE.Group();
		const parents = [
			["interior-seat", new THREE.Vector3(1, 2, 3)],
			["hull-spine", new THREE.Vector3(-2, 0, 1)],
		] as const;
		for (const [name, at] of parents) {
			const parent = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
			parent.name = name;
			parent.position.copy(at);
			parent.scale.setScalar(2);
			const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
			child.name = `plate-on-${name}`;
			child.position.set(0.5, 0, 0);
			parent.add(child);
			template.add(parent);
		}
		template.updateMatrixWorld(true);
		// The courier's own rule: the cabin is skipped (`courier-hull.ts`).
		const level = reducedLevel(template, 1e-3, 1, "level", {
			skip: (mesh) => /^interior-/.test(mesh.name),
		});
		level.updateMatrixWorld(true);
		for (const [name] of parents) {
			const kept = level.getObjectByName(`plate-on-${name}`);
			expect(kept).toBeInstanceOf(AuthoredLevelMesh);
			const was = template.getObjectByName(
				`plate-on-${name}`,
			) as THREE.Object3D;
			const at = (o: THREE.Object3D) =>
				new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
			expect(at(kept as THREE.Object3D).distanceTo(at(was))).toBeLessThan(1e-9);
		}
		// The cabin mesh itself is not drawn at the level.
		const cabin = level.getObjectByName("interior-seat");
		expect(cabin).toBeDefined();
		expect((cabin as THREE.Mesh).isMesh).toBeUndefined();
	});

	test("one level is drawn at a time, picked by the band and held through its hysteresis", () => {
		const root = courier();
		expect(drawn(root)).toEqual(["full"]);
		const at = (radii: number) => {
			updateShipVisuals(root, radii * reachKm, "high");
			return drawn(root);
		};
		expect(at(DETAIL_RADII.full * 1.02)).toEqual(["full"]);
		expect(at(DETAIL_RADII.full * 1.1)).toEqual(["reduced"]);
		expect(at(DETAIL_RADII.full * 1.02)).toEqual(["reduced"]);
		expect(at(DETAIL_RADII.reduced * 1.1)).toEqual(["outline"]);
		expect(at(DETAIL_RADII.full * 0.9)).toEqual(["full"]);
		// The quality row gates generated clutter; it does not pick a level.
		updateShipVisuals(root, DETAIL_RADII.full * 0.5 * reachKm, "low");
		expect(drawn(root)).toEqual(["full"]);
	});

	test("each reduced level is lighter, keeps the hull outside the canopy, and stays inside the model's box", () => {
		const root = courier();
		const { full, reduced, outline } = levelsOf(root);
		const study = triangles(full);
		expect(study).toBe(353_954);
		// Pinned, because the receipt quotes them and the simplifier is
		// deterministic: a change to the reduction is a red row rather than a
		// silent re-weighting of every courier in the game.
		expect(triangles(reduced)).toBe(92_540);
		expect(triangles(outline)).toBe(6_472);
		for (const level of [reduced, outline]) {
			const names: string[] = [];
			level.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				names.push(o.name);
				expect(o).toBeInstanceOf(AuthoredLevelMesh);
				expect(isLevelStandIn(o)).toBe(true);
			});
			expect(names.some((n) => /^(interior-|pilot-)/.test(n))).toBe(false);
			expect(names).toContain("canopy-glass");
			const box = new THREE.Box3().setFromObject(level);
			const model = new THREE.Box3().setFromObject(full);
			expect(model.containsBox(box)).toBe(true);
		}
	});

	test("the target is half a device pixel at each level's band edge", () => {
		// 60° on a 1800-pixel frame: one pixel at d is 2 d tan 30° / 1800.
		const pixelAt = (radii: number) =>
			(2 * radii * reachKm * Math.tan(Math.PI / 6)) / 1800;
		expect(courierLevelErrorKm("reduced")).toBeCloseTo(
			pixelAt(DETAIL_RADII.full) / 2,
			15,
		);
		expect(courierLevelErrorKm("outline")).toBeCloseTo(
			pixelAt(DETAIL_RADII.reduced) / 2,
			15,
		);
		// About 0.46 m and 4.6 m of hull.
		expect(courierLevelErrorKm("reduced") * 1000).toBeCloseTo(0.462, 3);
		expect(courierLevelErrorKm("outline") * 1000).toBeCloseTo(4.619, 3);
	});

	test("each level's reported error is inside its target, and not trivially", () => {
		// The row above checks the target; this one reads what the simplifier
		// reports it reached on every mesh of the level, carried into
		// kilometres of hull. The simplifier's own metric, so this row catches
		// a target passed in the wrong units; it does not measure how far a
		// level lies from the model, and is no bound on that (sage round 5).
		const { reduced, outline } = levelsOf(courier());
		const reachedKm = (o: THREE.Object3D) =>
			o.userData[LEVEL_REACHED_ERROR_KM] as number;
		for (const [level, object] of [
			["reduced", reduced],
			["outline", outline],
		] as const) {
			const reached = reachedKm(object);
			const target = courierLevelErrorKm(level);
			expect([level, Number.isFinite(reached)]).toEqual([level, true]);
			expect([level, reached <= target]).toEqual([level, true]);
			// A record of zero would pass the bound by being empty: the level
			// did collapse edges, so it reached a real fraction of the target.
			expect([level, reached > target / 10]).toEqual([level, true]);
		}
		// The coarser level is coarser in the error it actually carries.
		expect(reachedKm(outline)).toBeGreaterThan(reachedKm(reduced));
	});

	test("a reduced level takes no ray, so the lights, guns and throats are placed on the model", () => {
		const root = courier();
		const { reduced, outline } = levelsOf(root);
		const caster = new THREE.Raycaster(
			new THREE.Vector3(0, 0.001, -1),
			new THREE.Vector3(0, 0, 1),
		);
		expect(caster.intersectObject(reduced, true)).toEqual([]);
		expect(caster.intersectObject(outline, true)).toEqual([]);
		expect(caster.intersectObject(root, true).length).toBeGreaterThan(0);
	});

	test("every courier shares the levels' geometry, and the glows stay outside them", () => {
		const a = levelsOf(courier());
		const b = levelsOf(courier());
		const geometries = (o: THREE.Object3D) => {
			const out: THREE.BufferGeometry[] = [];
			o.traverse((m) => {
				if (m instanceof THREE.Mesh) out.push(m.geometry);
			});
			return out;
		};
		for (const level of ["reduced", "outline"] as const) {
			const mine = geometries(a[level]);
			const theirs = geometries(b[level]);
			expect(theirs.length).toBe(mine.length);
			for (let i = 0; i < mine.length; i++) expect(theirs[i]).toBe(mine[i]);
		}
		for (const level of Object.values(a))
			level.traverse((o) => {
				if (o instanceof THREE.Mesh) expect(isDriveBell(o)).toBe(false);
			});
	});

	test("a wreck darkens every level", () => {
		const wreck = buildDerelictMesh("courier");
		const { full, reduced, outline } = levelsOf(wreck);
		const darkened = new Set<THREE.Material>();
		full.traverse((o) => {
			if (o instanceof THREE.Mesh) darkened.add(o.material as THREE.Material);
		});
		const live = new Set<THREE.Material>();
		levelsOf(courier()).full.traverse((o) => {
			if (o instanceof THREE.Mesh) live.add(o.material as THREE.Material);
		});
		for (const level of [reduced, outline])
			level.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const material = o.material as THREE.Material;
				expect(darkened.has(material)).toBe(true);
				expect(live.has(material)).toBe(false);
			});
	});
});
