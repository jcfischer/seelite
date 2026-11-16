import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	dirOf,
	radiusAt,
	type RockHeightfield,
} from "../src/rock-heightfields";
import {
	buildRockPieces,
	envelopeAt,
	type BoundNode,
} from "../src/rock-pieces";
import { dot, v3 } from "../src/vec3";

const field = (): RockHeightfield => ({
	res: 64,
	r: Float32Array.from(
		{ length: 6 * 64 ** 2 },
		(_, k) => 0.7 + 0.06 * Math.sin(k % 64) * Math.cos(Math.floor(k / 64) % 64),
	),
});

describe("rock piece build boundary (node #957)", () => {
	test("a caller may tighten the inflation limit but cannot raise or disable 1.01", () => {
		const h = field();
		for (const limit of [1.010001, 1.1, Infinity, -Infinity, NaN, 0, -1])
			expect(() => buildRockPieces(h, { limit })).toThrow(/inflation limit/i);
		expect(() => buildRockPieces(h, { label: "tight", limit: 1 })).toThrow(
			/Rock pieces for tight: face 0 cell \(0, 0\).*over the limit 1$/,
		);
	});

	test("malformed fields fail before geometry is built and name the bad sample", () => {
		for (const res of [0, -1, 1.5, NaN, Infinity])
			expect(() => buildRockPieces({ res, r: new Float32Array(6) })).toThrow();
		expect(() =>
			buildRockPieces({ res: 64, r: new Float32Array(5) }),
		).toThrow();
		for (const value of [0, -1, NaN, Infinity]) {
			const h = field();
			h.r[100] = value;
			expect(() => buildRockPieces(h)).toThrow(/sample 100/);
		}
	});

	test("off-grid samples and all face edges cover the sampler's selected seam side", () => {
		const h = field();
		const rp = buildRockPieces(h);
		let gap = Infinity;
		const sample = (f: number, u: number, v: number) => {
			const d = dirOf(f, u, v);
			gap = Math.min(gap, envelopeAt(rp, v3(...d)) - radiusAt(h, d));
		};
		for (let f = 0; f < 6; f++) {
			for (let j = 0; j < 257; j++)
				for (let i = 0; i < 257; i++)
					sample(f, ((i + 0.37) / 257) * 2 - 1, ((j + 0.61) / 257) * 2 - 1);
			for (let k = 0; k <= 256; k++) {
				const t = k / 128 - 1;
				for (const [u, v] of [
					[-1, t],
					[1, t],
					[t, -1],
					[t, 1],
				])
					sample(f, u, v);
			}
		}
		expect(gap).toBeGreaterThanOrEqual(0);
	});

	test("internal bound caps are square to their tile's direction", () => {
		const rp = buildRockPieces(field());
		let checked = 0,
			worst = 0;
		const walk = (node: BoundNode) => {
			if (!node.children.length) return;
			const corners = node.hull.v.slice(1);
			const unitFace = corners.map((p) => {
				const major = Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
				return v3(p.x / major, p.y / major, p.z / major);
			});
			const direction = v3(
				(unitFace[0].x + unitFace[2].x) / 2,
				(unitFace[0].y + unitFace[2].y) / 2,
				(unitFace[0].z + unitFace[2].z) / 2,
			);
			const reaches = corners.map((p) => dot(direction, p));
			worst = Math.max(worst, Math.max(...reaches) - Math.min(...reaches));
			checked++;
			for (const child of node.children) walk(child);
		};
		for (const root of rp.roots) walk(root);
		expect(checked).toBeGreaterThan(6);
		expect(worst).toBeLessThan(1e-12);
	});

	test("the module reaches only the headless sampler and vector leaf", () => {
		const source = readFileSync("src/rock-pieces.ts", "utf8");
		expect(
			[...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort(),
		).toEqual(["./rock-heightfields", "./vec3"]);
		expect(source).not.toMatch(/\b(?:require|import)\s*\(/);
	});
});
