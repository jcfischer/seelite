/**
 * What a leg actually costs, across the two dials the principal ruled on.
 *
 *   bun scripts/measure-cruise-pacing.ts
 *
 * #14's whole question is which of #10's derived numbers survive being flown,
 * and after four sessions the answers are: the exponent belongs between 0.6 and
 * 0.75 and "definitely not higher", and a leg should come in "slightly less
 * than 60 s". Both are judgements about *time*, and time is a function of three
 * numbers at once — `v_max`, the exponent, and the approach clamp — so picking
 * a pair by eye from the spec's closed-form ramp would ignore the ~16 s the
 * clamp adds and the deep-space run that dominates a long leg.
 *
 * So this measures rather than derives: it flies each candidate through the
 * real `advanceCruise`, the same code the game runs, and prints the elapsed
 * time. A sweep, not a test — nothing here asserts, and it is committed so the
 * resolution's numbers can be re-derived rather than believed.
 *
 * The two legs are the ones being judged against each other: **0.84 AU** is the
 * arrival-to-station-trade leg in the seed the principal has been flying
 * (`?seed=42`, SOORATLE), and **1.3 AU** is #10 §2.3's "typical leg", the
 * benchmark the spec states its pacing against. They are not the same distance,
 * and a tuning that satisfies one puts the other about 10% away — which is
 * exactly the sort of thing that should be visible in a table rather than
 * settled silently.
 */

import {
	DEFAULT_CRUISE,
	type CruiseParams,
	advanceCruise,
} from "../src/cruise";
import { AU_KM, C_KMS, MAX_DT } from "../src/units";
import { type Vec3, length, scale, sub, v3 } from "../src/vec3";

/** Frame delta, seconds — the game's own `MAX_DT`, so the sweep is the worst
 *  case for anything that sub-steps. Read from the unit scheme rather than
 *  restated, for the same reason the probes read their constants off the page. */
const DT = MAX_DT;

/** Straight-in, full throttle, one mass at the target: the geometry §2.3's
 *  table is stated against, flown with the clamp in force the way the game
 *  flies it. Returns the seconds elapsed, or `null` if it never arrived.
 *
 *  Deliberately **flies** rather than calling `cruise.ts`'s `legSeconds`: that
 *  is the estimate the HUD shows, and a sweep that measured the estimate would
 *  be tuning the readout rather than the game. The two are checked against each
 *  other in `tests/cruise.test.ts`. */
function flownSeconds(legAu: number, params: CruiseParams): number | null {
	const target = { pos: v3(), radiusKm: 1.2 };
	// A point-like mass at the target: the law reads distances, not radii,
	// and a real planet radius would end the run on its surface (`SURFACE_MARGIN`)
	// before the drop radius was reached.
	const masses = [{ id: "body", pos: v3(), radiusKm: 1 }];
	let pos: Vec3 = v3(legAu * AU_KM, 0, 0);
	let t = 0;
	while (t < 900) {
		const to = sub(target.pos, pos);
		const nose = scale(to, 1 / length(to));
		const step = advanceCruise({
			pos,
			nose,
			throttle: 1,
			dt: DT,
			masses,
			target,
			params,
		});
		pos = step.pos;
		t += DT;
		if (step.dropped) return t;
	}
	return null;
}

const EXPONENTS = [0.55, 0.6, 0.65, 0.7, 0.75];
const V_MAX_C = [20, 23, 26, 30, 35];
const LEGS: [string, number][] = [
	["0.84 AU (seed 42, station-trade)", 0.84],
	["1.30 AU (§2.3 typical leg)", 1.3],
];

console.log(
	`clamp: vicinity ${DEFAULT_CRUISE.vicinityKm} km, lead ${DEFAULT_CRUISE.approachLeadS}s ` +
		`— costs ${(DEFAULT_CRUISE.approachLeadS * Math.log(DEFAULT_CRUISE.vicinityKm / DEFAULT_CRUISE.dropRadiusKm)).toFixed(1)}s of every arrival\n`,
);

for (const [name, legAu] of LEGS) {
	console.log(`${name}`);
	const header = ["  exp \\ v_max", ...V_MAX_C.map((c) => `${c}c`.padStart(7))];
	console.log(header.join(""));
	for (const exponent of EXPONENTS) {
		const cells = V_MAX_C.map((c) => {
			const seconds = flownSeconds(legAu, {
				...DEFAULT_CRUISE,
				exponent,
				vMaxKms: c * C_KMS,
			});
			return (seconds === null ? "—" : `${seconds.toFixed(1)}s`).padStart(7);
		});
		console.log([`  ${exponent.toFixed(2)}        `, ...cells].join(""));
	}
	console.log("");
}
