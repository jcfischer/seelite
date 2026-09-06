import { describe, expect, test } from "bun:test";
import {
	FrameAttribution,
	rollingStatistics,
	type TimerQueryContext,
} from "../src/frame-attribution";

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
	rasterizer = "Fake Rasterizer (test)";
	private nextId = 1;

	getExtension(name: string): unknown {
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
		rasterizer?: string;
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
 * #246. On ANGLE's Metal backend `EXT_disjoint_timer_query_webgl2` reports the
 * **sum of the wall spans of every command buffer** that was open while the
 * query was — `entry.elapsed_seconds += [buf GPUEndTime] - [buf GPUStartTime]`
 * in `mtl_command_buffer.mm` — rather than the duration of the work between the
 * two tokens. Measured headed on an M1 Pro: 1.71x the fenced cost of one
 * composer render, rising to 3.01x at four, while a workload small enough to
 * fit one command buffer reads honestly.
 *
 * The module was built to refuse and was not refusing, and a diagnostic that
 * cannot be trusted and does not say so is worse than one that is absent. Two
 * refusals, because neither covers the other: the backend is known from its
 * name before any sample exists, and the cadence contradiction catches a
 * backend nobody has qualified.
 */
describe("a GPU reading that cannot be trusted says so", () => {
	test("refuses a backend that is known to sum command-buffer spans", () => {
		const { attribution, gl, setNow } = fixture({
			maxQueries: 2,
			rasterizer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)",
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
		// A status instead of a number, not beside one.
		expect(gpu.medianMs).toBeNull();
		expect(gpu.p95Ms).toBeNull();
		// The samples are still counted, because the refusal is about what they
		// mean rather than about whether they arrived.
		expect(gpu.sampleCount).toBe(1);
		expect(gpu.reason).toContain("command-buffer");
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
		const { attribution, gl, setNow } = fixture({ maxQueries: 4 });
		attribution.enable();
		// Four frames, 16 ms apart: a 60 Hz cadence.
		for (let frame = 0; frame < 4; frame++) {
			attribution.beginGpuFrame(frame * 16);
			attribution.endGpuFrame();
		}
		for (let id = 1; id <= 4; id++) {
			gl.available.add(id);
			gl.results.set(id, 50_000_000); // 50 ms of "GPU time" per 16 ms frame
		}
		setNow(64);
		attribution.poll(64);

		const gpu = attribution.snapshot(64).gpu;
		expect(gpu.status).toBe("implausible");
		expect(gpu.medianMs).toBeNull();
		expect(gpu.reason).toContain("cadence");
	});

	test("a median inside the cadence is not refused", () => {
		const { attribution, gl, setNow } = fixture({ maxQueries: 4 });
		attribution.enable();
		for (let frame = 0; frame < 4; frame++) {
			attribution.beginGpuFrame(frame * 16);
			attribution.endGpuFrame();
		}
		for (let id = 1; id <= 4; id++) {
			gl.available.add(id);
			gl.results.set(id, 15_000_000); // 15 ms, a GPU-bound 60 Hz frame
		}
		setNow(64);
		attribution.poll(64);

		expect(attribution.snapshot(64).gpu).toMatchObject({
			status: "supported",
			medianMs: 15,
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
		// Eight frames 16 ms apart, but one query: every other frame is skipped
		// because the single entry is still pending.
		for (let frame = 0; frame < 8; frame++) {
			attribution.beginGpuFrame(frame * 16);
			attribution.endGpuFrame();
		}
		gl.available.add(1);
		gl.results.set(1, 30_000_000); // 30 ms — under a 32 ms *timed* cadence
		setNow(128);
		attribution.poll(128);

		// It is over the 16 ms cadence the frames actually ran at.
		expect(attribution.snapshot(128).gpu.status).toBe("implausible");
	});
});
