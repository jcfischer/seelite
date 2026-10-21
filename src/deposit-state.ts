/**
 * Sparse asteroid depletion and survey facts (node #967, #951 D1–D6).
 * Contents remain seed-derived. Times are seconds on the game's clock.
 * Recovery and reading lifetime are calibration placeholders for node #920.
 */
import {
	FIELD_GENERATOR_VERSION,
	fieldFingerprintRow,
	fieldRocks,
	systemFields,
} from "./asteroid-field";
import { generateGalaxy } from "./galaxy";
import { fnv1a } from "./rng";
import { generateContents } from "./system";

export const RECOVERY_T_PER_H = 1;
export const SURVEY_LIFETIME_H = 24;

export type DepositKey = `${number}:field-${string}:${number}`;
export type FieldKey = `${number}:field-${string}`;
export interface DepositRow {
	surface?: number;
	deep?: number;
	at?: number;
	surveyedAt?: number;
}
export interface DepositState {
	rows: Record<DepositKey, DepositRow>;
}
export const emptyDeposits = (): DepositState => ({ rows: {} });
export const depositKey = (
	system: number,
	fieldId: string,
	slot: number,
): DepositKey => `${system}:${fieldId}:${slot}` as DepositKey;
const KEY = /^(0|[1-9]\d*):field-(\d{2,}):(0|[1-9]\d*)$/;
export function isDepositKey(
	key: string,
	systemCount: number,
): key is DepositKey {
	const m = KEY.exec(key);
	return (
		!!m &&
		Number.isSafeInteger(Number(m[1])) &&
		Number(m[1]) < systemCount &&
		Number.isSafeInteger(Number(m[3]))
	);
}
const fieldOf = (key: DepositKey): FieldKey =>
	key.slice(0, key.lastIndexOf(":")) as FieldKey;

function bad(message: string): never {
	throw new Error(`world-state: deposits: ${message}`);
}
const time = (raw: unknown, what: string): number => {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0)
		bad(`${what} is not a game time`);
	return raw as number;
};
const object = (raw: unknown, what: string): Record<string, unknown> => {
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		bad(`${what} is not an object`);
	return raw as Record<string, unknown>;
};
const declared = (
	o: Record<string, unknown>,
	keys: readonly string[],
	what: string,
) => {
	for (const key of Object.keys(o))
		if (!keys.includes(key)) bad(`${what}.${key} is not declared`);
};

/** Reading a clock earlier than the debit must never manufacture extra tonnes. */
export function debitAt(taken: number, at: number, t: number): number {
	time(at, "at");
	time(t, "t");
	if (!Number.isSafeInteger(taken) || taken < 0)
		bad("debit is not whole tonnes");
	if (t < at) bad("debit read before its time");
	return Math.max(0, taken - Math.floor(((t - at) / 3600) * RECOVERY_T_PER_H));
}
export const surveyLive = (row: DepositRow, t: number): boolean =>
	row.surveyedAt !== undefined && t - row.surveyedAt < SURVEY_LIFETIME_H * 3600;
export const isDerivable = (row: DepositRow, t: number): boolean =>
	debitAt(row.surface ?? 0, row.at ?? 0, t) === 0 &&
	debitAt(row.deep ?? 0, row.at ?? 0, t) === 0 &&
	!surveyLive(row, t);
export const compactDeposits = (d: DepositState, t: number): DepositState => ({
	rows: Object.fromEntries(
		Object.entries(d.rows).filter(([, row]) => !isDerivable(row, t)),
	),
});

/** Only touched systems are generated; repeated rocks in one field share a pin. */
function catalog(seed: number, galaxy: number) {
	const systems = generateGalaxy(seed, galaxy).systems;
	const seen = new Set<number>();
	const fields = new Map<
		FieldKey,
		{ fingerprint: number; slots: Set<number> }
	>();
	return {
		systemCount: systems.length,
		field(key: DepositKey) {
			const s = Number(key.split(":")[0]);
			if (!seen.has(s)) {
				seen.add(s);
				const record = systems[s];
				for (const plan of systemFields(record, generateContents(record))) {
					const rocks = fieldRocks(record, plan);
					fields.set(`${s}:${plan.id}` as FieldKey, {
						fingerprint: fnv1a(
							rocks.map((r) => fieldFingerprintRow(s, plan, r)).join("\n"),
						),
						slots: new Set(rocks.map((r) => r.slot)),
					});
				}
			}
			return fields.get(fieldOf(key));
		},
	};
}

export interface SavedDeposits {
	fieldGeneratorVersion: number;
	/** Previous generator's per-field pins, carried with the rows they identify.
	 * This works for every world seed without shipping an old generator. */
	fingerprints: Record<FieldKey, number>;
	rows: Record<DepositKey, DepositRow>;
}

/** Empty means absent: adding this domain changes no pre-deposit save bytes. */
export function canonicalDeposits(
	d: DepositState,
	seed: number,
	galaxy: number,
): SavedDeposits | undefined {
	const keys = Object.keys(d.rows).sort() as DepositKey[];
	if (!keys.length) return undefined;
	const generated = catalog(seed, galaxy);
	const fingerprints: Record<FieldKey, number> = {};
	const rows: Record<DepositKey, DepositRow> = {};
	for (const key of keys) {
		if (!isDepositKey(key, generated.systemCount))
			bad(`${key} is not a deposit key`);
		const field = generated.field(key);
		if (!field || !field.slots.has(Number(key.split(":")[2])))
			bad(`${key} is not a generated rock`);
		fingerprints[fieldOf(key)] = field.fingerprint;
		const r = d.rows[key];
		rows[key] = {
			...(r.surface === undefined ? {} : { surface: r.surface }),
			...(r.deep === undefined ? {} : { deep: r.deep }),
			...(r.at === undefined ? {} : { at: r.at }),
			...(r.surveyedAt === undefined ? {} : { surveyedAt: r.surveyedAt }),
		};
	}
	return { fieldGeneratorVersion: FIELD_GENERATOR_VERSION, fingerprints, rows };
}

function parseRow(raw: unknown, key: string, t: number): DepositRow {
	const o = object(raw, key);
	declared(o, ["surface", "deep", "at", "surveyedAt"], key);
	const row: DepositRow = {};
	for (const kind of ["surface", "deep"] as const) {
		if (o[kind] === undefined) continue;
		if (!Number.isSafeInteger(o[kind]) || (o[kind] as number) <= 0)
			bad(`${key}.${kind} is not positive whole tonnes`);
		row[kind] = o[kind] as number;
	}
	if (row.surface !== undefined || row.deep !== undefined)
		row.at = time(o.at, `${key}.at`);
	else if (o.at !== undefined) bad(`${key} has a time and no debit`);
	if (o.surveyedAt !== undefined)
		row.surveyedAt = time(o.surveyedAt, `${key}.surveyedAt`);
	if (row.at === undefined && row.surveyedAt === undefined)
		bad(`${key} records nothing`);
	if ((row.at ?? 0) > t || (row.surveyedAt ?? 0) > t)
		bad(`${key} is after the game clock`);
	return row;
}

export function parseDeposits(
	raw: unknown,
	seed: number,
	galaxy: number,
	t: number,
): DepositState {
	if (raw === undefined) return emptyDeposits();
	const o = object(raw, `galaxy ${galaxy}`);
	declared(o, ["fieldGeneratorVersion", "fingerprints", "rows"], "domain");
	if (
		!Number.isSafeInteger(o.fieldGeneratorVersion) ||
		(o.fieldGeneratorVersion as number) < 1
	)
		bad("invalid fieldGeneratorVersion");
	const pins = object(o.fingerprints, "fingerprints");
	const savedRows = object(o.rows, "rows");
	const generated = catalog(seed, galaxy);
	const out = emptyDeposits();
	const used = new Set<FieldKey>();
	for (const [key, rawRow] of Object.entries(savedRows)) {
		if (!isDepositKey(key, generated.systemCount))
			bad(`${key} is not a deposit key`);
		const row = parseRow(rawRow, key, t);
		const fieldKey = fieldOf(key);
		used.add(fieldKey);
		const pin = pins[fieldKey];
		if (
			!Number.isInteger(pin) ||
			(pin as number) < 0 ||
			(pin as number) > 0xffffffff
		)
			bad(`${fieldKey} fingerprint is missing or invalid`);
		const field = generated.field(key);
		// D5: compare the previous version's pin before checking current rock
		// membership. A removed or re-slotted field is exactly what must drop.
		if (
			o.fieldGeneratorVersion !== FIELD_GENERATOR_VERSION &&
			pin !== field?.fingerprint
		)
			continue;
		// Same-version additions may fill empty rock slots without moving any
		// existing identity (#948's relabel). Only a version mismatch rebases.
		if (!field?.slots.has(Number(key.split(":")[2])))
			bad(`${key} is not a generated rock`);
		out.rows[key] = row;
	}
	if (Object.keys(pins).some((key) => !used.has(key as FieldKey)))
		bad("fingerprint without rows");
	return out;
}
