import { describe, expect, test } from "bun:test";
import {
	FrameAttribution,
	type FrameAttributionSnapshot,
	type GpuTimingStatus,
	rollingStatistics,
	type TimerQueryContext,
} from "../src/frame-attribution";
import {
	GPU_TIMING_STATUSES,
	isRefusedGpuStatus,
	REFUSED_GPU_STATUSES,
} from "../src/gpu-timing-status.js";

type FakeQuery = WebGLQuery & { id: number };

class FakeGl {
	readonly QUERY_RESULT = 0x8866;
	readonly QUERY_RESULT_AVAILABLE = 0x8867;
	readonly RENDERER = 0x1f01;
	readonly TIME_ELAPSED_EXT = 0x88bf;
	readonly GPU_DISJOINT_EXT = 0x8fbb;
	readonly UNMASKED_RENDERER_WEBGL = 0x9246;
	readonly calls: string[] = [];
	readonly available = new Set<number>();
	readonly results = new Map<number, number>();
	readonly deleted: number[] = [];
	supported = true;
	disjoint = false;
	/**
	 * Which backend the fake claims to be.
	 *
	 * A neutral default on purpose: `#246` makes the module refuse a reading on
	 * a backend that sums command-buffer spans, and every other test in this
	 * file is about the ring, the ages and the explicit states rather than about
	 * the backend. A fake that named one of the refused backends by default
	 * would turn all of them into tests of the refusal.
	 */
	rasterizer: string | null = "Fake Rasterizer (test)";
	private nextId = 1;

	/**
	 * Extension lookups, kept apart from `calls`.
	 *
	 * A second ledger rather than another entry in the first, because several
	 * tests below assert the exact contents of `calls` and an extra line in it
	 * would retype those as tests of this one.
	 */
	readonly extensionQueries: string[] = [];

	getExtension(name: string): unknown {
		this.extensionQueries.push(name);
		if (name === "EXT_disjoint_timer_query_webgl2")
			return this.supported
				? {
						TIME_ELAPSED_EXT: this.TIME_ELAPSED_EXT,
						GPU_DISJOINT_EXT: this.GPU_DISJOINT_EXT,
					}
				: null;
		if (name === "WEBGL_debug_renderer_info")
			return { UNMASKED_RENDERER_WEBGL: this.UNMASKED_RENDERER_WEBGL };
		return null;
	}

	createQuery(): WebGLQuery {
		const query = { id: this.nextId++ } as FakeQuery;
		this.calls.push(`create:${query.id}`);
		return query;
	}

	deleteQuery(query: WebGLQuery): void {
		const id = (query as FakeQuery).id;
		this.deleted.push(id);
		this.calls.push(`delete:${id}`);
	}

	beginQuery(_target: number, query: WebGLQuery): void {
		this.calls.push(`begin:${(query as FakeQuery).id}`);
	}

	endQuery(_target: number): void {
		this.calls.push("end");
	}

	getQueryParameter(query: WebGLQuery, parameter: number): unknown {
		const id = (query as FakeQuery).id;
		if (parameter === this.QUERY_RESULT_AVAILABLE) {
			this.calls.push(`available:${id}`);
			return this.available.has(id);
		}
		this.calls.push(`result:${id}`);
		return this.results.get(id) ?? 0;
	}

	getParameter(parameter: number): unknown {
		if (parameter === this.GPU_DISJOINT_EXT) return this.disjoint;
		if (parameter === this.RENDERER) return "WebKit WebGL";
		if (parameter === this.UNMASKED_RENDERER_WEBGL) return this.rasterizer;
		return null;
	}
}

const facts = () => ({
	calls: 7,
	triangles: 900,
	programs: 12,
	geometries: 21,
	textures: 15,
	drawingBufferWidth: 1440,
	drawingBufferHeight: 900,
	effectivePixelRatio: 2,
	renderScale: 0.75,
	composerPassCount: 6,
});

function fixture(
	options: {
		supported?: boolean;
		maxQueries?: number;
		sampleCapacity?: number;
		staleAfterMs?: number;
		rasterizer?: string | null;
		mode?: "full" | "cadence";
	} = {},
) {
	let now = 0;
	const gl = new FakeGl();
	gl.supported = options.supported ?? true;
	if (options.rasterizer !== undefined) gl.rasterizer = options.rasterizer;
	const events = new EventTarget();
	const attribution = new FrameAttribution({
		gl: gl as unknown as TimerQueryContext,
		contextEvents: events,
		rendererFacts: facts,
		mode: options.mode,
		now: () => now,
		maxQueries: options.maxQueries,
		sampleCapacity: options.sampleCapacity,
		staleAfterMs: options.staleAfterMs,
	});
	return {
		gl,
		events,
		attribution,
		setNow(value: number) {
			now = value;
		},
	};
}

describe("rolling frame statistics", () => {
	test("returns nulls for no finite samples", () => {
		expect(rollingStatistics([Number.NaN, Number.POSITIVE_INFINITY])).toEqual({
			medianMs: null,
			p95Ms: null,
			sampleCount: 0,
		});
	});

	test("computes midpoint median and nearest-rank p95", () => {
		expect(rollingStatistics([5, 1, 3, 2])).toEqual({
			medianMs: 2.5,
			p95Ms: 5,
			sampleCount: 4,
		});
	});
});

describe("FrameAttribution", () => {
	test("does nothing until explicitly enabled", () => {
		const { attribution, gl } = fixture();
		expect(attribution.beginGpuFrame()).toBe(false);
		attribution.recordCpu("simulation/step", 2);
		expect(attribution.snapshot().enabled).toBe(false);
		expect(attribution.snapshot().gpu.status).toBe("unavailable");
		expect(attribution.snapshot().cpu["simulation/step"].sampleCount).toBe(0);
		expect(gl.calls).toEqual([]);
	});

	test("polls availability before reading a delayed result", () => {
		const { attribution, gl, setNow } = fixture({ maxQueries: 2 });
		attribution.enable();
		attribution.beginGpuFrame();
		attribution.endGpuFrame();
		attribution.poll();
		expect(gl.calls).toContain("available:1");
		expect(gl.calls).not.toContain("result:1");

		gl.available.add(1);
		gl.results.set(1, 4_250_000);
		setNow(20);
		attribution.poll();
		expect(gl.calls.indexOf("available:1")).toBeLessThan(
			gl.calls.indexOf("result:1"),
		);
		expect(attribution.snapshot().gpu).toMatchObject({
			status: "supported",
			medianMs: 4.25,
			p95Ms: 4.25,
			sampleCount: 1,
			sampleAgeMs: 20,
		});
	});

	test("uses submission order for age when older queries resolve later", () => {
		const { attribution, gl } = fixture({ maxQueries: 2 });
		attribution.enable();
		attribution.beginGpuFrame(10);
		attribution.endGpuFrame();
		attribution.beginGpuFrame(20);
		attribution.endGpuFrame();

		gl.available.add(2);
		gl.results.set(2, 2_000_000);
		attribution.poll(30);
		gl.available.add(1);
		gl.results.set(1, 1_000_000);
		attribution.poll(40);

		expect(attribution.snapshot(40).gpu).toMatchObject({
			medianMs: 1.5,
			sampleCount: 2,
			sampleAgeMs: 20,
			status: "supported",
		});
	});

	test("wraps and reuses a bounded ring", () => {
		const { attribution, gl } = fixture({ maxQueries: 2 });
		attribution.enable();
		for (let frame = 0; frame < 5; frame++) {
			expect(attribution.beginGpuFrame()).toBe(true);
			attribution.endGpuFrame();
			const id = (frame % 2) + 1;
			gl.available.add(id);
			gl.results.set(id, (frame + 1) * 1_000_000);
			attribution.poll(frame + 1);
		}
		expect(gl.calls.filter((call) => call.startsWith("create:"))).toHaveLength(
			2,
		);
		expect(gl.calls.filter((call) => call === "begin:1")).toHaveLength(3);
		expect(gl.calls.filter((call) => call === "begin:2")).toHaveLength(2);
	});

	test("skips instead of waiting when the ring is full", () => {
		const { attribution, gl } = fixture({ maxQueries: 2 });
		attribution.enable();
		attribution.beginGpuFrame();
		attribution.endGpuFrame();
		attribution.beginGpuFrame();
		attribution.endGpuFrame();
		expect(attribution.beginGpuFrame()).toBe(false);
		expect(gl.calls).not.toContain("result:1");
		expect(gl.calls).not.toContain("result:2");
	});

	test("rejects pending samples while the GPU is disjoint", () => {
		const { attribution, gl } = fixture();
		attribution.enable();
		attribution.beginGpuFrame();
		attribution.endGpuFrame();
		gl.available.add(1);
		gl.results.set(1, 9_000_000);
		gl.disjoint = true;
		attribution.poll(30);
		expect(gl.calls).not.toContain("result:1");
		expect(attribution.snapshot(30).gpu).toMatchObject({
			status: "disjoint",
			medianMs: null,
			sampleCount: 0,
		});
	});

	test("does not start a query while the GPU is known disjoint", () => {
		const { attribution, gl } = fixture();
		attribution.enable();
		gl.disjoint = true;
		expect(attribution.beginGpuFrame(30)).toBe(false);
		expect(gl.calls.some((call) => call.startsWith("begin:"))).toBe(false);
		expect(attribution.snapshot(30).gpu.status).toBe("disjoint");
	});

	test("makes unsupported timing an explicit unavailable state", () => {
		const { attribution, gl } = fixture({ supported: false });
		attribution.enable();
		expect(attribution.beginGpuFrame()).toBe(false);
		expect(attribution.snapshot().gpu).toMatchObject({
			status: "unavailable",
			supported: false,
			medianMs: null,
		});
		expect(gl.calls.some((call) => call.startsWith("create:"))).toBe(false);
	});

	test("marks a once-supported sample stale without substituting zero", () => {
		const { attribution, gl, setNow } = fixture({ staleAfterMs: 50 });
		attribution.enable();
		attribution.beginGpuFrame();
		attribution.endGpuFrame();
		gl.available.add(1);
		gl.results.set(1, 2_000_000);
		attribution.poll(10);
		setNow(61);
		expect(attribution.snapshot().gpu).toMatchObject({
			status: "stale",
			medianMs: 2,
			sampleAgeMs: 61,
		});
	});

	test("bounds retained CPU and GPU samples", () => {
		const { attribution, gl } = fixture({
			maxQueries: 1,
			sampleCapacity: 2,
		});
		attribution.enable();
		for (let i = 1; i <= 3; i++) {
			attribution.recordCpu("simulation/step", i);
			attribution.beginGpuFrame();
			attribution.endGpuFrame();
			gl.available.add(1);
			gl.results.set(1, i * 1_000_000);
			attribution.poll(i);
		}
		const snapshot = attribution.snapshot(3);
		expect(snapshot.cpu["simulation/step"]).toEqual({
			medianMs: 2.5,
			p95Ms: 3,
			sampleCount: 2,
		});
		expect(snapshot.gpu).toMatchObject({
			medianMs: 2.5,
			p95Ms: 3,
			sampleCount: 2,
		});
	});

	test("deep-freezes statistics and renderer facts", () => {
		const { attribution } = fixture();
		attribution.enable();
		attribution.recordCpu("simulation/step", 3);
		const snapshot = attribution.snapshot();
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.cpu)).toBe(true);
		expect(Object.isFrozen(snapshot.cpu["simulation/step"])).toBe(true);
		expect(Object.isFrozen(snapshot.gpu)).toBe(true);
		expect(Object.isFrozen(snapshot.renderer)).toBe(true);
		expect(snapshot.renderer).toMatchObject({
			...facts(),
			api: "WebKit WebGL",
			rasterizer: "Fake Rasterizer (test)",
		});
	});

	test("disposes queries on disable and starts fresh on re-enable", () => {
		const { attribution, gl } = fixture({ maxQueries: 2 });
		attribution.enable();
		attribution.beginGpuFrame();
		attribution.endGpuFrame();
		attribution.disable();
		expect(gl.deleted).toEqual([1, 2]);
		expect(attribution.snapshot().enabled).toBe(false);

		attribution.enable();
		expect(gl.calls.filter((call) => call.startsWith("create:"))).toEqual([
			"create:1",
			"create:2",
			"create:3",
			"create:4",
		]);
		expect(attribution.snapshot().gpu.status).toBe("stale");
	});

	test("disposes on context loss and rebuilds after restoration", () => {
		const { attribution, gl, events } = fixture({ maxQueries: 2 });
		attribution.enable();
		attribution.beginGpuFrame();
		events.dispatchEvent(new Event("webglcontextlost"));
		expect(gl.deleted).toEqual([1, 2]);
		expect(attribution.snapshot().gpu.status).toBe("unavailable");

		events.dispatchEvent(new Event("webglcontextrestored"));
		expect(attribution.beginGpuFrame()).toBe(true);
		expect(gl.calls).toContain("begin:3");
	});
});

/**
 * #246. On ANGLE's Metal backend `EXT_disjoint_timer_query_webgl2` does not
 * time the work between its tokens — `SUMMING_TIMER_BACKENDS` in
 * `src/frame-attribution.ts` carries the mechanism and
 * `scripts/measure-gpu-timer-calibration.mjs` measures what it costs.
 *
 * What matters here is that the module was built to refuse and was not
 * refusing, and that a diagnostic which cannot be trusted and does not say so
 * is worse than one that is absent. Two refusals, because neither covers the
 * other: the backend is known from its name before any sample exists, and the
 * cadence contradiction catches a backend nobody has qualified.
 */
describe("a GPU reading that cannot be trusted says so", () => {
	/**
	 * Submit `frames` frames `cadenceMs` apart and resolve each with `ns`.
	 *
	 * Three tests were repeating the paired submit/resolve loops with only the
	 * duration and the snapshot time differing.
	 */
	const cadenceSamples = (
		f: Pick<ReturnType<typeof fixture>, "attribution" | "gl" | "setNow">,
		{
			frames,
			cadenceMs,
			ns,
		}: { frames: number; cadenceMs: number; ns: number },
	) => {
		for (let frame = 0; frame < frames; frame++) {
			// `markFrame` beside `beginGpuFrame`, the way `Game.render` calls
			// them: since #352 the mark is its own step, so a fixture that only
			// begins a query leaves the cadence ring empty.
			f.attribution.markFrame(frame * cadenceMs);
			f.attribution.beginGpuFrame(frame * cadenceMs);
			f.attribution.endGpuFrame();
		}
		for (let id = 1; id <= frames; id++) {
			f.gl.available.add(id);
			f.gl.results.set(id, ns);
		}
		const endedAt = frames * cadenceMs;
		f.setNow(endedAt);
		f.attribution.poll(endedAt);
		return endedAt;
	};

	/**
	 * Submit one frame and resolve it with `ns` nanoseconds.
	 *
	 * The refusal tests are about policy, not about the query ring; five of them
	 * were spelling out the same begin/end/available/poll sequence with only the
	 * result or the backend differing.
	 */
	const oneSample = (
		f: Pick<ReturnType<typeof fixture>, "attribution" | "gl" | "setNow">,
		ns: number,
		atMs = 10,
	) => {
		f.attribution.beginGpuFrame(0);
		f.attribution.endGpuFrame();
		f.gl.available.add(1);
		f.gl.results.set(1, ns);
		f.setNow(atMs);
		f.attribution.poll(atMs);
	};

	test("refuses a backend that is known to sum command-buffer spans", () => {
		const { attribution, gl, setNow } = fixture({
			maxQueries: 2,
			rasterizer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)",
		});
		attribution.enable();
		oneSample({ attribution, gl, setNow }, 4_000_000);

		const gpu = attribution.snapshot(10).gpu;
		expect(gpu.status).toBe("untrusted");
		// A status instead of a number, not beside one.
		expect(gpu.medianMs).toBeNull();
		expect(gpu.p95Ms).toBeNull();
		// The samples are still counted, because the refusal is about what they
		// mean rather than about whether they arrived.
		expect(gpu.sampleCount).toBe(1);
		expect(gpu.reason).toContain("command buffer");
	});

	/**
	 * Found by Sage on round 1, and it is the failure the whole node is about.
	 * Both refusals were gated on `status === "supported"`, so a summing backend
	 * whose last sample had aged past `staleAfterMs` fell through to `stale` and
	 * carried the summed median with `reason: null` — and `stale` reads as
	 * old-but-real, so `perf-panel.ts` and `measure-bay-frame-cost.mjs` printed
	 * the figure the refusal exists to withhold. It failed **open**, under the
	 * status a long frame reaches on its own.
	 */
	test("refuses a summing backend even where the sample has gone stale", () => {
		const { attribution, gl, setNow } = fixture({
			maxQueries: 2,
			staleAfterMs: 100,
			rasterizer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)",
		});
		attribution.enable();
		attribution.beginGpuFrame(0);
		attribution.endGpuFrame();
		gl.available.add(1);
		gl.results.set(1, 119_050_000);
		setNow(10);
		attribution.poll(10);
		// Long enough that the sample would otherwise be reported as `stale`.
		setNow(5000);

		const gpu = attribution.snapshot(5000).gpu;
		expect(gpu.status).toBe("untrusted");
		expect(gpu.medianMs).toBeNull();
		expect(gpu.reason).toContain("command buffer");
	});

	/**
	 * Round 2, and it is round 1's blocker one level in. `implausible` is sold
	 * as the backstop for a backend nobody has qualified, and it was reachable
	 * only from `supported` — so an unqualified backend over-reporting by four
	 * times, whose last sample aged out, landed on `stale` and printed the
	 * figure. The arm covering the unknown backend had the fail-open the named
	 * one had just lost.
	 */
	test("refuses an implausible median even where the sample has gone stale", () => {
		const { attribution, gl, setNow } = fixture({
			maxQueries: 12,
			staleAfterMs: 100,
		});
		attribution.enable();
		cadenceSamples(
			{ attribution, gl, setNow },
			{ frames: 12, cadenceMs: 16, ns: 50_000_000 },
		);
		setNow(5000);

		const gpu = attribution.snapshot(5000).gpu;
		expect(gpu.status).toBe("implausible");
		expect(gpu.medianMs).toBeNull();
	});

	/**
	 * The repo's capture doctrine already settles this one from the other side:
	 * `capture-views.mjs` refuses to write a frame unless the renderer can be
	 * *shown* not to be a software rasteriser, and "an unreadable name counts as
	 * unproven". A backend gate that reads an unreadable name as *qualified* is
	 * that rule inverted.
	 */
	test("refuses a backend whose name cannot be read", () => {
		const { attribution, gl, setNow } = fixture({
			maxQueries: 2,
			rasterizer: null,
		});
		attribution.enable();
		attribution.beginGpuFrame(0);
		attribution.endGpuFrame();
		gl.available.add(1);
		gl.results.set(1, 4_000_000);
		setNow(10);
		attribution.poll(10);

		const gpu = attribution.snapshot(10).gpu;
		expect(gpu.status).toBe("untrusted");
		expect(gpu.medianMs).toBeNull();
		expect(gpu.reason).toContain("could not be read");
	});

	/**
	 * The contract every refused status owes, checked by **reaching each status
	 * in the module** and reading its snapshot.
	 *
	 * The first version compared `isRefusedGpuStatus(status)` against the list
	 * that helper is implemented from, which is the same list restated — it
	 * inspected no snapshot and no figure, so a seventh status added to the
	 * vocabulary and classified nowhere left every assertion passing. That is
	 * the tautology this repo keeps re-learning: a check derived from its own
	 * subject cannot fail.
	 *
	 * Each row drives the sampler into one status; the expectation beside it is
	 * written out rather than computed from `REFUSED_GPU_STATUSES`. The last
	 * assertion is what makes a seventh status a red build: every member of the
	 * vocabulary must appear here.
	 */
	describe("every status the module can reach", () => {
		const reach: Record<
			GpuTimingStatus,
			{ carriesFigure: boolean; snapshot: () => FrameAttributionSnapshot }
		> = {
			unavailable: {
				carriesFigure: false,
				snapshot: () => {
					const f = fixture({ supported: false });
					f.attribution.enable();
					return f.attribution.snapshot(10);
				},
			},
			stale: {
				carriesFigure: true,
				snapshot: () => {
					const f = fixture({ maxQueries: 2, staleAfterMs: 100 });
					f.attribution.enable();
					oneSample(f, 4_000_000);
					f.setNow(5000);
					return f.attribution.snapshot(5000);
				},
			},
			disjoint: {
				carriesFigure: false,
				snapshot: () => {
					const f = fixture({ maxQueries: 2 });
					f.attribution.enable();
					oneSample(f, 4_000_000);
					f.gl.disjoint = true;
					f.attribution.poll(20);
					return f.attribution.snapshot(20);
				},
			},
			supported: {
				carriesFigure: true,
				snapshot: () => {
					const f = fixture({ maxQueries: 2 });
					f.attribution.enable();
					oneSample(f, 4_000_000);
					return f.attribution.snapshot(10);
				},
			},
			untrusted: {
				carriesFigure: false,
				snapshot: () => {
					const f = fixture({
						maxQueries: 2,
						rasterizer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)",
					});
					f.attribution.enable();
					oneSample(f, 4_000_000);
					return f.attribution.snapshot(10);
				},
			},
			implausible: {
				carriesFigure: false,
				snapshot: () => {
					const f = fixture({ maxQueries: 12 });
					f.attribution.enable();
					const at = cadenceSamples(f, {
						frames: 12,
						cadenceMs: 16,
						ns: 50_000_000,
					});
					return f.attribution.snapshot(at);
				},
			},
		};

		for (const [name, row] of Object.entries(reach)) {
			const status = name as GpuTimingStatus;
			test(`${status}: ${row.carriesFigure ? "reports" : "withholds"} its figure`, () => {
				const gpu = row.snapshot().gpu;
				expect(gpu.status).toBe(status);
				if (row.carriesFigure) {
					expect(gpu.medianMs).not.toBeNull();
					expect(gpu.reason).toBeNull();
				} else {
					expect(gpu.medianMs).toBeNull();
					expect(gpu.p95Ms).toBeNull();
				}
				// The one thing the two sides share: a refusal owes a reason and
				// nothing else does.
				expect(gpu.reason !== null).toBe(isRefusedGpuStatus(status));
			});
		}

		test("the vocabulary has no status this table does not reach", () => {
			expect(Object.keys(reach).sort()).toEqual(
				[...GPU_TIMING_STATUSES].sort(),
			);
			// And every refused status is one the module can actually reach.
			for (const status of REFUSED_GPU_STATUSES)
				expect(GPU_TIMING_STATUSES).toContain(status);
		});
	});

	test("a qualified backend still reports its number", () => {
		const { attribution, gl, setNow } = fixture({ maxQueries: 2 });
		attribution.enable();
		attribution.beginGpuFrame(0);
		attribution.endGpuFrame();
		gl.available.add(1);
		gl.results.set(1, 4_000_000);
		setNow(10);
		attribution.poll(10);

		const gpu = attribution.snapshot(10).gpu;
		expect(gpu.status).toBe("supported");
		expect(gpu.medianMs).toBe(4);
		expect(gpu.reason).toBeNull();
	});

	/**
	 * The physical contradiction, and it needs no fence and no renderer name: a
	 * GPU cannot spend longer on a frame than the interval between frames, on
	 * one command stream, in a steady state. It is the backstop for a backend
	 * this repo has never seen.
	 */
	test("refuses a median that exceeds the frame cadence it was sampled at", () => {
		const { attribution, gl, setNow } = fixture({ maxQueries: 12 });
		attribution.enable();
		// Twelve frames 16 ms apart — a 60 Hz cadence, sustained past
		// `IMPLAUSIBLE_MIN_SAMPLES` — each claiming 50 ms of GPU time.
		const at = cadenceSamples(
			{ attribution, gl, setNow },
			{ frames: 12, cadenceMs: 16, ns: 50_000_000 },
		);

		const gpu = attribution.snapshot(at).gpu;
		expect(gpu.status).toBe("implausible");
		expect(gpu.medianMs).toBeNull();
		expect(gpu.reason).toContain("cadence");
	});

	test("a median inside the cadence is not refused", () => {
		const { attribution, gl, setNow } = fixture({ maxQueries: 12 });
		attribution.enable();
		// 15 ms is a GPU-bound 60 Hz frame, not an impossible one.
		const at = cadenceSamples(
			{ attribution, gl, setNow },
			{ frames: 12, cadenceMs: 16, ns: 15_000_000 },
		);

		expect(attribution.snapshot(at).gpu).toMatchObject({
			status: "supported",
			medianMs: 15,
		});
	});

	/**
	 * Round 5's blocker. The GPU-sample ring and the frame-mark ring advance
	 * independently, and the cadence was read off whatever the marks currently
	 * held — so honest samples taken during a slow stretch were compared
	 * against a *later, faster* cadence and refused.
	 *
	 * Here: eight 50 ms samples submitted while frames ran 40 ms apart, which
	 * is a GPU-bound 25 Hz and entirely possible, then a run of frames at 16 ms
	 * that the one-entry ring never times. The samples are unchanged; only the
	 * marks moved.
	 */
	test("measures the cadence over the window the samples came from", () => {
		const { attribution, gl, setNow } = fixture({ maxQueries: 8 });
		attribution.enable();
		// Eight frames 40 ms apart, each honestly costing 50 ms of GPU time.
		cadenceSamples(
			{ attribution, gl, setNow },
			{ frames: 8, cadenceMs: 40, ns: 50_000_000 },
		);
		expect(attribution.snapshot(320).gpu.status).toBe("supported");

		// Now the frame rate recovers. `gl.available` is a set the fake never
		// empties, so without this the reused entries resolve on the very next
		// poll and drag the sample window forward with them — the third time
		// that has caught a fixture in this file.
		gl.available.clear();
		// The marks advance at 16 ms while no new result lands.
		for (let frame = 0; frame < 12; frame++) {
			attribution.markFrame(320 + frame * 16);
			attribution.beginGpuFrame(320 + frame * 16);
			// Kept: without it the first frame holds `activeQuery` and every
			// later `beginGpuFrame` returns early, so the fixture would take one
			// sample rather than twelve. It no longer governs the *marks* — the
			// reason it was added, before #352 split them — and the line above
			// is what covers those now.
			attribution.endGpuFrame();
		}
		setNow(512);

		const gpu = attribution.snapshot(512).gpu;
		// Judged against the 40 ms the samples were taken at, not the 16 ms the
		// marks have moved on to.
		expect(gpu.status).toBe("supported");
		expect(gpu.medianMs).toBe(50);
	});

	/**
	 * Round 4. Classification ran over `disjoint` too, so a query invalidation
	 * on a summing backend was reported as `untrusted` and the state that says
	 * *the driver threw these results away* disappeared from the snapshot. No
	 * figure leaked either way — `disjoint` clears the samples — but the two
	 * mean different things and only one of them is transient.
	 */
	test.each([
		["a named summing backend", "ANGLE (Apple, ANGLE Metal Renderer: M1 Pro)"],
		["an unreadable renderer name", null],
	])("keeps disjoint distinct from a refusal on %s", (_label, rasterizer) => {
		const { attribution, gl, setNow } = fixture({ maxQueries: 2, rasterizer });
		attribution.enable();
		oneSample({ attribution, gl, setNow }, 4_000_000);
		gl.disjoint = true;
		attribution.poll(20);

		const gpu = attribution.snapshot(20).gpu;
		expect(gpu.status).toBe("disjoint");
		expect(gpu.medianMs).toBeNull();
		expect(gpu.reason).toBeNull();
	});

	/**
	 * The blocker from round 4, and it is about what the check may *claim*.
	 *
	 * "A GPU cannot spend longer per frame than the interval between frames" is
	 * true of a **sustained** state and false of a burst: a jump, a bake or a
	 * tab restored puts real work behind the compositor for a few frames, and a
	 * rolling median over a short window reads that honestly. The first version
	 * refused on the median alone and called it impossible.
	 */
	test("does not refuse a short burst over the cadence", () => {
		const { attribution, gl, setNow } = fixture({ maxQueries: 4 });
		attribution.enable();
		const at = cadenceSamples(
			{ attribution, gl, setNow },
			{ frames: 4, cadenceMs: 16, ns: 50_000_000 },
		);

		// The same ratio the sustained case refuses, over too few samples to
		// call it sustained.
		expect(attribution.snapshot(at).gpu).toMatchObject({
			status: "supported",
			medianMs: 50,
		});
	});

	/**
	 * **The cadence is every frame's, not every timed frame's.** The ring skips
	 * a frame when every entry is pending, so a cadence built from the frames
	 * that got a query reads two or three times the real one — and a check that
	 * divides by it goes quietly lenient exactly when the sampler is busiest.
	 */
	test("counts frames the ring had no query for", () => {
		const { attribution, gl, setNow } = fixture({ maxQueries: 1 });
		attribution.enable();
		/**
		 * Eight frames 16 ms apart through a one-entry ring, arranged so that
		 * **exactly every other frame is timed**: a query is started, the next
		 * frame finds the entry still pending and is skipped, and only then is
		 * the result made available for the frame after it.
		 *
		 * The alternation is the point. A cadence built from the timed frames
		 * reads **32 ms**, and a 30 ms median sits under 32 x 1.25, so the naive
		 * implementation returns `supported` here. Built from every frame it
		 * reads 16 ms, and 30 is over 16 x 1.25. Moving the mark back inside
		 * `beginGpuFrame`'s guarded path — where it lived until #352 gave it its
		 * own method — turns this test red, which a fixture where nothing is
		 * skipped, or where everything is, does not.
		 */
		/**
		 * `gl.available` is a set the fake never empties, so a result added once
		 * resolves on **every** later poll and nothing is ever skipped. Two
		 * fixtures were written before this one that alternated in the comment
		 * and not in the fake, and both passed against the naive cadence.
		 */
		// Twenty frames so the timed half clears `IMPLAUSIBLE_MIN_SAMPLES`.
		for (let frame = 0; frame < 20; frame += 2) {
			// Resolves the previous result, then takes the only entry.
			attribution.markFrame(frame * 16);
			attribution.beginGpuFrame(frame * 16);
			gl.available.clear();
			attribution.endGpuFrame();
			// The entry is pending and no result is available: this frame is
			// skipped, and `endGpuFrame` has no active query to end. It is
			// marked anyway, which is the whole claim.
			attribution.markFrame((frame + 1) * 16);
			attribution.beginGpuFrame((frame + 1) * 16);
			attribution.endGpuFrame();
			gl.available.add(1);
			gl.results.set(1, 30_000_000);
		}
		setNow(320);
		attribution.poll(320);

		// It is over the 16 ms cadence the frames actually ran at.
		expect(attribution.snapshot(320).gpu.status).toBe("implausible");
	});
});

/**
 * #352. The controller's signal, and the contract that lets it run by default.
 *
 * Two separate claims live here and they fail for different reasons. The first
 * is that a cadence sampler **touches no GL object** — that is #223's build
 * contract item 6 ("the default route must not ... issue timer queries")
 * surviving the arrival of a consumer that runs without `?perf`. The second is
 * that the frame period is recorded **whether or not a query was taken**, which
 * is the fail-open `markFrame` was extracted to close.
 */
describe("cadence mode: a frame period with no query ring", () => {
	test("a cadence sampler asks for no extension and creates no query", () => {
		const { gl, attribution } = fixture({ mode: "cadence" });
		attribution.enable();
		for (let frame = 0; frame < 10; frame++) {
			attribution.markFrame(frame * 16.7);
			// Called anyway, the way a render loop that does not know the mode
			// would call it. It must refuse quietly rather than allocate.
			attribution.beginGpuFrame(frame * 16.7);
			attribution.endGpuFrame();
		}
		expect(gl.extensionQueries).toEqual([]);
		expect(gl.calls).toEqual([]);
		expect(attribution.snapshot(170).mode).toBe("cadence");
	});

	test("a full sampler still allocates, so the check above can fail", () => {
		const { gl, attribution } = fixture();
		attribution.enable();
		expect(gl.extensionQueries).toContain("EXT_disjoint_timer_query_webgl2");
		expect(gl.calls.some((call) => call.startsWith("create:"))).toBe(true);
	});

	test("the period is recorded on a backend with no timer extension", () => {
		// The fail-open this replaced: `beginGpuFrame` returned before its push
		// when `getExtension` gave null, so an unsupported backend reported an
		// enabled sampler with an empty cadence ring.
		const { attribution } = fixture({ supported: false });
		attribution.enable();
		for (let frame = 0; frame < 6; frame++) {
			attribution.markFrame(frame * 20);
			attribution.beginGpuFrame(frame * 20);
		}
		const snapshot = attribution.snapshot(100);
		expect(snapshot.gpu.status).toBe("unavailable");
		expect(snapshot.cadence.medianMs).toBe(20);
		expect(snapshot.cadence.sampleCount).toBe(5);
	});

	test("a frame the query ring skips still counts as a frame", () => {
		// One query, so every frame after the first is refused by the ring while
		// its result is pending. The cadence must not become the interval
		// between *timed* frames, which is what it measured before the split.
		const { attribution } = fixture({ maxQueries: 1 });
		attribution.enable();
		for (let frame = 0; frame < 8; frame++) {
			attribution.markFrame(frame * 10);
			attribution.beginGpuFrame(frame * 10);
		}
		expect(attribution.snapshot(80).cadence.medianMs).toBe(10);
	});

	test("minPeriodMs is the cheapest frame, not the typical one", () => {
		// The statistic that tells a panel's cap from a frame budget. The
		// principal's two displays read 8.33 ms and 16.67 ms on a cheap frame;
		// without this, a consumer cannot tell the second from a 60 fps budget
		// that happens to be exactly met.
		const { attribution } = fixture();
		attribution.enable();
		const periods = [16.7, 16.7, 8.3, 33.4, 16.7];
		let at = 0;
		attribution.markFrame(at);
		for (const period of periods) {
			at += period;
			attribution.markFrame(at);
		}
		const cadence = attribution.snapshot(at).cadence;
		expect(cadence.minPeriodMs).toBeCloseTo(8.3, 5);
		expect(cadence.medianMs).toBeCloseTo(16.7, 5);
		expect(cadence.spanMs).toBeCloseTo(91.8, 5);
	});

	test("no marks at all is null rather than zero", () => {
		const { attribution } = fixture();
		attribution.enable();
		const cadence = attribution.snapshot(0).cadence;
		expect(cadence.medianMs).toBeNull();
		expect(cadence.minPeriodMs).toBeNull();
		expect(cadence.spanMs).toBeNull();
		expect(cadence.sampleCount).toBe(0);
	});

	test("a disabled sampler records nothing", () => {
		const { attribution } = fixture({ mode: "cadence" });
		attribution.markFrame(0);
		attribution.markFrame(16);
		expect(attribution.snapshot(16).cadence.sampleCount).toBe(0);
	});

	test("reprime drops the hidden tab's gap without filtering for it", () => {
		// A tab away for 90 seconds returns one enormous period. Clearing is the
		// answer rather than rejecting the gap, because every threshold that
		// rejects it also rejects a real slow frame on someone's machine.
		const { attribution } = fixture();
		attribution.enable();
		attribution.markFrame(0);
		attribution.markFrame(16.7);
		attribution.markFrame(33.4);
		attribution.reprimeCadence();
		attribution.markFrame(90_000);
		attribution.markFrame(90_016.7);
		attribution.markFrame(90_033.4);
		const cadence = attribution.snapshot(90_033.4).cadence;
		expect(cadence.sampleCount).toBe(2);
		expect(cadence.medianMs).toBeCloseTo(16.7, 5);
	});

	test("reprime leaves the CPU samples alone", () => {
		// They are per-frame costs rather than intervals, so nothing about them
		// is wrong after a display change.
		const { attribution } = fixture();
		attribution.enable();
		attribution.recordCpu("simulation/step", 4);
		attribution.recordCpu("simulation/step", 6);
		attribution.reprimeCadence();
		expect(attribution.snapshot(0).cpu["simulation/step"].sampleCount).toBe(2);
	});
});
