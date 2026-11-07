import {
	fieldCentre,
	fieldId,
	FIELD_SLOT,
	systemFields,
	type FieldPlan,
} from "./asteroid-field";
import type { FieldKey } from "./deposit-state";
import { SYSTEMS_PER_GALAXY, type SystemRecord } from "./galaxy";
import type { SystemContents } from "./system";
import { length, sub, type Vec3 } from "./vec3";

/** Per-galaxy discovered field identities, independent of deposits and their generator pins. */
export type FieldDiscoveries = readonly FieldKey[];

const keyFor = (systemIndex: number, fieldId: string): FieldKey =>
	`${systemIndex}:${fieldId}` as FieldKey;
const compareKeys = (a: FieldKey, b: FieldKey): number => {
	const [systemA, fieldA] = a.split(":");
	const [systemB, fieldB] = b.split(":");
	return Number(systemA) - Number(systemB) || fieldA.localeCompare(fieldB);
};
const fail = (): never => {
	throw new Error("world-state: invalid field discovery identity or geometry");
};

/** Charted fields are public; discovery of a rare field belongs to its system. */
export function fieldIsKnown(
	known: FieldDiscoveries,
	systemIndex: number,
	plan: FieldPlan,
): boolean {
	return (
		plan.profile === "charted" || known.includes(keyFor(systemIndex, plan.id))
	);
}

/** The caller supplies the approved radius; this domain chooses no discovery distance. */
export function discoverFieldsWithin(
	known: FieldDiscoveries,
	{
		record,
		contents,
		shipPos,
		gameTime,
		radiusKm,
	}: {
		record: SystemRecord;
		contents: SystemContents;
		shipPos: Vec3;
		gameTime: number;
		radiusKm: number;
	},
): FieldDiscoveries {
	if (
		![shipPos.x, shipPos.y, shipPos.z, gameTime, radiusKm].every(
			Number.isFinite,
		) ||
		gameTime < 0 ||
		radiusKm <= 0
	)
		return fail();
	const found = systemFields(record, contents)
		.filter(
			(plan) =>
				plan.profile === "rare" &&
				!fieldIsKnown(known, record.index, plan) &&
				length(sub(fieldCentre(plan, gameTime), shipPos)) <= radiusKm,
		)
		.map((plan) => keyFor(record.index, plan.id));
	return found.length ? [...known, ...found].sort(compareKeys) : known;
}

/** Empty discoveries omit the domain so legacy save integrity bytes stay unchanged. */
export function canonicalFieldDiscoveries(
	known: FieldDiscoveries,
): FieldKey[] | undefined {
	return known.length ? [...known].sort(compareKeys) : undefined;
}

/** Validate stable rare slots, retaining discoveries when a generator stops populating them. */
export function parseFieldDiscoveries(raw: unknown): FieldDiscoveries {
	if (raw === undefined) return [];
	if (!Array.isArray(raw) || raw.length > SYSTEMS_PER_GALAXY) return fail();
	const known: FieldKey[] = [];
	const seen = new Set<string>();
	for (const value of raw) {
		if (typeof value !== "string" || seen.has(value)) return fail();
		const match = /^(0|[1-9]\d*):field-(\d{2,})$/.exec(value);
		if (!match) return fail();
		if (
			Number(match[1]) >= SYSTEMS_PER_GALAXY ||
			`field-${match[2]}` !== fieldId(FIELD_SLOT.rare)
		)
			return fail();
		seen.add(value);
		known.push(value as FieldKey);
	}
	return known.sort(compareKeys);
}
