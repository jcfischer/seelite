/**
 * SPIKE for node #951 — the asteroid deposit domain's saved form, under the
 * principal's O3 ruling (2026-10-13): depletion is saved and **recovers on the
 * game clock**. Not production code: it exists so
 * `scripts/measure-save-size.ts` prices the domain through the real
 * canonicaliser, integrity hash and parser.
 *
 * - Contents (family, grade, reserves, deep location) are `f(seed)` on
 *   `ASTEROID_DEPOSIT` and never saved. The row holds only the **debit**: whole
 *   tonnes taken, and when. The debit refills linearly at a calibration rate,
 *   so a row has an exact time at which it is derivable again, and compaction
 *   drops it then — never before.
 * - A survey (#872 D15) reads derivable contents, so the only state is the
 *   fact. Two candidate encodings, priced side by side: a `surveyedAt` member
 *   on the rock's row, or one bitmap per field over its rock slots.
 */

export const FIELD_GENERATOR_VERSION = 1;

/** Calibration placeholder: whole tonnes a rock's debit refills per game hour. */
export const RECOVERY_T_PER_H = 1;

/** `(systemIndex, fieldId, rockSlot)` inside one galaxy envelope. */
export type DepositKey = `${number}:field-${string}:${number}`;
/** `(systemIndex, fieldId)`: the survey bitmap's key. */
export type FieldKey = `${number}:field-${string}`;
const KEY = /^(0|[1-9]\d{0,2}):field-(\d\d):(0|[1-9]\d{0,4})$/;
const FIELD_KEY = /^(0|[1-9]\d{0,2}):field-(\d\d)$/;
export const depositKey = (s: number, fieldId: string, slot: number) =>
	`${s}:${fieldId}:${slot}` as DepositKey;
export const fieldKey = (s: number, fieldId: string) =>
	`${s}:${fieldId}` as FieldKey;

export interface DepositRow {
	/** Whole tonnes taken from the surface and the deep deposit, as of `at`. */
	surface?: number;
	deep?: number;
	at?: number;
	/** Survey encoding A: the reading's time on the rock's own row. */
	surveyedAt?: number;
}

export interface DepositState {
	rows: Record<DepositKey, DepositRow>;
	/** Survey encoding B: base64 bitmap over the field's rock slots. */
	surveyed: Record<FieldKey, string>;
}

export const emptyDeposits = (): DepositState => ({ rows: {}, surveyed: {} });

/** The debit left at `t`. Zero means the rock is derivable again. */
export const debitAt = (taken: number, at: number, t: number): number =>
	Math.max(0, taken - Math.floor(((t - at) / 3600) * RECOVERY_T_PER_H));

const bad = (message: string): never => {
	throw new Error(`world-state: deposits: ${message}`);
};
const whole = (v: unknown, what: string): number => {
	if (typeof v !== "number" || !Number.isInteger(v) || v <= 0)
		bad(`${what} is not a positive whole number of tonnes`);
	return v as number;
};
const time = (v: unknown, what: string): number => {
	if (typeof v !== "number" || !Number.isFinite(v) || v < 0) bad(what);
	return v as number;
};

export function parseDeposits(raw: unknown, galaxy: number): DepositState {
	if (raw === undefined) return emptyDeposits();
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		bad(`galaxy ${galaxy} is not an object`);
	const o = raw as Record<string, unknown>;
	for (const k of Object.keys(o))
		if (!["fieldGeneratorVersion", "rows", "surveyed"].includes(k))
			bad(`galaxy ${galaxy}: ${k} is not declared`);
	if (o.fieldGeneratorVersion !== FIELD_GENERATOR_VERSION)
		bad(
			`galaxy ${galaxy}: fieldGeneratorVersion ${String(o.fieldGeneratorVersion)} needs a migration`,
		);
	const out = emptyDeposits();
	for (const [key, value] of Object.entries(
		(o.rows ?? {}) as Record<string, unknown>,
	)) {
		const m = KEY.exec(key);
		if (!m || Number(m[1]) > 255) bad(`${key} is not a deposit key`);
		const r = value as Record<string, unknown>;
		for (const k of Object.keys(r))
			if (!["surface", "deep", "at", "surveyedAt"].includes(k))
				bad(`${key}.${k} is not declared`);
		const row: DepositRow = {};
		if (r.surface !== undefined) row.surface = whole(r.surface, `${key} surface`);
		if (r.deep !== undefined) row.deep = whole(r.deep, `${key} deep`);
		if ((row.surface ?? row.deep) !== undefined) row.at = time(r.at, `${key} at`);
		else if (r.at !== undefined) bad(`${key} has a time and no debit`);
		if (r.surveyedAt !== undefined)
			row.surveyedAt = time(r.surveyedAt, `${key} surveyedAt`);
		if (row.at === undefined && row.surveyedAt === undefined)
			bad(`${key} records nothing`);
		out.rows[key as DepositKey] = row;
	}
	for (const [key, value] of Object.entries(
		(o.surveyed ?? {}) as Record<string, unknown>,
	)) {
		if (!FIELD_KEY.test(key)) bad(`${key} is not a field key`);
		if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
			bad(`${key} survey bitmap`);
		out.surveyed[key as FieldKey] = value as string;
	}
	return out;
}

/** Omitted when empty — the `derelicts` door: a save from before deposits
 *  hashes to the bytes it was written with. */
export function canonicalDeposits(d: DepositState): unknown {
	const rowKeys = Object.keys(d.rows).sort() as DepositKey[];
	const fieldKeys = Object.keys(d.surveyed).sort() as FieldKey[];
	if (!rowKeys.length && !fieldKeys.length) return undefined;
	const rows: Record<string, unknown> = {};
	for (const k of rowKeys) {
		const r = d.rows[k];
		rows[k] = {
			...(r.surface === undefined ? {} : { surface: r.surface }),
			...(r.deep === undefined ? {} : { deep: r.deep }),
			...(r.at === undefined ? {} : { at: r.at }),
			...(r.surveyedAt === undefined ? {} : { surveyedAt: r.surveyedAt }),
		};
	}
	const surveyed: Record<string, string> = {};
	for (const k of fieldKeys) surveyed[k] = d.surveyed[k];
	return {
		fieldGeneratorVersion: FIELD_GENERATOR_VERSION,
		...(rowKeys.length ? { rows } : {}),
		...(fieldKeys.length ? { surveyed } : {}),
	};
}

export const isEmptyDeposits = (d: DepositState) =>
	!Object.keys(d.rows).length && !Object.keys(d.surveyed).length;

/** Survey bitmap for slots `0..cells-1`. */
export function surveyBitmap(cells: number, slots: Iterable<number>): string {
	const bytes = new Uint8Array(Math.ceil(cells / 8));
	for (const s of slots) bytes[s >> 3] |= 1 << (s & 7);
	return Buffer.from(bytes).toString("base64");
}
