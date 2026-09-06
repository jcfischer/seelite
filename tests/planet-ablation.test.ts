/**
 * The ablation ladder #248 prices the 35 ms filling planet with.
 *
 * #242 measured a planet at 95.4% of an open-space frame and left the *inside*
 * of that number unopened: nothing in the tree said whether it was the relief
 * path, the class surface, or the two shells around it. `measure-planet-cost`
 * swept class, relief path, apparent size and pixel ratio — four axes, none of
 * which subtracts a term.
 *
 * The ladder is that fifth axis. It is data rather than a sequence of key
 * presses for the same reason `PERF_CLASSES` is: the sweep drives the page from
 * outside and must not carry its own copy of what the levers are.
 *
 * What can be held here is the ladder's *shape* — that every arm sets every
 * lever, that the ladder brackets the frame between a full arm and a floor, and
 * that the names are usable as table columns. What cannot be held here is any
 * millisecond: every headless runner in this repo draws through SwiftShader,
 * which is the whole reason `measure-planet-cost.mjs` is headed.
 */
import { describe, expect, test } from "bun:test";
import { ABLATION_ARMS, ABLATION_LEVERS, armByName } from "../src/perf-panel";

describe("the ablation ladder", () => {
	/**
	 * **Every arm sets every lever, absolutely.**
	 *
	 * A ladder of *deltas* would leave the page in whatever state the previous
	 * arm left it, so a run that reordered its arms — or resumed after a failed
	 * cell — would price a state no arm describes. The sweep walks these in
	 * order and the last one is the floor; an arm that omitted `clouds` would
	 * silently inherit the floor's shells for the rest of the run.
	 */
	test("every arm declares every lever", () => {
		for (const arm of ABLATION_ARMS)
			for (const lever of ABLATION_LEVERS)
				expect(Object.hasOwn(arm, lever)).toBe(true);
	});

	test("arm names are unique and usable as a column heading", () => {
		const names = ABLATION_ARMS.map((a) => a.name);
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) expect(name).toMatch(/^[a-z][a-z-]{0,15}$/);
	});

	/**
	 * The ladder is bracketed: `full` is the shipped state and `bare` turns off
	 * everything the ladder can turn off. Both ends have to be in it or the
	 * table has no denominator and no floor — #242's own arms were a subject
	 * hidden against a control, and the equivalent here is the pair.
	 */
	test("full is the shipped state", () => {
		const full = armByName("full");
		expect(full.perfAblate).toBe(0);
		expect(full.surface).toBe("four-tap");
		expect(full.atmosphere).toBe(true);
		expect(full.clouds).toBe(true);
	});

	test("bare turns off every term the ladder owns", () => {
		const bare = armByName("bare");
		expect(bare.perfAblate).toBe(2);
		expect(bare.atmosphere).toBe(false);
		expect(bare.clouds).toBe(false);
	});

	/**
	 * **Each middle arm differs from `full` in exactly one lever.**
	 *
	 * That is what makes `full − arm` the price of one term. An arm that moved
	 * two levers would report their sum under one column heading, which is the
	 * shape of mistake #241's receipt made when it quoted a shadow's figure for
	 * a shadow-and-AO pair.
	 */
	test("each priced arm subtracts exactly one term from full", () => {
		const full = armByName("full");
		for (const arm of ABLATION_ARMS) {
			if (arm.name === "full" || arm.name === "bare") continue;
			const moved = ABLATION_LEVERS.filter(
				(lever) => arm[lever] !== full[lever],
			);
			expect(moved).toHaveLength(1);
		}
	});

	test("armByName refuses a name that is not in the ladder", () => {
		expect(() => armByName("no-such-arm")).toThrow(/no-such-arm/);
	});
});
