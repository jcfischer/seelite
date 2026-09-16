/**
 * Auto render scale: hold a declared 60 fps floor by choosing a rung.
 *
 * ## What steers this, and why it is not the GPU timer
 *
 * #225 specified this controller on GPU evidence from `frame-attribution.ts`,
 * and that cannot work on the renderer the principal plays: ANGLE Metal sums
 * command-buffer spans rather than timing the work between its tokens, so the
 * module refuses the figure and reports `untrusted` with a `null` median
 * (#246). A controller that acts only on a trusted GPU median therefore never
 * acts at all on that machine, which is the machine the 60 fps goal is about.
 * #225 closed on that finding; this is its replacement, and it steers on the
 * **delivered frame period** instead.
 *
 * #223 forbade exactly that ("no rAF-only controller"), for three reasons. Each
 * is answered rather than waved past:
 *
 * - *vsync hides headroom* — only **at the panel's cap**, which is a state this
 *   module detects and handles by trial rather than by prediction;
 * - *throttling changes cadence* — that is the hidden tab, and it is a
 *   non-action here;
 * - *a missed frame does not say whether the CPU or the GPU caused it* — true,
 *   and moot: #242 measured 97.5% of a planet-fill frame as fill-rate, and
 *   #352's own fit puts it at 91.4% and 101.1% on the principal's two displays.
 *   Where essentially all of the cost scales with pixels, the lever works
 *   whichever side submitted them.
 *
 * ## What Auto is worth, which is not what it sounds like
 *
 * It is **not** how the game reaches 60 fps. Measured over a venusian filling
 * the view, manual 50% already does that on both of the principal's displays,
 * and 75% does on the laptop. Auto's value is keeping **100%** in a cheap scene
 * and paying softness only where a planet is actually in frame. A reading of
 * this module that treats a downshift as a failure has it backwards; the
 * downshift is the product.
 *
 * ## Two regimes, and the one place the design is non-obvious
 *
 * **At the cap, a frame period says nothing about headroom.** The principal's
 * external panel at 50% reads 16.67 ms and his laptop reads 8.33 ms at the very
 * same rung — the first is a 60 Hz cap and the second a 120 Hz one, and both
 * frames have room to spare. So "16.67 ms" is simultaneously *exactly the 60 fps
 * budget* and *a number that could mean anything under it*.
 *
 * What separates them is the **cheapest period seen since the last prime**.
 * `requestAnimationFrame` cannot deliver faster than the display refreshes, so
 * the minimum is a hard floor and a robust estimate of the panel's own period —
 * you cannot get a lucky fast frame past vsync. A rung is *at cap* when its
 * median sits within `CAP_TOLERANCE` of that floor.
 *
 * That test is consulted **only on the upshift path**, and it is sound there for
 * a reason worth stating, because it is not sound everywhere. Consider a frame
 * that never once reaches vsync — a 33 ms median against a 30 ms minimum. The
 * ratio says "at cap" and the panel is nowhere near it. But an upshift is only
 * ever considered while the median is comfortably *under* budget, and a median
 * under 16.67 ms with a minimum within 5% of it means the minimum is under
 * 16.67 ms too, which on any panel this game runs on is the refresh interval.
 * The false reading exists and cannot be reached from the branch that reads it.
 *
 * ## Why a prediction may gate a trial and never promote a rung
 *
 * Below the cap the period is real, so two rungs' worth of it solve
 * `t(s) = fixed + fill * s^2` and the solution predicts the rung above. Without
 * that gate the laptop oscillates: 75% reads 10.5 ms, comfortably inside budget,
 * so the controller steps to 100%, finds 18.9 ms, and steps back — a visible
 * sharpness flip every cooldown, for ever, each time reverting.
 *
 * The prediction **refuses** a trial and never grants one. A fitted curve is an
 * inference from two points on a frame whose content is changing underneath it,
 * and this repo has been here before: a figure predicted from a closed form sat
 * in a ratified spec as though it had been measured, and was out by 5%. So a
 * promotion is always settled by actually rendering at the rung and reading what
 * came back, with a revert and a lengthening back-off when it misses.
 *
 * ## No GL, no DOM, no clock of its own
 *
 * Everything arrives through `step`. That is what lets the whole policy — every
 * rung, threshold, gate, cooldown and back-off — be exercised headless against a
 * scripted pressure sequence, which is the only tier that can prove a
 * controller does not oscillate.
 */

/**
 * The rungs, absolute and in descending order.
 *
 * **Absolute, never a factor on the player's manual choice.** Two owners of one
 * multiplier is the arrangement that once had the perf panel and the settings
 * screen each applying half of `renderScale` (`light-rig.ts`), and a second
 * multiplier here would be that again with the second owner adaptive and
 * invisible in a diff.
 */
export const RENDER_SCALE_LADDER = [1, 0.75, 0.5] as const;

export type RenderScaleRung = (typeof RENDER_SCALE_LADDER)[number];

/**
 * The declared floor, in frames per second.
 *
 * **Declared, and deliberately not the panel's cadence.** A budget derived from
 * stable display cadence — which is what #225 asked for — reads 120 fps on the
 * principal's laptop and 60 on his external display. Targeting the first means
 * an 8.33 ms budget, which nothing but empty sky meets, so Auto would hold 50%
 * permanently on the better of the two machines. The goal is 60 fps; 60 is the
 * number.
 */
export const ADAPTIVE_TARGET_FPS = 60;

export const ADAPTIVE_BUDGET_MS = 1000 / ADAPTIVE_TARGET_FPS;

/**
 * How far over budget a median must sit before it counts as pressure.
 *
 * A panel running at exactly 60 Hz delivers 16.67 ms when it is keeping up
 * perfectly, and floating-point and scheduler jitter put a good number of those
 * frames a hair above the budget. Without a margin, a display that is meeting
 * the target exactly would read as failing it on about half its frames.
 */
export const DOWNSHIFT_TRIGGER_MS = ADAPTIVE_BUDGET_MS * 1.05;

/**
 * How much of the budget a predicted rung must leave spare to be worth trying.
 *
 * Asymmetric against the trigger above on purpose: a rung that is predicted to
 * land at 16 ms is inside budget and one bad frame from being out of it, and the
 * cost of guessing wrong on the way up is a visible flip and a revert, while the
 * cost of staying is a slightly softer picture nobody is looking for.
 */
export const UPSHIFT_HEADROOM = 0.85;

/** A median within this fraction of the cheapest period is pinned by vsync. */
export const CAP_TOLERANCE = 0.05;

/**
 * Frames of agreement before a step, and how long a step is left alone after.
 *
 * The median arriving in `step` already spans the sampler's ring, so these
 * counts are agreement *on top of* a windowed statistic rather than a window of
 * their own. Down is prompt because the player is currently below the floor;
 * up is slow because nobody is waiting for it and the wrong answer is visible.
 */
export const MIN_SAMPLES = 30;
export const DOWNSHIFT_FRAMES = 30;
export const UPSHIFT_FRAMES = 120;
export const COOLDOWN_MS = 1_500;

/**
 * How much longer to wait before each retry after a trial reverted.
 *
 * A scene that will not hold the rung above is the common case — a planet stays
 * in frame for as long as the player is flying to it — and without a back-off
 * the controller retries it every `COOLDOWN_MS` for the whole approach, each
 * attempt a visible flip. The cap stops the wait growing past the length of a
 * plausible sitting.
 */
export const TRIAL_BACKOFF_FACTOR = 2;
export const TRIAL_BACKOFF_CAP_MS = 60_000;

/**
 * How long a rung's measured period stays usable as a point on the curve.
 *
 * **It must outlive the back-off, and the first figure here did not.** At ten
 * seconds, tracing the laptop's own curve showed the gate answering `unknown`
 * at every retry: the point for the rung above was taken at the revert, the
 * back-off then waited 1.5 s, 3 s, 6 s, and by the third wait the point that
 * recorded the refusal had aged out. So the gate never fired in the one case it
 * was written for, the back-off was the only thing pacing the flips, and the
 * curve was a term that ran and decided nothing.
 *
 * Matched to `TRIAL_BACKOFF_CAP_MS` instead, so the memory of a refusal lasts
 * at least as long as the longest wait between retries.
 *
 * The cost of the longer window is a stale point refusing an upshift the
 * machine could now hold — and the case that would matter, a scene that got
 * cheap, does not reach it: a cheap rung is pinned at vsync, `atCap` is true,
 * and the gate returns `unknown` before it reads a point at all. What remains
 * is a scene that got *somewhat* cheaper without reaching the cap, where the
 * stale fit is wrong in the same direction as the truth and refuses a rung that
 * is still over budget.
 */
export const OBSERVATION_TTL_MS = TRIAL_BACKOFF_CAP_MS;

/** What `step` is told about the frame. Every field comes from the caller. */
export type AdaptiveEvidence = Readonly<{
	nowMs: number;
	/** Rolling median delivered frame period; `null` when there is none. */
	periodMedianMs: number | null;
	/** Cheapest period since the last prime; `null` when there is none. */
	minPeriodMs: number | null;
	/** How many periods the median was taken over. */
	sampleCount: number;
	/** The tab is not being composited. Every such frame is a non-action. */
	hidden: boolean;
}>;

/**
 * Whether the fitted curve has anything to say about the rung above.
 *
 * `unknown` is its own answer rather than a lean either way. From a cold start
 * the controller has observed exactly one rung, so there is no curve at all —
 * collapsing that into `fits` grants every first upshift unexamined, and into
 * `misses` means a session that starts at 50% never climbs out of it.
 */
export type UpshiftGate = "unknown" | "fits" | "misses";

export type AdaptiveTransition =
	| "none"
	| "down"
	| "up-trial"
	| "up-accepted"
	| "up-reverted";

export type AdaptiveDiagnostics = Readonly<{
	scale: number;
	budgetMs: number;
	periodMedianMs: number | null;
	minPeriodMs: number | null;
	sampleAgeFrames: number;
	atCap: boolean;
	gate: UpshiftGate;
	predictedMs: number | null;
	reason: string;
	cooldownRemainingMs: number;
	trialBackoffMs: number;
	observations: Readonly<Record<string, number>>;
}>;

export type AdaptiveDecision = Readonly<{
	scale: number;
	transition: AdaptiveTransition;
	/**
	 * The caller must throw away the retained frame periods.
	 *
	 * Set on every accepted rung change, because the periods in the ring were
	 * delivered at the *previous* rung and describe a frame that no longer
	 * exists. Left to blend out on its own, a 33 ms history would hold a
	 * freshly-halved frame over the downshift trigger for another ring's worth
	 * of frames and step it down again.
	 */
	reprime: boolean;
	reason: string;
}>;

type Observation = { periodMs: number; atMs: number };

export type AdaptiveResolutionOptions = {
	/** Where to start. Defaults to the top rung. */
	initialScale?: RenderScaleRung;
};

export class AdaptiveResolution {
	private index: number;
	private overBudgetFrames = 0;
	private underBudgetFrames = 0;
	private cooldownUntilMs = Number.NEGATIVE_INFINITY;
	private trialBackoffMs = 0;
	private trial: { fromIndex: number; startedAtMs: number } | null = null;
	private reason = "primed";
	private lastGate: UpshiftGate = "unknown";
	private lastPredictedMs: number | null = null;
	private lastEvidence: AdaptiveEvidence | null = null;
	/**
	 * One below-cap period per rung, keyed by the rung itself.
	 *
	 * **Only below-cap observations are recorded**, and that is a censoring
	 * question rather than tidiness: a rung pinned at vsync cost *at most* what
	 * it appeared to, so feeding 16.67 ms into the fit as though it were the
	 * frame's cost makes a cheap rung look expensive and biases every prediction
	 * toward refusing an upshift the machine could easily hold.
	 *
	 * The map is cleared by `prime`, because the fit is **per display**: the
	 * principal's two panels differ by 2.02x in cost per pixel at an identical
	 * device pixel ratio of 2.00, so a curve solved on one predicts nothing
	 * about the other.
	 */
	private readonly observations = new Map<number, Observation>();

	constructor(options: AdaptiveResolutionOptions = {}) {
		const initial = options.initialScale ?? RENDER_SCALE_LADDER[0];
		const index = RENDER_SCALE_LADDER.indexOf(initial);
		if (index < 0) throw new RangeError("initialScale must be a ladder rung");
		this.index = index;
	}

	get scale(): number {
		return RENDER_SCALE_LADDER[this.index];
	}

	/**
	 * Forget everything measured and start again at the current rung.
	 *
	 * For a resize, a move between displays, a tab restored from hidden, or a
	 * WebGL context that came back. Each of those makes every retained figure a
	 * measurement of a world that is gone; the fit above says why the display
	 * case in particular cannot be papered over.
	 *
	 * The rung itself is **kept**. Dropping back to 100% on a resize would give
	 * the player a stutter every time they dragged a window edge, and the rung
	 * that was right a moment ago remains the best guess available.
	 */
	prime(reason = "primed"): void {
		this.overBudgetFrames = 0;
		this.underBudgetFrames = 0;
		this.cooldownUntilMs = Number.NEGATIVE_INFINITY;
		this.trialBackoffMs = 0;
		this.trial = null;
		this.observations.clear();
		this.lastGate = "unknown";
		this.lastPredictedMs = null;
		this.lastEvidence = null;
		this.reason = reason;
	}

	step(evidence: AdaptiveEvidence): AdaptiveDecision {
		this.lastEvidence = evidence;
		const hold = (reason: string): AdaptiveDecision => {
			this.reason = reason;
			return Object.freeze({
				scale: this.scale,
				transition: "none" as const,
				reprime: false,
				reason,
			});
		};

		// Every insufficient-evidence state is a non-action, and each is named
		// separately so a diagnostic says which one the controller is in rather
		// than reporting one undifferentiated "waiting".
		if (evidence.hidden) {
			// The counters too: frames that were never composited must not
			// accumulate toward a decision when the tab comes back.
			this.overBudgetFrames = 0;
			this.underBudgetFrames = 0;
			return hold("hidden tab");
		}
		const median = evidence.periodMedianMs;
		if (median === null || !Number.isFinite(median) || median <= 0)
			return hold("no frame period");
		if (evidence.sampleCount < MIN_SAMPLES)
			return hold(`priming (${evidence.sampleCount}/${MIN_SAMPLES} frames)`);

		const atCap = this.atCap(median, evidence.minPeriodMs);
		if (!atCap)
			this.observations.set(this.scale, {
				periodMs: median,
				atMs: evidence.nowMs,
			});

		// A trial is resolved before anything else can be decided: until it has
		// an answer, the rung the controller is standing on is not settled.
		if (this.trial) return this.resolveTrial(evidence, median);

		if (median > DOWNSHIFT_TRIGGER_MS) {
			this.underBudgetFrames = 0;
			this.overBudgetFrames++;
			if (this.overBudgetFrames < DOWNSHIFT_FRAMES)
				return hold(
					`over budget (${this.overBudgetFrames}/${DOWNSHIFT_FRAMES})`,
				);
			if (this.index >= RENDER_SCALE_LADDER.length - 1)
				return hold("over budget at the lowest rung");
			// **No cooldown gate on the way down.** The player is below the
			// declared floor right now, and the asymmetry is the point: a
			// cooldown exists to stop a rung being retried, not to make someone
			// wait out a bad frame rate.
			this.overBudgetFrames = 0;
			this.index++;
			this.cooldownUntilMs = evidence.nowMs + COOLDOWN_MS;
			return this.transition(
				"down",
				`${median.toFixed(1)} ms over ${DOWNSHIFT_TRIGGER_MS.toFixed(1)} ms`,
			);
		}

		this.overBudgetFrames = 0;
		if (this.index === 0) return hold("at the top rung");
		this.underBudgetFrames++;
		if (this.underBudgetFrames < UPSHIFT_FRAMES)
			return hold(`headroom (${this.underBudgetFrames}/${UPSHIFT_FRAMES})`);
		if (evidence.nowMs < this.cooldownUntilMs)
			return hold(
				`cooling down (${Math.round(this.cooldownUntilMs - evidence.nowMs)} ms)`,
			);

		const gate = this.gate(atCap);
		this.lastGate = gate.state;
		this.lastPredictedMs = gate.predictedMs;
		if (gate.state === "misses") {
			// Not a revert, so no back-off — nothing was flipped and the player
			// saw nothing. The counter resets so the next attempt is another
			// full stretch of headroom away.
			this.underBudgetFrames = 0;
			this.cooldownUntilMs = evidence.nowMs + COOLDOWN_MS;
			return hold(
				`the rung above is predicted at ${gate.predictedMs?.toFixed(1)} ms`,
			);
		}

		this.underBudgetFrames = 0;
		this.trial = { fromIndex: this.index, startedAtMs: evidence.nowMs };
		this.index--;
		return this.transition(
			"up-trial",
			gate.state === "unknown"
				? "trying the rung above with no curve yet"
				: `the rung above is predicted at ${gate.predictedMs?.toFixed(1)} ms`,
		);
	}

	get diagnostics(): AdaptiveDiagnostics {
		const observations: Record<string, number> = {};
		for (const [scale, observation] of this.observations)
			observations[scale.toFixed(2)] = observation.periodMs;
		const now = this.lastEvidence?.nowMs ?? 0;
		return Object.freeze({
			scale: this.scale,
			budgetMs: ADAPTIVE_BUDGET_MS,
			periodMedianMs: this.lastEvidence?.periodMedianMs ?? null,
			minPeriodMs: this.lastEvidence?.minPeriodMs ?? null,
			sampleAgeFrames: this.lastEvidence?.sampleCount ?? 0,
			atCap: this.atCap(
				this.lastEvidence?.periodMedianMs ?? null,
				this.lastEvidence?.minPeriodMs ?? null,
			),
			gate: this.lastGate,
			predictedMs: this.lastPredictedMs,
			reason: this.trial ? `trialling: ${this.reason}` : this.reason,
			cooldownRemainingMs: Math.max(
				0,
				this.cooldownUntilMs === Number.NEGATIVE_INFINITY
					? 0
					: this.cooldownUntilMs - now,
			),
			trialBackoffMs: this.trialBackoffMs,
			observations: Object.freeze(observations),
		});
	}

	/**
	 * A median pinned by vsync rather than by the frame's own cost.
	 *
	 * `null` evidence reads as not-at-cap, which is the safe direction: it makes
	 * the gate fall through to the fit, and the fit refuses when it has nothing.
	 */
	private atCap(medianMs: number | null, minPeriodMs: number | null): boolean {
		if (medianMs === null || minPeriodMs === null || minPeriodMs <= 0)
			return false;
		return medianMs <= minPeriodMs * (1 + CAP_TOLERANCE);
	}

	private resolveTrial(
		evidence: AdaptiveEvidence,
		median: number,
	): AdaptiveDecision {
		const trial = this.trial;
		if (!trial) throw new Error("resolveTrial without a trial");
		if (median > DOWNSHIFT_TRIGGER_MS) {
			this.overBudgetFrames++;
			if (this.overBudgetFrames < DOWNSHIFT_FRAMES)
				return Object.freeze({
					scale: this.scale,
					transition: "none" as const,
					reprime: false,
					reason:
						(this.reason = `trial over budget (${this.overBudgetFrames}/${DOWNSHIFT_FRAMES})`),
				});
			this.index = trial.fromIndex;
			this.trial = null;
			this.overBudgetFrames = 0;
			this.underBudgetFrames = 0;
			this.trialBackoffMs = Math.min(
				TRIAL_BACKOFF_CAP_MS,
				this.trialBackoffMs === 0
					? COOLDOWN_MS
					: this.trialBackoffMs * TRIAL_BACKOFF_FACTOR,
			);
			this.cooldownUntilMs = evidence.nowMs + this.trialBackoffMs;
			return this.transition(
				"up-reverted",
				`the rung above read ${median.toFixed(1)} ms; waiting ${Math.round(this.trialBackoffMs)} ms`,
			);
		}
		this.overBudgetFrames = 0;
		this.underBudgetFrames++;
		if (this.underBudgetFrames < DOWNSHIFT_FRAMES)
			return Object.freeze({
				scale: this.scale,
				transition: "none" as const,
				reprime: false,
				reason:
					(this.reason = `trial holding (${this.underBudgetFrames}/${DOWNSHIFT_FRAMES})`),
			});
		this.trial = null;
		this.underBudgetFrames = 0;
		// **The back-off is cleared on a success**, not merely left alone: a
		// scene that once refused the rung and now holds it is a different
		// scene, and making the player's next upshift wait out a penalty earned
		// on a planet they have since flown past is punishing the wrong frame.
		this.trialBackoffMs = 0;
		this.cooldownUntilMs = evidence.nowMs + COOLDOWN_MS;
		return this.transition(
			"up-accepted",
			`the rung above held at ${median.toFixed(1)} ms`,
		);
	}

	/**
	 * Solve `t(s) = fixed + fill * s^2` on the recorded rungs and read off the
	 * rung above.
	 *
	 * Two distinct rungs are the minimum, and they must be distinct in *scale*
	 * rather than merely two entries — one rung observed twice gives a singular
	 * system, and solving it anyway produces a confident number from a division
	 * by something near zero.
	 */
	private gate(atCap: boolean): {
		state: UpshiftGate;
		predictedMs: number | null;
	} {
		if (atCap) return { state: "unknown", predictedMs: null };
		const nowMs = this.lastEvidence?.nowMs ?? 0;
		const points = [...this.observations.entries()]
			.filter(
				([, observation]) => nowMs - observation.atMs <= OBSERVATION_TTL_MS,
			)
			.map(([scale, observation]) => ({
				scale,
				periodMs: observation.periodMs,
			}));
		if (points.length < 2) return { state: "unknown", predictedMs: null };
		// The two furthest apart, which is the best-conditioned pair available.
		points.sort((a, b) => a.scale - b.scale);
		const low = points[0];
		const high = points[points.length - 1];
		const denominator = high.scale ** 2 - low.scale ** 2;
		if (!(Math.abs(denominator) > 1e-6))
			return { state: "unknown", predictedMs: null };
		const fill = (high.periodMs - low.periodMs) / denominator;
		const fixed = low.periodMs - fill * low.scale ** 2;
		const target = RENDER_SCALE_LADDER[this.index - 1];
		const predictedMs = fixed + fill * target ** 2;
		if (!Number.isFinite(predictedMs))
			return { state: "unknown", predictedMs: null };
		return {
			state:
				predictedMs <= ADAPTIVE_BUDGET_MS * UPSHIFT_HEADROOM
					? "fits"
					: "misses",
			predictedMs,
		};
	}

	private transition(
		transition: AdaptiveTransition,
		reason: string,
	): AdaptiveDecision {
		this.reason = reason;
		// **The observations are kept across a rung change**, and the first
		// version of this method cleared them. That is not a tidy-up: a curve
		// needs two rungs, and the only way to observe a second one is to have
		// stood on it — so clearing here makes `gate` answer `unknown` for ever
		// and the prediction that exists to stop the laptop oscillating never
		// runs. What ages them out is `OBSERVATION_TTL_MS` in `gate`, which is
		// the right instrument: a stale point is stale because time passed and
		// the scene moved, not because a rung changed.
		return Object.freeze({
			scale: this.scale,
			transition,
			reprime: true,
			reason,
		});
	}
}
