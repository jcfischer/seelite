/**
 * Every (role, form) pair a running game can build: each role's pool and the
 * outpost's one form (`formsInPlay`, node #717).
 *
 * The rows that measured "the selected form" now iterate this, so a form added
 * to a pool is measured by every one of them without being named — and a form
 * no pool holds is measured by none, which is #663's rule that only a form
 * that can be drawn owes a proxy, a reach and the rest.
 */

import {
	STATION_TYPES,
	type StationFormId,
	type StationPlan,
	type StationType,
	formsInPlay,
} from "../../src/station";

export const FORMS_IN_PLAY: readonly (readonly [StationType, StationFormId])[] =
	STATION_TYPES.flatMap((type) =>
		formsInPlay(type).map((formId) => [type, formId] as const),
	);

/**
 * The outpost forms built ahead of any pool (node #1032): the Derrick, Buoy,
 * Rig and Cluster are authored, solid and drawn when something builds one (the
 * station workbench, a forced form), but no world draws them until the fiction
 * map puts them in play (#460), so `formsInPlay` does not list them. The rows
 * that measure a form's proxy, reach and mesh read this too, so that
 * pooling one later finds it already held to them.
 */
export const OUTPOST_FORMS_AHEAD: readonly (readonly [
	StationType,
	StationFormId,
])[] = (["a", "b", "c", "d"] as const).map((form) => ["outpost", form]);

/** Every form a proxy row measures: the forms in play, and those built ahead. */
export const FORMS_MEASURED: readonly (readonly [
	StationType,
	StationFormId,
])[] = [...FORMS_IN_PLAY, ...OUTPOST_FORMS_AHEAD];

/** A station record a builder or the proxy reads, at the given seeds. */
export function stationInForm(
	type: StationType,
	formId: StationFormId,
	berthSeed = 0,
	assemblySeed = 0,
): StationPlan {
	return { type, formId, berthSeed, assemblySeed };
}

/** The pair's label in a row's message. */
export const formLabel = (type: StationType, formId: StationFormId): string =>
	`${type}/${formId}`;
