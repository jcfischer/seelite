/**
 * What a station *is*, physically: its type, its dockable geometry, and the
 * rules its two seeded fields follow.
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
 * **The draws themselves live in `system.ts`**, next to the streams they consume:
 * how many numbers a station takes from `DOMAIN.STATION_FLAGS` and
 * `DOMAIN.STATION_SPIN`, and in what order, is generator discipline rather than
 * a property of a station — and `station-mesh.ts` imports this module without
 * wanting any of it.
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

/**
 * The same three, as a value.
 *
 * Every table below is a `Record<StationType, …>`, so the *type* is already the
 * thing a fourth station type breaks the build against. This is for the callers
 * that need to iterate — the model workbench's role tabs, the tests' loops —
 * and it is here rather than written out at each of them so there is one list
 * to extend rather than several to remember.
 */
export const STATION_TYPES: StationType[] = ["trade", "shipyard", "refinery"];

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
	 * Whether the station rotates about that axis (`docking.md` §4).
	 *
	 * Here rather than in a second `Record<StationType, boolean>` beside this
	 * one: spin is a physical property of the object, and a parallel table keyed
	 * on the same union costs a second edit for every new type — which is the
	 * build-breaking guarantee working half as hard as it should.
	 *
	 * `false` for the refinery's fixed pad, which is what removes the roll match
	 * from its docking interaction (`station-types.md` §6).
	 */
	spins: boolean;
}

/**
 * **The display budget is not here.** How far a station's *drawn* object
 * reaches — the drydock frame, the asteroid, the flare stacks — is
 * `STATION_SILHOUETTE_KM` in `station-mesh.ts`, keyed on the same union.
 *
 * Two tables in two files, deliberately: `docking.md` §5 says the frame is
 * silhouette and not dockable geometry, and this record is what #9's checks
 * read. The separation is what makes "docking may not read it" a fact about
 * imports rather than a comment. The cost is that a fourth station type is two
 * edits, which is why this paragraph is here — so the second one is findable
 * from the first.
 */

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
		spins: true,
	},
	shipyard: {
		// The same Coriolis core as the trade station — the drydock frame beside it
		// is silhouette, not dockable geometry, so it changes what you *see* and
		// nothing about what you fly into.
		coreRadiusKm: 0.6,
		aperture: { kind: "slot", widthKm: 0.2, heightKm: 0.07 },
		axis: "parent",
		spins: true,
	},
	refinery: {
		coreRadiusKm: 0.4,
		aperture: { kind: "pad", widthKm: 0.15, heightKm: 0.15 },
		axis: "outward",
		spins: false,
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

/**
 * Which types can be a fence (`station-types.md` §5.2). The refinery is the
 * seeded contraband market; nothing else trades illegal goods.
 *
 * Its own table rather than a field on `STATION_GEOMETRY`, where `spins` went:
 * this is an economy fact, and #9's docking checks read that record. Folding an
 * economy flag into the geometry the checks read is the same mistake as leaving
 * the display budget there, which this round moved out.
 */
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
