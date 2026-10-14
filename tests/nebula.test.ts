import { describe, expect, test } from "bun:test";
import { generateNebulae, nebulaView, rayCloudInterval } from "../src/nebula";
import { skyFrame, galaxyToSystem } from "../src/galaxy-frame";
import { generateGalaxy } from "../src/galaxy";

describe("seeded galactic nebula volumes", () => {
	test("identity is independent of visit order and other galaxy generation", () => {
		const before = generateNebulae(47, 0);
		generateGalaxy(47, 0);
		generateNebulae(99, 3);
		expect(generateNebulae(47, 0)).toEqual(before);
		expect(generateNebulae(48, 0)).not.toEqual(before);
		expect(generateNebulae(47, 1)).not.toEqual(before);
		expect(before).toHaveLength(4);
	});
	test("world bearings use the existing galactic transform", () => {
		const cloud = {
			id: 0,
			center: { x: 8, y: 2, z: -3 },
			radiusLy: 4,
			seed: 12,
		};
		const observer = { seed: 987, pos: { x: 1, y: 2, z: -3 } };
		const view = nebulaView(cloud, observer);
		const expected = galaxyToSystem(skyFrame(observer.seed), {
			x: 1,
			y: 0,
			z: 0,
		});
		expect(view.bearing!.x).toBeCloseTo(expected.x, 12);
		expect(view.bearing!.y).toBeCloseTo(expected.y, 12);
		expect(view.bearing!.z).toBeCloseTo(expected.z, 12);
		expect(view.angularRadiusRad).toBeCloseTo(Math.asin(4 / 7), 12);
		expect(view.inside).toBe(false);
		expect(nebulaView(cloud, { ...observer, pos: cloud.center }).inside).toBe(
			true,
		);
	});
	test("moving observer changes size and bearing, not cloud identity", () => {
		const cloud = generateNebulae(47, 0)[0];
		const a = nebulaView(cloud, {
			seed: 1,
			pos: { x: cloud.center.x + 20, y: cloud.center.y, z: cloud.center.z },
		});
		const b = nebulaView(cloud, {
			seed: 1,
			pos: { x: cloud.center.x, y: cloud.center.y + 10, z: cloud.center.z },
		});
		expect(a.bearing).not.toEqual(b.bearing);
		expect(b.angularRadiusRad).toBeGreaterThan(a.angularRadiusRad);
	});
	test("sphere ray entry handles outside, inside, miss and behind", () => {
		const c = { x: 0, y: 0, z: 0 };
		expect(
			rayCloudInterval({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -1 }, c, 3),
		).toEqual([7, 13]);
		expect(rayCloudInterval(c, { x: 1, y: 0, z: 0 }, c, 3)).toEqual([0, 3]);
		expect(
			rayCloudInterval({ x: 0, y: 0, z: 10 }, { x: 1, y: 0, z: 0 }, c, 3),
		).toBeNull();
		expect(
			rayCloudInterval({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 1 }, c, 3),
		).toBeNull();
		expect(
			rayCloudInterval({ x: 3, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, c, 3),
		).toBeNull();
	});
});
