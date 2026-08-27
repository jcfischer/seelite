/**
 * The perf panel's keys must not be the flight controls' keys.
 *
 * This exists because I got it wrong by assertion. The panel first took the
 * digit row, on the strength of a comment saying the flight controls own the
 * letters — and `1` and `3` swing the chase view, `2` selects one, and `0`
 * resets the cruise dials. Four working controls, silently stolen, in a mode
 * whose entire purpose is to be used *while flying*.
 *
 * A comment cannot hold that; a test can. The bindings are read out of
 * `main.ts` rather than restated here, so a key bound tomorrow collides at
 * `bun test` instead of in flight.
 */
import { describe, expect, test } from "bun:test";
import { PERF_KEYS, RESTORE_KEY } from "../src/perf-panel";
import { codeOf } from "./lib/source-scan";

const main = codeOf("src/main.ts");

/**
 * Every key `main.ts` reacts to.
 *
 * Two shapes, because the game reads keys two ways: `case "x":` for one-shot
 * commands in the key handler's switch, and `this.keys.has("x")` / `axis([...])`
 * for keys held across frames. Missing the second kind is how a movement key
 * looks free.
 */
function boundKeys(source: string): Set<string> {
	const out = new Set<string>();
	for (const m of source.matchAll(/case\s+"([^"]+)":/g)) out.add(m[1]);
	for (const m of source.matchAll(/keys\.has\("([^"]+)"\)/g)) out.add(m[1]);
	for (const m of source.matchAll(/key === "([^"]+)"/g)) out.add(m[1]);
	// `axis(["arrowright", "d"], ["arrowleft", "a"])` — every string in either
	// list is a held key.
	for (const m of source.matchAll(/axis\(\[([^\]]*)\],\s*\[([^\]]*)\]\)/g))
		for (const list of [m[1], m[2]])
			for (const k of list.matchAll(/"([^"]+)"/g)) out.add(k[1]);
	return out;
}

describe("the perf panel stays out of the flight controls", () => {
	test("the scan finds the bindings it is supposed to find", () => {
		// Guarding the guard: a regex that matched nothing would make the case
		// below vacuously green, which is the failure mode of every source scan.
		const bound = boundKeys(main);
		expect(bound.size).toBeGreaterThan(15);
		// Three known bindings of the three different shapes.
		expect(bound).toContain("v"); // one-shot: view toggle
		expect(bound).toContain("shift"); // held: throttle
		expect(bound).toContain("w"); // axis list: pitch
	});

	test("no panel key is a flight binding", () => {
		const bound = boundKeys(main);
		for (const key of [...PERF_KEYS, RESTORE_KEY])
			expect(`${key}: ${bound.has(key)}`).toBe(`${key}: false`);
	});

	test("the panel's own keys are distinct", () => {
		const all = [...PERF_KEYS, RESTORE_KEY];
		expect(new Set(all).size).toBe(all.length);
	});
});
