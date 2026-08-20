/**
 * Whether cruise actually arrives at a station, and where it leaves you when
 * it does not.
 *
 *   bun run scripts/measure-cruise-arrival.ts [seeds]
 *
 * #30's defect was a rule that was wrong at any tuning: `SURFACE_MARGIN` scaled
 * the clearance to the *planet*, while `system.ts` puts a station 400–2,000 km
 * above one, so a big enough world projected a shell its own station was inside
 * and the surface sweep fired before the drop sweep could. This is the
 * instrument that decided it and the one that keeps it decided.
 *
 * The candidate comparison that #30 chose from — four rules flown side by side
 * — lives in that node's resolution rather than here. It is reproducible:
 * `git checkout a6359be -- src/cruise.ts scripts/` restores the switch and the
 * sweep that printed the table. Carrying four rules in the flight loop forever
 * to keep a decided question re-runnable is the cost this repo does not pay;
 * the numbers stay recoverable instead, the way `capture-station-orbits.ts`
 * keeps its baseline recoverable.
 *
 * What is measured, per leg, flown through the real `advanceCruise`:
 *
 * - **where it drops**: the range to the station when cruise ends, and the
 *   closing speed there. A drop 9,000 km out at 3,000 km/s was the defect.
 * - **whether it tunnelled**: the deepest the flown path went inside any
 *   planet's true surface, swept per frame rather than sampled at the
 *   endpoints. Arriving by flying through worlds is not arriving.
 * - **whether being stopped is terminal**: kilometres a *second* cruise
 *   engagement covers from the drop point. This read 1 km in 124 legs out of
 *   124 before #30, which is what "dropped at 10k km, not ok to fly to" was.
 * - **the planet control**: the same ship aimed at a planet with the throttle
 *   open must still be stopped by it. `tests/cruise.test.ts` pins this; here it
 *   is re-flown across the corpus.
 *
 * A sweep, not a test: nothing here asserts.
 */

import { DEFAULT_CRUISE, SURFACE_MARGIN, advanceCruise } from "../src/cruise";
import {
	type World,
	advanceWorldClock,
	bodyVelocity,
	makeWorld,
} from "../src/sim";
import { AU_KM, MAX_DT } from "../src/units";
import { type Vec3, add, dot, length, scale, sub } from "../src/vec3";

/** The game's own frame cap, so the sweep is the worst case for anything that
 *  sub-steps — read from the unit scheme rather than restated. */
const DT = MAX_DT;
/** Sim seconds a leg is given before it counts as never arriving. A typical
 *  leg is ~60 s (#14); an hour is the 2 km/s crawl this node is about. */
const LEG_TIMEOUT_S = 1200;

/** Every figure printed goes through this: an instrument that quietly reports
 *  garbage is worse than one that dies (#7's rule, `measure-market.ts`). */
function finite(label: string, value: number): number {
	if (!Number.isFinite(value)) throw new Error(`${label} is ${value}`);
	return value;
}

interface LegResult {
	exit: string;
	exitBodyId: string | undefined;
	/** Range to the target when cruise ended, km. */
	rangeKm: number;
	/** Closing speed at that moment, km/s. */
	closingKms: number;
	/** Sim seconds the leg took. */
	seconds: number;
	/** How far inside any planet's true surface the flown path went, km. */
	penetrationKm: number;
	/** Where the ship was left, and when — so a re-engagement can start there. */
	pos: Vec3;
	gameTime: number;
	/**
	 * Kilometres a fresh cruise engagement covers **toward the same station**.
	 *
	 * Expected to be ~0 for an occluded leg and to stay that way: the station is
	 * behind a planet, and flying at it is flying into the planet. Reported so
	 * that a rule which quietly started tunnelling would show up here.
	 */
	reengagedKm: number;
	/**
	 * Kilometres a fresh engagement covers **away from the host**, in five
	 * seconds.
	 *
	 * This is the trap the report describes, and the honest measure of it:
	 * dropped at a planet, can the player leave? `sphereEntry` returns 0 for a
	 * step that starts inside a sphere, so before #30 the sweep fired on the
	 * first sub-step of *every* engagement afterwards regardless of heading —
	 * 124 legs out of 124 covered 1 km — and the only way on was the 2 km/s
	 * crawl. The guard now fires on crossing inward, so a ship pointed away is
	 * not stopped.
	 */
	escapeKm: number;
}

/**
 * Five seconds of cruise straight out from a body, from where a leg was
 * stopped — "can the player leave?", flown rather than argued.
 *
 * The target is a point 1 AU further out along the same radial, which is a free
 * cruise with something selected: the drop sphere is 50 km and the ship is
 * heading away from it, so nothing here ends the run except the guard.
 */
function flyAway(
	seed: number,
	gameTime: number,
	from: Vec3,
	bodyId: string | undefined,
): number {
	if (!bodyId) return 0;
	const world = makeWorld(seed);
	world.gameTime = gameTime;
	advanceWorldClock(world, 0);
	const body = world.system.byId.get(bodyId);
	if (!body) return 0;
	const out = sub(from, body.pos);
	const len = length(out);
	if (len === 0) return 0;
	const nose = scale(out, 1 / len);
	const target = { pos: add(from, scale(nose, AU_KM)), radiusKm: 1 };
	let pos = from;
	let travelled = 0;
	for (let i = 0; i < 50; i++) {
		const masses = world.system.bodies
			.filter((b) => b.kind === "star" || b.kind === "planet")
			.map((b) => ({ id: b.id, pos: b.pos, radiusKm: b.radiusKm }));
		const step = advanceCruise({
			pos,
			nose,
			throttle: 1,
			dt: DT,
			masses,
			target,
			params: DEFAULT_CRUISE,
		});
		pos = step.pos;
		travelled += step.travelledKm;
		advanceWorldClock(world, DT);
		if (step.dropped) break;
	}
	return travelled;
}

/**
 * Fly one leg the way `main.ts` flies it: clock first, then nose straight at
 * the target's *current* position, throttle open.
 *
 * The nose is re-aimed every frame, which is a perfect pilot — deliberately, so
 * that what the table reports is the geometry and not a steering error.
 */
function flyLeg(
	world: World,
	targetId: string,
	measureReengage = true,
): LegResult {
	const contents = world.system.contents;
	const station = contents.stations.find((s) => s.id === targetId);
	const targetParentId = station ? station.parentId : null;
	let pos = world.ship.pos;
	let t = 0;
	let penetrationKm = 0;

	while (t < LEG_TIMEOUT_S) {
		advanceWorldClock(world, DT);
		const target = world.system.byId.get(targetId);
		if (!target) throw new Error(`no body ${targetId}`);
		const to = sub(target.pos, pos);
		const range = length(to);
		if (range === 0) break;
		const nose = scale(to, 1 / range);
		const masses = world.system.bodies
			.filter((b) => b.kind === "star" || b.kind === "planet")
			.map((b) => ({ id: b.id, pos: b.pos, radiusKm: b.radiusKm }));

		const step = advanceCruise({
			pos,
			nose,
			throttle: 1,
			dt: DT,
			masses,
			target: {
				pos: target.pos,
				radiusKm: target.radiusKm,
				vel: bodyVelocity(world.system, targetId, world.gameTime),
			},
			params: DEFAULT_CRUISE,
			targetParentId,
		});

		// Swept, not sampled: at 20 c one frame covers hundreds of thousands of
		// km, so endpoint tests would miss a planet the path went straight
		// through — the exact failure this column exists to catch.
		for (const m of masses) {
			const toCentre = sub(m.pos, pos);
			const along = Math.min(
				Math.max(dot(toCentre, nose), 0),
				step.travelledKm,
			);
			const closest = length(sub(m.pos, add(pos, scale(nose, along))));
			penetrationKm = Math.max(penetrationKm, m.radiusKm - closest);
		}

		pos = step.pos;
		t += DT;
		if (step.dropped || step.starved) {
			const end = world.system.byId.get(targetId);
			if (!end) throw new Error(`no body ${targetId}`);
			const rangeKm = length(sub(end.pos, pos));
			// A second engagement from exactly here, flown by the same code.
			let reengagedKm = 0;
			let escapeKm = 0;
			if (measureReengage && rangeKm > DEFAULT_CRUISE.dropRadiusKm) {
				const again = makeWorld(world.seed);
				again.gameTime = world.gameTime;
				again.ship.pos = pos;
				advanceWorldClock(again, 0);
				const second = flyLeg(again, targetId, false);
				reengagedKm = Math.max(0, rangeKm - second.rangeKm);
				escapeKm = flyAway(world.seed, world.gameTime, pos, step.exitBodyId);
			}
			return {
				exit: step.starved ? "starved" : (step.exit ?? "none"),
				exitBodyId: step.exitBodyId,
				rangeKm: finite("range", rangeKm),
				closingKms: finite("closing", step.closingKms),
				seconds: finite("seconds", t),
				penetrationKm: finite("penetration", Math.max(0, penetrationKm)),
				pos,
				gameTime: world.gameTime,
				reengagedKm: finite("reengaged", reengagedKm),
				escapeKm: finite("escape", escapeKm),
			};
		}
	}
	const end = world.system.byId.get(targetId);
	if (!end) throw new Error(`no body ${targetId}`);
	return {
		exit: "timeout",
		exitBodyId: undefined,
		rangeKm: finite("range", length(sub(end.pos, pos))),
		closingKms: Number.NaN,
		seconds: LEG_TIMEOUT_S,
		penetrationKm: finite("penetration", Math.max(0, penetrationKm)),
		pos,
		gameTime: world.gameTime,
		reengagedKm: 0,
		escapeKm: 0,
	};
}

interface Case {
	seed: number;
	targetId: string;
	/** The body it orbits, or null for a star-centric target. */
	hostId: string | null;
	hostRadiusKm: number;
	hostIsGiant: boolean;
	/** How far above its host's surface the station orbits, km. */
	altitudeKm: number;
	legAu: number;
	/**
	 * Whether the straight line from the arrival point to the station passes
	 * through the host's true surface at leg start.
	 *
	 * The discriminator this node turns on: where it is false the station is
	 * merely inside its planet's *shell* and a tighter shell reaches it, and
	 * where it is true no straight-line rule reaches it without flying through
	 * a world.
	 */
	occluded: boolean;
}

function casesFor(seed: number): Case[] {
	const world = makeWorld(seed);
	const { contents } = world.system;
	const out: Case[] = [];
	for (const station of contents.stations) {
		const host = station.parentId
			? contents.planets.find((p) => p.id === station.parentId)
			: undefined;
		const body = world.system.byId.get(station.id);
		if (!body) continue;
		const hostBody = station.parentId
			? world.system.byId.get(station.parentId)
			: undefined;
		let occluded = false;
		if (hostBody) {
			const to = sub(body.pos, world.ship.pos);
			const legKm = length(to);
			const nose = scale(to, 1 / legKm);
			const toCentre = sub(hostBody.pos, world.ship.pos);
			const along = Math.min(Math.max(dot(toCentre, nose), 0), legKm);
			const closest = length(
				sub(hostBody.pos, add(world.ship.pos, scale(nose, along))),
			);
			occluded = closest < hostBody.radiusKm;
		}
		out.push({
			seed,
			targetId: station.id,
			occluded,
			hostId: station.parentId,
			hostRadiusKm: host ? host.radiusKm : 0,
			hostIsGiant: host ? host.isGasGiant : false,
			altitudeKm: host ? station.orbit.radiusKm - host.radiusKm : 0,
			legAu: length(sub(body.pos, world.ship.pos)) / AU_KM,
		});
	}
	return out;
}

/** The thing the guard exists for: nose on a planet, throttle open, must stop.
 *  Flown per candidate against the largest planet in the system. */
function planetControl(
	seed: number,
): { result: LegResult; radiusKm: number } | null {
	const world = makeWorld(seed);
	const planets = world.system.bodies.filter((b) => b.kind === "planet");
	if (planets.length === 0) return null;
	const biggest = planets.reduce((a, b) => (b.radiusKm > a.radiusKm ? b : a));
	return {
		result: flyLeg(world, biggest.id, false),
		radiusKm: biggest.radiusKm,
	};
}

const seedCount = Number(process.argv[2] ?? 60);
if (!Number.isFinite(seedCount) || seedCount < 1)
	throw new Error(`unusable seed count ${process.argv[2]}`);
const SEEDS = Array.from({ length: seedCount }, (_, i) => i + 1);

console.log(
	`rule: the target's host guards at its true surface, every other body at ${SURFACE_MARGIN}×radius; ` +
		"the guard fires on crossing inward, not on being inside\n" +
		`corpus: start system of seeds 1…${seedCount}, drop radius ${DEFAULT_CRUISE.dropRadiusKm} km, ` +
		`drop speed ${DEFAULT_CRUISE.dropSpeedKms} km/s\n`,
);

interface Row extends Case {
	result: LegResult;
}
const rows: Row[] = [];
for (const seed of SEEDS) {
	for (const c of casesFor(seed)) {
		rows.push({ ...c, result: flyLeg(makeWorld(seed), c.targetId) });
	}
}

const pct = (n: number, d: number) =>
	d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;
const km = (n: number) =>
	n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);

// ── Arrival rate, split by the discriminator: is the host in the way at all?
const clear = rows.filter((r) => r.hostId !== null && !r.occluded);
const occluded = rows.filter((r) => r.hostId !== null && r.occluded);
const starCentric = rows.filter((r) => r.hostId === null);
const arrived = (rs: Row[]) => rs.filter((r) => r.result.exit === "arrival");
const tunnelled = rows.filter((r) => r.result.penetrationKm > 1);

console.log("arrivals at the station's 50 km drop radius\n");
console.log("  leg class                    arrived         n");
for (const [label, rs] of [
	["clear of the host", clear],
	["occluded by the host", occluded],
	["star-centric (no host)", starCentric],
] as [string, Row[]][]) {
	console.log(
		`  ${label.padEnd(26)} ${pct(arrived(rs).length, rs.length).padStart(7)}   ${String(rs.length).padStart(7)}`,
	);
}
console.log(
	`\n  occluded legs are ${pct(occluded.length, clear.length + occluded.length)} of all legs to a ` +
		"planet-orbiting station — the host is between the ship and the station at\n" +
		"  leg start, and no straight-line rule reaches those without flying through a world.",
);
console.log(
	`\n  paths that went inside a planet's true surface: ${tunnelled.length}/${rows.length}` +
		`${tunnelled.length ? ` (deepest ${km(Math.max(...tunnelled.map((r) => r.result.penetrationKm)))} km)` : ""}\n`,
);

// ── Is being stopped terminal?
const stopped = rows.filter(
	(r) => r.hostId !== null && r.result.exit !== "arrival",
);
const stuck = stopped.filter((r) => r.result.reengagedKm < 100);
const gained = stopped.map((r) => r.result.reengagedKm).sort((a, b) => a - b);
const escapes = stopped.map((r) => r.result.escapeKm).sort((a, b) => a - b);
const pinned = stopped.filter((r) => r.result.escapeKm < 100);
console.log("after a stop — can the player cruise on?\n");
console.log(
	`  stopped legs ${stopped.length}\n` +
		`  back at the same station, which is behind the planet: median ${
			gained.length
				? `${km(gained[Math.floor(gained.length / 2)] ?? 0)} km`
				: "—"
		}, still stopped ${stuck.length}/${stopped.length} — as it should be\n` +
		`  away from the planet, five seconds: median ${
			escapes.length
				? `${km(escapes[Math.floor(escapes.length / 2)] ?? 0)} km`
				: "—"
		}, pinned ${pinned.length}/${stopped.length}\n`,
);

// ── The dimension the guard cannot reach: how low the orbits are.
//
// A station at orbital radius r above a planet of radius R is hidden whenever it
// is on the far side and its offset projected across the line of sight is under
// R. For a bearing that is effectively parallel at 1 AU that is
// `1 − sqrt(r² − R²)/r`, halved for "behind" — so the whole occlusion rate is a
// function of `r/R` alone, and `system.ts`'s 400–2,000 km altitude puts a gas
// giant at r/R ≈ 1.03. Sampled here over real orbits rather than asserted.
console.log("occlusion by host size, over 64 phases of each real orbit\n");
{
	const buckets: [string, (r: number) => boolean][] = [
		["rocky   R < 10k km", (r) => r < 1e4],
		["large   10–30k km", (r) => r >= 1e4 && r < 3e4],
		["giant   R > 30k km", (r) => r >= 3e4],
	];
	const samples: { hostRadiusKm: number; ratio: number; occluded: boolean }[] =
		[];
	for (const seed of SEEDS) {
		const world = makeWorld(seed);
		const { contents } = world.system;
		for (const station of contents.stations) {
			if (!station.parentId) continue;
			const host = contents.planets.find((p) => p.id === station.parentId);
			const hostBody = world.system.byId.get(station.parentId);
			if (!host || !hostBody) continue;
			const toShip = sub(world.ship.pos, hostBody.pos);
			const los = scale(toShip, 1 / length(toShip));
			for (let i = 0; i < 64; i++) {
				const w2 = makeWorld(seed);
				w2.gameTime = (i / 64) * station.orbit.periodS;
				advanceWorldClock(w2, 0);
				const moved = w2.system.byId.get(station.id);
				const movedHost = w2.system.byId.get(station.parentId);
				if (!moved || !movedHost) continue;
				const o = sub(moved.pos, movedHost.pos);
				const along = dot(o, los);
				const perp = length(sub(o, scale(los, along)));
				samples.push({
					hostRadiusKm: host.radiusKm,
					ratio: station.orbit.radiusKm / host.radiusKm,
					occluded: along < 0 && perp < host.radiusKm,
				});
			}
		}
	}
	console.log("  host class            median r/R   occluded");
	for (const [label, test] of buckets) {
		const mine = samples.filter((x) => test(x.hostRadiusKm));
		if (mine.length === 0) continue;
		const ratios = mine.map((x) => x.ratio).sort((a, b) => a - b);
		const occ = mine.filter((x) => x.occluded).length;
		console.log(
			`  ${label.padEnd(20)}  ${(ratios[Math.floor(ratios.length / 2)] ?? Number.NaN).toFixed(3)}       ${pct(occ, mine.length).padStart(6)}  (n=${mine.length})`,
		);
	}
	console.log("\n  if every station orbited at r/R:   occluded");
	for (const k of [1.05, 1.1, 1.25, 1.5, 2, 3]) {
		const rate = 0.5 * (1 - Math.sqrt(k * k - 1) / k);
		console.log(
			`    r/R = ${k.toFixed(2).padStart(5)}                     ${(100 * rate).toFixed(1).padStart(5)}%`,
		);
	}
	console.log("");
}

// ── The control: a planet still stops a ship flown at it.
console.log("planet control — nose on the biggest planet, throttle open\n");
{
	const results = SEEDS.map((s) => planetControl(s)).filter(
		(r): r is { result: LegResult; radiusKm: number } => r !== null,
	);
	const held = results.filter(
		(r) => r.result.exit === "proximity" || r.result.exit === "arrival",
	);
	const deepest = results.reduce(
		(a, r) => Math.max(a, r.result.penetrationKm),
		0,
	);
	const ratios = results
		.map((r) => r.result.rangeKm / r.radiusKm)
		.sort((a, b) => a - b);
	console.log(
		`  stopped ${held.length}/${results.length}   median stop range / radius ` +
			`${(ratios[Math.floor(ratios.length / 2)] ?? Number.NaN).toFixed(3)}   ` +
			`deepest penetration ${km(deepest)} km\n`,
	);
}

// ── The cases #30 was reported from, leg by leg.
console.log("the node's cases, leg by leg\n");
const NAMED: [number, string][] = [
	[1, "station-trade"],
	[1, "station-shipyard"],
	[1, "station-refinery"],
	[7, "station-trade"],
	[42, "station-trade"],
	[47, "station-trade"],
	[47, "station-shipyard"],
];
console.log(
	"  seed  target             host        R (km)  alt (km)  occl   exit                 drop range   closing   time     tunnel",
);
for (const [seed, targetId] of NAMED) {
	const c = casesFor(seed).find((x) => x.targetId === targetId);
	if (!c) {
		console.log(
			`  ${seed} ${targetId}: not present in this seed's start system`,
		);
		continue;
	}
	const r = flyLeg(makeWorld(seed), targetId);
	console.log(
		`  ${String(seed).padStart(4)}  ${targetId.padEnd(18)} ${(c.hostId ?? "star").padEnd(10)} ` +
			`${km(c.hostRadiusKm).padStart(7)} ${km(c.altitudeKm).padStart(9)}  ${(c.occluded ? "yes" : "no").padEnd(5)} ` +
			`${(r.exitBodyId ? `${r.exit}:${r.exitBodyId}` : r.exit).padEnd(20)} ` +
			`${`${km(r.rangeKm)} km`.padStart(9)} ${`${r.closingKms.toFixed(0)} km/s`.padStart(11)} ` +
			`${`${r.seconds.toFixed(0)}s`.padStart(7)} ${`${km(r.penetrationKm)} km`.padStart(9)}`,
	);
}

// ── What a player still meets: the worst legs the rule leaves.
console.log("\nworst drop range, planet-orbiting targets\n");
for (const r of [...rows]
	.filter((x) => x.hostId !== null)
	.sort((a, b) => b.result.rangeKm - a.result.rangeKm)
	.slice(0, 8)) {
	console.log(
		`  seed ${String(r.seed).padStart(4)}  ${r.targetId.padEnd(17)} ${r.hostIsGiant ? "giant" : "rocky"} R=${km(r.hostRadiusKm)} km ${r.occluded ? "occluded" : "clear   "}  ` +
			`${r.result.exit === "arrival" ? "arrival" : `${r.result.exit}:${r.result.exitBodyId ?? "—"}`}  ` +
			`${km(r.result.rangeKm)} km at ${r.result.closingKms.toFixed(0)} km/s`,
	);
}
console.log("");
