/**
 * #833's progress bar: received bytes over total bytes across the models a
 * boot needs, read from `GLTFLoader`'s `onProgress`. The DOM that draws it is
 * `probe-model-download`'s; the arithmetic is here.
 */

import { describe, expect, test } from "bun:test";
import {
	loadRequiredModels,
	type ModelLoadState,
} from "../src/model-load-view";
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

describe("loadRequiredModels", () => {
	/** A model whose download the test drives by hand, memoised as
	 *  `prepareCoriolisModel` is: a failure clears it, a success is kept. */
	const manual = () => {
		let listener: ((e: ProgressEvent) => void) | undefined;
		let settle: { resolve: () => void; reject: (e: Error) => void } | undefined;
		let ready: Promise<void> | undefined;
		const load = (onProgress?: (e: ProgressEvent) => void) =>
			(ready ??= new Promise<void>((resolve, reject) => {
				listener = onProgress;
				settle = { resolve, reject };
			}).catch((error) => {
				ready = undefined;
				throw error;
			}));
		return {
			load,
			progress: (loaded: number, total: number) =>
				listener?.({ loaded, total, lengthComputable: true } as ProgressEvent),
			resolve: () => settle?.resolve(),
			reject: () => settle?.reject(new Error("refused")),
		};
	};
	const tick = () => new Promise((r) => setTimeout(r, 0));

	test("a model still downloading after another failed does not draw over the Retry", async () => {
		const a = manual();
		const b = manual();
		const states: ModelLoadState[] = [];
		const done = loadRequiredModels([a.load, b.load], (s) => states.push(s));
		a.progress(10, 100);
		b.progress(10, 100);
		a.reject();
		await tick();
		expect(states.at(-1)?.kind).toBe("failed");
		b.progress(90, 100);
		b.resolve();
		await tick();
		const last = states.at(-1);
		expect(last?.kind).toBe("failed");
		// The retry starts a new attempt, which runs to the end.
		if (last?.kind === "failed") last.retry();
		await tick();
		a.resolve();
		await done;
		expect(states.at(-1)?.kind).toBe("done");
	});

	test("every model in reads 100% and then done", async () => {
		const a = manual();
		const states: ModelLoadState[] = [];
		const done = loadRequiredModels([a.load], (s) => states.push(s));
		a.progress(50, 100);
		a.resolve();
		await done;
		expect(
			states.map((s) => (s.kind === "loading" ? s.fraction : s.kind)),
		).toEqual([null, 0.5, 1, "done"]);
	});
});
