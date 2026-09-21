import { expect, test } from "bun:test";
import {
	cockpitView,
	MIN_CONTACT_RADIUS,
	projectScannerContacts,
} from "../src/cockpit";
import { v3 } from "../src/vec3";

test("the local scanner projects nearby live bodies with vertical separation", () => {
	const contacts = projectScannerContacts(
		v3(),
		[
			{ id: "station", pos: v3(5_000, 2_500, -2_500) },
			{ id: "planet", pos: v3(-2_500, -1_000, 5_000) },
			{ id: "far", pos: v3(10_001, 0, 0) },
		],
		"station",
	);

	expect(contacts.map((contact) => contact.id)).toEqual(["station", "planet"]);
	expect(contacts[0].selected).toBe(true);
	expect(contacts[0].tipOffsetPx).toBeGreaterThan(0);
	expect(contacts[1].tipOffsetPx).toBeLessThan(0);
	expect(contacts[0].baseXPercent).toBeGreaterThan(50);
	expect(contacts[1].baseXPercent).toBeLessThan(50);
	expect(contacts[0].baseYPercent).toBeLessThan(50);
	expect(contacts[1].baseYPercent).toBeGreaterThan(50);
});

test("only a head turn exposes a readable console", () => {
	expect(cockpitView("forward")).toEqual({
		activePanel: null,
		targetDirectorVisible: false,
	});
	expect(cockpitView("left").activePanel).toBe("left");
	expect(cockpitView("right").activePanel).toBe("right");
});

test("scanner contacts move in ship-local coordinates as the ship turns", () => {
	const contacts = projectScannerContacts(
		v3(),
		[{ id: "ahead", pos: v3(0, 0, -5_000) }],
		"ahead",
		{ orientation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } },
	);
	expect(contacts).toHaveLength(1);
	// A world-forward contact is off the starboard side after a 90 degree yaw.
	expect(contacts[0].baseXPercent).toBeGreaterThan(50);
});

test("a close contact visibly off the port bow does not collapse into radar centre", () => {
	const [contact] = projectScannerContacts(
		v3(),
		[{ id: "port-bow", pos: v3(-1_000, 0, -1_000) }],
		"port-bow",
	);

	// 1,414 km is only 14% of the scanner radius. A linear map puts this at
	// 45.8%, which reads as dead-centre despite its 45° port bearing. The
	// scanner expands the near field so the same literal bearing reads clearly
	// left while keeping the 10,000-km perimeter fixed.
	expect(contact.baseXPercent).toBeCloseTo(38.83, 1);
	expect(contact.baseYPercent).toBeCloseTo(41.76, 1);
});

test("the radar draws the contact at the signed vertical tip, not its disk intersection", () => {
	const contacts = projectScannerContacts(
		v3(),
		[
			{ id: "above", pos: v3(0, 1_000, -1_000) },
			{ id: "below", pos: v3(0, -1_000, -1_000) },
		],
		"above",
	);

	// In the scanner's oblique display, an object overhead sits toward the
	// lower/near edge; the line's anchor remains the range-bearing intersection.
	expect(contacts[0].tipOffsetPx).toBeGreaterThan(0);
	expect(contacts[1].tipOffsetPx).toBeLessThan(0);
});

test("a station astern stays on the lower half of the ship-local scanner", () => {
	const [contact] = projectScannerContacts(
		v3(),
		[{ id: "astern", pos: v3(0, 0, 2_500) }],
		"astern",
	);

	// +Z is behind Three.js's -Z-forward camera. On the physical oblique plate,
	// the astern bearing belongs in the lower/far half, not off the scanner.
	expect(contact.baseXPercent).toBeCloseTo(50, 1);
	expect(contact.baseYPercent).toBeGreaterThan(50);
	expect(contact.baseYPercent).toBeLessThanOrEqual(82);
});

/**
 * The floor is the extra contacts' and nobody else's.
 *
 * It shipped as a bare `Math.max(0.14, …)` inside the shared loop, which lifted
 * **every** body within 196 km onto the same ring — a production HUD change
 * riding in on a prototype's scanner entry, and one that contradicts the
 * comment above it about the curve spending the plate on the near field.
 *
 * Both arms at one range, so the assertion is about the *rule* and not about
 * two positions that happen to differ.
 */
test("the minimum contact radius applies to extra contacts only", () => {
	// Off both plate axes, so a bearing survives the comparison below.
	const near = v3(3, 0, 4);
	const [world] = projectScannerContacts(
		v3(),
		[{ id: "rock", pos: near }],
		null,
	);
	const [extra] = projectScannerContacts(v3(), [], null, {
		flooredContacts: [{ id: "striker", pos: near }],
	});
	// `baseXPercent` is `50 + planarX * 42` and `baseYPercent` `50 + planarZ * 31`,
	// so the plate fraction comes back out by undoing those rather than by
	// restating the projection.
	const plateX = (c: { baseXPercent: number }) => (c.baseXPercent - 50) / 42;
	const plateY = (c: { baseYPercent: number }) => (c.baseYPercent - 50) / 31;
	const unfloored = Math.sqrt(5 / 10_000);
	expect(unfloored).toBeLessThan(MIN_CONTACT_RADIUS);
	// The world body keeps the curve — 0.022 of the plate, inside the ship's own
	// marker, which is the price of not lying about its range.
	expect(Math.hypot(plateX(world), plateY(world))).toBeCloseTo(unfloored, 6);
	// The striker is lifted onto the floor, and its bearing is unchanged.
	expect(Math.hypot(plateX(extra), plateY(extra))).toBeCloseTo(
		MIN_CONTACT_RADIUS,
		6,
	);
	expect(Math.atan2(plateY(extra), plateX(extra))).toBeCloseTo(
		Math.atan2(plateY(world), plateX(world)),
		9,
	);
});
