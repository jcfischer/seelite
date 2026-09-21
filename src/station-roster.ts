/**
 * A system's station roster, read-only and cached.
 *
 * **One responsibility with one implementation.** The finder projects rosters
 * per admitted system per keystroke and the record card reads one per selection
 * and per minute tick; the finder held a private cache and the chart called
 * `generateContents` raw, which is the same read answered two ways with only
 * one of them cheap.
 *
 * **Not a cache inside `generateContents`.** `sim.ts` builds the live system
 * from that same call, and the live system is mutated as the world runs — a
 * shared cache there would hand the finder a roster that moves under it, or
 * hand the sim one the finder is holding. Everything here is read-only: nothing
 * that receives a roster from this module may mutate it, and nothing does.
 *
 * **Bounded, because `galaxy.ts` states the rule for exactly this shape**:
 * an unbounded map keyed on a seed leaks for any caller that iterates seeds,
 * and the measurement scripts do iterate seeds. A galaxy is 256 systems and the
 * finder walks a whole one per keystroke, so the bound is one galaxy's worth
 * with room for a second in flight — the same "a running game and a preview"
 * reasoning `LAYOUT_CACHE_LIMIT` gives.
 */

import type { SystemRecord } from "./galaxy";
import { generateContents, type Station } from "./system";

/** Two galaxies' systems. See the module doc for why this is bounded at all. */
const ROSTER_CACHE_LIMIT = 512;
const rosterCache = new Map<number, readonly Station[]>();

/**
 * The stations of `system`, generated once.
 *
 * Keyed on the system's **own seed**, which `galaxy.ts` derives from the world
 * seed, the galaxy and the system index — so it separates two galaxies of one
 * world, and two worlds on one page. An index alone collides on both.
 * `galaxy-finder.test.ts` sweeps all eight galaxies and asserts the seeds are
 * distinct, because a collision here hands one system another's roster and
 * every annotation and the unchecked-fence count then read the wrong carrier.
 */
export const rosterOf = (system: SystemRecord): readonly Station[] => {
	const hit = rosterCache.get(system.seed);
	if (hit) return hit;
	const stations = generateContents(system).stations;
	if (rosterCache.size >= ROSTER_CACHE_LIMIT) {
		const oldest = rosterCache.keys().next();
		if (!oldest.done) rosterCache.delete(oldest.value);
	}
	rosterCache.set(system.seed, stations);
	return stations;
};
