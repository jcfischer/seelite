/**
 * The perf panel's keys must not be the flight controls' keys.
 *
 * This exists because I got it wrong by assertion. The panel first took the
 * digit row, on the strength of a comment saying the flight controls own the
 * letters — and `1` and `3` swing the chase view, `2` selects one, and `0`
 * resets the cruise dials. Four working controls, silently stolen, in a mode
 * whose entire purpose is to be used *while flying*.
 *
 * A comment cannot hold that; a test can. The bindings are read out of the
 * registry rather than restated here, so a key bound tomorrow collides at
 * `bun test` instead of in flight.
 *
 * **Out of the registry since #381's dispatch fold, and out of `main.ts`
 * before it.** That file no longer states a key, so a scan of its text finds
 * nothing and every row below would have gone *vacuously* green — the exact
 * failure mode the guard-the-guard row exists to catch, and it did.
 */
import { describe, expect, test } from "bun:test";
import { CLASS_GLSL } from "../src/planet-classes.glsl";
import { PERF_CLASSES, PERF_KEYS, RESTORE_KEY } from "../src/perf-panel";
import { COMMANDER_KEY } from "../src/commander-overlay";
import { SETTINGS_KEY } from "../src/settings-panel";
import { commandById, DEFAULT_BINDINGS, resolveKey } from "../src/commands";
/**
 * Every key the game binds to something that is **not** a diagnostic.
 *
 * The diagnostics carry `fixed: "diagnostic"`, so that half is a property of
 * the catalogue: a flight command that took `b` tomorrow lands in this set and
 * the row below goes red, which is the failure this file was opened for.
 *
 * **No panel is exempt any more.** The two player screens were a written
 * list here, `PANEL_OWNED_COMMANDS`, because each opened on a listener of its
 * own; `system.settings` left it in #381 S4 and `system.commander` in S5,
 * when both opens folded into `Game.command` behind a `Controls` tab door.
 * The list went with its last entry.
 */
const flightKeys = () =>
	new Set(
		DEFAULT_BINDINGS.flatMap((b) =>
			b.trigger.kind === "key" && commandById(b.command).fixed !== "diagnostic"
				? [b.trigger.key]
				: [],
		),
	);

describe("the perf panel stays out of the flight controls", () => {
	test("the partition finds the bindings it is supposed to find", () => {
		// Guarding the guard: an empty set would make the case below vacuously
		// green, which is the failure mode of every derived partition.
		const bound = flightKeys();
		expect(bound.size).toBeGreaterThan(15);
		// Three known bindings of three different shapes.
		expect(bound).toContain("v"); // pressed: view toggle
		expect(bound).toContain("shift"); // held: throttle
		expect(bound).toContain("w"); // an axis half: pitch
	});

	test("the one diagnostic key a flight command shares is b, by ruling", () => {
		// **`b` left the partition in #892, on #385 D6:** the fire-group
		// cycle is `b`, and bloom keeps it only while the panel is open. That
		// is one ruled exception, not a relaxed rule — a flight binding on any
		// *other* diagnostic key is still red here, because the panel would
		// take it from the pilot in the mode built to be used while flying.
		//
		// **`SETTINGS_KEY` left this list in #381 S4, and its absence is the
		// change rather than a hole.** `z` is a flight-path binding now —
		// `system.settings` dispatches through `Game.command` like any other
		// command, which is what #369 D12 means by "`z` is an ordinary command
		// and can be moved", and what the settings door on the `Controls` tab
		// makes safe. The row below still holds it apart from every *perf*
		// key, which is this file's subject.
		const bound = flightKeys();
		const shared = [...PERF_KEYS, RESTORE_KEY].filter((key) => bound.has(key));
		expect(shared).toEqual(["b"]);
	});

	test("while the panel is open, no diagnostic key reaches a flight command", () => {
		// The exception above is safe only because of this: with `?perf` up the
		// panel's key is the panel's, and `resolveKey` hands the ship nothing.
		for (const view of ["cockpit", "chase"] as const)
			for (const key of [...PERF_KEYS, RESTORE_KEY]) {
				const reached = resolveKey(DEFAULT_BINDINGS, {
					key,
					view,
					perfPanel: true,
				});
				// Guard the guard: an empty answer would pass the loop vacuously.
				expect(`${key}: ${reached.length > 0}`).toBe(`${key}: true`);
				for (const id of reached)
					expect(`${key} → ${id}: ${commandById(id).fixed}`).toBe(
						`${key} → ${id}: diagnostic`,
					);
			}
	});

	test("while the panel is closed, no key reaches a diagnostic", () => {
		// The other half: without the panel, `b` is the cycle, and a key
		// resolved to bloom there would be a press that does nothing.
		for (const key of [...PERF_KEYS, RESTORE_KEY])
			for (const id of resolveKey(DEFAULT_BINDINGS, { key, view: "cockpit" }))
				expect(`${key} → ${id}: ${commandById(id).fixed}`).not.toBe(
					`${key} → ${id}: diagnostic`,
				);
	});

	test("and the settings key is one, which is the point of D12", () => {
		// **What this holds is the partition, not the fold.** It read "if
		// `system.settings` goes back to opening on its panel's own listener,
		// `z` leaves the flight partition" — true only while a hand-kept panel
		// list fed the partition, and that list is gone (#381 S5). The fold is
		// held where it can fail: `controls-catalogue.test.ts` requires every
		// keyed command at a dispatch site doing what its row says.
		expect(flightKeys()).toContain(SETTINGS_KEY);
	});

	test("the settings key is not a perf-panel key either", () => {
		// The settings screen is player-facing and always on; the perf panel is
		// query-gated. With `?perf` both are listening, so a shared key would
		// open a dialog and toggle a diagnostic at once.
		for (const key of [...PERF_KEYS, RESTORE_KEY])
			expect(`${key} vs settings: ${key === SETTINGS_KEY}`).toBe(
				`${key} vs settings: false`,
			);
	});

	test("the Commander overlay's key is a flight binding and no other panel's key", () => {
		// **Inverted in #381 S5, for `z`'s reason in S4.** It asserted the
		// opposite — `persistent-world-state.md` §11.1 said the overlay opens
		// on a key the flight bindings do not hold — while the registry
		// offered that key for rebinding and the overlay read its own
		// constant. `system.commander` dispatches through `Game.command` now,
		// so `9` is on the flight path like `z`. As with `z`, this holds the
		// partition; the dispatch row in `controls-catalogue.test.ts` is what
		// goes red if the open moves back onto the overlay's listener.
		const bound = flightKeys();
		expect(bound).toContain(COMMANDER_KEY);
		for (const key of [...PERF_KEYS, RESTORE_KEY, SETTINGS_KEY])
			expect(`${key} vs commander: ${key === COMMANDER_KEY}`).toBe(
				`${key} vs commander: false`,
			);
	});

	test("the panel's own keys are distinct", () => {
		const all = [...PERF_KEYS, RESTORE_KEY];
		expect(new Set(all).size).toBe(all.length);
	});
});

describe("the panel's class cycle matches the classes that exist", () => {
	test("every name it cycles is a real surface class", () => {
		// `perf-panel.ts` restates the class names rather than importing
		// `CLASS_GLSL`, so a diagnostic that is off by default does not drag the
		// shader table into the eagerly-loaded graph. The cost of a copy is that
		// it can drift, and the failure would be silent: `setSurfaceClass("terrran")`
		// picks no shader and the panel would report a class the GPU never got.
		//
		// A missing name is tolerable — one class absent from a debug cycle. A
		// *wrong* name is not, so that is what this checks.
		for (const name of PERF_CLASSES)
			expect(`${name}: ${name in CLASS_GLSL}`).toBe(`${name}: true`);
	});

	test("the cycle covers every class a planet can be", () => {
		// `star` is deliberately outside the cycle: it is not a planet surface,
		// and drawing a world as a photosphere measures nothing about worlds.
		const cyclable = Object.keys(CLASS_GLSL).filter((k) => k !== "star");
		expect([...PERF_CLASSES].sort().join(",")).toBe(cyclable.sort().join(","));
	});
});
