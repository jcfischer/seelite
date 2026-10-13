/**
 * Worst-case save size, measured rather than guessed (#89, shipped by #90).
 *
 * Enumerates every generated carrier — stations, #148's Traffic roster, and
 * the system slots (#324's raiders, #351's relay and tender) —
 * through the real generator, fills the largest representable row in each of
 * `persistent-world-state.md` §9.8's three per-carrier domains, and reports the
 * serialized size and the cost of one round trip.
 *
 * **T1 is a ceiling, not a save.** A Traffic actor's hull, callsign, schedule
 * and berth are `f(station, berthSeed)` and re-derive on system entry; a row
 * exists only where the player changed something. So T1 is the state of someone
 * who has personally destroyed all 21,570 Traffic ships in all eight galaxies,
 * and **T5 and T6 are what play actually writes**. The first framing of #89's
 * evidence presented T1 as a storage requirement and the principal rejected the
 * reading; the tier names say which is which so the next reader cannot repeat
 * it.
 *
 * **The timings are not a browser's.** They are `serializeWorld` +
 * `JSON.stringify` and `parseWorld` + `JSON.parse` under bun. No IndexedDB
 * transaction is in them, and they price no part of a hitch a player would
 * feel — `scripts/probe-save.mjs` is what does that.
 *
 * The figures are **not restated in prose anywhere**. This script is their one
 * owner, so a run reprints them rather than a reader trusting a table that has
 * had a chance to go stale.
 *
 * ```
 * npx tsx scripts/measure-save-size.ts     # or: bun scripts/measure-save-size.ts
 * ```
 */

import { carrierKey } from "../src/carrier-key";
import { enumerateCarriers, GALAXY_COUNT } from "../src/world-state";
import { generateGalaxy } from "../src/galaxy";
import { COMMODITIES } from "../src/market";
import {
	type GalaxyEnvelope,
	newWorld,
	parseWorld,
	serializeWorld,
	type WorldState,
} from "../src/world-state";

const SEED = 1;
const GOODS = COMMODITIES.map((c) => c.name);

interface Tier {
	name: string;
	systems: number;
	galaxies: number;
	/** Every carrier, not only the stations: the Traffic roster and the system's
	 *  own slots (raiders, the relay and its tender). */
	everyCarrier: boolean;
	knowledge: boolean;
	objective: boolean;
	deficitGoods: number;
	/**
	 * Whether this tier holds the **witness bound** (H6): every station in the
	 * galaxy listed as having seen an offence.
	 *
	 * That is the list's entire possible size — it holds each station once per
	 * galaxy, so nothing a pilot does can lengthen it past that. The saturated
	 * tiers carry it because they are ceilings. The play tiers carry none, and
	 * that is not an omission: `canonicalEnvelope` drops an empty list, so a
	 * pilot who has not offended beside a station pays **nothing** for the member
	 * existing. `witnessCost` below is what prices the difference.
	 */
	witnesses: boolean;
	/**
	 * Whether this tier holds the **charge bound** (#396): every ordinary
	 * carrier in the galaxy listed as already charged with sustained fire.
	 *
	 * The sibling of `witnesses` above, and it needs saying because the two
	 * bounds are not the same size. A galaxy's berths are few; its Traffic is a
	 * roster per berth, so the charge list's ceiling is an order of magnitude
	 * longer than H6's. What keeps it off an ordinary pilot's save is the same
	 * thing that keeps the witness list off one — `canonicalEnvelope` omits an
	 * empty list — and `chargeCost` below prices the saturated case.
	 */
	charges: boolean;
}

const TIERS: Tier[] = [
	{
		name: "T1 saturated: every carrier incl. Traffic, all 8 galaxies",
		systems: 256,
		galaxies: 8,
		everyCarrier: true,
		knowledge: true,
		objective: true,
		deficitGoods: 17,
		witnesses: true,
		charges: true,
	},
	{
		name: "T2 stations only, all 8 galaxies saturated",
		systems: 256,
		galaxies: 8,
		everyCarrier: false,
		knowledge: true,
		objective: true,
		deficitGoods: 17,
		witnesses: true,
		charges: false,
	},
	{
		name: "T3 one galaxy saturated incl. Traffic",
		systems: 256,
		galaxies: 1,
		everyCarrier: true,
		knowledge: true,
		objective: true,
		deficitGoods: 17,
		witnesses: true,
		charges: true,
	},
	{
		name: "T4 one galaxy, stations only, saturated",
		systems: 256,
		galaxies: 1,
		everyCarrier: false,
		knowledge: true,
		objective: true,
		deficitGoods: 17,
		witnesses: true,
		charges: false,
	},
	{
		name: "T5 heavy play: 200 systems, stations, knowledge+deficits",
		systems: 200,
		galaxies: 1,
		everyCarrier: false,
		knowledge: true,
		objective: false,
		deficitGoods: 6,
		witnesses: false,
		charges: false,
	},
	{
		name: "T6 typical: 50 systems, stations, knowledge+deficits",
		systems: 50,
		galaxies: 1,
		everyCarrier: false,
		knowledge: true,
		objective: false,
		deficitGoods: 4,
		witnesses: false,
		charges: false,
	},
];

/** Every figure below goes through this. An instrument that quietly reports
 *  garbage is worse than one that dies, because its numbers get transcribed
 *  into a spec (the map's constraint, from #7). */
const finite = (what: string, value: number): number => {
	if (!Number.isFinite(value)) throw new Error(`${what} is ${value}`);
	return value;
};

interface Row {
	name: string;
	carriers: number;
	bytes: number;
	witnesses: number;
	charges: number;
	kibUtf16: number;
	kibUtf8: number;
	writeMs: number;
	readMs: number;
}

function build(tier: Tier, fill?: (world: WorldState) => void): Row {
	const world: WorldState = newWorld(SEED);
	let carriers = 0;
	let witnesses = 0;
	let charges = 0;
	for (let g = 0; g < tier.galaxies && g < GALAXY_COUNT; g++) {
		const galaxy = generateGalaxy(SEED, g);
		const env: GalaxyEnvelope = world.galaxies[g];
		const records = galaxy.systems.slice(0, tier.systems);
		let inGalaxy = 0;
		env.visited = records.map((_, i) => i);
		// Every berth in the galaxy, for the witness bound. Traffic carriers are
		// not in it: H6 lists the *station* an offence happened beside.
		const berths: ReturnType<typeof carrierKey>[] = [];
		// Every Traffic carrier in the galaxy, for #396's charge bound. The
		// berths above are not in it: a sustained-fire charge is filed against
		// the ship, not the station.
		const flown: ReturnType<typeof carrierKey>[] = [];
		// Every carrier the generator enumerates, so a kind added there reaches this
		// ceiling without a copy here: the raiders were missing from it between
		// #324 and #351 because this loop listed kinds by hand.
		const keys: ReturnType<typeof carrierKey>[] = [];
		for (const c of enumerateCarriers(SEED, g)) {
			if (c.systemIndex >= tier.systems) continue;
			if (c.kind === "station") berths.push(c.key);
			else if (!tier.everyCarrier) continue;
			else if (c.kind === "traffic") flown.push(c.key);
			keys.push(c.key);
		}
		for (const key of keys) {
			carriers++;
			inGalaxy++;
			if (tier.objective) {
				env.objective[key] = {
					instanceOrdinal: 3,
					condition: "repairing",
					recovery: {
						kind: "replacement",
						processId: `${key}#e7#replacement`,
						consequenceArea: "station-services",
						startedAt: 123456.789,
						completesAt: 234567.891,
						initiatedBy: {
							causeKind: "player-attack",
							actorId: "player",
							playerRole: "direct",
						},
					},
				};
				const fact = (kind: "destroy" | "replacement-start" | "interrupt") =>
					({
						key,
						instanceOrdinal: 3,
						episodeOrdinal: 7,
						kind,
						occurredAt: 123456.789,
						cause: {
							causeKind: "player-attack",
							actorId: "player",
							playerRole: "direct",
						},
						processId: `${key}#e7#replacement`,
					}) as const;
				env.episodes[key] = {
					ordinal: 7,
					initiating: fact("destroy"),
					intervention: fact("replacement-start"),
					latest: fact("interrupt"),
					closed: false,
				};
			}
			if (tier.knowledge)
				env.knowledge[key] = {
					observedInstanceOrdinal: 1,
					observedCondition: "operational",
					observedAt: 123456.789,
					source: "system-relay",
					knownPrivateFacts: {
						blackMarket: { learnedAt: 123456.789, source: "docking" },
					},
				};
			if (tier.deficitGoods > 0) {
				const goods: Record<string, number> = {};
				for (const name of GOODS.slice(0, tier.deficitGoods))
					goods[name] = -63.4;
				env.deficits[key] = { goods, updatedAt: 123456.789 };
			}
		}
		// **Keys must be distinct per carrier**, or the counter and the store
		// disagree and every size below is understated. `parseWorld` cannot see
		// this: a colliding key is a perfectly well-formed row that happens to
		// have overwritten another.
		const check = (domain: string, count: number) => {
			if (count !== inGalaxy)
				throw new Error(
					`galaxy ${g}: ${inGalaxy} carriers but ${count} ${domain} rows — colliding keys`,
				);
		};
		if (tier.objective) check("objective", Object.keys(env.objective).length);
		if (tier.knowledge) check("knowledge", Object.keys(env.knowledge).length);
		if (tier.deficitGoods > 0)
			check("deficit", Object.keys(env.deficits).length);
		if (tier.charges && new Set(flown).size !== flown.length)
			throw new Error(`galaxy ${g}: ${flown.length} carriers collide`);
		if (tier.witnesses || tier.charges) {
			env.legalStatus = {
				heat: 100,
				updatedAt: 123456.789,
				witnesses: [],
				assaulted: [],
			};
		}
		if (tier.witnesses) {
			// The same collision check the domains get: a repeated berth would
			// understate the ceiling, and `parseWorld` refuses a duplicate — so a
			// silent one here would take the whole run down far from its cause.
			if (new Set(berths).size !== berths.length)
				throw new Error(`galaxy ${g}: ${berths.length} berths collide`);
			env.legalStatus.witnesses = berths;
			witnesses += berths.length;
		}
		if (tier.charges) {
			// The same ceiling the witness list gets, on the list #396 added.
			env.legalStatus.assaulted = flown;
			charges += flown.length;
		}
	}
	fill?.(world);
	const t0 = performance.now();
	const json = JSON.stringify(serializeWorld(world));
	const t1 = performance.now();
	parseWorld(JSON.parse(json));
	const t2 = performance.now();
	return {
		name: tier.name,
		carriers: finite("carriers", carriers),
		bytes: finite("bytes", json.length),
		witnesses: finite("witnesses", witnesses),
		charges: finite("charges", charges),
		kibUtf16: finite("kibUtf16", Math.round((json.length * 2) / 1024)),
		kibUtf8: finite(
			"kibUtf8",
			Math.round(new TextEncoder().encode(json).length / 1024),
		),
		writeMs: finite("writeMs", Number((t1 - t0).toFixed(1))),
		readMs: finite("readMs", Number((t2 - t1).toFixed(1))),
	};
}

const rows = TIERS.map((t) => build(t));
console.log(
	"| Tier | Carriers | Witnessed | Charged | KiB UTF-16 | KiB UTF-8 | write ms | read ms |",
);
console.log("|---|---|---|---|---|---|---|---|");
for (const row of rows)
	console.log(
		`| ${row.name} | ${row.carriers} | ${row.witnesses} | ${row.charges} | ${row.kibUtf16} | ${row.kibUtf8} | ${row.writeMs} | ${row.readMs} |`,
	);

/**
 * Price one of the law's saved lists **by difference**: build one tier twice,
 * once with the list switched off and once saturated, and the bytes between the
 * two builds are the list's whole cost. Nothing about an entry's size is asserted
 * here, which is the point — the alternative is a paragraph claiming a figure
 * with no way for a later reader to check it.
 *
 * The tier is named by its prefix so the caller has to say *which* bound it is
 * quoting: one galaxy's berths, one galaxy's Traffic, or every galaxy in the
 * save. Those are three different ceilings, and conflating two of them is the
 * mistake this version exists to stop.
 *
 * **The list is named once** (`list`), as both the flag that turns it off in the
 * comparison arm and the column that counts what the priced arm holds. It was
 * two parameters holding the same string, which is a function that lets a
 * caller price the witness list by subtracting the charge list from it.
 *
 * **Each line builds its tier twice, and that is the price of the difference.**
 * A memo over the bare arm was tried and is inert — every line prices a
 * different tier, so no key ever repeated — and the arm cannot be derived from
 * the priced row by subtraction, because then the number being measured would be
 * the thing being measured. The full script is two seconds and belongs to no
 * probe lane; the tier being built twice here has never been what made a suite
 * red.
 */
const priceList = (
	tier: string,
	list: "witnesses" | "charges",
	noun: string,
	headline: string,
) => {
	// **Throw, do not skip.** This script's printed lines are the evidence H6 and
	// #396 cite for both bounds, and a tier renamed out from under one of these
	// calls would print nothing at all — a missing line reads exactly like a bound
	// nobody claimed, which is the failure mode with no signal in it.
	const at = TIERS.findIndex((t) => t.name.startsWith(tier));
	if (at < 0)
		throw new Error(`measure-save-size: no tier starts with "${tier}"`);
	const full = rows[at];
	const bare = build({ ...TIERS[at], [list]: false });
	const added = full.bytes - bare.bytes;
	const held = full[list];
	console.log(
		`\n${headline}: ${held} ${noun}s add ${added} UTF-16 code units ` +
			`(${added * 2} bytes) on top of the same tier's ${bare.bytes} — ` +
			`${((added * 2) / held).toFixed(1)} bytes per ${noun} held, ` +
			`and ${((added * 2) / 1024).toFixed(1)} KiB at this bound.`,
	);
};

// **What the witness list costs (H6's bound), priced rather than asserted.** H6
// claims the list is bounded and that an empty one is free; the first half is the
// `Witnessed` column and this is the second. T4 is the one-galaxy tier, so the
// list here is at exactly the bound H6 states: every berth in one galaxy.
priceList(
	"T4",
	"witnesses",
	"berth",
	"Witness list at H6's bound (T4, one galaxy, every berth)",
);
console.log(
	"An unwitnessed row adds nothing: `canonicalEnvelope` omits an empty list, " +
		"which is also what keeps a save taken before #366 hashing to what it was written with.",
);

// **What the sustained-fire charge list costs (#396), at both of its bounds.**
// H6's bound is a galaxy's berths and this list's bound is a galaxy's Traffic —
// some five or six times H6's, measured. A pilot's ordinary exposure is a
// handful of carriers inside one Wanted interval, so what matters is the
// ceiling, and `LegalStatus` is per envelope: the **save's** ceiling is the tier
// with every galaxy saturated, not the one-galaxy tier. One version of this
// block printed a one-galaxy figure and called it "the whole bound", which is
// why both lines are printed now and the tiers are named in the headline.
priceList(
	"T3",
	"charges",
	"carrier",
	"Charge list at one galaxy's bound (T3, every Traffic carrier in it)",
);
priceList(
	"T1",
	"charges",
	"carrier",
	"Charge list at the whole save's ceiling (T1, every carrier in all 8 galaxies)",
);
console.log(
	"An uncharged row adds nothing, for the same reason the witness list costs " +
		"nothing when empty: the member is omitted, not written as an empty list.",
);

// ---------------------------------------------------------------------------
// SPIKE #951: the asteroid deposit domain under O3 (depletion recovers on the
// game clock). Rocks come from #948's generator at this script's SEED, every
// galaxy. Each line is priced by difference against the same base tier, and
// every fill asserts per galaxy that its rows equal the rocks it enumerated.
// ---------------------------------------------------------------------------
const F = await import("../spikes/asteroid-fields-948/field-proto.ts");
const { forEachSystem, ALL_GALAXIES } = await import(
	"../tests/helpers/station-rows.ts"
);
const D = await import("../src/deposit-state.ts");

interface FieldRocks {
	system: number;
	fieldId: string;
	cells: number;
	slots: number[];
}
const fieldsByGalaxy: FieldRocks[][] = ALL_GALAXIES.map(() => []);
forEachSystem(SEED, ALL_GALAXIES, (record: any, c: any, g: number) => {
	for (const plan of [F.chartedField(record, c), F.rareField(record, c)]) {
		if (!plan) continue;
		fieldsByGalaxy[g].push({
			system: record.index,
			fieldId: plan.id,
			cells: F.cells(F.PROFILE[plan.profile]).length,
			slots: F.rocks(record, plan).map((r: any) => r.slot),
		});
	}
});
const systemIndexOk = fieldsByGalaxy.every((fs) =>
	fs.every((f) => Number.isInteger(f.system) && f.system < 256),
);
if (!systemIndexOk) throw new Error("deposit fill: a system index is not 0..255");

/** Widest values a row can carry: five-digit tonnes (a calibration placeholder)
 *  and a full-precision clock ten game-years in. */
const TONNES = 99_999;
const T = 315_576_000.1234567;

type Fill = { debit: boolean; survey: "row" | "bitmap" | "none"; fields: number; galaxies: number };
const fill =
	(f: Fill, count: { rows: number; rocks: number; fields: number }) =>
	(world: WorldState) => {
		for (let g = 0; g < f.galaxies; g++) {
			const d = world.galaxies[g].deposits;
			let rocksHere = 0;
			for (const field of fieldsByGalaxy[g].slice(0, f.fields)) {
				count.fields++;
				rocksHere += field.slots.length;
				for (const slot of field.slots) {
					const row: Record<string, number> = {};
					if (f.debit) Object.assign(row, { surface: TONNES, deep: TONNES, at: T });
					if (f.survey === "row") row.surveyedAt = T;
					if (Object.keys(row).length)
						d.rows[D.depositKey(field.system, field.fieldId, slot)] = row;
				}
				if (f.survey === "bitmap")
					d.surveyed[D.fieldKey(field.system, field.fieldId)] = D.surveyBitmap(
						field.cells,
						field.slots,
					);
			}
			const rows = Object.keys(d.rows).length;
			const expect = f.debit || f.survey === "row" ? rocksHere : 0;
			if (rows !== expect)
				throw new Error(`galaxy ${g}: ${rocksHere} rocks but ${rows} deposit rows — colliding keys`);
			count.rows += rows;
			count.rocks += rocksHere;
		}
	};

const priceDeposits = (base: string, f: Fill, label: string) => {
	const at = TIERS.findIndex((t) => t.name.startsWith(base));
	if (at < 0) throw new Error(`no tier starts with "${base}"`);
	const count = { rows: 0, rocks: 0, fields: 0 };
	const full = build(TIERS[at], fill(f, count));
	const bare = rows[at];
	const added = (full.bytes - bare.bytes) * 2;
	console.log(
		`| ${label} | ${base} | ${count.fields} | ${count.rocks} | ${count.rows} | ` +
			`${(added / 1024).toFixed(1)} | ${(added / Math.max(1, count.rocks)).toFixed(1)} | ` +
			`${full.kibUtf16} | ${full.writeMs} | ${full.readMs} |`,
	);
};

const allFields = 1e9;
console.log(
	`\nDeposit domain (#951 spike, O3). Rocks at SEED ${SEED}: ` +
		fieldsByGalaxy.map((fs, g) => `g${g} ${fs.reduce((n, f) => n + f.slots.length, 0)}`).join(", "),
);
console.log(
	"| Line | On | Fields | Rocks | Rows | +KiB UTF-16 | B/rock | Save KiB UTF-16 | write ms | read ms |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|");
priceDeposits("T1", { debit: true, survey: "row", fields: allFields, galaxies: 8 }, "C1 ceiling: every rock debited, survey on row");
priceDeposits("T1", { debit: true, survey: "bitmap", fields: allFields, galaxies: 8 }, "C2 ceiling: every rock debited, survey bitmap");
priceDeposits("T1", { debit: false, survey: "row", fields: allFields, galaxies: 8 }, "R1 residue: debits recovered, survey on row");
priceDeposits("T1", { debit: false, survey: "bitmap", fields: allFields, galaxies: 8 }, "R2 residue: debits recovered, survey bitmap");
priceDeposits("T5", { debit: true, survey: "row", fields: 20, galaxies: 1 }, "P1 heavy play: 20 fields worked, survey on row");
priceDeposits("T5", { debit: true, survey: "bitmap", fields: 20, galaxies: 1 }, "P2 heavy play: 20 fields worked, survey bitmap");
priceDeposits("T6", { debit: true, survey: "row", fields: 3, galaxies: 1 }, "P3 typical: 3 fields worked, survey on row");
priceDeposits("T6", { debit: true, survey: "bitmap", fields: 3, galaxies: 1 }, "P4 typical: 3 fields worked, survey bitmap");
