/**
 * Does any Traffic carrier enter a star's skim band (#931)?
 *
 *   bun scripts/measure-traffic-star-band.ts [systems] [windowS] [seed] [galaxy]
 *     systems  systems with a station, in index order (default 40)
 *     windowS  seconds from each system's first departure (default 1800)
 *     seed     world seed (default 47); galaxy  index (default 0)
 *
 * #931 heats the player's hull only, on the assumption that no NPC Traffic
 * route enters the band; if one does, NPC heating is in scope and is its own
 * node. This flies the same projections `measure-traffic-collision.ts` sweeps
 * (`trafficCollisionCorpus`: every home hauler and inbound candidate, at the
 * game's authority order) and prints each system's closest approach to its
 * star, in the star's radii, and every sample inside `SKIM_BAND_R`.
 *
 * Raiders and the relay's tender are not Traffic and are not swept: a raider
 * flies where the pilot is, so it reaches a band only behind a pilot who is
 * already there, and NPC hull temperature is outside #931.
 */

import { generateGalaxy } from "../src/galaxy";
import { SKIM_BAND_R } from "../src/ship-condition";
import { length } from "../src/vec3";
import {
	contentsCache,
	firstDepartureS,
	trafficCollisionCorpus,
} from "./lib/traffic-collision-corpus";

const finite = (label: string, value: number): number => {
	if (!Number.isFinite(value)) throw new Error(`${label} is ${value}`);
	return value;
};

const [systemsArg, windowArg, seedArg, galaxyArg] = process.argv.slice(2);
const systems = finite("systems", Number(systemsArg ?? 40));
const windowS = finite("windowS", Number(windowArg ?? 1800));
const seed = finite("seed", Number(seedArg ?? 47));
const galaxyIndex = finite("galaxy", Number(galaxyArg ?? 0));

const galaxy = generateGalaxy(seed, galaxyIndex);
const contentsFor = contentsCache(galaxy);
const records = galaxy.systems
	.filter((record) => contentsFor(record.index).stations.length > 0)
	.slice(0, systems);

let samples = 0;
let closest = Number.POSITIVE_INFINITY;
let closestAt = "";
const inBand: string[] = [];
for (const record of records) {
	const radiusKm = contentsFor(record.index).star.radiusKm;
	const fromS = Math.floor(firstDepartureS(galaxy, record, contentsFor));
	let systemClosest = Number.POSITIVE_INFINITY;
	trafficCollisionCorpus(galaxy, record, contentsFor, {
		stepS: 0.5,
		fromS,
		toS: fromS + windowS,
		// The star sits at the system origin (`placeBodies`).
		trace: (atS, projection) => {
			if (projection.present === false || !projection.pos) return;
			samples++;
			const r = finite("r", length(projection.pos) / radiusKm);
			const at = `system ${record.index} ${projection.key} ${projection.phase} t=${atS}`;
			systemClosest = Math.min(systemClosest, r);
			if (r < closest) {
				closest = r;
				closestAt = at;
			}
			if (r < SKIM_BAND_R) inBand.push(`${at} r=${r.toFixed(3)} R`);
		},
	});
	console.log(
		`system ${record.index}: closest ${finite("closest", systemClosest).toFixed(1)} R`,
	);
}
console.log(
	`seed ${seed} galaxy ${galaxyIndex}: ${records.length} systems, ${windowS} s each, ${samples} samples`,
);
console.log(
	`closest ${finite("closest", closest).toFixed(2)} R at ${closestAt}`,
);
console.log(`samples inside ${SKIM_BAND_R} R: ${inBand.length}`);
for (const line of inBand.slice(0, 20)) console.log(`  ${line}`);
