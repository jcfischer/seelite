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

import { rollingStatistics } from "./frame-statistics.js";
import { GPU_TIMING_STATUSES } from "./gpu-timing-status.js";

export { rollingStatistics } from "./frame-statistics.js";

export const CPU_INTERVALS = [
	"simulation/step",
	"render submission/composer",
] as const;

export type CpuInterval = (typeof CPU_INTERVALS)[number];
/**
 * Derived from the runtime list rather than declared beside it: the two were
 * two copies for a round, with `checkJs` off so nothing compared them.
 */
export type GpuTimingStatus = (typeof GPU_TIMING_STATUSES)[number];

/**
 * Backends whose `EXT_disjoint_timer_query_webgl2` does not measure the work
 * between its own tokens, matched against `UNMASKED_RENDERER_WEBGL`.
 *
 * **ANGLE's Metal backend sums command-buffer wall spans.** `QueryMtl.mm`
 * flushes at `begin` and `end` to get clean boundaries, and
 * `mtl_command_buffer.mm` then accumulates, per command buffer,
 * `[buf GPUEndTime] - [buf GPUStartTime]` into the entry the query owns. A sum
 * of spans is at least the busy time and is strictly more wherever two spans
 * overlap or one contains a wait, so a frame whose work spans several command
 * buffers is reported as the sum of their whole durations.
 *
 * **The figures are not restated here.**
 * `scripts/measure-gpu-timer-calibration.mjs` is the owner: it measures the
 * span, the gain and the floor on the machine it runs on and prints them, so
 * there is no shipped copy to go stale. What is worth knowing without running
 * it is the *shape* — the over-report is a gain that **grows with how much of
 * the frame the work spans**, and a workload small enough to fit one command
 * buffer reads far below the excess, which **bounds** a fixed cost per query
 * from above and leaves the summing. It does not show the timer accurate: the
 * fenced figure that arm is read against is mostly the fence, so an inflated
 * reading hidden beneath it would look the same. The magnitude is measured
 * rather than derived: how many command buffers a composer render spans is not
 * known.
 *
 * **A name match is the right shape here even though it is brittle**, and the
 * two reasons are the mechanism and the alternative. The defect is a property
 * of the backend rather than of a machine, so the backend is what identifies
 * it; and the runtime check below cannot stand alone, because the over-report
 * is a *ratio* — at a cheap framing three times a 2 ms frame is still inside
 * the cadence and passes. This repo already keys measurement on the rasterizer
 * name in `scripts/lib/players-renderer.mjs`; this is that practice inside the
 * module. `scripts/measure-gpu-timer-calibration.mjs` is how a later ANGLE gets
 * re-qualified and this list shortened.
 */
export const SUMMING_TIMER_BACKENDS: readonly Readonly<{
	match: string;
	reason: string;
}>[] = Object.freeze([
	Object.freeze({
		match: "ANGLE Metal",
		reason:
			"ANGLE Metal sums the wall spans of every command buffer open while " +
			"a timer query is, rather than timing the work between its tokens, " +
			"so a frame reads several times its cost — run " +
			"scripts/measure-gpu-timer-calibration.mjs for this machine's figures",
	}),
]);

export const IMPLAUSIBLE_CADENCE_FACTOR = 1.25;

/**
 * How many GPU samples the window needs before a cadence contradiction counts.
 *
 * The physical argument — a GPU cannot spend longer per frame than the interval
 * between frames — holds of a **sustained** state and not of a burst, and the
 * first version of the check made the claim off a rolling median with no floor
 * under its sample count. Two or three slow frames from a jump or a bake would
 * have been reported as an impossibility. This is not a calibrated figure; it
 * is a count large enough that a handful of frames cannot reach it.
 */
export const IMPLAUSIBLE_MIN_SAMPLES = 8;

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
			/**
			 * The extension is present and the sampler is live.
			 *
			 * Deliberately **not** "the number can be believed": those are
			 * different questions and #246 is the case where they part. A caller
			 * that wants a usable figure reads `status === "supported"`, or reads
			 * `medianMs`, which is `null` under every refusal.
			 */
			supported: boolean;
			/** Why a refused status was chosen; `null` when nothing is refused. */
			reason: string | null;
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
	/**
	 * When each enabled frame began, whether or not it got a query.
	 *
	 * The ring skips a frame when every entry is pending, so a cadence derived
	 * from `submittedAtMs` is the interval between *timed* frames — two or three
	 * times the real one when the sampler is busiest, which is exactly when the
	 * implausibility check would be dividing by it.
	 */
	private readonly frameMarks: SampleRing<number>;

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
		this.frameMarks = new SampleRing(this.sampleCapacity);
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
		// Before the ring is consulted: a frame the ring refuses is still a frame,
		// and the cadence is what the *frames* ran at.
		this.frameMarks.push(atMs);
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

		let gpuStats = rollingStatistics(
			gpuSamples.map((sample) => sample.valueMs),
		);
		const facts = frozenFacts(this.rendererFacts());
		const rendererApi = this.readStringParameter(this.gl.RENDERER);
		const rasterizer = this.debugRenderer
			? this.readStringParameter(this.debugRenderer.UNMASKED_RENDERER_WEBGL)
			: null;

		/**
		 * The span the retained GPU samples were submitted over. The cadence is
		 * measured across the same span, so the two sides of the implausibility
		 * comparison describe one stretch of time rather than two.
		 */
		const submissions = gpuSamples.map((sample) => sample.submittedAtMs);
		const trust = this.classifyTrust(status, rasterizer, gpuStats, {
			fromMs: submissions.length ? Math.min(...submissions) : atMs,
			toMs: submissions.length ? Math.max(...submissions) : atMs,
		});
		status = trust.status;
		const reason = trust.reason;
		gpuStats = trust.gpuStats;

		return Object.freeze({
			enabled: this.enabled,
			cpu: Object.freeze(cpu),
			gpu: Object.freeze({
				...gpuStats,
				status,
				supported,
				reason,
				sampleAgeMs,
			}),
			renderer: Object.freeze({
				...facts,
				api: rendererApi,
				rasterizer,
			}),
		});
	}

	/**
	 * Whether this snapshot's figure can be stood behind, and what to say when
	 * it cannot — #246.
	 *
	 * Lifted out of `snapshot()`, which had grown the whole policy inline
	 * beside the assembly of the object it returns.
	 *
	 * **Both refusals are keyed on whether there is a figure**, not on which
	 * sample state the module landed in. Two rounds found the same fail-open
	 * one level apart: gated on `status === "supported"`, a backend whose last
	 * sample had aged past `staleAfterMs` fell through to `stale` and printed
	 * the very figure the refusal exists to withhold — round 1 for the named
	 * backend, round 2 for the cadence backstop covering the ones nobody has
	 * named. `stale` reads as *old but real*, which is the status a leak hides
	 * best in.
	 *
	 * **`disjoint` is excluded, and that is not the same argument.** It clears
	 * the samples, so no figure leaks either way — but it is a distinct and
	 * more actionable state, and classifying over it meant a disjoint event on
	 * a summing backend was reported as `untrusted` and the query invalidation
	 * disappeared from the snapshot. Round 4.
	 */
	private classifyTrust(
		status: GpuTimingStatus,
		rasterizer: string | null,
		gpuStats: RollingStatistics,
		window: { fromMs: number; toMs: number },
	): {
		status: GpuTimingStatus;
		reason: string | null;
		gpuStats: RollingStatistics;
	} {
		const withheld = (next: GpuTimingStatus, reason: string) => ({
			// **A status instead of a number, not beside one.** A refused figure
			// that is still printed is one that gets transcribed into a receipt.
			status: next,
			reason,
			gpuStats: {
				medianMs: null,
				p95Ms: null,
				sampleCount: gpuStats.sampleCount,
			},
		});
		const kept = { status, reason: null, gpuStats };
		if (status === "unavailable" || status === "disjoint") return kept;

		const backend = SUMMING_TIMER_BACKENDS.find((entry) =>
			(rasterizer ?? "").includes(entry.match),
		);
		if (backend) return withheld("untrusted", backend.reason);
		/**
		 * An unreadable name is **unproven, not qualified**. The first version
		 * read it as qualified — `(rasterizer ?? "")` matches nothing, so a
		 * context with no `WEBGL_debug_renderer_info` was handed a figure it
		 * could not stand behind. `capture-views.mjs` settles the same
		 * condition the same way from the other side.
		 */
		if (rasterizer === null)
			return withheld(
				"untrusted",
				"the renderer name could not be read, so the backend cannot be " +
					"qualified — run scripts/measure-gpu-timer-calibration.mjs to " +
					"see what this one reports",
			);

		if (gpuStats.medianMs === null) return kept;
		/**
		 * **A burst is not a steady state, and only a steady state is
		 * impossible.** The first version refused on the median alone and said
		 * the reading "cannot be sustained" — but a genuine transient backlog,
		 * a jump or a bake landing in a short window, can put a rolling median
		 * over the cadence honestly. Requiring the window to be full-ish is
		 * what makes "sustained" a claim about the samples rather than a
		 * sentence attached to them; the reason below says what was observed
		 * and no more.
		 */
		if (gpuStats.sampleCount < IMPLAUSIBLE_MIN_SAMPLES) return kept;
		const cadenceMs = this.frameCadenceMs(window.fromMs, window.toMs);
		if (
			cadenceMs !== null &&
			gpuStats.medianMs > cadenceMs * IMPLAUSIBLE_CADENCE_FACTOR
		)
			/**
			 * Neither the median nor the cadence, because their product is the
			 * median. Round 2 caught the ratio-and-cadence version
			 * reconstructing exactly what the sentence refuses to print.
			 */
			return withheld(
				"implausible",
				`over the last ${gpuStats.sampleCount} samples the GPU median ran ` +
					`more than ${IMPLAUSIBLE_CADENCE_FACTOR}x the frame cadence, ` +
					`which one command stream cannot sustain — a long enough ` +
					`backlog would read the same way, and the figure is withheld ` +
					`either way`,
			);
		return kept;
	}

	/**
	 * Median interval between enabled frames **within `[fromMs, toMs]`**, or
	 * `null` before there are two of them in that span.
	 *
	 * The window is an argument because the two rings advance independently and
	 * the first version compared across them: the GPU samples could be minutes
	 * old while the frame marks were current, so eight honest 50 ms samples
	 * taken during a 40 ms cadence, followed by a stretch of unresolved queries
	 * at 16 ms, were compared against the 16 and refused. Aligning the cadence
	 * to the samples' own submission span is what makes the comparison one
	 * measurement rather than two.
	 *
	 * A median rather than a mean because one long frame — a jump, a bake, a
	 * tab restored — is exactly the sample that would otherwise raise the bar
	 * the implausibility check has to clear.
	 */
	private frameCadenceMs(fromMs: number, toMs: number): number | null {
		const marks = this.frameMarks
			.ordered()
			.filter((mark) => mark >= fromMs && mark <= toMs);
		if (marks.length < 2) return null;
		const gaps: number[] = [];
		for (let i = 1; i < marks.length; i++) {
			const gap = marks[i] - marks[i - 1];
			if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
		}
		if (!gaps.length) return null;
		// `rollingStatistics` rather than a local midpoint: `frame-statistics.ts`
		// exists so the sampler and the headed instrument share one percentile
		// policy, and a second rule here would put two of them in one snapshot.
		return rollingStatistics(gaps).medianMs;
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
		// The cadence ring too, and it was the one ring left out. A sampler
		// re-enabled in a 40 ms scene after a 16 ms one would have compared fresh
		// GPU samples against a cadence blended from the previous enabled period
		// for up to `sampleCapacity` frames, which is `implausible` firing on a
		// frame rate that no longer exists.
		this.frameMarks.clear();
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
