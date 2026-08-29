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

// ---- The persistent flight floor's strip (§5, node #92) --------------------

/**
 * §4's grammar, as a name rather than a colour.
 *
 * The draw site turns a tone into pixels; this module decides which tone a
 * reading has earned. Splitting it the other way — a formatter returning
 * strings and a painter picking colours by re-reading the state — would put §4
 * in two places, and the half that is not a pure function is the half nothing
 * tests.
 */
export type FloorTone =
	/** Cool cyan: passive instrumentation and stable reference. */
	| "passive"
	/** Amber: a state the pilot is expected to act on or account for. */
	| "action"
	/** Green: a confirmed, engaged state. */
	| "confirmed"
	/** Red: §4's "blocking danger or refusal". */
	| "refused";

export interface FloorCell {
	label: string;
	value: string;
	tone: FloorTone;
}

/**
 * What the strip reads, and nothing more.
 *
 * The charge capacity and regeneration rate are **passed in** rather than
 * imported from `cruise.ts`. This module is the presentation tier and the two
 * constants have one owner; a second import here would be a second place a
 * retune has to reach, which is the failure `galaxy.ts` and `market.ts` shipped
 * for six weeks with `FUEL_COST_PER_LY`.
 */
export interface FlightFloorState {
	regime: "normal" | "cruise";
	/** Seconds of hyperspace wind-up left, or 0. */
	spoolLeftS: number;
	/** 0…1. */
	throttle: number;
	assist: boolean;
	chargeAu: number;
	chargeCapacityAu: number;
	chargeRegenAuPerS: number;
}

/**
 * Is the drive empty *as the instruments print it*?
 *
 * **Rounded first, and that is the whole point.** The sim's own gate is
 * `chargeAu <= 0`, and passive regeneration lifts the raw value off zero on the
 * very next frame — so a tone keyed to the raw number turned calm-cyan while
 * the same cell still printed "0.0/12 AU", and the cruise prompt went back to
 * "press J to cruise" beside it. Two halves of one reading disagreeing, and
 * caught by looking at the frame rather than by any check.
 *
 * One predicate, read by the strip's tone and by `cruisePrompt`, so the glass
 * cannot say two things about one quantity. It follows that the refusal is
 * **brief by construction** — about three seconds, until regeneration reaches
 * 0.05 AU. Whether "practically stranded" deserves its own band is a design
 * question this did not take: it would need a threshold no spec states.
 */
export const chargeReadsEmpty = (chargeAu: number): boolean =>
	Number(chargeAu.toFixed(1)) <= 0;

/** §5's own order, in §5's own sentence: "mode/throttle/assist/charge". */
export const FLIGHT_FLOOR_LABELS = ["MODE", "THR", "ASSIST", "CHARGE"] as const;

/**
 * The widest reading each cell can ever take.
 *
 * **The strip is laid out against this, not against what it happens to say.**
 * Sized to the live values it changed width every time the throttle passed a
 * ten or the drive crossed an AU — and worse, it was measured on a full tank,
 * where the regeneration suffix is absent, so the narrow viewport fitted a run
 * a fifth shorter than the one it would draw a second later. The browser check
 * passed on it and the frame showed both ends clipped.
 *
 * The font is monospace, so character count is width: `flight-floor.test.ts`
 * can sweep the reachable values and require none longer than these.
 */
export function flightFloorWidest(
	chargeCapacityAu: number,
	chargeRegenAuPerS: number,
): Record<(typeof FLIGHT_FLOOR_LABELS)[number], string> {
	// **Derived by asking the formatter, not by restating its output.** These
	// were four literals beside `flightFloorCells`, which is two spellings of
	// every printed shape with nothing linking them: a format change in one had
	// no compile-time tie to the other, and the sweep caught divergence only for
	// the inputs it happened to enumerate.
	const base: FlightFloorState = {
		regime: "normal",
		spoolLeftS: 0,
		throttle: 0,
		assist: true,
		chargeAu: chargeCapacityAu,
		chargeCapacityAu,
		chargeRegenAuPerS,
	};
	/**
	 * The worst case for each field, as *inputs*. A spool of 10 s is wider than
	 * either regime word; a charge one step below capacity carries the
	 * regeneration suffix the full tank omits.
	 */
	const candidates: FlightFloorState[] = [
		{ ...base, spoolLeftS: 10 },
		{ ...base, regime: "cruise" },
		{ ...base, throttle: 1 },
		{ ...base, assist: false },
		{ ...base, chargeAu: chargeCapacityAu - 0.05 },
		{ ...base, chargeAu: 0 },
	];
	const widest = Object.fromEntries(
		FLIGHT_FLOOR_LABELS.map((label) => [label, ""]),
	) as Record<(typeof FLIGHT_FLOOR_LABELS)[number], string>;
	for (const candidate of candidates)
		for (const cell of flightFloorCells(candidate)) {
			const label = cell.label as (typeof FLIGHT_FLOOR_LABELS)[number];
			if (cell.value.length > widest[label].length) widest[label] = cell.value;
		}
	return widest;
}

/**
 * §5's compact mode/throttle/assist/charge strip.
 *
 * **Three of these four had no player-visible readout before this.** They were
 * written only to `#hud`, which is `clip: rect(0 0 0 0)` in `index.html` and is
 * only written at all under `?legacy-hud=1` — a probe surface, not a player
 * one. Charge reached the glass once, as secondary text on the *target*
 * instrument, which is the wrong instrument for a second consumable with its
 * own regeneration.
 */
export function flightFloorCells(state: FlightFloorState): FloorCell[] {
	const {
		regime,
		spoolLeftS,
		throttle,
		assist,
		chargeAu,
		chargeCapacityAu,
		chargeRegenAuPerS,
	} = state;

	// **Spooling outranks the regime field.** The wind-up is a window the pilot
	// is committed inside, and on the frame a drop-out fires `regime` still
	// reads cruise — so a strip keyed on `regime` alone would name the regime
	// the ship has left.
	const mode: FloorCell =
		spoolLeftS > 0
			? {
					label: "MODE",
					value: `SPOOL ${spoolLeftS.toFixed(1)}s`,
					tone: "action",
				}
			: regime === "cruise"
				? { label: "MODE", value: "CRUISE", tone: "confirmed" }
				: { label: "MODE", value: "NORMAL", tone: "passive" };

	const thr: FloorCell = {
		label: "THR",
		value: `${Math.round(throttle * 100)}%`,
		tone: "passive",
	};

	// **Amber when off.** Assist off is #5's Newtonian regime, where the nose
	// and the velocity genuinely disagree — the single fact about the ship's
	// handling that the hull-hidden cockpit cannot show any other way. It is a
	// legitimate choice rather than a fault, so it is not red.
	const assistCell: FloorCell = {
		label: "ASSIST",
		value: assist ? "ON" : "OFF",
		tone: assist ? "passive" : "action",
	};

	// The regeneration is printed **only while it is running**. It is the
	// anti-stranding rule and the map requires the HUD to show it, but a
	// "+1.0/min" beside a full tank is a claim about a process that is not
	// happening.
	const regenPerMin = chargeRegenAuPerS * 60;
	const filling = chargeAu < chargeCapacityAu;
	const charge: FloorCell = {
		label: "CHARGE",
		value:
			`${chargeAu.toFixed(1)}/${chargeCapacityAu} AU` +
			(filling ? `  +${regenPerMin.toFixed(1)}/min` : ""),
		// Empty is a **refusal**, not a low reading: the cruise engage is
		// declined, which is §4's second red case. Anything above it is an
		// ordinary spend. Read at the resolution the cell prints — see
		// `chargeReadsEmpty`.
		tone: chargeReadsEmpty(chargeAu) ? "refused" : "passive",
	};

	return [mode, thr, assistCell, charge];
}
