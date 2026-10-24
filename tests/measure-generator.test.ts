import { describe, expect, test } from "bun:test";
import { measureGenerator } from "../scripts/lib/measure-generator";

describe("generator step timing", () => {
	for (const durations of [
		[1, 80, 3],
		[80, 1, 3],
		[1, 3, 80],
	]) {
		test(`includes every yielded step: ${durations.join(",")}`, () => {
			let now = 0;
			const result = { name: "model" };
			function* work() {
				for (const duration of durations) {
					now += duration;
					yield;
				}
				return result;
			}
			expect(measureGenerator(work(), () => now)).toEqual({
				value: result,
				steps: 3,
				worstStepMs: 80,
				ms: 84,
			});
		});
	}

	test("includes work done by the completing next call", () => {
		let now = 0;
		function* work() {
			now += 1;
			yield;
			now += 80;
			return "model";
		}
		expect(measureGenerator(work(), () => now)).toEqual({
			value: "model",
			steps: 1,
			worstStepMs: 80,
			ms: 81,
		});
	});

	test("measures a generator that completes without yielding", () => {
		let now = 0;
		function* work() {
			now += 3;
			return "model";
		}
		expect(measureGenerator(work(), () => now)).toEqual({
			value: "model",
			steps: 0,
			worstStepMs: 3,
			ms: 3,
		});
	});
});
