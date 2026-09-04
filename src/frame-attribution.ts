/**
 * Non-blocking attribution for one composed frame.
 *
 * CPU intervals are wall-clock measurements of named JavaScript work. GPU
 * intervals come only from EXT_disjoint_timer_query_webgl2 and are read only
 * after QUERY_RESULT_AVAILABLE says they are ready. The two are deliberately
 * separate: requestAnimationFrame cadence and CPU submission time are not GPU
 * execution time.
 *
 * The owner must explicitly enable this sampler. A disabled sampler owns no
 * WebGLQuery objects and performs no timer-query calls, which lets the default
 * route construct Game without silently adding diagnostic work.
 */

export const CPU_INTERVALS = [
	"simulation/step",
	"render submission/composer",
] as const;

export type CpuInterval = (typeof CPU_INTERVALS)[number];
export type GpuTimingStatus =
	| "supported"
	| "unavailable"
	| "disjoint"
	| "stale";

export type RollingStatistics = Readonly<{
	medianMs: number | null;
	p95Ms: number | null;
	sampleCount: number;
}>;

export type RendererFacts = Readonly<{
	calls: number;
	triangles: number;
	programs: number;
	geometries: number;
	textures: number;
	drawingBufferWidth: number;
	drawingBufferHeight: number;
	effectivePixelRatio: number;
	renderScale: number;
	composerPassCount: number;
}>;

export type FrameAttributionSnapshot = Readonly<{
	enabled: boolean;
	cpu: Readonly<Record<CpuInterval, RollingStatistics>>;
	gpu: RollingStatistics &
		Readonly<{
			status: GpuTimingStatus;
			supported: boolean;
			sampleAgeMs: number | null;
		}>;
	renderer: RendererFacts &
		Readonly<{
			api: string | null;
			rasterizer: string | null;
		}>;
}>;

type TimerQueryExtension = {
	TIME_ELAPSED_EXT: number;
	GPU_DISJOINT_EXT: number;
};

type DebugRendererExtension = {
	UNMASKED_RENDERER_WEBGL: number;
};

export type TimerQueryContext = Pick<
	WebGL2RenderingContext,
	| "QUERY_RESULT"
	| "QUERY_RESULT_AVAILABLE"
	| "RENDERER"
	| "beginQuery"
	| "createQuery"
	| "deleteQuery"
	| "endQuery"
	| "getExtension"
	| "getParameter"
	| "getQueryParameter"
>;

export type FrameAttributionOptions = {
	gl: TimerQueryContext;
	contextEvents: Pick<EventTarget, "addEventListener" | "removeEventListener">;
	rendererFacts: () => RendererFacts;
	now?: () => number;
	maxQueries?: number;
	sampleCapacity?: number;
	staleAfterMs?: number;
};

type QueryEntry = {
	query: WebGLQuery;
	state: "idle" | "active" | "pending";
	submittedAtMs: number | null;
};

type GpuSample = {
	valueMs: number;
	submittedAtMs: number;
};

/** Fixed storage whose write cost stays constant after reaching capacity. */
class SampleRing<T> {
	private values: T[] = [];
	private next = 0;

	constructor(private readonly capacity: number) {}

	push(value: T): void {
		if (this.values.length < this.capacity) {
			this.values.push(value);
			return;
		}
		this.values[this.next] = value;
		this.next = (this.next + 1) % this.capacity;
	}

	clear(): void {
		this.values = [];
		this.next = 0;
	}

	ordered(): T[] {
		if (this.values.length < this.capacity || this.next === 0)
			return this.values.slice();
		return this.values.slice(this.next).concat(this.values.slice(0, this.next));
	}
}

const DEFAULT_MAX_QUERIES = 4;
const DEFAULT_SAMPLE_CAPACITY = 120;
const DEFAULT_STALE_AFTER_MS = 2_000;

function boundedInteger(value: number | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value < 1)
		throw new RangeError("frame attribution bounds must be positive integers");
	return value;
}

/** Nearest-rank p95 and the ordinary midpoint median over finite samples. */
export function rollingStatistics(
	values: readonly number[],
): RollingStatistics {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (sorted.length === 0)
		return Object.freeze({ medianMs: null, p95Ms: null, sampleCount: 0 });
	const middle = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2 === 0
			? (sorted[middle - 1] + sorted[middle]) / 2
			: sorted[middle];
	const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
	return Object.freeze({
		medianMs: median,
		p95Ms: p95,
		sampleCount: sorted.length,
	});
}

function frozenFacts(facts: RendererFacts): RendererFacts {
	return Object.freeze({ ...facts });
}

/**
 * A fixed-size reusable WebGL query ring plus bounded rolling CPU/GPU samples.
 *
 * `beginGpuFrame` polls older entries before starting a new one. It skips a
 * frame when every entry is pending rather than waiting for the GPU. Queries are
 * reused after their results resolve, so a long-running diagnostic stays at
 * `maxQueries` allocations.
 */
export class FrameAttribution {
	private readonly gl: TimerQueryContext;
	private readonly contextEvents: FrameAttributionOptions["contextEvents"];
	private readonly rendererFacts: () => RendererFacts;
	private readonly now: () => number;
	private readonly maxQueries: number;
	private readonly sampleCapacity: number;
	private readonly staleAfterMs: number;
	private enabled = false;
	private contextLost = false;
	private extension: TimerQueryExtension | null = null;
	private debugRenderer: DebugRendererExtension | null = null;
	private queries: QueryEntry[] = [];
	private nextQuery = 0;
	private activeQuery: number | null = null;
	private readonly cpuSamples = new Map<CpuInterval, SampleRing<number>>();
	private readonly gpuSamples: SampleRing<GpuSample>;
	private lastDisjointAtMs: number | null = null;
	private disjointActive = false;

	constructor(options: FrameAttributionOptions) {
		this.gl = options.gl;
		this.contextEvents = options.contextEvents;
		this.rendererFacts = options.rendererFacts;
		this.now = options.now ?? (() => performance.now());
		this.maxQueries = boundedInteger(options.maxQueries, DEFAULT_MAX_QUERIES);
		this.sampleCapacity = boundedInteger(
			options.sampleCapacity,
			DEFAULT_SAMPLE_CAPACITY,
		);
		this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
		if (!(this.staleAfterMs > 0) || !Number.isFinite(this.staleAfterMs))
			throw new RangeError("staleAfterMs must be a positive finite number");
		for (const name of CPU_INTERVALS)
			this.cpuSamples.set(name, new SampleRing(this.sampleCapacity));
		this.gpuSamples = new SampleRing(this.sampleCapacity);
	}

	/** Allocate the ring and start listening for WebGL context events. */
	enable(): void {
		if (this.enabled) return;
		this.enabled = true;
		this.contextLost = false;
		this.contextEvents.addEventListener("webglcontextlost", this.onContextLost);
		this.contextEvents.addEventListener(
			"webglcontextrestored",
			this.onContextRestored,
		);
		this.resetSamples();
		this.allocateQueries();
	}

	/** Dispose every query and leave a reusable, fully disabled sampler. */
	disable(): void {
		if (!this.enabled) return;
		this.enabled = false;
		this.contextEvents.removeEventListener(
			"webglcontextlost",
			this.onContextLost,
		);
		this.contextEvents.removeEventListener(
			"webglcontextrestored",
			this.onContextRestored,
		);
		this.disposeQueries();
		this.extension = null;
		this.debugRenderer = null;
		this.contextLost = false;
		this.resetSamples();
	}

	/** Record one named CPU wall interval. Disabled samplers retain nothing. */
	recordCpu(name: CpuInterval, durationMs: number): void {
		if (!this.enabled || !Number.isFinite(durationMs) || durationMs < 0) return;
		const samples = this.cpuSamples.get(name);
		if (!samples) return;
		samples.push(durationMs);
	}

	/**
	 * Poll ready older entries, then begin a timer query if one is idle.
	 * Returns false when unsupported, disabled, lost, already active, or full.
	 */
	beginGpuFrame(atMs = this.now()): boolean {
		if (
			!this.enabled ||
			this.contextLost ||
			!this.extension ||
			this.activeQuery !== null
		)
			return false;
		if (this.poll(atMs)) return false;
		for (let offset = 0; offset < this.queries.length; offset++) {
			const index = (this.nextQuery + offset) % this.queries.length;
			const entry = this.queries[index];
			if (entry.state !== "idle") continue;
			this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, entry.query);
			entry.state = "active";
			entry.submittedAtMs = atMs;
			this.activeQuery = index;
			this.nextQuery = (index + 1) % this.queries.length;
			return true;
		}
		return false;
	}

	/** End only the query begun by `beginGpuFrame`; never waits for it. */
	endGpuFrame(): void {
		if (this.activeQuery === null || !this.extension) return;
		this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
		this.queries[this.activeQuery].state = "pending";
		this.activeQuery = null;
	}

	/** Poll pending queries without asking for a result until it is available. */
	poll(atMs = this.now()): boolean {
		if (!this.enabled || this.contextLost || !this.extension) return false;
		if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT)) {
			this.gpuSamples.clear();
			this.lastDisjointAtMs = atMs;
			// Results from every allocated query are now untrustworthy. Recreate the
			// small ring instead of reusing a possibly still-pending query object.
			if (!this.disjointActive) {
				this.disjointActive = true;
				this.disposeQueries();
				this.allocateQueries();
			}
			return true;
		}
		this.disjointActive = false;
		for (const entry of this.queries) {
			if (entry.state !== "pending") continue;
			const available = this.gl.getQueryParameter(
				entry.query,
				this.gl.QUERY_RESULT_AVAILABLE,
			);
			if (!available) continue;
			const nanoseconds = Number(
				this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT),
			);
			entry.state = "idle";
			const submittedAtMs = entry.submittedAtMs ?? atMs;
			entry.submittedAtMs = null;
			if (!Number.isFinite(nanoseconds) || nanoseconds < 0) continue;
			this.gpuSamples.push({
				valueMs: nanoseconds / 1_000_000,
				submittedAtMs,
			});
		}
		return false;
	}

	/** Deep-frozen state suitable for diagnostics or a later control policy. */
	snapshot(atMs = this.now()): FrameAttributionSnapshot {
		this.poll(atMs);
		const cpu = {} as Record<CpuInterval, RollingStatistics>;
		for (const name of CPU_INTERVALS)
			cpu[name] = rollingStatistics(this.cpuSamples.get(name)?.ordered() ?? []);

		const gpuSamples = this.gpuSamples.ordered();
		const latest = gpuSamples.reduce<GpuSample | null>(
			(newest, sample) =>
				!newest || sample.submittedAtMs > newest.submittedAtMs
					? sample
					: newest,
			null,
		);
		const sampleAgeMs = latest
			? Math.max(0, atMs - latest.submittedAtMs)
			: null;
		const supported =
			this.enabled && !this.contextLost && this.extension !== null;
		let status: GpuTimingStatus = "unavailable";
		if (supported) {
			if (
				this.lastDisjointAtMs !== null &&
				(!latest || this.lastDisjointAtMs >= latest.submittedAtMs)
			)
				status = "disjoint";
			else if (
				!latest ||
				sampleAgeMs === null ||
				sampleAgeMs > this.staleAfterMs
			)
				status = "stale";
			else status = "supported";
		}

		const gpuStats = rollingStatistics(
			gpuSamples.map((sample) => sample.valueMs),
		);
		const facts = frozenFacts(this.rendererFacts());
		const rendererApi = this.readStringParameter(this.gl.RENDERER);
		const rasterizer = this.debugRenderer
			? this.readStringParameter(this.debugRenderer.UNMASKED_RENDERER_WEBGL)
			: null;
		return Object.freeze({
			enabled: this.enabled,
			cpu: Object.freeze(cpu),
			gpu: Object.freeze({
				...gpuStats,
				status,
				supported,
				sampleAgeMs,
			}),
			renderer: Object.freeze({
				...facts,
				api: rendererApi,
				rasterizer,
			}),
		});
	}

	private allocateQueries(): void {
		this.disposeQueries();
		this.extension = this.gl.getExtension(
			"EXT_disjoint_timer_query_webgl2",
		) as TimerQueryExtension | null;
		this.debugRenderer = this.gl.getExtension(
			"WEBGL_debug_renderer_info",
		) as DebugRendererExtension | null;
		if (!this.extension) return;
		for (let i = 0; i < this.maxQueries; i++) {
			const query = this.gl.createQuery();
			if (!query) {
				this.disposeQueries();
				this.extension = null;
				return;
			}
			this.queries.push({ query, state: "idle", submittedAtMs: null });
		}
	}

	private disposeQueries(): void {
		if (this.activeQuery !== null && this.extension) {
			try {
				this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
			} catch {
				// A lost context may already have invalidated the active query.
			}
		}
		for (const entry of this.queries) {
			try {
				this.gl.deleteQuery(entry.query);
			} catch {
				// Deletion on a lost context is best-effort; references are dropped below.
			}
		}
		this.queries = [];
		this.activeQuery = null;
		this.nextQuery = 0;
	}

	private resetSamples(): void {
		for (const samples of this.cpuSamples.values()) samples.clear();
		this.gpuSamples.clear();
		this.lastDisjointAtMs = null;
		this.disjointActive = false;
	}

	private readStringParameter(parameter: number): string | null {
		const value = this.gl.getParameter(parameter);
		return typeof value === "string" && value.length > 0 ? value : null;
	}

	private readonly onContextLost = () => {
		if (!this.enabled) return;
		this.contextLost = true;
		this.disposeQueries();
		this.extension = null;
		this.debugRenderer = null;
		this.resetSamples();
	};

	private readonly onContextRestored = () => {
		if (!this.enabled) return;
		this.contextLost = false;
		this.resetSamples();
		this.allocateQueries();
	};
}
