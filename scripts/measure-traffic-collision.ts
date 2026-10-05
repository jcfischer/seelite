/**
 * `collision.md` §6 item 1 and §9.1.14's corpus row, over a wide spread by
 * hand (node #664): does a projected Traffic route, outside its exempt
 * phases, bring a carrier's box into a station proxy, a body's sphere or
 * another carrier's box?
 *
 * `tests/collision-traffic.test.ts` gates a small corpus in `npm test`; this
 * is the wide half. The sweep, the projection and the classes are the test's
 * own (`tests/helpers/traffic-collision-corpus.ts`), so the two measure the
 * same thing. It prints, per run:
 *
 * - the N of every bucket: carrier-steps swept per phase, and the systems and
 *   actors behind them;
 * - every distinct meeting (`distinctMeetings`) by class and by what was met, with the
 *   worst closing speed any step of any of them read, and how many were
 *   billed (any step closing above `V_SCRAPE`);
 * - the cruise phases' distinct meetings, counted under C5 and not judged;
 * - §4.3's sanctioned launch ghosts.
 *
 *   bun scripts/measure-traffic-collision.ts [systems] [windowS] [seed] [galaxy] [red]
 *     systems  systems with a station, in index order (default 40)
 *     windowS  seconds from each system's first departure (default 1800)
 *     seed     world seed (default 47); galaxy  index (default 0)
 *     red      the red build: the exempt phases swept as well
 */

import { V_SCRAPE_KMS } from "../src/collision";
import { generateGalaxy } from "../src/galaxy";
import {
	type Meeting,
	contentsCache,
	distinctMeetings,
	firstDepartureS,
	meetingClass,
	trafficCollisionCorpus,
} from "../tests/helpers/traffic-collision-corpus";

const finite = (label: string, value: number): number => {
	if (!Number.isFinite(value)) throw new Error(`${label} is ${value}`);
	return value;
};

const [systemsArg, windowArg, seedArg, galaxyArg, redArg] =
	process.argv.slice(2);
const systems = Number(systemsArg ?? 40);
const windowS = Number(windowArg ?? 1800);
const seed = Number(seedArg ?? 47);
const galaxyIndex = Number(galaxyArg ?? 0);
const red = redArg === "red";
for (const [label, value] of [
	["systems", systems],
	["windowS", windowS],
	["seed", seed],
	["galaxy", galaxyIndex],
] as const)
	finite(label, value);

const galaxy = generateGalaxy(seed, galaxyIndex);
const contentsFor = contentsCache(galaxy);
const records = galaxy.systems
	.filter((record) => contentsFor(record.index).stations.length > 0)
	.slice(0, systems);

const steps: Record<string, number> = {};
const met: Meeting[] = [];
const cruise: Meeting[] = [];
let launchGhosts = 0;
let actors = 0;
let pairSteps = 0;
const startedAt = performance.now();
for (const record of records) {
	const fromS = Math.floor(firstDepartureS(galaxy, record, contentsFor));
	const run = trafficCollisionCorpus(galaxy, record, contentsFor, {
		stepS: 0.5,
		fromS,
		toS: fromS + windowS,
		includeExempt: red,
	});
	actors += run.actors;
	pairSteps += run.pairSteps;
	launchGhosts += run.launchGhosts.length;
	for (const [phase, n] of Object.entries(run.steps))
		steps[phase] = (steps[phase] ?? 0) + n;
	const tag = (m: Meeting): Meeting => ({
		...m,
		key: `${record.index}#${m.key}`,
	});
	met.push(...distinctMeetings(run.meetings).map(tag));
	cruise.push(...distinctMeetings(run.cruiseMeetings).map(tag));
}

const what = (m: Meeting): string =>
	m.met.startsWith("carrier:")
		? `carrier in ${m.met.split(":").at(-1)}`
		: (/station-[a-z]+/.exec(m.met)?.[0] ?? m.met.replace(/^.*-/, ""));

console.log(
	`seed ${seed} galaxy ${galaxyIndex}: ${records.length} systems, ${actors} actors, ${windowS} s each${red ? ", RED BUILD (exempt phases swept)" : ""}`,
);
console.log("carrier-steps swept, by phase (0.5 s each):");
for (const [phase, n] of Object.entries(steps).sort((a, b) => b[1] - a[1]))
	console.log(`  ${phase.padEnd(18)} ${n}`);
console.log(`carrier pairs tested on one step: ${pairSteps}`);
console.log(`launch ghosts (§4.3, sanctioned): ${launchGhosts}`);

const table = (label: string, list: readonly Meeting[]) => {
	console.log(`${label}: ${list.length} distinct meetings`);
	const buckets = new Map<string, Meeting[]>();
	for (const m of list) {
		const key = `${meetingClass(m).padEnd(17)} ${m.phase.padEnd(16)} ${what(m)}`;
		buckets.set(key, [...(buckets.get(key) ?? []), m]);
	}
	for (const [key, bucket] of [...buckets].sort(
		(a, b) => b[1].length - a[1].length,
	)) {
		const worst = Math.max(
			...bucket.map((m) => finite("closing", m.closingKms)),
		);
		const billed = bucket.filter((m) => m.closingKms > V_SCRAPE_KMS).length;
		console.log(
			`  ${key.padEnd(56)} n=${String(bucket.length).padStart(4)}  worst ${worst.toFixed(3)} km/s  billed ${billed}`,
		);
	}
};
table("collidable phases", met);
table("cruise phases (C5, not judged)", cruise);
console.log(`${((performance.now() - startedAt) / 1000).toFixed(1)} s`);
