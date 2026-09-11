/**
 * The `Game`'s writes to its `WorldState` go through the module's writers.
 *
 * `world-state.ts`'s `withEnvelope` carries three things a hand-rolled write
 * does not: the galaxy bound, the `at < gameTime` refusal, and `materializeDue`
 * before the edit. Its own comment says a fifth writer "should not have to
 * rediscover the sequence" — and the fifth writer was in `main.ts`, which
 * spread a replacement envelope in by hand and set
 * `gameTime: this.world.gameTime / 60`.
 *
 * **That division is the defect, not a style point.** `World.gameTime` is
 * seconds (`sim.ts`); a `DeficitRow.updatedAt` is game minutes
 * (`deficits.ts`). A caller holding both must convert one of them at exactly
 * one boundary, and the hand-rolled write converted the world clock instead of
 * the row's stamp — so the first save taken after a trade would carry a clock
 * sixty times too small, and every `completesAt` in the snapshot would then sit
 * in the future for an hour of play.
 *
 * `Game` is not constructible headless — it builds a renderer — so this reads
 * the source. A source assertion is what `tests/output-stage.test.ts` and
 * `tests/headless.test.ts` already do for the same reason, and the alternative
 * is the wire being checked by nothing at all until a browser probe notices.
 */

import { describe, expect, test } from "bun:test";

const MAIN = await Bun.file(new URL("../src/main.ts", import.meta.url)).text();

/** Every writer `world-state.ts` exports that returns a new `WorldState`. */
const WRITERS = [
	"advanceTo",
	"applyTransition",
	"materializeDue",
	"observe",
	"observeDocking",
	"observeSystemRelay",
	"setDeficits",
	"setLegalHeat",
	"visit",
];

describe("the Game's world writes", () => {
	test("every assignment to the persistent world calls a world-state writer", () => {
		// The right-hand side of each `this.commerceWorld = …`, up to the end of
		// that line. A call is `name(` on the line; an object literal is `{`.
		const assignments = [...MAIN.matchAll(/this\.commerceWorld = (.*)$/gm)].map(
			(m) => m[1].trim(),
		);
		// The constructor's `newPersistentWorld` plus the writers. If this hits
		// zero the regex has drifted and every case below is vacuously true.
		expect(assignments.length).toBeGreaterThanOrEqual(5);
		const byHand = assignments.filter(
			(rhs) =>
				!rhs.startsWith("newPersistentWorld(") &&
				// The load arm. A snapshot that came out of `parseSave` is the
				// one right-hand side that is neither a construction nor a
				// write: it is the world being *adopted*, already validated, and
				// requiring it to go through a writer would mean replaying the
				// save through `applyTransition` to arrive at what it already
				// says. Spelled as the exact expression rather than as a
				// pattern, so a hand-built object literal cannot hide behind it.
				rhs !== "save.world;" &&
				!WRITERS.some((w) => rhs.startsWith(`${w}(`)),
		);
		expect(byHand).toEqual([]);
	});

	test("the renderer never converts the world clock into minutes", () => {
		// `this.world.gameTime / 60` is game minutes, which is the right unit for
		// `stationMarketScreen`, `readDeficit` and `recordTrade` and the wrong
		// one for anything named `gameTime`. The two live one line apart in
		// `transactStation`, which is how they were transposed.
		const minutes = [...MAIN.matchAll(/gameTime:\s*[^,\n]*\/\s*60/g)];
		expect(minutes.map((m) => m[0])).toEqual([]);
	});
});
