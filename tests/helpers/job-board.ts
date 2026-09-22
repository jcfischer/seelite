/**
 * One way to bind a board (#411).
 *
 * The `bindJobs` call — a station, its delivery candidates, the deficits and
 * the clock — was written out in `tests/jobs.test.ts`, `tests/requests.test.ts`,
 * `tests/requests-save.test.ts` and `scripts/measure-job-pay.ts`, so a change
 * to `BindContext` cost four edits and three of the copies could drift into
 * binding a different board than the one under test. It lives here, and the
 * instrument imports it too — the same reason `market-math.ts` exists.
 */
import { type CarrierKey, carrierKey } from "../../src/carrier-key";
import { type DeficitMap, recordTrade } from "../../src/deficits";
import type { SystemRecord } from "../../src/galaxy";
import {
	type BindContext,
	type JobFamily,
	type JobOffer,
	bindJobs,
	canPostJobs,
	deliveryCandidates,
} from "../../src/jobs";
import { type Station, generateContents } from "../../src/system";

export interface BoardOptions {
	deficits?: DeficitMap;
	gameTimeMin?: number;
	settled?: Partial<Record<JobFamily, number>>;
}

/** Every station in a system that can post work. */
export const postingStations = (record: SystemRecord): Station[] =>
	generateContents(record).stations.filter(canPostJobs);

export const stationKeyOf = (
	record: SystemRecord,
	station: Station,
): CarrierKey => carrierKey(record.index, station.localCarrierId);

export function boardContext(
	systems: readonly SystemRecord[],
	record: SystemRecord,
	station: Station,
	options: BoardOptions = {},
): BindContext {
	return {
		galaxyIndex: 0,
		system: record,
		station,
		destinations: deliveryCandidates(
			systems,
			record,
			generateContents,
			stationKeyOf(record, station),
		),
		deficits: options.deficits ?? {},
		gameTimeMin: options.gameTimeMin ?? 0,
		settled: options.settled ?? {},
	};
}

export const boardAt = (
	systems: readonly SystemRecord[],
	record: SystemRecord,
	station: Station,
	options: BoardOptions = {},
): JobOffer[] => bindJobs(boardContext(systems, record, station, options));

/**
 * The first bindable **procurement** offer in a galaxy, with its board.
 *
 * `bindProcurement` declines without a live deficit at the posting station, so
 * an offer of that family cannot be found by walking boards the way
 * `firstOffer` does — a deficit has to be planted first. The recipe was
 * written out three times: twice in `tests/requests.test.ts` (one of them
 * predating #446) and once in `tests/requests-view.test.ts`, each with its own
 * error message.
 */
export function firstProcurementOffer(
	systems: readonly SystemRecord[],
	good = "Food",
	gameTimeMin = 120,
): {
	record: SystemRecord;
	station: Station;
	offers: JobOffer[];
	offer: JobOffer;
} {
	for (const record of systems)
		for (const station of postingStations(record)) {
			const deficits = recordTrade({}, stationKeyOf(record, station), {
				goodName: good,
				units: 20,
				gameTimeMin,
				holdT: 20,
			});
			const offers = boardAt(systems, record, station, {
				deficits,
				gameTimeMin,
			});
			// **The good is constrained too.** The deficit is planted for one
			// good and the binder takes the largest it finds, so a caller
			// asking for Textiles could otherwise be handed a Food job and
			// test a fixture it did not ask for.
			const offer = offers.find(
				(o) => o.family === "procurement" && o.operand.goodName === good,
			);
			if (offer) return { record, station, offers, offer };
		}
	throw new Error("no procurement offer could be bound in this galaxy");
}

/** The first station in this galaxy whose board carries the wanted family. */
export function firstOffer(
	systems: readonly SystemRecord[],
	family: JobFamily,
	options: BoardOptions = {},
): {
	record: SystemRecord;
	station: Station;
	offers: JobOffer[];
	offer: JobOffer;
} {
	for (const record of systems) {
		for (const station of postingStations(record)) {
			const offers = boardAt(systems, record, station, options);
			const offer = offers.find((o) => o.family === family);
			if (offer) return { record, station, offers, offer };
		}
	}
	throw new Error(`no ${family} offer in this galaxy`);
}
