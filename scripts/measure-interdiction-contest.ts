/**
 * Reprints the sweep `src/interdiction.ts`'s cone and turn factor were chosen
 * from (node #324 part b, the principal's O1 ruling).
 *
 * For each initiator/target pair it flies one contest per reaction delay: the
 * two headings start aligned, the initiator follows at its lock rate, and the
 * target turns at a share of its own hull's authority from the given moment.
 * The module's constants are read, never restated, so this prints what the
 * shipped figures do. Pass `--cone <deg> --factor <f>` to fly other figures.
 *
 *   bun scripts/measure-interdiction-contest.ts
 */
import { HULL_IDS, type HullId } from "../src/hull";
import {
	INTERDICTION_CHARGE_S,
	INTERDICTION_LOCK_DEG,
	INTERDICTION_TURN_FACTOR,
	cruiseTurnRate,
	followHeading,
} from "../src/interdiction";
import { flightPerformance } from "../src/sim";
import { type Vec3, v3 } from "../src/vec3";

const arg = (name: string, fallback: number): number => {
	const at = process.argv.indexOf(`--${name}`);
	return at >= 0 ? Number(process.argv[at + 1]) : fallback;
};
const CONE_DEG = arg("cone", INTERDICTION_LOCK_DEG);
const FACTOR = arg("factor", INTERDICTION_TURN_FACTOR);
const DT = 1 / 60;
const COS = Math.cos((CONE_DEG * Math.PI) / 180);

const yaw = (v: Vec3, r: number): Vec3 =>
	v3(
		v.x * Math.cos(r) + v.z * Math.sin(r),
		v.y,
		-v.x * Math.sin(r) + v.z * Math.cos(r),
	);

function fly(
	initiator: HullId,
	target: HullId,
	turnFraction: number,
	reactS: number,
) {
	const follow = cruiseTurnRate(flightPerformance(initiator)) * FACTOR;
	const turn = cruiseTurnRate(flightPerformance(target)) * turnFraction;
	let a = v3(0, 0, -1);
	let b = v3(0, 0, -1);
	let charge = 0;
	for (let t = 0; t < 10; t += DT) {
		if (t >= reactS) b = yaw(b, turn * DT);
		a = followHeading(a, b, follow, DT);
		if (a.x * b.x + a.y * b.y + a.z * b.z < COS)
			return `broken ${t.toFixed(2)}s`;
		charge += DT;
		if (charge >= INTERDICTION_CHARGE_S) return "caught";
	}
	return "timeout";
}

console.log(
	`cone ${CONE_DEG}°, lock turn factor ${FACTOR}, charge ${INTERDICTION_CHARGE_S} s`,
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
		(react) => `full turn at ${react}s: ${fly(initiator, target, 1, react)}`,
	);
	cells.push(`3/4 turn at 0s: ${fly(initiator, target, 0.75, 0)}`);
	cells.push(`holds course: ${fly(initiator, target, 0, 0)}`);
	console.log(`${initiator} → ${target}: ${cells.join(" | ")}`);
}
