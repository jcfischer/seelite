import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	decodeRockHeightfields,
	dirOf,
	faceUV,
	radiusAt,
	assertRockSource,
} from "../src/rock-heightfields";
import {
	generateRockHeightfields,
	loadRockArchetypes,
	measureRockFit,
	fitRockHeightfield,
} from "../scripts/lib/rock-heightfields";

const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const sourceHash =
	"0622d06b78601aae32b7d6f414d0c1eebfb29e2a79a200e370529008f084cd1c";
const bytes = () => readFileSync("src/models/rock-heightfields.bin");

describe("shipped rock heightfields (node #966)", () => {
	test("16 × 6 × 64² uint16 fractions and source SHA-256 decode from disk", () => {
		const file = bytes();
		const decoded = decodeRockHeightfields(file);
		expect(file.byteLength).toBe(48 + 16 * 6 * 64 * 64 * 2);
		expect(decoded.sourceSha256).toBe(sourceHash);
		expect(decoded.fields.length).toBe(16);
		for (const h of decoded.fields) {
			expect(h.res).toBe(64);
			expect(h.r.length).toBe(6 * 64 * 64);
			for (const r of h.r) {
				expect(r).toBeGreaterThan(0);
				expect(r).toBeLessThanOrEqual(1);
			}
		}
	});

	test("a changed GLB fails naming both actual and recorded hashes", () => {
		const decoded = decodeRockHeightfields(bytes());
		const glb = readFileSync("src/models/asteroids.glb");
		assertRockSource(decoded, sha(glb));
		expect(sha(glb)).toBe(sourceHash);
		const changed = Buffer.from(glb);
		changed[changed.length - 1] ^= 1;
		const actual = sha(changed);
		expect(() => assertRockSource(decoded, actual)).toThrow(
			`Rock heightfield source mismatch: recorded ${sourceHash}, actual ${actual}`,
		);
	});

	test("rejects malformed, truncated, trailing and zero-radius data", () => {
		const original = bytes();
		for (const length of [0, 20, original.length - 1, original.length + 1]) {
			const bad = Buffer.alloc(length);
			original.copy(bad);
			expect(() => decodeRockHeightfields(bad)).toThrow();
		}
		for (const offset of [0, 4, 6, 8, 10, 12, 48]) {
			const bad = Buffer.from(original);
			bad[offset] ^= 255;
			if (offset === 48) bad.writeUInt16LE(0, offset);
			expect(() => decodeRockHeightfields(bad)).toThrow();
		}
		const padded = Buffer.concat([Buffer.alloc(3), original]);
		expect(decodeRockHeightfields(padded.subarray(3)).sourceSha256).toBe(
			sourceHash,
		);
	});

	test("cube face order, texel centres and bilinear interpolation agree", () => {
		for (let face = 0; face < 6; face++) {
			for (const u of [-0.9, 0, 0.7])
				for (const v of [-0.8, 0, 0.9]) {
					const [f, uu, vv] = faceUV(dirOf(face, u, v));
					expect(f).toBe(face);
					expect(uu).toBeCloseTo(u, 12);
					expect(vv).toBeCloseTo(v, 12);
				}
		}
		const h = {
			res: 2,
			r: Float32Array.from({ length: 24 }, (_, i) => (i + 1) / 32),
		};
		expect(radiusAt(h, [1, 0, 0])).toBe(2.5 / 32);
		expect(radiusAt(h, dirOf(4, -0.5, -0.5))).toBe(17 / 32);
	});

	test("generator reproduces the shipped bytes using every drawn level", async () => {
		const rocks = await loadRockArchetypes();
		expect(rocks.length).toBe(16);
		for (const rock of rocks) expect(rock.levels.length).toBe(3);
		expect(await generateRockHeightfields()).toEqual(bytes());
	}, 300_000);

	test("each drawn LOD can independently supply the outermost surface", () => {
		const octahedron = (radius: number) => {
			const triangles: number[] = [];
			for (const x of [-1, 1])
				for (const y of [-1, 1])
					for (const z of [-1, 1])
						triangles.push(
							x * radius,
							0,
							0,
							0,
							y * radius,
							0,
							0,
							0,
							z * radius,
						);
			return new Float32Array(triangles);
		};
		const small = octahedron(0.3),
			large = octahedron(0.9);
		const reference = fitRockHeightfield({
			index: 0,
			name: "fixture",
			levels: [large, large, large],
		});
		for (let level = 0; level < 3; level++) {
			const levels = [small, small, small];
			levels[level] = large;
			expect(fitRockHeightfield({ index: 0, name: "fixture", levels })).toEqual(
				reference,
			);
		}
	});

	test("decoded uint16 fields meet the selected spike's Euclidean budgets per archetype", async () => {
		const rocks = await loadRockArchetypes();
		const { fields } = decodeRockHeightfields(bytes());
		for (const rock of rocks) {
			const fit = measureRockFit(rock, fields[rock.index]);
			console.log(`${rock.name}: ${JSON.stringify(fit)}`);
			expect(fit.emptyMax, rock.name).toBeLessThanOrEqual(0.0301);
			expect(fit.outsideP99, rock.name).toBeLessThanOrEqual(0.02);
			expect(Number.isFinite(fit.outsideMax)).toBe(true);
		}
	}, 300_000);
});
