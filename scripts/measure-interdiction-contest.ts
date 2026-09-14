/**
 * Reprints the sweeps behind `src/interdiction.ts` (node #324 part b, the
 * principal's O1 ruling). Two modes.
 *
 * **Default: the heading contest that shipped.** For each initiator/target
 * pair it flies one contest per reaction delay through the module's own
 * `beginContest`, `stepContest` and `followHeading`: the two headings start
 * aligned, the initiator follows at its lock rate, and the target turns at a
 * share of its own hull's authority from the given moment. The module's
 * constants are read, never restated, so this prints what the shipped figures
 * do. `--factor <f>` flies another turn factor through the same functions;
 * `--cone <deg>` flies another cone, which the module does not take, so that
 * one arm checks its own lock and says so in its header.
 *
 * **`--bearing`: the lock that was rejected.** A raider pursues a courier in
 * cruise, both at one shared speed with velocity along the nose; the raider
 * slews its nose toward the courier's *position* at its full cruise turn rate,
 * and the lock holds while the courier stays inside the raider's cone. The
 * pursuit is written out here because it no longer exists in `src` — the
 * rejected arm kept runnable, so `combat-model.md` §3's figures stay checkable
 * (sage round 2). It prints the outcome over speed and starting range, for a
 * courier holding course and one turning at its full cruise rate.
 *
 *   bun scripts/measure-interdiction-contest.ts
 *   bun scripts/measure-interdiction-contest.ts --bearing
 */
import { HULL_IDS, type HullId } from "../src/hull";
import {
	INTERDICTION_CHARGE_S,
	INTERDICTION_LOCK_DEG,
	INTERDICTION_TURN_FACTOR,
	beginContest,
	cruiseTurnRate,
	followHeading,
	stepContest,
} from "../src/interdiction";
import { flightPerformance } from "../src/sim";
import { type Vec3, add, dot, normalizeOr, scale, sub, v3 } from "../src/vec3";

const arg = (name: string, fallback: number): number => {
	const at = process.argv.indexOf(`--${name}`);
	return at >= 0 ? Number(process.argv[at + 1]) : fallback;
};
const DT = 1 / 60;

const yaw = (v: Vec3, r: number): Vec3 =>
	v3(
		v.x * Math.cos(r) + v.z * Math.sin(r),
		v.y,
		-v.x * Math.sin(r) + v.z * Math.cos(r),
	);

// ---------------------------------------------------------------------------
// --bearing: the rejected arm.
// ---------------------------------------------------------------------------

/** The first build's cone, which the bearing sweep was flown at. */
const BEARING_CONE_DEG = 15;

function pursue(
	pursuerPos: Vec3,
	pursuerNose: Vec3,
	targetPos: Vec3,
	speedKms: number,
	rate: number,
): { pos: Vec3; nose: Vec3 } {
	const nose = followHeading(pursuerNose, sub(targetPos, pursuerPos), rate, DT);
	return { pos: add(pursuerPos, scale(nose, speedKms * DT)), nose };
}

function flyBearing(speedKms: number, rangeKm: number, targetTurns: boolean) {
	const cos = Math.cos((BEARING_CONE_DEG * Math.PI) / 180);
	const raiderRate = cruiseTurnRate(flightPerformance("raider"));
	const courierRate = cruiseTurnRate(flightPerformance("courier"));
	let target = { pos: v3(0, 0, 0), nose: v3(0, 0, -1) };
	let pursuer = { pos: v3(0, 0, rangeKm), nose: v3(0, 0, -1) };
	for (let t = 0; t < 10; t += DT) {
		pursuer = pursue(
			pursuer.pos,
			pursuer.nose,
			target.pos,
			speedKms,
			raiderRate,
		);
		const nose = targetTurns ? yaw(target.nose, courierRate * DT) : target.nose;
		target = { nose, pos: add(target.pos, scale(nose, speedKms * DT)) };
		const to = sub(target.pos, pursuer.pos);
		if (dot(pursuer.nose, normalizeOr(to, pursuer.nose)) < cos)
			return `broken ${t.toFixed(2)}s`;
		if (t + DT >= INTERDICTION_CHARGE_S) return "caught";
	}
	return "timeout";
}

// ---------------------------------------------------------------------------
// Default: the heading contest.
// ---------------------------------------------------------------------------

const FACTOR = arg("factor", INTERDICTION_TURN_FACTOR);
const CONE_OVERRIDE = process.argv.includes("--cone")
	? arg("cone", INTERDICTION_LOCK_DEG)
	: null;

function flyHeading(
	initiator: HullId,
	target: HullId,
	turnFraction: number,
	reactS: number,
) {
	const follow = cruiseTurnRate(flightPerformance(initiator)) * FACTOR;
	const turn = cruiseTurnRate(flightPerformance(target)) * turnFraction;
	let a = v3(0, 0, -1);
	let b = v3(0, 0, -1);
	let contest = beginContest();
	const overrideCos =
		CONE_OVERRIDE === null ? null : Math.cos((CONE_OVERRIDE * Math.PI) / 180);
	let charge = 0;
	for (let t = 0; t < 10; t += DT) {
		if (t >= reactS) b = yaw(b, turn * DT);
		a = followHeading(a, b, follow, DT);
		if (overrideCos === null) {
			contest = stepContest(contest, a, b, DT);
			if (contest.phase === "broken") return `broken ${t.toFixed(2)}s`;
			if (contest.phase === "succeeded") return "caught";
			if (contest.phase === "lost") return "lost";
		} else {
			if (dot(a, b) < overrideCos) return `broken ${t.toFixed(2)}s`;
			charge += DT;
			if (charge >= INTERDICTION_CHARGE_S) return "caught";
		}
	}
	return "timeout";
}

if (process.argv.includes("--bearing")) {
	console.log(
		`REJECTED bearing lock: raider pursues courier, cone ${BEARING_CONE_DEG}°, charge ${INTERDICTION_CHARGE_S} s`,
	);
	for (const speedKms of [100, 300, 1_000, 3_000, 10_000])
		for (const rangeKm of [10, 30, 60])
			console.log(
				`${String(speedKms).padStart(6)} km/s from ${String(rangeKm).padStart(2)} km: ` +
					`holds course ${flyBearing(speedKms, rangeKm, false)} | ` +
					`full turn ${flyBearing(speedKms, rangeKm, true)}`,
			);
} else {
	console.log(
		CONE_OVERRIDE === null
			? `heading contest through stepContest: cone ${INTERDICTION_LOCK_DEG}°, lock turn factor ${FACTOR}, charge ${INTERDICTION_CHARGE_S} s`
			: `heading contest, --cone ${CONE_OVERRIDE}° checked in this script (stepContest takes no cone), lock turn factor ${FACTOR}`,
	);
	console.log(
		"cruise turn rate (rad/s):",
		HULL_IDS.map(
			(h) => `${h} ${cruiseTurnRate(flightPerformance(h)).toFixed(2)}`,
		).join(", "),
	);
	const PAIRS: [HullId, HullId][] = [
		["raider", "courier"],
		["raider", "interceptor"],
		["raider", "freighter"],
		["raider", "raider"],
		["courier", "raider"],
	];
	for (const [initiator, target] of PAIRS) {
		const cells = [0, 0.5, 1, 1.5].map(
			(react) =>
				`full turn at ${react}s: ${flyHeading(initiator, target, 1, react)}`,
		);
		cells.push(`3/4 turn at 0s: ${flyHeading(initiator, target, 0.75, 0)}`);
		cells.push(`holds course: ${flyHeading(initiator, target, 0, 0)}`);
		console.log(`${initiator} → ${target}: ${cells.join(" | ")}`);
	}
}
