/**
 * Node #818: a ship in a shipyard reads the yard's baked work lights off a
 * probe grid (`src/ship-work-light.ts`), decoded from the float16 file the
 * export writes (`decodeProbeGrid`, `src/shipyard-flight.ts`).
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { type ProbeGrid, sampleProbeGrid } from "../src/ship-work-light";
import { decodeProbeGrid } from "../src/shipyard-flight";

/** A 2 x 2 x 2 grid whose every value is its point's index along x + 10 y + 100 z. */
function grid(): ProbeGrid {
	const data = new Float32Array(8 * 12);
	for (let k = 0; k < 2; k++)
		for (let j = 0; j < 2; j++)
			for (let i = 0; i < 2; i++)
				data.fill(
					i + 10 * j + 100 * k,
					((k * 2 + j) * 2 + i) * 12,
					((k * 2 + j) * 2 + i + 1) * 12,
				);
	return {
		origin: new THREE.Vector3(-50, 0, 0),
		step: 50,
		size: [2, 2, 2],
		data,
	};
}

describe("node #818: the work-light probe grid", () => {
	test("a point is blended from the eight around it", () => {
		const out = new Float32Array(12);
		expect(sampleProbeGrid(grid(), new THREE.Vector3(-25, 25, 25), out)).toBe(
			true,
		);
		expect(out[0]).toBeCloseTo(0.5 + 5 + 50, 6);
		expect(sampleProbeGrid(grid(), new THREE.Vector3(0, 50, 50), out)).toBe(
			true,
		);
		expect(out[11]).toBeCloseTo(1 + 10 + 100, 6);
	});

	test("a point outside the grid reads nothing", () => {
		const out = new Float32Array(12);
		expect(sampleProbeGrid(grid(), new THREE.Vector3(-51, 25, 25), out)).toBe(
			false,
		);
		expect(sampleProbeGrid(grid(), new THREE.Vector3(-25, 25, 51), out)).toBe(
			false,
		);
	});

	test("the file decodes against the export's figures, and a short one refuses", () => {
		const template = new THREE.Object3D();
		template.userData.work_light_probes = JSON.stringify({
			origin: [1, 2, 3],
			size: [1, 1, 2],
			step: 50,
			scale: 4,
		});
		const half = new Uint16Array(24).map((_, n) =>
			THREE.DataUtils.toHalfFloat(n / 8),
		);
		const decoded = decodeProbeGrid(template, half.buffer);
		expect(decoded?.origin.toArray()).toEqual([1, 2, 3]);
		expect(decoded?.data[8]).toBeCloseTo(4, 3);
		expect(decoded?.data[23]).toBeCloseTo((23 / 8) * 4, 2);
		expect(decodeProbeGrid(template, half.slice(0, 12).buffer)).toBeNull();
		expect(decodeProbeGrid(new THREE.Object3D(), half.buffer)).toBeNull();
	});
});
