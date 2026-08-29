/**
 * The persistent flight floor's mode/throttle/assist/charge strip — node #92.
 *
 * `hud-and-scanner.md` §5 calls this "the minimum that keeps a hull-hidden
 * cockpit flyable and honest about cruise charge". What each cell *says* is
 * arithmetic on four scalars and belongs here; where it lands on the glass is
 * `probe-live-cockpit.mjs`'s.
 *
 * The strip is a projection and not a formatter with a view attached: it
 * returns cells with a tone, and the tone is §4's grammar rather than a colour
 * picked at the draw site. A draw that chose its own colours would put §4 in
 * two places, and the one that is not a pure function is the one nothing tests.
 */

import { describe, expect, test } from "bun:test";
import { CHARGE_CAPACITY_AU, CHARGE_REGEN_AU_PER_S } from "../src/cruise";
import {
	FLIGHT_FLOOR_LABELS,
	type FlightFloorState,
	chargeReadsEmpty,
	flightFloorCells,
	flightFloorWidest,
} from "../src/cockpit";

const flying = (over: Partial<FlightFloorState> = {}): FlightFloorState => ({
	regime: "normal",
	spoolLeftS: 0,
	throttle: 0,
	assist: true,
	chargeAu: CHARGE_CAPACITY_AU,
	chargeCapacityAu: CHARGE_CAPACITY_AU,
	chargeRegenAuPerS: CHARGE_REGEN_AU_PER_S,
	...over,
});

/** One cell by its label, so a test names the field it is about rather than a
 *  position that changes when the strip is reordered. */
const cell = (state: FlightFloorState, label: string) => {
	const found = flightFloorCells(state).find((c) => c.label === label);
	if (found === undefined) throw new Error(`no ${label} cell`);
	return found;
};

describe("the strip covers §5's four fields, in order", () => {
	test("exactly mode, throttle, assist and charge", () => {
		expect(flightFloorCells(flying()).map((c) => c.label)).toEqual([
			...FLIGHT_FLOOR_LABELS,
		]);
	});

	/** The order is §5's own sentence. Pinned because the strip is read at a
	 *  glance and a reordering is a silent relearning cost. */
	test("the order is the spec's", () => {
		expect([...FLIGHT_FLOOR_LABELS]).toEqual([
			"MODE",
			"THR",
			"ASSIST",
			"CHARGE",
		]);
	});
});

describe("MODE — the regime, which had no player-visible readout at all", () => {
	test("normal flight reads NORMAL, passive", () => {
		expect(cell(flying(), "MODE")).toEqual({
			label: "MODE",
			value: "NORMAL",
			tone: "passive",
		});
	});

	test("cruise reads CRUISE, confirmed", () => {
		expect(cell(flying({ regime: "cruise" }), "MODE")).toEqual({
			label: "MODE",
			value: "CRUISE",
			tone: "confirmed",
		});
	});

	/**
	 * **Spooling outranks the regime**, and shows its own countdown.
	 *
	 * The wind-up is a window in which the player is committed and cannot steer
	 * out (`galaxy-generation.md` §8 makes it a vulnerability window), so a
	 * strip that read NORMAL through it would be describing the regime the ship
	 * has left rather than the one it is in.
	 */
	test("spooling outranks the regime and counts down", () => {
		expect(cell(flying({ spoolLeftS: 1.44 }), "MODE")).toEqual({
			label: "MODE",
			value: "SPOOL 1.4s",
			tone: "action",
		});
		// Even when the regime field still says cruise, which it does on the
		// frame the drop-out fires.
		expect(
			cell(flying({ spoolLeftS: 0.2, regime: "cruise" }), "MODE").value,
		).toBe("SPOOL 0.2s");
	});
});

describe("THR — the throttle, which shipped as an unlabelled wedge", () => {
	test("a percentage, rounded", () => {
		expect(cell(flying({ throttle: 0 }), "THR").value).toBe("0%");
		expect(cell(flying({ throttle: 0.5 }), "THR").value).toBe("50%");
		expect(cell(flying({ throttle: 1 }), "THR").value).toBe("100%");
		expect(cell(flying({ throttle: 0.336 }), "THR").value).toBe("34%");
	});

	test("passive whatever it reads", () => {
		for (const throttle of [0, 0.5, 1])
			expect(cell(flying({ throttle }), "THR").tone).toBe("passive");
	});
});

describe("ASSIST — the toggle with no readout, and #5's whole argument", () => {
	test("on is passive; off is an action tone", () => {
		expect(cell(flying({ assist: true }), "ASSIST")).toEqual({
			label: "ASSIST",
			value: "ON",
			tone: "passive",
		});
		// **Amber, not cyan.** Assist off is #5's Newtonian regime, where the
		// nose and the velocity genuinely disagree — a legitimate choice and the
		// one the pilot most needs to know they are in. It is not a danger, so
		// it is not red.
		expect(cell(flying({ assist: false }), "ASSIST")).toEqual({
			label: "ASSIST",
			value: "OFF",
			tone: "action",
		});
	});
});

describe("CHARGE — the second consumable, and the anti-stranding rule", () => {
	test("full reads the pair and no regeneration", () => {
		expect(cell(flying(), "CHARGE")).toEqual({
			label: "CHARGE",
			value: "12.0/12 AU",
			tone: "passive",
		});
	});

	/**
	 * **The regeneration is shown only while it is happening.**
	 *
	 * The map makes passive regeneration the anti-stranding rule and says the
	 * HUD must show it — but a "+1.0/min" printed at 12/12 is a claim about a
	 * process that is not running. Below capacity it is running, and that is
	 * the fact a stranded pilot needs.
	 */
	test("below capacity it prints the regeneration rate, per minute", () => {
		expect(cell(flying({ chargeAu: 4.2 }), "CHARGE").value).toBe(
			"4.2/12 AU  +1.0/min",
		);
		// A tenth is the resolution, and the rounding is `toFixed`'s — written
		// here as 4.25 -> "4.2" first, which is wrong: it rounds up. Pinned so
		// the reading is a decision rather than whatever the formatter does.
		expect(cell(flying({ chargeAu: 4.25 }), "CHARGE").value).toBe(
			"4.3/12 AU  +1.0/min",
		);
	});

	/**
	 * Zero is a **refusal**, not a low reading: `cruisePrompt` returns "no drive
	 * charge — wait for it to regenerate" and the engage is declined. §4 gives
	 * red to "blocking danger or refusal", and this is the second.
	 */
	test("empty is a refusal tone, and still says how fast it fills", () => {
		const empty = cell(flying({ chargeAu: 0 }), "CHARGE");
		expect(empty.tone).toBe("refused");
		expect(empty.value).toBe("0.0/12 AU  +1.0/min");
	});

	test("anything above empty is passive, however low", () => {
		expect(cell(flying({ chargeAu: 0.05 }), "CHARGE").tone).toBe("passive");
	});

	/** The capacity is the sim's, not a literal here — two spellings of one
	 *  quantity is how a retune leaves the instrument lying. */
	test("the pair is the sim's own capacity and rate", () => {
		expect(CHARGE_CAPACITY_AU).toBe(12);
		expect(CHARGE_REGEN_AU_PER_S * 60).toBeCloseTo(1, 12);
		expect(cell(flying({ chargeAu: 3 }), "CHARGE").value).toContain(
			`/${CHARGE_CAPACITY_AU} AU`,
		);
	});
});

describe("the empty predicate the strip and the prompt share", () => {
	/**
	 * **The bug this exists for.** The sim's gate is `chargeAu <= 0`, and
	 * passive regeneration lifts the raw value off zero on the next frame — so
	 * a tone keyed to the raw number went calm-cyan while the same cell still
	 * printed "0.0/12 AU", and `cruisePrompt` said "press J to cruise" beside
	 * it. Found by looking at a captured frame; no check in either tier was
	 * asking.
	 */
	test("a value that prints 0.0 reads empty, however far above zero it is", () => {
		expect(chargeReadsEmpty(0)).toBe(true);
		// One frame of regeneration at 1 AU/min is 0.00027 AU. It still prints
		// 0.0, so it still reads empty.
		expect(chargeReadsEmpty(CHARGE_REGEN_AU_PER_S / 60)).toBe(true);
		expect(chargeReadsEmpty(0.04)).toBe(true);
		expect(chargeReadsEmpty(0.05)).toBe(false);
		expect(chargeReadsEmpty(1)).toBe(false);
	});

	test("the strip's tone is that predicate, at the same resolution", () => {
		// Exactly the frame-after-starve-out case, which used to read passive.
		const justAbove = flying({ chargeAu: CHARGE_REGEN_AU_PER_S / 60 });
		expect(cell(justAbove, "CHARGE").value).toBe("0.0/12 AU  +1.0/min");
		expect(cell(justAbove, "CHARGE").tone).toBe("refused");
		// And the first reading that is not 0.0 is not a refusal.
		expect(cell(flying({ chargeAu: 0.05 }), "CHARGE").tone).toBe("passive");
	});

	/**
	 * The tone and the text are one quantity, so they cannot disagree at any
	 * value — swept rather than sampled, because the two are computed from the
	 * same number by different expressions and a boundary is where that breaks.
	 */
	test("no charge value prints 0.0 without the refusal tone", () => {
		for (let au = 0; au <= 12; au += 0.01) {
			const c = cell(flying({ chargeAu: au }), "CHARGE");
			expect(c.value.startsWith("0.0/")).toBe(c.tone === "refused");
		}
	});
});

describe("the widest reading, which the strip is laid out against", () => {
	/**
	 * **The bound has to hold, or the layout it sizes is a guess.**
	 *
	 * The strip is fitted to `flightFloorWidest` once per viewport, so any
	 * reachable value longer than its bound is a value that draws past the edge
	 * — which is what shipped: the fit was taken on a full tank, where the
	 * regeneration suffix is absent, and at 390 px both ends were clipped a
	 * second later. The font is monospace, so a character count is a width.
	 */
	test("no reachable reading is longer than its bound", () => {
		const widest = flightFloorWidest(CHARGE_CAPACITY_AU, CHARGE_REGEN_AU_PER_S);
		let checked = 0;
		for (const regime of ["normal", "cruise"] as const)
			for (const spoolLeftS of [0, 0.1, 3.5, 9.9])
				for (const throttle of [0, 0.005, 0.5, 1])
					for (const assist of [true, false])
						for (const chargeAu of [
							0,
							0.04,
							0.05,
							1,
							9.95,
							CHARGE_CAPACITY_AU - 0.05,
							CHARGE_CAPACITY_AU,
						]) {
							for (const c of flightFloorCells({
								regime,
								spoolLeftS,
								throttle,
								assist,
								chargeAu,
								chargeCapacityAu: CHARGE_CAPACITY_AU,
								chargeRegenAuPerS: CHARGE_REGEN_AU_PER_S,
							})) {
								checked++;
								expect(c.value.length).toBeLessThanOrEqual(
									widest[c.label as keyof typeof widest].length,
								);
							}
						}
		// The sweep is the assertion, so its size is asserted too: a loop that
		// stopped iterating would pass every expectation inside it.
		expect(checked).toBe(2 * 4 * 4 * 2 * 7 * 4);
	});

	/** And the bound is not absurdly loose — a bound of 200 characters would
	 *  satisfy the sweep above while making the fit useless. */
	test("the bound is close to the longest reachable reading", () => {
		const widest = flightFloorWidest(CHARGE_CAPACITY_AU, CHARGE_REGEN_AU_PER_S);
		const longestCharge = flightFloorCells({
			regime: "normal",
			spoolLeftS: 0,
			throttle: 1,
			assist: false,
			chargeAu: CHARGE_CAPACITY_AU - 0.05,
			chargeCapacityAu: CHARGE_CAPACITY_AU,
			chargeRegenAuPerS: CHARGE_REGEN_AU_PER_S,
		}).find((c) => c.label === "CHARGE") as { value: string };
		expect(
			widest.CHARGE.length - longestCharge.value.length,
		).toBeLessThanOrEqual(1);
		expect(widest.MODE.length - "SPOOL 9.9s".length).toBeLessThanOrEqual(1);
	});
});
