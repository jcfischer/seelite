/**
 * #532's world-anchored exit (#195 D2): an object at the arrival point, visible
 * from outside the ship, that #530's fly-past and #262's NPC arrivals can reuse.
 *
 * What is held here is the part that is arithmetic: where it stands, how big it
 * is against the ship it lets through, that it draws nothing when its strength
 * is zero, and that a jump's teardown frees what it owns. How it looks is the
 * strip's.
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { ARRIVAL_RIFT, ArrivalRift } from "../src/arrival-rift";
import { disposeSubtree, resourcesOf } from "../src/gpu-teardown";
import { v3 } from "../src/vec3";
import { WITCHSPACE, witchspaceLook } from "../src/witchspace";
import { CROSSING, npcRiftLook } from "../src/witchspace-crossing";

const nose = v3(0, 0, 1);

describe("the arrival rift", () => {
	test("stands behind the ship on its nose axis, in world kilometres", () => {
		const rift = new ArrivalRift({
			pos: v3(1e8, 2e7, -3e6),
			nose,
			reachKm: 0.04,
		});
		const back = ARRIVAL_RIFT.standoffReaches * 0.04;
		expect(rift.anchor.x).toBe(1e8);
		expect(rift.anchor.y).toBe(2e7);
		expect(rift.anchor.z).toBeCloseTo(-3e6 - back, 6);
	});

	test("is drawn camera-relative, so a float64 world never reaches the scene graph", () => {
		const rift = new ArrivalRift({ pos: v3(1e8, 0, 0), nose, reachKm: 0.04 });
		rift.update(1, 0.5, v3(1e8 - 0.3, 0, 0));
		expect(rift.object.position.x).toBeCloseTo(0.3, 6);
	});

	test("faces along the nose, so a chase camera looks through it", () => {
		const rift = new ArrivalRift({
			pos: v3(0, 0, 0),
			nose: v3(1, 0, 0),
			reachKm: 0.04,
		});
		const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
			rift.object.quaternion,
		);
		expect(normal.x).toBeCloseTo(1, 9);
	});

	test("is wider than the ship it lets through, at full strength", () => {
		const rift = new ArrivalRift({ pos: v3(0, 0, 0), nose, reachKm: 0.04 });
		rift.update(1, 0.5, v3(0, 0, 0));
		// Its diameter is wider than the ship's: the radius is past the reach.
		expect(rift.radiusKm).toBeGreaterThan(0.04 * 1.2);
	});

	test("opens with its strength, and draws nothing at zero", () => {
		const rift = new ArrivalRift({ pos: v3(0, 0, 0), nose, reachKm: 0.04 });
		rift.update(0.2, 0.1, v3(0, 0, 0));
		const small = rift.radiusKm;
		rift.update(1, 0.5, v3(0, 0, 0));
		expect(rift.radiusKm).toBeGreaterThan(small);
		expect(rift.object.visible).toBe(true);
		rift.update(0, 3.9, v3(0, 0, 0));
		expect(rift.object.visible).toBe(false);
	});

	for (const kind of ["NPC", "player"] as const) {
		test(`${kind} seal shrinks the drawn mesh to a point even under its flare`, () => {
			const rift = new ArrivalRift({ pos: v3(0, 0, 0), nose, reachKm: 0.04 });
			const fullRadius = ARRIVAL_RIFT.radiusReaches * 0.04;
			const end = kind === "NPC" ? CROSSING.windowEndS : WITCHSPACE.riftEndS;
			let previous = fullRadius;
			for (const remainingS of [1, 0.5, 0.1, 0.01, 0.001, 0]) {
				const at = end - remainingS;
				const player = witchspaceLook({
					kind: "exit",
					sinceS: at,
					from: "arrival",
				});
				const { strength, flare } =
					kind === "NPC"
						? npcRiftLook(at)
						: { strength: player.rift, flare: player.riftFlare };
				rift.update(strength, at, v3(0, 0, 0), flare);
				expect(rift.radiusKm).toBeLessThanOrEqual(previous);
				previous = rift.radiusKm;
				if (remainingS === 0.001) {
					// The old 30% floor leaves a large lit ring until removal.
					expect(flare).toBeGreaterThan(0.5);
					expect(rift.radiusKm / fullRadius).toBeLessThan(0.005);
					expect(rift.object.visible).toBe(true);
				}
			}
			expect(rift.radiusKm).toBe(0);
			expect(rift.object.visible).toBe(false);
		});
	}

	test("owns its geometry and material, and a teardown frees all of it", () => {
		const rift = new ArrivalRift({ pos: v3(0, 0, 0), nose, reachKm: 0.04 });
		const owned = resourcesOf(rift.object);
		expect(owned.size).toBeGreaterThan(0);
		const report = disposeSubtree(rift.object);
		expect(report.freed).toEqual(owned);
		expect(report.kept.size).toBe(0);
	});

	test("two rifts share nothing — an NPC's teardown cannot black out the player's", () => {
		const a = resourcesOf(
			new ArrivalRift({ pos: v3(0, 0, 0), nose, reachKm: 0.04 }).object,
		);
		const b = resourcesOf(
			new ArrivalRift({ pos: v3(0, 0, 0), nose, reachKm: 0.2 }).object,
		);
		for (const r of a) expect(b.has(r)).toBe(false);
	});
});
