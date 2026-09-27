/**
 * The live cockpit's pure presentation state.
 *
 * Simulation positions stay float64 kilometres until this projection. The DOM
 * only receives percentage coordinates and stem heights, so it cannot become a
 * second source of world position or selection state.
 */

import type { JumpRefusal } from "./hyperspace";
import { SYSTEM_NAME_MAX_CHARS } from "./names";
import { directionTo, edgeOf, intoCameraFrame, type Quat } from "./hud";
import { length, sub, type Vec3 } from "./vec3";

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
	/**
	 * Contacts the world does not hold, drawn with `MIN_CONTACT_RADIUS` as a
	 * floor. Named for the **policy** and not for the membership: a caller
	 * adding one gets the floor, and the floor is the whole of what
	 * distinguishes this list from `bodies`.
	 */
	flooredContacts?: readonly ScannerBody[];
}

export const SCANNER_RANGE_KM = 10_000;

/**
 * How far out a **floored** contact is drawn at minimum, as a fraction of the
 * plate radius. World bodies are not subject to it — see the loop below.
 *
 * A ship in a dogfight is between 0.5 and 10 km away. On the square-root curve
 * that is 0.007 to 0.032 of the plate, well inside the ship's own marker, so
 * every frame of the fight would draw the striker on top of the player and the
 * bearing — the one thing the scope is for — would be unreadable. The floor
 * trades range fidelity for bearing fidelity, which is the right trade for a
 * contact whose range is already on the target panel to three decimals.
 */
export const MIN_CONTACT_RADIUS = 0.14;

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
		flooredContacts = [],
	}: ScannerProjectionOptions = {},
): ScannerContact[] {
	const contacts = output ?? [];
	let count = 0;
	// **Two passes because the two lists take different floors, not for speed.**
	// The earlier `[...bodies, ...flooredContacts]` copied the whole body list
	// every cockpit frame, which this avoids — but a tuple-of-tuples loop header
	// would have allocated in its own right, so the honest reason to write it
	// this way is that `floor` differs, and the honest saving is the copy.
	//
	// The floor is `MIN_CONTACT_RADIUS`'s docstring's business; what belongs here
	// is that it reaches the extra contacts and **not** the world bodies. A
	// planet never comes near enough to want it, and lifting one onto a ring it
	// has not reached would be the display lying about range.
	const project = (body: ScannerBody, floor: number) => {
		const worldRelative = sub(body.pos, shipPos);
		// The scope is ship-local, not a tiny top-down map of the solar system.
		// A contact must walk around the plate when the pilot turns, otherwise the
		// display is a static world overlay wearing the name "radar".
		const relative = orientation
			? intoCameraFrame(worldRelative, orientation)
			: worldRelative;
		const distanceKm = length(relative);
		if (distanceKm > rangeKm) return;
		const planarDistanceKm = Math.hypot(relative.x, relative.z);
		// A 10,000-km scanner needs to retain the outer boundary, but a linear
		// scale makes a nearby contact at a pronounced bearing look centred. The
		// square-root curve spends more of the plate on the immediate vicinity;
		// direction remains exact and the edge still means scanner range.
		const radius =
			planarDistanceKm === 0
				? 0
				: Math.max(floor, Math.sqrt(clamp(planarDistanceKm / rangeKm, 0, 1)));
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
	};
	for (const body of bodies) project(body, 0);
	for (const body of flooredContacts) project(body, MIN_CONTACT_RADIUS);
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
	name: string;
	kind: string;
	stationType?: string;
	pos: Vec3;
}

/** One row of the list, as the panel prints it. */
export interface NavRow {
	id: string;
	name: string;
	kind: string;
	displayKind: string;
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
	/** The last rendered order, used to keep near-equal ranges from swapping. */
	previousOrder?: readonly string[];
	/** A nearer row must lead by more than this distance before it moves up. */
	distanceHysteresisKm?: number;
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

/** Two kilometres: local Traffic motion should not continuously reshuffle the list. */
export const NAV_ORDER_HYSTERESIS_KM = 2;

/** Does one body survive the player's current narrowing? */
export function navFilterMatches(
	body: Pick<NavBody, "name" | "kind" | "stationType">,
	filter: NavFilter,
): boolean {
	if (filter.kinds.length > 0 && !filter.kinds.includes(body.kind))
		return false;
	const query = filter.query.trim().toLowerCase();
	const displayKind = navDisplayKind(body);
	return (
		query === "" ||
		body.name.toLowerCase().includes(query) ||
		displayKind.toLowerCase().includes(query)
	);
}

/** The exact words the Navigation kind cell prints. */
export function navDisplayKind(
	body: Pick<NavBody, "kind" | "stationType">,
): string {
	return body.kind === "station" && body.stationType
		? `${body.stationType} station`
		: body.kind;
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
	{
		filter = EVERYTHING,
		etaFor,
		previousOrder,
		distanceHysteresisKm = NAV_ORDER_HYSTERESIS_KM,
	}: NavProjectionOptions = {},
): NavRow[] {
	const rows: NavRow[] = [];
	for (const body of bodies) {
		if (!navFilterMatches(body, filter)) continue;
		rows.push({
			id: body.id,
			name: body.name,
			kind: body.kind,
			displayKind: navDisplayKind(body),
			distanceKm: length(sub(body.pos, shipPos)),
			etaSeconds: etaFor ? etaFor(body) : null,
			selected: body.id === targetId,
		});
	}
	// Without history, distance plus id is a total and reproducible order.
	if (!previousOrder?.length) {
		rows.sort(
			(a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id),
		);
		return rows;
	}

	// Begin in the last rendered order, then insertion-sort only genuine range
	// leads. This is deliberately not a pairwise `sort` comparator: tolerance
	// comparisons are not transitive, while this pass always produces one stable
	// order and lets a new/closing target bubble as far as its real lead earns.
	const prior = new Map(previousOrder.map((id, index) => [id, index]));
	rows.sort((a, b) => {
		const ar = prior.get(a.id);
		const br = prior.get(b.id);
		// Seed every known row in its prior order and append new rows. The
		// insertion pass below then bubbles a new row only across contacts it
		// leads by more than the deadband. Requiring both ranks here would mix
		// history and distance in a non-transitive sort comparator.
		if (ar !== undefined || br !== undefined)
			return (
				(ar ?? Number.POSITIVE_INFINITY) - (br ?? Number.POSITIVE_INFINITY)
			);
		return a.distanceKm - b.distanceKm || a.id.localeCompare(b.id);
	});
	for (let index = 1; index < rows.length; index++) {
		let cursor = index;
		while (
			cursor > 0 &&
			rows[cursor - 1].distanceKm - rows[cursor].distanceKm >
				distanceHysteresisKm
		) {
			[rows[cursor - 1], rows[cursor]] = [rows[cursor], rows[cursor - 1]];
			cursor--;
		}
	}
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
	/** Seconds of **cruise's** spool-up left, or 0. The comment here read
	 *  "hyperspace wind-up" until #187 built one: this is `in-system-travel.md`
	 *  §4's, which borrows the rule and is a different window. */
	spoolLeftS: number;
	/** Seconds of §8's **hyperspace** wind-up left, or 0 (#187). */
	jumpChargeLeftS: number;
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
	spoolSecondsMax: number,
): Record<(typeof FLIGHT_FLOOR_LABELS)[number], string> {
	// **Derived by asking the formatter, not by restating its output.** These
	// were four literals beside `flightFloorCells`, which is two spellings of
	// every printed shape with nothing linking them: a format change in one had
	// no compile-time tie to the other, and the sweep caught divergence only for
	// the inputs it happened to enumerate.
	const base: FlightFloorState = {
		regime: "normal",
		spoolLeftS: 0,
		jumpChargeLeftS: 0,
		throttle: 0,
		assist: true,
		chargeAu: chargeCapacityAu,
		chargeCapacityAu,
		chargeRegenAuPerS,
	};
	/**
	 * The worst case for each field, as *inputs*.
	 *
	 * **`spoolSecondsMax` is a parameter for the same reason the capacity and
	 * the rate are**: the presentation tier gets one owner per constant. It was
	 * a literal 10 here, which is not a spool the sim can produce — the wind-up
	 * is `SPOOL_S` seconds — so the bound reserved a character for a reading
	 * that cannot happen, and the test guarding against a loose bound compared
	 * it to another invented number. At the real maximum every spool reading is
	 * the same width, which is what makes the browser check's width assertion
	 * immune to the countdown rather than merely ahead of it.
	 */
	const candidates: FlightFloorState[] = [
		{ ...base, spoolLeftS: spoolSecondsMax },
		// The jump window is the same seconds — one rule, two regimes
		// (`in-system-travel.md` §4) — so it is never the widest MODE reading.
		// It is swept anyway rather than argued: a word change here would
		// otherwise widen the cell with nothing measuring it.
		{ ...base, jumpChargeLeftS: spoolSecondsMax },
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
 * **The gap was the floor, not visibility.** Mode and throttle already reached
 * the player on the right console's Flight/Drive copy, and throttle also has an
 * unlabelled wedge on the deck — §5 gives the Flight console those readings *as
 * well*. What §5 also asks for, and what did not exist, is a compact strip on
 * the **persistent floor**: a console is read by turning the head away from the
 * glass. Assist reached nothing at all — the console renders its label with an
 * empty value — and charge rode the *target* instrument, which is the wrong
 * instrument for a second consumable with its own regeneration.
 *
 * `hud-and-scanner.md` §5.1 has the table and the reasoning; this is the one
 * paragraph a reader of this function needs.
 */
export function flightFloorCells(state: FlightFloorState): FloorCell[] {
	const {
		regime,
		spoolLeftS,
		jumpChargeLeftS,
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
	//
	// **And the jump window outranks the spool.** The two cannot run at once —
	// the game refuses each while the other is live — but the precedence is
	// written down rather than left to that refusal, because a MODE cell
	// reading `SPOOL` while the ship is seconds from another star system is the
	// wrong word for the commitment the pilot is inside. It is deliberately a
	// different word from `SPOOL` for the same reason: §8's window ends
	// somewhere else, and the two are cancelled by different things.
	const mode: FloorCell =
		jumpChargeLeftS > 0
			? {
					label: "MODE",
					value: `JUMP ${jumpChargeLeftS.toFixed(1)}s`,
					tone: "action",
				}
			: spoolLeftS > 0
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

/**
 * §8.3's course cue, as a row of its own above §5.1's strip — node #117.
 *
 * `galaxy-map.md` §8.3 states the obligation and deliberately places it
 * nowhere: "the next hop and the jumps remaining belong on the flight floor or
 * the Navigation console — a course the player cannot see from the cockpit is a
 * course they will forget they set." #117 read the console out on §8.3's own
 * argument — a console is read by turning the head *away* from the glass, which
 * is exactly the posture in which a course is forgotten — and then read a fifth
 * strip cell out on width.
 *
 * **Why not a fifth cell.** `flightFloorWidest` lays the strip out against its
 * widest reachable reading and memoises the fit for the width it solved at, and
 * #92's receipt records a fit taken on a full tank clipping both ends of the run
 * drawn a second later. A cell carrying a system name costs that bound about
 * twelve characters: permanently, if the cell is dormant when there is no
 * course; and as a reflow of the four solved cells, if it is absent. Its own row
 * pays neither — it is drawn or it is not, and the strip below it never moves.
 *
 * It keeps the strip's own grammar — a label, a value and a §4 tone, measured by
 * the same `floorRunWidths` — because two runs on one floor authored two ways is
 * how a floor comes to look like two instruments.
 */
export const COURSE_CUE_LABEL = "COURSE";

/**
 * What the cue has to say, with the impossible states unrepresentable.
 *
 * `courseProgress` reports `remaining` and `nextHop` side by side, so "three
 * jumps left and no next hop" is a shape the caller can build and the formatter
 * would have to decide about. Splitting on arrival instead means the decision is
 * made where the projection is read, once, rather than defended in the printer.
 */
export type CourseCue =
	| {
			kind: "underway";
			/** The next system on the course — §8.3's first fact. */
			nextHop: string;
			/** Jumps remaining to the destination — §8.3's second. */
			remaining: number;
			/**
			 * Whether the ship can actually make the next hop right now.
			 *
			 * The caller asks `planJump`, so the gate that refuses and the cue
			 * that warns cannot drift apart. **The cue carries the tone and not
			 * the sentence** (#117 D3): `planJump` owns the *codes*,
			 * `jumpRefusalText` below owns the words, and §3's prompt prints
			 * them. One quantity spelled in two places is how the glass comes to
			 * say two things about one fact.
			 */
			affordable: boolean;
	  }
	| { kind: "arrived"; destination: string }
	/**
	 * The flown hull has no chain to the destination (#554, #185 D4).
	 *
	 * Connectivity is guaranteed at the courier's reach and nowhere else, so a
	 * short-tank hull can hold a course it cannot fly — one loaded from a save,
	 * or set in another hull. Absence would say *no course*, which is false.
	 */
	| { kind: "no-route"; destination: string };

/**
 * The course row, or `null` for no row at all.
 *
 * Two of §5.2's decisions are visible in the shape of this function and the
 * arguments for them live there, not here: `null` is **absence** rather than a
 * dormant slot (#117 D2), and an `arrived` cue still returns a row, because
 * arriving does not clear a course (#117 D4).
 */
export function courseCue(cue: CourseCue | null): FloorCell | null {
	if (cue === null) return null;
	if (cue.kind === "no-route")
		return {
			label: COURSE_CUE_LABEL,
			value: `${cue.destination} no route`,
			// §4's refusal: the course stands, and this hull cannot fly it.
			tone: "refused",
		};
	if (cue.kind === "arrived")
		return {
			label: COURSE_CUE_LABEL,
			value: `${cue.destination} arrived`,
			// Green is §4's confirmed, engaged state, and a destination reached
			// is the one moment on this row that is a result rather than a
			// reference.
			tone: "confirmed",
		};
	return {
		label: COURSE_CUE_LABEL,
		// Singular on the last leg. It is the reading a short hop shows the
		// whole way, so "1 jumps" would be the most-seen form of this row.
		value: `${cue.nextHop} ${cue.remaining} jump${cue.remaining === 1 ? "" : "s"}`,
		tone: cue.affordable ? "passive" : "refused",
	};
}

/**
 * The most jumps the row reserves room for.
 *
 * **The two-digit ceiling, not the measured diameter** — a bound that tracks a
 * measurement has to be re-measured whenever the generator moves, and a digit
 * boundary does not. `tests/course-cue.test.ts` measures the diameter over
 * every origin in all eight galaxies and pins it exactly, which is where the
 * figure lives; it is deliberately not restated here, because the first version
 * of this comment said 13 and the diameter is 14. A 1-in-17 stride over origins
 * had found the 13, and a stride cannot find a diameter: it needs *both*
 * endpoints in the sampled set.
 */
const COURSE_CUE_JUMPS_WIDEST = 99;

/**
 * The widest reading the row can ever take.
 *
 * **Asked of the formatter, never restated beside it.** The strip carried four
 * literals of its own shapes until #92 found that a format change in one had no
 * compile-time tie to the other; this is the same rule one instrument over. The
 * font is monospace, so a character count is a width.
 */
export function courseCueWidest(): string {
	const name = "M".repeat(SYSTEM_NAME_MAX_CHARS);
	const candidates: CourseCue[] = [
		{ kind: "arrived", destination: name },
		{ kind: "no-route", destination: name },
		{ kind: "underway", nextHop: name, remaining: 1, affordable: true },
		{
			kind: "underway",
			nextHop: name,
			remaining: COURSE_CUE_JUMPS_WIDEST,
			affordable: true,
		},
	];
	let widest = "";
	for (const candidate of candidates) {
		const row = courseCue(candidate);
		if (row !== null && row.value.length > widest.length) widest = row.value;
	}
	return widest;
}

/**
 * What a refused jump says.
 *
 * **One owner for the sentences, in the tier that formats.** `planJump` owns
 * the *codes* (`JumpRefusal`) and this owns the words — §5.2 said "`planJump`
 * owns those words", which was never quite true and stopped being true at all
 * once two surfaces printed them: the notice a key press writes, and §3's
 * prompt, which used to offer "press ` to jump to X" beside a course row the
 * same frame had painted red.
 *
 * It lives here rather than in `main.ts` for the split this module already is:
 * state in the entrypoint, formatting in the presentation tier. Nothing can
 * import `main.ts`, so a refusal spelled there is one the chart — which already
 * prints course state — cannot reach.
 */
export const jumpRefusalText = (
	refusal: JumpRefusal,
	destinationName: string,
): string =>
	({
		"same-system": "already there",
		"other-galaxy": "no galactic hyperdrive fitted",
		"out-of-range": `${destinationName} is out of this hull's range`,
		"insufficient-fuel": `not enough fuel for ${destinationName}`,
	})[refusal];
