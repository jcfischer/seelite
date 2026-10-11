/**
 * The scan verb (`carrier-identity.md` §4, F4, F5, F8, F9, F12; built by #364).
 *
 * Two things live here: **the hold**, which is how a scan is paid for, and
 * **the reading**, which is what a completed one means. Neither is a fact about
 * the world — standing and the hold a carrier carries are `carrier-standing.ts`
 * and `carrier-manifest.ts`'s, and this module only ever re-derives them from
 * what a row recorded.
 *
 * ## The hold is interdiction's shape, with one deliberate difference
 *
 * `src/interdiction.ts` holds a lock through a charge, and a scan does the same:
 * `SCAN_CHARGE_S` of unbroken attention, reset rather than paused when it
 * breaks, and no roll at any point. A roll would make the same ship answer
 * differently to two identical scans, which §4 calls a lie of its own kind.
 *
 * **The predicate is a bearing cone, not the heading match O1 chose for the
 * contest** — and that is not an oversight, because the two verbs answer
 * different questions. Interdiction is a contest: two parties, one of whom is
 * trying to get away, which is why O1 ruled on headings (a bearing lock let
 * cruise speed decide it). A scan has no opponent. What the pilot holds is a
 * *sightline* — the nose on the ship — and the cost F4 names is exactly that:
 * "keeping a nose steady on someone is what a pilot cannot afford in a fight".
 * So the cone is measured from the nose to the target's bearing.
 *
 * **Range is checked every frame here, where interdiction checks it once.**
 * A contest runs in cruise, where a pinned offset makes distance irrelevant
 * between frames. A scan is flown at combat speed, and driving out of
 * `SCAN_RANGE_KM` mid-charge is a normal thing to do; it breaks the hold.
 *
 * ## Figures
 *
 * **No cone, range or charge is quoted in the spec, and none is quoted in a
 * spec from here either.** They are feel, they are tuned by flying, and this
 * repo's record is that a figure written into a spec before it has been flown
 * is later read as a measurement. `scripts/measure-carrier-scan.ts` prints
 * these three beside what they mean in play — the lateral room the cone leaves
 * at the range ceiling, the distance a target crosses while the charge runs —
 * and the principal tunes them off that.
 *
 * ## One completed scan per hold
 *
 * A charge that completes stays complete until the hold breaks; writing the row
 * again every frame would keep `observedAt` current and so **hold the age at
 * zero**, which is F8's whole point — "a reading without its age invites a
 * pilot to act on an hour-old answer". Refreshing is a deliberate act: release the trigger, then hold it again.
 */
import type { CarrierKey } from "./carrier-key";
import { carrierManifest } from "./carrier-manifest";
import type { CarrierStanding } from "./carrier-standing";
import { carrierStanding } from "./carrier-standing";
import { dot, normalizeOr, type Vec3 } from "./vec3";
import { equipmentFitted, SCAN_MODULE } from "./market";
import type { ScanRefusal, ScanStandoff } from "./display-contact";
import type { KnowledgeRow } from "./world-state";

/** How close a carrier has to be to answer. Well inside `SCANNER_RANGE_KM`'s
 *  10,000 km — §4's bound, and the reason the passive display stays the passive
 *  display. */
export const SCAN_RANGE_KM = 400;
/** Half-angle of the cone the nose has to hold the target inside, degrees. */
export const SCAN_CONE_DEG = 12;
/** Seconds of unbroken hold. Longer than interdiction's 2.5 s, because the
 *  reward is information rather than a fight the other party cannot refuse. */
export const SCAN_CHARGE_S = 5;

/** The three feel figures as one object, for the instrument and the probe to
 *  print rather than restate. */
export const CARRIER_SCAN_FIGURES = {
	rangeKm: SCAN_RANGE_KM,
	coneDeg: SCAN_CONE_DEG,
	chargeS: SCAN_CHARGE_S,
} as const;

const SCAN_CONE_COS = Math.cos((SCAN_CONE_DEG * Math.PI) / 180);

/**
 * Does this pilot own the module?
 *
 * The one behavioural read of the row `market.ts` sells, and the idiom
 * `station-commerce.ts` already uses for the Large Cargo Bay: a name in a list,
 * never a separate flag that can disagree with the purchase that set it.
 */
export const scanFitted = (ownedEquipment: readonly string[]): boolean =>
	equipmentFitted(ownedEquipment, SCAN_MODULE);

/** Is the target inside the cone the nose is pointing down? */
export const scanConeHeld = (nose: Vec3, towardTarget: Vec3): boolean =>
	dot(normalizeOr(nose, nose), normalizeOr(towardTarget, towardTarget)) >=
	SCAN_CONE_COS;

/** Is the target inside scan range? */
export const scanInRange = (rangeKm: number): boolean =>
	rangeKm >= 0 && rangeKm <= SCAN_RANGE_KM;

/**
 * Which geometric reason the hold is not being satisfied, or `null` when the
 * geometry is satisfied and the charge is merely unfinished — which the cell
 * already says with `SCANNING`.
 *
 * **Range is answered first.** A carrier 900 km out is off axis at most angles
 * too, and the fact with a verb attached to it is distance: fly closer.
 *
 * Both terms are read from the axis the **sight** uses, never the hull's. The
 * hull's nose and the cockpit reticle are different rotations — `main.ts` says so
 * beside `forwardOf`, and the guns fire along the reticle — and measuring the cone
 * from the hull is the defect this cue was found through: a pilot aimed dead
 * centre at a carrier, was refused, and found the scan by aiming well below it.
 */
export const scanStandoff = (
	rangeKm: number,
	aim: Vec3,
	towardTarget: Vec3,
): ScanStandoff | null =>
	!scanInRange(rangeKm)
		? "too-far"
		: scanConeHeld(aim, towardTarget)
			? null
			: "off-axis";

/**
 * Why no scan is happening, in the one case the pilot can act on.
 *
 * **Only the missing module is a refusal.** Everything else that stops a charge
 * — out of range, off the nose, a target that cannot be scanned — is visible in
 * the figures the Target panel already carries, and a red word beside every
 * station and raider selected would be noise that also trains the pilot to
 * ignore the word that matters. F4 states the cost of its own gate: until the
 * module is bought, every bounty job that would read a scan record is
 * unavailable, and this is where that becomes visible.
 */
export const scanRefusal = (
	fitted: boolean,
	targetScannable: boolean,
): ScanRefusal | null => (!targetScannable || fitted ? null : "no-module");

/** What a charge is being accumulated against. Its whole content is the key,
 *  and that is the point: a subject is not a detail of the hold, it is what the
 *  hold is *of*. */
export interface ScanSubject {
	key: CarrierKey;
}

/** A scan in progress. Session state, never saved: like the jump charge, it is
 *  a thing happening to the pilot right now, not a fact about the world. */
export interface ScanHold {
	/** What it is being held on, or `null` for no charge at all. */
	key: CarrierKey | null;
	/** Seconds of unbroken hold so far. */
	chargeS: number;
}

export const beginScanHold = (): ScanHold => ({ key: null, chargeS: 0 });

/**
 * One frame of the armed, trigger-held scan. Releasing or disarming breaks
 * the hold. Breaking it zeroes the charge — §4: "a break in the
 * hold does not pause the charge, it resets it" — and a completed charge sits at
 * the ceiling until the hold breaks, so a long lock cannot keep the record's
 * clock current.
 *
 * **The subject travels with the charge, and changing it breaks the hold.**
 *  §4's "unbroken attention" is attention to *one ship*: a charge that survived a
 *  change of target would hand a record to a pilot who never held a nose on that
 *  ship for five seconds, and four seconds on one carrier plus one second on
 *  another is exactly what a sweep across a traffic queue looks like from the
 *  cockpit. (#384's round 1 found the first version doing just that, because the
 *  hold was a number with nobody attached to it.)
 */
export function stepScanHold(
	hold: ScanHold,
	held: ScanSubject | null,
	dt: number,
	trigger: { armed: boolean; held: boolean },
): ScanHold {
	if (!trigger.armed || !trigger.held || held === null)
		return hold.chargeS === 0 && hold.key === null ? hold : beginScanHold();
	const step = Math.max(0, dt);
	if (held.key !== hold.key)
		return { key: held.key, chargeS: Math.min(SCAN_CHARGE_S, step) };
	const chargeS = Math.min(SCAN_CHARGE_S, hold.chargeS + step);
	return chargeS === hold.chargeS ? hold : { key: held.key, chargeS };
}

/** Did this frame complete a charge the previous frame had not? The one moment
 *  a scan writes its record. */
export const scanCompleted = (before: ScanHold, after: ScanHold): boolean =>
	before.chargeS < SCAN_CHARGE_S && after.chargeS >= SCAN_CHARGE_S;

/** 0…1 of the way through the charge, for the instrument's progress cell. */
export const scanProgress = (hold: ScanHold): number =>
	Math.min(1, hold.chargeS / SCAN_CHARGE_S);

/**
 * The Flight console's reading block (§6), as the console prints it.
 *
 * Strings, not figures: the console compares these to nothing, and a pilot
 * reading `NOT READ` beside `UNKNOWN` is reading the same fact the glass shows.
 */
export interface ScanConsoleReadout {
	/** The drawn proper name — F3's quarry. */
	name: string;
	/** The composed registry — F3's where-it-belongs. */
	registry: string;
	standing: string;
	/**
	 * The recorded voyage's **Manifest**, one line per good, or why there is none
	 *  to print. Named for what it is rather than `hold`: the console prints it
	 *  under the word `HELD`, which is ordinary speech for what a ship is
	 *  carrying, while **Traffic hold** in `CONTEXT.md` is a place a carrier waits
	 *  and `ScanHold` in this module is the charge (sage #384 round 1). A field
	 *  cannot be three things even where a glass can get away with one word.
	 */
	manifest: string;
	/** The reading's age, or `NEVER`. */
	age: string;
}

export interface CarrierReading {
	standing: CarrierStanding;
	manifest: readonly { good: string; tonnes: number }[];
	/** Seconds since the reading was taken. */
	ageS: number;
	observedAt: number;
}

/**
 * What a knowledge row's scan means now: the standing and the hold that were
 * read, re-derived from the terms the row recorded.
 *
 * **The row's clock, never the world clock.** Standing rotates under F2 and the
 * hold is redrawn each voyage under F11, so deriving them at `gameTime` would
 * show a live reading under a stale label — the exact confusion F8's ageing
 * exists to prevent. `ageS` is what the row's age is, and it goes on the glass
 * beside the word.
 *
 * **The voyage is the recorded one**, which is what §5's amendment by #362
 * bought: the flown voyage depends on the route as it stood, so a scan read
 * before a late return keeps showing the hold it read even after the carrier
 * has landed and gone out again. What it is carrying now is a different
 * question, and the answer is the age beside the reading.
 *
 * `null` is the answer for a row that carries no scan: F8's `UNKNOWN`.
 */

export function carrierReading(args: {
	systemSeed: number;
	key: CarrierKey;
	row: KnowledgeRow | undefined;
	holdT: number;
	government: number;
	gameTime: number;
}): CarrierReading | null {
	const scan = args.row?.scan;
	if (!scan) return null;
	return {
		standing: carrierStanding(
			args.systemSeed,
			args.key,
			scan.observedInstanceOrdinal,
			scan.observedAt,
		),
		manifest: carrierManifest(
			args.systemSeed,
			args.key,
			scan.observedInstanceOrdinal,
			scan.observedVoyageOrdinal,
			{ holdT: args.holdT, government: args.government },
		),
		ageS: Math.max(0, args.gameTime - scan.observedAt),
		observedAt: scan.observedAt,
	};
}
