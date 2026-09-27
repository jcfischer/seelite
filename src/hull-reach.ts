/**
 * How far a hull reaches from a system — the shipyard's law (#185 D3, #554).
 *
 * Reachability is a fact about the flown hull: its `tankLy` is its jump range,
 * and a short tank flies a fragmented graph (#185 measured 474 systems with no
 * edge at all at 5 LY over 24 galaxies). The graph is symmetric, so a hull can
 * always jump back the way it came; the one trap is **buying** a hull where it
 * has no edge at all. So a shipyard refuses a hull whose reach from its system
 * is zero, with the reason on the row, and otherwise prints how many systems
 * the hull reaches from there.
 *
 * Only the law is built. No screen sells a hull yet — the flown hull comes from
 * `?hull=` — so the row that prints this belongs to the node that builds one.
 */
import type { SystemRecord } from "./galaxy";
import { reachable } from "./galaxy-route";
import { HULL_SPECS, type HullId } from "./hull";

export type HullReach =
	/** Systems within one jump of here, at this hull's tank. At least one. */
	| { ok: true; systems: number }
	/** No system within the hull's tank: bought here, it could never leave. */
	| { ok: false; refusal: "no-reach" };

export function hullReachFrom(
	systems: readonly SystemRecord[],
	here: SystemRecord,
	hull: HullId,
): HullReach {
	const n = reachable(systems, here, HULL_SPECS[hull].tankLy).length;
	return n === 0
		? { ok: false, refusal: "no-reach" }
		: { ok: true, systems: n };
}
