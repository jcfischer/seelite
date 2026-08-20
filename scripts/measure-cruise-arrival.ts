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
 * — is **recorded in `docs/specs/in-system-travel.md` §12.1**, which ships in
 * the tree: each rejected rule with the figure that rejected it. Re-running it
 * needs the switch back, and the **`node-30-candidates` tag** is where it lives:
 * `git checkout node-30-candidates -- src/cruise.ts scripts/`. A tag rather
 * than a bare SHA because the PR branch was deleted on merge and a squash
 * commit leaves the original unreachable — which is the difference between
 * "recoverable" and "recoverable until someone garbage-collects".
 *
 * Carrying four rules in the flight loop forever to keep a decided
 * question re-runnable is the cost this repo does not pay; the numbers stay
 * written down and the sweep stays recoverable, the way
 * `capture-station-orbits.ts` keeps its baseline recoverable.
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

import {
	DEFAULT_CRUISE,
	HOST_CLEARANCE_KM,
	SURFACE_MARGIN,
	advanceCruise,
	closestApproachKm,
	entersSphere,
} from "../src/cruise";
import {
	ASSIST_CAP_KMS,
	type World,
	advanceWorldClock,
	bodyVelocity,
	stationHostIdOf,
	makeWorld,
} from "../src/sim";
import { AU_KM, MAX_DT } from "../src/units";
import { type Vec3, add, dot, length, scale, sub, v3 } from "../src/vec3";

/** The game's own frame cap, so the sweep is the worst case for anything that
 *  sub-steps — read from the unit scheme rather than restated. */
const DT = MAX_DT;
/** Sim seconds a leg is given before it counts as never arriving — twenty
 *  minutes against a typical leg of ~60 s (#14). A leg that hits this was not
 *  stopped by anything, so it is reported as its own row rather than counted
 *  among the stopped ones. */
const LEG_TIMEOUT_S = 1200;
/** How long the escape measurement flies, seconds. */
const ESCAPE_S = 5;

/** Every figure printed goes through this: an instrument that quietly reports
 *  garbage is worse than one that dies (#7's rule, `measure-market.ts`). */
function finite(label: string, value: number): number {
	if (!Number.isFinite(value)) throw new Error(`${label} is ${value}`);
	return value;
}

/** The speed law's masses: §2 counts stars and planets, and deliberately not
 *  moons, stations or belts (§2.1). The set is fixed for a system's lifetime;
 *  only the positions move, and those are mutated in place. */
function massesOf(world: World) {
	return world.system.bodies
		.filter((b) => b.kind === "star" || b.kind === "planet")
		.map((b) => ({ id: b.id, pos: b.pos, radiusKm: b.radiusKm }));
}

const median = (xs: number[]): number =>
	xs.length ? (xs[Math.floor(xs.length / 2)] ?? Number.NaN) : Number.NaN;

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
	 * Kilometres the *worst* heading that clears the body covers in `ESCAPE_S`
	 * seconds — see `ESCAPE_HEADINGS_DEG`. Zero when no sampled heading clears
	 * it, which means the ship ended inside the surface; `escapeHeadings` says
	 * which of the two a zero is.
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
	/** How many of `ESCAPE_HEADINGS_DEG` cleared the body and were flown. */
	escapeHeadings: number;
}

/** Headings the escape is flown on, degrees off the outward radial.
 *
 *  Not just 0: the release rule is "this heading does not enter the body", and
 *  a radial-only sweep cannot tell that from "the centre is behind me". The
 *  band past 90° is where the two differ, and it is the useful one — a ship
 *  beside a world wants to go *around* it, not straight up.
 *
 *  A heading that genuinely enters the surface is **skipped rather than
 *  counted**: it is supposed to be stopped, and how many of these clear the
 *  body depends on how far up the ship is. At a drop point *on* the surface,
 *  only the outward hemisphere clears it. */
const ESCAPE_HEADINGS_DEG = [0, 45, 89, 95, 100, 110];

/**
 * The worst of `ESCAPE_S` seconds of cruise from a point beside a body, over
 * every heading in `ESCAPE_HEADINGS_DEG` — "can the player leave?", flown
 * rather than argued.
 *
 * The target is a point 1 AU along the heading, which is a free cruise with
 * something selected: the drop sphere is 50 km and the ship is heading away
 * from it, so nothing here ends the run except the guard.
 */
function flyAway(
	seed: number,
	gameTime: number,
	from: Vec3,
	bodyId: string | undefined,
): { worstKm: number; headings: number } {
	if (!bodyId) return { worstKm: 0, headings: 0 };
	const world = makeWorld(seed);
	world.gameTime = gameTime;
	advanceWorldClock(world, 0);
	const body = world.system.byId.get(bodyId);
	if (!body) return { worstKm: 0, headings: 0 };
	const out = sub(from, body.pos);
	const len = length(out);
	if (len === 0) return { worstKm: 0, headings: 0 };
	// The tolerance-free predicate below needs the ship to start strictly above
	// the surface. Every rule in `guardStopKm` leaves it there — but silently, so
	// this says it out loud and dies rather than reporting pins it does not have.
	if (len - body.radiusKm <= 1e-6)
		throw new Error(
			`escape flown from ${(len - body.radiusKm).toFixed(6)} km above a ` +
				`${body.radiusKm.toFixed(0)} km body — at no clearance the tangent ` +
				"case is back, and this sweep would report pins it does not have",
		);
	const radial = scale(out, 1 / len);
	// Any unit vector across the radial serves to sweep the heading through;
	// the geometry is symmetric about it, so one suffices.
	// Gram-Schmidt against the radial. The axis is hoisted because the two uses
	// of it have to be the same vector for that to be what this is.
	const axis = v3(radial.y, radial.z, radial.x);
	const raw = sub(axis, scale(radial, dot(radial, axis)));
	const acrossLen = length(raw);
	if (acrossLen === 0) return { worstKm: 0, headings: 0 };
	const across = scale(raw, 1 / acrossLen);

	let worst = Number.POSITIVE_INFINITY;
	let flown = 0;
	for (const deg of ESCAPE_HEADINGS_DEG) {
		// Every heading starts from the same clock. `advanceWorldClock` writes body
		// positions in place, so a shared world would hand the second heading a
		// planet that had moved five seconds — 150 km at a station's orbital speed,
		// which is enough to put the start point inside it and report a pin that
		// is really a stale fixture.
		world.gameTime = gameTime;
		advanceWorldClock(world, 0);
		const rad = (deg * Math.PI) / 180;
		const nose = add(
			scale(radial, Math.cos(rad)),
			scale(across, Math.sin(rad)),
		);
		// Skip the headings that fly into the body: those are stops, not pins.
		// **`entersSphere` is `cruise.ts`'s own predicate**, not a restatement of
		// it — a sweep that decided this its own way could pass a game that
		// decides it differently.
		//
		// It has no tangent tolerance, and an earlier version of this line needed
		// one: when a stop left the ship *on* a surface, a bare `<` read a tangent
		// as an entry on whichever side the rounding fell, and half the corpus
		// reported pins it did not have.
		//
		// What the predicate needs is only that the ship starts **strictly above**
		// the surface, which is what the guard above enforces. Not a fixed
		// altitude: a stop at a guard volume leaves the ship at
		// `HOST_CLEARANCE_KM` or at the shell, but a stop from *inside* one
		// preserves whatever altitude the ship had, which can be far less — 2.5 km
		// in `tests/cruise.test.ts`. Strictly above is the whole invariant, and
		// it is all this needs.
		if (entersSphere(from, nose, body.pos, body.radiusKm)) continue;
		flown++;
		const target = { pos: add(from, scale(nose, AU_KM)), radiusKm: 1 };
		let pos = from;
		let travelled = 0;
		for (let i = 0; i < ESCAPE_S / DT; i++) {
			const step = advanceCruise({
				pos,
				nose,
				throttle: 1,
				dt: DT,
				masses: massesOf(world),
				target,
				params: DEFAULT_CRUISE,
				targetParentId: null,
			});
			pos = step.pos;
			travelled += step.travelledKm;
			advanceWorldClock(world, DT);
			if (step.dropped) break;
		}
		worst = Math.min(worst, travelled);
	}
	return { worstKm: flown === 0 ? 0 : worst, headings: flown };
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
	const targetParentId = stationHostIdOf(world.system, targetId);
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
		const masses = massesOf(world);

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
			const closest = closestApproachKm(pos, nose, step.travelledKm, m.pos);
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
			let escapeHeadings = 0;
			if (measureReengage && rangeKm > DEFAULT_CRUISE.dropRadiusKm) {
				const again = makeWorld(world.seed);
				again.gameTime = world.gameTime;
				again.ship.pos = pos;
				advanceWorldClock(again, 0);
				const second = flyLeg(again, targetId, false);
				reengagedKm = Math.max(0, rangeKm - second.rangeKm);
				const away = flyAway(world.seed, world.gameTime, pos, step.exitBodyId);
				escapeKm = away.worstKm;
				escapeHeadings = away.headings;
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
				escapeHeadings,
			};
		}
	}
	const end = world.system.byId.get(targetId);
	if (!end) throw new Error(`no body ${targetId}`);
	// A timeout was not *stopped* by anything, so it carries no closing speed to
	// report and is excluded from the stopped cohort below rather than counted
	// as pinned. `finite()` still guards every number that is printed — a NaN in
	// a column is the failure this file's own rule forbids.
	return {
		exit: "timeout",
		exitBodyId: undefined,
		rangeKm: finite("range", length(sub(end.pos, pos))),
		closingKms: 0,
		seconds: LEG_TIMEOUT_S,
		penetrationKm: finite("penetration", Math.max(0, penetrationKm)),
		pos,
		gameTime: world.gameTime,
		reengagedKm: 0,
		escapeKm: 0,
		escapeHeadings: 0,
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
			occluded =
				closestApproachKm(world.ship.pos, nose, legKm, hostBody.pos) <
				hostBody.radiusKm;
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

/** 200 by default, because that is the corpus every figure in §12 is stated
 *  against: a shipped default that reproduces something else means the numbers
 *  in the spec cannot be checked by running the instrument. */
const seedCount = Number(process.argv[2] ?? 200);
if (!Number.isFinite(seedCount) || seedCount < 1)
	throw new Error(`unusable seed count ${process.argv[2]}`);
const SEEDS = Array.from({ length: seedCount }, (_, i) => i + 1);

console.log(
	`rule: the target's host guards at radius + ${HOST_CLEARANCE_KM} km, every other body at ${SURFACE_MARGIN}×radius; ` +
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
// Ungated: the deepest of *every* leg, not of the ones over a threshold. A
// column that only prints what exceeds 1 km cannot support "no other leg went
// inside a planet".
const deepest = rows.reduce((a, r) => Math.max(a, r.result.penetrationKm), 0);
console.log(
	`\n  paths that went inside a planet's true surface: ${tunnelled.length}/${rows.length} past 1 km, ` +
		`deepest ${deepest.toFixed(3)} km over all ${rows.length}\n`,
);

// ── Is being stopped terminal?
const timedOut = rows.filter((r) => r.result.exit === "timeout");
const stopped = rows.filter(
	(r) =>
		r.hostId !== null &&
		r.result.exit !== "arrival" &&
		r.result.exit !== "timeout",
);
const stuck = stopped.filter((r) => r.result.reengagedKm < 100);
const gained = stopped.map((r) => r.result.reengagedKm).sort((a, b) => a - b);
// A leg whose ship ended inside a surface has no heading that clears the body,
// so it is not evidence about the guard either way — reported, not folded in.
const enclosed = stopped.filter((r) => r.result.escapeHeadings === 0);
const escapable = stopped.filter((r) => r.result.escapeHeadings > 0);
const escapes = escapable.map((r) => r.result.escapeKm).sort((a, b) => a - b);
const pinned = escapable.filter((r) => r.result.escapeKm < 100);
console.log("after a stop — can the player cruise on?\n");
if (timedOut.length)
	console.log(
		`  ${timedOut.length} leg(s) neither arrived nor were stopped inside ${LEG_TIMEOUT_S} s ` +
			"— excluded from the counts below, which are about being stopped\n",
	);
console.log(
	`  stopped legs ${stopped.length}\n` +
		"  back at the same station, which is behind the planet: median " +
		`${km(median(gained))} km, still stopped ${stuck.length}/${stopped.length} — as it should be\n` +
		`  on the worst heading that clears the planet, ${ESCAPE_S} seconds: median ` +
		`${km(median(escapes))} km, pinned ${pinned.length}/${escapable.length}\n` +
		`  legs whose ship ended inside a surface, so no heading clears it: ${enclosed.length}\n`,
);

// ── Stations that sit inside their own host's shell.
//
// §12.2's figures, printed by the instrument that is shipped rather than by a
// script that was thrown away: a spec number nothing reproduces is a number
// nobody can check.
console.log("stations inside their host's shell\n");
{
	const insides: {
		seed: number;
		id: string;
		gapKm: number;
		hostRadiusKm: number;
	}[] = [];
	let planetOrbiting = 0;
	for (const seed of SEEDS) {
		const world = makeWorld(seed);
		for (const station of world.system.contents.stations) {
			if (!station.parentId) continue;
			const host = world.system.contents.planets.find(
				(p) => p.id === station.parentId,
			);
			if (!host) continue;
			planetOrbiting++;
			const gapKm = host.radiusKm * SURFACE_MARGIN - station.orbit.radiusKm;
			if (gapKm > 0)
				insides.push({
					seed,
					id: station.id,
					gapKm,
					hostRadiusKm: host.radiusKm,
				});
		}
	}
	const giants = insides.filter((x) => x.hostRadiusKm >= 3e4).length;
	const radii = insides.map((x) => x.hostRadiusKm).sort((a, b) => a - b);
	console.log(
		`  ${insides.length}/${planetOrbiting} planet-orbiting stations, ` +
			`hosts ${km(radii[0] ?? 0)}–${km(radii[radii.length - 1] ?? 0)} km, ` +
			`${giants} of them over 30k km\n`,
	);
	console.log("  the deepest, and what leaving one costs in normal flight\n");
	for (const x of [...insides].sort((a, b) => b.gapKm - a.gapKm).slice(0, 3)) {
		console.log(
			`    seed ${String(x.seed).padStart(4)}  ${x.id.padEnd(17)} ${km(x.gapKm)} km inside a ` +
				`${km(x.hostRadiusKm)} km host — ${(x.gapKm / ASSIST_CAP_KMS / 60).toFixed(0)} min at the assist cap`,
		);
	}
	console.log("");
}

// ── The dimension the guard cannot reach: how low the orbits are.
//
// A station at orbital radius r above a planet of radius R is hidden whenever it
// is on the far side and its offset projected across the line of sight is under
// R. For a bearing that is effectively parallel at 1 AU that is
// `1 − √(r²−R²)/r`, halved for "behind" — a function of `r/R` alone, and
// `system.ts`'s 400–2,000 km altitude puts a gas giant at r/R ≈ 1.03.
//
// **That closed form assumes the line of sight is isotropic to the orbit**, and
// the orbits here are not isotropic at all: `aroundBody` copies the *planet's*
// inclination, so every station in a system orbits in nearly one plane. What
// makes the form hold anyway is the other side of the same angle — the arrival
// bearing is drawn uniformly on the sphere (§7.4), so the line of sight is
// isotropic even where the orbits are coplanar. An assumption worth stating is
// worth checking, so the sampled rate is printed **beside** the prediction
// rather than in place of it.
//
// They part, consistently and in one direction: the form runs 2–4 points under
// what the corpus measures. The mechanism is measured below rather than
// asserted — the line of sight is **not** isotropic to these orbits. A host sits
// near its system's plane and the ship arrives only ~1 AU out, so `host → ship`
// tends to lie near that plane too, which is where the near-coplanar orbits
// are: edge-on, where occlusion is highest. `mean |cos|` between the line of
// sight and the orbit normal comes out at 0.43 against the 0.50 an isotropic
// bearing would give.
//
// (The finite-distance "shadow is a cone" story is *not* the mechanism, and was
// the first answer written here: the sampled test is itself a parallel-ray one,
// so cone geometry cannot enter it, and at station scale against 1 AU the
// correction would be ~0.05 points rather than 2–4.)
//
// The projection table below therefore reads as a **lower bound** on occlusion
// at a given r/R — "at least this good" — and wants re-measuring before any
// number is taken from it.
const occlusionRate = (k: number) => 0.5 * (1 - Math.sqrt(k * k - 1) / k);
console.log("occlusion by host size, over 64 phases of each real orbit\n");
{
	const buckets: [string, (r: number) => boolean][] = [
		["rocky   R < 10k km", (r) => r < 1e4],
		["large   10–30k km", (r) => r >= 1e4 && r < 3e4],
		["giant   R > 30k km", (r) => r >= 3e4],
	];
	/** One row per station, for the per-station predictions below — the same
	 *  population `samples` is built from, recorded once rather than recovered
	 *  by de-duplicating 64 phases of it. */
	const stations: { ratio: number; cos: number }[] = [];
	const samples: {
		hostRadiusKm: number;
		ratio: number;
		/** `|cos|` between the line of sight and this orbit's normal. */
		cos: number;
		occluded: boolean;
	}[] = [];
	for (const seed of SEEDS) {
		const world = makeWorld(seed);
		const { contents } = world.system;
		// One world per seed: `gameTime` is absolute, so re-placing the bodies at
		// each phase is an `advanceWorldClock`, not a regeneration. Building one
		// per phase cost ~21,000 full system generations.
		const at = makeWorld(seed);
		for (const station of contents.stations) {
			if (!station.parentId) continue;
			// `byId` resolves the same body in O(1); a linear `planets.find` per
			// station said the same thing more slowly.
			const hostBody = world.system.byId.get(station.parentId);
			if (!hostBody) continue;
			const toShip = sub(world.ship.pos, hostBody.pos);
			const los = scale(toShip, 1 / length(toShip));
			// The orbit's normal, from the same inclination and node
			// `positionOnOrbit` builds the position from.
			const inc = station.orbit.inclination;
			const node = station.orbit.node;
			const normal = v3(
				Math.sin(inc) * Math.sin(node),
				-Math.sin(inc) * Math.cos(node),
				Math.cos(inc),
			);
			const cos = Math.abs(dot(los, normal));
			stations.push({ ratio: station.orbit.radiusKm / hostBody.radiusKm, cos });
			for (let i = 0; i < 64; i++) {
				at.gameTime = (i / 64) * station.orbit.periodS;
				advanceWorldClock(at, 0);
				const moved = at.system.byId.get(station.id);
				const movedHost = at.system.byId.get(station.parentId);
				if (!moved || !movedHost) continue;
				const o = sub(moved.pos, movedHost.pos);
				const along = dot(o, los);
				const perp = length(sub(o, scale(los, along)));
				samples.push({
					hostRadiusKm: hostBody.radiusKm,
					ratio: station.orbit.radiusKm / hostBody.radiusKm,
					cos,
					occluded: along < 0 && perp < hostBody.radiusKm,
				});
			}
		}
	}
	// The isotropy the closed form assumes, checked rather than assumed — and
	// then the gap it leaves attributed rather than asserted.
	//
	// For one circular orbit the occluded fraction is exact, and it is not the
	// isotropic form: with `c = |cos|` between the line of sight and the orbit
	// normal, the in-plane component of the sight line is `s = √(1−c²)`, the
	// station is hidden while `r·s·cos ψ < −√(r²−R²)`, and the fraction of the
	// orbit that satisfies it is `arccos(k)/π` for `k = √(r²−R²)/(r·s)` — zero
	// once `k ≥ 1`, because a sight line near the pole never passes behind.
	// Averaged over an isotropic `c` this collapses to the isotropic form, so
	// the two differ by exactly the thing being tested.
	const geometricRate = (rOverR: number, c: number) => {
		const sin = Math.sqrt(Math.max(0, 1 - c * c));
		if (sin === 0) return 0;
		const k = Math.sqrt(Math.max(0, rOverR * rOverR - 1)) / (rOverR * sin);
		return k >= 1 ? 0 : Math.acos(k) / Math.PI;
	};
	{
		// Accumulated over the **same stations the samples come from**, so the
		// three rows below are three answers to one question rather than three
		// questions that happen to agree. An earlier version walked its own loop
		// with its own host filter; the two filters did in fact match — the
		// station count and the sample count are unchanged by this — but that
		// was a property of two loops agreeing rather than one the reader could
		// check, and it is the sort of difference no number of decimals shows.
		let cosSum = 0;
		let geometric = 0;
		let isotropic = 0;
		for (const x of stations) {
			cosSum += x.cos;
			geometric += geometricRate(x.ratio, x.cos);
			isotropic += occlusionRate(x.ratio);
		}
		const n = stations.length;
		const sampledPct =
			(100 * samples.filter((x) => x.occluded).length) / samples.length;
		console.log(
			`  line of sight vs orbit normal: mean |cos| = ${(cosSum / n).toFixed(3)} over ${n} stations.\n` +
				"  An isotropic bearing gives 0.500; lower is edge-on, where occlusion is highest.\n\n" +
				`  predicted occlusion, isotropic form:            ${((100 * isotropic) / n).toFixed(2)}%\n` +
				`  predicted using each station's own sight line:  ${((100 * geometric) / n).toFixed(2)}%\n` +
				`  sampled over every orbit phase:                 ${sampledPct.toFixed(2)}%\n` +
				"  — the per-station form is the isotropic one with the assumption removed and nothing\n" +
				"    else changed, over the same stations, so the distance it closes is what the\n" +
				"    assumption was costing. Printed to two places because 'they agree' is the claim.\n",
		);
	}
	console.log(
		"  host class            median r/R   occluded   the form predicts",
	);
	for (const [label, test] of buckets) {
		const mine = samples.filter((x) => test(x.hostRadiusKm));
		if (mine.length === 0) continue;
		const ratios = mine.map((x) => x.ratio).sort((a, b) => a - b);
		const occ = mine.filter((x) => x.occluded).length;
		// The prediction is evaluated per sample and averaged, not at the median
		// r/R: the rate is convex in r/R, so the two differ by more than rounding
		// on a bucket as wide as "rocky".
		const predicted =
			mine.reduce((a, x) => a + occlusionRate(x.ratio), 0) / mine.length;
		console.log(
			`  ${label.padEnd(20)}  ${median(ratios).toFixed(3)}       ${pct(occ, mine.length).padStart(6)}   ` +
				`${`${(100 * predicted).toFixed(1)}%`.padStart(10)}  (n=${mine.length})`,
		);
	}
	console.log("\n  if every station orbited at r/R:   occluded");
	for (const k of [1.05, 1.1, 1.25, 1.5, 2, 3]) {
		console.log(
			`    r/R = ${k.toFixed(2).padStart(5)}                     ${(100 * occlusionRate(k)).toFixed(1).padStart(5)}%`,
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
			`${median(ratios).toFixed(3)}   ` +
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
