/**
 * The notice vocabulary, and the module boundary it moved to (#381 S4).
 *
 * `LayoutNotice`, `RejectReason`, `retiredBySave` and `collisionNotices` lived
 * in `src/binding-store.ts` through the storage slice. Sage asked four times
 * on #486 for them to move, correctly: `collisionNotices` diagnoses a live
 * table with no storage involved at all, and `main.ts` calls it on every
 * rebind. It was declined there because splitting a vocabulary for no change
 * in behaviour, on a slice already six rounds deep, buys a seventh round and
 * nothing else.
 *
 * **The capture modal is the second storage-free caller** — a bind-time
 * collision warning, which is #369 D5's first half — and that is the change
 * that makes the file pay for itself. So the rows here are about the boundary
 * rather than about the notices: the sentences they print are
 * `tests/controls-reference.test.ts`'s and the blob-level refusals are
 * `tests/binding-store.test.ts`'s.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_BINDINGS, type Binding, layoutOf } from "../src/commands";
import { collisionNotices, retiredBySave } from "../src/layout-notice";
import { codeOf } from "./lib/source-scan";

describe("a collision is diagnosed with no store in the room", () => {
	test("the shipped layout carries none", () => {
		// D5's first predicate, read through the notice shape rather than
		// through `collisions()` directly: the sentence a panel prints is
		// derived from this, so a shipped layout that produced one would be a
		// band on the tab with nothing a player did behind it.
		expect(collisionNotices(DEFAULT_BINDINGS)).toEqual([]);
	});

	test("and a colliding one is reported without `window` existing", () => {
		// **The row the move is for.** This file installs no fake `window` and
		// no fake `localStorage` — `tests/binding-store.test.ts` has to, and
		// says why. A diagnosis of a table in memory must not be downstream of
		// a store, because the capture modal warns *before* the bind is taken
		// and there is nothing to save yet.
		expect(typeof globalThis.window).toBe("undefined");
		const cruise = DEFAULT_BINDINGS.find((b) => b.command === "fly.cruise");
		if (!cruise) throw new Error("fly.cruise has no default binding");
		const clash: Binding = { ...cruise, command: "fight.firePulse" };
		const notices = collisionNotices(layoutOf([...DEFAULT_BINDINGS, clash]));
		expect(notices.length).toBe(1);
		const only = notices[0];
		expect(only?.kind).toBe("collision");
		// And it names a trigger rather than the hash `collisions()` groups on,
		// which is the whole reason the notice carries `at`.
		if (only?.kind === "collision") {
			expect(only.at.kind).toBe("key");
			expect(only.collision.commands.slice().sort()).toEqual([
				"fight.firePulse",
				"fly.cruise",
			]);
		}
	});

	test("the notices module owns which kinds a save retires", () => {
		// **Moved here from `tests/binding-store.test.ts` with the function.**
		// `main.ts` wrote this rule as `kind !== "collision"` for a round, so a
		// sixth kind would have been classified by its reader rather than by
		// the module that decides which kinds exist (sage round 2 on #486) —
		// and that module is this one now.
		expect(
			retiredBySave({ kind: "unreadable", cause: "corrupt", detail: "x" }),
		).toBe(true);
		expect(retiredBySave({ kind: "version", stored: 2 })).toBe(true);
		expect(retiredBySave({ kind: "unsaved" })).toBe(true);
		expect(
			retiredBySave({
				kind: "rejected",
				command: "fly.pitchUp",
				reason: "moved-default",
				detail: "x",
			}),
		).toBe(true);
		// A collision is a property of the table as it stands, not a fact about
		// the blob that was read, so replacing the blob does not retire it —
		// and this one is built by `collisionNotices` rather than by hand, so
		// the row cannot agree with a shape the producer has stopped making.
		const cruise = DEFAULT_BINDINGS.find((b) => b.command === "fly.cruise");
		if (!cruise) throw new Error("fly.cruise has no default binding");
		const clash: Binding = { ...cruise, command: "fight.firePulse" };
		const only = collisionNotices(layoutOf([...DEFAULT_BINDINGS, clash]))[0];
		if (only === undefined) throw new Error("no collision to check");
		expect(retiredBySave(only)).toBe(false);
	});
});

describe("the boundary itself", () => {
	test("the store produces these notices and defines none of them", () => {
		// The property the move is: `binding-store.ts` still makes every one of
		// these, and a reader looking for what a notice *is* no longer has to
		// open the persistence module to find out.
		const store = codeOf("src/binding-store.ts");
		for (const declared of [
			"export type LayoutNotice",
			"export type RejectReason",
			"export const retiredBySave",
			"export function collisionNotices",
		])
			expect(store, declared).not.toContain(declared);
		expect(store).toMatch(/from "\.\/layout-notice"/);
	});

	test("the notices module names the registry and nothing else", () => {
		// A collision is a registry question — `collisions()` answers it — and
		// nothing here may reach for a store, a screen or a global. An import
		// of `binding-store.ts` would close a cycle and put the vocabulary back
		// behind the module it was taken out of.
		const source = codeOf("src/layout-notice.ts");
		const froms = source.match(/\bfrom\s*["'][^"']+["']/g) ?? [];
		expect(froms).toEqual(['from "./commands"']);
		expect(source).not.toMatch(/localStorage|window\./);
	});

	test("the printed sentence is no longer downstream of the store", () => {
		// #369 D11 gives `controls-reference.ts` the one owner of every printed
		// control name, and it reached for the notice union through the
		// persistence module to get it. It does not any more, which is what the
		// split buys a reader beyond tidiness: the tab's formatter and the
		// player's disk have no edge between them.
		expect(codeOf("src/controls-reference.ts")).not.toMatch(
			/from\s*["'`]\.\/binding-store["'`]/,
		);
	});
});
