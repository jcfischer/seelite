/**
 * The sound set is every cue (#552). `probe-audio-cues.mjs` bands what it
 * renders and `npm run sounds` writes it for the principal's ear, so a cue
 * kind missing from it is a sound nobody banded and nobody listened to.
 */
import { expect, test } from "bun:test";
import { SOUND_SET } from "../scripts/lib/sound-set.mjs";
import { CUE_BUS, type CueKind } from "../src/audio-cue";

/** Kinds with no entry of their own, each with its reason. */
const NOT_RENDERED: Partial<Record<CueKind, string>> = {
	shieldHit: "plays the same sound as hullHit, which the set renders as `hit`",
	witchspaceStop: "takes the other two witchspace cues back; it makes no sound",
};

test("every cue kind is rendered, or says why not", () => {
	const rendered = new Set<string>(
		SOUND_SET.flatMap((e) => (e.cue ? [e.cue.kind] : [])),
	);
	for (const kind of Object.keys(CUE_BUS) as CueKind[])
		expect(rendered.has(kind) || kind in NOT_RENDERED).toBe(true);
	// And no reason outlives its kind.
	for (const kind of Object.keys(NOT_RENDERED))
		expect(rendered.has(kind)).toBe(false);
});

test("the bed is rendered at idle and at full throttle", () => {
	const loops = SOUND_SET.flatMap((e) =>
		e.loop === undefined ? [] : [e.loop],
	);
	expect(loops).toContain(1);
	expect(loops.some((l) => l > 0 && l < 1)).toBe(true);
});

test("each entry names the method the engine before #552 exposed", () => {
	// The capture renders `origin/main` too, and that engine has no `play`.
	for (const e of SOUND_SET)
		if (e.loop === undefined) expect(e.legacy?.length).toBeGreaterThan(0);
});
