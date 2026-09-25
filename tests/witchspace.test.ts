/**
 * #532: the straddle's pure half — the phase, the look it drives, the cue
 * schedule, and every way the effect can end.
 *
 * #195's D1 ratified the shape: entry in the last part of §8's wind-up, a
 * whiteout on the cut, an exit in the new system. What is tested here is that
 * the effect is a **state machine fed by events** and not a reading of
 * `JumpCharge.leftS`: `stepCharge` returns the idle charge on the step it fires
 * and `cancelCharge` returns the same idle charge, so a phase derived from the
 * charge cannot tell the cut from a cancel from never having charged at all.
 */
import { describe, expect, test } from "bun:test";
import { JUMP_CHARGE_S } from "../src/hyperspace";
import {
	WITCHSPACE,
	abortWitchspace,
	arriveWitchspace,
	beginWitchspace,
	entryWitchspace,
	idleWitchspace,
	jumpedWitchspace,
	type WitchspaceLook,
	witchspaceAtPhase,
	witchspaceCues,
	witchspaceLook,
	witchspacePhase,
	stepWitchspace,
} from "../src/witchspace";

const DT = 1 / 60;

/** Step a state for `seconds` at a fixed frame, collecting every cue. */
function run(state: ReturnType<typeof idleWitchspace>, seconds: number) {
	const cues: string[] = [];
	let s = state;
	const steps = Math.round(seconds / DT);
	for (let i = 0; i < steps; i++) {
		const next = stepWitchspace(s, DT);
		cues.push(...witchspaceCues(s, next));
		s = next;
	}
	return { state: s, cues };
}

const dark = (look: WitchspaceLook) =>
	look.streak === 0 && look.whiteout === 0 && look.rift === 0;

describe("the phase", () => {
	test("idle has no phase and draws nothing", () => {
		expect(witchspacePhase(idleWitchspace())).toBeNull();
		expect(dark(witchspaceLook(idleWitchspace()))).toBe(true);
	});

	test("the entry counts up to the cut from minus the wind-up", () => {
		const s = beginWitchspace();
		expect(witchspacePhase(s)).toBeCloseTo(-JUMP_CHARGE_S, 9);
		const later = run(s, 1).state;
		expect(witchspacePhase(later)).toBeCloseTo(1 - JUMP_CHARGE_S, 6);
	});

	test("the entry holds at the cut until the jump is taken, rather than idling", () => {
		// The charge arms the jump and the jump is taken at the end of the frame;
		// an entry that ran past zero would show the exit in the old system.
		const s = run(beginWitchspace(), JUMP_CHARGE_S + 0.5).state;
		expect(witchspacePhase(s)).toBe(0);
		expect(witchspaceLook(s).whiteout).toBe(1);
	});

	test("the exit counts up from the cut, and ends idle", () => {
		const s = jumpedWitchspace(run(beginWitchspace(), JUMP_CHARGE_S).state);
		expect(witchspacePhase(s)).toBe(0);
		const mid = run(s, 0.5).state;
		expect(witchspacePhase(mid)).toBeCloseTo(0.5, 6);
		const done = run(s, WITCHSPACE.exitEndS + 0.1).state;
		expect(done.kind).toBe("idle");
	});

	test("witchspaceAtPhase reproduces the state a real run reaches", () => {
		for (const t of [-2.5, -1, -0.2]) {
			const real = witchspaceLook(
				run(beginWitchspace(), JUMP_CHARGE_S + t).state,
			);
			const held = witchspaceLook(witchspaceAtPhase(t));
			for (const k of Object.keys(held) as (keyof WitchspaceLook)[])
				expect(held[k]).toBeCloseTo(real[k], 6);
		}
		for (const t of [0, 0.3, 1]) {
			const real = run(
				jumpedWitchspace(run(beginWitchspace(), JUMP_CHARGE_S).state),
				t,
			).state;
			const held = witchspaceLook(witchspaceAtPhase(t));
			const flown = witchspaceLook(real);
			for (const k of Object.keys(held) as (keyof WitchspaceLook)[])
				expect(held[k]).toBeCloseTo(flown[k], 6);
		}
	});
});

describe("the look", () => {
	test("the start of the wind-up is untouched — the entry is its last part only", () => {
		const t = -(WITCHSPACE.entryS + 0.01);
		expect(dark(witchspaceLook(witchspaceAtPhase(t)))).toBe(true);
		expect(WITCHSPACE.entryS).toBeLessThan(JUMP_CHARGE_S);
	});

	test("the streak rises through the entry and the frame is white on the cut", () => {
		const a = witchspaceLook(witchspaceAtPhase(-1));
		const b = witchspaceLook(witchspaceAtPhase(-0.2));
		expect(a.streak).toBeGreaterThan(0);
		expect(b.streak).toBeGreaterThan(a.streak);
		expect(witchspaceLook(witchspaceAtPhase(0)).whiteout).toBe(1);
	});

	test("the whiteout covers the frames around the cut, not only the one frame", () => {
		// The rebuild's first frames are the ones worth covering (#208's bakes
		// are queued), so the white holds for a moment either side.
		expect(witchspaceLook(witchspaceAtPhase(-DT)).whiteout).toBeGreaterThan(
			0.9,
		);
		expect(witchspaceLook(witchspaceAtPhase(DT)).whiteout).toBe(1);
	});

	test("the exit fades back to the new system", () => {
		const early = witchspaceLook(witchspaceAtPhase(0.3));
		const late = witchspaceLook(witchspaceAtPhase(1));
		expect(early.whiteout).toBeGreaterThan(late.whiteout);
		expect(witchspaceLook(witchspaceAtPhase(WITCHSPACE.exitS)).whiteout).toBe(
			0,
		);
	});

	test("the rift is drawn in the exit half and never in the entry half", () => {
		expect(witchspaceLook(witchspaceAtPhase(-0.2)).rift).toBe(0);
		expect(witchspaceLook(witchspaceAtPhase(0.3)).rift).toBeGreaterThan(0);
		expect(witchspaceLook(witchspaceAtPhase(WITCHSPACE.exitEndS)).rift).toBe(0);
	});

	test("every term stays inside [0, 1] across the whole straddle", () => {
		for (let t = -JUMP_CHARGE_S; t <= WITCHSPACE.exitEndS; t += 0.01) {
			const look = witchspaceLook(witchspaceAtPhase(t));
			for (const v of Object.values(look)) {
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(1);
			}
		}
	});
});

describe("the cues", () => {
	test("an entry synced from the charge hears the sweep on the same step a stepped one does", () => {
		const prev = entryWitchspace(WITCHSPACE.sweepS + DT / 2);
		const next = entryWitchspace(WITCHSPACE.sweepS - DT / 2);
		expect(witchspaceCues(prev, next)).toEqual(["sweep"]);
		expect(witchspaceCues(idleWitchspace(), entryWitchspace(0.5))).toEqual([
			"hum",
			"sweep",
		]);
	});

	test("the hum starts with the wind-up and the sweep starts so its end lands on the cut", () => {
		const begun = beginWitchspace();
		const cues = [
			...witchspaceCues(idleWitchspace(), begun),
			...run(begun, JUMP_CHARGE_S).cues,
		];
		expect(cues).toEqual(["hum", "sweep"]);
		// Where the sweep fired, in seconds from the cut.
		let s = beginWitchspace();
		let firedAt: number | null = null;
		for (let i = 0; i < 400 && firedAt === null; i++) {
			const next = stepWitchspace(s, DT);
			if (witchspaceCues(s, next).includes("sweep"))
				firedAt = witchspacePhase(next);
			s = next;
		}
		expect(firedAt).not.toBeNull();
		expect(Math.abs((firedAt as number) + WITCHSPACE.sweepS)).toBeLessThan(
			DT + 1e-9,
		);
	});

	test("the hum runs for the wind-up's first part and the sweep for the rest", () => {
		expect(WITCHSPACE.humS + WITCHSPACE.sweepS).toBeCloseTo(JUMP_CHARGE_S, 9);
	});

	test("beginning a wind-up is itself the hum cue", () => {
		expect(witchspaceCues(idleWitchspace(), beginWitchspace())).toEqual([
			"hum",
		]);
	});

	test("the arrival-only path cues nothing — there was no wind-up to hear", () => {
		const { cues } = run(arriveWitchspace(), WITCHSPACE.exitEndS);
		expect(cues).toEqual([]);
	});
});

describe("ending it early", () => {
	test("a cancel mid-entry retracts from where it was, and stops both cues", () => {
		const before = run(beginWitchspace(), JUMP_CHARGE_S - 0.3).state;
		const look = witchspaceLook(before);
		expect(look.streak).toBeGreaterThan(0);
		const cancelled = abortWitchspace(before);
		expect(witchspaceCues(before, cancelled)).toEqual(["stop"]);
		// No pop: the first retracting frame is what was on screen.
		expect(witchspaceLook(cancelled)).toEqual(look);
		const half = run(cancelled, WITCHSPACE.retractS / 2).state;
		expect(witchspaceLook(half).streak).toBeLessThan(look.streak);
		expect(witchspaceLook(half).streak).toBeGreaterThan(0);
		const gone = run(cancelled, WITCHSPACE.retractS + DT).state;
		expect(gone.kind).toBe("idle");
	});

	test("a retract has no phase — it is no longer a jump", () => {
		const cancelled = abortWitchspace(
			run(beginWitchspace(), JUMP_CHARGE_S - 0.3).state,
		);
		expect(witchspacePhase(cancelled)).toBeNull();
	});

	test("a cancel before the entry has drawn anything still stops the hum", () => {
		const early = run(beginWitchspace(), 0.5).state;
		expect(dark(witchspaceLook(early))).toBe(true);
		const cancelled = abortWitchspace(early);
		expect(witchspaceCues(early, cancelled)).toEqual(["stop"]);
	});

	test("an abort at the cut — the jump refused after full white — retracts from white", () => {
		const atCut = run(beginWitchspace(), JUMP_CHARGE_S + 0.1).state;
		const aborted = abortWitchspace(atCut);
		expect(witchspaceLook(aborted).whiteout).toBe(1);
		expect(witchspaceCues(atCut, aborted)).toEqual(["stop"]);
		expect(run(aborted, WITCHSPACE.retractS + DT).state.kind).toBe("idle");
	});

	test("abort is idempotent on idle and does not touch an exit", () => {
		expect(abortWitchspace(idleWitchspace())).toEqual(idleWitchspace());
		const exit = jumpedWitchspace(witchspaceAtPhase(0));
		expect(abortWitchspace(exit)).toEqual(exit);
	});

	test("the retract cues nothing further as it fades out", () => {
		const cancelled = abortWitchspace(
			run(beginWitchspace(), JUMP_CHARGE_S - 0.3).state,
		);
		expect(run(cancelled, WITCHSPACE.retractS + DT).cues).toEqual([]);
	});
});

describe("the exit clock", () => {
	test("one long frame cannot clear the whiteout", () => {
		// `rebuildSystem()` rebuilds bodies, the environment and the sky; the
		// frames after it can be long. A fade that advanced on raw dt would
		// clear during the stall and show the pop-in the white is there to hide.
		const s = jumpedWitchspace(witchspaceAtPhase(0));
		const after = stepWitchspace(s, 0.5);
		expect(witchspacePhase(after)).toBeCloseTo(WITCHSPACE.maxExitDtS, 9);
		expect(witchspaceLook(after).whiteout).toBeGreaterThan(0.9);
	});

	test("the arrival-only path plays the same exit as a jump", () => {
		const jumped = jumpedWitchspace(witchspaceAtPhase(0));
		const arrived = arriveWitchspace();
		for (const t of [0, 0.3, 1, 2]) {
			expect(witchspaceLook(run(arrived, t).state)).toEqual(
				witchspaceLook(run(jumped, t).state),
			);
		}
	});

	test("jumped from idle — a jump with no entry — is still an exit", () => {
		expect(witchspacePhase(jumpedWitchspace(idleWitchspace()))).toBe(0);
	});
});
