/**
 * How far outside its collision proxy a seeded station form's drawn vertices
 * stand, over a wide spread of assembly seeds (`collision.md` §2.2, §9.1.11).
 *
 * `tests/station-proxy.test.ts` gates every row on `ASSEMBLY_SEEDS` — twelve
 * plans. A running game builds a station at whatever assembly seed its system
 * draws, so a proxy fitted to those twelve can let a lump of another plan
 * through — and the outpost's Salvage is one envelope over every plan rather
 * than a proxy that follows one (§2.2), so this spread is all that stands
 * behind it past the twelve. This is the hand-run half: it builds every plan
 * in `[start, start + count)` of each seeded form in a pool, **with the berth
 * on each side** (berth seeds 0 and 1: the outpost's seeded berth stands port
 * on an even seed and starboard on an odd one), and prints how many plans
 * stand a vertex past the test's tolerance, and the worst overshoot with the
 * part, plan and side it came from.
 *
 * The vertex walk, the opening and the frame each vertex is held to are the
 * test's own (`tests/helpers/station-proxy-measure.ts`), so the two measure
 * the same thing.
 *
 *   bun scripts/measure-station-proxy.ts [count] [start] [type]
 *     count  plans per form (default 800); start  first assembly seed
 *     (default 0); type  refinery | outpost (default both)
 */

import {
	type StationFormId,
	type StationType,
	formsInPlay,
} from "../src/station";
import { buildStationForm } from "../src/station-mesh";
import { PROXY_VERTEX_TOLERANCE_KM, stationProxy } from "../src/station-proxy";
import { isSeededForm } from "../tests/helpers/solved-forms";
import {
	BERTH_SIDES,
	forEachVertex,
	inOpening,
	openingOf,
	vertexOvershootKm,
} from "../tests/helpers/station-proxy-measure";

const TOLERANCE_KM = PROXY_VERTEX_TOLERANCE_KM;
const SEEDED: readonly StationType[] = ["refinery", "outpost"];

function finite(label: string, value: number): number {
	if (!Number.isFinite(value)) throw new Error(`${label} is ${value}`);
	return value;
}

function sweep(
	type: StationType,
	form: StationFormId,
	start: number,
	count: number,
): void {
	const opening = openingOf(type, form);
	let over = 0;
	let worst = -Infinity;
	let worstAt = "";
	for (let seed = start; seed < start + count; seed++) {
		let planWorst = -Infinity;
		for (const berthSeed of BERTH_SIDES) {
			const proxy = stationProxy(type, form, berthSeed, seed);
			if (!proxy) throw new Error(`${type} ${form} has no proxy`);
			const built = buildStationForm(type, form, 0x9aa6b2, berthSeed, seed);
			forEachVertex(built, type, (vertex) => {
				if (inOpening(opening, vertex.v)) return;
				const d = vertexOvershootKm(proxy, type, vertex);
				planWorst = Math.max(planWorst, d);
				if (d > worst) {
					worst = d;
					worstAt = `${vertex.name} at assembly ${seed}, berth ${berthSeed}`;
				}
			});
		}
		if (finite(`${type} seed ${seed}`, planWorst) > TOLERANCE_KM) over++;
	}
	console.log(
		`${type} ${form}: assembly ${start}–${start + count - 1}, berth sides ` +
			`${BERTH_SIDES.join(", ")}, ${over} plans past ${TOLERANCE_KM * 1000} m, ` +
			`worst ${(finite(type, worst) * 1000).toFixed(1)} m (${worstAt})`,
	);
}

const count = Number(process.argv[2] ?? 800);
const start = Number(process.argv[3] ?? 0);
const only = process.argv[4];
if (!Number.isInteger(count) || count < 1)
	throw new Error(`count must be a positive integer, got ${process.argv[2]}`);
if (!Number.isInteger(start) || start < 0)
	throw new Error(`start must be a whole number, got ${process.argv[3]}`);
if (only !== undefined && !SEEDED.includes(only as StationType))
	throw new Error(`type must be one of ${SEEDED.join(", ")}, got ${only}`);
// Every seeded form in the role's pool (node #717), and a role with none is a
// fault rather than a silent empty run.
for (const type of SEEDED) {
	if (only !== undefined && only !== type) continue;
	const seeded = formsInPlay(type).filter((form) => isSeededForm(type, form));
	if (seeded.length === 0)
		throw new Error(`${type} has no seeded form in play`);
	for (const form of seeded) sweep(type, form, start, count);
}
