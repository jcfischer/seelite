import type { Body } from "./sim";
import type { Vec3 } from "./vec3";
import type { HullId } from "./hull";

/** Presentation identity for a target outside the generated body list (#52).
 * Producers own position and velocity; the scene graph never supplies either.
 * Legal vocabulary belongs to #8: null means no legal identity has been given.
 */
export interface DisplayContact extends Body {
	/** A producer declares the hull type; never inferred from the display name. */
	shipType?: HullId;
	velocity: Vec3;
	legalStatus: null;
	scannerClass: "unknown" | "civilian" | "hostile" | "station";
}

export function isDisplayContact(body: Body): body is DisplayContact {
	return "velocity" in body;
}

/** The green a canister is drawn and listed in, as one number (#324). */
export const CARGO_CONTACT_COLOUR = 0x96f0aa;

/**
 * The Target panel's closing figure. Positive closes, and the words carry the
 * sign because a bare minus on a moving number is easy to miss at the moment
 * it matters — the last hundred metres of a scoop, where the gate is 0.25 km/s.
 */
export function closingLabel(kms: number | null): string {
	if (kms === null) return "";
	return `${kms >= 0 ? "CLO" : "OPN"} ${Math.abs(kms).toFixed(2)} km/s`;
}

/** The right cockpit Target panel's designation, independent of its name. */
export function targetDesignation(body: Body | null): string {
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
	return ["SHIP", body.shipType?.toUpperCase(), body.scannerClass.toUpperCase()]
		.filter(Boolean)
		.join(" · ");
}
