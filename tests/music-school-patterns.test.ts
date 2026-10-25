import { describe, expect, test } from "bun:test";
import {
	ANCHORS,
	CANOPIES,
	DRIVE_SHAPES,
	earOf,
	evolution,
	mutate,
} from "../src/music-school-patterns";
import { seededRand } from "../src/rng";

describe("an evolving pattern", () => {
	test("a change keeps the pattern's length, so its walk across the bar holds", () => {
		const rand = seededRand(7);
		for (const p of [...ANCHORS, ...CANOPIES])
			for (let i = 0; i < 50; i++)
				expect(mutate(p.steps, rand, earOf(p)).length).toBe(p.steps.length);
	});

	test("every fourth version is the pattern itself, the ones between it changed", () => {
		const p = CANOPIES[0];
		const v = evolution(p.steps, seededRand(3), earOf(p), 12);
		expect(v[0]).toEqual([...p.steps]);
		expect(v[4]).toEqual([...p.steps]);
		expect(v[8]).toEqual([...p.steps]);
		const changed = [1, 2, 3, 5, 6, 7].filter(
			(k) => JSON.stringify(v[k]) !== JSON.stringify(p.steps),
		);
		expect(changed.length).toBeGreaterThanOrEqual(4);
	});

	test("the drive keeps to its own and the minor chord tones as it changes", () => {
		const pc = (d: number) => ((d % 12) + 12) % 12;
		const ladder = [-2, 0, 3, 7, 10, 12, 15, 19, 22, 24];
		const rand = seededRand(11);
		for (const shape of DRIVE_SHAPES) {
			const allowed = new Set([...ladder, ...shape].map(pc));
			for (const version of evolution(shape, rand, { octave: 12, ladder }, 16))
				for (const d of version)
					expect(allowed.has(pc(d as number))).toBe(true);
		}
	});
});
