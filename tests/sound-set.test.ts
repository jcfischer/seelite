/**
 * The sound set is every cue (#552). `probe-audio-cues.mjs` bands what it
 * renders and `npm run sounds` writes it for the principal's ear, so a cue
 * kind missing from it is a sound nobody banded and nobody listened to.
 */
import { expect, test } from "bun:test";
import { SOUND_SET as SET } from "../scripts/lib/sound-set.mjs";
import { CUE_BUS, type CueKind } from "../src/audio-cue";
import { WEAPON_SOUND_ARMS, DEFAULT_WEAPON_ARMS } from "../src/weapon-sound";
import { DEFAULT_FLIGHT_ARMS, FLIGHT_SOUND_ARMS } from "../src/flight-sound";

/** One entry, loosely: the list is a script's, and its inferred union has no
 *  field common to every shape. */
interface SoundEntry {
	name: string;
	cue?: { kind: string };
	loop?: number;
	legacy?: readonly unknown[];
	flight?: { arms: string };
	weapons?: { arms: string };
}
const SOUND_SET: readonly SoundEntry[] = SET;

/** Kinds with no entry of their own, each with its reason. */
const NOT_RENDERED: Partial<Record<CueKind, string>> = {
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

test("each entry before #544 names the method the engine before #552 exposed", () => {
	// The capture renders `origin/main` too, and that engine has no `play`.
	// #544's cues and loops did not exist there and render as absent.
	// And #546's console voices: the consoles were silent before it.
	const noLegacyMethod = new Set<string | undefined>([
		"cruiseEngage",
		"cruiseDrop",
		"notify",
		"press",
		"refuse",
		"focus",
		"gunLocked",
		"shieldHit",
		"hitLanded",
	]);
	// And #545's new voices of kinds that existed before it: a crack and a
	// clang were not sounds that engine could make.
	const since545 = new Set(["laser-crack", "hull-clang"]);
	for (const e of SOUND_SET)
		if (
			e.loop === undefined &&
			!e.flight &&
			!e.weapons &&
			!noLegacyMethod.has(e.cue?.kind) &&
			!since545.has(e.name)
		)
			expect([e.name, e.legacy?.length ?? 0]).not.toEqual([e.name, 0]);
});

test("every weapon arm is flown by some timeline", () => {
	// #545: an arm nobody rendered is an arm nobody listened to.
	const flown = new Set(
		SOUND_SET.flatMap((e) =>
			e.weapons ? String(e.weapons.arms).split(",").filter(Boolean) : [],
		),
	);
	for (const [arm, values] of Object.entries(WEAPON_SOUND_ARMS))
		for (const v of values)
			if (v !== DEFAULT_WEAPON_ARMS[arm as keyof typeof DEFAULT_WEAPON_ARMS])
				expect([v, flown.has(v)]).toEqual([v, true]);
});

/** Arms with no render, each with its reason. */
const ARMS_NOT_RENDERED: Record<string, string> = {
	docksilent: "is silence in a berth; the probe has no band for nothing",
};

test("every flight arm is flown by some timeline, or says why not", () => {
	const flown = new Set(
		SOUND_SET.flatMap((e) =>
			e.flight ? String(e.flight.arms).split(",").filter(Boolean) : [],
		),
	);
	for (const [arm, values] of Object.entries(FLIGHT_SOUND_ARMS))
		for (const v of values)
			if (
				v !== DEFAULT_FLIGHT_ARMS[arm as keyof typeof DEFAULT_FLIGHT_ARMS] &&
				!(v in ARMS_NOT_RENDERED)
			)
				expect([v, flown.has(v)]).toEqual([v, true]);
	for (const v of Object.keys(ARMS_NOT_RENDERED))
		expect(flown.has(v)).toBe(false);
});
