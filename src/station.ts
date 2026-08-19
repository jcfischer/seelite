/**
 * What a station *is*, physically: its type, its dockable geometry, its spin,
 * and the two seeded fields that hang off the type.
 *
 * `docs/specs/docking.md` §4 and §5 and `docs/specs/station-types.md` §5 and §8
 * between them fix every number here. This module exists so that those numbers
 * have exactly one home, reachable from three sides that must not disagree: the
 * generator (`system.ts`) fills the fields, the simulation (`sim.ts`) reads the
 * geometry, and the renderer (`station-mesh.ts`) builds the silhouette from it.
 * A copy in the renderer is the failure this prevents — a slot drawn at a size
 * the docking checks do not use is invisible to every headless test and is
 * exactly the class of error the two-tier verification split exists for.
 *
 * **No Three.js here**, deliberately. `sim.ts` imports this, and the repo's rule
 * is that the authoritative world is float64 kilometres outside the scene graph.
 * The Three-side companion is `station-mesh.ts`, which imports this module and
 * not the other way round.
 *
 * `StationType` lives here rather than in `system.ts` because every table below
 * is keyed on it: the type and the tables that must answer for every one of its
 * members belong together, so adding a fourth type puts the compile errors next
 * to each other. `system.ts` re-exports it, so existing importers are unchanged.
 */

/** The three types #6 named and #13 specified. */
export type StationType = "trade" | "refinery" | "shipyard";

/** What you fly through, and how big it is (`docking.md` §5). */
export interface StationAperture {
	/** A slot is cut in the spin axis and rotates with the station; a pad does
	 *  not rotate at all, which is what removes check 4 for the refinery (§6). */
	kind: "slot" | "pad";
	widthKm: number;
	heightKm: number;
}

export interface StationGeometry {
	/** The dockable core, kilometres. This is the body's `radiusKm`. */
	coreRadiusKm: number;
	aperture: StationAperture;
	/**
	 * Where the aperture faces.
	 *
	 * `parent` — toward the planet it orbits, 1984's "face nearest the planet".
	 * `outward` — radially away from the star, for the star-centric refinery,
	 * which has no parent body to face.
	 */
	axis: "parent" | "outward";
	/**
	 * How far the *drawn* object reaches, kilometres — the drydock frame, the
	 * captured asteroid, the flare stacks.
	 *
	 * Not dockable geometry (`docking.md` §5) and nothing about docking may read
	 * it. It is a **budget, not a description**: `tests/station-mesh.test.ts`
	 * asserts that no vertex of the built mesh lies outside it, so a frame or a
	 * flare stack cannot quietly grow. The shipyard's 1.5 km is §5's own figure;
	 * the refinery's is this build's, set from what the mesh measures so that
	 * later growth is a failing test rather than a discovery.
	 */
	silhouetteRadiusKm: number;
}

/**
 * Per-type geometry (`docking.md` §5).
 *
 * A `Record<StationType, …>` rather than a lookup with a default, for
 * `station-types.md` §8.5's reason: a fourth station type must stop the build
 * until this table answers for it. A defaulted table would silently give it a
 * trade station's slot.
 *
 * **The aperture dimensions are provisional.** §5 fixes them pending #26's hull
 * roster, which owes the largest ship the slot has to admit. They are read from
 * here by the meshes and the probes rather than restated, so widening them is
 * one edit in one place.
 */
export const STATION_GEOMETRY: Record<StationType, StationGeometry> = {
	trade: {
		coreRadiusKm: 0.6,
		aperture: { kind: "slot", widthKm: 0.2, heightKm: 0.07 },
		axis: "parent",
		silhouetteRadiusKm: 0.6,
	},
	shipyard: {
		// The same Coriolis core as the trade station — the drydock frame beside it
		// is silhouette, not dockable geometry, so it changes what you *see* and
		// nothing about what you fly into.
		coreRadiusKm: 0.6,
		aperture: { kind: "slot", widthKm: 0.2, heightKm: 0.07 },
		axis: "parent",
		silhouetteRadiusKm: 1.5,
	},
	refinery: {
		coreRadiusKm: 0.4,
		aperture: { kind: "pad", widthKm: 0.15, heightKm: 0.15 },
		axis: "outward",
		// The captured asteroid the drum is sunk into, plus the flare stacks —
		// measured at 0.848 km on the built mesh, and rounded up to a budget.
		silhouetteRadiusKm: 0.9,
	},
};

/**
 * The spin range (`docking.md` §4): uniform, wide, uncorrelated with anything.
 *
 * 0.6–3.0 rpm is a 5× spread, and the spread is the difficulty dial — 41.7% of
 * Coriolis stations land above 2 rpm, so the hard end is common rather than
 * rare. Narrowing it is a gameplay decision, not a tuning one.
 */
export const SPIN_RPM_RANGE = { minRpm: 0.6, maxRpm: 3.0 } as const;

/** Which types rotate. The refinery's pad is fixed, which is what removes the
 *  roll match from its docking interaction (`station-types.md` §6). */
export const STATION_SPINS: Record<StationType, boolean> = {
	trade: true,
	shipyard: true,
	refinery: false,
};

/** Which types can be a fence (`station-types.md` §5.2). The refinery is the
 *  seeded contraband market; nothing else trades illegal goods. */
export const STATION_FENCE_ELIGIBLE: Record<StationType, boolean> = {
	trade: false,
	shipyard: false,
	refinery: true,
};

/**
 * How likely a refinery is a fence, by government (`station-types.md` §5.2).
 *
 * `0.95 - 0.125·g`, a linear ramp from Anarchy to Corporate State. It needs no
 * clamp: the expression stays inside (0, 1) across the whole 0–7 domain, and a
 * guard that cannot fire is dead weight that reads as a real safety rule.
 */
export const fenceProbability = (government: number): number =>
	0.95 - 0.125 * government;

/**
 * Draw a station's spin, consuming exactly one number whatever its type.
 *
 * **The refinery draws and discards** (`docking.md` §5). Skipping the draw would
 * make the draw count depend on station type, so inserting a refinery would
 * shift the spin of every station generated after it — the stream coupling the
 * per-domain tags exist to prevent, reintroduced inside a single tag. The
 * discard is therefore the point of this function, not an inefficiency in it.
 */
export function drawSpinRpm(rand: () => number, type: StationType): number {
	const roll = rand();
	if (!STATION_SPINS[type]) return 0;
	return (
		SPIN_RPM_RANGE.minRpm +
		roll * (SPIN_RPM_RANGE.maxRpm - SPIN_RPM_RANGE.minRpm)
	);
}

/** Draw the fence flag, on the same draw-and-discard rule and for the same
 *  reason: every station consumes one number from `DOMAIN.STATION_FLAGS`. */
export function drawBlackMarket(
	rand: () => number,
	type: StationType,
	government: number,
): boolean {
	const roll = rand();
	return STATION_FENCE_ELIGIBLE[type] && roll < fenceProbability(government);
}

/**
 * Where the slot has rotated to at `gameTime`, radians (`docking.md` §4.1).
 *
 * A pure function of the spin and the clock, computed in sim and *mirrored* by
 * the renderer — never read back off an `Object3D`. Without that rule the
 * obvious implementation reads the phase off the rendered station, which makes
 * the docking checks depend on frame timing.
 *
 * Wrapped into [0, 2π) rather than left to grow: the game clock runs for hours,
 * and `2π · 3 · 3600 / 60` is a number whose low bits are the answer.
 */
export function slotPhaseRad(spinRpm: number, gameTime: number): number {
	if (spinRpm === 0) return 0;
	const TAU = Math.PI * 2;
	const phase = (TAU * spinRpm * gameTime) / 60;
	const wrapped = phase % TAU;
	return wrapped < 0 ? wrapped + TAU : wrapped;
}
