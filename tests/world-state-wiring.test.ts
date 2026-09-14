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

	test("the carrier-condition hook exists and writes through the module", () => {
		// **Named for what it can check.** It was called "the path is reachable
		// from a running game", and `toContain("applyCarrierTransition(")` is
		// satisfied by the method's own declaration — so the row stayed green on
		// a build where nothing ever called it, which is the state its comment
		// claimed #90 had fixed. Nothing in the game calls it yet and nothing is
		// meant to: §4's table has no in-flight producer, and #43's prototype is
		// the first consumer. What this can hold is that the hook is here and
		// that it goes through the module's writer rather than editing the
		// envelope, so a debug caller cannot reach a state a real writer could
		// not. A source check, for the same reason as the rows above — `Game`
		// builds a renderer and is not constructible headless.
		expect(MAIN).toContain("applyCarrierTransition(");
		expect(MAIN).toContain("carrierCondition(");
		const body = MAIN.split("applyCarrierTransition(")[1] ?? "";
		expect(body.slice(0, 400)).toContain("applyTransition(");
	});

	test("a cruise save is not handed its cruise velocity back", () => {
		// **The one thing that must not be restored under any arm.** A cruise
		// velocity is the cruise law's, up to about 10⁶× combat speed, and
		// handing it to normal flight is a ship that cannot be flown. The
		// browser arm in `scripts/probe-save.mjs` reads the restored ship back;
		// this reads the source, because the two answer different questions and
		// `Game` builds a renderer.
		const arm = MAIN.split('if (f.regime === "cruise")')[1] ?? "";
		expect(arm.slice(0, 300)).toContain("this.world.ship.vel = v3();");
		expect(arm.slice(0, 300)).toContain('this.regime = "normal";');
	});

	test("a failed write reaches the player through the store's held faults (#89 D9, §11.5)", () => {
		// The store took an `onWriteFailed` and the boot did not pass it for a
		// round, so the shipped game still told nobody while a test proved the
		// mechanism worked. It is the log line now; the badge reads the store.
		expect(MAIN).toContain("onWriteFailed:");
		const reader = MAIN.split("saveFaultText(): string | null {")[1] ?? "";
		expect(reader.slice(0, 120)).toContain(
			"return heldSaveFault(this.saveStore, this.saveFault);",
		);
		// **Not one message field written by every failure.** After a failed dock
		// flush, a debounced write that failed once and then landed replaced the
		// dock's words, and the overlay named a write that had landed (#311).
		// Sliced to each arm and matched on `saveFault =` alone, whatever follows
		// it: a guard on one spelling passed on the spelling `main` had (round 2).
		const onWriteFailed =
			MAIN.split("onWriteFailed: (error, consecutive) => {")[1] ?? "";
		const writeArm = onWriteFailed.slice(0, onWriteFailed.indexOf("},"));
		expect(writeArm).toContain("console.error(");
		expect(writeArm).not.toContain("saveFault =");
		const flush = MAIN.split("saveFlush(reason: FlushReason): void {")[1] ?? "";
		const flushBody = flush.slice(0, flush.indexOf("\n\t}\n"));
		expect(flushBody).toContain(".flush(reason)");
		expect(flushBody).not.toContain("saveFault =");
	});

	test("the badge and the overlay it opens read the one rule, every frame in both views", () => {
		// In `animate` and not in `updateCockpit`, which returns early in chase.
		const loop = MAIN.split("private animate = () => {")[1] ?? "";
		const end = loop.indexOf("\n\t};");
		expect(loop.slice(0, end)).toContain(
			"this.saveBadge?.update(this.saveFaultShown());",
		);
		const shown = MAIN.split("saveFaultShown(): boolean {")[1] ?? "";
		expect(shown.slice(0, 120)).toContain(
			"return hasHeldSaveFault(this.saveStore, this.saveFault);",
		);
		expect(MAIN).toContain("fault: () => game.saveFaultText(),");
	});

	test("the jump flush runs after the arrival finishes", () => {
		// It ran beside `visit`, above `clearFlightSession` and `faceTheStar`,
		// so the record carried the departure system's regime, throttle and
		// attitude beside the new arrival position — and clearing the dirty flag
		// meant nothing below re-armed a write.
		const jump = MAIN.indexOf('this.saveFlush("jump")');
		expect(jump).toBeGreaterThan(0);
		expect(
			MAIN.lastIndexOf("this.clearFlightSession();", jump),
		).toBeGreaterThan(MAIN.lastIndexOf("visit(this.commerceWorld", jump));
	});

	test("a refused save is never given a store aimed at it (#89 D9)", () => {
		// D9's one promise is that the bad record is never overwritten — it is
		// the only copy of whatever is left and the only thing the player can
		// still export. A store attached to that slot would write over it on the
		// first dirty event: the next dock, the next trade, the relay observe on
		// the next jump. The guard is on the construction, not on the write.
		expect(MAIN).toContain("!noSave && plan.fault === null");
		// **And on the one-shot path**, which attaches with no such guard: a
		// record that parses and will not restore turns the plan into an overlay
		// boot there. `withRestoreFault` is tested headless; this pins that the
		// boot calls it. Textual, so it proves the call is present and nothing
		// about what surrounds it.
		expect(MAIN).toContain("plan = withRestoreFault(plan, error);");
	});

	test("permadeath is chosen at new game and cannot be flipped later", () => {
		const body = MAIN.split("choosePermadeath(): void")[1] ?? "";
		// The refusal, not just the assignment: a flag that can be turned on
		// after the fact is a setting, and D7 promises it was written at
		// creation.
		expect(body.slice(0, 300)).toContain("gameTime > 0");
		expect(MAIN).toContain(
			'permadeathAtAttach(plan, slot, query.has("permadeath"))',
		);
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
