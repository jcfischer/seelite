/**
 * The audio unlock's listener set, held headless (node #550).
 *
 * This is the only check the unlock can have here: #541 measured that every
 * probe lane runs an `AudioContext` before any input, so a browser probe
 * passes whatever the listeners are. `src/audio-unlock.ts` cites the rule.
 *
 * The event names are written out below rather than read from
 * `AUDIO_UNLOCK_EVENTS`. A test that iterated the export would stay green with
 * `touchend` deleted from it, which is the defect this node exists to fix.
 */
import { expect, test } from "bun:test";
import { AUDIO_UNLOCK_EVENTS, armAudioUnlock } from "../src/audio-unlock";
import { codeOf } from "./lib/source-scan";

/** The set the specification requires: a key, a mouse press, and a touch's
 *  release by both of the routes a browser may report it. */
const REQUIRED = ["keydown", "pointerdown", "pointerup", "touchend"];

/** A target that records every add and remove, which a real `EventTarget`
 *  cannot list back. */
function recordingTarget() {
	const listeners = new Map<string, Set<() => void>>();
	const added: { type: string; fn: () => void }[] = [];
	const removed: { type: string; fn: () => void }[] = [];
	return {
		added,
		removed,
		listeners,
		addEventListener(type: string, fn: () => void) {
			added.push({ type, fn });
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)?.add(fn);
		},
		removeEventListener(type: string, fn: () => void) {
			removed.push({ type, fn });
			listeners.get(type)?.delete(fn);
		},
		fire(type: string) {
			for (const fn of [...(listeners.get(type) ?? [])]) fn();
		},
		live(): string[] {
			return [...listeners]
				.filter(([, s]) => s.size > 0)
				.map(([t]) => t)
				.sort();
		},
	};
}

test("the unlock listens for a key, a mouse press, and a touch's release", () => {
	const target = recordingTarget();
	armAudioUnlock(
		target,
		() => false,
		() => {},
	);
	expect(target.added.map((a) => a.type).sort()).toEqual(REQUIRED);
	const exported: string[] = [...AUDIO_UNLOCK_EVENTS];
	expect(exported.sort()).toEqual(REQUIRED);
});

test("each event tries the unlock, and nothing is removed while it is silent", () => {
	const target = recordingTarget();
	let tries = 0;
	let unlocked = 0;
	armAudioUnlock(
		target,
		() => {
			tries++;
			return false;
		},
		() => unlocked++,
	);
	for (const type of REQUIRED) target.fire(type);
	expect(tries).toBe(REQUIRED.length);
	expect(target.removed).toEqual([]);
	expect(target.live()).toEqual(REQUIRED);
	expect(unlocked).toBe(0);
});

for (const type of REQUIRED) {
	test(`${type} alone can open the sound`, () => {
		const target = recordingTarget();
		let unlocked = 0;
		armAudioUnlock(
			target,
			() => true,
			() => unlocked++,
		);
		target.fire(type);
		expect(unlocked).toBe(1);
	});
}

test("the first success removes every listener it added, and runs once", () => {
	const target = recordingTarget();
	let running = false;
	let tries = 0;
	let unlocked = 0;
	armAudioUnlock(
		target,
		() => {
			tries++;
			return running;
		},
		() => unlocked++,
	);
	// A touch's press grants nothing: the context stays suspended.
	target.fire("pointerdown");
	expect(unlocked).toBe(0);
	// Its release does.
	running = true;
	target.fire("pointerup");
	expect(unlocked).toBe(1);
	expect(target.live()).toEqual([]);
	// The same function references, one per type, came off.
	const byType = (a: { type: string }, b: { type: string }) =>
		a.type.localeCompare(b.type);
	expect([...target.removed].sort(byType)).toEqual(
		[...target.added].sort(byType),
	);
	// The rest of the tap, and any later input, reaches nothing.
	target.fire("touchend");
	target.fire("keydown");
	expect(unlocked).toBe(1);
	expect(tries).toBe(2);
});

test("main.ts arms the unlock through the leaf and adds no listener of its own", () => {
	const main = codeOf("src/main.ts");
	expect(main).toMatch(/\barmAudioUnlock\s*\(\s*window\b/);
	expect(main).not.toMatch(/\bunlockAudio\b/);
	expect(main).not.toMatch(
		/\.audio\.ensure\(\)[\s\S]{0,400}removeEventListener/,
	);
});

test("src/audio-unlock.ts imports nothing", () => {
	const code = codeOf("src/audio-unlock.ts");
	expect(code.match(/\bimport\b|\brequire\s*\(|\bfrom\s*["'`]/g) ?? []).toEqual(
		[],
	);
});
