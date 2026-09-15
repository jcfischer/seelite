/**
 * The fourth playtest's report as a check (#324): a pilot, with only what a
 * pilot has, can scoop the cargo of a raider killed at the cap.
 *
 * `scripts/lib/scoop-pilot.ts` owns the pilot and the scenario, and every
 * function it steps is the game's. A canister that keeps drifting cannot be
 * scooped by this pilot; one that comes to rest always can.
 */
import { expect, test } from "bun:test";
import { flyToCargo } from "../scripts/lib/scoop-pilot";

test("a pilot who stops, faces and creeps in scoops every canister of a kill at the cap", () => {
	const missed: { seed: number; dropped: number; scooped: number }[] = [];
	for (let seed = 1; seed <= 40; seed++) {
		const run = flyToCargo(seed);
		if (run.scooped !== run.dropped)
			missed.push({ seed, dropped: run.dropped, scooped: run.scooped });
	}
	expect(missed).toEqual([]);
});
