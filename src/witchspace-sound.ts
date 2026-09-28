/**
 * A jump by ear, after the cut (#534): the arms the principal listens to.
 *
 * #532 gave the jump its look and its sound stopped at the cut: the hum and
 * the sweep of #195's D3 run to the cut, and the flash, the ride, the sky
 * unfolding and the rift closing behind the ship — 7.5 s — were silent. The
 * schedule stays `witchspace.ts`'s (`witchspaceCues`); this file only names
 * the questions the node asks, as arms, picked from the URL
 * (`?witchsound=`), and what the arms decide for the flight bed.
 *
 * **Pure, and it imports nothing**, for `witchspace.ts`'s reason: the cue is
 * pushed to the audio layer, and a step module is free of it.
 *
 * - **before** — the dark closing to a point. `sweep`: the sweep as it was,
 *   which starts 1.4 s before the cut and is under the engine bed within half
 *   a second of starting, so the cut itself arrives unannounced. `rise`: the
 *   sweep holds and climbs all the way to the cut, and the flash cuts it off.
 *   `swallow`: it holds and climbs, then is drawn down into silence as the
 *   dark closes, so the point is heard as nothing before the flash.
 * - **flash** — the white on the cut. `boom`: a low impact. `glass`: a bright
 *   ring of light, high and short.
 * - **ride** — the tunnel. `rings`: a rushing that pulses with the rings as
 *   they pass. `bed`: a steady low drone under the whole ride.
 * - **engine** — the flight bed. `duck`: gone from the cut, back with the
 *   pilot's hands. `noduck`: it plays through the jump.
 * - **arrival** — the arrival-only path (#530's opening films it).
 *   `arrivalsound`: the same exit as after a jump. `arrivalquiet`: silent, as
 *   it was — there was no wind-up to hear.
 *
 * The unfolding and the rift have one voice each; the arms above are where
 * the node's questions have more than one plausible answer.
 */

export const WITCHSPACE_SOUND_ARMS = {
	before: ["sweep", "rise", "swallow"],
	flash: ["boom", "glass"],
	ride: ["rings", "bed"],
	engine: ["duck", "noduck"],
	arrival: ["arrivalsound", "arrivalquiet"],
} as const satisfies Record<string, readonly string[]>;

export type WitchspaceSoundArms = {
	-readonly [K in keyof typeof WITCHSPACE_SOUND_ARMS]: (typeof WITCHSPACE_SOUND_ARMS)[K][number];
};

/** The first of each arm. A default is needed to fly at all; it is not a
 *  ruling, and the principal's listen is what picks. */
export const DEFAULT_WITCHSPACE_ARMS: WitchspaceSoundArms = {
	before: "sweep",
	flash: "boom",
	ride: "rings",
	engine: "duck",
	arrival: "arrivalsound",
};

/**
 * The arms a `?witchsound=` value names: comma-separated tokens, each one an
 * arm's value (they are unique across arms). Unknown tokens are handed back
 * so the caller can say so rather than fly a silent default.
 */
export function witchspaceSoundArms(value: string | null): {
	arms: WitchspaceSoundArms;
	unknown: string[];
} {
	const tokens = (value ?? "")
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	const arms: WitchspaceSoundArms = { ...DEFAULT_WITCHSPACE_ARMS };
	const unknown: string[] = [];
	for (const token of tokens) {
		const arm = (
			Object.keys(WITCHSPACE_SOUND_ARMS) as (keyof WitchspaceSoundArms)[]
		).find((k) =>
			(WITCHSPACE_SOUND_ARMS[k] as readonly string[]).includes(token),
		);
		if (arm) (arms as Record<string, string>)[arm] = token;
		else unknown.push(token);
	}
	return { arms, unknown };
}
