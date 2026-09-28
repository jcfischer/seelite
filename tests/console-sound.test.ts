/**
 * The consoles' sound, as arithmetic (#546): which cue a press, a cursor move
 * and a message owe on each arm, and how often a message may sound. Whether
 * any of it sounds right is the principal's ear.
 */
import { expect, test } from "bun:test";
import type { Clearance } from "../src/docking";
import {
	CONSOLE_SOUND_ARMS,
	clearanceTone,
	consoleSoundArms,
	DEFAULT_CONSOLE_ARMS,
	focusCue,
	NOTIFY_GAP_S,
	notifyCue,
	pressCue,
	QUIET_NOTIFY,
} from "../src/console-sound";

const arms = DEFAULT_CONSOLE_ARMS;

test("no value flies the defaults, and each token sets its own arm", () => {
	expect(consoleSoundArms(null)).toEqual({ arms, unknown: [] });
	const { arms: set, unknown } = consoleSoundArms("onenote, square,bogus");
	expect(unknown).toEqual(["bogus"]);
	expect(set).toEqual({ ...arms, notes: "onenote", press: "square" });
	expect(consoleSoundArms("hover,legacy").arms).toBe("legacy");
});

test("arm values are unique across arms, so a token names one arm", () => {
	const all = Object.values(CONSOLE_SOUND_ARMS).flat();
	expect(new Set(all).size).toBe(all.length);
});

test("an accepted press clicks; a refused one buzzes, or clicks on norefuse", () => {
	expect(pressCue(arms, true)).toEqual({ kind: "press" });
	expect(pressCue(arms, false)).toEqual({ kind: "refuse" });
	expect(pressCue({ ...arms, refusal: "norefuse" }, false)).toEqual({
		kind: "press",
	});
	// `square` is the one tick the engine had, never played before #546.
	expect(pressCue({ ...arms, press: "square" }, true)).toEqual({ kind: "ui" });
	expect(pressCue({ ...arms, press: "square" }, false)).toEqual({
		kind: "refuse",
	});
});

test("legacy is the build before #546: every press is silent", () => {
	expect(pressCue("legacy", true)).toBeNull();
	expect(pressCue("legacy", false)).toBeNull();
	expect(focusCue("legacy", "pad")).toBeNull();
	expect(focusCue("legacy", "hover")).toBeNull();
});

test("a cursor move ticks on its own arm, a hover only on hover", () => {
	expect(focusCue(arms, "pad")).toEqual({ kind: "focus" });
	expect(focusCue(arms, "hover")).toBeNull();
	expect(focusCue({ ...arms, hover: "hover" }, "hover")).toEqual({
		kind: "focus",
	});
	expect(focusCue({ ...arms, focus: "nofocus" }, "pad")).toBeNull();
});

test("a message names its tone; onenote plays every tone as a message", () => {
	const good = notifyCue(QUIET_NOTIFY, arms, "good", 10);
	expect(good.cue).toEqual({ kind: "notify", tone: "good" });
	const one = notifyCue(QUIET_NOTIFY, { ...arms, notes: "onenote" }, "bad", 10);
	expect(one.cue).toEqual({ kind: "notify", tone: "message" });
});

test("legacy keeps today's alert for a hail and nothing for the rest", () => {
	expect(notifyCue(QUIET_NOTIFY, "legacy", "message", 1, "hail").cue).toEqual({
		kind: "alert",
	});
	expect(notifyCue(QUIET_NOTIFY, "legacy", "bad", 1).cue).toBeNull();
	expect(notifyCue(QUIET_NOTIFY, "legacy", "good", 1).cue).toBeNull();
});

test("on gap, a second message of one tone inside the gap is silent", () => {
	const first = notifyCue(QUIET_NOTIFY, arms, "message", 100);
	expect(first.cue).not.toBeNull();
	const soon = notifyCue(first.gate, arms, "message", 100 + NOTIFY_GAP_S / 2);
	expect(soon.cue).toBeNull();
	// Measured from the last one that sounded, not from the silent one.
	const later = notifyCue(soon.gate, arms, "message", 100 + NOTIFY_GAP_S);
	expect(later.cue).not.toBeNull();
	// Another tone is not held by this one's gap.
	const bad = notifyCue(first.gate, arms, "bad", 100.1);
	expect(bad.cue).toEqual({ kind: "notify", tone: "bad" });
});

test("on every, each message sounds", () => {
	const every = { ...arms, rate: "every" } as const;
	const first = notifyCue(QUIET_NOTIFY, every, "message", 100);
	const soon = notifyCue(first.gate, every, "message", 100.01);
	expect(soon.cue).not.toBeNull();
});

test("onenote gaps every tone as one, because it is one sound", () => {
	const one = { ...arms, notes: "onenote" } as const;
	const first = notifyCue(QUIET_NOTIFY, one, "good", 100);
	expect(notifyCue(first.gate, one, "bad", 100.1).cue).toBeNull();
});

test("a clearance answer sounds when it changes, and not when it repeats", () => {
	const none: Clearance = { kind: "none" };
	const granted: Clearance = { kind: "granted", expiresAtS: 60 };
	const queued: Clearance = { kind: "queued", position: 2 };
	const denied: Clearance = { kind: "denied", reason: "hostile" };
	expect(clearanceTone(none, granted)).toBe("good");
	expect(clearanceTone(none, queued)).toBe("message");
	expect(clearanceTone(none, denied)).toBe("bad");
	expect(clearanceTone(queued, granted)).toBe("good");
	// A re-request that changes nothing is not news.
	expect(clearanceTone(granted, { kind: "granted", expiresAtS: 90 })).toBe(
		null,
	);
	expect(clearanceTone(queued, { kind: "queued", position: 1 })).toBe(null);
	expect(clearanceTone(denied, denied)).toBe(null);
	expect(
		clearanceTone(denied, { kind: "denied", reason: "no berth that fits" }),
	).toBe("bad");
	expect(clearanceTone(granted, none)).toBe(null);
});

test("each default is the first value of its arm", () => {
	for (const [arm, values] of Object.entries(CONSOLE_SOUND_ARMS))
		expect([arm, DEFAULT_CONSOLE_ARMS[arm as keyof typeof arms]]).toEqual([
			arm,
			values[0],
		]);
});
