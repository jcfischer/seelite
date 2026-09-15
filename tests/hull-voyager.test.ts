/**
 * #331 — `voyager`, an expedition capital after *2001*'s Discovery One.
 *
 * Every row every hull owes (envelope, laws, finishes, forward view, mounts,
 * nav lights) is asserted over `HULL_IDS` elsewhere, and the new hull reaches
 * them by being in the roster. What this file holds is the node's own two
 * claims, each of which a plausible build could get wrong while all of those
 * rows stayed green:
 *
 * - **the class**: a capital that docks nowhere and is sold nowhere, with the
 *   longest range in the roster, which is what an expedition hull is for;
 * - **the shape**: a sphere forward, a long thin spine behind it, and the drive
 *   aft — the silhouette the homage is of — on all three variants, and far
 *   slenderer than either existing capital, so the three cannot be mistaken
 *   for one another at first sight.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	CAPITAL_HULL_IDS,
	DOCKABLE_HULL_IDS,
	HULL_CEILING_HOLD_T,
	HULL_IDS,
	HULL_SPECS,
	HULL_VARIANT_IDS,
	type HullId,
	type HullVariantId,
	PURCHASABLE_HULL_IDS,
} from "../src/hull";
import { HULL_VARIANTS, buildShipMesh } from "../src/ship-mesh";

const VOYAGER: HullId = "voyager";

const box = (object: THREE.Object3D) => {
	object.updateMatrixWorld(true);
	return new THREE.Box3().setFromObject(object);
};

function part(id: HullId, variant: HullVariantId, name: string) {
	const root = buildShipMesh(id, variant).root;
	root.updateMatrixWorld(true);
	const found = root.getObjectByName(name);
	if (!found) throw new Error(`${id}/${variant} has no part named ${name}`);
	return { root, found };
}

describe("voyager is an expedition capital", () => {
	test("it is a capital: no berth, no shipyard, no price", () => {
		const spec = HULL_SPECS[VOYAGER];
		expect(spec.role).toBe("expedition");
		expect((CAPITAL_HULL_IDS as readonly HullId[]).includes(VOYAGER)).toBe(
			true,
		);
		expect(DOCKABLE_HULL_IDS.includes(VOYAGER)).toBe(false);
		expect((PURCHASABLE_HULL_IDS as readonly HullId[]).includes(VOYAGER)).toBe(
			false,
		);
		expect(spec.holdT).toBeGreaterThan(HULL_CEILING_HOLD_T);
		expect(spec.priceCr).toBeNull();
	});

	test("it declares the largest tankLy and chargeAu in the roster", () => {
		// Declared, not flown: the router still reads `JUMP_RANGE_LY`, not the
		// flown hull's tank, until #185 (CONTEXT.md, **Hyperspace tank**).
		for (const id of HULL_IDS) {
			if (id === VOYAGER) continue;
			expect([id, HULL_SPECS[VOYAGER].tankLy > HULL_SPECS[id].tankLy]).toEqual([
				id,
				true,
			]);
			expect([
				id,
				HULL_SPECS[VOYAGER].chargeAu > HULL_SPECS[id].chargeAu,
			]).toEqual([id, true]);
		}
	});

	test("its first concept is the homage, by name", () => {
		expect(HULL_VARIANTS[VOYAGER][0]).toMatchObject({
			id: "a",
			name: "Odyssey",
		});
	});
});

describe("voyager's shape: a sphere forward, a spine behind it, the drive aft", () => {
	for (const variant of HULL_VARIANT_IDS) {
		test(`${variant}: the command sphere is the bow, round, and an eighth-ish of the length`, () => {
			const { root, found } = part(VOYAGER, variant, "voyager-bridge");
			const hull = box(root);
			const sphere = box(found);
			const size = sphere.getSize(new THREE.Vector3());
			const length = hull.max.z - hull.min.z;
			// The bow: nothing of the hull stands ahead of the sphere by more than
			// the glass set into it.
			expect(sphere.min.z - hull.min.z).toBeLessThan(0.002);
			// Round: its three extents within a tenth of each other.
			expect(
				Math.max(size.x, size.y, size.z) / Math.min(size.x, size.y, size.z),
			).toBeLessThan(1.1);
			// The film's ratio is about an eighth; a sixth to a tenth is the band
			// that still reads as a head on a long body.
			expect(size.z / length).toBeGreaterThan(0.1);
			expect(size.z / length).toBeLessThan(1 / 6);
		});

		test(`${variant}: the spine is long and thin behind the sphere`, () => {
			const { root, found } = part(VOYAGER, variant, "voyager-fuselage");
			const hull = box(root);
			const spine = box(found);
			const sphere = box(part(VOYAGER, variant, "voyager-bridge").found);
			const size = spine.getSize(new THREE.Vector3());
			const length = hull.max.z - hull.min.z;
			const sphereDiameter = sphere.max.z - sphere.min.z;
			expect(size.z / length).toBeGreaterThan(0.5);
			expect(Math.max(size.x, size.y)).toBeLessThan(sphereDiameter * 0.4);
			// Starts behind the sphere's centre, seated in its after half.
			expect(spine.min.z).toBeGreaterThan(sphere.min.z + sphereDiameter * 0.5);
		});

		test(`${variant}: every drive bell is aft of the middle of the hull`, () => {
			const root = buildShipMesh(VOYAGER, variant).root;
			const hull = box(root);
			const middle = (hull.min.z + hull.max.z) / 2;
			let bells = 0;
			for (const child of root.children) {
				if (!child.name.endsWith("-bell")) continue;
				bells += 1;
				expect([child.name, box(child).min.z > middle]).toEqual([
					child.name,
					true,
				]);
			}
			expect(bells).toBeGreaterThanOrEqual(2);
		});
	}

	test("voyager is far slenderer than both other capitals", () => {
		// Two capital classes only earned their places by not being mistaken for
		// each other at first sight (`ship-visuals.md` §1); a third owes the same.
		// Length over the larger of beam and height, selected variants.
		const slenderness = (id: HullId) => {
			const { lengthKm, beamKm, heightKm } = HULL_SPECS[id].env;
			return lengthKm / Math.max(beamKm, heightKm);
		};
		for (const id of CAPITAL_HULL_IDS) {
			if (id === VOYAGER) continue;
			expect([id, slenderness(VOYAGER) > slenderness(id) * 1.5]).toEqual([
				id,
				true,
			]);
		}
		expect(slenderness(VOYAGER)).toBeGreaterThan(4);
	});
});
