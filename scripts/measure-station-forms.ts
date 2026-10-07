/**
 * Which form each station is built in, under the shipped pools or a proposed
 * one (node #717) — and so which canonical views a pool edit moves.
 *
 * Node #717's third question: the view set stands on fixed seeds, so once a
 * pool holds two forms a view's station may be drawn in another form, and the
 * before/after pair then differs by design. This prints, per view that frames
 * a named station in a generated system, the form it is built in today and
 * the form it would be built in under the proposed pools, and marks every view
 * that moves. It also prints each form's share of every station of its role
 * across the eight galaxies of the view set's world, so a pool's weighting is
 * read off a count rather than assumed.
 *
 *   bun scripts/measure-station-forms.ts [role=ids ...]
 *     e.g. trade=a,d,e shipyard=a,b refinery=d
 *
 * A role not named keeps its shipped pool. The outpost is not drawn
 * (`DrawnStationType`) and cannot be named. **Views it cannot see**: one that
 * names no station, and one on the workbench, which builds the form it names
 * rather than one a system drew — both are listed as such, never skipped
 * silently. A view that frames a station only incidentally (a fly-past) is in
 * the first group; look at it.
 */

import { GALAXY_COUNT, generateGalaxy } from "../src/galaxy";
import { makeWorld } from "../src/sim";
import {
	DRAWN_STATION_TYPES,
	type DrawnStationType,
	STATION_FORM_POOL,
	type StationFormId,
	type StationType,
} from "../src/station";
import { stationForms } from "../src/station-form";
import { STATION_FORMS } from "../src/station-mesh";
import { generateContents } from "../src/system";
import { SEED, VIEWS } from "./lib/view-set.mjs";

type Pools = Record<DrawnStationType, readonly StationFormId[]>;

function proposedPools(args: readonly string[]): Pools {
	const pools: Pools = { ...STATION_FORM_POOL };
	for (const arg of args) {
		const [role, list] = arg.split("=");
		if (!DRAWN_STATION_TYPES.includes(role as DrawnStationType))
			throw new Error(
				`${arg}: role must be one of ${DRAWN_STATION_TYPES.join(", ")}`,
			);
		const ids = (list ?? "").split(",").filter(Boolean);
		if (ids.length === 0) throw new Error(`${arg}: a pool cannot be empty`);
		if (new Set(ids).size !== ids.length)
			throw new Error(`${arg}: a form is named twice`);
		for (const id of ids)
			if (!STATION_FORMS[role as DrawnStationType].some((f) => f.id === id))
				throw new Error(`${arg}: ${role} has no form ${id}`);
		pools[role as DrawnStationType] = ids as StationFormId[];
	}
	return pools;
}

const formName = (type: StationType, id: StationFormId): string =>
	`${id} ${STATION_FORMS[type].find((f) => f.id === id)?.name ?? "?"}`;

/** The station type a view's shot frames, or null when it names none: a
 *  `station` by type, or a `body` that is a station's id (`station-trade`). */
function framedType(shot: Record<string, unknown>): StationType | null {
	const body =
		typeof shot.body === "string" && shot.body.startsWith("station-")
			? shot.body
			: undefined;
	const raw = shot.station ?? body;
	if (typeof raw !== "string") return null;
	const type = raw.replace(/^station-/, "");
	if (
		!(["trade", "shipyard", "refinery", "outpost"] as const).includes(
			type as StationType,
		)
	)
		throw new Error(`a view frames an unknown station ${raw}`);
	return type as StationType;
}

const proposed = proposedPools(process.argv.slice(2));
console.log("pools (shipped → proposed):");
for (const type of DRAWN_STATION_TYPES)
	console.log(
		`  ${type.padEnd(9)} [${STATION_FORM_POOL[type].join(", ")}] → [${proposed[type].join(", ")}]`,
	);

console.log("\nviews that frame a generated station:");
let moved = 0;
let framed = 0;
const unseen: string[] = [];
for (const view of VIEWS as readonly {
	name: string;
	shot: Record<string, unknown>;
}[]) {
	const kind = String(view.shot.kind);
	const type = framedType(view.shot);
	if (kind.startsWith("workbench") || type === null) {
		unseen.push(
			`${view.name} (${kind.startsWith("workbench") ? "workbench" : "names no station"})`,
		);
		continue;
	}
	const seed = typeof view.shot.seed === "number" ? view.shot.seed : SEED;
	const world = makeWorld(seed);
	const station = world.system.contents.stations.find((s) => s.type === type);
	if (!station) throw new Error(`${view.name}: seed ${seed} has no ${type}`);
	framed++;
	const now = station.formId;
	const then =
		type === "outpost"
			? now
			: stationForms(world.system.record.seed, proposed)[type];
	const mark = now === then ? " " : "*";
	if (now !== then) moved++;
	console.log(
		`  ${mark} ${view.name.padEnd(28)} seed ${String(seed).padEnd(3)} ${type.padEnd(9)} ${formName(type, now)} → ${formName(type, then)}`,
	);
}
console.log(`  ${moved} of ${framed} move (*)`);
console.log(`\nviews this cannot see (${unseen.length}): ${unseen.join("; ")}`);

console.log(
	`\neach form's share of its role, world seed ${SEED}, all ${GALAXY_COUNT} galaxies, proposed pools:`,
);
const counts = new Map<string, number>();
const totals = new Map<DrawnStationType, number>();
for (let g = 0; g < GALAXY_COUNT; g++)
	for (const record of generateGalaxy(SEED, g).systems) {
		const forms = stationForms(record.seed, proposed);
		for (const station of generateContents(record).stations) {
			if (station.type === "outpost") continue;
			const key = `${station.type}/${forms[station.type]}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
			totals.set(station.type, (totals.get(station.type) ?? 0) + 1);
		}
	}
for (const type of DRAWN_STATION_TYPES) {
	const total = totals.get(type) ?? 0;
	if (total === 0) throw new Error(`no ${type} in ${GALAXY_COUNT} galaxies`);
	const row = proposed[type]
		.map((id) => {
			const n = counts.get(`${type}/${id}`) ?? 0;
			return `${formName(type, id)} ${n} (${((100 * n) / total).toFixed(1)}%)`;
		})
		.join(", ");
	console.log(`  ${type.padEnd(9)} N=${total}: ${row}`);
}
