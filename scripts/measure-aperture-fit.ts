/**
 * The aperture as a physical fit: how far off the axis a hull can point and
 * still reach the plane without meeting the station (`collision.md` §2.3,
 * §9.1.9, §11 joint 2).
 *
 * P1 makes a ship meet a station on its hull box, so a wing that touches the
 * slot's rim before the ship's centre crosses the plane is an impact, not an
 * entry. `tests/aperture-fit.test.ts` measured a hull with its nose on the axis;
 * a hull pitched against the axis is wider in the slot's short dimension, and
 * whether a long hull can still use check 2's full 35° was not measured when P1
 * was chosen. **This table goes to the principal to judge** — whether a hull's
 * margin is the intended skill tax or a reason to revisit P1 — so it prints and
 * asserts nothing; `tests/collision-stations.test.ts` asserts the 0° half.
 *
 * For every role and every hull its berths admit: the largest pitch and the
 * largest yaw, each in both signs, at which a centred entry clears the selected
 * form's proxy, at roll 0 and at check 4's 50° limit. A centred entry, the
 * attitude composition and the clearance test are
 * `tests/helpers/aperture-physical-fit.ts`'s, so the table and the test measure
 * the same thing. `≥35` means the hull clears at check 2's limit, past which the
 * plane refuses it whatever it fits.
 *
 *   bun scripts/measure-aperture-fit.ts [stepDeg]
 *     stepDeg  the scan's resolution, degrees (default 0.5)
 */

import { AXIS_TOLERANCE_DEG, ROLL_TOLERANCE_DEG } from "../src/docking";
import { DOCKABLE_HULL_IDS, HULL_SPECS } from "../src/hull";
import { STATION_GEOMETRY, STATION_TYPES } from "../src/station";
import { berthFits, stationInterior } from "../src/station-interior";
import { padWellDepthKm } from "../src/station-proxy";
import { largestClearAngleDeg } from "../tests/helpers/aperture-physical-fit";

const stepDeg = Number(process.argv[2] ?? 0.5);
if (!(stepDeg > 0 && stepDeg <= 5))
	throw new Error(`unusable step ${process.argv[2]}`);

/** Every printed figure goes through this (#7): an angle that came back as
 *  something other than a number or "none" is a broken instrument. */
function cell(deg: number | null): string {
	if (deg === null) return "none";
	if (!Number.isFinite(deg)) throw new Error(`angle is ${deg}`);
	return deg >= AXIS_TOLERANCE_DEG ? `≥${AXIS_TOLERANCE_DEG}` : deg.toFixed(1);
}

console.log(
	`aperture physical fit: largest clear angle, both signs, ${stepDeg}° steps; ` +
		`check 2 refuses past ${AXIS_TOLERANCE_DEG}°, check 4 past ${ROLL_TOLERANCE_DEG}° of roll`,
);
console.log(
	`${"role".padEnd(9)}${"hull".padEnd(12)}${"pitch r0".padStart(9)}${"yaw r0".padStart(8)}` +
		`${"pitch r50".padStart(10)}${"yaw r50".padStart(9)}`,
);
for (const type of STATION_TYPES) {
	const g = STATION_GEOMETRY[type];
	const interior = stationInterior(type, g.aperturePlaneKm, 0);
	const note =
		g.aperture.kind === "pad"
			? ` (pad, landing well ${(padWellDepthKm(type) * 1000).toFixed(1)} m)`
			: ` (slot ${g.aperture.widthKm * 1000} × ${g.aperture.heightKm * 1000} m)`;
	console.log(`-- ${type}${note}`);
	for (const hull of DOCKABLE_HULL_IDS) {
		const { env } = HULL_SPECS[hull];
		if (!interior.berths.some((berth) => berthFits(berth, env))) continue;
		const row = [
			largestClearAngleDeg(type, hull, "pitch", 0, AXIS_TOLERANCE_DEG, stepDeg),
			largestClearAngleDeg(type, hull, "yaw", 0, AXIS_TOLERANCE_DEG, stepDeg),
			largestClearAngleDeg(
				type,
				hull,
				"pitch",
				ROLL_TOLERANCE_DEG,
				AXIS_TOLERANCE_DEG,
				stepDeg,
			),
			largestClearAngleDeg(
				type,
				hull,
				"yaw",
				ROLL_TOLERANCE_DEG,
				AXIS_TOLERANCE_DEG,
				stepDeg,
			),
		].map(cell);
		console.log(
			`${type.padEnd(9)}${hull.padEnd(12)}${row[0].padStart(9)}${row[1].padStart(8)}` +
				`${row[2].padStart(10)}${row[3].padStart(9)}`,
		);
	}
}
