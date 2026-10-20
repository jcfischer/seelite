import { expect, test } from "bun:test";
import { modularPlacements } from "../src/station-modular";
import { jointForSeed } from "../spikes/stations/assembly-kit/joints";

test("four spike seeds frame distinct real neighbour joints", () => {
	const kinds = [0, 1, 47, 1234].map((seed) => {
		const joint = jointForSeed(seed);
		const { placements } = modularPlacements(seed);
		for (const cell of [joint.a, joint.b])
			expect(placements).toContainEqual(cell);
		expect(
			Math.abs(joint.a.dx - joint.b.dx) + Math.abs(joint.a.dy - joint.b.dy),
		).toBe(1);
		expect(joint.a.beside[joint.direction]).toBe(joint.b.module);
		return joint.kind;
	});
	expect(kinds).toEqual([
		"NODE–TUBE_X",
		"HUB–TUBE_X",
		"NODE–TRUSS_Y",
		"NODE–TUBE_Y",
	]);
});

test("joint selection refuses an unplanned capture seed", () => {
	expect(() => jointForSeed(99)).toThrow("No joint fixture");
});
