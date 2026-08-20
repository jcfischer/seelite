/**
 * Where each of #30's arrival-guard candidates drops you, and at what speed.
 *
 *   bun run scripts/measure-arrival-guard.ts [seeds]
 *
 * #30 is a rule that is wrong at any tuning: `SURFACE_MARGIN` scales the
 * clearance to the *planet*, while `system.ts` puts a station 400–2,000 km
 * above one, so a big enough world projects a shell its own station is inside
 * and the surface sweep fires before the drop sweep can. The node names three
 * candidates and asks for measurements rather than an argument, so this flies
 * every candidate through the **real** `advanceCruise` — the guard is a field
 * on its input, not a copy of the function — and prints where each one ends.
 *
 * Three things are measured per leg, because the node's warning is that a
 * candidate can "arrive" by breaking the thing the guard exists for:
 *
 * - **where it drops**: the range to the station when cruise ends, and the
 *   closing speed there. A drop 9,000 km out at 3,000 km/s is the defect.
 * - **whether it tunnelled**: the deepest the flown path went inside any
 *   planet's true surface, swept per frame rather than sampled at the
 *   endpoints. A candidate that arrives by flying through worlds has not
 *   solved this.
 * - **the planet control**: the same ship aimed at a planet with the throttle
 *   open must still be stopped by it. `tests/cruise.test.ts` pins this for the
 *   default; here it is re-flown under every candidate.
 *
 * A sweep, not a test: nothing here asserts. It is committed so #30's numbers
 * can be re-derived rather than believed.
 */

import {
	type ArrivalGuard,
	CLEARANCE_KM,
	DEFAULT_CRUISE,
	SURFACE_MARGIN,
	advanceCruise,
} from "../src/cruise";
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

const GUARDS: ArrivalGuard[] = [
	"shell",
	"clearance",
	"parent-exempt",
	"target-first",
	"parent-surface",
];

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
	 * Kilometres a **fresh** cruise engagement from that state covers before it
	 * is stopped again.
	 *
	 * This is the trap the report describes: dropped 9,000 km out at the shell,
	 * the player presses J again and the sweep fires from inside the shell on
	 * the first sub-step, so the only way in is the 2 km/s crawl. A guard that
	 * leaves this near zero has not fixed the leg it appears to shorten.
	 */
	reengagedKm: number;
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
	guard: ArrivalGuard,
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
			guard,
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
			if (measureReengage && rangeKm > DEFAULT_CRUISE.dropRadiusKm) {
				const again = makeWorld(world.seed);
				again.gameTime = world.gameTime;
				again.ship.pos = pos;
				advanceWorldClock(again, 0);
				const second = flyLeg(again, targetId, guard, false);
				reengagedKm = Math.max(0, rangeKm - second.rangeKm);
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
	guard: ArrivalGuard,
): { result: LegResult; radiusKm: number } | null {
	const world = makeWorld(seed);
	const planets = world.system.bodies.filter((b) => b.kind === "planet");
	if (planets.length === 0) return null;
	const biggest = planets.reduce((a, b) => (b.radiusKm > a.radiusKm ? b : a));
	return {
		result: flyLeg(world, biggest.id, guard, false),
		radiusKm: biggest.radiusKm,
	};
}

const seedCount = Number(process.argv[2] ?? 60);
if (!Number.isFinite(seedCount) || seedCount < 1)
	throw new Error(`unusable seed count ${process.argv[2]}`);
const SEEDS = Array.from({ length: seedCount }, (_, i) => i + 1);

console.log(
	`guards: shell = ${SURFACE_MARGIN}×radius (today) · clearance = radius + ${CLEARANCE_KM} km · ` +
		"parent-exempt · target-first\n" +
		`corpus: start system of seeds 1…${seedCount}, drop radius ${DEFAULT_CRUISE.dropRadiusKm} km, ` +
		`drop speed ${DEFAULT_CRUISE.dropSpeedKms} km/s\n`,
);

interface Row extends Case {
	guard: ArrivalGuard;
	result: LegResult;
}
const rows: Row[] = [];
for (const seed of SEEDS) {
	for (const c of casesFor(seed)) {
		for (const guard of GUARDS) {
			rows.push({
				...c,
				guard,
				result: flyLeg(makeWorld(seed), c.targetId, guard),
			});
		}
	}
}

const pct = (n: number, d: number) =>
	d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;
const km = (n: number) =>
	n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);

// ── How many legs are even reachable in a straight line.
const planetOrbiting = rows.filter(
	(r) => r.guard === "shell" && r.hostId !== null,
);
const occludedCount = planetOrbiting.filter((r) => r.occluded).length;
console.log(
	`geometry: ${planetOrbiting.length} planet-orbiting legs, of which ${occludedCount} ` +
		`(${pct(occludedCount, planetOrbiting.length)}) have the host between the ship and the station ` +
		"at leg start — no straight-line rule reaches those without flying through a world.\n",
);

// ── Per-guard summary, split by the discriminator.
console.log("summary — legs that end at the station's 50 km drop radius\n");
console.log(
	"  guard           clear of host      occluded by host    star-centric    tunnelled   median drop range",
);
for (const guard of GUARDS) {
	const mine = rows.filter((r) => r.guard === guard);
	const clear = mine.filter((r) => r.hostId !== null && !r.occluded);
	const occl = mine.filter((r) => r.hostId !== null && r.occluded);
	const star = mine.filter((r) => r.hostId === null);
	const arrived = (rs: Row[]) => rs.filter((r) => r.result.exit === "arrival");
	const tunnelled = mine.filter((r) => r.result.penetrationKm > 1);
	const ranges = mine
		.filter((r) => r.hostId !== null)
		.map((r) => r.result.rangeKm)
		.sort((a, b) => a - b);
	const median = ranges.length
		? ranges[Math.floor(ranges.length / 2)]
		: Number.NaN;
	const cell = (rs: Row[]) =>
		`${`${arrived(rs).length}/${rs.length}`.padStart(9)} ${pct(arrived(rs).length, rs.length).padStart(7)}`;
	console.log(
		`  ${guard.padEnd(15)}${cell(clear)}  ${cell(occl)}  ${cell(star)}  ` +
			`${`${tunnelled.length}/${mine.length}`.padStart(9)}   ${Number.isFinite(median) ? `${km(median)} km` : "—"}`,
	);
}

// ── The trap: can the player press J again and make progress?
console.log(
	"\nre-engagement — km a second cruise covers from where the first was stopped\n",
);
console.log(
	"  guard           stopped legs   median re-engaged   stuck (< 100 km)",
);
for (const guard of GUARDS) {
	const stopped = rows.filter(
		(r) =>
			r.guard === guard && r.hostId !== null && r.result.exit !== "arrival",
	);
	const gained = stopped.map((r) => r.result.reengagedKm).sort((a, b) => a - b);
	const stuck = stopped.filter((r) => r.result.reengagedKm < 100);
	console.log(
		`  ${guard.padEnd(15)}${String(stopped.length).padStart(12)}   ${
			gained.length
				? `${km(gained[Math.floor(gained.length / 2)] ?? 0)} km`
				: "—"
		}`.padEnd(56) + `${`${stuck.length}/${stopped.length}`.padStart(10)}`,
	);
}
console.log("");

// ── The dimension no guard reaches: how low the orbits are.
//
// A station at orbital radius r above a planet of radius R is hidden whenever it
// is on the far side and its offset projected across the line of sight is under
// R. For a bearing that is effectively parallel at 1 AU that is
// `1 − sqrt(r² − R²)/r`, halved for "behind" — so the whole occlusion rate is a
// function of `r/R` alone, and `system.ts`'s 400–2,000 km altitude puts a gas
// giant at r/R ≈ 1.01. Sampled here over real orbits rather than asserted.
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
			const r = station.orbit.radiusKm;
			// A bearing is effectively parallel at 1 AU, so the ship's own direction
			// from the host is the line of sight.
			const toShip = sub(world.ship.pos, hostBody.pos);
			const los = scale(toShip, 1 / length(toShip));
			for (let i = 0; i < 64; i++) {
				const phase = (i / 64) * station.orbit.periodS;
				// Re-place the station at this phase, host held still.
				const w2 = makeWorld(seed);
				w2.gameTime = phase;
				advanceWorldClock(w2, 0);
				const moved = w2.system.byId.get(station.id);
				const movedHost = w2.system.byId.get(station.parentId);
				if (!moved || !movedHost) continue;
				const o = sub(moved.pos, movedHost.pos);
				const behind = dot(o, los) < 0;
				const perp = length(sub(o, scale(los, dot(o, los))));
				samples.push({
					hostRadiusKm: host.radiusKm,
					ratio: r / host.radiusKm,
					occluded: behind && perp < host.radiusKm,
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
	// What raising the orbit would buy, from the closed form above.
	console.log("\n  if every station orbited at r/R:   occluded");
	for (const k of [1.05, 1.1, 1.25, 1.5, 2, 3]) {
		const rate = 0.5 * (1 - Math.sqrt(k * k - 1) / k);
		console.log(
			`    r/R = ${k.toFixed(2).padStart(5)}                     ${(100 * rate).toFixed(1).padStart(5)}%`,
		);
	}
	console.log("");
}

// ── The planet control, per guard.
console.log("\nplanet control — nose on the biggest planet, throttle open\n");
console.log(
	"  guard           stopped   median stop range / radius   deepest penetration",
);
for (const guard of GUARDS) {
	const results = SEEDS.map((s) => planetControl(s, guard)).filter(
		(r): r is { result: LegResult; radiusKm: number } => r !== null,
	);
	const stopped = results.filter(
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
		`  ${guard.padEnd(15)}${`${stopped.length}/${results.length}`.padStart(7)}   ${(ratios[Math.floor(ratios.length / 2)] ?? Number.NaN).toFixed(3).padStart(24)}   ${km(deepest).padStart(10)} km`,
	);
}

// ── The named cases from the node body, in full.
console.log("\nthe node's cases, leg by leg\n");
const NAMED: [number, string][] = [
	[1, "station-trade"],
	[1, "station-shipyard"],
	[1, "station-refinery"],
	[7, "station-trade"],
	[42, "station-trade"],
];
console.log(
	"  seed  target             host        R (km)  alt (km)  occl  guard           exit                   drop range   closing   time     tunnel    re-engaged",
);
for (const [seed, targetId] of NAMED) {
	const c = casesFor(seed).find((x) => x.targetId === targetId);
	if (!c) {
		console.log(
			`  ${seed} ${targetId}: not present in this seed's start system`,
		);
		continue;
	}
	for (const guard of GUARDS) {
		const r = flyLeg(makeWorld(seed), targetId, guard);
		console.log(
			`  ${String(seed).padStart(4)}  ${targetId.padEnd(18)} ${(c.hostId ?? "star").padEnd(10)} ` +
				`${km(c.hostRadiusKm).padStart(7)} ${km(c.altitudeKm).padStart(9)}  ${(c.occluded ? "yes" : "no").padEnd(5)} ${guard.padEnd(15)} ` +
				`${(r.exitBodyId ? `${r.exit}:${r.exitBodyId}` : r.exit).padEnd(20)} ` +
				`${`${km(r.rangeKm)} km`.padStart(9)} ${`${r.closingKms.toFixed(0)} km/s`.padStart(11)} ` +
				`${`${r.seconds.toFixed(0)}s`.padStart(7)} ${`${km(r.penetrationKm)} km`.padStart(9)} ${`${km(r.reengagedKm)} km`.padStart(11)}`,
		);
	}
	console.log("");
}

// ── Worst remaining shortfalls per guard: what a player would still meet.
console.log("worst drop range per guard, planet-orbiting targets\n");
for (const guard of GUARDS) {
	const worst = rows
		.filter((r) => r.guard === guard && r.hostId !== null)
		.sort((a, b) => b.result.rangeKm - a.result.rangeKm)
		.slice(0, 5);
	console.log(`  ${guard}`);
	for (const r of worst) {
		console.log(
			`    seed ${String(r.seed).padStart(4)}  ${r.targetId.padEnd(17)} ${r.hostIsGiant ? "giant" : "rocky"} R=${km(r.hostRadiusKm)} km ${r.occluded ? "occluded" : "clear   "}  ` +
				`${r.result.exit === "arrival" ? "arrival" : `${r.result.exit}:${r.result.exitBodyId ?? "—"}`}  ` +
				`${km(r.result.rangeKm)} km at ${r.result.closingKms.toFixed(0)} km/s`,
		);
	}
	console.log("");
}
