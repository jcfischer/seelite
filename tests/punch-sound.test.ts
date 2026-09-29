/**
 * Weight in the effects (#577): the `?punch=` arms, and what the heavy voices
 * add to the graph. Whether they sound heavier is the principal's ear and the
 * offline probe's bands; what is headless is the arm, the plumbing, and the
 * characters #545 ruled on, which the weight must not undo.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	AudioFX,
	CUE_LENGTH_S,
	HEAVY_CUE_LENGTH_S,
	cueLengthS,
} from "../src/audio";
import type { Cue, VoicedCueKind } from "../src/audio-cue";
import { DEFAULT_PUNCH, PUNCH_ARMS, punchArm } from "../src/punch-sound";
import {
	FakeContext,
	type FakeNode,
	reaches,
	unlocked,
	withFakeWindow,
} from "./lib/fake-audio";

withFakeWindow(beforeEach, afterEach);

describe("the arm", () => {
	test("heavy is the default and the first of the arm; thin is the sound before #577", () => {
		expect(PUNCH_ARMS).toEqual(["heavy", "thin"]);
		expect(DEFAULT_PUNCH).toBe("heavy");
		expect(punchArm(null)).toEqual({ arm: "heavy", unknown: [] });
		expect(punchArm("")).toEqual({ arm: "heavy", unknown: [] });
		expect(punchArm("thin")).toEqual({ arm: "thin", unknown: [] });
	});

	test("an unknown token is handed back, and the default flies", () => {
		expect(punchArm("loud")).toEqual({ arm: "heavy", unknown: ["loud"] });
	});

	test("an engine plays the default unless it is told otherwise", () => {
		expect(new AudioFX().punch).toBe(DEFAULT_PUNCH);
		expect(new AudioFX("thin").punch).toBe("thin");
	});
});

/** The cues #577 gives weight to, pooled ones first. */
const WEIGHTED: Cue[] = [
	{ kind: "explosion" },
	{ kind: "hullHit", voice: "clang" },
	{ kind: "shieldHit", pool: "fore", share: 1, sided: true },
	{ kind: "laser", voice: "crack" },
	{ kind: "hitLanded", on: "hull" },
	{ kind: "dock" },
	{ kind: "witchspaceFlash", voice: "boom" },
	{ kind: "cruiseEngage" },
	{ kind: "cruiseDrop" },
];

/** Play one cue on a fresh engine with `punch`, and return what it built. */
function build(cue: Cue, punch: "heavy" | "thin") {
	FakeContext.made.length = 0;
	const { audio, ctx, buses } = unlocked();
	audio.punch = punch;
	const sources = ctx.sources.length;
	const shapers = ctx.shapers.length;
	audio.play(cue);
	return {
		ctx,
		buses,
		sources: ctx.sources.slice(sources) as (FakeNode & {
			frequency?: { events: Array<[string, number, number]> };
			stoppedAt: number[];
		})[],
		shapers: ctx.shapers.slice(shapers),
	};
}

/** The oscillators among what a cue built. */
const oscillatorsOf = (b: ReturnType<typeof build>) =>
	b.sources.filter((s) => s.frequency !== undefined);

describe("the heavy voices", () => {
	test.each(WEIGHTED.map((c) => [c.kind, c] as const))(
		"%s is driven through a saturator on heavy and through none on thin",
		(_kind, cue) => {
			const heavy = build(cue, "heavy");
			expect(heavy.shapers.length).toBeGreaterThan(0);
			for (const shaper of heavy.shapers) {
				expect(shaper.curve?.length).toBeGreaterThan(0);
				// A saturator is odd and bounded: it thickens, it does not boost.
				const c = shaper.curve as Float32Array;
				expect(Math.max(...c.map(Math.abs))).toBeLessThanOrEqual(1);
				expect(c[0]).toBeCloseTo(-c[c.length - 1], 6);
			}
			expect(build(cue, "thin").shapers).toHaveLength(0);
		},
	);

	test.each(WEIGHTED.map((c) => [c.kind, c] as const))(
		"%s adds sources on heavy, and they reach its bus",
		(_kind, cue) => {
			const heavy = build(cue, "heavy");
			const thin = build(cue, "thin");
			expect(heavy.sources.length).toBeGreaterThan(thin.sources.length);
			const bus =
				cue.kind.startsWith("witchspace") ||
				cue.kind.startsWith("cruise") ||
				cue.kind === "dock"
					? heavy.buses.ship
					: heavy.buses.combat;
			for (const s of heavy.sources) expect(reaches(s, bus)).toBe(true);
		},
	);

	test("no heavy sub is pitched below 38 Hz: under that it costs headroom and is not heard", () => {
		for (const cue of WEIGHTED)
			for (const s of build(cue, "heavy").sources) {
				const events = s.frequency?.events ?? [];
				for (const [, hz] of events) expect(hz).toBeGreaterThanOrEqual(38);
			}
	});

	test("every heavy pooled voice has stopped by the end its pool was told", () => {
		// The pool frees a voice at `CUE_LENGTH_S` (#552): a part that rang on
		// past it would sound while the pool counted it gone.
		for (const cue of WEIGHTED) {
			if (!(cue.kind in CUE_LENGTH_S)) continue;
			const { ctx, sources } = build(cue, "heavy");
			const len = cueLengthS(cue.kind as VoicedCueKind, "heavy");
			for (const s of sources)
				for (const at of s.stoppedAt)
					expect(at - ctx.currentTime).toBeLessThanOrEqual(len + 1e-9);
		}
	});

	test("thin holds its voices exactly as long as before #577; only heavy's are longer", () => {
		// Sage round 1 on #578: one table for both arms held a thin explosion
		// in the pool for 1.75 s, so thin was not the sound before #577.
		expect(CUE_LENGTH_S.explosion).toBe(0.8);
		expect(CUE_LENGTH_S.dock).toBe(0.23);
		for (const kind of Object.keys(CUE_LENGTH_S) as VoicedCueKind[]) {
			expect(cueLengthS(kind, "thin")).toBe(CUE_LENGTH_S[kind]);
			expect(cueLengthS(kind, "heavy")).toBeGreaterThanOrEqual(
				CUE_LENGTH_S[kind],
			);
		}
		expect(Object.keys(HEAVY_CUE_LENGTH_S).sort()).toEqual([
			"dock",
			"explosion",
		]);
	});

	test("the shield hit gains no pitched body: its weight is noise (#545 heard a tone as a tom)", () => {
		const heavy = build(WEIGHTED[2], "heavy");
		const thin = build(WEIGHTED[2], "thin");
		expect(oscillatorsOf(heavy)).toHaveLength(oscillatorsOf(thin).length);
	});

	test("the crack gains no falling sweep: every heavy oscillator it adds holds its pitch (#545's pew)", () => {
		const heavy = build({ kind: "laser", voice: "crack" }, "heavy");
		const thin = build({ kind: "laser", voice: "crack" }, "thin");
		const added = oscillatorsOf(heavy).slice(oscillatorsOf(thin).length);
		expect(added.length).toBeGreaterThan(0);
		for (const o of added)
			expect(
				(o.frequency?.events ?? []).filter(([kind]) => kind === "exp"),
			).toHaveLength(0);
	});

	test("no heavy explosion sets a negative level: a late spark of debris is quieter, not inverted", () => {
		// Sage round 2 on #578: the latest spark could start past 1 s, and its
		// level `(…) * (1 - at)` went below zero. Drawn with a stream that puts
		// every spark at the end of its range.
		const random = Math.random;
		Math.random = () => 0.999999;
		try {
			const { ctx } = build({ kind: "explosion" }, "heavy");
			for (const g of ctx.gains) {
				expect(g.gain.value).toBeGreaterThanOrEqual(0);
				for (const [, v] of g.gain.events) expect(v).toBeGreaterThanOrEqual(0);
			}
		} finally {
			Math.random = random;
		}
	});

	test("the console cues are not touched", () => {
		for (const cue of [
			{ kind: "alert" },
			{ kind: "ui" },
			{ kind: "scoop" },
			{ kind: "press" },
			{ kind: "refuse" },
			{ kind: "focus" },
			{ kind: "notify", tone: "good" },
		] as Cue[]) {
			const heavy = build(cue, "heavy");
			const thin = build(cue, "thin");
			expect(heavy.sources.length).toBe(thin.sources.length);
			expect(heavy.shapers).toHaveLength(0);
		}
	});
});
