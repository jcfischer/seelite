/**
 * The instrument behind §3.2's table.
 *
 * §3.2's whole case for expressing the type offset as a price delta rather than
 * as an economy shift is a measurement: how often would `clamp(economy + offset,
 * 0, 7)` actually swallow the offset? The first draft asserted a figure and got
 * it wrong. A conclusion with no committed instrument is the same failure one
 * step later — a later reader re-deciding this has the number but no way to
 * check it.
 *
 *   bun run scripts/measure-clamp-bite.ts [worldCount]
 */

import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "../tests/helpers/station-rows";

const worlds = worldSeeds(Number(process.argv[2] ?? 40));

let systems = 0;
let shipyards = 0;
/** The clamp changed the result at all — at economy 1 a `−2` lands on 0, one
 *  step of shift instead of two. **Includes the erased case below**: these are
 *  nested populations, not disjoint ones. */
let shipyardClamped = 0;
/** The offset is gone: the station prices exactly like the system beside it. */
let shipyardErased = 0;
let refineries = 0;
let refineryClamped = 0;
let refineryErased = 0;
const shipyardEconomy = new Map<number, number>();

for (const world of worlds) {
	// The same traversal the guard uses, rather than a second walk with a weaker
	// galaxy-index check — see that helper's header for why.
	forEachSystem(world, ALL_GALAXIES, (record, contents) => {
		systems++;
		for (const station of contents.stations) {
			if (station.type === "shipyard") {
				shipyards++;
				shipyardEconomy.set(
					record.economy,
					(shipyardEconomy.get(record.economy) ?? 0) + 1,
				);
				// The rejected implementation: `clamp(economy - 2, 0, 7)`. "Clamped at
				// all" and "offset erased" are different questions, and conflating them
				// overstated the case in two successive drafts of §3.2.
				const effective = Math.max(record.economy - 2, 0);
				if (effective !== record.economy - 2) shipyardClamped++;
				if (effective === record.economy) shipyardErased++;
			}
			if (station.type === "refinery") {
				refineries++;
				const effective = Math.min(record.economy + 3, 7);
				if (effective !== record.economy + 3) refineryClamped++;
				if (effective === record.economy) refineryErased++;
			}
		}
	});
}

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
console.log(`worlds ${worlds.length}, systems ${systems}`);
console.log(
	`shipyards  ${shipyards}\tclamped ${pct(shipyardClamped, shipyards)}\tof which erased ${pct(shipyardErased, shipyards)}`,
);
console.log(
	`refineries ${refineries}\tclamped ${pct(refineryClamped, refineries)}\tof which erased ${pct(refineryErased, refineries)}`,
);
console.log(
	`shipyard economies: ${[...shipyardEconomy.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([e, n]) => `${e}: ${n}`)
		.join(" · ")}`,
);
