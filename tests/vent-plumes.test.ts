/**
 * The firing vents, drawn (#621, `flight-model.md` §3.8.1): where each throat
 * sits, and that a plume is the firing table and nothing else.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { HULL_IDS, HULL_SPECS, type HullId } from "../src/hull";
import { EMISSIVE_CEILING } from "../src/light-rig";
import { buildShipMesh } from "../src/ship-mesh";
import {
	PLUME_LIFE_S,
	PLUME_PARTICLES,
	PLUME_PEAK,
	buildVentPlumes,
	plumeParticle,
	ventThroats,
} from "../src/vent-plumes";

const built = new Map<HullId, THREE.Group>();
const rootOf = (id: HullId) => {
	let root = built.get(id);
	if (!root) {
		root = buildShipMesh(id, HULL_SPECS[id].variant).root;
		built.set(id, root);
	}
	return root;
};

beforeAll(() => {
	for (const id of HULL_IDS) rootOf(id);
}, 60_000);

describe("every throat is the vent the table names", () => {
	test("a vent drawn off its table position is moved along its own line of action", () => {
		// Sliding a vent along the line its push acts on changes neither its
		// force nor its torque, so this is what makes a drawn throat the same
		// vent rather than a picture of another.
		for (const id of HULL_IDS) {
			const root = rootOf(id);
			const centre = new THREE.Box3()
				.setFromObject(root)
				.getCenter(new THREE.Vector3());
			for (const throat of ventThroats(root, id)) {
				if (throat.placed !== "line") continue;
				const vent = HULL_SPECS[id].vents.find((v) => v.slot === throat.slot);
				if (!vent) throw new Error(`${id}: no vent ${throat.slot}`);
				const table = new THREE.Vector3(...vent.posKm).add(centre);
				const dir = new THREE.Vector3(...vent.dir);
				const offLine = throat.at.clone().sub(table).cross(dir).length();
				expect(offLine).toBeLessThan(1e-9);
				expect(throat.exhaust.clone().add(dir).length()).toBeLessThan(1e-12);
				expect(Number.isFinite(throat.at.length())).toBe(true);
			}
		}
	});

	test("every slot has a throat, and the main drive one per bell", () => {
		for (const id of HULL_IDS) {
			const root = rootOf(id);
			const throats = ventThroats(root, id);
			const bells: string[] = [];
			root.traverse((o) => {
				if ((o as THREE.Mesh).isMesh && o.name.endsWith("-exhaust"))
					bells.push(o.name);
			});
			expect(bells.length).toBeGreaterThan(0);
			for (const vent of HULL_SPECS[id].vents) {
				const own = throats.filter((t) => t.slot === vent.slot);
				expect(own.length).toBe(vent.slot === "main" ? bells.length : 1);
			}
			for (const t of throats.filter((t) => t.slot === "main"))
				expect(t.exhaust.z).toBe(1);
		}
	});

	test("a line that meets the hull puts its throat on the metal, on the exhaust side", () => {
		// A ray from just outside the throat, along the push, meets metal at
		// once; the same ray started a hair further out meets nothing sooner.
		let met = 0;
		const caster = new THREE.Raycaster();
		const eps = 1e-6;
		for (const id of HULL_IDS) {
			const root = rootOf(id);
			for (const t of ventThroats(root, id)) {
				if (t.placed !== "line" || t.gapKm !== 0) continue;
				met++;
				const push = t.exhaust.clone().negate();
				caster.set(t.at.clone().addScaledVector(t.exhaust, eps), push);
				const hit = caster.intersectObject(root, true).find((h) => h.face);
				expect(hit).toBeDefined();
				expect(hit?.distance ?? 1).toBeLessThan(2 * eps);
			}
		}
		// Every line meets metal since #636 (`tests/vent-placement.test.ts`
		// holds that), so the row has subjects.
		expect(met).toBeGreaterThan(50);
		// Raycasts every throat through every hull's whole mesh, the authored
		// ones (543k triangles for the voyager, node #820) included: seconds,
		// so past bun's 5 s default under a loaded machine.
	}, 60_000);
});

describe("a plume is the firing table and nothing else", () => {
	test("nothing fires, nothing is lit", () => {
		const plumes = buildVentPlumes(rootOf("courier"), "courier");
		expect(plumes.update({}, 3.21)).toBe(0);
		const heat = plumes.object.geometry.getAttribute("heat")
			.array as Float32Array;
		expect(heat.every((h) => h === 0)).toBe(true);
	});

	test("one firing vent lights its own throat and no other", () => {
		const plumes = buildVentPlumes(rootOf("courier"), "courier");
		expect(plumes.update({ "fore-port-lateral": 1 }, 1.5)).toBe(1);
		const heat = plumes.object.geometry.getAttribute("heat")
			.array as Float32Array;
		const per = (1 + PLUME_PARTICLES) * 3;
		plumes.throats.forEach((throat, n) => {
			const own = heat.subarray(n * per, (n + 1) * per);
			const lit = own.some((h) => h > 0);
			expect(lit).toBe(throat.slot === "fore-port-lateral");
		});
	});

	test("the plume is not part of the hull's root, so the envelope cannot move", () => {
		const root = rootOf("courier");
		const before = new THREE.Box3().setFromObject(root);
		const plumes = buildVentPlumes(root, "courier");
		plumes.update({ main: 1, "strafe-fore-port": 1 }, 0.4);
		expect(plumes.object.parent).toBeNull();
		expect(root.getObjectByName("vent-plumes")).toBeUndefined();
		expect(new THREE.Box3().setFromObject(root).equals(before)).toBe(true);
		expect(plumes.object.castShadow).toBe(false);
	});

	test("no plume point is hotter than the exposure ceiling allows", () => {
		expect(PLUME_PEAK).toBeLessThanOrEqual(EMISSIVE_CEILING);
		const plumes = buildVentPlumes(rootOf("freighter"), "freighter");
		const all = Object.fromEntries(
			HULL_SPECS.freighter.vents.map((v) => [v.slot, 1]),
		);
		plumes.update(all, 2.2);
		const heat = plumes.object.geometry.getAttribute("heat")
			.array as Float32Array;
		expect(Math.max(...heat)).toBeLessThanOrEqual(PLUME_PEAK + 1e-6);
		expect(Math.max(...heat)).toBeGreaterThan(0);
	});

	test("the same clock draws the same plume", () => {
		const a = buildVentPlumes(rootOf("patrol"), "patrol");
		const b = buildVentPlumes(rootOf("patrol"), "patrol");
		a.update({ main: 0.7, "aft-port-lateral": 1 }, 12.345);
		b.update({ main: 0.7, "aft-port-lateral": 1 }, 12.345);
		for (const name of ["position", "sizeKm", "heat"])
			expect(
				Array.from(a.object.geometry.getAttribute(name).array as Float32Array),
			).toEqual(
				Array.from(b.object.geometry.getAttribute(name).array as Float32Array),
			);
	});
});

describe("a puff leaves its throat and thins", () => {
	test("age, reach and strength stay in their bounds, and travel grows with age", () => {
		for (const level of [0, 0.25, 1])
			for (let k = 0; k < 50; k++) {
				const t = k * 0.037;
				for (let i = 0; i < PLUME_PARTICLES; i++) {
					const p = plumeParticle(i, 3, t, PLUME_LIFE_S.yaw, level);
					expect(p.age).toBeGreaterThanOrEqual(0);
					expect(p.age).toBeLessThan(1);
					expect(p.along).toBeCloseTo(Math.sqrt(level) * p.age, 12);
					expect(Math.hypot(...p.across)).toBeLessThanOrEqual(
						0.28 * p.age + 1e-12,
					);
					expect(p.strength).toBeLessThanOrEqual(level);
					if (level === 0) expect(p.strength).toBe(0);
				}
			}
	});

	test("a throat's particles are spread through one life, not bunched", () => {
		const ages = Array.from(
			{ length: PLUME_PARTICLES },
			(_, i) => plumeParticle(i, 5, 0.9, PLUME_LIFE_S.main, 1).age,
		).sort((a, b) => a - b);
		for (let i = 1; i < ages.length; i++)
			expect(ages[i] - ages[i - 1]).toBeCloseTo(1 / PLUME_PARTICLES, 9);
	});
});
