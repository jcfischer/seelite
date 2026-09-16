import { describe, expect, test } from "bun:test";
import {
	ADAPTIVE_BUDGET_MS,
	AdaptiveResolution,
	type AdaptiveDecision,
	type AdaptiveEvidence,
	CAP_TOLERANCE,
	COOLDOWN_MS,
	DOWNSHIFT_FRAMES,
	DOWNSHIFT_TRIGGER_MS,
	MIN_SAMPLES,
	OBSERVATION_TTL_MS,
	RENDER_SCALE_LADDER,
	TRIAL_BACKOFF_CAP_MS,
	UPSHIFT_FRAMES,
	UPSHIFT_HEADROOM,
} from "../src/adaptive-resolution";

/**
 * The controller has no clock and no renderer, so a "flight" here is a list of
 * frame periods. `cost` is the caller's model of the machine: given a rung, what
 * the frame would take. That is the whole fixture — everything else is the
 * policy under test.
 */
function fly(
	controller: AdaptiveResolution,
	{
		frames,
		cost,
		minPeriodMs,
		startMs = 0,
		hidden = false,
	}: {
		frames: number;
		cost: (scale: number) => number;
		minPeriodMs?: (scale: number) => number;
		startMs?: number;
		hidden?: boolean;
	},
) {
	const decisions: AdaptiveDecision[] = [];
	let atMs = startMs;
	// A fresh controller has no samples; the caller's `sampleCount` climbs to
	// `MIN_SAMPLES` the way the sampler's ring does.
	let samples = 0;
	for (let frame = 0; frame < frames; frame++) {
		const scale = controller.scale;
		const period = cost(scale);
		samples = Math.min(120, samples + 1);
		const evidence: AdaptiveEvidence = {
			nowMs: atMs,
			periodMedianMs: period,
			minPeriodMs: minPeriodMs ? minPeriodMs(scale) : Math.min(period, 8.33),
			sampleCount: samples,
			hidden,
		};
		const decision = controller.step(evidence);
		decisions.push(decision);
		// A reprime empties the sampler's ring, so the caller's sample count
		// starts again — the controller is told so, and a fixture that ignored
		// it would let a decision ride on periods from the previous rung.
		if (decision.reprime) samples = 0;
		atMs += period;
	}
	return decisions;
}

/** The principal's external display, measured 2026-09-16 over a venusian. */
const EXTERNAL = (scale: number) => 2.86 + 30.48 * scale ** 2;
/** The principal's laptop panel, same subject, same session. */
const LAPTOP = (scale: number) => Math.max(8.33, -0.2 + 19.07 * scale ** 2);

describe("the ladder and the budget", () => {
	test("the rungs are the absolute set #352 fixed, descending", () => {
		expect(RENDER_SCALE_LADDER).toEqual([1, 0.75, 0.5]);
	});

	test("the budget is 60 fps and not a panel's cadence", () => {
		// The laptop's panel runs at 120 Hz. A budget derived from it would be
		// 8.33 ms, which nothing but empty sky meets.
		expect(ADAPTIVE_BUDGET_MS).toBeCloseTo(16.666, 2);
		expect(DOWNSHIFT_TRIGGER_MS).toBeGreaterThan(ADAPTIVE_BUDGET_MS);
	});

	test("a controller starts where it is told and rejects a rung that is not one", () => {
		expect(new AdaptiveResolution().scale).toBe(1);
		expect(new AdaptiveResolution({ initialScale: 0.5 }).scale).toBe(0.5);
		// @ts-expect-error 0.6 is not on the ladder, which is the point.
		expect(() => new AdaptiveResolution({ initialScale: 0.6 })).toThrow(
			RangeError,
		);
	});
});

describe("evidence that cannot be acted on is a non-action", () => {
	const cases: [string, Partial<AdaptiveEvidence>][] = [
		["no median at all", { periodMedianMs: null }],
		["a median that is not finite", { periodMedianMs: Number.NaN }],
		["a non-positive median", { periodMedianMs: 0 }],
		["too few samples", { sampleCount: MIN_SAMPLES - 1 }],
		["a hidden tab", { hidden: true }],
	];
	for (const [name, override] of cases) {
		test(`${name} never moves the rung`, () => {
			const controller = new AdaptiveResolution();
			for (let frame = 0; frame < DOWNSHIFT_FRAMES * 4; frame++) {
				const decision = controller.step({
					nowMs: frame * 40,
					// Far over budget, so only the override can be holding it.
					periodMedianMs: 40,
					minPeriodMs: 16.67,
					sampleCount: MIN_SAMPLES,
					hidden: false,
					...override,
				});
				expect(decision.transition).toBe("none");
				expect(decision.reprime).toBe(false);
			}
			expect(controller.scale).toBe(1);
		});
	}

	test("a hidden stretch does not bank frames toward a decision", () => {
		// The frames were never composited. Counting them would make the tab's
		// return a step down before a single visible frame was measured.
		const controller = new AdaptiveResolution();
		fly(controller, {
			frames: DOWNSHIFT_FRAMES * 2,
			cost: () => 40,
			hidden: true,
		});
		const visible = fly(controller, {
			frames: DOWNSHIFT_FRAMES - 1,
			cost: () => 40,
			startMs: 10_000,
		});
		expect(visible.every((d) => d.transition === "none")).toBe(true);
		expect(controller.scale).toBe(1);
	});
});

describe("stepping down", () => {
	test("a frame over budget steps down once the frames agree", () => {
		const controller = new AdaptiveResolution();
		const decisions = fly(controller, { frames: 400, cost: EXTERNAL });
		const downs = decisions.filter((d) => d.transition === "down");
		expect(downs.length).toBeGreaterThan(0);
		expect(downs[0].reprime).toBe(true);
		// 33.3 ms at 100% and 20.0 ms at 75% are both over the trigger, so the
		// external display lands on the bottom rung and stays there.
		expect(controller.scale).toBe(0.5);
	});

	test("it takes DOWNSHIFT_FRAMES of agreement, not one bad frame", () => {
		const controller = new AdaptiveResolution();
		// The first `MIN_SAMPLES - 1` frames are refused for want of samples, so
		// pressure is first counted on frame `MIN_SAMPLES - 1` and the step
		// lands `DOWNSHIFT_FRAMES - 1` frames after that. One frame short of it
		// is the last frame that must still be a non-action.
		const untilTheStep = MIN_SAMPLES - 1 + (DOWNSHIFT_FRAMES - 1);
		// One flight rather than two: `fly` counts the sampler's ring from zero
		// each call, so a second call's first frame is refused for want of
		// samples and the step never arrives.
		const decisions = fly(controller, {
			frames: untilTheStep + 1,
			cost: () => 40,
		});
		expect(
			decisions.slice(0, untilTheStep).every((d) => d.transition === "none"),
		).toBe(true);
		expect(decisions[untilTheStep].transition).toBe("down");
		expect(controller.scale).toBe(0.75);
	});

	test("one good frame in a bad stretch resets the count", () => {
		const controller = new AdaptiveResolution();
		let frame = 0;
		const decisions = fly(controller, {
			frames: MIN_SAMPLES + DOWNSHIFT_FRAMES * 3,
			// Every third frame is inside budget, so the run never reaches
			// DOWNSHIFT_FRAMES of consecutive pressure.
			cost: () => (frame++ % 3 === 2 ? 12 : 40),
		});
		expect(decisions.every((d) => d.transition !== "down")).toBe(true);
	});

	test("the bottom rung is the floor", () => {
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		fly(controller, { frames: 600, cost: () => 80 });
		expect(controller.scale).toBe(0.5);
		expect(RENDER_SCALE_LADDER.includes(controller.scale as 0.5)).toBe(true);
	});

	test("a step down is not gated by the cooldown a step up obeys", () => {
		// The player is under the floor now. A cooldown exists to stop a rung
		// being retried, not to make someone wait out a bad frame rate.
		const controller = new AdaptiveResolution();
		const decisions = fly(controller, { frames: 400, cost: EXTERNAL });
		const downIndices = decisions
			.map((d, i) => (d.transition === "down" ? i : -1))
			.filter((i) => i >= 0);
		expect(downIndices.length).toBe(2);
		// The second arrives well inside COOLDOWN_MS of the first: at 20 ms a
		// frame, DOWNSHIFT_FRAMES of them is 600 ms.
		expect(downIndices[1] - downIndices[0]).toBeLessThan(
			MIN_SAMPLES + DOWNSHIFT_FRAMES + 2,
		);
	});
});

describe("stepping up", () => {
	test("a cheap scene climbs back to the top rung", () => {
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		fly(controller, { frames: 4_000, cost: () => 6, minPeriodMs: () => 5.9 });
		expect(controller.scale).toBe(1);
	});

	test("an upshift is a trial first and only then accepted", () => {
		const controller = new AdaptiveResolution({ initialScale: 0.75 });
		const decisions = fly(controller, {
			frames: 2_000,
			cost: () => 6,
			minPeriodMs: () => 5.9,
		});
		const order = decisions
			.map((d) => d.transition)
			.filter((t) => t !== "none");
		expect(order[0]).toBe("up-trial");
		expect(order[1]).toBe("up-accepted");
	});

	test("a trial that misses reverts and does not flip again at once", () => {
		// 75% holds and 100% does not: the laptop's own shape.
		const controller = new AdaptiveResolution({ initialScale: 0.75 });
		const decisions = fly(controller, {
			frames: 3_000,
			cost: (scale) => (scale === 1 ? 30 : 10),
			minPeriodMs: () => 8.33,
		});
		const reverts = decisions.filter((d) => d.transition === "up-reverted");
		expect(reverts.length).toBeGreaterThan(0);
		expect(controller.scale).toBe(0.75);
		const trials = decisions.filter((d) => d.transition === "up-trial");
		// Each retry waits longer than the last, so a three-thousand-frame
		// flight holds only a handful of them.
		expect(trials.length).toBeLessThan(6);
	});

	test("the back-off lengthens and is capped", () => {
		const controller = new AdaptiveResolution({ initialScale: 0.75 });
		fly(controller, {
			frames: 20_000,
			cost: (scale) => (scale === 1 ? 30 : 10),
			minPeriodMs: () => 8.33,
		});
		expect(controller.diagnostics.trialBackoffMs).toBeGreaterThan(COOLDOWN_MS);
		expect(controller.diagnostics.trialBackoffMs).toBeLessThanOrEqual(
			TRIAL_BACKOFF_CAP_MS,
		);
	});

	test("a held trial clears the back-off earned on an earlier scene", () => {
		const controller = new AdaptiveResolution({ initialScale: 0.75 });
		fly(controller, {
			frames: 3_000,
			cost: (scale) => (scale === 1 ? 30 : 10),
			minPeriodMs: () => 8.33,
		});
		expect(controller.diagnostics.trialBackoffMs).toBeGreaterThan(0);
		// The planet is behind them now and everything is cheap.
		fly(controller, {
			frames: 20_000,
			cost: () => 6,
			minPeriodMs: () => 5.9,
			startMs: 200_000,
		});
		expect(controller.scale).toBe(1);
		expect(controller.diagnostics.trialBackoffMs).toBe(0);
	});
});

/**
 * The gate exists to stop one specific, visible defect, so it is tested by
 * building that defect's conditions and counting flips.
 */
describe("the prediction gate", () => {
	test("it refuses a rung the curve puts over budget", () => {
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		// The laptop over a venusian: 4.6 ms at 50%, 10.5 at 75%, 18.9 at 100%.
		// The first two are inside budget, so the curve is solvable and it says
		// the third is not.
		fly(controller, { frames: 6_000, cost: LAPTOP, minPeriodMs: () => 8.33 });
		expect(controller.scale).toBe(0.75);
		expect(controller.diagnostics.gate).toBe("misses");
		expect(controller.diagnostics.predictedMs).toBeGreaterThan(
			ADAPTIVE_BUDGET_MS * UPSHIFT_HEADROOM,
		);
	});

	test("the flight the gate exists for stops flipping after it has learned", () => {
		// The laptop over a venusian is the oscillation's exact shape: 75% reads
		// 10.5 ms, comfortably inside a 16.67 ms budget, so a controller with no
		// curve steps to 100%, finds 18.9 ms and steps back — for ever, once per
		// cooldown, each attempt a visible sharpness flip.
		//
		// **Two trials is what learning costs**, and they are unavoidable: 50%
		// is pinned at the panel's 8.33 ms, so it contributes no point, and a
		// machine cannot know what 100% costs without rendering one frame of it.
		// After those two the gate holds `misses` and nothing flips.
		//
		// **Checked against the build with no gate**, by editing `gate` to
		// answer `fits` unconditionally: this row then reads **6** trials
		// against the 2 below, and the scripted sequence at the foot of this
		// file reads **15** transitions against its ceiling of 6. The edit is
		// not kept — a permanent seam into a private method is production shape
		// bought for one assertion.
		//
		// The ungated figure is small here only because `fly` is a fixed number
		// of frames; the flips continue at one per cooldown for as long as the
		// scene lasts, where the gated build stops at two for ever.
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		const learning = fly(controller, {
			frames: 3_000,
			cost: LAPTOP,
			minPeriodMs: () => 8.33,
		});
		expect(learning.filter((d) => d.transition === "up-trial").length).toBe(2);
		expect(controller.scale).toBe(0.75);
		expect(controller.diagnostics.gate).toBe("misses");
		expect(controller.diagnostics.predictedMs).toBeCloseTo(18.87, 1);

		// **The long run is a re-check, not an oscillation.** A point expires at
		// `OBSERVATION_TTL_MS` and the scene may have changed since, so the
		// controller pays one trial to find out — at a rate set by that window
		// rather than by the cooldown. Over the 3.5 minutes below that is a
		// handful of brief flips, against one every 1.5 s ungated.
		const settled = fly(controller, {
			frames: 20_000,
			cost: LAPTOP,
			minPeriodMs: () => 8.33,
			startMs: 40_000,
		});
		const elapsedMs = 20_000 * LAPTOP(0.75);
		const trials = settled.filter((d) => d.transition === "up-trial").length;
		expect(trials).toBeLessThanOrEqual(
			Math.ceil(elapsedMs / OBSERVATION_TTL_MS) + 1,
		);
		expect(controller.scale).toBe(0.75);
	});

	test("one rung observed is `unknown`, and `unknown` allows a trial", () => {
		// A cold start has stood on exactly one rung. Refusing there would mean
		// a session that opens at 50% never climbs out of it; granting silently
		// would make every first upshift unexamined. It is its own answer and it
		// is settled by rendering, which is what a trial is.
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		const decisions = fly(controller, {
			frames: UPSHIFT_FRAMES + MIN_SAMPLES + 4,
			cost: () => 6,
			minPeriodMs: () => 5.9,
		});
		expect(decisions.some((d) => d.transition === "up-trial")).toBe(true);
	});

	test("a rung pinned at vsync contributes no point to the curve", () => {
		// Its true cost is *at most* what it appeared to be. Recorded as though
		// it were the frame's cost, a cheap rung looks expensive and every
		// prediction is biased toward refusing.
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		fly(controller, {
			frames: 2_000,
			// Every rung reads exactly the 60 Hz panel's period.
			cost: () => 16.67,
			minPeriodMs: () => 16.67,
		});
		expect(Object.keys(controller.diagnostics.observations)).toEqual([]);
		expect(controller.diagnostics.atCap).toBe(true);
	});

	test("a point older than its TTL is not fitted against a fresh one", () => {
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		fly(controller, { frames: 200, cost: LAPTOP, minPeriodMs: () => 8.33 });
		const before = { ...controller.diagnostics.observations };
		expect(Object.keys(before).length).toBeGreaterThan(0);
		// Long enough later that nothing measured before is about this scene.
		fly(controller, {
			frames: 200,
			cost: LAPTOP,
			minPeriodMs: () => 8.33,
			startMs: OBSERVATION_TTL_MS * 4,
		});
		expect(controller.diagnostics.gate).not.toBe("fits");
	});
});

describe("at the cap", () => {
	test("16.67 ms is at cap on a 60 Hz panel and headroom on a 120 Hz one", () => {
		// The single most confusable pair of readings in this design: one rung,
		// one number, opposite meanings. What separates them is **having seen
		// the panel run cheap**, which is the ordinary case — a player spends
		// most of a session in empty sky — and which the controller cannot
		// manufacture.
		const sixty = new AdaptiveResolution({ initialScale: 0.5 });
		fly(sixty, { frames: 200, cost: () => 16.67, minPeriodMs: () => 16.67 });
		expect(sixty.diagnostics.atCap).toBe(true);

		const oneTwenty = new AdaptiveResolution({ initialScale: 0.5 });
		// Empty sky first, at the 120 Hz panel's own rate.
		fly(oneTwenty, { frames: 200, cost: () => 8.33, minPeriodMs: () => 8.33 });
		fly(oneTwenty, {
			frames: 200,
			cost: () => 16.67,
			minPeriodMs: () => 8.33,
			startMs: 50_000,
		});
		expect(oneTwenty.diagnostics.atCap).toBe(false);
	});

	test("without a cheap frame it cannot tell them apart, and that is bounded", () => {
		// The documented failure of the estimator, asserted rather than left to
		// the header. A 120 Hz panel whose every observed frame cost 16.67 ms is
		// indistinguishable from a 60 Hz panel pinned at vsync: nothing the
		// controller has seen is cheaper than 16.67, so 16.67 is its best
		// estimate of the interval.
		//
		// The cost of being wrong here is one curve point, not a wrong steady
		// state — the rung is skipped, the gate answers `unknown`, and an
		// upshift is settled by a trial that reverts if it misses.
		const blind = new AdaptiveResolution({ initialScale: 0.5 });
		fly(blind, { frames: 400, cost: () => 16.67, minPeriodMs: () => 8.33 });
		expect(blind.diagnostics.atCap).toBe(true);
		expect(blind.diagnostics.observations).toEqual({});
		expect(blind.diagnostics.gate).toBe("unknown");
	});

	test("the tolerance is a band, not an equality", () => {
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		fly(controller, {
			frames: 200,
			cost: () => 8.33 * (1 + CAP_TOLERANCE / 2),
			minPeriodMs: () => 8.33,
		});
		expect(controller.diagnostics.atCap).toBe(true);
	});

	test("a capped rung still climbs, because a trial does not need a curve", () => {
		// The external display at 50% reads its panel's 16.67 ms and has 6 ms of
		// headroom it cannot see. Prediction is unavailable; rendering is not.
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		const decisions = fly(controller, {
			frames: 4_000,
			cost: (scale) => Math.max(16.67, EXTERNAL(scale)),
			minPeriodMs: () => 16.67,
		});
		expect(decisions.some((d) => d.transition === "up-trial")).toBe(true);
		// And it settles where the measurement says it should: 75% costs 20 ms.
		expect(controller.scale).toBe(0.5);
	});
});

/**
 * The refresh interval is the display's, not the rung's — found headed.
 */
describe("the refresh estimate outlives a rung change", () => {
	test("it survives a step down, where the rung's own floor cannot", () => {
		// The sampler's period ring is reprimed on every accepted rung change,
		// because the periods in it were delivered at the previous rung. So the
		// floor arriving in `step` is re-estimated from scratch each time, while
		// the thing it estimates has not changed at all.
		const controller = new AdaptiveResolution();
		// Cheap first: the panel's 8.33 ms is on the table.
		fly(controller, {
			frames: 200,
			cost: () => 8.33,
			minPeriodMs: () => 8.33,
		});
		expect(controller.diagnostics.refreshFloorMs).toBeCloseTo(8.33, 5);
		// Then a planet, and the rung steps down. Each rung's freshly primed ring
		// reports a floor of its own cost, nowhere near the refresh interval.
		fly(controller, {
			frames: 2_000,
			cost: LAPTOP,
			minPeriodMs: (scale) => LAPTOP(scale) * 0.98,
			startMs: 20_000,
		});
		expect(controller.diagnostics.refreshFloorMs).toBeCloseTo(8.33, 5);
		// And the decision followed it: every rung the controller stood on was
		// priced, because none of them was within tolerance of 8.33 ms.
		expect(
			Object.keys(controller.diagnostics.observations).length,
		).toBeGreaterThan(0);
	});

	test("a tight distribution below the cap still becomes a curve point", () => {
		// 20 ms on a 60 Hz panel is 50 fps and is not capped — but every frame
		// agrees, so against the rung's *own* spread it is indistinguishable
		// from a rung pinned at vsync. Against a refresh interval established
		// while some rung was cheap, it separates.
		//
		// **Asserted through `observations` and not through `diagnostics.atCap`.**
		// The first version of this row read the diagnostic, which computes the
		// cap from the retained estimate whatever `step` decided — so pointing
		// `step` back at the rung's own floor left the row green. What the
		// decision actually controls is whether the rung is recorded as a cost,
		// and a capped rung must not be, because its true cost is at most what
		// it appeared to be.
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		fly(controller, {
			frames: 200,
			cost: () => 16.67,
			minPeriodMs: () => 16.67,
		});
		expect(controller.diagnostics.observations).toEqual({});

		fly(controller, {
			frames: 400,
			cost: () => 20,
			// The rung's own floor is its own cost, which is the defect's input.
			minPeriodMs: () => 19.9,
			startMs: 100_000,
		});
		expect(controller.diagnostics.refreshFloorMs).toBeCloseTo(16.67, 5);
		expect(controller.diagnostics.observations["0.50"]).toBeCloseTo(20, 5);
	});

	test("a prime forgets it, because a display change can move it", () => {
		const controller = new AdaptiveResolution();
		fly(controller, { frames: 200, cost: () => 8.33, minPeriodMs: () => 8.33 });
		expect(controller.diagnostics.refreshFloorMs).toBeCloseTo(8.33, 5);
		controller.prime("moved to the external display");
		expect(controller.diagnostics.refreshFloorMs).toBeNull();
	});
});

describe("priming", () => {
	test("a prime keeps the rung and forgets the measurements", () => {
		const controller = new AdaptiveResolution();
		fly(controller, { frames: 400, cost: EXTERNAL });
		const rung = controller.scale;
		expect(rung).toBe(0.5);
		controller.prime("display changed");
		expect(controller.scale).toBe(rung);
		expect(controller.diagnostics.observations).toEqual({});
		expect(controller.diagnostics.gate).toBe("unknown");
		expect(controller.diagnostics.reason).toBe("display changed");
	});

	test("a prime clears a pending trial rather than leaving it to resolve", () => {
		const controller = new AdaptiveResolution({ initialScale: 0.75 });
		fly(controller, {
			frames: UPSHIFT_FRAMES + MIN_SAMPLES + 4,
			cost: () => 6,
			minPeriodMs: () => 5.9,
		});
		expect(controller.diagnostics.reason).toContain("trialling");
		controller.prime("resized");
		expect(controller.diagnostics.reason).toBe("resized");
	});

	test("a prime drops the back-off, because it was earned on another display", () => {
		const controller = new AdaptiveResolution({ initialScale: 0.75 });
		fly(controller, {
			frames: 3_000,
			cost: (scale) => (scale === 1 ? 30 : 10),
			minPeriodMs: () => 8.33,
		});
		expect(controller.diagnostics.trialBackoffMs).toBeGreaterThan(0);
		controller.prime("moved to the external display");
		expect(controller.diagnostics.trialBackoffMs).toBe(0);
	});
});

describe("a scripted pressure sequence settles without oscillating", () => {
	test("empty sky, then a planet, then empty sky again", () => {
		const controller = new AdaptiveResolution();
		const transitions: string[] = [];
		const record = (decisions: AdaptiveDecision[]) => {
			for (const decision of decisions)
				if (decision.transition !== "none")
					transitions.push(`${decision.transition}@${decision.scale}`);
		};
		// Cheap: the laptop's panel pins it at 120 fps.
		record(
			fly(controller, {
				frames: 1_000,
				cost: () => 8.33,
				minPeriodMs: () => 8.33,
			}),
		);
		expect(controller.scale).toBe(1);
		// A venusian fills the view.
		record(
			fly(controller, {
				frames: 6_000,
				cost: LAPTOP,
				minPeriodMs: () => 8.33,
				startMs: 20_000,
			}),
		);
		expect(controller.scale).toBe(0.75);
		// Past it, and cheap again.
		record(
			fly(controller, {
				frames: 4_000,
				cost: () => 8.33,
				minPeriodMs: () => 8.33,
				startMs: 200_000,
			}),
		);
		expect(controller.scale).toBe(1);
		// Eleven thousand frames and a handful of moves: down once, up once,
		// with whatever trials the two required. The number is the claim.
		expect(transitions.length).toBeLessThanOrEqual(6);
	});
});

/**
 * The case a fitted curve cannot reach, found headed.
 */
describe("a rung it has measured is not a rung it predicts", () => {
	test("one trial settles a rung the curve could never refuse", () => {
		// Measured headed over an airless world at 2880x1800: the bottom rung is
		// pinned at vsync so it contributes no curve point, and the rung above
		// is over budget. A fit needs two points and there is only ever one, so
		// the gate answered `unknown` for ever and every back-off expiry bought
		// another visible flip — four in twenty-five seconds on the sheet.
		//
		// The rung above has been *stood on*, so its cost is recorded rather
		// than inferred. Reading it settles the question after one trial.
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		const decisions = fly(controller, {
			frames: 20_000,
			// 0.5 sits exactly on the 60 Hz panel; 0.75 is far over budget.
			cost: (scale) => (scale === 0.5 ? 16.7 : 35),
			minPeriodMs: () => 16.7,
		});
		expect(controller.scale).toBe(0.5);
		expect(controller.diagnostics.gate).toBe("misses");
		// The recorded cost, not a curve's guess about it.
		expect(controller.diagnostics.predictedMs).toBeCloseTo(35, 0);
		expect(Object.keys(controller.diagnostics.observations)).toEqual(["0.75"]);
		const trials = decisions.filter((d) => d.transition === "up-trial").length;
		// One to learn, then the recorded rung answers every later attempt —
		// plus whatever the TTL's re-check costs over the flight.
		const elapsedMs = 20_000 * 16.7;
		expect(trials).toBeLessThanOrEqual(
			Math.ceil(elapsedMs / OBSERVATION_TTL_MS) + 1,
		);
	});

	test("a measured rung inside budget still only earns a trial", () => {
		// The other direction: a recorded cost that fits does not promote the
		// rung by itself. Nothing here promotes except rendering at the rung.
		const controller = new AdaptiveResolution({ initialScale: 0.5 });
		const decisions = fly(controller, {
			frames: 3_000,
			cost: () => 10,
			minPeriodMs: () => 8.33,
		});
		const order = decisions
			.map((d) => d.transition)
			.filter((t) => t !== "none");
		expect(order[0]).toBe("up-trial");
	});
});

/**
 * The bug the principal flew into, with the figures off his screen.
 */
describe("a memory the current frame has ruled out", () => {
	test("empty sky at 8.30 ms does not stay soft on a 30.10 ms memory", () => {
		// Recorded from `?perf` at t+20 s of a screen capture, 2026-09-16:
		//
		//   mode / rung              auto / 0.50
		//   budget / period          16.67 ms / 8.30 ms
		//   cheapest period / at cap  7.10 ms / yes
		//   upshift gate / predicted  misses / 30.10 ms
		//   curve points             1.00:33.1  0.75:30.1  0.50:8.8
		//
		// 120 fps in empty sky, held at half resolution by a 75% entry measured
		// over a planet that was no longer on screen. The entry is not merely
		// old: 8.30 ms at 0.5 bounds 0.75 at 8.30 * 2.25 = 18.7 ms, so 30.10
		// cannot be true of the frame being drawn.
		const controller = new AdaptiveResolution();
		// **Sky first, as the session actually went.** The refresh interval is
		// estimated as the smallest median seen, so a controller that has never
		// run cheap reads each newly-reached rung as the cheapest yet and
		// therefore as capped — and records nothing. The principal's session
		// established 8.30 ms long before the planet filled the view, which is
		// why his curve points exist at all.
		fly(controller, { frames: 400, cost: () => 8.3, minPeriodMs: () => 7.1 });
		// Then the planet, at the costs his curve points record.
		fly(controller, {
			frames: 3_000,
			cost: (scale) => (scale === 1 ? 33.1 : scale === 0.75 ? 30.1 : 20.7),
			minPeriodMs: () => 7.1,
			startMs: 10_000,
		});
		expect(controller.scale).toBe(0.5);
		expect(controller.diagnostics.observations["0.75"]).toBeCloseTo(30.1, 1);

		// Flown away. Every rung is now inside the panel's own 8.30 ms.
		fly(controller, {
			frames: 2_000,
			cost: () => 8.3,
			minPeriodMs: () => 7.1,
			startMs: 100_000,
		});
		expect(controller.diagnostics.observations["0.75"]).toBeUndefined();
		expect(controller.scale).toBe(1);
	});

	test("a 60 Hz panel recovers on the window, since the bound cannot fire", () => {
		// The asymmetry the module's comment claims, asserted rather than left
		// as prose. At the cap on a 60 Hz panel the frame reads 16.70 ms
		// whether the work took five milliseconds or fifteen, so 16.70 permits
		// the same 30.10 and nothing can rule the memory out. Recovery waits for
		// `OBSERVATION_TTL_MS` to retire it.
		//
		// Reproduced headed and the run is in the PR: rung 0.5, `misses
		// (33.9 ms)`, unchanged at +6 s, +15 s and +30 s past the planet.
		const controller = new AdaptiveResolution();
		fly(controller, { frames: 400, cost: () => 16.7, minPeriodMs: () => 16.7 });
		fly(controller, {
			frames: 2_000,
			// 18.5 at the bottom rather than the 17.4 the headed run happened to
			// read: that figure sits *under* `DOWNSHIFT_TRIGGER_MS`, so a
			// fixture using it climbs straight back out and never reaches the
			// state this row is about. The live median fluctuated either side of
			// the trigger; a fixture has to pick one.
			cost: (scale) => (scale === 1 ? 47 : scale === 0.75 ? 33.9 : 18.5),
			minPeriodMs: () => 16.7,
			startMs: 10_000,
		});
		expect(controller.scale).toBe(0.5);
		expect(controller.diagnostics.observations["0.75"]).toBeCloseTo(33.9, 1);

		// Flown away. Every rung is pinned at the panel, so the frame's own cost
		// is invisible and the memory is not contradicted.
		//
		// **The clock has to continue, not jump.** `fly` restarts it at
		// `startMs`, and the first version of this row used 200_000 — already
		// three windows past the memory it was checking, so the entry had
		// expired before the assertion looked at it and the row failed for the
		// opposite of its own reason.
		const away = 50_000;
		fly(controller, {
			frames: 1_000,
			cost: () => 16.7,
			minPeriodMs: () => 16.7,
			startMs: away,
		});
		// Under a minute in: still held, and the reason is the memory.
		expect(controller.scale).toBe(0.5);
		expect(controller.diagnostics.gate).toBe("misses");

		// Past the window: the entry retires and a trial settles it.
		fly(controller, {
			frames: 4_000,
			cost: () => 16.7,
			minPeriodMs: () => 16.7,
			startMs: away + OBSERVATION_TTL_MS + 5_000,
		});
		expect(controller.scale).toBe(1);
	});

	test("a memory the frame is consistent with survives", () => {
		// The other half, and the reason this is a bound rather than a timer.
		// Over a planet a 50% rung at 20.7 ms allows 75% up to 46.6 ms, so a
		// 30.1 ms memory stands — which is what keeps the flip-flop fixed.
		// **Started at the top, because that is where the memory comes from.**
		// A rung is recorded whenever the controller stands on it, and over a
		// planet it stands on each one on the way *down* — which is where the
		// principal's `1.00:33.1` and `0.75:30.1` came from. A fixture that
		// starts at the bottom with a frame already over budget never trials
		// upward and records nothing at all, which is how the first version of
		// this row failed.
		const controller = new AdaptiveResolution();
		const decisions = fly(controller, {
			frames: 8_000,
			// A little cheaper at the bottom than the principal's world, so the
			// rung is inside budget and an upshift is actually considered —
			// otherwise "the memory refuses it" is untested, because nothing
			// asks.
			cost: (scale) => (scale === 1 ? 33.1 : scale === 0.75 ? 30.1 : 14),
			minPeriodMs: () => 7.1,
		});
		expect(controller.scale).toBe(0.5);
		expect(controller.diagnostics.observations["0.75"]).toBeCloseTo(30.1, 1);
		expect(controller.diagnostics.gate).toBe("misses");
		// 14 ms at 0.5 allows 0.75 up to 14 * 2.25 * 1.25 = 39.4 ms, so the
		// 30.1 memory is consistent with the frame and stands.
		const elapsedMs = 8_000 * 14;
		expect(
			decisions.filter((d) => d.transition === "up-trial").length,
		).toBeLessThanOrEqual(Math.ceil(elapsedMs / OBSERVATION_TTL_MS) + 1);
	});
});
