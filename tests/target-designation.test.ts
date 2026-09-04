import { expect, test } from "bun:test";
import { type DisplayContact, targetDesignation } from "../src/display-contact";
import type { Body } from "../src/sim";
import { v3 } from "../src/vec3";

const body: Body = {
	id: "target",
	name: "Same name",
	kind: "star",
	pos: v3(),
	radiusKm: 1,
	color: 0,
};
test("the Target panel distinguishes generated kinds and station roles", () => {
	expect(targetDesignation(null)).toBe("");
	for (const kind of ["star", "planet", "moon"] as const)
		expect(targetDesignation({ ...body, kind })).toBe(kind.toUpperCase());
	for (const stationType of [
		"trade",
		"refinery",
		"shipyard",
		"outpost",
	] as const)
		expect(targetDesignation({ ...body, kind: "station", stationType })).toBe(
			`STATION · ${stationType.toUpperCase()}`,
		);
});
test("a ship shows its declared hull type and scanner status without inferring identity from its name", () => {
	const ship: DisplayContact = {
		...body,
		kind: "ship",
		shipType: "freighter",
		velocity: v3(),
		legalStatus: null,
		scannerClass: "unknown",
	};
	expect(targetDesignation(ship)).toBe("SHIP · FREIGHTER · UNKNOWN");
	const hostile: DisplayContact = { ...ship, scannerClass: "hostile" };
	expect(targetDesignation(hostile)).toBe("SHIP · FREIGHTER · HOSTILE");
	expect(targetDesignation({ ...body, kind: "ship" })).toBe("SHIP · UNKNOWN");
});
