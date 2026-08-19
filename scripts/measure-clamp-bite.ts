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

import { GALAXY_COUNT, generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";
import { ALL_GALAXIES, worldSeeds } from "../tests/helpers/station-rows";

const worlds = worldSeeds(Number(process.argv[2] ?? 40));

let systems = 0;
let shipyards = 0;
let shipyardClamped = 0;
let refineries = 0;
let refineryClamped = 0;
const shipyardEconomy = new Map<number, number>();

for (const world of worlds) {
	for (const g of ALL_GALAXIES) {
		if (g >= GALAXY_COUNT) throw new Error(`galaxy ${g} does not exist`);
		for (const record of generateGalaxy(world, g).systems) {
			systems++;
			for (const station of generateContents(record).stations) {
				if (station.type === "shipyard") {
					shipyards++;
					shipyardEconomy.set(
						record.economy,
						(shipyardEconomy.get(record.economy) ?? 0) + 1,
					);
					// The rejected implementation: `clamp(economy - 2, 0, 7)`. It bites
					// whenever the shift would have gone below the scale.
					if (record.economy - 2 < 0) shipyardClamped++;
				}
				if (station.type === "refinery") {
					refineries++;
					if (record.economy + 3 > 7) refineryClamped++;
				}
			}
		}
	}
}

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
console.log(`worlds ${worlds.length}, systems ${systems}`);
console.log(
	`shipyards  ${shipyards}\tclamped ${pct(shipyardClamped, shipyards)}`,
);
console.log(
	`refineries ${refineries}\tclamped ${pct(refineryClamped, refineries)}`,
);
console.log(
	`shipyard economies: ${[...shipyardEconomy.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([e, n]) => `${e}: ${n}`)
		.join(" · ")}`,
);
