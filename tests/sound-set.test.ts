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
import {
	arriveWitchspace,
	beginWitchspace,
	idleWitchspace,
	stepJump,
	witchspaceCues,
} from "../src/witchspace";
import {
	DEFAULT_WITCHSPACE_ARMS,
	WITCHSPACE_SOUND_ARMS,
	witchspaceSoundArms,
} from "../src/witchspace-sound";
import type { MusicCommand } from "../src/music-score";
import { TEST_SONGS } from "../src/music-test-score";
import { BLUE_DANUBE, danubeSong } from "../src/music-danube";

/** One entry, loosely: the list is a script's, and its inferred union has no
 *  field common to every shape. */
interface SoundEntry {
	name: string;
	cue?: { kind: string };
	loop?: number;
	legacy?: readonly unknown[];
	flight?: { arms: string };
	music?: {
		songs?: Record<string, string | object>;
		script?: readonly (readonly [number | "attach", { type: string }])[];
		/** #548: a scripted situation the director is stepped through. */
		director?: { keys: readonly unknown[]; arms: string };
	};
	weapons?: { arms: string };
	witchspace?: { arms: string; from: string };
	scheduled?: { kinds: string[]; arms: string };
}
const SOUND_SET: readonly SoundEntry[] = SET;

/** Kinds with no entry of their own, each with its reason. */
const NOT_RENDERED: Partial<Record<CueKind, string>> = {
	witchspaceStop: "takes the other witchspace cues back; it makes no sound",
};

/**
 * The kinds a jump timeline plays, from the real schedule stepped as
 * `renderInPage` steps it (#534): the ride, the unfolding and the rift are
 * rendered there and not as lone cues, because their shape is the schedule's.
 */
function scheduledKinds(e: SoundEntry): string[] {
	if (!e.witchspace) return [];
	const { arms } = witchspaceSoundArms(e.witchspace.arms);
	const kinds: string[] = [];
	let s =
		e.witchspace.from === "arrival" ? arriveWitchspace() : beginWitchspace();
	kinds.push(...witchspaceCues(idleWitchspace(), s, arms).map((c) => c.kind));
	for (let i = 0; i < 2000 && s.kind !== "idle"; i++) {
		const next = stepJump(s, 1 / 50);
		kinds.push(...witchspaceCues(s, next, arms).map((c) => c.kind));
		s = next;
	}
	// The stop is played too, and is `NOT_RENDERED`'s: it makes no sound.
	return kinds.filter((k) => k !== "witchspaceStop");
}

test("every cue kind is rendered, or says why not", () => {
	const rendered = new Set<string>(
		SOUND_SET.flatMap((e) =>
			e.cue
				? [e.cue.kind]
				: e.scheduled
					? e.scheduled.kinds
					: scheduledKinds(e),
		),
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
		// #534's flash: a jump was silent after the cut before it.
		"witchspaceFlash",
	]);
	// And #545's new voices of kinds that existed before it: a crack and a
	// clang were not sounds that engine could make.
	const since545 = new Set(["laser-crack", "hull-clang", "hull-clang-tail"]);
	for (const e of SOUND_SET)
		if (
			e.loop === undefined &&
			!e.flight &&
			!e.music &&
			!e.weapons &&
			!e.witchspace &&
			!e.scheduled &&
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

/**
 * Every transport move: `true` where a render scripts it for the ear, or the
 * reason none does. A `Record` over the whole union, so a move added to
 * `MusicCommand` with no entry here is a type error rather than a gap.
 */
const MOVES: Record<MusicCommand["type"], true | string> = {
	load: "is sent for every render's songs before its script, not in it",
	play: true,
	crossfade: true,
	jump: "is the same line arithmetic as resolve, which the waltz renders",
	resolve: true,
	stop: true,
	stem: true,
	tempo: true,
	sync: "moves nothing: the render sends it around every scripted command",
};

test("every transport move is rendered for the ear, or says why not (#560)", () => {
	// Scripted renders only: #548's director renders send what the director does.
	const music = SOUND_SET.flatMap((e) => (e.music?.script ? [e.music] : []));
	const sent = new Set(
		music.flatMap((m) => (m.script ?? []).map(([, c]) => c.type)),
	);
	for (const [move, why] of Object.entries(MOVES))
		expect([move, sent.has(move)]).toEqual([move, why === true]);
	// And every song a render names is one `renderInPage` can load: the test
	// score's, or #547's waltz.
	const songs: Record<string, unknown> = {
		...TEST_SONGS,
		danube: BLUE_DANUBE,
		"danube-oxygene": danubeSong("oxygene"),
		"danube-hybrid": danubeSong("hybrid"),
	};
	for (const m of music)
		for (const song of Object.values(m.songs ?? {}))
			if (typeof song === "string")
				expect([song, songs[song]]).toEqual([song, expect.anything()]);
});

test("every witchspace arm is flown by some jump, one question at a time", () => {
	// #534: an arm nobody rendered is an arm nobody listened to.
	const jumps = SOUND_SET.filter((e) => e.witchspace);
	const flown = new Set(
		jumps.flatMap((e) => {
			const { arms, unknown } = witchspaceSoundArms(
				(e.witchspace as { arms: string }).arms,
			);
			expect([e.name, unknown]).toEqual([e.name, []]);
			return Object.values(arms);
		}),
	);
	for (const values of Object.values(WITCHSPACE_SOUND_ARMS))
		for (const v of values) expect([v, flown.has(v)]).toEqual([v, true]);
	// Each flips at most one arm from the defaults.
	for (const e of jumps) {
		const { arms } = witchspaceSoundArms(
			(e.witchspace as { arms: string }).arms,
		);
		const flipped = (Object.keys(arms) as (keyof typeof arms)[]).filter(
			(k) => arms[k] !== DEFAULT_WITCHSPACE_ARMS[k],
		);
		expect([e.name, flipped.length <= 1]).toEqual([e.name, true]);
	}
});
