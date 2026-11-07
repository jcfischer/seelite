import { expect, test } from "bun:test";
import {
	fieldCentre,
	fieldId,
	FIELD_SLOT,
	systemFields,
} from "../src/asteroid-field";
import {
	canonicalFieldDiscoveries,
	discoverFieldsWithin,
	fieldIsKnown,
	parseFieldDiscoveries,
} from "../src/field-discovery";
import { generateGalaxy, SYSTEMS_PER_GALAXY } from "../src/galaxy";
import { generateContents } from "../src/system";
import { add, v3 } from "../src/vec3";

const seed = 47;
const galaxyIndex = 0;
const galaxy = generateGalaxy(seed, galaxyIndex);
const rareSystems = galaxy.systems.flatMap((record) => {
	const contents = generateContents(record);
	const plan = systemFields(record, contents).find((p) => p.profile === "rare");
	return plan ? [{ record, contents, plan }] : [];
});
const [first, second] = rareSystems;
const firstKey =
	`${first.record.index}:${first.plan.id}` as `${number}:field-${string}`;
const secondKey =
	`${second.record.index}:${second.plan.id}` as `${number}:field-${string}`;

test("old saves and empty discovery state write no new bytes", () => {
	expect(parseFieldDiscoveries(undefined)).toEqual([]);
	expect(canonicalFieldDiscoveries([])).toBeUndefined();
});

test("only charted or explicitly discovered fields are known in their system", () => {
	expect(fieldIsKnown([], first.record.index, first.plan)).toBe(false);
	const state = parseFieldDiscoveries([firstKey]);
	expect(fieldIsKnown(state, first.record.index, first.plan)).toBe(true);
	expect(fieldIsKnown(state, second.record.index, second.plan)).toBe(false);
	const charted = galaxy.systems.flatMap((r) =>
		systemFields(r, generateContents(r)).filter((p) => p.profile === "charted"),
	)[0];
	expect(charted).toBeDefined();
	expect(fieldIsKnown([], first.record.index, charted)).toBe(true);
});

test("caller-supplied radius discovers at the boundary and never before it", () => {
	const radiusKm = 7;
	const time = 12345;
	const centre = fieldCentre(first.plan, time);
	const far = add(centre, v3(radiusKm + 1, 0, 0));
	const boundary = add(centre, v3(0, 0, radiusKm));
	expect(
		discoverFieldsWithin([], first.record, first.contents, far, time, radiusKm),
	).toEqual([]);
	const discovered = discoverFieldsWithin(
		[],
		first.record,
		first.contents,
		boundary,
		time,
		radiusKm,
	);
	expect(discovered).toEqual([firstKey]);
	expect(
		discoverFieldsWithin(
			discovered,
			first.record,
			first.contents,
			centre,
			time,
			radiusKm,
		),
	).toEqual(discovered);
	expect(
		discoverFieldsWithin(
			discovered,
			first.record,
			first.contents,
			far,
			time,
			radiusKm,
		),
	).toEqual(discovered);
	expect(
		discoverFieldsWithin(
			[],
			first.record,
			first.contents,
			boundary,
			time,
			radiusKm - 1,
		),
	).toEqual([]);
});

test("discovery round trips canonically without generator pins or deposit state", () => {
	const state = parseFieldDiscoveries([secondKey, firstKey]);
	expect(canonicalFieldDiscoveries(state)).toEqual([firstKey, secondKey]);
	expect(
		parseFieldDiscoveries(
			JSON.parse(JSON.stringify(canonicalFieldDiscoveries(state))),
		),
	).toEqual(state);
	expect(canonicalFieldDiscoveries([...state].reverse())).toEqual(
		canonicalFieldDiscoveries(state),
	);
});

test("saved discoveries reject malformed, duplicate, charted and unknown identities atomically", () => {
	const absent = galaxy.systems.find(
		(r) => !rareSystems.some((s) => s.record.index === r.index),
	);
	expect(absent).toBeDefined();
	for (const raw of [
		null,
		{},
		"field-01",
		[firstKey, firstKey],
		[firstKey, null],
		[`${first.record.index}:${fieldId(FIELD_SLOT.charted)}`],
		[`${SYSTEMS_PER_GALAXY}:${first.plan.id}`],
		[`-1:${first.plan.id}`],
		[`0${first.record.index}:${first.plan.id}`],
		[firstKey, `${second.record.index}:field-02`],
		Array(SYSTEMS_PER_GALAXY + 1).fill(firstKey),
	]) {
		expect(() => parseFieldDiscoveries(raw)).toThrow();
	}
});

test("stable discovery identities survive field occurrence and geometry migrations", () => {
	const absent = galaxy.systems.find(
		(r) => !rareSystems.some((s) => s.record.index === r.index),
	)!;
	expect(absent).toBeDefined();
	const key =
		`${absent.index}:${fieldId(FIELD_SLOT.rare)}` as `${number}:field-${string}`;
	const state = parseFieldDiscoveries([key]);
	expect(canonicalFieldDiscoveries(state)).toEqual([key]);
	expect(
		fieldIsKnown(state, absent.index, {
			...first.plan,
			offPlaneKm: first.plan.offPlaneKm + 1000,
		}),
	).toBe(true);
	expect(fieldIsKnown([], absent.index, first.plan)).toBe(false);
});

test("the whole stable-slot set is bounded by the generated system count", () => {
	const raw = Array.from(
		{ length: SYSTEMS_PER_GALAXY },
		(_, i) => `${i}:${fieldId(FIELD_SLOT.rare)}` as `${number}:field-${string}`,
	);
	const state = parseFieldDiscoveries(raw);
	expect(canonicalFieldDiscoveries(state)).toEqual(raw);
	const maxKeyLength =
		String(SYSTEMS_PER_GALAXY - 1).length + 1 + fieldId(FIELD_SLOT.rare).length;
	expect(
		JSON.stringify(canonicalFieldDiscoveries(state)).length,
	).toBeLessThanOrEqual(SYSTEMS_PER_GALAXY * (maxKeyLength + 3) + 1);
});

test("discovery refuses invalid geometry and radius instead of granting knowledge", () => {
	for (const radius of [NaN, Infinity, -1, 0])
		expect(() =>
			discoverFieldsWithin([], first.record, first.contents, v3(), 0, radius),
		).toThrow();
	for (const pos of [v3(NaN, 0, 0), v3(0, Infinity, 0)])
		expect(() =>
			discoverFieldsWithin([], first.record, first.contents, pos, 0, 7),
		).toThrow();
	for (const time of [NaN, Infinity, -1])
		expect(() =>
			discoverFieldsWithin([], first.record, first.contents, v3(), time, 7),
		).toThrow();
});
