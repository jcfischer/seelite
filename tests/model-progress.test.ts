/**
 * #833's progress bar: received bytes over total bytes across the models a
 * boot needs, read from `GLTFLoader`'s `onProgress`. The DOM that draws it is
 * `probe-model-download`'s; the arithmetic is here.
 */

import { describe, expect, test } from "bun:test";
import { ModelProgress } from "../src/model-progress";

describe("ModelProgress", () => {
	test("bytes over bytes, summed across every model", () => {
		const p = new ModelProgress(["station", "cockpit"]);
		p.report("station", 100, 400);
		p.report("cockpit", 50, 100);
		expect(p.fraction()).toBeCloseTo(150 / 500, 10);
	});

	test("unknown until every model has a total, so the bar cannot run backwards", () => {
		const p = new ModelProgress(["station", "cockpit"]);
		expect(p.fraction()).toBeNull();
		p.report("cockpit", 90, 100);
		expect(p.fraction()).toBeNull();
		p.report("station", 0, 0);
		expect(p.fraction()).toBeNull();
	});

	test("never falls within one attempt", () => {
		const p = new ModelProgress(["a", "b"]);
		p.report("a", 50, 100);
		p.report("b", 50, 100);
		expect(p.fraction()).toBeCloseTo(0.5, 10);
		// A total that grows (a second response for the same model) would drop it.
		p.report("b", 50, 300);
		expect(p.fraction()).toBeCloseTo(0.5, 10);
	});

	test("a model that ends with no progress event counts as received", () => {
		const p = new ModelProgress(["station", "cockpit"]);
		p.report("cockpit", 20, 100);
		p.complete("station");
		expect(p.fraction()).toBeCloseTo(0.2, 10);
		p.complete("cockpit");
		expect(p.fraction()).toBe(1);
	});

	test("received bytes past the total (a compressed body) count as the total", () => {
		const p = new ModelProgress(["a"]);
		p.report("a", 250, 100);
		expect(p.fraction()).toBeLessThan(1);
		p.complete("a");
		expect(p.fraction()).toBe(1);
	});

	test("only every model complete reads 100%", () => {
		const p = new ModelProgress(["a", "b"]);
		p.report("a", 100, 100);
		p.report("b", 100, 100);
		expect(p.fraction()).toBeLessThan(1);
		p.complete("a");
		p.complete("b");
		expect(p.fraction()).toBe(1);
	});

	test("an unknown model is refused", () => {
		const p = new ModelProgress(["a"]);
		expect(() => p.report("b", 1, 2)).toThrow();
	});
});
