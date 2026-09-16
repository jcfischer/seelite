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
