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
	type StationType,
	formsInPlay,
} from "../../src/station";

export const FORMS_IN_PLAY: readonly (readonly [StationType, StationFormId])[] =
	STATION_TYPES.flatMap((type) =>
		formsInPlay(type).map((formId) => [type, formId] as const),
	);

/** A station record a builder or the proxy reads, at the given seeds. */
export function stationInForm(
	type: StationType,
	formId: StationFormId,
	berthSeed = 0,
	assemblySeed = 0,
): {
	type: StationType;
	formId: StationFormId;
	berthSeed: number;
	assemblySeed: number;
} {
	return { type, formId, berthSeed, assemblySeed };
}

/** The pair's label in a row's message. */
export const formLabel = (type: StationType, formId: StationFormId): string =>
	`${type}/${formId}`;
