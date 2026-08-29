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

/**
 * The three types #6 named and #13 specified, plus #56's outpost.
 *
 * **The outpost is a form and a geometry, not yet an economy.** #13 fixed what
 * a station type means for the market, for equipment and for law, and it did so
 * for three types; nothing here decides what an outpost sells, whether it can
 * be a fence, or how often the generator places one. Those are #13's and #6's
 * questions and they need their own node. Until then `system.ts` places none,
 * so no outpost exists in a running game and every table below answers for it
 * conservatively — which is visible rather than assumed, because a
 * `Record<StationType, …>` cannot compile without an answer.
 */
export type StationType = "trade" | "refinery" | "shipyard" | "outpost";

/**
 * The four, as a value.
 *
 * Every table below is a `Record<StationType, …>`, so the *type* is already the
 * thing a fourth station type breaks the build against. This is for the callers
 * that need to iterate — the model workbench's role tabs, the tests' loops —
 * and it is here rather than written out at each of them so there is one list
 * to extend rather than several to remember.
 */
export const STATION_TYPES: StationType[] = [
	"trade",
	"shipyard",
	"refinery",
	"outpost",
];

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
	/**
	 * Where the aperture plane is, kilometres from the station's centre —
	 * **the surface `docking.md` §3's six checks are evaluated at**, and the
	 * surface the selected form cuts its aperture into.
	 *
	 * **Not `coreRadiusKm`, which is what it was until #128.** The core radius
	 * is a body's `radiusKm` — for the trade station a cuboctahedron's *vertex*
	 * radius, where its square faces sit at `r/√2`. The slot is cut into one of
	 * those faces (that is the form's whole thesis), so the plane and the slot
	 * were 173 m apart on the trade station and 228 m on the shipyard: a ship
	 * crossed §3's plane well before it reached the opening it could see, and
	 * everything §12 measures from the plane — the throat, the docked position —
	 * landed behind everything the player was looking at. Reported flying it as
	 * *"the tunnel is skewed in relation to the docking port"* — the principal's
	 * words, quoted; `CONTEXT.md` §Language calls that surface the **aperture
	 * frame**, and a bug report is not the place to insist on it.
	 *
	 * **One number, read by both tiers.** `apertureFrame` builds the checks'
	 * plane from it and `station-mesh.ts`'s selected forms cut their aperture at
	 * it, so the two cannot drift; `tests/station-mesh.test.ts` asserts the
	 * drawn face is here, which is the seam nothing checked. A form is free to
	 * have no surface at this depth — the workbench alternates do not — and the
	 * connectivity check is what says so.
	 */
	aperturePlaneKm: number;
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
 * **The aperture dimensions were provisional and are now measured.** §5 fixed
 * them pending #26's hull roster; the roster exists (#35 built eleven roles)
 * and `tests/aperture-fit.test.ts` measures it, so the figures below are
 * derived rather than placeholders.
 *
 * The slot went from 200 × 70 m to **120 × 70 m**, ratified 2026-08-26. The old
 * width was 3.7× the widest ordinary hull's beam and read as a hangar door on a
 * 1.24 km station — 16% of its whole width, against about 10% for the reference
 * Coriolis.
 *
 * **Only the width moved, and the first attempt moved the height too.** §10
 * requires the slot to admit the largest hull *at check 4's 50° roll limit*,
 * not axis-aligned, and a rolled rectangle needs `w·cos θ + h·sin θ` across and
 * `w·sin θ + h·cos θ` up. Measured over the roster at 50°, the binding figures
 * are 62.8 m and 63.4 m — so height is the dimension with almost no room in it,
 * and 60 m was 3.4 m short of a slot the docking checks would have accepted a
 * ship through. §10 is explicit about the remedy: the aperture moves, not the
 * tolerance.
 *
 * At 120 × 70 the margins are 57.2 m across and 6.6 m up, which is the skill tax
 * `docking.md` §3 wants and the reason the height is not a dial.
 *
 * They are read from here by the meshes, the docking checks and the probes
 * rather than restated, so a retune is one edit in one place — and every form's
 * dock frame is sized *from* these numbers, so the drawn opening follows.
 */
export const STATION_GEOMETRY: Record<StationType, StationGeometry> = {
	trade: {
		coreRadiusKm: 0.6,
		// The Coriolis's square face, a hair proud of it: the hull is drawn at
		// `0.95 × core` and a cuboctahedron's square faces sit at `1/√2` of its
		// circumradius, with the frame standing 6% out from there.
		aperturePlaneKm: 0.6 * 0.95 * Math.SQRT1_2 * 1.06,
		aperture: { kind: "slot", widthKm: 0.12, heightKm: 0.07 },
		axis: "parent",
		spins: true,
	},
	shipyard: {
		// The same Coriolis core as the trade station — the drydock frame beside it
		// is silhouette, not dockable geometry, so it changes what you *see* and
		// nothing about what you fly into.
		coreRadiusKm: 0.6,
		// The Gantry's hub face.
		aperturePlaneKm: 0.6 * 0.62,
		aperture: { kind: "slot", widthKm: 0.12, heightKm: 0.07 },
		axis: "parent",
		spins: true,
	},
	refinery: {
		coreRadiusKm: 0.4,
		// The Warren's deck, which sits just inside its own rock.
		aperturePlaneKm: 0.4 * 0.99,
		aperture: { kind: "pad", widthKm: 0.15, heightKm: 0.15 },
		axis: "outward",
		spins: false,
	},
	outpost: {
		// A quarter of a trade station's core, which is the point of it: an
		// industrial structure rather than a habitat, small enough that its whole
		// silhouette is a machine.
		coreRadiusKm: 0.15,
		// The Derrick's top deck, which stands proud of its core.
		aperturePlaneKm: 0.15 * 1.1,
		// A **pad**, and nothing else. It does not spin, so `docking.md` §4's roll
		// match does not apply to it, exactly as it does not to the refinery — and
		// the pad is what the whole category is built around rather than a
		// consequence of the shape.
		aperture: { kind: "pad", widthKm: 0.12, heightKm: 0.12 },
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
	// Conservative, and deliberately so: #13 made the refinery *the* seeded
	// contraband market, and a second fence would change the geography that
	// decision rests on. Whether a remote industrial outpost is the better fence
	// is a real question and it belongs to #13, not to a visual round.
	outpost: false,
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

/**
 * The system-local carrier-slot persistence ID, per station type
 * (`persistent-world-state.md` §2).
 *
 * **A table rather than a reuse of `Station.id`.** V1's strings are the same
 * ones `system.ts` already assigns, and the spec explicitly permits that — but
 * it requires the persistence identity to be *exposed and tested* rather than
 * inferred from a display key, because the two have different contracts. A
 * station's `id` may be renamed for the map screen; a carrier id may not,
 * because a saved market deficit is keyed on it and a rename silently orphans
 * every row.
 *
 * The full key is `(galaxyIndex, systemIndex, localCarrierId)`. This half is
 * system-local: `station-trade` names one station in every system in the
 * galaxy, which is why `economy-trade.md` §5.5 keys the deficit map on the
 * envelope-relative pair and not on this string alone.
 */
export const LOCAL_CARRIER_ID: Record<StationType, string> = {
	trade: "station-trade",
	refinery: "station-refinery",
	shipyard: "station-shipyard",
	outpost: "station-outpost",
};
