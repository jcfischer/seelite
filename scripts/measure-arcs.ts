import { recordTrade } from "../src/deficits";
import {
	type Arc,
	type ArcWorld,
	nextStep,
	openArc,
	recordStep,
} from "../src/arcs";
import { generateGalaxy } from "../src/galaxy";
import { HULL_SPECS, PLAYER_BASELINE_HULL } from "../src/hull";
import { canPostJobs } from "../src/jobs";
import { bountyTargetOf } from "../src/pirate-relay";
import { generateContents } from "../src/system";
import { newWorld } from "../src/world-state";

const SEEDS = Number(process.argv[2] ?? 200);
const BASE_SEED = 0x5ee11e;
const SHORTAGE_T = 12;

let answered = 0;
let opened = 0;
const refusals = new Map<string, number>();

for (let n = 0; n < SEEDS; n++) {
	const seed = BASE_SEED + n;
	const galaxy = generateGalaxy(seed, 0);
	const env = newWorld(seed).galaxies[0];
	const world: ArcWorld = {
		galaxyIndex: 0,
		systems: galaxy.systems,
		contentsOf: generateContents,
		deficits: {},
		gameTimeMin: 0,
		maxJump: HULL_SPECS[PLAYER_BASELINE_HULL].tankLy,
		bountyTargetOf: (r) => bountyTargetOf(r, generateContents(r), env, 0),
	};
	const record = galaxy.systems[n % galaxy.systems.length];
	const station = generateContents(record).stations.find(canPostJobs);
	if (!station) continue;
	const key = `${record.index}:${station.localCarrierId}` as never;
	const seeded: ArcWorld = {
		...world,
		deficits: recordTrade({}, key, {
			goodName: "Food",
			units: SHORTAGE_T,
			gameTimeMin: 0,
			holdT: 20,
		}),
	};
	const opening = openArc(seeded, record, station);
	if (!opening.ok) {
		refusals.set(opening.reason, (refusals.get(opening.reason) ?? 0) + 1);
		continue;
	}
	opened++;
	let arc: Arc = opening.arc;
	let outcome = "no route";
	for (let guard = 0; guard < 8; guard++) {
		const next = nextStep(arc, seeded);
		if (next.kind === "answer") {
			outcome = "answered";
			break;
		}
		if (next.kind === "none") {
			outcome = `no route (${next.reason})`;
			break;
		}
		arc = recordStep(arc, next.offer);
		arc = {
			...arc,
			taken: arc.taken.map((s, i) =>
				i === arc.taken.length - 1 ? { ...s, distanceLy: next.flownLy } : s,
			),
		};
	}
	if (outcome === "answered") answered++;
	const families = new Set(arc.taken.map((s) => s.family));
	const systems = new Set(
		arc.taken.flatMap((s) => [
			Number(s.requester.carrierKey.split(":")[0]),
			Number(s.reportAt.carrierKey.split(":")[0]),
		]),
	);
	const ly = arc.taken.reduce((sum, s) => sum + s.distanceLy, 0);
	console.log(
		`seed ${seed} ${arc.kind}: ${outcome}, ${arc.taken.length} steps, families ${[...families].join("+")}, ${systems.size} systems, ${ly.toFixed(1)} ly, bonus ${arc.answerBonusCr} Cr`,
	);
}

console.log(`opened ${opened} of ${SEEDS} seeds`);
for (const [reason, count] of refusals)
	console.log(`refused x${count}: ${reason}`);
console.log(
	`answered ${answered} of ${opened} opened (${opened ? ((100 * answered) / opened).toFixed(1) : "0"}%)`,
);
