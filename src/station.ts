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
 * **The outpost is the raider's haven (#490), and it is placed but not yet
 * an economy.** #490 ruled what it is; node #491 puts one in every system at
 * the lawless end of the government scale (`system.ts`'s `hasRaiderOutpost`).
 * What it sells (#490 D6) is still unbuilt, so its berths are closed to every
 * pilot (`STATION_BERTHS_OPEN`) and every economy table below answers for it
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
	 * as a tunnel skewed against the **aperture frame** it is cut into.
	 *
	 * **One number, authored here and read by both tiers.** `apertureFrame`
	 * builds the checks' plane from it and `station-mesh.ts`'s selected forms cut
	 * their aperture at it, so the two cannot drift; `tests/station-mesh.test.ts`
	 * asserts the drawn hull comes up to it, which is the seam nothing checked.
	 *
	 * Every entry is a plain figure rather than a form's own arithmetic
	 * re-derived. `0.6 × 0.95 × √½ × 1.06` sat here for one commit, and it was this
	 * module owning a silhouette: a retune in `station-mesh.ts` would not have
	 * reached it.
	 *
	 * **Each form still computes its own surface**, and that is deliberate.
	 * Deriving a hull *from* this number was tried for the Coriolis and
	 * withdrawn: it makes `tests/station-mesh.test.ts`'s hull-reaches-the-plane
	 * row a restatement rather than an assertion, on the one form whose face and
	 * plane were 172 m apart. Two paths to one number is the check; one path is
	 * a tautology.
	 *
	 * A form is free to have no surface at this depth — the workbench alternates
	 * do not — and the connectivity check is what says so.
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
 * A station form's id within its role. The forms themselves are drawings and
 * live in `station-mesh.ts`, which re-exports this; the id is here so a
 * Three-free module — the collision proxy — can name a form without its
 * dependency arrow pointing at the renderer.
 */
export type StationFormId = "a" | "b" | "c" | "d" | "e";

/**
 * What a builder or the collision proxy reads off a generated station: its
 * role, its form and its two seeds (node #717). `Station` (`system.ts`) carries
 * all four, so a station is passed whole; a test or a workbench names them.
 * One declaration, so the next per-station field is one edit here rather than
 * one per signature.
 */
export interface StationPlan {
	readonly type: StationType;
	readonly formId: StationFormId;
	readonly berthSeed: number;
	readonly assemblySeed: number;
}

/**
 * The forms a station of each role may be built in, and the system's own seed
 * picks among them (node #717). The forms are drawings in `station-mesh.ts`;
 * the pools are here so the Three-free generator (`system.ts`, through
 * `station-form.ts`) and the collision proxy (`station-proxy.ts`) read the
 * same table as the renderer.
 *
 * This replaced `SELECTED_FORM`, one form per role for the whole galaxy. With
 * it gone, every reader asks the station which form it is — `Station.formId` —
 * and nothing can answer per type, which is the half that matters: two
 * stations of one role may now differ, so a per-type answer about a form's
 * reach, proxy or mesh is wrong the moment a pool holds two.
 *
 * Node #744 (https://github.com/jcfischer/seelite/issues/744) admits every
 * built form to its pool, uniformly drawn in form-id order (2026-10-07).
 * The trade pool holds Coriolis, Ring, Drum, Assembly and Wheel (nodes
 * #747–#748). The refinery holds Warren, Collar, Spar and
 * Works (node #745), and the shipyard Gantry, Hangar and Slipway (node #746). // glossary-ignore: Hangar
 * The principal has seen every form in the station viewer; the ruling waives
 * another visual sign-off for pooling. The outpost keeps its fiction-owned form.
 * The Wheel's slot is cut into `hub`, not its rim named `core`; bay and
 * aperture-plane rows measure that hub (and `station-wheel.test.ts` its section).
 *
 * Every added form owes a collision proxy, the display budget, and the
 * per-form interior, corridor, finish, fixture and glow rows. Those iterate
 * `formsInPlay`; node #717's receipt lists the named rows alongside them.
 * The ruling waives a candidate sheet and principal visual sign-off; report
 * which canonical views move with `scripts/measure-station-forms.ts` instead.
 *
 * **A pool's order is part of it, and so is its length.** `drawStationForm`
 * turns a system's roll into a position, `floor(roll × n)`. Appending one
 * member re-draws half of that role's systems whatever `n` is; swapping two
 * members re-draws `2/n` of them. `tests/station-form.test.ts` holds those
 * shares over a seed spread. `enumerateCarriers` does not read the form, so
 * no saved carrier key moves; only the drawn station and collision proxy do.
 */
export const STATION_FORM_POOL: Record<
	DrawnStationType,
	readonly StationFormId[]
> = {
	trade: ["a", "b", "c", "d", "e"],
	shipyard: ["a", "b", "c"],
	refinery: ["a", "b", "c", "d"],
};

/**
 * The roles a system draws a form for: every role but the outpost.
 *
 * **The outpost is not drawn.** #490 made it the raiders' station and #518 built
 * Salvage for that fiction, on the principal's yes to its sheet (2026-09-24);
 * it is what every lawless system draws since node #491. Which outpost a
 * system shows is a question for the fiction map (#460), not a free pick, so
 * the type keeps it out of the pool rather than a comment asking nobody to put
 * it in.
 */
export type DrawnStationType = Exclude<StationType, "outpost">;

/**
 * The roles a system draws a form for. The order moves no draw: each role
 * reads its own sub-stream, keyed by `STATION_FORM_SLOT` in `station-form.ts`.
 */
export const DRAWN_STATION_TYPES: readonly DrawnStationType[] = [
	"trade",
	"shipyard",
	"refinery",
];

/** The one form an outpost is built in: Salvage (see `DrawnStationType`). */
export const OUTPOST_FORM: StationFormId = "e";

/**
 * Every form a station of this role can be built in by a running game — its
 * pool, or the outpost's one form. What every per-form row iterates: a
 * form that can be drawn owes a reach, a proxy and a mesh that agree, and a
 * form that cannot be drawn owes none of them (#663's rule).
 */
export function formsInPlay(type: StationType): readonly StationFormId[] {
	return type === "outpost" ? [OUTPOST_FORM] : STATION_FORM_POOL[type];
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
		// **Authored here, and the Coriolis's hull is derived from it** — the
		// form sizes its circumradius so that a square face lands under this
		// plane, rather than this number re-deriving the form's drawing
		// constants. §3's checks are evaluated here, so this is the contract and
		// the silhouette follows.
		// 428 m: the smallest round figure that keeps the derived hull at or above
		// the `0.95 × core` reach `tests/station-mesh.test.ts` budgets for.
		aperturePlaneKm: 0.428,
		aperture: { kind: "slot", widthKm: 0.12, heightKm: 0.07 },
		axis: "parent",
		spins: true,
	},
	shipyard: {
		// The same Coriolis core as the trade station — the drydock frame beside it
		// is silhouette, not dockable geometry, so it changes what you *see* and
		// nothing about what you fly into.
		coreRadiusKm: 0.6,
		// Every shipyard form's hub face, 372 m: the Gantry's, and since node
		// #746 the Hangar's and the Slipway's, which were built 12 m either side. // glossary-ignore: Hangar
		aperturePlaneKm: 0.372,
		aperture: { kind: "slot", widthKm: 0.12, heightKm: 0.07 },
		axis: "parent",
		spins: true,
	},
	refinery: {
		coreRadiusKm: 0.4,
		// The Warren's deck, which sits just inside its own rock, 396 m.
		aperturePlaneKm: 0.396,
		aperture: { kind: "pad", widthKm: 0.15, heightKm: 0.15 },
		axis: "outward",
		spins: false,
	},
	outpost: {
		// A quarter of a trade station's core, which is the point of it: a raider's
		// haven welded together from salvage round a landing pad (#490, #518),
		// small enough that the pile of other ships' wreckage is the silhouette.
		// Sized in #56 for an industrial machine; the figure stood when the
		// role changed, and the form grew into it rather than the other way.
		coreRadiusKm: 0.15,
		// The Derrick's top deck, which stands proud of its core, 165 m.
		aperturePlaneKm: 0.165,
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
	// #490 D6 makes the raider outpost a fence, and reopens §5.2's geography
	// to do it. It stays `false` until the outpost has a market at all
	// (`TYPE_OFFSET` in `market.ts` has no row for it): a fence flag on a
	// station that trades nothing is a lie the market's node would inherit.
	outpost: false,
};

/**
 * Whether a type's berths admit anybody (node #491).
 *
 * **The raider outpost's are closed, and that is the explicit absence of its
 * docking contract rather than an oversight.** #490 D5 rules that only a Wanted
 * pilot may dock there — `dockingRefusedByLaw` carries that arm — but a pilot
 * admitted would dock into a console built on a `TYPE_OFFSET` row the outpost
 * does not have (`main.ts`'s `dockedStationContext`, #490 D6), and every tab of
 * it — market, equipment, fuel — would throw. So until that market
 * exists the berth refuses every pilot, with its own reason (`docking.ts`'s
 * `"closed"`), rather than a clean pilot being told they are hostile or a Wanted
 * one docking into a throw.
 *
 * A table rather than a read of `TYPE_OFFSET`, so the market's node has to open
 * the berth as an act: an offset added for pricing alone would otherwise open it
 * silently. `tests/raider-outpost.test.ts` holds the other direction — no type's
 * berths are open without a market behind them.
 */
export const STATION_BERTHS_OPEN: Record<StationType, boolean> = {
	trade: true,
	shipyard: true,
	refinery: true,
	outpost: false,
};

/**
 * Whether a type is a lawful station — every one but the raider outpost (#490).
 *
 * One table for the line #490 draws, read in three places that each answer a
 * different question about it:
 *
 * - **It witnesses (#490 D10).** `distress.ts`'s `stationsInEarshot` files only
 *   a lawful station, so the witness list a save carries never names an
 *   outpost. That is the witness half and nothing more: `legal.ts`'s
 *   `chargeOffence` prices the heat from the act, not from who heard it, so an
 *   offence beside an outpost still costs heat and can still make the pilot
 *   Wanted, and every shipyard refuses that on standing alone. What it cannot
 *   do is put the outpost among the stations that refuse for what they saw.
 * - **It posts the Bounty (#495 D4).** "Every lawful in-system station";
 *   `jobs.ts`'s `bindBounty` reads this, because a raider haven does not pay to
 *   kill raiders' equipment.
 * - **Its Traffic trades with its own side (node #491).** A carrier homed at a
 *   lawful station is never routed to the outpost, and the outpost's own Traffic
 *   to none of them (`station-route.ts`), so placing an outpost moved no
 *   existing carrier's schedule: the lanes and queues at every lawful berth are
 *   what they were. With no second outpost in a system its Traffic leaves the
 *   system abstractly and comes home.
 */
export const STATION_LAWFUL: Record<StationType, boolean> = {
	trade: true,
	shipyard: true,
	refinery: true,
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
