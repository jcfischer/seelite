/**
 * The greedy trader's `onHop` hook is an observer, never a steer (#562).
 *
 * `scripts/measure-ladder-rates.ts` reads realised margin and cruise legs hop
 * by hop through it, and its rates are only the trader's rates if an arm with
 * the hook flies exactly the run an arm without one does.
 */

import { describe, expect, test } from "bun:test";
import { type HopRecord, run, worldFor } from "../scripts/lib/greedy-trader";

const SEED = 0x5ee11e;
const HOURS = 0.5;

describe("greedy trader onHop", () => {
	test("a run with the observer is the run without it", () => {
		const plain = run(worldFor(SEED, 1), HOURS);
		const seen: HopRecord[] = [];
		const observed = run(worldFor(SEED, 1), HOURS, {
			onHop: (hop) => seen.push(hop),
		});
		expect(JSON.stringify(observed)).toBe(JSON.stringify(plain));
		expect(seen.length).toBe(plain.hops);
	});

	test("every hop is reported once, in order, with its own margin", () => {
		const seen: HopRecord[] = [];
		run(worldFor(SEED, 1), HOURS, { onHop: (hop) => seen.push(hop) });
		expect(seen.length).toBeGreaterThan(0);
		for (let i = 0; i < seen.length; i++) {
			const hop = seen[i];
			expect(hop.arriveS).toBeGreaterThan(hop.departS);
			expect(hop.profitCr).toBeGreaterThanOrEqual(0);
			if (i > 0) {
				expect(hop.departS).toBeGreaterThanOrEqual(seen[i - 1].arriveS);
				expect(hop.from).toBe(seen[i - 1].to);
			}
		}
		expect(seen.some((hop) => hop.profitCr > 0)).toBe(true);
	});
});
