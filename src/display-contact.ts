import type { CarrierStanding } from "./carrier-standing";
import { SCAN_MODULE } from "./market";
import type { Body } from "./sim";
import type { Vec3 } from "./vec3";
import type { HullId } from "./hull";

/** Presentation identity for a target outside the generated body list (#52).
 * Producers own position and velocity; the scene graph never supplies either.
 * Legal vocabulary belongs to #8: null means no reading has been recorded.
 */
export interface DisplayContact extends Body {
	/** A producer declares the hull type; never inferred from the display name. */
	shipType?: HullId;
	velocity: Vec3;
	/**
	 * What a completed scan recorded about this carrier, or `null` for one that
	 * has never been scanned (§6, F8).
	 *
	 * **Renamed from `legalStatus` as it was retyped**, and the rename is not
	 * decoration: `world-state.ts`'s `LegalStatus` is `{ heat, updatedAt }` and
	 * belongs to the *player*, and one field carrying both meanings is the
	 * collision `CarrierKey`'s brand exists to prevent. It takes
	 * `CarrierStanding` — §2's three words — and never that pair.
	 *
	 * **It is a reading, not a live value.** The producer that sets it derives it
	 * from the knowledge row's own clock, so it goes stale on the glass beside
	 * its age rather than being quietly refreshed by a world the pilot has not
	 * looked at.
	 */
	standing: CarrierStanding | null;
	scannerClass: "unknown" | "civilian" | "hostile" | "station";
}

export function isDisplayContact(body: Body): body is DisplayContact {
	return "velocity" in body;
}

/**
 * The relative-speed figure: a magnitude, with no direction word beside it.
 * `hud-and-scanner.md` §3 owns the quantity and the two forms rejected on the
 * way to it.
 */
export function relativeLabel(kms: number | null, separator = " · "): string {
	if (kms === null) return "";
	// The separator belongs to the label, so nothing selected leaves no dangling
	// bullet on the end of the line (sage #353).
	return `${separator}REL ${kms.toFixed(2)} km/s`;
}

/**
 * What the scan channel has to say about the target, if anything.
 *
 * Kept out of `DisplayContact` because it is not a fact about the ship: a charge
 * in progress is a fact about the pilot's aim this second, and an age is a fact
 * about the clock. Both belong to the frame, and the panel is the only reader.
 */
export interface DesignationScan {
	/** 0…1 of a charge running now. */
	progress?: number;
	/** How long ago the recorded reading was taken, seconds. */
	ageS?: number;
	/** Why nothing is happening, in the one case the pilot can act on. */
	refusal?: ScanRefusal | null;
	/** Why the hold is not satisfied, for a carrier the pilot could scan. Printed
	 *  beside `UNKNOWN` rather than in place of it: that you have not read this
	 *  ship and that you are not holding it now are two facts, and the cell loses
	 *  one of them if the second overwrites the first. */
	standoff?: ScanStandoff | null;
}

/**
 * The reading's age, in one unit: `4m`, `3h`, `12d`.
 *
 * **Why a third age formatter, when two exist.** `hud.ts`'s `duration` is the
 * instrument's general figure and prints `4.2min` beside a `—` for a value it
 * has none of; `knowledge-labels.ts`'s `exactAge` is the record card's precise
 * `1M 08S AGO`. This line is a designation with a width, and a staleness warning
 * needs one unit and no words — two units here would push `SHIP · PROSPECTOR ·
 * FUGITIVE` off the instrument.
 */
export const targetAgeLabel = (ageS: number): string => {
	const s = Math.max(0, Math.floor(ageS));
	if (s < 60) return `${s}s`;
	if (s < 3_600) return `${Math.floor(s / 60)}m`;
	if (s < 86_400) return `${Math.floor(s / 3_600)}h`;
	return `${Math.floor(s / 86_400)}d`;
};

/** Why a scan is not happening, in the one case the pilot can act on.
 *
 *  Moved here from `carrier-scan.ts` (#384's round 1) because **the module that
 *  paints a word owns the word**: while the table lived beside the predicate and
 *  the printer wrote its own literal, the declared owner was dead code and a
 *  relabel would have landed in one of the two copies at random.
 */
export type ScanRefusal = "no-module";

export const SCAN_REFUSAL_LABELS: Record<ScanRefusal, string> = {
	"no-module": "NO SCANNER",
};

/**
 * Why the charge is not building on a carrier the pilot **can** scan, when they
 * are fitted and pointing at it. `#384`'s flight test is the reason this exists:
 * a pilot who cannot start a scan and is shown `UNKNOWN` has no way to tell
 * "too far" from "not on the sightline" from "the verb is broken", and reports
 * the last one.
 */
export type ScanStandoff = "too-far" | "off-axis";

export const SCAN_STANDOFF_LABELS: Record<ScanStandoff, string> = {
	"too-far": "TOO FAR",
	"off-axis": "OFF AXIS",
};

/**
 * The right cockpit Target panel's designation, independent of its name.
 *
 * **Two axes share the last cell, and §6 says which wins.** `scannerClass`
 * answers *is this a pirate*; standing answers *is this wanted*. A pirate reads
 * `HOSTILE` whatever its standing turns out to be (F1, F10 — the raider's own
 * draw is kill-time and §6 leaves its line alone), and otherwise the cell is the
 * scan's: the charge while it runs, the recorded standing with its age once
 * there is one, and `UNKNOWN` before that.
 */
export function targetDesignation(
	body: Body | null,
	scan: DesignationScan = {},
): string {
	if (!body) return "";
	if (body.kind === "station")
		return body.stationType
			? `STATION · ${body.stationType.toUpperCase()}`
			: "STATION";
	if (body.kind === "relay")
		return isDisplayContact(body)
			? `RELAY · ${body.scannerClass.toUpperCase()}`
			: "RELAY";
	if (body.kind !== "ship") return body.kind.toUpperCase();
	if (!isDisplayContact(body)) return "SHIP · UNKNOWN";
	const identity = ["SHIP", body.shipType?.toUpperCase()].filter(Boolean);
	if (body.scannerClass === "hostile")
		return [...identity, "HOSTILE"].join(" · ");
	if (scan.refusal)
		return [...identity, SCAN_REFUSAL_LABELS[scan.refusal]].join(" · ");
	if (scan.progress !== undefined && scan.progress < 1)
		// **Floored, not rounded.** Under a rounding `SCANNING 99.6%` prints
		// `100%` for the last three frames of a five-second charge, on a scan
		// that has not written its record yet — the one moment where the cell
		// would lie about what has happened.
		return [...identity, `SCANNING ${Math.floor(scan.progress * 100)}%`].join(
			" · ",
		);
	if (!body.standing)
		return [
			...identity,
			"UNKNOWN",
			...(scan.standoff ? [SCAN_STANDOFF_LABELS[scan.standoff]] : []),
		].join(" · ");
	const standing = body.standing.toUpperCase();
	return [
		...identity,
		scan.ageS === undefined
			? standing
			: `${standing} · ${targetAgeLabel(scan.ageS)}`,
	].join(" · ");
}
