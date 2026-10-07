/** System-scale sensor provenance (node #482). No knowledge writer, position,
 * contact or target is exposed by this module. */
import { derelictSlots } from "./derelict-slots";
import { type SystemRecord, generateGalaxy } from "./galaxy";
import { relayActive } from "./pirate-relay";
import { raiderSlots } from "./raider-slots";
import { relayPlan, relaySlot } from "./relay-slot"; // glossary-ignore: slot
import { type SystemContents, generateContents } from "./system";
import {
	effectiveCarrier,
	effectiveDerelict,
	type WorldState,
} from "./world-state";

export const SWEEP_CHARGE_S = 10;
export const SWEEP_STALE_S = 3600;
export interface SweepContext {
	fitted: boolean;
	flying: boolean;
	cruise: boolean;
}
export interface SweepCharge {
	startedAt: number;
}
export const sweepRemainingS = (
	charge: SweepCharge | null,
	now: number,
): number | null =>
	charge
		? Math.max(0, Math.ceil(SWEEP_CHARGE_S - (now - charge.startedAt)))
		: null;
export const sweepRefusal = (c: SweepContext): string | null =>
	!c.fitted
		? "Long-Range Scanner required"
		: !c.flying
			? "Launch to sweep"
			: c.cruise
				? "Leave cruise to sweep"
				: null;
export const beginSweep = (
	charge: SweepCharge | null,
	now: number,
	context: SweepContext,
): SweepCharge | null =>
	sweepRefusal(context) ? null : (charge ?? { startedAt: now });
export function stepSweep(
	charge: SweepCharge | null,
	now: number,
	context: SweepContext,
): { charge: SweepCharge | null; completed: boolean } {
	if (!charge || sweepRefusal(context))
		return { charge: null, completed: false };
	const completed = now - charge.startedAt >= SWEEP_CHARGE_S;
	return { charge: completed ? null : charge, completed };
}

/** Named areas, never point geometry. A wreck reads as system-space: node
 * #732 gave a derelict a pose beside a planet or moon (`derelictPose`), but the
 * sweep does not name that body; it is deliberately broad. */
export type SweepRegion =
	| { kind: "station-surrounds"; stationId: string }
	| { kind: "system-space" };
export interface SweepReading {
	id: string;
	galaxyIndex: number;
	systemIndex: number;
	kind: "relay" | "wreck" | "pressure";
	source: "own-sensors";
	observedAt: number;
	region: SweepRegion;
}
const readingId = (galaxy: number, system: number, subject: string) =>
	`sweep:${galaxy}:${system}:${subject}`;

/** Generated subjects and the region each reports in this build.
 * Their carrier identities are persistence rows, never docking berths. */
interface SweepSubject {
	kind: SweepReading["kind"];
	subject: string;
	region: SweepRegion;
	carriers: ReturnType<typeof raiderSlots>;
}
function sweepSubjects(
	record: SystemRecord,
	contents: SystemContents,
): SweepSubject[] {
	const subjects: SweepSubject[] = [];
	const plan = relayActive(record) ? relayPlan(contents, record.seed) : null;
	if (plan)
		subjects.push({
			kind: "relay",
			subject: "relay-00",
			region: { kind: "station-surrounds", stationId: plan.watchedStationId },
			carriers: [relaySlot(record.index)], // glossary-ignore: slot
		});
	for (const carrier of derelictSlots(record.index, record.government))
		subjects.push({
			kind: "wreck",
			subject: carrier.localCarrierId,
			region: { kind: "system-space" },
			carriers: [carrier],
		});
	const raiders = raiderSlots(record.index, record.government);
	if (raiders.length) {
		const outpost = contents.stations.find((s) => s.type === "outpost");
		subjects.push({
			kind: "pressure",
			subject: "pressure",
			carriers: raiders,
			region: outpost
				? { kind: "station-surrounds", stationId: outpost.id }
				: { kind: "system-space" },
		});
	}
	return subjects;
}

/** Read live sources only after the charge completes. No disabled home-berth
 * carrier is a source. Pressure is one regional reading, never a ship roster. */
export function sweepSources(
	world: WorldState,
	galaxyIndex: number,
	systemIndex: number,
): SweepReading[] {
	const record = generateGalaxy(world.seed, galaxyIndex).systems[systemIndex];
	const contents = generateContents(record);
	const env = world.galaxies[galaxyIndex];
	const now = world.gameTime;
	return sweepSubjects(record, contents)
		.filter((s) =>
			s.carriers.some((c) =>
				s.kind === "wreck"
					? effectiveDerelict(world, galaxyIndex, c.key, now).condition ===
						"destroyed"
					: effectiveCarrier(env, c.key, now).condition === "operational",
			),
		)
		.map((s) => ({
			id: readingId(galaxyIndex, systemIndex, s.subject),
			galaxyIndex,
			systemIndex,
			kind: s.kind,
			source: "own-sensors" as const,
			observedAt: now,
			region: s.region,
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
}

/** A new reading replaces this system's reports, including absences (S22).
 * Between deliberate sweeps old rows remain unchanged, even if a source dies. */
export const replaceSystemReadings = (
	old: readonly SweepReading[],
	found: readonly SweepReading[],
	galaxyIndex: number,
	systemIndex: number,
): SweepReading[] => [
	...old.filter(
		(r) => r.galaxyIndex !== galaxyIndex || r.systemIndex !== systemIndex,
	),
	...found,
];

/** Historical provenance can predate current placement. Check its area shape
 * and station reference, never compare it with today's generated region. */
function validRegion(
	value: unknown,
	contents: SystemContents,
): value is SweepRegion {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const region = value as SweepRegion;
	if (region.kind === "system-space")
		return Object.keys(region).join() === "kind";
	return (
		region.kind === "station-surrounds" &&
		Object.keys(region).sort().join() === "kind,stationId" &&
		contents.stations.some((s) => s.id === region.stationId)
	);
}
/** Pre-sweep saves migrate to an empty ledger. Every nonempty row is
 * validated against its named galaxy/system; it cannot acquire point geometry
 * or an identified reference through a crafted save. */
export function parseSweepReadings(
	value: unknown,
	world: WorldState,
): SweepReading[] {
	if (value === undefined) return [];
	const fail = (): never => {
		throw new Error(
			"save: invalid system sweep provenance, region, identity or clock",
		);
	};
	if (!Array.isArray(value) || value.length > 8 * 256 * 5) return fail();
	const seen = new Set<string>();
	const galaxies = new Map<number, ReturnType<typeof generateGalaxy>>();
	return value.map((v) => {
		if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
		const r = v as SweepReading;
		if (
			Object.keys(r).sort().join() !==
				"galaxyIndex,id,kind,observedAt,region,source,systemIndex" ||
			!Number.isInteger(r.galaxyIndex) ||
			r.galaxyIndex < 0 ||
			r.galaxyIndex >= world.galaxies.length ||
			!Number.isInteger(r.systemIndex) ||
			r.systemIndex < 0 ||
			r.systemIndex >= 256 ||
			!Number.isFinite(r.observedAt) ||
			r.observedAt < 0 ||
			r.observedAt > world.gameTime ||
			r.source !== "own-sensors" ||
			typeof r.id !== "string" ||
			seen.has(r.id)
		)
			return fail();
		let galaxy = galaxies.get(r.galaxyIndex);
		if (!galaxy) {
			galaxy = generateGalaxy(world.seed, r.galaxyIndex);
			galaxies.set(r.galaxyIndex, galaxy);
		}
		const record = galaxy.systems[r.systemIndex];
		const contents = generateContents(record);
		const subject = r.id.slice(
			readingId(r.galaxyIndex, r.systemIndex, "").length,
		);
		const generated = sweepSubjects(record, contents).find(
			(s) => s.kind === r.kind && s.subject === subject,
		);
		if (!generated || r.id !== readingId(r.galaxyIndex, r.systemIndex, subject))
			return fail();
		if (!validRegion(r.region, contents)) return fail();
		// Validate generated identity, never current condition: dated readings survive
		// a source's disappearance and loading is not a fresh observation.
		// The subject is provenance only, not a contact lookup.
		seen.add(r.id);
		return structuredClone(r);
	});
}
