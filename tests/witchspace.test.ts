/**
 * #532: the straddle's pure half — the phase, the look it drives, the cue
 * schedule, and every way the effect can end.
 *
 * #195's D1 ratified the shape: an entry through the whole of §8's wind-up
 * since the principal's third flight, a cover on the cut, an exit in the new
 * system. What is tested here is that
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
	witchspaceControlHeld,
	witchspaceCues,
	witchspaceSkyZoom,
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
	look.streak === 0 &&
	look.beta === 0 &&
	look.dark === 0 &&
	look.tunnel === 0 &&
	look.whiteout === 0 &&
	look.rift === 0;

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
		expect(witchspaceLook(s).dark).toBe(1);
	});

	test("the exit counts up from the cut, and ends idle", () => {
		const s = jumpedWitchspace();
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
			const real = run(jumpedWitchspace(), t).state;
			const held = witchspaceLook(witchspaceAtPhase(t));
			const flown = witchspaceLook(real);
			for (const k of Object.keys(held) as (keyof WitchspaceLook)[])
				expect(held[k]).toBeCloseTo(flown[k], 6);
		}
	});
});

describe("the look", () => {
	test("the entry is the whole wind-up, and it starts from nothing", () => {
		expect(WITCHSPACE.entryS).toBe(JUMP_CHARGE_S);
		expect(dark(witchspaceLook(witchspaceAtPhase(-JUMP_CHARGE_S)))).toBe(true);
	});

	test("the sky crowds forward through the wind-up: the starbow", () => {
		const at = (t: number) => witchspaceLook(witchspaceAtPhase(t)).beta;
		expect(at(-2.5)).toBeGreaterThan(0);
		expect(at(-1.5)).toBeGreaterThan(at(-2.5));
		expect(at(-WITCHSPACE.betaFullS)).toBe(1);
	});

	test("the dark closes in only late, and leaves the point by the cut", () => {
		const at = (t: number) => witchspaceLook(witchspaceAtPhase(t)).dark;
		expect(at(-WITCHSPACE.darkInS - 0.01)).toBe(0);
		expect(at(-0.6)).toBeGreaterThan(0);
		expect(at(-0.6)).toBeLessThan(1);
		expect(at(-WITCHSPACE.pointS)).toBe(1);
	});

	test("the frame is covered from the point until the sky starts to unfold", () => {
		// The rebuild's first frames are the ones worth covering (#208's bakes
		// are queued), and the tunnel ride is all of them.
		for (let t = -WITCHSPACE.pointS; t <= WITCHSPACE.unfoldAtS; t += 0.05) {
			const look = witchspaceLook(witchspaceAtPhase(t));
			expect(Math.max(look.dark, look.tunnel)).toBe(1);
		}
	});

	test("the flash is a moment on the cut, not the cover", () => {
		const peak = witchspaceLook(witchspaceAtPhase(0)).whiteout;
		expect(peak).toBeGreaterThan(0);
		expect(peak).toBeLessThan(1);
		expect(witchspaceLook(witchspaceAtPhase(-0.5)).whiteout).toBe(0);
		expect(witchspaceLook(witchspaceAtPhase(0.5)).whiteout).toBe(0);
	});

	test("the tunnel opens out of the point after the cut and closes back into it", () => {
		const at = (t: number) => witchspaceLook(witchspaceAtPhase(t)).tunnel;
		expect(at(-0.1)).toBe(0);
		expect(at(0)).toBe(0);
		expect(at(WITCHSPACE.tunnelOpenS)).toBe(1);
		expect(at(1.5)).toBe(1);
		expect(at(WITCHSPACE.tunnelGoneS)).toBe(0);
	});

	test("the new system's light catches up: the sky unfolds and the dark recedes", () => {
		const at = (t: number) => witchspaceLook(witchspaceAtPhase(t));
		expect(at(WITCHSPACE.unfoldAtS).beta).toBe(1);
		expect(at(WITCHSPACE.unfoldAtS).dark).toBe(1);
		const mid = at((WITCHSPACE.unfoldAtS + WITCHSPACE.exitS) / 2);
		expect(mid.beta).toBeGreaterThan(0);
		expect(mid.beta).toBeLessThan(1);
		const done = at(WITCHSPACE.exitS);
		for (const k of ["streak", "tunnel", "whiteout", "beta", "dark"] as const)
			expect(done[k]).toBe(0);
	});

	test("the whole sequence runs two to three times the first build's three seconds", () => {
		const total = WITCHSPACE.entryS + WITCHSPACE.exitS;
		expect(total).toBeGreaterThanOrEqual(6);
		expect(total).toBeLessThanOrEqual(9);
	});

	test("the rift opens with the unfolding sky, never in the entry half", () => {
		expect(witchspaceLook(witchspaceAtPhase(-0.2)).rift).toBe(0);
		expect(witchspaceLook(witchspaceAtPhase(1.5)).rift).toBe(0);
		expect(
			witchspaceLook(witchspaceAtPhase(WITCHSPACE.unfoldAtS + 0.6)).rift,
		).toBeGreaterThan(0);
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

	test("a cancel early in the wind-up stops the hum", () => {
		const early = run(beginWitchspace(), 0.5).state;
		const cancelled = abortWitchspace(early);
		expect(witchspaceCues(early, cancelled)).toEqual(["stop"]);
	});

	test("an abort at the cut — the jump refused in the dark — retracts from the dark", () => {
		const atCut = run(beginWitchspace(), JUMP_CHARGE_S + 0.1).state;
		const aborted = abortWitchspace(atCut);
		expect(witchspaceLook(aborted).dark).toBe(1);
		expect(witchspaceCues(atCut, aborted)).toEqual(["stop"]);
		expect(run(aborted, WITCHSPACE.retractS + DT).state.kind).toBe("idle");
	});

	test("abort is idempotent on idle and does not touch an exit", () => {
		expect(abortWitchspace(idleWitchspace())).toEqual(idleWitchspace());
		const exit = jumpedWitchspace();
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
	test("one long frame cannot clear the cover", () => {
		// `rebuildSystem()` rebuilds bodies, the environment and the sky; the
		// frames after it can be long. A fade that advanced on raw dt would
		// clear during the stall and show the pop-in the cover is there to hide.
		const s = jumpedWitchspace();
		const after = stepWitchspace(s, 0.5);
		expect(witchspacePhase(after)).toBeCloseTo(WITCHSPACE.maxExitDtS, 9);
		expect(witchspaceLook(after).dark).toBe(1);
	});

	test("the arrival-only path plays the same exit as a jump", () => {
		const jumped = jumpedWitchspace();
		const arrived = arriveWitchspace();
		for (const t of [0, 0.3, 1, 2]) {
			expect(witchspaceLook(run(arrived, t).state)).toEqual(
				witchspaceLook(run(jumped, t).state),
			);
		}
	});

	test("jumped from idle — a jump with no entry — is still an exit", () => {
		expect(witchspacePhase(jumpedWitchspace())).toBe(0);
	});
});

describe("the pilot's hands", () => {
	test("the arrival holds the controls until the sky is back", () => {
		const exitAt = (t: number) => witchspaceAtPhase(t);
		expect(witchspaceControlHeld(exitAt(0))).toBe(true);
		expect(witchspaceControlHeld(exitAt(2))).toBe(true);
		expect(witchspaceControlHeld(exitAt(WITCHSPACE.controlBackS))).toBe(false);
		// The whole sky is back by then, not only the dark gone: at 3.8 s the
		// dark had receded but the sky was still half squeezed and the markers
		// still disagreed with it (sage round 2 on #533).
		const back = witchspaceLook(exitAt(WITCHSPACE.controlBackS));
		expect(back.dark).toBe(0);
		expect(back.beta).toBe(0);
		expect(back.streak).toBe(0);
	});

	test("the wind-up leaves them live — it is §8's vulnerable window", () => {
		expect(witchspaceControlHeld(beginWitchspace())).toBe(false);
		expect(witchspaceControlHeld(witchspaceAtPhase(-0.1))).toBe(false);
		expect(witchspaceControlHeld(idleWitchspace())).toBe(false);
	});
});

describe("the aberration", () => {
	test("the sky cameras widen as beta rises, and are untouched at rest", () => {
		expect(witchspaceSkyZoom(0)).toBe(1);
		expect(witchspaceSkyZoom(0.5)).toBeLessThan(1);
		expect(witchspaceSkyZoom(1)).toBeLessThan(witchspaceSkyZoom(0.5));
		// A camera cannot see all the way round: the zoom stays positive, so the
		// field of view stays under 180 degrees.
		expect(witchspaceSkyZoom(1)).toBeGreaterThan(0);
	});

	test("near the nose the camera puts a star where aberration does, and wide of it the camera shows less", () => {
		// Aberration moves a source at θ from the heading to θ' with
		// tan(θ'/2) = sqrt((1-β)/(1+β)) · tan(θ/2). A perspective camera zoomed by
		// z draws a source at θ where an unzoomed one draws atan(z · tan θ): the
		// full-angle tangent, not the half-angle one. The zoom is chosen so the two
		// agree near the axis, which is where the eye is — this is the claim, and
		// it is checked against the physics rather than against the zoom's own
		// formula (sage round 2 on #533 caught that tautology).
		const beta = 0.6;
		const b = WITCHSPACE.peakBeta * beta;
		const k = Math.sqrt((1 - b) / (1 + b));
		const z = witchspaceSkyZoom(beta);
		const aberrated = (theta: number) => 2 * Math.atan(k * Math.tan(theta / 2));
		const drawn = (theta: number) => Math.atan(z * Math.tan(theta));
		const near = (5 * Math.PI) / 180;
		expect(
			Math.abs(drawn(near) - aberrated(near)) / aberrated(near),
		).toBeLessThan(0.02);
		// Wide of the nose the camera's tangent runs away from the half-angle one,
		// so it draws the side sky further out than aberration would: it shows
		// less of the sky than the physics. Recorded, not hidden.
		const wide = (60 * Math.PI) / 180;
		expect(drawn(wide)).toBeGreaterThan(aberrated(wide) * 1.05);
	});
});
