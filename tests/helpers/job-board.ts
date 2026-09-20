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
import type { DeficitMap } from "../../src/deficits";
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
