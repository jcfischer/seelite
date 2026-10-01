/**
 * Where a hull's guns are (#607 D3, D5): one muzzle per declared hardpoint,
 * measured off the built mesh. In chase view the beam is drawn from these, so a
 * muzzle in the wrong place is a beam that starts in empty space or inside
 * the hull.
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	HULL_IDS,
	HULL_SPECS,
	HULL_VARIANT_IDS,
	type HullVariantId,
} from "../src/hull";
import { buildShipMesh, shipMuzzlesKm } from "../src/ship-mesh";

function built(id: (typeof HULL_IDS)[number], variant: HullVariantId) {
	const root = buildShipMesh(id, variant).root;
	root.updateMatrixWorld(true);
	return { root, box: new THREE.Box3().setFromObject(root) };
}
const boxOf = (id: (typeof HULL_IDS)[number], variant: HullVariantId) =>
	built(id, variant).box;

describe("a hull's muzzles (#607)", () => {
	for (const id of HULL_IDS)
		for (const variant of HULL_VARIANT_IDS) {
			test(`${id} ${variant}: one muzzle per hardpoint, on the hull's forward half, mirrored`, () => {
				const muzzles = shipMuzzlesKm(id, variant);
				expect(muzzles).toHaveLength(HULL_SPECS[id].hardpoints);
				const box = boxOf(id, variant);
				const size = box.getSize(new THREE.Vector3());
				const centre = box.getCenter(new THREE.Vector3());
				const eps = Math.max(size.x, size.y, size.z) * 1e-3;
				for (const m of muzzles) {
					// On the metal's box, not proud of it: a muzzle sizes nothing.
					expect(
						box
							.clone()
							.expandByScalar(eps)
							.containsPoint(new THREE.Vector3(m.x, m.y, m.z)),
					).toBe(true);
					// Forward is -z; a gun is on the front half of the hull.
					expect(m.z).toBeLessThan(centre.z);
				}
				// Mirrored about the hull's centre line, as the hulls are.
				const meanX = muzzles.reduce((s, m) => s + m.x, 0) / muzzles.length;
				expect(Math.abs(meanX - centre.x)).toBeLessThan(eps);
			});
		}

	test("every muzzle is on metal: a ray from ahead meets the hull there first (sage round 2 on #608)", () => {
		// The box check cannot see a mount on the box's empty front face, the
		// ray fallback's last resort. This can: the first metal on the line
		// through the muzzle, from ahead, must be the muzzle itself.
		const caster = new THREE.Raycaster();
		for (const id of HULL_IDS)
			for (const variant of HULL_VARIANT_IDS) {
				const { root, box } = built(id, variant);
				const size = box.getSize(new THREE.Vector3());
				const eps = Math.max(size.x, size.y, size.z) * 2e-3;
				for (const m of shipMuzzlesKm(id, variant)) {
					caster.set(
						new THREE.Vector3(m.x, m.y, box.min.z - size.z),
						new THREE.Vector3(0, 0, 1),
					);
					const hit = caster.intersectObject(root, true).find((h) => h.face);
					expect({ id, variant, z: hit?.point.z ?? null }).toEqual({
						id,
						variant,
						z: expect.closeTo(m.z, -Math.log10(eps)),
					});
				}
			}
	});

	test("a mesh the caller built is measured, and must be unplaced", () => {
		const fresh = buildShipMesh("tug", "b").root;
		const muzzles = shipMuzzlesKm("tug", "b", fresh);
		expect(muzzles).toHaveLength(HULL_SPECS.tug.hardpoints);
		const placed = buildShipMesh("tug", "c").root;
		placed.position.set(5, 0, 0);
		placed.updateMatrix();
		expect(() => shipMuzzlesKm("tug", "c", placed)).toThrow(/unplaced/);
	});

	test("the courier's one gun is on its centre line (D5)", () => {
		const [m] = shipMuzzlesKm("courier", HULL_SPECS.courier.variant);
		const box = boxOf("courier", HULL_SPECS.courier.variant);
		expect(m.x).toBeCloseTo(box.getCenter(new THREE.Vector3()).x, 6);
	});

	test("a hull that draws its hardpoints fires from them: the patrol's pods", () => {
		// `patrol-hardpoint-<side>` is a pod at x = ±0.0058 km. Its muzzle is the
		// pod's forward tip, not a point found by a ray elsewhere on the nose.
		const root = buildShipMesh("patrol", "a").root;
		root.updateMatrixWorld(true);
		const pods = ["port", "starboard"].map((side) => {
			const pod = root.getObjectByName(`patrol-hardpoint-${side}`);
			if (!pod) throw new Error(`no patrol-hardpoint-${side}`);
			return new THREE.Box3().setFromObject(pod);
		});
		const muzzles = [...shipMuzzlesKm("patrol", "a")].sort((a, b) => a.x - b.x);
		pods.sort((a, b) => a.min.x - b.min.x);
		muzzles.forEach((m, i) => {
			const c = pods[i].getCenter(new THREE.Vector3());
			expect(m.x).toBeCloseTo(c.x, 6);
			expect(m.y).toBeCloseTo(c.y, 6);
			expect(m.z).toBeCloseTo(pods[i].min.z, 6);
		});
	});

	test("measured once: the same array for the same hull", () => {
		expect(shipMuzzlesKm("raider", "a")).toBe(shipMuzzlesKm("raider", "a"));
	});
});
