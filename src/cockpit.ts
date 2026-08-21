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
		// The oblique scanner puts an overhead contact into its lower/near
		// half. Near-field expansion makes a meaningful vertical separation
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

/** CSS screen coordinates grow downwards, unlike HUD's camera-frame y axis. */
export const screenArrowBearingDeg = (bearingDeg: number) => -bearingDeg;

export function cockpitView(headLook: HeadLook): {
	activePanel: "left" | "right" | null;
	targetDirectorVisible: boolean;
} {
	return {
		activePanel: headLook === "forward" ? null : headLook,
		targetDirectorVisible: headLook !== "forward",
	};
}
