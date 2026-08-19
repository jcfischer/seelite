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
 * It also reports the undockable rate behind §5.4, for the same reason: that
 * figure sets `tests/station-orbits.test.ts`'s band, §5.4's prose and
 * `src/system.ts`'s comment, and the committed test sweeps eight worlds where
 * the quoted number is forty. One sweep, both numbers, reproducible.
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
let planetless = 0;
let stationless = 0;
let shipyards = 0;

interface Acc {
	clamped: number;
	erased: number;
}
const shipyardAcc: Acc = { clamped: 0, erased: 0 };
const refineryAcc: Acc = { clamped: 0, erased: 0 };
let refineries = 0;
const shipyardEconomy = new Map<number, number>();

/**
 * The rejected implementation, scored: `clamp(economy + offset, 0, 7)`.
 *
 * One function rather than one block per station type, so the two arms cannot
 * drift and the explanation is not attached to only one of them. **`clamped`
 * and `erased` are nested populations, not disjoint ones** — every erased
 * offset is also a clamped one, and conflating the two overstated §3.2's case
 * in two successive drafts.
 */
function tally(economy: number, offset: number, acc: Acc): void {
	const effective = Math.min(Math.max(economy + offset, 0), 7);
	if (effective !== economy + offset) acc.clamped++;
	if (effective === economy) acc.erased++;
}

for (const world of worlds) {
	// The same traversal the guard uses, rather than a second walk with a weaker
	// galaxy-index check — see that helper's header for why.
	forEachSystem(world, ALL_GALAXIES, (record, contents) => {
		systems++;
		if (contents.planets.length === 0) planetless++;
		if (contents.stations.length === 0) stationless++;
		for (const station of contents.stations) {
			if (station.type === "shipyard") {
				shipyards++;
				shipyardEconomy.set(
					record.economy,
					(shipyardEconomy.get(record.economy) ?? 0) + 1,
				);
				tally(record.economy, -2, shipyardAcc);
			}
			if (station.type === "refinery") {
				refineries++;
				tally(record.economy, +3, refineryAcc);
			}
		}
	});
}

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
console.log(`worlds ${worlds.length}, systems ${systems}`);
console.log(
	`shipyards  ${shipyards}\tclamped ${pct(shipyardAcc.clamped, shipyards)}\tof which erased ${pct(shipyardAcc.erased, shipyards)}`,
);
console.log(
	`refineries ${refineries}\tclamped ${pct(refineryAcc.clamped, refineries)}\tof which erased ${pct(refineryAcc.erased, refineries)}`,
);
console.log(
	`undockable ${stationless}\t(${((100 * stationless) / systems).toFixed(3)}% of systems; planetless ${planetless})`,
);
console.log(
	`shipyard economies: ${[...shipyardEconomy.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([e, n]) => `${e}: ${n}`)
		.join(" · ")}`,
);
