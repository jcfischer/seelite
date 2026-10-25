import { beforeAll, describe, expect, test } from "bun:test";
import {
	RESTING_KM,
	SEPARATION_KM,
	shipPose,
	shipPrimitives,
	sweepShip,
	V_SCRAPE_KMS,
	type Pose,
	type SolidMotion,
} from "../src/collision";
import { HULL_SPECS } from "../src/hull";
import { buildRockPieces, pieceAt, piecesPerFace } from "../src/rock-pieces";
import {
	add,
	cross,
	dot,
	length,
	scale,
	sub,
	v3,
	type Vec3,
} from "../src/vec3";
import { placeBox, separation } from "./fixtures/rock-sweep-956/gjk";
import {
	archetypes,
	DT,
	solid,
	spikePieces,
	unit,
} from "./fixtures/rock-sweep";

const primitives = shipPrimitives(HULL_SPECS.miner, false);
const R = 0.4;

function motion(at: Pose, velocity: Vec3): SolidMotion {
	return {
		primitives,
		start: at,
		end: { ...at, origin: add(at.origin, scale(velocity, DT)) },
		velStart: velocity,
		velEnd: velocity,
	};
}

function query(oracle: ReturnType<typeof spikePieces>, at: Pose) {
	let gap = Infinity;
	const nearby: { piece: number; gap: number; normal: Vec3 }[] = [];
	for (const p of primitives) {
		if (p.kind !== "box") throw new Error("expected box");
		const box = placeBox(
			{
				...p,
				centre: scale(p.centre, 1 / R),
				half: p.half.map((h) => h / R) as [number, number, number],
			},
			{ ...at, origin: scale(at.origin, 1 / R) },
		);
		const visit = (node: (typeof oracle.roots)[number]) => {
			const found = separation(box, node.hull);
			if (!found.overlap && found.distanceKm * R > Math.max(gap, RESTING_KM))
				return;
			if (node.piece < 0) {
				for (const child of node.children) visit(child);
				return;
			}
			if (found.overlap) {
				gap = -Infinity;
				nearby.push({ piece: node.piece, gap: -Infinity, normal: v3() });
			} else {
				gap = Math.min(gap, found.distanceKm * R);
				if (found.distanceKm * R <= RESTING_KM)
					nearby.push({
						piece: node.piece,
						gap: found.distanceKm * R,
						normal: found.normal,
					});
			}
		};
		for (const root of oracle.roots) visit(root);
	}
	return { gap, nearby };
}

function land(rock: ReturnType<typeof solid>, direction: Vec3): Pose {
	const nose = unit(cross(direction, v3(0, 1, 0)));
	const start = shipPose(scale(direction, R * 1.5), nose, direction);
	const result = sweepShip(motion(start, scale(direction, -5)), [rock], DT);
	expect(result.impacts.length).toBeGreaterThan(0);
	return { ...start, origin: result.pos };
}

describe("consecutive rock resting steps (node #961)", () => {
	let corpus: ReturnType<typeof archetypes>;
	beforeAll(() => {
		corpus = archetypes();
	}, 120_000);

	test("1 m/s pressure in a concave two-facet seam keeps both neighbours clear", () => {
		const res = 64;
		const r = new Float32Array(6 * res * res).fill(0.5);
		for (let j = 0; j < res; j++)
			for (let i = 0; i < res; i++) {
				const u = ((i + 0.5) / res) * 2 - 1;
				const v = ((j + 0.5) / res) * 2 - 1;
				r[(4 * res + j) * res + i] = Math.min(
					0.95,
					(0.25 * Math.hypot(u, v, 1)) / Math.max(0.01, 1 - 1.2 * Math.abs(u)),
				);
			}
		const pieces = buildRockPieces({ res, r });
		const rock = solid(pieces, R);
		const oracle = spikePieces(pieces);
		let at = land(rock, v3(0, 0, 1));
		const first = at.origin;
		const contacts = query(oracle, at).nearby;
		expect(
			contacts.some((a) => contacts.some((b) => dot(a.normal, b.normal) < 0)),
		).toBe(true);
		for (let tick = 0; tick < 600; tick++) {
			const result = sweepShip(motion(at, v3(0, 0, -0.001)), [rock], DT);
			at = { ...at, origin: result.pos };
			expect(query(oracle, at).gap, `tick ${tick}`).toBeGreaterThanOrEqual(0);
			expect(length(sub(at.origin, first))).toBeLessThanOrEqual(RESTING_KM);
			for (const impact of result.impacts)
				expect(impact.closingKms).toBeLessThanOrEqual(V_SCRAPE_KMS);
		}
	});

	test("1 m/s pressure on authored archetypes holds every touched piece", () => {
		let multiple = 0;
		for (const [index, pieces] of corpus.rocks.entries()) {
			const rock = solid(pieces, R);
			const oracle = spikePieces(pieces);
			for (const direction of [v3(0, 0, 1), unit(v3(1, 0, 1))]) {
				let at = land(rock, direction);
				const contacts = query(oracle, at).nearby;
				if (contacts.length > 1) multiple++;
				for (let tick = 0; tick < 100; tick++) {
					const result = sweepShip(
						motion(at, scale(direction, -0.001)),
						[rock],
						DT,
					);
					at = { ...at, origin: result.pos };
					expect(
						query(oracle, at).gap,
						`archetype ${index}, tick ${tick}`,
					).toBeGreaterThanOrEqual(0);
					for (const impact of result.impacts)
						expect(impact.closingKms).toBeLessThanOrEqual(V_SCRAPE_KMS);
				}
			}
		}
		expect(multiple).toBeGreaterThan(0);
	}, 120_000);

	test("600 belly-down no-thrust ticks hold separation on every authored archetype", () => {
		for (const [index, pieces] of corpus.rocks.entries()) {
			const rock = solid(pieces, R);
			const oracle = spikePieces(pieces);
			let at = land(rock, v3(0, 0, 1));
			let velocity = v3();
			let settled: Vec3 | undefined;
			const times: number[] = [];
			for (let tick = 0; tick < 600; tick++) {
				const start = performance.now();
				const result = sweepShip(motion(at, velocity), [rock], DT);
				times.push(performance.now() - start);
				at = { ...at, origin: result.pos };
				velocity = result.vel;
				expect(length(velocity)).toBeLessThan(1e-12);
				settled ??= at.origin;
				expect(length(sub(at.origin, settled))).toBeLessThan(1e-8);
				const { gap } = query(oracle, at);
				expect(gap, `archetype ${index}, tick ${tick}`).toBeGreaterThanOrEqual(
					0,
				);
				expect(Math.abs(gap - SEPARATION_KM)).toBeLessThanOrEqual(RESTING_KM);
				expect(result.impacts).toEqual([]);
			}
			times.sort((a, b) => a - b);
			console.log(
				`rock ${index}, R=${R} km, host CPU: resting median ${times[300].toFixed(3)}, p95 ${times[570].toFixed(3)} ms/tick`,
			);
		}
	}, 120_000);

	for (const [name, direction, tangent] of [
		["cell", v3(0, 0, 1), v3(1, 0, 0)],
		["cube-face", unit(v3(1, 0, 1)), unit(v3(1, 0, -1))],
	] as const) {
		test(`1 m/s slide crosses a ${name} seam without overlapping any piece`, () => {
			const pieces = buildRockPieces({
				res: 64,
				r: new Float32Array(6 * 64 * 64).fill(0.8),
			});
			const rock = solid(pieces, R);
			const oracle = spikePieces(pieces);
			let at = land(rock, direction);
			at.origin = sub(at.origin, scale(tangent, 0.004));
			expect(query(oracle, at).gap).toBeGreaterThanOrEqual(0);
			const first = at.origin;
			const touched = new Set<number>();
			for (let tick = 0; tick < 100; tick++) {
				const result = sweepShip(motion(at, scale(tangent, 0.001)), [rock], DT);
				at = { ...at, origin: result.pos };
				const state = query(oracle, at);
				expect(state.gap, `tick ${tick}`).toBeGreaterThanOrEqual(0);
				for (const { piece } of state.nearby) touched.add(piece);
				for (const impact of result.impacts)
					expect(impact.closingKms).toBeLessThanOrEqual(V_SCRAPE_KMS);
			}
			expect(touched.size).toBeGreaterThan(1);
			expect(dot(sub(at.origin, first), tangent)).toBeGreaterThan(0.007);
			const initialPiece = pieceAt(pieces, unit(first));
			const finalPiece = pieceAt(pieces, unit(at.origin));
			expect(finalPiece).not.toBe(initialPiece);
			if (name === "cube-face")
				expect(Math.floor(finalPiece / piecesPerFace(pieces.res))).not.toBe(
					Math.floor(initialPiece / piecesPerFace(pieces.res)),
				);
		}, 30_000);
	}
});
