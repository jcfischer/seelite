/**
 * Every hull's vent shares, solved from #181's handling law (#619).
 *
 * `flight-model.md` §3.4 makes a vent's thrust a share of `thrustMN` and owes
 * that the courier's shares reproduce #5's tuned figures. The principal ruled
 * on #619 (2026-10-02) that **no hull is retuned** by the vents, so every row
 * is solved the same way: the figure #181's law gave that hull before vents is
 * the figure its vents now deliver.
 *
 * - `main` is 1: the main drive alone is `thrustKms2`.
 * - `retro` is ½ per vent: the pair brakes at `thrustKms2`, which is what #5's
 *   assist did along the nose.
 * - `strafe` is solved so a translation pair removes drift at `ASSIST_CAP_KMS /
 *   assistLateralTauS` — the most #5's exponential ever asks for inside the
 *   envelope, where no drift exceeds the cap. It comes out at 5/12 on every
 *   hull, because the drift time scales inversely with acceleration.
 * - `pitch`, `yaw` and `roll` are solved so each attitude couple gives #181's
 *   `angularAccel` against `boxInertia`.
 *
 * It prints the solved rows beside the ones `src/hull.ts` carries, so a hull
 * whose mass, thrust or envelope moves shows here as a row to re-solve.
 * `tests/vents.test.ts` holds the table to the same law.
 *
 * And it prints what the one departure the shares cannot remove costs each
 * hull (`flight-model.md` §3.8.2): #5 eased a released turn out at any
 * authority, the vents at their couple's, so a stop from the peak rate to 5%
 * of it takes longer wherever the ease-out asks more than the couple gives.
 * The figure is the worst over three frame steps.
 *
 *   bun scripts/measure-vent-shares.ts
 */

import {
	HULL_IDS,
	HULL_SPECS,
	type HullId,
	PLAYER_BASELINE_HULL,
	type VentShares,
} from "../src/hull";
import { legacyAngular } from "./lib/legacy-flight";
import {
	ASSIST_CAP_KMS,
	type Angular,
	REFERENCE_ANGULAR_ACCEL,
	REFERENCE_ANGULAR_DAMP_TAU_S,
	REFERENCE_ANGULAR_MAX,
	REFERENCE_ASSIST_LATERAL_TAU_S,
	boxInertia,
	flightPerformance,
	stepAngular,
} from "../src/sim";

/**
 * #181's handling law, as `flightPerformance` stated it before vents: linear
 * acceleration `thrustMN / massT`, and an angular authority scaled by
 * `acceleration / length` against the baseline hull. Kept here, runnable, as
 * the reference the vent table is solved against and held to.
 */
export function referenceHandling(id: HullId) {
	const spec = HULL_SPECS[id];
	const reference = HULL_SPECS[PLAYER_BASELINE_HULL];
	const thrustKms2 = spec.thrustMN / spec.massT;
	const referenceThrustKms2 = reference.thrustMN / reference.massT;
	const agility =
		thrustKms2 /
		spec.env.lengthKm /
		(referenceThrustKms2 / reference.env.lengthKm);
	return {
		thrustKms2,
		assistLateralTauS:
			(REFERENCE_ASSIST_LATERAL_TAU_S * referenceThrustKms2) / thrustKms2,
		angularMax: {
			pitch: REFERENCE_ANGULAR_MAX.pitch * agility,
			yaw: REFERENCE_ANGULAR_MAX.yaw * agility,
			roll: REFERENCE_ANGULAR_MAX.roll * agility,
		},
		angularAccel: REFERENCE_ANGULAR_ACCEL * agility,
		angularDampTauS: REFERENCE_ANGULAR_DAMP_TAU_S / agility,
	};
}

/** The separation of each attitude pair, kilometres: the couple is one vent's
 *  thrust times it. Pitch and yaw pairs sit at the two ends of the length,
 *  roll's at the two ends of the beam (`SLOT_GEOMETRY` in `hull.ts`). */
const coupleArm = (id: HullId): Angular => {
	const { lengthKm, beamKm } = HULL_SPECS[id].env;
	return { pitch: lengthKm, yaw: lengthKm, roll: beamKm };
};

/** The shares that reproduce `referenceHandling(id)`. */
export function solveVentShares(id: HullId): VentShares {
	const spec = HULL_SPECS[id];
	const ref = referenceHandling(id);
	const inertia = boxInertia(spec.massT, spec.env);
	const arm = coupleArm(id);
	const drift = ASSIST_CAP_KMS / ref.assistLateralTauS;
	const attitude = (axis: keyof Angular) =>
		(ref.angularAccel * inertia[axis]) / (arm[axis] * spec.thrustMN);
	return {
		main: 1,
		retro: 0.5,
		strafe: (drift * spec.massT) / (2 * spec.thrustMN),
		pitch: attitude("pitch"),
		yaw: attitude("yaw"),
		roll: attitude("roll"),
	};
}

/** The frame steps the ease-out cost is measured over. */
export const EASE_OUT_STEPS = [1 / 120, 1 / 60, 0.05];

/**
 * How much longer a released turn takes to fall from the peak rate to 5% of
 * it on the vents than under #5's unbounded ease-out: the stop-time ratio
 * minus one, by axis, the worst over `EASE_OUT_STEPS`.
 */
export function easeOutCost(id: HullId): Angular {
	const perf = flightPerformance(id);
	const still: Angular = { pitch: 0, yaw: 0, roll: 0 };
	const cost = { ...still };
	for (const axis of ["pitch", "yaw", "roll"] as const)
		for (const dt of EASE_OUT_STEPS) {
			const stop = (step: (r: Angular) => Angular) => {
				let rates = { ...still, [axis]: perf.angularMax[axis] };
				let t = 0;
				while (Math.abs(rates[axis]) > 0.05 * perf.angularMax[axis]) {
					rates = step(rates);
					t += dt;
				}
				return t;
			};
			const vents = stop(
				(r) => stepAngular(r, still, still, true, dt, perf).rates,
			);
			const legacy = stop((r) =>
				legacyAngular(r, still, still, true, dt, {
					...perf,
					angularAccel: perf.angularAuthority[axis],
				}),
			);
			cost[axis] = Math.max(cost[axis], vents / legacy - 1);
		}
	return cost;
}

/** Six significant figures: what `src/hull.ts` stores. */
export const roundShare = (share: number): number =>
	Number(share.toPrecision(6));

if (import.meta.main) {
	const rows = HULL_IDS.map((id) => {
		const solved = solveVentShares(id);
		const stored = HULL_SPECS[id].ventShares;
		const drift = (Object.keys(solved) as (keyof VentShares)[]).filter(
			(k) => roundShare(solved[k]) !== stored[k],
		);
		return {
			id,
			strafe: roundShare(solved.strafe),
			pitch: roundShare(solved.pitch),
			yaw: roundShare(solved.yaw),
			roll: roundShare(solved.roll),
			"hull.ts": drift.length === 0 ? "matches" : `re-solve ${drift.join(",")}`,
		};
	});
	console.table(rows);
	console.log("\nease-out: how much longer a released turn takes to stop");
	console.table(
		HULL_IDS.map((id) => {
			const cost = easeOutCost(id);
			const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
			return {
				id,
				pitch: pct(cost.pitch),
				yaw: pct(cost.yaw),
				roll: pct(cost.roll),
			};
		}),
	);
	console.log("\nrows for src/hull.ts:");
	for (const id of HULL_IDS) {
		const s = solveVentShares(id);
		console.log(
			`${id}: ventShares: { main: ${s.main}, retro: ${s.retro}, strafe: ${roundShare(s.strafe)}, pitch: ${roundShare(s.pitch)}, yaw: ${roundShare(s.yaw)}, roll: ${roundShare(s.roll)} },`,
		);
	}
}
