/**
 * The apparent-size detail band shared by stations and ships (#130).
 *
 * Kept free of Three.js so the directional hysteresis is a headless contract.
 * A consumer owns what each level hides; this module owns only when the level
 * changes, which is the part that must not drift between two nearby objects.
 */
import { HANDOFF_HYSTERESIS } from "./units";

export type DetailLevel = "full" | "reduced" | "outline";

/** Band edges in the subject's own silhouette radii. */
export const DETAIL_RADII = { full: 40, reduced: 400 } as const;

/** Choose a detail level while holding the current one through the handoff. */
export function detailLevel(
	current: DetailLevel | undefined,
	apparentRadii: number,
): DetailLevel {
	const held = (threshold: number, level: DetailLevel) =>
		current === level ? threshold * HANDOFF_HYSTERESIS : threshold;
	if (apparentRadii <= held(DETAIL_RADII.full, "full")) return "full";
	if (apparentRadii <= held(DETAIL_RADII.reduced, "reduced")) return "reduced";
	return "outline";
}
