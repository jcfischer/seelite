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
import { commandById, DEFAULT_BINDINGS } from "../src/commands";
/**
 * Every key the game binds to something that is **not** a panel of its own.
 *
 * The diagnostics carry `fixed: "diagnostic"`, so that half is a property of
 * the catalogue: a flight command that took `b` tomorrow lands in this set and
 * the row below goes red, which is the failure this file was opened for.
 *
 * **The two player screens are a written list, and that is a gap rather than a
 * shape** (sage round 2). The registry has no axis for "a panel owns this open
 * key" — `fixed` is the wrong one, because #381 makes `z` remappable — so the
 * pair is named here and again in `controls-catalogue.test.ts`, and a third
 * panel tomorrow needs both edited. The axis belongs with the capture slice,
 * which is what gives `z` a non-binding route in the first place.
 */
const flightKeys = () =>
	new Set(
		DEFAULT_BINDINGS.flatMap((b) =>
			b.trigger.kind === "key" &&
			b.command !== "system.settings" &&
			b.command !== "system.commander" &&
			commandById(b.command).fixed !== "diagnostic"
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

	test("no panel key is a flight binding", () => {
		const bound = flightKeys();
		for (const key of [...PERF_KEYS, RESTORE_KEY, SETTINGS_KEY])
			expect(`${key}: ${bound.has(key)}`).toBe(`${key}: false`);
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

	test("the Commander overlay's key is no flight binding and no other panel's key", () => {
		// `persistent-world-state.md` §11.1: it opens on a key the flight bindings
		// do not hold, and settings and the perf panel listen beside it.
		const bound = flightKeys();
		expect(`${COMMANDER_KEY}: ${bound.has(COMMANDER_KEY)}`).toBe(
			`${COMMANDER_KEY}: false`,
		);
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
