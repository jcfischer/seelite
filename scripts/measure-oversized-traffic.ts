import { execFileSync } from "node:child_process";
import { generateGalaxy } from "../src/galaxy";
import { HULL_IDS, HULL_SPECS, type HullId } from "../src/hull";
import { buildHaulerPlans } from "../src/inter-system-traffic";
import { STATION_GEOMETRY } from "../src/station";
import {
	fittingTrafficBerths,
	stationInterior,
	trafficBerths,
} from "../src/station-interior";
import { stationTrafficRoster } from "../src/station-traffic";
import { generateContents, type SystemContents } from "../src/system";
import { GALAXY_COUNT, carrierBaselineFingerprint } from "../src/world-state";
import { SIX, measure } from "./measure-oversized-hulls";

const seedArg = process.argv.indexOf("--seed");
const SEED = seedArg >= 0 ? Number(process.argv[seedArg + 1]) : 0x5ee11e;
const HAULERS = process.argv.includes("--haulers");
if (!Number.isFinite(SEED)) throw new Error("bad seed");

type Env = { lengthKm: number; beamKm: number; heightKm: number };
const oldEnv = new Map<HullId, Env>(
	HULL_IDS.map((id) => [id, { ...HULL_SPECS[id].env }]),
);
const newEnv = new Map<HullId, Env>(oldEnv);
for (const { role, name } of SIX)
	newEnv.set(role, (await measure(role, name)).envKm);
const setEnv = (which: "A" | "B") => {
	const src = which === "A" ? oldEnv : newEnv;
	for (const id of HULL_IDS)
		(HULL_SPECS[id] as { env: Env }).env = { ...src.get(id)! };
};

const tally = (m: Map<string, number>, k: string, n = 1) =>
	m.set(k, (m.get(k) ?? 0) + n);
const fmt = (m: Map<string, number>) =>
	[...m.entries()]
		.sort()
		.map(([k, v]) => `${k}=${v}`)
		.join(" ");
const check = (n: number, what: string) => {
	if (!Number.isFinite(n)) throw new Error(`non-finite ${what}`);
	return n;
};

console.log(
	"base",
	execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
);
console.log("seed", `0x${SEED.toString(16)}`, "galaxies", GALAXY_COUNT);

interface Row {
	hull: HullId;
	home: string;
	galaxy: number;
	system: number;
	stationId: string;
	ordinal: number;
}
const rosterRows = (
	g: number,
	contents: Map<number, SystemContents>,
): Map<string, Row> => {
	const m = new Map<string, Row>();
	for (const [sys, c] of contents)
		for (const s of c.stations)
			for (const a of stationTrafficRoster(sys, s))
				m.set(a.key, {
					hull: a.hullId,
					home: s.type,
					galaxy: g,
					system: sys,
					stationId: s.id,
					ordinal: a.ordinal,
				});
	return m;
};

const actorsByHome = new Map<string, number>();
const changedByHome = new Map<string, number>();
const transitions = new Map<string, number>();
const hullsA = new Map<string, number>();
const hullsB = new Map<string, number>();
const oversizedF = new Map<string, number>();
const oversizedSystems = { total: 0, oneStation: 0, stationsHit: 0 };
const fpA: number[] = [];
const fpB: number[] = [];
let actors = 0;
let changed = 0;
const touched = new Set<string>();
const examples: string[] = [];
const haul = {
	plansA: 0,
	hauA: 0,
	hauB: 0,
	vocationFlip: 0,
	cycleMultipleMoved: 0,
	eligibleMoved: 0,
	explorerHaulersA: 0,
	explorerHaulerDestA: 0,
};

for (let g = 0; g < GALAXY_COUNT; g++) {
	const galaxy = generateGalaxy(SEED, g);
	if (galaxy.systems.length !== 256) throw new Error("galaxy size");
	const contents = new Map<number, SystemContents>(
		galaxy.systems.map((r) => [r.index, generateContents(r)]),
	);
	setEnv("A");
	const a = rosterRows(g, contents);
	fpA.push(carrierBaselineFingerprint(SEED, g));
	setEnv("B");
	const b = rosterRows(g, contents);
	fpB.push(carrierBaselineFingerprint(SEED, g));
	if (a.size !== b.size) throw new Error(`galaxy ${g}: roster size moved`);
	for (const [key, ra] of a) {
		const rb = b.get(key)!;
		actors++;
		tally(actorsByHome, ra.home);
		tally(hullsA, ra.hull);
		tally(hullsB, rb.hull);
		if (ra.hull !== rb.hull) {
			changed++;
			tally(changedByHome, ra.home);
			tally(transitions, `${ra.hull}>${rb.hull}`);
			touched.add(`${g}:${ra.system}`);
			if (examples.length < 5)
				examples.push(
					`${key} ${ra.hull}->${rb.hull} (${ra.home} #${ra.ordinal})`,
				);
		}
	}
	const sysOversized = new Set<number>();
	for (const [, ra] of a) {
		const c = contents.get(ra.system)!;
		const s = c.stations.find((x) => x.id === ra.stationId)!;
		const interior = stationInterior(
			s.type,
			STATION_GEOMETRY[s.type].aperturePlaneKm,
			s.berthSeed,
		);
		if (!fittingTrafficBerths(interior, newEnv.get(ra.hull)!).length) {
			tally(oversizedF, `${ra.home}:${ra.hull}`);
			sysOversized.add(ra.system);
		}
		check(trafficBerths(interior).length, "berths");
	}
	for (const sys of sysOversized) {
		oversizedSystems.total++;
		if (contents.get(sys)!.stations.length === 1) oversizedSystems.oneStation++;
	}
	if (HAULERS) {
		const q = (i: number) => contents.get(i)!;
		for (const r of galaxy.systems) {
			setEnv("A");
			const pa = buildHaulerPlans(galaxy, r.index, q);
			setEnv("B");
			let pb;
			try {
				pb = buildHaulerPlans(galaxy, r.index, q);
			} catch (e) {
				throw new Error(`B hauler plans threw at ${g}:${r.index}: ${e}`);
			}
			haul.plansA += pa.length;
			const mb = new Map(pb.map((p) => [p.actor.key, p]));
			for (const p of pa) {
				if (p.vocation === "hauler") haul.hauA++;
				if (p.vocation === "hauler" && p.actor.hullId === "explorer") {
					haul.explorerHaulersA++;
					haul.explorerHaulerDestA += p.eligible.length;
				}
				const q2 = mb.get(p.actor.key)!;
				if (q2.vocation === "hauler") haul.hauB++;
				if (p.vocation !== q2.vocation) haul.vocationFlip++;
				if (p.cycleMultiple !== q2.cycleMultiple) haul.cycleMultipleMoved++;
				if (p.eligible.length !== q2.eligible.length) haul.eligibleMoved++;
			}
		}
	}
}

console.log(
	"\n== A (as built) vs B (new envelopes, live compatibility filter)",
);
console.log(`traffic actors ${actors}: ${fmt(actorsByHome)}`);
console.log(
	`hull assignment changed ${changed} (${((100 * changed) / actors).toFixed(2)}%) in ${touched.size} systems; by home: ${fmt(changedByHome)}`,
);
console.log(`hull census A: ${fmt(hullsA)}`);
console.log(`hull census B: ${fmt(hullsB)}`);
console.log(`transitions: ${fmt(transitions)}`);
console.log(`examples: ${examples.join("; ")}`);
console.log(`fingerprints A ${fpA.join(",")}`);
console.log(`fingerprints B ${fpB.join(",")}`);
console.log(
	`fingerprints moved in ${fpA.filter((v, i) => v !== fpB[i]).length}/${GALAXY_COUNT} galaxies`,
);
console.log(
	"\n== F (A's identities under B's envelopes): actors with no internal Traffic berth",
);
console.log(fmt(oversizedF) || "none");
console.log(
	`systems with such an actor ${oversizedSystems.total}, of which one-station systems ${oversizedSystems.oneStation}`,
);
if (HAULERS) {
	console.log("\n== hauler plans (A vs B)");
	console.log(JSON.stringify(haul));
}
