/** Field centres are contacts, never masses (node #971, #949 D6). */
import {
	type FieldPlan,
	fieldCentre,
	fieldCentreVelocity,
	systemFields,
} from "./asteroid-field";
import type { DisplayContact } from "./display-contact";
import type { System } from "./sim";
import { type Vec3, length, sub, v3 } from "./vec3";

const systems = new WeakMap<
	System,
	{
		plans: FieldPlan[];
		contacts: DisplayContact[];
		at: number;
	}
>();

function rowAt(system: System, gameTime: number) {
	let row = systems.get(system);
	if (!row) {
		const plans = systemFields(system.record, system.contents);
		row = {
			plans,
			contacts: plans.map((plan) => ({
				id: plan.id,
				name:
					plan.profile === "charted" ? "Asteroid field" : "Rare asteroid field",
				kind: "field",
				pos: v3(),
				// A point endpoint: the 50 km arrival radius clears the whole field.
				radiusKm: 0,
				color: 0xaaa090,
				velocity: v3(),
				standing: null,
				scannerClass: "unknown",
			})),
			at: NaN,
		};
		systems.set(system, row);
	}
	if (row.at !== gameTime) {
		for (let i = 0; i < row.plans.length; i++) {
			row.contacts[i].pos = fieldCentre(row.plans[i], gameTime);
			row.contacts[i].velocity = fieldCentreVelocity(row.plans[i], gameTime);
		}
		row.at = gameTime;
	}
	return row;
}

/** Stable objects for the selection cache, evaluated at the current clock.
 * A new System (jump/restore) gets its own set; departed sets can be collected.
 * No rock generation, body mutation, or saved state is involved.
 */
export function fieldContactsAt(
	system: System,
	gameTime: number,
): DisplayContact[] {
	return rowAt(system, gameTime).contacts;
}

/** The field whose centre is nearest `pos` and closer than `withinKm`, or
 *  `null` (#1139). The local frame's field: a frame is a velocity, so a field
 *  can be one and still never be a mass (#949 D6). */
export function nearestFieldPlan(
	system: System,
	pos: Vec3,
	gameTime: number,
	withinKm: number,
): FieldPlan | null {
	const row = rowAt(system, gameTime);
	let best: FieldPlan | null = null;
	let bestKm = withinKm;
	for (let i = 0; i < row.plans.length; i++) {
		const km = length(sub(row.contacts[i].pos, pos));
		if (km < bestKm) {
			best = row.plans[i];
			bestKm = km;
		}
	}
	return best;
}
