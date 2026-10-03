/**
 * The classical render set (`CLASSICAL_SET`) renders every registered work,
 * and each render outlasts its excerpt by a hall: the lengths are written by
 * hand in a script that cannot import TypeScript, so this is what keeps them
 * honest.
 */
import { expect, test } from "bun:test";
import { CLASSICAL_SET } from "../../scripts/lib/sound-set.mjs";
import { CLASSICAL_WORKS } from "../../src/music-classical/index";

const HALL_S = 3;

test("every registered work is rendered, and nothing else", () => {
	expect(
		CLASSICAL_SET.map((e) => e.name.replace(/^classical-/, "")).sort(),
	).toEqual(Object.keys(CLASSICAL_WORKS).sort());
});

test("every render outlasts its excerpt by a hall", () => {
	for (const e of CLASSICAL_SET) {
		const w = CLASSICAL_WORKS[e.name.replace(/^classical-/, "")];
		expect([e.name, e.seconds >= w.seconds + HALL_S]).toEqual([e.name, true]);
	}
});
