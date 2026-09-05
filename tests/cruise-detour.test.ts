import { expect, test } from "bun:test";
import { cruiseRouteBlocker, planCruiseDetour } from "../src/cruise-detour";
import { type Mass } from "../src/cruise";
import { type Vec3, v3 } from "../src/vec3";

const blocker: Mass = { id: "planet", pos: v3(), radiusKm: 100 };
const target = v3(1000, 0, 0);
const from = v3(-1000, 0, 0);

const plan = (overrides: Partial<Parameters<typeof planCruiseDetour>[0]> = {}) =>
	planCruiseDetour({
		from,
		target,
		blocker,
		masses: [blocker],
		targetParentId: "planet",
		...overrides,
	});

test("plans two bounded waypoints around a directly-behind station", () => {
	const route = plan();
	expect(route).not.toBeNull();
	expect(route?.waypoints).toHaveLength(2);
	expect(route?.checkedSegments).toBe(6);
	expect(route?.bodyId).toBe("planet");
});

test("retains a still-safe side across replans", () => {
	const first = plan();
	const second = plan({ previousSide: first!.side });
	expect(second?.side).toBe(first?.side);
});

test("chooses the other side when a second obstruction occupies one limb", () => {
	const second: Mass = { id: "second", pos: v3(0, 0, -120), radiusKm: 150 };
	const route = plan({ masses: [blocker, second] });
	expect(route).not.toBeNull();
	expect(route?.side).toBe(1);
});

test("uses a deterministic perpendicular for collinear geometry", () => {
	const a = plan();
	const b = plan();
	expect(a?.side).toBe(b?.side);
	expect(a?.waypoints).toEqual(b?.waypoints);
});

test("finds a moving obstruction in a linear projection without cloning masses", () => {
	const crossing: Mass = {
		id: "crossing",
		pos: v3(0, 500, 0),
		vel: v3(0, -5_000, 0),
		radiusKm: 100,
	};
	expect(cruiseRouteBlocker(from, target, [crossing], null)).toBeNull();
	expect(cruiseRouteBlocker(from, target, [crossing], null, 0.1)?.id).toBe("crossing");
});
