import { loadavg, cpus } from "node:os";
import { sweepShip, type Pose } from "../src/collision";
import { radiusAt } from "../src/rock-heightfields";
import { add, cross, length, rotateAbout, scale, v3 } from "../src/vec3";
import {
	DT,
	archetypes,
	clearLift,
	config,
	dirFor,
	motion,
	prims,
	solid,
	spikePieces,
	step,
	tangentPath,
	upFor,
} from "../tests/fixtures/rock-sweep";
import { sweepRock } from "../tests/fixtures/rock-sweep-956/rock-sweep";

const reps = Number(process.env.REPS ?? 9);
if (!Number.isInteger(reps) || reps < 3)
	throw new Error("REPS must be an integer >= 3");
const { fields, rocks } = archetypes();
const oracles = rocks.map(spikePieces);
const scenarios = [
	"approach",
	"assistOff",
	"graze",
	"resting",
	"near",
] as const;
const cases: {
	name: string;
	R: number;
	k: number;
	s: ReturnType<typeof step>;
}[] = [];
const spinAxis = v3(0, 1, 0),
	spinAngle = (2 * Math.PI * DT) / 240;
const turnPose = (p: Pose): Pose => ({
	origin: rotateAbout(p.origin, spinAxis, spinAngle),
	x: rotateAbout(p.x, spinAxis, spinAngle),
	y: rotateAbout(p.y, spinAxis, spinAngle),
	z: rotateAbout(p.z, spinAxis, spinAngle),
});
function production(c: (typeof cases)[number]) {
	const ship = motion(c.s, c.R),
		rock = solid(rocks[c.k], c.R);
	const omega = scale(spinAxis, spinAngle / DT);
	ship.velStart = add(ship.velStart, cross(omega, ship.start.origin));
	ship.velEnd = rotateAbout(
		add(ship.velEnd, cross(omega, ship.end.origin)),
		spinAxis,
		spinAngle,
	);
	ship.end = turnPose(ship.end);
	rock.end = turnPose(rock.end);
	const diagnostics = { advances: 0, maxPairAdvances: 0, cappedPairs: 0 };
	sweepShip(ship, [rock], DT, { diagnostics });
	return diagnostics;
}
function spikeConfig(c: (typeof cases)[number]) {
	return {
		...config(c.R),
		arcSagitta:
			Math.max(length(c.s.start.origin), length(c.s.end.origin)) *
			(1 - Math.cos(spinAngle / 2)),
	};
}
for (const R of [0.025, 0.04, 0.1, 0.4])
	for (const name of scenarios)
		rocks.forEach((rp, k) => {
			let s: ReturnType<typeof step>;
			if (name === "approach" || name === "assistOff") {
				const d = dirFor(k),
					nose = scale(d, -1);
				const r = radiusAt(fields[k], [d.x, d.y, d.z]);
				const travel = ((name === "approach" ? 2 : 10) * DT) / R;
				const lead = prims(R)[0].half[2] + 0.0106 / R;
				s = step(
					R,
					scale(d, r + lead + travel / 2),
					scale(d, r + lead - travel / 2),
					nose,
					upFor(nose),
				);
			} else {
				const path = tangentPath(R, k, name === "resting" ? 0.001 : 2, true);
				const lift = clearLift(path, oracles[k], 200);
				const clearM = name === "resting" ? 0.12 : name === "graze" ? 2 : 20;
				s = path(lift + clearM / 1000 / R);
			}
			cases.push({ name, R, k, s });
		});
console.log(
	`${cpus()[0].model}; REPS ${reps}; spin period 240 s; load ${loadavg()
		.map((x) => x.toFixed(1))
		.join(" ")}; ${cases.length} cases`,
);
const times = new Map<string, { spike: number[]; production: number[] }>();
for (const c of cases) {
	production(c);
	sweepRock(c.s, oracles[c.k], spikeConfig(c));
}
for (let rep = 0; rep < reps; rep++)
	for (const c of cases) {
		const key = `${c.R}|${c.name}`;
		let row = times.get(key);
		if (!row) {
			row = { spike: [], production: [] };
			times.set(key, row);
		}
		const arms =
			rep % 2
				? (["spike", "production"] as const)
				: (["production", "spike"] as const);
		for (const arm of arms) {
			const start = performance.now();
			if (arm === "production") {
				const result = production(c);
				if (result.cappedPairs || result.maxPairAdvances >= 64)
					throw new Error(`MAX_ADVANCES reached in ${key} archetype ${c.k}`);
			} else {
				const result = sweepRock(c.s, oracles[c.k], spikeConfig(c));
				if (result.capped)
					throw new Error(`Spike capped in ${key} archetype ${c.k}`);
			}
			row[arm].push((performance.now() - start) * 1000);
		}
	}
const median = (a: number[]) =>
	[...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
let failed = false;
console.log(
	"microseconds per rock per tick: median across 16 archetypes x REPS, paired/interleaved; ceiling 2x spike",
);
for (const [key, row] of times) {
	const baseline = median(row.spike),
		production = median(row.production),
		ratio = production / baseline;
	if (![baseline, production, ratio].every(Number.isFinite))
		throw new Error("Non-finite timing");
	console.log(
		`${key}: spike ${baseline.toFixed(1)} us; production ${production.toFixed(1)} us; ${ratio.toFixed(2)}x ${ratio <= 2 ? "PASS" : "FAIL"}`,
	);
	if (ratio > 2) failed = true;
}
if (failed) process.exitCode = 1;
