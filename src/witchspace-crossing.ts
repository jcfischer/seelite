/**
 * A jump crossing, as someone **watching** experiences it (node #1006).
 *
 * The player's own transition is `witchspace.ts`'s, and it has drama: the sky
 * crowds forward, the dark closes to a point, the tunnel is ridden, the new
 * light catches up. A watcher has none of that. They see a world-anchored ring
 * and a hull, and at `c1eacb4` what they saw was this — the ring was already
 * open, the ship was simply inside it, and a few seconds later it was gone. The
 * principal's read of a capture of seed 47's first hauler: *"the witchspace is
 * open in first frame, the ship magically appears and then magically
 * disappears. No idea where it went. … No sense of drama when witchspace
 * opens."*
 *
 * ## The answer: a crossing has an order
 *
 * `CROSSING` is one timeline, keyed on the **crossing instant** — the moment the
 * ship's hull passes the ring's plane — and read with a signed age, so it can
 * run before that instant as well as after it. Three beats, in this order:
 *
 * 1. **Opening.** The ring tears open out of empty space: nothing is in it yet.
 *    `npcRiftStrength` opened the ring over 0.5 s *after* the jump instant, so
 *    the first frame a watcher got was a ring already three-quarters open.
 * 2. **The crossing.** The hull comes through the plane, and the ring flares as
 *    it does. An arrival eases out of the ring and settles at the lane point; a
 *    departure eases into it and is gone at the instant. This is
 *    `emergenceOffset`, and the route law owns it — the drawn hull and the
 *    swept collision box are placed by the same number (`#43`: a probe that
 *    aims at a stale readout reports a hit while the hull never drops).
 * 3. **Sealing.** The ring collapses and winks out, and the second flare marks
 *    it. `WITCHSPACE`'s exit faded the rift over 1.9 s, so nothing ever
 *    answered *where did it go*. A closing answers it.
 *
 * ## Why both ends share one timeline
 *
 * A departure is the same event backwards, and the route already gives both
 * ends the same room: `JUMP_CHARGE_S` of wind-up before the instant, and the
 * ring's own window after it. One table means a watcher learns to read one
 * thing — a ring opening ahead of a ship means *a ship is coming*, and one
 * closing behind it means *it has gone* — rather than two that happen to look
 * alike.
 *
 * ## Why the numbers are not `WITCHSPACE`'s
 *
 * `WITCHSPACE`'s exit clock is keyed on the *cut* and drives screen-space terms
 * the pilot watches through a cover, and the principal judged it on the phase
 * strip and in flight (#532). Reusing its offsets is what produced the defect:
 * `npcRiftStrength` borrowed the player's unfold, and so an NPC's ring could
 * only start opening after its ship had arrived. This file borrows nothing from
 * it, and `witchspace.ts` reads the flare from here.
 *
 * ## What the timing is judged on
 *
 * Nothing headless can see whether a 1.5 s opening reads as a build-up — that
 * is the view rows' (`npc-arrival-*`, `npc-departure-*` in
 * `scripts/lib/view-set.mjs`) and the principal's yes. The tests here hold the
 * *order* and the bounds: monotone opening, full at the crossing, nothing at
 * both ends, the whole hull across the plane and no more, the crossing inside
 * the wind-up that hosts it, and the flare under #199's exposure budget.
 *
 * Nothing here imports Three.js, and `station-route.ts` — the sim's route law —
 * imports this, so the leaf keeps the renderer out of the headless tier.
 */
import type { HullBoxCentre, HullEnvelope } from "./hull";
import { type Vec3, scale } from "./vec3";

export const CROSSING = Object.freeze({
	/**
	 * Seconds before the crossing the ring begins to open. Long enough to turn
	 * and look at: the `arrival` capture's camera was already 0.2 km from the
	 * ring and still saw no opening.
	 */
	openS: 1.5,
	/** Seconds after the crossing the ring stays full — the ship's business. */
	holdS: 3.6,
	/** Then it collapses, for this long, and is gone. */
	sealS: 1.2,
	/**
	 * How long the hull takes to cross the plane, either way. The route gives a
	 * departure `JUMP_CHARGE_S` of wind-up and an arrival the same hold before
	 * it engages cruise, so the crossing has to fit in that; 1.2 s leaves both
	 * ends room and is still slower than a hull settling into a berth.
	 */
	crossS: 1.2,
	/**
	 * How far aft of the lane point an arriving hull starts, and how far ahead a
	 * departing one ends, in that hull's own radial extent (`crossingDistanceKm`).
	 * Two of them cover the two things the crossing has to clear: one for the
	 * ring's own standoff, which stands one hull reach off the lane point, and one
	 * for the hull's aft extent, so a *whole* hull passes the plane rather than
	 * its nose alone. Over-estimating is the safe side — the end state is the lane
	 * point either way, so a longer lead only puts the hull further back at the
	 * first frame. Held against `HULL_REACH_KM`, which the rift is sized from, by
	 * a test: two tables naming one quantity drift (#11).
	 */
	emergeRadii: 2,
	/**
	 * The ring's brightness at the crossing and at the seal, over and above its
	 * strength. Additive on black space, so this is what a watcher's eye lands
	 * on; bounded below 0.8 by #199's exposure budget, which keeps an emissive
	 * under white, and by a test that the sum never passes 1.8.
	 */
	flarePeak: 0.6,
	/** The flare rises into the crossing and falls out of it. */
	flareRiseS: 0.35,
	flareFallS: 0.7,
	/** How far ahead of the seal's end its own flare runs. */
	sealFlareS: 0.5,
	/** The window after the crossing. */
	get windowEndS() {
		return this.holdS + this.sealS;
	},
	/** The whole visible span: opening, hold, seal. */
	get windowS() {
		return this.openS + this.holdS + this.sealS;
	},
});

/** What a ring draws: its strength drives size and light, the flare only light. */
export interface RiftLook {
	strength: number;
	flare: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
	const u = clamp01((x - a) / (b - a));
	return u * u * (3 - 2 * u);
};

/** Whether a ring is drawn at all at `ageS` seconds from its crossing. */
export const npcRiftVisible = (ageS: number): boolean =>
	ageS >= -CROSSING.openS && ageS < CROSSING.windowEndS;

/**
 * The flash that marks a hull passing the plane: nothing before `flareRiseS`,
 * the peak exactly at the crossing, nothing after `flareFallS`. Keyed on the
 * crossing and on nothing else, so an observer who sees it knows a ship has
 * just come through rather than that a ring happens to be bright.
 */
export const crossingFlare = (ageS: number): number =>
	smoothstep(-CROSSING.flareRiseS, 0, ageS) *
	(1 - smoothstep(0, CROSSING.flareFallS, ageS));

/**
 * The brightening of the last `sealFlareS` of a ring's life, ending at nothing
 * with the ring: the place closes, and the closing is the last thing seen.
 * `endS` is that ring's own end, because the player's ring and an NPC's do not
 * end on the same clock.
 */
export const sealFlare = (ageS: number, endS: number): number => {
	const start = endS - CROSSING.sealFlareS;
	return ageS >= endS ? 0 : smoothstep(start, endS, ageS);
};

/**
 * What a watcher sees of a ring at `ageS` seconds from its crossing. The age is
 * **signed**: negative through the opening, which is the whole point — a ring
 * that can only be drawn at a positive age cannot announce the ship coming.
 */
export function npcRiftLook(ageS: number): RiftLook {
	if (!npcRiftVisible(ageS)) return { strength: 0, flare: 0 };
	const W = CROSSING;
	const strength =
		ageS < 0
			? smoothstep(-W.openS, 0, ageS)
			: 1 - smoothstep(W.holdS, W.windowEndS, ageS);
	return {
		strength,
		flare: W.flarePeak * (crossingFlare(ageS) + sealFlare(ageS, W.windowEndS)),
	};
}

/** `npcRiftLook`'s strength alone — the size and light of the ring. */
export const npcRiftStrength = (ageS: number): number =>
	npcRiftLook(ageS).strength;

/**
 * The least sphere about a ship's sim position that holds its measured envelope:
 * the box `HULL_SPECS[id].env`, placed where `envCentre` says it sits (`#181`:
 * a selected mesh is not built about its origin). This is the hull's own radial
 * extent in the units the **sim** is allowed to read — the farthest corner of
 * the measured box, which bounds `ship-mesh.ts`'s `HULL_REACH_KM` (the
 * farthest *vertex* of the mesh) from above, since `env` is that box rounded up.
 *
 * The route law reads this and never `HULL_REACH_KM`, because `HULL_REACH_KM` is
 * a display figure and the sim's route is not allowed to depend on what a renderer
 * draws (`hull.ts`'s own docblock says so).
 */
export function crossingDistanceKm(
	env: HullEnvelope,
	centre: HullBoxCentre,
): number {
	return (
		CROSSING.emergeRadii *
		Math.sqrt(
			(Math.abs(centre.rightKm) + env.beamKm / 2) ** 2 +
				(Math.abs(centre.upKm) + env.heightKm / 2) ** 2 +
				(Math.abs(centre.foreKm) + env.lengthKm / 2) ** 2,
		)
	);
}

/**
 * How far a hull stands from its lane point, in that lane point's frame, at
 * `ageS` seconds from its crossing. Add it to the lane point to place the hull.
 *
 * - **`arrival`** — aft of the point at the crossing and forward through it, so
 *   the hull eases out of the ring and comes to rest on the point at
 *   `crossS`. The hold ends there, so the cruise leg that follows starts from
 *   the position and velocity it always started from: the schedule, the lane
 *   points, the wind-ups and every arrival time downstream are untouched.
 * - **`departure`** — the same law, run the other way: on the point
 *   `crossS` before the crossing and through the plane at the instant, so the
 *   hull is swallowed rather than deleted.
 *
 * One law for both directions on purpose: it is one event seen from either side.
 */
export function emergenceOffset(
	kind: "arrival" | "departure",
	ageS: number,
	distanceKm: number,
	nose: Vec3,
): Vec3 {
	const W = CROSSING;
	if (kind === "arrival")
		return scale(nose, -distanceKm * (1 - smoothstep(0, W.crossS, ageS)));
	return scale(nose, distanceKm * smoothstep(-W.crossS, 0, ageS));
}

/** `emergenceOffset`'s rate, km/s along the nose — the route's `vel` while it runs. */
export function emergenceVelocity(
	kind: "arrival" | "departure",
	ageS: number,
	distanceKm: number,
	nose: Vec3,
): Vec3 {
	const W = CROSSING;
	const u = clamp01(
		kind === "arrival" ? ageS / W.crossS : (ageS + W.crossS) / W.crossS,
	);
	// The derivative of the smoothstep above: zero at both ends, so a hull
	// arrives at rest and leaves from rest rather than snapping.
	return scale(nose, (distanceKm * 6 * u * (1 - u)) / W.crossS);
}
