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

/**
 * The Target panel's relative-speed figure: the size of the velocity between
 * ship and target, which is the quantity `scoops` gates on (0.25 km/s).
 *
 * **A magnitude, with no direction word beside it** (sage #353). This printed
 * the speed *along the line* to the target under a `CLO`/`OPN` label, which is
 * a different number: at closest approach the speed along the line is zero by
 * definition, so a canister crossing at any speed read `CLO 0.00` and a pilot
 * who trusted it failed the scoop with no warning. The range beside it already
 * shows whether the gap is closing.
 */
export function relativeLabel(kms: number | null, separator = " · "): string {
	if (kms === null) return "";
	// The separator belongs to the label, so nothing selected leaves no dangling
	// bullet on the end of the line (sage #353).
	return `${separator}REL ${kms.toFixed(2)} km/s`;
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
