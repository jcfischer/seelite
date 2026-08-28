/**
 * Patch three.js's own shader chunks, and record whether each patch landed.
 *
 * `String.replace` with a marker that is not there returns the string unchanged
 * and says nothing — and three.js renames its chunks between versions. A no-op
 * splice leaves a **stock** `MeshStandardMaterial` that compiles and links
 * perfectly, under the patched material's own cache key, with none of the
 * surface on it. Every check that exists stays green: the object is on screen,
 * it is lit, its program linked, and its program carries the name the patch
 * gave it — because that name is set beside the patch rather than by it.
 *
 * So the outcome is recorded where a probe can read it. `userData` rather than a
 * throw: a broken splice should fail a check, not take the page down in front of
 * a player, and the console line is worded so the probes' shader listener
 * catches it too.
 *
 * Extracted from `station-surface.ts` when #101 added a second patched material.
 * The `userData` key stays the caller's, because `probe-station-visuals.mjs`
 * reads `rockSplices` by name.
 */

export type SpliceLog = Record<string, boolean>;

/**
 * A splicer whose results accumulate into one log.
 *
 * Keyed by stage as well as by marker: both stages patch `#include <common>`,
 * and one key for the two would let a hit in the fragment stage stand in for a
 * miss in the vertex stage.
 */
export function makeSplicer(what: string) {
	const log: SpliceLog = {};
	const splice = (
		stage: string,
		source: string,
		marker: string,
		code: string,
	) => {
		const out = source.replace(marker, code);
		log[`${stage} ${marker}`] = out !== source;
		if (out === source)
			console.error(
				`shader splice missed: ${marker} is not in three.js's ${stage} chunk any more (${what})`,
			);
		return out;
	};
	return { log, splice };
}
