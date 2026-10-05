/**
 * What placing the raider outpost costs the generator — node #491.
 *
 *   bun run scripts/measure-raider-outpost.ts [worlds] [years]   # default 8, 10
 *
 * The figures `galaxy-generation.md` §6.4 and `src/system.ts` quote come from
 * here, so they are reprinted beside a fresh run rather than trusted as prose:
 *
 * - **Incidence.** How many systems hold an outpost, against the corpus.
 * - **The rejected placement.** How many of those systems have no planet
 *   without a station on it already — the cases a planet-hosted outpost would
 *   need a second mode for, and the reason the Trojan point was taken.
 * - **The arrival cost.** In how many of those systems the new-game arrival
 *   point moves because the outpost is there, against the same contents with
 *   it removed. A planet-hosted station sits inside its host's clearance and
 *   moves none; a star-centric one can.
 * - **Somewhere else.** The nearest the outpost comes to the station the relay
 *   watches, and to any other station, sampled every five days over `years`.
 *
 * Headless and generator-only: no renderer, no browser.
 */
// A module name: the relay's Carrier slot, not a berth.
// glossary-ignore: slot
import { relayPlan } from "../src/relay-slot";
import {
	type SystemContents,
	arrivalPoint,
	hasRaiderOutpost,
	placeBodies,
} from "../src/system";
import { AU_KM } from "../src/units";
import { length, sub } from "../src/vec3";
import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "../tests/helpers/station-rows";

const worlds = Number(process.argv[2] ?? 8);
const years = Number(process.argv[3] ?? 10);
const STEP_S = 5 * 86400;

let systems = 0;
let lawless = 0;
let noFreePlanet = 0;
let arrivalMoved = 0;
let nearestWatchedAu = Number.POSITIVE_INFINITY;
let nearestAnyAu = Number.POSITIVE_INFINITY;
let nearestAnyWhere = "";

for (const world of worldSeeds(worlds))
	forEachSystem(world, ALL_GALAXIES, (record, contents, galaxy) => {
		systems++;
		if (!hasRaiderOutpost(record.government)) return;
		lawless++;
		const outpost = contents.stations.find((s) => s.type === "outpost");
		if (!outpost) throw new Error(`${world}:g${galaxy}#${record.index}`);
		const others = contents.stations.filter((s) => s !== outpost);

		const hosts = new Set(others.map((s) => s.parentId));
		if (contents.planets.every((p) => hosts.has(p.id))) noFreePlanet++;

		const without: SystemContents = { ...contents, stations: others };
		const a = arrivalPoint(record, contents, null, 0);
		const b = arrivalPoint(record, without, null, 0);
		if (length(sub(a, b)) > 1e-6) arrivalMoved++;

		const plan = relayPlan(contents, record.seed);
		if (!plan) throw new Error("a system with stations has a relay plan");
		for (let t = 0; t <= years * 365.25 * 86400; t += STEP_S) {
			const placed = placeBodies(contents, t);
			const at = placed.find((p) => p.id === outpost.id);
			if (!at) throw new Error("the outpost was not placed");
			for (const body of placed) {
				if (body.kind !== "station" || body.id === outpost.id) continue;
				const au = length(sub(body.pos, at.pos)) / AU_KM;
				if (body.id === plan.watchedStationId)
					nearestWatchedAu = Math.min(nearestWatchedAu, au);
				if (au < nearestAnyAu) {
					nearestAnyAu = au;
					nearestAnyWhere = `${world}:g${galaxy}#${record.index} ${body.id} at t=${t} s`;
				}
			}
		}
	});

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
console.log(`raider outposts over worldSeeds(${worlds}), all galaxies`);
console.log(
	`  incidence           ${lawless} of ${systems} systems (${pct(lawless, systems)})`,
);
console.log(
	`  no station-free planet  ${noFreePlanet} of ${lawless} (${pct(noFreePlanet, lawless)}) — a planet-hosted rule's second mode`,
);
console.log(
	`  arrival moved       ${arrivalMoved} of ${lawless} (${pct(arrivalMoved, lawless)})`,
);
console.log(
	`  nearest the watched station, ${years} y   ${nearestWatchedAu.toFixed(4)} AU`,
);
console.log(
	`  nearest any station, ${years} y           ${nearestAnyAu.toFixed(4)} AU (${nearestAnyWhere})`,
);
