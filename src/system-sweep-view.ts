/** Read-only cockpit projection of dated system sensor provenance. */
import { targetAgeLabel } from "./display-contact";
import { generateGalaxy } from "./galaxy";
import { generateContents } from "./system";
import type { SweepPanel } from "./live-cockpit";
import {
	SWEEP_CHARGE_S,
	SWEEP_STALE_S,
	sweepRemainingS,
	sweepRefusal,
	type SweepReading,
	type SweepContext,
	type SweepCharge,
} from "./system-sweep";

export const SWEEP_KIND_LABEL: Record<SweepReading["kind"], string> = {
	relay: "Pirate relay signal",
	wreck: "Salvage wreck signal",
	pressure: "Raider pressure",
};
/** A pressure row names its strength in words and never in digits (node #769).
 * A row from a save older than strengths says so rather than guessing. */
export const PRESSURE_UNRECORDED = "Raider pressure · strength not recorded";
export function sweepRowLabel(row: SweepReading): string {
	if (row.kind !== "pressure") return SWEEP_KIND_LABEL[row.kind];
	if (!row.strength) return PRESSURE_UNRECORDED;
	return `${row.strength[0].toUpperCase()}${row.strength.slice(1)} raider pressure`;
}
export const SWEEP_INTERRUPTED = "Sweep interrupted · press Sweep to restart";
export const SWEEP_IDLE = `Press Sweep · ${SWEEP_CHARGE_S} s charge`;
export const sweepCompletion = (count: number): string =>
	count === 0
		? "Sweep complete · no signal regions found"
		: `Sweep complete · ${count} ${count === 1 ? "region" : "regions"} recorded`;

export const sweepAge = (row: SweepReading, now: number): string => {
	const age = Math.max(0, now - row.observedAt);
	return `${targetAgeLabel(age)} ago${age >= SWEEP_STALE_S ? " · STALE" : ""}`;
};
export function sweepRegionLabel(row: SweepReading, worldSeed: number): string {
	const record = generateGalaxy(worldSeed, row.galaxyIndex).systems[
		row.systemIndex
	];
	if (row.region.kind === "system-space")
		return `${record.name} · unsettled system space`;
	if (row.region.kind === "cruise-lanes")
		return `${record.name} · cruise lanes`;
	const { stationId } = row.region;
	const station = generateContents(record).stations.find(
		(s) => s.id === stationId,
	);
	return `Surrounds of ${station?.name ?? row.region.stationId}`;
}

// Readings are replaced on sweep/load. Keep their static region labels separate
// from the per-second age projection, without retaining obsolete ledgers.
const regionLabels = new WeakMap<
	readonly SweepReading[],
	{
		worldSeed: number;
		byId: Map<string, string>;
	}
>();
function cachedRegionLabel(
	readings: readonly SweepReading[],
	row: SweepReading,
	worldSeed: number,
): string {
	let cache = regionLabels.get(readings);
	if (!cache || cache.worldSeed !== worldSeed) {
		cache = { worldSeed, byId: new Map() };
		regionLabels.set(readings, cache);
	}
	let label = cache.byId.get(row.id);
	if (label === undefined) {
		label = sweepRegionLabel(row, worldSeed);
		cache.byId.set(row.id, label);
	}
	return label;
}

export function sweepPanel(
	readings: readonly SweepReading[],
	now: number,
	worldSeed: number,
	context: SweepContext & {
		galaxyIndex: number;
		systemIndex: number;
		visible: boolean;
		charge: SweepCharge | null;
		status: string;
	},
): SweepPanel {
	const remaining = sweepRemainingS(context.charge, now);
	return {
		fitted: context.fitted,
		refusal: sweepRefusal(context),
		charging: remaining !== null,
		status:
			remaining !== null
				? `CHARGING · ${remaining}s remaining · runs without holding`
				: context.status,
		rows: context.visible
			? readings
					.filter(
						(r) =>
							r.galaxyIndex === context.galaxyIndex &&
							r.systemIndex === context.systemIndex,
					)
					.map((r) => ({
						id: r.id,
						label: sweepRowLabel(r),
						region: cachedRegionLabel(readings, r, worldSeed),
						age: sweepAge(r, now),
					}))
			: [],
	};
}
