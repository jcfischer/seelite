import { expect, test, spyOn } from "bun:test";
import * as featureModule from "../src/airless-features";
import {
	airlessFeatures,
	smallCrater,
	selectBasins,
} from "../src/airless-features";
import { AIRLESS } from "../src/planet-classes.glsl";
import { AIRLESS as BEFORE } from "../scripts/lib/fixtures/airless-before-213";
import {
	bakeFragmentFor,
	bakedFragmentFor,
	NOISE_GLSL,
} from "../src/planet-shaders";
import { VIEWS } from "../scripts/lib/view-set.mjs";
import * as THREE from "three";
import { appearanceFor, planetSeedOffset } from "../src/planet-appearance";
import { buildBodyVisual } from "../src/planet-surface";

test("shell pruning preserves the existing selected fine-field cells", () => {
	const expected: { seed: number; cells: [number, number, number][] }[] = [
		{
			seed: 0,
			cells: [
				[-9, 0, -1],
				[5, -6, 1],
			],
		},
		{
			seed: 1,
			cells: [
				[7, 2, 2],
				[6, 0, 5],
				[-6, 5, -2],
			],
		},
		{
			seed: 47,
			cells: [
				[5, 1, 0],
				[11, 11, 2],
			],
		},
		{
			seed: 48,
			cells: [
				[-1, 5, 9],
				[2, 1, 2],
			],
		},
		{
			seed: 179,
			cells: [
				[32, 21, 23],
				[26, 29, 18],
			],
		},
		{
			seed: 0xffffffff,
			cells: [
				[141, 139, 133],
				[138, 131, 128],
			],
		},
	];
	for (const { seed, cells } of expected)
		expect(airlessFeatures(seed).rayCells).toEqual(cells);
});

test("basin placement refuses an exhausted work budget", () => {
	// All pairs fit, but no triple does: backtracking must hit the budget,
	// rather than traverse the combinatorial candidate menu.
	const candidates: [number, number, number, number][] = Array.from(
		{ length: 200 },
		(_, i) => [i % 2 ? -1 : 1, 0, 0, 0.7],
	);
	expect(selectBasins(candidates, 4, 100)).toBeNull();
	expect(selectBasins([], 2)).toBeNull();
	expect(selectBasins(candidates, 2, 100)).toHaveLength(2);
});

test("exhausted sparse populations leave a drawable body and report the seed", () => {
	const look = appearanceFor("moon", "planet-5-moon-0", 3);
	const exhausted = airlessFeatures(look.seed, 1);
	expect(exhausted).toEqual({ basins: [], rayCells: [], exhausted: "basins" });
	const generator = spyOn(featureModule, "airlessFeatures").mockReturnValue(
		exhausted,
	);
	const warning = spyOn(console, "warn").mockImplementation(() => {});
	const geometry = new THREE.SphereGeometry(1, 8, 6);
	try {
		const visual = buildBodyVisual(look, geometry);
		try {
			expect(visual.uniforms.basinCount.value).toBe(0);
			expect(visual.uniforms.rayCount.value).toBe(0);
			expect(visual.surfaceMesh.material).toBeDefined();
			expect(warning).toHaveBeenCalledWith(
				`airless seed ${look.seed}: basins selection exhausted; retained crater terrain`,
			);
		} finally {
			visual.dispose();
		}
	} finally {
		geometry.dispose();
		generator.mockRestore();
		warning.mockRestore();
	}
});

test("4096-seed corpus completes within the population search cap", () => {
	// Include the first 2048 seeds, then a uint32-stratified half. These are
	// reproducible corpus evidence, not a proof over all 2^32 possible seeds.
	const seeds = [
		...Array.from({ length: 2048 }, (_, i) => i),
		...Array.from({ length: 2048 }, (_, i) => i * 0x20_0000 + 0x1f_ffff),
	];
	expect(new Set(seeds).size).toBe(4096);
	const buckets = new Set<number>();
	for (const seed of seeds) {
		const features = airlessFeatures(seed);
		expect(features.exhausted, `seed ${seed}`).toBeNull();
		expect(features.basins.length).toBeGreaterThanOrEqual(2);
		expect(features.basins.length).toBeLessThanOrEqual(4);
		expect(features.rayCells.length).toBeGreaterThanOrEqual(2);
		expect(features.rayCells.length).toBeLessThanOrEqual(3);
		buckets.add(features.basins.length);
	}
	expect([...buckets].sort()).toEqual([2, 3, 4]);
}, 120_000);

test("basin rim squares its signed distance without GLSL negative-base pow", () => {
	const floor = AIRLESS.slice(
		AIRLESS.indexOf("float basinFloor("),
		AIRLESS.indexOf("float airlessRays("),
	);
	expect(floor).not.toContain("pow(");
	expect(floor).toContain("exp(-k * k)");
});

test("CPU crater selector's hash port tracks the GLSL body", () => {
	expect(NOISE_GLSL).toContain(`float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}`);
});

test("airless populations are bounded, separated, and repeatable across seeds", () => {
	const counts = new Set<number>();
	for (const seed of [
		...Array.from({ length: 80 }, (_, i) => i),
		0xffffffff,
		0xdeadbeef,
		589011,
	]) {
		const f = airlessFeatures(seed);
		expect(airlessFeatures(seed)).toEqual(f);
		counts.add(f.basins.length);
		expect(f.basins.length).toBeGreaterThanOrEqual(2);
		expect(f.basins.length).toBeLessThanOrEqual(4);
		expect(f.rayCells.length).toBeGreaterThanOrEqual(2);
		expect(f.rayCells.length).toBeLessThanOrEqual(3);
		for (const [i, basin] of f.basins.entries()) {
			expect(Math.hypot(...basin.slice(0, 3))).toBeCloseTo(1, 6);
			expect(basin[3]).toBeGreaterThanOrEqual(0.7);
			expect(basin[3]).toBeLessThanOrEqual(0.8);
			for (const other of f.basins.slice(i + 1))
				expect(
					Math.hypot(...basin.slice(0, 3).map((v, j) => v - other[j])),
				).toBeGreaterThan(basin[3] + other[3]);
		}
		for (const cell of f.rayCells) {
			const crater = smallCrater(cell, planetSeedOffset(seed));
			// Rays belong to an existing fine-octave crater intersecting the surface,
			// never a randomly chosen point with no crater beneath it.
			expect(Math.abs(Math.hypot(...crater.centre) - 1)).toBeLessThan(
				crater.radius * 0.3,
			);
			expect(crater.radius).toBeLessThan(0.063);
			const n = Math.hypot(...crater.centre);
			for (const basin of f.basins)
				expect(
					Math.hypot(...crater.centre.map((v, i) => v / n - basin[i])),
				).toBeGreaterThan(basin[3] + crater.radius);
		}
	}
	expect([...counts].sort()).toEqual([2, 3, 4]);
	expect(airlessFeatures(47).basins).not.toEqual(airlessFeatures(48).basins);
});

test("the generated moon supplies its sparse features to the shared surface/bake uniforms", () => {
	const look = appearanceFor("moon", "planet-5-moon-0", 3);
	const geometry = new THREE.SphereGeometry(1, 8, 6);
	const visual = buildBodyVisual(look, geometry);
	try {
		const expected = airlessFeatures(look.seed);
		expect(visual.uniforms.basinCount.value).toBe(expected.basins.length);
		expect(visual.uniforms.rayCount.value).toBe(expected.rayCells.length);
		expect(visual.uniforms.seedOffset.value).toBe(planetSeedOffset(look.seed));
		for (const [i, basin] of expected.basins.entries())
			expect(visual.uniforms.basins.value[i].toArray()).toEqual(basin);
		for (const [i, cell] of expected.rayCells.entries())
			expect(visual.uniforms.rayCells.value[i].toArray()).toEqual(cell);
	} finally {
		visual.dispose();
		geometry.dispose();
	}
});

test("airless keeps two height octaves; sparse terms reach the bake only", () => {
	const height = AIRLESS.slice(
		AIRLESS.indexOf("float height("),
		AIRLESS.indexOf("\n}", AIRLESS.indexOf("float height(")),
	);
	expect(height.match(/craters\(/g)?.length).toBe(2);
	const walkEnd = (s: string) =>
		s.indexOf("\n}", s.indexOf("vec3 craterRelief(")) + 2;
	const walk = AIRLESS.slice(
		AIRLESS.indexOf("vec3 craterRelief("),
		walkEnd(AIRLESS),
	);
	expect(walk.match(/cratersAndGradient\(/g)?.length).toBe(2);
	expect(walk).toBe(
		BEFORE.slice(BEFORE.indexOf("vec3 craterRelief("), walkEnd(BEFORE)),
	);
	expect(bakeFragmentFor("airless", "albedo")).toContain("airlessRays(p)");
	expect(bakeFragmentFor("airless", "normal")).toContain("basinFloor(p,");
	expect(bakedFragmentFor("airless")).not.toContain("airlessRays");
});

test("node 213 has a canonical view of a generated airless body", () => {
	const views = VIEWS.filter((v) => v.covers.includes(213));
	expect(views.length).toBeGreaterThan(0);
	for (const v of views) {
		expect(v.shot.kind).toBe("body-offset");
		expect(v.shot.body).toContain("moon");
		expect(v.what).toContain("basin");
	}
});
