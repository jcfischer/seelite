/**
 * What ordinary work pays, against what the same hull earns trading (#411).
 *
 * Two questions, and neither can be answered by reading `jobs.ts`'s payment
 * rules — a fee is a number beside an economy, not on its own:
 *
 * 1. **Is a courier run worth flying?** The fee is read against the best legal
 *    run over the same leg, priced at the **full hold** — which is the trade
 *    the pilot flies when they ignore the board. A consignment is 8–12 t of a
 *    20 t hold, so in practice they can carry both and the fee is a top-up;
 *    the comparison is deliberately the harsher one, because a fee that beats
 *    a whole run is a fee that makes trading the hobby. Under either framing
 *    the same figure is the answer to "what is this worth beside a run".
 * 2. **Can a procurement job be farmed?** Buying a shelf out at a station is
 *    what creates the deficit that posts its own purchase job. So the farm is:
 *    buy here, fly out, come back, sell into the price you raised, and collect
 *    the fee on top. Only the sell/buy spread stands against it, and
 *    `economy-trade.md` §5.5's decay is what closes it.
 *
 * Every figure is computed through `market-math.ts` and `jobs.ts` rather than
 * restated, and a non-finite number throws rather than being printed — an
 * instrument that quietly reports garbage is worse than one that dies, because
 * its numbers get transcribed into a spec (the map's constraint, from #7).
 *
 *   bun run scripts/measure-job-pay.ts [worldCount]
 */

import { recordTrade, readDeficit } from "../src/deficits";
import { generateGalaxy } from "../src/galaxy";
import { HULL_SPECS, PLAYER_BASELINE_HULL } from "../src/hull";
import type { JobOffer } from "../src/jobs";
import {
	boardAt as bindBoard,
	postingStations,
} from "../tests/helpers/job-board";
import {
	COMMODITIES,
	commodity,
	listsCommodity,
	marketRow,
	marketRowAt,
	marketStationOf,
	stockResponse,
} from "../src/market";
import { carrierKey } from "../src/carrier-key";
import { type Station, generateContents } from "../src/system";

/** Only for the record type the helpers below take. */
const SYSTEMS_SHAPE = generateGalaxy(1, 0).systems;

const finite = (label: string, value: number): number => {
	if (!Number.isFinite(value))
		throw new Error(`${label} is not finite: ${value}`);
	return value;
};

const HOLD_T = HULL_SPECS[PLAYER_BASELINE_HULL].holdT;
const worlds = Number(process.argv[2] ?? 6);

const stationsOf = postingStations;

const boardAt = (
	systems: ReturnType<typeof generateGalaxy>["systems"],
	index: number,
	stationId: string,
	deficits = {},
	gameTimeMin = 0,
): JobOffer[] => {
	const record = systems[index];
	const station = stationsOf(record).find((s) => s.id === stationId);
	return station
		? bindBoard(systems, record, station, { deficits, gameTimeMin })
		: [];
};

/**
 * What the same hull earns carrying its own cargo on that leg, at those two
 * stations, on this clock.
 *
 * **Not a sweep over hypothetical economies.** The first version of this
 * instrument priced the leg with `bestResidualBetween` over a fixed set of
 * fluctuation pairs, which answers a different question — the best a leg of
 * that *shape* could ever pay — and it read 7–62 Cr where a real run pays
 * hundreds. A comparison has to offer both arms the same menu: the job is
 * bound at these stations at this minute, so the trade is priced there too.
 */
const bestRunCr = (
	from: { record: (typeof SYSTEMS_SHAPE)[0]; station: Station },
	to: { record: (typeof SYSTEMS_SHAPE)[0]; station: Station },
	gameTimeMin: number,
): number => {
	const buyAt = marketStationOf(from.station, from.record.seed);
	const sellAt = marketStationOf(to.station, to.record.seed);
	let best = 0;
	for (const good of COMMODITIES) {
		if (good.unit !== "t" || good.illegal || good.sellOnly) continue;
		if (!listsCommodity(good, buyAt) || !listsCommodity(good, sellAt)) continue;
		const buy = marketRow(good, from.record.economy, buyAt, gameTimeMin);
		if (buy.quantity === 0) continue;
		const sell = marketRow(good, to.record.economy, sellAt, gameTimeMin);
		const tonnes = Math.min(HOLD_T, buy.quantity);
		best = Math.max(best, (sell.priceCr - buy.priceCr) * tonnes);
	}
	return best;
};

console.log(`# What ordinary work pays · ${worlds} worlds, ${HOLD_T} t hold\n`);

// ── 1. A courier fee against the best legal run over the same leg ────────────
const courierRows: {
	feeCr: number;
	runCr: number;
	ratio: number | null;
	ly: number;
}[] = [];
for (let world = 0; world < worlds; world++) {
	const systems = generateGalaxy(world * 7919 + 1, 0).systems;
	for (let index = 0; index < systems.length; index += 17) {
		for (const station of stationsOf(systems[index])) {
			const courier = boardAt(systems, index, station.id).find(
				(o) => o.family === "courier",
			);
			if (!courier) continue;
			const destinationIndex = Number(
				courier.reportAt.carrierKey.split(":")[0],
			);
			const destination = stationsOf(systems[destinationIndex]);
			if (destination.length === 0) continue;
			const deliveryId = courier.reportAt.carrierKey
				.split(":")
				.slice(1)
				.join(":");
			const deliveryStation = destination.find((s) => s.id === deliveryId);
			if (!deliveryStation) continue;
			const runCr = finite(
				"best legal run",
				bestRunCr(
					{ record: systems[index], station },
					{ record: systems[destinationIndex], station: deliveryStation },
					0,
				),
			);
			const feeCr = finite("courier fee", courier.rewardCr);
			courierRows.push({
				feeCr,
				runCr,
				// A leg with no profitable trade has no ratio to report, and an
				// infinity printed as a percentage is the quiet garbage the
				// guard above exists to refuse. It is carried as `null` and the
				// row is counted separately.
				ratio: runCr > 0 ? finite("fee/run ratio", feeCr / runCr) : null,
				ly: courier.distanceLy,
			});
		}
	}
}
if (courierRows.length === 0)
	throw new Error("no courier legs measured — the sweep found no board");
const noTrade = courierRows.filter((r) => r.ratio === null).length;
const priced = courierRows.filter(
	(r): r is (typeof courierRows)[0] & { ratio: number } => r.ratio !== null,
);
priced.sort((a, b) => a.ratio - b.ratio);
const runs = [...priced.map((r) => r.runCr)].sort((a, b) => a - b);
const quantile = <T>(rows: T[], q: number): T =>
	rows[Math.min(rows.length - 1, Math.floor(rows.length * q))];
console.log("## 1. Courier fee against the best legal run on the same leg\n");
console.log(
	`rows: ${courierRows.length} · ${noTrade} with no profitable trade on the leg`,
);
// **The run column beside a quantile is that leg's run, not the median run.**
// The rows are ordered by the fee/run ratio, so the row printed at the median
// is the median-*ratio* leg. The run distribution is printed separately rather
// than read off a differently-ordered column.
console.log(
	`runs alone: p10 ${runs[Math.floor(runs.length * 0.1)].toFixed(0)} Cr · median ${runs[
		Math.floor(runs.length * 0.5)
	].toFixed(0)} Cr · p90 ${runs[Math.floor(runs.length * 0.9)].toFixed(0)} Cr`,
);
for (const [label, q] of [
	["p10", 0.1],
	["median", 0.5],
	["p90", 0.9],
] as const) {
	const row = quantile(priced, q);
	console.log(
		`${label.padEnd(7)} fee ${row.feeCr.toFixed(0).padStart(5)} Cr · run ${row.runCr
			.toFixed(0)
			.padStart(
				5,
			)} Cr · ${(row.ratio * 100).toFixed(1)}% of a run · ${row.ly.toFixed(1)} LY`,
	);
}

// ── 2. The procurement farm ─────────────────────────────────────────────────
//
// Fly it rather than argue it: buy a hold of one good at a station, let its
// own purchasing office post the shortfall job, and price what comes back.
console.log("\n## 2. The procurement farm, flown\n");
const farmRows: {
	good: string;
	costCr: number;
	feeCr: number;
	tonnes: number;
	netCr: number;
	deliverCr: number;
	sellCr: number;
}[] = [];
for (let world = 0; world < worlds; world++) {
	const systems = generateGalaxy(world * 7919 + 1, 0).systems;
	for (let index = 0; index < systems.length; index += 29) {
		for (const station of stationsOf(systems[index])) {
			const key = carrierKey(index, station.localCarrierId);
			const market = marketStationOf(station, systems[index].seed);
			const good = commodity("Food");
			const base = marketRowAt(
				good,
				systems[index].economy,
				0,
				market.type,
			).priceCr;
			if (base <= 0) continue;
			// The pilot buys a hold at the live price, which raises it as they go;
			// the figure taken here is the pre-mark price, which flatters the farm
			// and is therefore the right side to be wrong on.
			const tonnes = Math.min(HOLD_T, 20);
			const costCr = finite("farm purchase", base * tonnes);
			const deficits = recordTrade({}, key, {
				goodName: good.name,
				units: tonnes,
				gameTimeMin: 0,
				holdT: HOLD_T,
			});
			const offer = boardAt(systems, index, station.id, deficits, 0).find(
				(o) => o.family === "procurement",
			);
			if (!offer) continue;
			// **A tonne is delivered or sold, never both, and the hold that made
			// the deficit is charged.** The first version added the shortfall
			// payment to the proceeds of selling the same tonnes — but
			// `deliver` consumes the cargo — and never charged the purchase at
			// all. Both arms are priced against the **whole** farm now: the
			// pilot bought `tonnes` to make the shortfall, and whichever arm
			// they take, the rest of that hold is still theirs to sell at the
			// raised price.
			const raised = finite(
				"raised price",
				stockResponse(base, readDeficit(deficits, key, good.name, 0), HOLD_T),
			);
			const feeCr = finite("procurement fee", offer.rewardCr);
			// The whole purchase is a cost in both arms: it is what created the
			// shortfall, and it is the farm's opening move.
			const spare = Math.max(0, tonnes - offer.tonnes);
			// Arm A: deliver the job's tonnes for the fee, and sell whatever
			// the purchase left over into the price it raised.
			const deliverCr = finite("deliver arm", feeCr + raised * spare - costCr);
			// Arm B: ignore the job and sell the whole hold at the raised price.
			const sellCr = finite("sell arm", raised * tonnes - costCr);
			const netCr = Math.max(deliverCr, sellCr);
			farmRows.push({
				good: good.name,
				costCr,
				feeCr,
				tonnes: offer.tonnes,
				netCr,
				deliverCr,
				sellCr,
			});
		}
	}
}
farmRows.sort((a, b) => b.netCr - a.netCr);
console.log(`rows: ${farmRows.length}`);
for (const [label, q] of [
	["best", 0],
	["median", 0.5],
	["worst", 0.999],
] as const) {
	const row = quantile(farmRows, q);
	if (!row) continue;
	console.log(
		`${label.padEnd(7)} ${row.tonnes} t ${row.good} · fee ${row.feeCr
			.toFixed(0)
			.padStart(4)} Cr · report ${row.deliverCr
			.toFixed(0)
			.padStart(5)} Cr · sell instead ${row.sellCr
			.toFixed(0)
			.padStart(5)} Cr · best ${row.netCr.toFixed(0).padStart(5)} Cr`,
	);
}
console.log(
	"\nEach row prices the whole farm from one purchase: buy the hold that makes",
	"\nthe shortfall, then either report the job and sell the remainder, or",
	"\nignore the job and sell the lot into the price the purchase raised. The",
	"\npurchase is charged in both arms and a tonne is never counted twice. Read",
	"\nthe best of the two against §5.5's decay — the mark fades on a 20-minute",
	"\nhalf-life, so a farmed loop pays this once and less each time after — and",
	"\nagainst section 1's run figures, which is what the same hull earns simply",
	"\ntrading.",
);
