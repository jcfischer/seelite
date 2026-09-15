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
