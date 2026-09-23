/**
 * Pad frames for the unit tier — the one copy (#381 S4).
 *
 * `tests/pad-bindings.test.ts` wrote these and `tests/capture.test.ts` would
 * have been the second, which is the point at which this repo extracts rather
 * than the point at which it notices. Unlike `scripts/lib/flight-harness.mjs`
 * this one *is* executed by a headless gate, so a share-out that deletes a
 * neighbour goes red on `npm test`.
 */
import {
	type PadButtonName,
	type PadFrame,
	type RawPad,
	STANDARD_BUTTONS,
	readPad,
} from "../../src/gamepad";

export const NOTHING: ReadonlySet<PadButtonName> = new Set();

export function pad(overrides: Partial<RawPad> = {}): RawPad {
	return {
		id: "DualSense Wireless Controller (STANDARD GAMEPAD)",
		mapping: "standard",
		axes: [0, 0, 0, 0],
		buttons: STANDARD_BUTTONS.map(() => ({ pressed: false, value: 0 })),
		...overrides,
	};
}

/** A frame in which exactly `name` has just gone down. */
export const press = (
	name: PadButtonName,
	value = 1,
	held: ReadonlySet<PadButtonName> = NOTHING,
): PadFrame => {
	const index = STANDARD_BUTTONS.indexOf(name);
	const buttons = STANDARD_BUTTONS.map((_, i) =>
		i === index
			? { pressed: value >= 0.5, value }
			: { pressed: false, value: 0 },
	);
	return readPad(pad({ buttons }), held);
};

/** A frame with the sticks at [leftX, leftY, rightX, rightY]. */
export const sticks = (axes: [number, number, number, number]): PadFrame =>
	readPad(pad({ axes }), NOTHING);

/**
 * A frame with one analog trigger pulled to `value`.
 *
 * The same construction as `press`, which is the point: a trigger is a button
 * that reports a continuous pull, and building it a second way would let the
 * two drift. Sage asked for the reuse, round 2 on #283.
 */
export const trigger = (name: "l2" | "r2", value: number): PadFrame =>
	press(name, value);

/** A connected pad with nothing touched, and no pad at all. */
export const rest = (): PadFrame => readPad(pad(), NOTHING);
export const absent = (): PadFrame => readPad(null, NOTHING);

/**
 * `readPad` itself, for the two rows that build a button array by hand.
 *
 * Re-exported rather than imported a second time by the caller, so this module
 * stays the one place a test reaches for a frame.
 */
export const padFrame = readPad;
