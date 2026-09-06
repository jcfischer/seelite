/**
 * How big a station's host planet is from that station — node #247.
 *
 *   bun run scripts/measure-station-host-angle.ts [worlds]   # default 8
 *
 * #242 measured one berth of one station on one seed: 41.8° of half-angle, the
 * disc filling the frame, and 4.6% of it visible past the bay. #247 asks
 * whether that is a property of bays or of *that* bay, and a second browser row
 * cannot answer it — the question is about the whole population, and the
 * population is generated rather than observed.
 *
 * So this is headless and it is not a browser measurement at all. It reads the
 * generator: for every station in a corpus of galaxies, the angular radius its
 * host subtends from its orbit. No pixels, no renderer, no seed to be lucky on.
 *
 * ## What it is answering, and what it is not
 *
 * A half-angle is not a coverage fraction. It says how much sky the host takes
 * up from the station's *orbit*, which is the upper bound on what any framing
 * from a berth can see of it — where the camera points and what the bay's walls
 * cut away are the browser's question, and `measure-bay-frame-cost.mjs
 * --mask-sweep` is where that is measured.
 *
 * What this settles is the half of #247 the browser cannot reach: whether
 * 41.8° is one station's accident or the shape of every station in the game.
 */
import { STATION_ORBIT_R_OVER_R } from "../src/system";
import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "../tests/helpers/station-rows";

const WORLDS = Number(process.argv[2] ?? 8);
if (!Number.isInteger(WORLDS) || WORLDS < 1) {
	console.error("usage: measure-station-host-angle.ts [positive integer]");
	process.exit(2);
}

/**
 * The half-angle a sphere of radius `r` subtends from distance `d`.
 *
 * `asin`, not `atan`, and the two disagree by 8° at the distance that matters:
 * `asin(1/1.5)` is 41.81° and `atan(1/1.5)` is 33.69°. `asin` is the right one
 * for a sphere — the silhouette is where the view ray grazes the surface, not
 * where it meets a disc through the centre — and it is what
 * `measure-bay-frame-cost.mjs` already uses in its inventory column, which is
 * why the 41.81° here lands on #242's measured 41.8° rather than near it.
 *
 * Stated because the first draft of this comment asserted the opposite about
 * that file without opening it, which is the failure this repo's read-before-
 * claim rule exists for.
 */
const halfAngleDeg = (r: number, d: number) =>
	d <= r ? 90 : (Math.asin(r / d) * 180) / Math.PI;

/**
 * A station, with its host's half-angle — or `null` twice over for a
 * star-centric one, which is a kind of station rather than a missing reading.
 */
type Hosted = { type: string; deg: number; ratio: number };
type Row = Hosted | { type: string; deg: null; ratio: null };
const rows: Row[] = [];
const isHosted = (r: Row): r is Hosted => r.deg !== null;

for (const world of worldSeeds(WORLDS)) {
	forEachSystem(world, ALL_GALAXIES, (_record, contents) => {
		for (const s of contents.stations) {
			if (!s.parentId) {
				// A star-centric station — `system.ts` gives the refinery a belt orbit
				// and `parentId: null` by construction. There is no host to subtend
				// anything, and that is the row rather than a gap in it.
				rows.push({ type: s.type, deg: null, ratio: null });
				continue;
			}
			const host = contents.planets.find((p) => p.id === s.parentId);
			if (!host) throw new Error(`orphan station ${s.id}`);
			const ratio = s.orbit.radiusKm / host.radiusKm;
			rows.push({ type: s.type, deg: halfAngleDeg(1, ratio), ratio });
		}
	});
}

const hosted = rows.filter(isHosted);
const orphan = rows.length - hosted.length;
const degs = hosted.map((r) => r.deg).sort((a, b) => a - b);
const pct = (p: number) =>
	degs[Math.min(degs.length - 1, Math.floor(p * degs.length))];

console.log("what a station's host subtends from its orbit\n");
console.log(
	`  worlds ${WORLDS}, galaxies ${ALL_GALAXIES.length}, stations ${rows.length}`,
);
console.log(
	`  star-centric (no host at all): ${orphan} (${((orphan / rows.length) * 100).toFixed(1)}%) — ` +
		"every one a refinery, by construction (`system.ts`: parentId null, belt orbit)",
);
console.log(
	`  host-orbiting: ${hosted.length}, half-angle min ${degs[0].toFixed(2)}° ` +
		`p50 ${pct(0.5).toFixed(2)}° p95 ${pct(0.95).toFixed(2)}° max ${degs[degs.length - 1].toFixed(2)}°`,
);

/**
 * The floor is what most stations ride at, and this is the whole point.
 *
 * `STATION_ORBIT_R_OVER_R` is a floor on the orbit and the max by arithmetic
 * above a 4,000 km host (`system.ts`), so most stations sit at exactly 1.5 host
 * radii and every one of those frames its host at the same angle. #242's 41.8°
 * is that number and not that berth's.
 */
const atFloor = hosted.filter(
	(r) => Math.abs(r.ratio - STATION_ORBIT_R_OVER_R) < 1e-9,
).length;
console.log(
	`  at exactly the ${STATION_ORBIT_R_OVER_R}x floor: ${atFloor} ` +
		`(${((atFloor / hosted.length) * 100).toFixed(1)}% of host-orbiting), all of them at ` +
		`${halfAngleDeg(1, STATION_ORBIT_R_OVER_R).toFixed(2)}° — which is the angle #242 measured`,
);

const byType = new Map<string, number[]>();
for (const r of hosted) {
	if (!byType.has(r.type)) byType.set(r.type, []);
	byType.get(r.type)?.push(r.deg);
}
console.log("\n  by station type");
for (const [type, xs] of [...byType].sort()) {
	const s = xs.slice().sort((a, b) => a - b);
	console.log(
		`    ${type.padEnd(10)} ${String(s.length).padStart(6)} hosted   ` +
			`min ${s[0].toFixed(2)}°  p50 ${s[Math.floor(s.length / 2)].toFixed(2)}°  max ${s[s.length - 1].toFixed(2)}°`,
	);
}
const orphanTypes = new Set(
	rows.filter((r) => r.deg === null).map((r) => r.type),
);
console.log(
	`    star-centric types: ${[...orphanTypes].sort().join(", ") || "none"}`,
);
