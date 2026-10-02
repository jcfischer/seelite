/**
 * The saturation cue's arithmetic (`flight-model.md` §3.8.1, #621): when the
 * marker for a saturated family pulses, and how bright it is at a moment.
 *
 * Pure, and kept apart from the canvas that draws it, so the latch and the
 * pulse can be held headless (`tests/vent-cue.test.ts`). What *saturated*
 * means is the sim's — `FlightStep.saturated` and `AngularStep.saturated` —
 * and nothing here re-decides it.
 *
 * **Two families, two markers** (`hud-and-scanner.md` §4.1). A translation
 * axis the assist cannot meet — drift it cannot kill, a speed above the cap it
 * is still burning off — pulses the prograde and retrograde markers, which
 * are what say where the hull is going. A rotation axis — a turn it cannot
 * stop — pulses the nose marker, which is what says where the hull points.
 *
 * **The pulse is alpha alone.** §4 has given every hue a meaning, and amber
 * and red are both taken, so a cue that changed a marker's colour would be a
 * new word. It dims the marker's own tone and brings it back.
 */

/** How long one saturated step keeps the cue up, seconds. The sim's flag can
 *  set and clear on alternate steps — a pointer flick, a turn at the edge of
 *  the couple — and a pulse that restarted on each would flicker rather than
 *  pulse. Longer than one period, so a single step still reads as a pulse. */
export const SATURATION_HOLD_S = 0.6;

/** The pulse's rate, Hz. §4 asks for *restrained* motion: slower than a
 *  strobe, fast enough that one period fits in the hold. */
export const SATURATION_PULSE_HZ = 2.5;

/** The pulse's trough, as a fraction of the marker's own alpha. Never zero:
 *  the marker is still the instrument while it pulses, and one that blinked
 *  out would leave a pilot with no velocity vector at the moment it matters. */
export const SATURATION_PULSE_FLOOR = 0.3;

/** One family's latch: when it began, and the last step it was saturated. */
export interface CueLatch {
	onsetS: number;
	lastS: number;
}

/** Both families' latches; `null` is a family with no cue up. */
export interface SaturationCue {
	linear: CueLatch | null;
	angular: CueLatch | null;
}

export type CueFamily = keyof SaturationCue;

export const quietCue = (): SaturationCue => ({ linear: null, angular: null });

const stepLatch = (
	latch: CueLatch | null,
	saturated: boolean,
	nowS: number,
): CueLatch | null => {
	if (saturated) return latch ? { ...latch, lastS: nowS } : { onsetS: nowS, lastS: nowS };
	if (latch && nowS - latch.lastS < SATURATION_HOLD_S) return latch;
	return null;
};

/**
 * One step of the latch. `nowS` is the game clock, so a held clock holds the
 * cue — and its pulse's phase — where it is, which is what lets a still frame
 * be taken twice.
 */
export function stepSaturationCue(
	cue: SaturationCue,
	saturated: { linear: boolean; angular: boolean },
	nowS: number,
): SaturationCue {
	return {
		linear: stepLatch(cue.linear, saturated.linear, nowS),
		angular: stepLatch(cue.angular, saturated.angular, nowS),
	};
}

/** The pulse `sinceS` after onset: full at onset, down to the floor half a
 *  period later, and back. */
export function pulseAlpha(sinceS: number): number {
	const wave = 0.5 + 0.5 * Math.cos(2 * Math.PI * SATURATION_PULSE_HZ * sinceS);
	return SATURATION_PULSE_FLOOR + (1 - SATURATION_PULSE_FLOOR) * wave;
}

/** What a family's marker multiplies its alpha by at `nowS`: 1 when the
 *  family has no cue up. */
export function cueAlpha(
	cue: SaturationCue,
	family: CueFamily,
	nowS: number,
): number {
	const latch = cue[family];
	return latch ? pulseAlpha(Math.max(0, nowS - latch.onsetS)) : 1;
}

/**
 * An `rgba()` colour with its alpha scaled by `k` and its channels left alone.
 * It throws on anything else rather than handing back a colour it did not
 * read: a marker restyled to hex would otherwise stop pulsing in silence.
 */
export function withAlpha(rgba: string, k: number): string {
	const m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(rgba);
	if (!m) throw new Error(`withAlpha: not an rgba() colour: ${rgba}`);
	const alpha = Number(m[4]) * k;
	return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${Number(alpha.toFixed(4))})`;
}
