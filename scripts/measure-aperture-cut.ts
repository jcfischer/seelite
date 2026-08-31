/**
 * What a docking ship crosses on the way into every station form (#155).
 *
 *   bun run scripts/measure-aperture-cut.ts
 *
 * The instrument behind #155's per-form table. That receipt states its figures
 * as measured, and the map's constraint from #118 says a figure a spec or a
 * receipt states as measured owes a mode in a shipped instrument that reprints
 * it — the alternative is a number nobody can recheck, sitting beside a constant
 * and reading like a result.
 *
 * The measurement is `tests/helpers/aperture-opening.ts`, which is also what
 * `tests/station-mesh.test.ts`'s gate asserts over. One implementation, so this
 * cannot drift into measuring a different thing from the check: a script with
 * its own copy of the arithmetic is how §4's contraband scope came to exist for
 * four review rounds inside an instrument and nowhere in the game (#25).
 *
 * Nothing here asserts — the assert is the test's. What this adds is the *table*:
 * the test stops at the first form with something in its opening, and a table
 * that shows all twelve is what tells you whether a defect is one form's or the
 * whole fleet's. On the build #155 was written against, all twelve were blocked.
 */

import { crossings, bayBand } from "../tests/helpers/aperture-opening";
import { STATION_GEOMETRY, STATION_TYPES } from "../src/station";
import {
	STATION_FORMS,
	SELECTED_FORM,
	buildStationForm,
} from "../src/station-mesh";

/** Any colour: this is a geometry measurement. */
const GREY = 0x9aa6b2;

/**
 * Every figure printed goes through this.
 *
 * An instrument that quietly reports garbage is worse than one that dies,
 * because its numbers get transcribed into a spec — the map's constraint from
 * #7, after `measure-market.ts` printed NaN across every row while the suite
 * stayed green.
 */
function finite(what: string, value: number): number {
	if (!Number.isFinite(value))
		throw new Error(`${what} is not finite: ${value}`);
	return value;
}

let blocked = 0;
let forms = 0;

for (const type of STATION_TYPES) {
	const core = finite(
		`${type} core radius`,
		STATION_GEOMETRY[type].coreRadiusKm,
	);
	for (const form of STATION_FORMS[type]) {
		forms++;
		const { root } = buildStationForm(type, form.id, GREY, 0);
		const band = bayBand(root);
		// The mouth is the bay's front face, in kilometres — read off the drawn
		// bay rather than off `aperturePlaneKm`, because an alternate form cuts
		// its aperture where its own silhouette wants.
		const mouth = finite(`${type} ${form.id} mouth`, band.max.z * core);
		const back = finite(`${type} ${form.id} back wall`, band.min.z * core);
		const found = crossings(root, type);
		if (found.length > 0) blocked++;
		const selected = form.id === SELECTED_FORM[type] ? "*" : " ";
		// **How far a ship can fly down the lane before it meets something.**
		// The bay's own depth is what §13 says it may fly; the first crossing is
		// what the form actually leaves clear. Where the first is larger, the
		// bay is drawn inside the station's own solid.
		const depth = finite(`${type} ${form.id} bay depth`, mouth - back);
		const clear = found.length > 0 ? found[0].pastMouthKm : depth;
		const inside = found
			.map(
				(c) =>
					`${c.name}+${(finite(`${c.name} depth`, c.pastMouthKm) * 1000).toFixed(0)}m/${(finite(`${c.name} coverage`, c.coverage) * 100).toFixed(0)}%`,
			)
			.join(" ");
		console.log(
			`${type.padEnd(9)}${form.id}${selected} bay=${(depth * 1000).toFixed(0)}m lane clear to ${(clear * 1000).toFixed(0)}m  ${inside || "clear"}`,
		);
	}
}

console.log(
	`\n${blocked} of ${forms} forms have something other than the bay inside the opening.`,
);
console.log("* is the form the game selects for that role.");
