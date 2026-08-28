/**
 * The live cockpit's pure presentation state.
 *
 * Simulation positions stay float64 kilometres until this projection. The DOM
 * only receives percentage coordinates and stem heights, so it cannot become a
 * second source of world position or selection state.
 */

import { type Quat, directionTo, edgeOf, intoCameraFrame } from "./hud";
import { type Vec3, length, sub } from "./vec3";

export type HeadLook = "forward" | "left" | "right";

export interface ScannerBody {
	id: string;
	pos: Vec3;
}

export interface ScannerContact {
	id: string;
	selected: boolean;
	distanceKm: number;
	baseXPercent: number;
	baseYPercent: number;
	/** Signed screen-space displacement from the scan disk to the contact. */
	tipOffsetPx: number;
}

export interface ScannerProjectionOptions {
	orientation?: Quat;
	rangeKm?: number;
	output?: ScannerContact[];
}

export const SCANNER_RANGE_KM = 10_000;

const clamp = (n: number, low: number, high: number) =>
	Math.min(high, Math.max(low, n));

/**
 * Flatten nearby bodies onto the scanner base while keeping real up/down
 * separation as the mast height. The input order is the system's stable body
 * order, which keeps contacts from visually shuffling when ranges cross.
 */
export function projectScannerContacts(
	shipPos: Vec3,
	bodies: readonly ScannerBody[],
	targetId: string | null,
	{
		orientation,
		rangeKm = SCANNER_RANGE_KM,
		output,
	}: ScannerProjectionOptions = {},
): ScannerContact[] {
	const contacts = output ?? [];
	let count = 0;
	for (const body of bodies) {
		const worldRelative = sub(body.pos, shipPos);
		// The scope is ship-local, not a tiny top-down map of the solar system.
		// A contact must walk around the plate when the pilot turns, otherwise the
		// display is a static world overlay wearing the name "radar".
		const relative = orientation
			? intoCameraFrame(worldRelative, orientation)
			: worldRelative;
		const distanceKm = length(relative);
		if (distanceKm > rangeKm) continue;
		const planarDistanceKm = Math.hypot(relative.x, relative.z);
		// A 10,000-km scanner needs to retain the outer boundary, but a linear
		// scale makes a nearby contact at a pronounced bearing look centred. The
		// square-root curve spends more of the plate on the immediate vicinity;
		// direction remains exact and the edge still means scanner range.
		const radius = Math.sqrt(clamp(planarDistanceKm / rangeKm, 0, 1));
		const planarX =
			planarDistanceKm === 0 ? 0 : (relative.x / planarDistanceKm) * radius;
		const planarZ =
			planarDistanceKm === 0 ? 0 : (relative.z / planarDistanceKm) * radius;
		const verticalFraction = clamp(relative.y / rangeKm, -1, 1);
		let contact = contacts[count];
		if (!contact) {
			contact = {} as ScannerContact;
			contacts[count] = contact;
		}
		count += 1;
		contact.id = body.id;
		contact.selected = body.id === targetId;
		contact.distanceKm = distanceKm;
		contact.baseXPercent = clamp(50 + planarX * 42, 8, 92);
		contact.baseYPercent = clamp(50 + planarZ * 31, 18, 82);
		// On the forward-pitched plate, an overhead contact extends toward the
		// pilot above the scan plane. Near-field expansion makes separation
		// legible before it has covered thousands of kilometres.
		contact.tipOffsetPx =
			verticalFraction === 0
				? 0
				: Math.sign(verticalFraction) *
					Math.sqrt(Math.abs(verticalFraction)) *
					54;
	}
	contacts.length = count;
	return contacts;
}

/** The arrow glyph faces right at 0°, matching CSS's rotation convention. */
export function targetArrowBearingDeg(
	shipPos: Vec3,
	targetPos: Vec3,
	orientation: Quat,
): number | null {
	const direction = directionTo(shipPos, targetPos);
	if (!direction) return null;
	return (edgeOf(direction, orientation, 0.08).angleRad * 180) / Math.PI;
}

export function cockpitView(headLook: HeadLook): {
	activePanel: "left" | "right" | null;
	targetDirectorVisible: boolean;
} {
	return {
		activePanel: headLook === "forward" ? null : headLook,
		targetDirectorVisible: headLook !== "forward",
	};
}

// ---------------------------------------------------------------------------
// The left Navigation console's target list — node #91.
// ---------------------------------------------------------------------------

/**
 * A body as the Navigation list needs it.
 *
 * Deliberately narrower than `sim.ts`'s `Body`: the list needs an identity, a
 * class to filter on, and a position to range from. Taking the whole struct
 * would let a renderer read `appearance` or `radiusKm` off a row and make this
 * projection the second place those are joined.
 */
export interface NavBody {
	id: string;
	kind: string;
	pos: Vec3;
}

/** One row of the list, as the panel prints it. */
export interface NavRow {
	id: string;
	kind: string;
	distanceKm: number;
	/**
	 * Seconds to arrival, or `null` when nothing supplied an estimate.
	 *
	 * `null` rather than `0`, because a missing estimate and an immediate
	 * arrival are different facts and the panel must be able to say so.
	 */
	etaSeconds: number | null;
	selected: boolean;
}

/**
 * What the player has narrowed the list to.
 *
 * `kinds` empty means every class — an explicit "all" member would be a second
 * way to say the same thing, and the two would drift.
 */
export interface NavFilter {
	kinds: readonly string[];
	query: string;
}

/** The classes the panel offers as filter chips, in the order it shows them. */
export const NAV_FILTER_KINDS = ["station", "planet", "star"] as const;

export interface NavProjectionOptions {
	filter?: NavFilter;
	/**
	 * The arrival estimate for one body, if the caller has one.
	 *
	 * A callback rather than a field on `NavBody`, because the arithmetic is
	 * `Game.timeToTarget`'s — it integrates the cruise law (`cruise.ts`'s
	 * `legSeconds`) against the ship's regime and throttle, none of which
	 * belongs in a presentation projection. It is called **only for the rows
	 * that survive the filter**, which is the cost bound a filtered list buys.
	 */
	etaFor?: (body: NavBody) => number | null;
}

const EVERYTHING: NavFilter = { kinds: [], query: "" };

/** Does one body survive the player's current narrowing? */
export function navFilterMatches(
	body: Pick<NavBody, "id" | "kind">,
	filter: NavFilter,
): boolean {
	if (filter.kinds.length > 0 && !filter.kinds.includes(body.kind))
		return false;
	const query = filter.query.trim().toLowerCase();
	return query === "" || body.id.toLowerCase().includes(query);
}

/**
 * The Navigation list: the bodies it is given that survive the filter, nearest
 * first.
 *
 * **What is selectable is the caller's rule, not this one's.** A second
 * kind-listability set here would be a second owner of it, and the two would
 * diverge the day a body kind is added: the row would vanish from the list while
 * `T` still cycled to it, or worse, appear and do nothing when clicked. `Game`
 * passes `selectable()` — the same list `cycleTarget` walks and `onSelectTarget`
 * validates against — so there is one answer to "can this be targeted".
 *
 * Nearest first rather than the cycle order `selectable()` uses. The two answer
 * different questions — cycling wants a stable walk that does not reshuffle as
 * the ship moves, and this wants "what is near me", which is the question a
 * pilot opens the panel with.
 */
export function projectNavTargets(
	shipPos: Vec3,
	bodies: readonly NavBody[],
	targetId: string | null,
	{ filter = EVERYTHING, etaFor }: NavProjectionOptions = {},
): NavRow[] {
	const rows: NavRow[] = [];
	for (const body of bodies) {
		if (!navFilterMatches(body, filter)) continue;
		rows.push({
			id: body.id,
			kind: body.kind,
			distanceKm: length(sub(body.pos, shipPos)),
			etaSeconds: etaFor ? etaFor(body) : null,
			selected: body.id === targetId,
		});
	}
	// Ties broken by id so the order is total: two stations at the same range
	// would otherwise swap rows on a re-sort and the list would flicker.
	rows.sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id));
	return rows;
}
