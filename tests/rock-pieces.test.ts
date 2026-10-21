import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	assertRockSource,
	decodeRockHeightfields,
	dirOf,
	radiusAt,
	type RockHeightfield,
} from "../src/rock-heightfields";
import {
	type BoundNode,
	buildRockPieces,
	type ConvexHull,
	envelopeAt,
	INFLATION_LIMIT,
	pieceIndex,
	piecesPerFace,
	type RockPieces,
} from "../src/rock-pieces";
import { cross, dot, sub, type Vec3, v3 } from "../src/vec3";
import { loadRockArchetypes } from "../scripts/lib/rock-heightfields";
import { measurePiecesFit } from "../scripts/lib/rock-pieces-fit";

const texel = (res: number, f: number, i: number, j: number) =>
	(f * res + j) * res + i;
const sphere = (res: number, r: number): RockHeightfield => ({
	res,
	r: new Float32Array(6 * res * res).fill(r),
});

function ridge(res: number, base: number, top: number): RockHeightfield {
	const h = sphere(res, base);
	for (let j = 0; j < res; j++) h.r[texel(res, 4, res / 2, j)] = top;
	return h;
}

function needle(res: number, base: number, top: number): RockHeightfield {
	const h = sphere(res, base);
	h.r[texel(res, 4, res - 1, res / 2)] = top;
	return h;
}

function envelopeExcess(rp: RockPieces, h: RockHeightfield, s: number) {
	let under = Infinity,
		over = -Infinity;
	for (let f = 0; f < 6; f++)
		for (let j = 0; j < s; j++)
			for (let i = 0; i < s; i++) {
				const d = dirOf(f, ((i + 0.5) / s) * 2 - 1, ((j + 0.5) / s) * 2 - 1);
				const e = envelopeAt(rp, v3(...d)) - radiusAt(h, d);
				under = Math.min(under, e);
				over = Math.max(over, e);
			}
	return { under, over };
}

function planesOf(hull: ConvexHull): { n: Vec3; k: number }[] {
	const V = hull.v.slice(1);
	const orient = (n: Vec3, k: number) =>
		dot(n, hull.c) > k ? { n: v3(-n.x, -n.y, -n.z), k: -k } : { n, k };
	const planes = V.map((a, i) => orient(cross(a, V[(i + 1) % 4]), 0));
	const cap = cross(sub(V[1], V[0]), sub(V[2], V[0]));
	planes.push(orient(cap, dot(cap, V[0])));
	return planes;
}

function worstOutside(node: BoundNode): number {
	if (!node.children.length) return 0;
	const planes = planesOf(node.hull);
	let worst = 0;
	const visit = (n: BoundNode) => {
		for (const p of n.hull.v)
			for (const { n: nn, k } of planes)
				worst = Math.max(
					worst,
					(dot(nn, p) - k) / Math.hypot(nn.x, nn.y, nn.z),
				);
		for (const ch of n.children) visit(ch);
	};
	for (const ch of node.children) visit(ch);
	for (const ch of node.children) worst = Math.max(worst, worstOutside(ch));
	return worst;
}
function leaves(node: BoundNode, out: number[] = []): number[] {
	if (!node.children.length) out.push(node.piece);
	for (const ch of node.children) leaves(ch, out);
	return out;
}

describe("rock cone pieces from a radial heightfield (node #957)", () => {
	const fields = [
		["sphere", sphere(64, 0.8)],
		["ridge", ridge(64, 0.5, 0.52)],
		["needle", needle(64, 0.5, 0.52)],
	] as const;
	const built = fields.map(
		([name, h]) => [name, h, buildRockPieces(h)] as const,
	);

	test("a 64-texel field builds 6 × 65² pieces of 5 vertices, origin first", () => {
		for (const [, , rp] of built) {
			expect(piecesPerFace(64)).toBe(65 ** 2);
			expect(rp.pieces.length).toBe(6 * 65 ** 2);
			expect(rp.inflate.length).toBe(6 * 65 ** 2);
			for (const p of rp.pieces) {
				expect(p.v.length).toBe(5);
				expect(p.v[0]).toEqual(v3());
			}
		}
	});

	test("the envelope is never below the bilinear field on a dense direction sample", () => {
		for (const [name, h, rp] of built) {
			const { under, over } = envelopeExcess(rp, h, 200);
			console.log(
				`${name}: envelope − field min ${under.toExponential(2)}, max ${over.toExponential(2)} R`,
			);
			expect(under, name).toBeGreaterThanOrEqual(0);

			expect(over, name).toBeLessThan(0.02);
		}
	});

	test("every quadtree bound holds every vertex of every piece below it, and the leaves are each piece once", () => {
		for (const [name, , rp] of built) {
			expect(rp.roots.length).toBe(6);
			const all = rp.roots
				.flatMap((root) => leaves(root))
				.sort((a, b) => a - b);
			expect(all).toEqual(
				Array.from({ length: rp.pieces.length }, (_, k) => k),
			);
			for (const [f, root] of rp.roots.entries()) {
				expect(root.hull.v.length).toBe(5);
				expect(leaves(root)[0]).toBe(pieceIndex(64, f, 0, 0));
				expect(worstOutside(root), `${name} face ${f}`).toBeLessThanOrEqual(
					1e-12,
				);
			}
		}
	});

	test("a cell needing more than the limit fails the build, naming the cell", () => {
		expect(() => buildRockPieces(sphere(4, 0.8), { label: "coarse" })).toThrow(
			/^Rock pieces for coarse: face 0 cell \(1, 0\) needs inflation 1\.0148\d+, over the limit 1\.01$/,
		);

		expect(() => buildRockPieces(ridge(64, 0.5, 0.9))).toThrow(
			/^Rock pieces: face 4 cell \(32, 0\) needs inflation 1\.08\d+, over the limit 1\.01$/,
		);
		expect(INFLATION_LIMIT).toBe(1.01);
		expect(() => buildRockPieces(ridge(64, 0.5, 0.9), { limit: 1.1 })).toThrow(
			/inflation limit/,
		);
	});

	test("#953's GLB-hash-keyed archetypes: inflation ≤ 1.01, envelope holds, corpus empty-space maximum matches the field at 1e-4 R precision", async () => {
		const decoded = decodeRockHeightfields(
			readFileSync("src/models/rock-heightfields.bin"),
		);
		assertRockSource(
			decoded,
			createHash("sha256")
				.update(readFileSync("src/models/asteroids.glb"))
				.digest("hex"),
		);
		const rocks = await loadRockArchetypes();
		let fieldMax = 0,
			piecesMax = 0,
			peakMax = 0,
			inflationMax = 0;
		for (const rock of rocks) {
			const h = decoded.fields[rock.index];
			const rp = buildRockPieces(h, { label: rock.name });
			const inflation = Math.max(...rp.inflate);
			expect(inflation, rock.name).toBeLessThanOrEqual(INFLATION_LIMIT);
			expect(
				envelopeExcess(rp, h, 100).under,
				rock.name,
			).toBeGreaterThanOrEqual(0);
			const fit = measurePiecesFit(rock, h, rp);
			console.log(
				`${rock.name}: inflation ${inflation.toFixed(4)}, field ${fit.field.max.toFixed(4)} p99 ${fit.field.p99.toFixed(4)} | pieces ${fit.pieces.max.toFixed(4)} p99 ${fit.pieces.p99.toFixed(4)} | peaks ${fit.peak.toFixed(4)}`,
			);
			fieldMax = Math.max(fieldMax, fit.field.max);
			piecesMax = Math.max(piecesMax, fit.pieces.max);
			peakMax = Math.max(peakMax, fit.peak);
			inflationMax = Math.max(inflationMax, inflation);
		}
		console.log(
			`set: inflation max ${inflationMax.toFixed(4)}; colliding empty space field ${fieldMax.toFixed(4)}, pieces ${piecesMax.toFixed(4)}, at peaks ${peakMax.toFixed(4)} R`,
		);

		const atMeasurementPrecision = (x: number) => Math.round(x * 1e4);
		expect(atMeasurementPrecision(piecesMax)).toBeLessThanOrEqual(
			atMeasurementPrecision(fieldMax),
		);
		expect(piecesMax - fieldMax).toBeLessThan(5e-5);
		expect(peakMax).toBeLessThanOrEqual(fieldMax);
		expect(atMeasurementPrecision(fieldMax)).toBeLessThanOrEqual(301);
	}, 600_000);
});
