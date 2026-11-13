import { buildSaveSizeWorld, type Tier } from "./lib/save-size-world";
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
import { fieldRocks, systemFields } from "../src/asteroid-field";
import { depositKey } from "../src/deposit-state";
import { generateContents } from "../src/system";
import { advanceTo, capabilityAvailability } from "../src/world-state";
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
	const { world, carriers, witnesses, charges } = buildSaveSizeWorld(tier);
	fill?.(world);
	const t0 = performance.now();
	const json = JSON.stringify(serializeWorld(world));
	const t1 = performance.now();
	const loaded = parseWorld(JSON.parse(json));
	const t2 = performance.now();
	for (let g = 0; g < GALAXY_COUNT; g++) {
		const written = Object.keys(world.galaxies[g].deposits.rows).length;
		const restored = Object.keys(loaded.galaxies[g].deposits.rows).length;
		if (written !== restored)
			throw new Error(
				`galaxy ${g}: ${written} live deposit rows became ${restored} in the save round trip`,
			);
	}
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

const rows = TIERS.map((tier) =>
	build({
		...tier,
		name: tier.name.replace("every carrier", "every ordinary carrier"),
	}),
);
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

// #951 D6, production generator and real save round trips. These stress fills
// are snapshots, not a claim that a pilot can touch every rock before recovery.
// The live bound is extraction rate / recovery rate debit rows plus survey
// rate × survey lifetime reading rows; galaxy size is not a term.
const depositFields = Array.from({ length: GALAXY_COUNT }, (_, g) =>
	generateGalaxy(SEED, g).systems.flatMap((record) =>
		systemFields(record, generateContents(record)).map((field) => ({
			system: record.index,
			id: field.id,
			slots: fieldRocks(record, field).map((rock) => rock.slot),
		})),
	),
);
const DEPOSIT_TONNES = 99_999;
const DEPOSIT_TIME = 315_576_000.1234567;
function priceDeposits(
	base: string,
	galaxies: number,
	fields: number,
	debit: boolean,
	label: string,
) {
	const tier = TIERS.find((t) => t.name.startsWith(base));
	if (!tier) throw new Error(`deposit fill: no tier ${base}`);
	const bare = build(tier, (w) => {
		w.gameTime = DEPOSIT_TIME;
	});
	let rockCount = 0;
	let fieldCount = 0;
	let rowBytes = 0;
	const full = build(tier, (world) => {
		world.gameTime = DEPOSIT_TIME;
		for (let g = 0; g < galaxies; g++) {
			let rocksHere = 0;
			const rows = world.galaxies[g].deposits.rows;
			for (const field of depositFields[g].slice(0, fields)) {
				fieldCount++;
				for (const slot of field.slots) {
					rows[depositKey(field.system, field.id, slot)] = {
						...(debit
							? {
									surface: DEPOSIT_TONNES,
									deep: DEPOSIT_TONNES,
									at: DEPOSIT_TIME,
								}
							: {}),
						surveyedAt: DEPOSIT_TIME,
					};
					rocksHere++;
				}
			}
			if (Object.keys(rows).length !== rocksHere)
				throw new Error(
					`galaxy ${g}: ${rocksHere} rocks but ${Object.keys(rows).length} rows — colliding deposit keys`,
				);
			rockCount += rocksHere;
			// Include each keyed row and its separator, as in D6's row price.
			// Version/pin metadata is reported separately, and included in +KiB.
			rowBytes += (JSON.stringify(rows).length - 1) * 2;
		}
	});
	if (!rockCount) throw new Error(`${label}: no deposit rows measured`);
	const added = finite(`${label} added bytes`, (full.bytes - bare.bytes) * 2);
	const perRow = finite(`${label} bytes per row`, added / rockCount);
	const payloadPerRow = finite(
		`${label} row payload bytes`,
		rowBytes / rockCount,
	);
	const metadata = finite(`${label} metadata bytes`, added - rowBytes);
	console.log(
		`| ${label} | ${base} | ${fieldCount} | ${rockCount} | ${rockCount} | ${(added / 1024).toFixed(1)} | ${payloadPerRow.toFixed(1)} | ${(metadata / 1024).toFixed(1)} | ${perRow.toFixed(1)} | ${full.kibUtf16} | ${full.writeMs} | ${full.readMs} |`,
	);
}
console.log(
	"\nDeposit domain (#951 D6), UTF-16 bytes including per-field identity pins; full-precision clock at ten game-years, five-digit tonnes.",
);
console.log(
	"| Line | On | Fields | Rocks | Rows | +KiB UTF-16 | Row B | Metadata KiB | Total B/row | Save KiB UTF-16 | write ms | read ms |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
priceDeposits(
	"T1",
	GALAXY_COUNT,
	Infinity,
	true,
	"C1 ceiling: every rock debited, survey on row",
);
priceDeposits(
	"T1",
	GALAXY_COUNT,
	Infinity,
	false,
	"R1 residue: debits recovered, survey on row",
);
priceDeposits(
	"T5",
	1,
	20,
	true,
	"P1 heavy play: 20 fields worked, survey on row",
);
priceDeposits("T6", 1, 3, true, "P3 typical: 3 fields worked, survey on row");

import { capabilitySaveCase } from "./lib/capability-save-case";
export { capabilitySaveCase } from "./lib/capability-save-case";
console.log(
	"\nCapability timing: actual generated carriers, all eight galaxies, real complete-envelope round trips. Ordinary-domain saturation tables above omit capability observations/repairs but retain timing anchors required by their real raider causal rows; the following rows measure timing alone with other domains untouched and include every current envelope field. No production refinery queue or custody footprint is claimed; capabilitySaveCase accepts a complete-envelope payload hook for independently measured additional domains.",
);
for (const seed of [1, 47, 0x5ee11e])
	for (const coverage of ["untouched", "partly", "all"] as const) {
		const row = capabilitySaveCase(seed, coverage);
		for (const [key, value] of Object.entries(row))
			if (typeof value === "number") finite(key, value);
		console.log(JSON.stringify(row));
	}
