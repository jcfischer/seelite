/**
 * The numbers behind #36's visual pass — surface, light, activity, and how much
 * of any of it is drawn (`docs/specs/station-visuals.md`).
 *
 * **No Three.js here, deliberately**, and for a sharper reason than `station.ts`
 * has. Everything below is arithmetic: a band over a scalar, a waveform over the
 * game clock, and the per-role figures the texel generators read. Kept as
 * arithmetic it runs in the headless tier, where a `DataTexture` whose buffer is
 * the wrong length can be caught by a length assertion instead of by someone
 * noticing that a station looks wrong. `station-mesh.ts` is the Three-side
 * companion and imports this; nothing here imports it back.
 *
 * **The texels themselves moved to `surface.ts` in #101**, which gave the
 * generators a second and a third consumer. What is left here is the station's
 * half: `STATION_VISUALS`, the waveforms, and two thin
 * wrappers that pass a role's profile to the shared generator with the role as
 * its hash tag. The directional detail state machine moved to
 * `detail-level.ts` when ships became its second consumer; this module keeps
 * compatibility re-exports rather than a second implementation.
 * `PLATE_TEXTURE_SIZE` and `PlatingProfile` are **not** re-exported
 * from here: two importable paths for one canonical name is how new code picks
 * the wrong one, and the handful of importers were repointed at `surface.ts`
 * instead. What this module owns is `STATION_VISUALS`, the per-role figures
 * `docs/specs/station-visuals.md` §4 describes, and the waveforms.
 *
 * **The plating is a `DataTexture`, never a `CanvasTexture`** (§4). This module
 * is reached from `tests/`, which has no `document`. A canvas would force a
 * `typeof document !== "undefined"` branch, and the branch that ships to players
 * would be the one no test ever takes.
 *
 * `station-mesh.ts` keeps its own `displayRand` for the asteroid and the window
 * grid. That is not a duplicate of `surface.ts`'s `hash01`: those feed
 * *geometry* built once at load, and this feeds texels and waveforms. Merging
 * them would put a shape and a light on the same stream, so a change to either
 * moves the other.
 */

import type * as THREE from "three";
import type { StationType } from "./station";
import {
	type MacroOctave,
	PLATE_TEXTURE_SIZE,
	type PlatingProfile,
	hash01,
	plateTexels,
	seamNormalTexels,
	wearTexels,
} from "./surface";
export {
	DETAIL_RADII,
	detailLevel as stationDetailLevel,
} from "./detail-level";
export type { DetailLevel as StationDetailLevel } from "./detail-level";

/**
 * A station **finish** (#202): everything about a station's surface and
 * fixtures that is not its form — the station half of `ship-surface.ts`'s
 * `HullFinish`, and the same shape of thing for the same reason. #199's review
 * read every form as a uniform grid at one scale with nothing between a 19 m
 * plate and a kilometre of hull, and the principal's steer was industrial:
 * the ISS's trusses and radiators, the Nostromo's clutter and lights. Those
 * are separately reviewable, so a finish is a preset the workbench switches
 * live and the sheet is captured under each.
 *
 * **`stock` is #36's surface as it shipped**, and `tests/surface.test.ts`'s
 * four pins hold it there: the finish's `plating` is the identity, and the
 * two scales are 1.
 */
export interface StationFinish {
	readonly name: string;
	readonly thesis: string;
	/** The role's shipped profile becomes this finish's. Identity for stock. */
	readonly plating: (role: PlatingProfile) => PlatingProfile;
	/** Map side as a multiple of `PLATE_TEXTURE_SIZE`, and tile as a multiple
	 *  of `station-mesh.ts`'s `STATION_PANEL_KM` — the same multiple, so the
	 *  plate is the same nineteen metres under every finish. Multiples rather
	 *  than figures, so the one copy of each constant stays where it is. */
	readonly mapScale: number;
	readonly tile: number;
	/** #202's macro fixtures on the selected forms: trusses, radiators, tank
	 *  racks, pipe runs, masts, a docking collar. */
	readonly fixtures: boolean;
	/** Extra clock-driven beacons on those fixtures, on the roles that strobe. */
	readonly beacons: boolean;
	/** A factor on the role's `greebleDensity`. */
	readonly greebleDensity: number;
	/**
	 * A factor on every greeble's size (#202, the principal's ship-scale
	 * ruling): a station is huge beside a ship, and clutter sized to the
	 * station hides that. Under 1 the pieces shrink and `greebleDensity`
	 * is what puts more of them back.
	 */
	readonly greebleScale: number;
	/** How much of the role's paint survives, as `ship-surface.ts`'s
	 *  `paint`: chroma kept and brightness kept. 1 and 1 is the paint as
	 *  authored. */
	readonly paint: { readonly saturation: number; readonly value: number };
}

/**
 * The industrial plating over a role's own: the role keeps its seam darkness,
 * variation, finish and weathering, and gains a **staggered rectangular bond
 * with a one-texel cut groove** — #101's layout, which the stations never
 * took — and a second octave of 75 m panel groups with a wider groove. On a
 * 256 map with a 0.3 km tile the plate is the same 18.75 m as before.
 */
const INDUSTRIAL_STATION_MACRO: MacroOctave = {
	pitchPx: 64,
	aspect: 2,
	stagger: 0.5,
	seamHalfWidthPx: 2,
	seam: 0.38,
	variation: 14,
	seamDepth: 0.5,
};

const industrialPlating = (
	role: PlatingProfile,
	weathering: number,
	grime: Pick<PlatingProfile, "streakDepth" | "soot" | "macro"> = {},
): PlatingProfile => ({
	...role,
	pitchPx: 16,
	aspect: 2,
	stagger: 0.5,
	seamHalfWidthPx: 1,
	seamDepth: 0.6,
	// A factor on the role's own, bounded short of 1: the refinery already
	// carries 0.78, and a streak term at 1 is a plate that is all streak.
	weathering: Math.min(0.95, role.weathering * weathering),
	macro: INDUSTRIAL_STATION_MACRO,
	...grime,
});

/**
 * The macro octave at ship-scale plating: on a 512 map with a 0.3 km tile
 * the plate is 9.4 m — a sixth of a courier — and a 128-texel group is the
 * same 75 m panel the industrial finish has, so the groups that carry the
 * scale at range are unchanged and only the plates within them are finer.
 * Four groups a tile, which is what the industrial finish repeats today.
 */
const SHIP_SCALE_STATION_MACRO: MacroOctave = {
	...INDUSTRIAL_STATION_MACRO,
	pitchPx: 128,
	seamHalfWidthPx: 3,
};

export const STATION_FINISHES = {
	stock: {
		name: "Stock",
		thesis: "#36's surface and fixtures as they shipped",
		plating: (role) => role,
		mapScale: 1,
		tile: 1,
		fixtures: false,
		beacons: false,
		greebleDensity: 1,
		greebleScale: 1,
		paint: { saturation: 1, value: 1 },
	},
	plated: {
		name: "Plated",
		thesis:
			"a staggered cut plate under a second octave of panel groups; no new structure",
		plating: (role) => industrialPlating(role, 1),
		mapScale: 2,
		tile: 2,
		fixtures: false,
		beacons: false,
		greebleDensity: 1,
		greebleScale: 1,
		paint: { saturation: 1, value: 1 },
	},
	industrial: {
		name: "Industrial",
		thesis:
			"plated, plus trusses, radiators, tank racks, pipe runs, masts and beacons",
		plating: (role) => industrialPlating(role, 1),
		mapScale: 2,
		tile: 2,
		fixtures: true,
		beacons: true,
		greebleDensity: 1.5,
		greebleScale: 1,
		paint: { saturation: 1, value: 1 },
	},
	worn: {
		name: "Worn",
		thesis:
			"industrial, with the streaking raised toward the Nostromo — reverses #98's refusal of grime",
		plating: (role) => industrialPlating(role, 2.2),
		mapScale: 2,
		tile: 2,
		fixtures: true,
		beacons: true,
		greebleDensity: 1.8,
		greebleScale: 1,
		paint: { saturation: 1, value: 1 },
	},
	/**
	 * Worn, one step further, at ship scale — the principal's direction on
	 * the first sheet (2026-09-06). Deeper streaks and sooted plates; the
	 * paint pulled toward grey; 9.4 m plates under the same 75 m groups; and
	 * the clutter at two fifths of its size with three times the count, so
	 * the station's size shows against it. The fixtures' own scale is not a
	 * finish dial — `station-fixtures.ts`'s `SHIP_SCALE` sizes them for every
	 * finish that draws them.
	 */
	nostromo: {
		name: "Nostromo",
		thesis:
			"worn, one step further, at ship scale: deeper streaks, sooted plates, greyed paint, 9 m plates, finer clutter",
		plating: (role) =>
			industrialPlating(role, 2.6, {
				streakDepth: 0.75,
				soot: 0.4,
				macro: SHIP_SCALE_STATION_MACRO,
			}),
		mapScale: 4,
		tile: 2,
		fixtures: true,
		beacons: true,
		greebleDensity: 3.2,
		greebleScale: 0.4,
		paint: { saturation: 0.4, value: 0.72 },
	},
} as const satisfies Record<string, StationFinish>;

export type StationFinishId = keyof typeof STATION_FINISHES;
export const STATION_FINISH_IDS = Object.keys(
	STATION_FINISHES,
) as StationFinishId[];

/**
 * The finish the game ships with — the principal's choice on the second
 * sheet (2026-09-06): worn, with #202's fixtures at ship scale. `stock` is
 * #36's surface as it was and stays a preset; `tests/station-finish.test.ts`
 * pins it and reads this.
 */
export const DEFAULT_STATION_FINISH: StationFinishId = "worn";
/** The finish in force — one value, one writer, read at build time. */
let stationFinish: StationFinishId = DEFAULT_STATION_FINISH;

export const stationFinishId = () => stationFinish;
export const currentStationFinish = (): StationFinish =>
	STATION_FINISHES[stationFinish];

export function setStationFinish(id: StationFinishId) {
	// Own keys only: `in` walks the prototype, and "toString" would pass.
	if (!Object.hasOwn(STATION_FINISHES, id))
		throw new Error(`no station finish ${id}`);
	stationFinish = id;
}

/** A role's plating under the finish in force. */
export const stationPlating = (type: StationType): PlatingProfile =>
	currentStationFinish().plating(STATION_VISUALS[type].plating);

/** The map side under the finish in force, texels. */
export const stationMapSize = () =>
	PLATE_TEXTURE_SIZE * currentStationFinish().mapScale;

/**
 * How much of a station is drawn, given how large it appears.
 *
 * `full` is a station you are flying at, `reduced` one in the same volume of
 * space, `outline` a lit shape among the planets.
 */
/** What kind of light a fixture is, which is what decides its waveform. Here
 *  rather than in `station-mesh.ts` because `fixtureIntensity` below is the
 *  function that answers for every member. */
export type StationFixtureKind =
	| "strobe-a"
	| "strobe-b"
	| "work"
	| "flare"
	/** One lamp of the ring round a slot's mouth; its fixture's `offsetS` is
	 *  its place in the chase (#300). */
	| "chase"
	/** A hazard beacon on a station that does not spin (#300). */
	| "beacon";

/**
 * The objects §5's table names as each role's light, by the name the mesh
 * carries — **one list, and this is it** (#300).
 *
 * Here rather than in `station-mesh.ts` or in a probe, because §5 is this
 * module's spec and because there are three readers: `tests/station-visuals.ts`
 * asserts each of these reads from the aperture axis, `probe-station-visuals`
 * asserts the same thing in pixels, and the forms place them. A probe's own
 * copy would go falsely green the day §5 gains a fixture, which is the shape of
 * defect #274 found: a role total passing on whichever light still worked.
 *
 * **What is deliberately not here.** The Works' `vent-manifold` is the
 * structure the throats are sunk into — a plain material lit by the sun, not a
 * light §5 gives anyone — and the refinery's `bay-flood` is the pad deck's own
 * work light, where §5 gives floodlit bays to the shipyard. Both are still
 * hidden when a role's own contribution is differenced out; neither carries a
 * floor, because §5 does not ask them to read from anywhere. The outpost has no
 * §5 row at all: nothing in the game places one (#56).
 *
 * **The names are the selected form's.** Only the Works — the refinery's form
 * D, the one the game builds — carries `obstruction-beacon`; the Warren, the
 * Collar and the Spar do not. A re-ranking to one of them turns §5's axis row
 * red by name, which is the intended failure rather than a silent pass.
 */
export const SPEC_FIXTURE_NAMES: Readonly<
	Partial<Record<StationType, readonly string[]>>
> = Object.freeze({
	trade: Object.freeze(["windows", "strobe-a", "strobe-b", "mouth-strobe"]),
	shipyard: Object.freeze([
		"windows",
		"bay-flood",
		"weld-arc",
		"strobe-a",
		"strobe-b",
		"mouth-strobe",
	]),
	refinery: Object.freeze([
		"windows",
		"heat-glow",
		"flare",
		"obstruction-beacon",
	]),
});

/** The name of an authored shipyard's turning drum, and so its marker: a
 *  station carrying one is drawn from an approved model (node #818). Here
 *  rather than in `shipyard-flight.ts`, which is a lazy chunk. */
export const AUTHORED_DRUM_NAME = "shipyard-drum";
/** An authored refinery's exterior (node #819), the marker for a role that
 *  has no drum. */
export const AUTHORED_EXTERIOR_NAME = "authored-exterior";
export function isAuthoredStation(root: THREE.Object3D): boolean {
	return (
		!!root.getObjectByName(AUTHORED_DRUM_NAME) ||
		!!root.getObjectByName(AUTHORED_EXTERIOR_NAME)
	);
}

/**
 * §5's names for an **authored** station, where they differ from the
 * procedural form's (node #818; the principal's rulings of 2026-10-13). An
 * authored shipyard carries its capsule's lamps as `windows` and the mouth
 * ring; its work light is baked into its lightmap, so it has no `bay-flood` or
 * `weld-arc` object, and the ring turns with the drum, so it carries no
 * strobe pair. A shipyard whose model failed keeps its procedural stand-in,
 * and `SPEC_FIXTURE_NAMES` above still rules that one.
 */
export const AUTHORED_FIXTURE_NAMES: Readonly<
	Partial<Record<StationType, readonly string[]>>
> = Object.freeze({
	shipyard: Object.freeze(["windows", "mouth-strobe"]),
});

/**
 * The band edges, in **the station's own silhouette radii** (§3).
 *
 * Radii and not kilometres, because a rule in kilometres gives the refinery's
 * 0.4 km core detail nobody can resolve at the range it strips the shipyard's
 * 1.5 km frame of detail that is still legible. `distanceKm / silhouetteKm` is
 * the same question asked of every type.
 */
/** The one emissive signature and the one motion a role carries (§5). */
export interface ActivityProfile {
	/** Strobe flash period, seconds. Zero for a role with no strobes. */
	strobePeriodS: number;
	/** Fraction of the period a strobe is lit. */
	strobeDuty: number;
	/** Flicker rate, Hz. */
	flickerHz: number;
	/** How deep the flicker cuts, 0–1. Zero is a steady light. */
	flickerDepth: number;
	/** Whether the flicker interpolates between ticks — a flare breathing —
	 *  or steps between them, which is what an arc does. */
	flickerSmooth: boolean;
	/**
	 * A hazard beacon's blink period, seconds; zero for a role with none (#300).
	 *
	 * Separate from the strobe, and the reason is §5's: a strobe carries that
	 * the station **turns and how fast**, so a role that does not spin carries
	 * none. A beacon carries that something **is there** — the tallest thing on
	 * a plant a pilot might clip — which is true of a station that stands still.
	 * Slower and longer than a strobe so the two cannot be read as one signal.
	 */
	beaconPeriodS: number;
	/** Fraction of the period a beacon is lit. */
	beaconDuty: number;
}

export interface StationVisualProfile {
	plating: PlatingProfile;
	activity: ActivityProfile;
	/** Habitation light behind the window grid. */
	windowColor: number;
	/** The two hull strobes. Present for every role so the record answers for
	 *  each; a role with a zero strobe period never lights them. */
	strobeColor: number;
	/** Work light: the shipyard's cold floodlit bays and its welding arc. The
	 *  refinery's work light is heat, so it draws `heatColor` instead and never
	 *  reads this. */
	floodColor: number;
	/** Heat: the refinery's flare and the dull glow at its drum. */
	heatColor: number;
	/**
	 * How much mechanical clutter the role carries, as a factor on every zone a
	 * form declares (#129, #102 §2).
	 *
	 * **One figure per role, and it is the dial a person turns.** #102 settled
	 * that the density is decided by looking rather than chosen up front, so
	 * what ships is a number per profile and a contact sheet it was set on — not
	 * a constant buried in a builder, and not a per-form figure, which would
	 * make "is this role busy enough?" twelve questions instead of four.
	 *
	 * The form still says which of *its* patches is busier than which; this says
	 * how busy the role is. Multiplying rather than replacing is what keeps those
	 * two separate.
	 */
	greebleDensity: number;
	/**
	 * How many lit ports the role carries, as a factor on each form's own run
	 * (#129).
	 *
	 * The other half of "a station reads as inhabited at approach range". #36
	 * shipped 28 panes on a 1.24 km trade station and 6 on an outpost; the counts
	 * were each form's literal, so raising them meant twelve edits and a
	 * judgement made twelve times. This is the same dial as `greebleDensity` for
	 * the same reason — the layouts are per form, the density is per role.
	 *
	 * A factor and not a count, because a form's layout knows things the profile
	 * does not: the Ring's ports go round its inner floor and the Warren's down
	 * a terraced face, and a count handed down from here would have to be right
	 * for both.
	 */
	windowScale: number;
}

/**
 * What #98's quality key gives a station — #102 §5's answer.
 *
 * **Low drops the greeble geometry and keeps every emissive.** The clutter is
 * per-frame vertex and instance cost; a lit window is one property on a part
 * that is drawn anyway. And dropping the lights would drop the reason #102
 * exists: what makes an unlit flank legible is that the flank emits, so a low
 * setting that took the windows would be darker than the picture the node set
 * out to change.
 *
 * Here rather than in `station-mesh.ts` for `LIGHT_RIG.quality`'s reason: this
 * is arithmetic about what a setting selects, and it is read from both the
 * renderer and the headless tier.
 */
export const STATION_QUALITY = {
	high: { greebles: true },
	low: { greebles: false },
} as const;

export type StationQuality = keyof typeof STATION_QUALITY;

/**
 * Per-role surface and light.
 *
 * A `Record<StationType, …>` for `station-types.md` §8.5's reason, which is the
 * same reason `STATION_GEOMETRY` is one: a fourth station type must stop the
 * build here rather than inherit a trade station's surface by default.
 *
 * The colours come from `hud-and-scanner.md` §4's grammar — cool for structure
 * and work light, warm for habitation and heat — rather than from a second
 * palette that would then have to be kept in step with it.
 */
/**
 * The strobe and work-light grammar, shared by every role that carries it.
 *
 * One definition rather than repeated literals: these are a *convention*, and
 * retuning a convention by editing it in three places is how two of the three
 * end up retuned.
 *
 * **Not a port/starboard pair, and that was a real error.** The strobes were
 * first red and green, described as marking port and starboard on the spin
 * axis' beam — but they sit inside the spinner, so they orbit Z and exchange
 * sides every half rotation. A red/green convention that inverts twice a
 * revolution is worse than none: a Coriolis station spins, so it has no fixed
 * port side to mark. What the pair honestly carries is the **rotation** — that
 * the station turns, and how fast — which is the physical fact `docking.md`
 * §4's roll match is matched against. So both are the same white, half a period
 * apart, and the colour claim is gone.
 */
const STROBE_WHITE = 0xf4f9ff;
const WORK_FLOOD = 0xbfe4ff;

export const STATION_VISUALS: Record<StationType, StationVisualProfile> = {
	trade: {
		plating: {
			pitchPx: 16,
			seam: 0.3,
			weathering: 0.12,
			roughness: 0.55,
			metalness: 0.42,
			/** Painted seams, not cut ones (#101), for every role — see
			 *  `PlatingProfile.seamDepth`, which carries the reason. */
			seamDepth: 0,
			/**
			 * **The layout #36 shipped, now stated rather than defaulted.**
			 * Square plates on an aligned grid, and a groove width that reaches
			 * nothing because `seamDepth` is 0. #101 gave ships a staggered
			 * rectangular bond because a square grid reads as scales; the
			 * stations kept theirs, because how a station looks is a judgement
			 * somebody has to make in front of a frame and nobody made it in
			 * that node. `tests/surface.test.ts` pins all four buffers to prove
			 * these figures reproduce it byte for byte.
			 */
			aspect: 1,
			stagger: 0,
			seamHalfWidthPx: 2,
			variation: 13,
		},
		activity: {
			strobePeriodS: 2,
			strobeDuty: 0.12,
			flickerHz: 0,
			flickerDepth: 0,
			flickerSmooth: false,
			beaconPeriodS: 0,
			beaconDuty: 0,
		},
		// **Warm**, which the first version was not: 0xdfe8ff is a blue-white, and
		// §5 calls the trade station's window grid habitation light. The probe reads
		// warmth as `R − B` over the role's own fixtures, and a blue-white grid put
		// the trade station on the cold side of the ordering it is meant to sit warm
		// of — the spec said one thing and the literal said the other.
		windowColor: 0xffe3b8,
		strobeColor: STROBE_WHITE,
		floodColor: WORK_FLOOD,
		heatColor: 0xffb347,
		// A habitat, so it is the least cluttered of the four and the most lit:
		// the machinery is inside it. Three times #36's ports on a 1.24 km hull
		// is roughly one lit pane per 45 m of frontage, which is what makes the
		// dark half read as a *place* at approach range rather than as a shape.
		greebleDensity: 1,
		windowScale: 3,
	},
	shipyard: {
		plating: {
			pitchPx: 26,
			seam: 0.46,
			weathering: 0.3,
			roughness: 0.72,
			metalness: 0.5,
			seamDepth: 0,
			/** #36's layout, stated rather than defaulted — see `trade`. */
			aspect: 1,
			stagger: 0,
			seamHalfWidthPx: 2,
			variation: 13,
		},
		activity: {
			strobePeriodS: 2,
			strobeDuty: 0.12,
			// A welding arc: fast, deep, and stepped. It is the one motion on the
			// station that is meant to read as work rather than as signalling.
			flickerHz: 7,
			flickerDepth: 0.85,
			flickerSmooth: false,
			beaconPeriodS: 0,
			beaconDuty: 0,
		},
		windowColor: 0xdfe8ff,
		strobeColor: STROBE_WHITE,
		floodColor: WORK_FLOOD,
		heatColor: 0xffb347,
		// A yard is scaffolding round a working volume: more clutter than a
		// habitat and fewer windows, because most of its 1.5 km of frame is not
		// somewhere anyone lives.
		greebleDensity: 1.4,
		windowScale: 2.5,
	},
	refinery: {
		plating: {
			pitchPx: 34,
			// Soot from its own stacks, which is why the streaking is an order
			// above the trade station's and the plate is rougher and barely
			// metallic.
			seam: 0.34,
			weathering: 0.78,
			roughness: 0.9,
			metalness: 0.14,
			seamDepth: 0,
			/** #36's layout, stated rather than defaulted — see `trade`. */
			aspect: 1,
			stagger: 0,
			seamHalfWidthPx: 2,
			variation: 13,
		},
		activity: {
			// No strobes: the refinery does not spin, and a rotation marker on a
			// station that does not rotate marks nothing. The flare is its light.
			strobePeriodS: 0,
			strobeDuty: 0,
			flickerHz: 1.7,
			flickerDepth: 0.32,
			flickerSmooth: true,
			beaconPeriodS: 1.5,
			beaconDuty: 0.25,
		},
		windowColor: 0xffcf9a,
		strobeColor: STROBE_WHITE,
		floodColor: WORK_FLOOD,
		heatColor: 0xff7a2a,
		// A plant, which is almost entirely machinery — the densest of the four,
		// and the one whose clutter is the point rather than the trim. Its
		// windows stay sparse for the same reason.
		greebleDensity: 1.7,
		windowScale: 2,
	},
	outpost: {
		plating: {
			// A coarse plate on a small structure, which is what makes it read as
			// *small*: the panel size is the only ruler a lone machine in the dark
			// has, and fine plating on a 0.15 km hull says "big object, far away".
			pitchPx: 44,
			seam: 0.5,
			weathering: 0.62,
			roughness: 0.86,
			metalness: 0.3,
			seamDepth: 0,
			/** #36's layout, stated rather than defaulted — see `trade`. */
			aspect: 1,
			stagger: 0,
			seamHalfWidthPx: 2,
			variation: 13,
		},
		activity: {
			// No strobes: an outpost does not spin, and a rotation marker on
			// something that does not rotate marks nothing — the refinery's rule,
			// applied to the other type that stands still.
			strobePeriodS: 0,
			strobeDuty: 0,
			// A pad light that pulses slowly, which is the one motion it has. Not
			// a docking cue: §5.1 keeps clearance and refusal with the HUD, and
			// this says only that the machine is running.
			flickerHz: 0.5,
			flickerDepth: 0.28,
			flickerSmooth: true,
			beaconPeriodS: 0,
			beaconDuty: 0,
		},
		windowColor: 0xffcf9a,
		strobeColor: STROBE_WHITE,
		floodColor: WORK_FLOOD,
		heatColor: 0xff9a3c,
		// Sparse on both counts, and deliberately: the coarse plate above is
		// there to say *small*, and clutter at the same pitch as the plating
		// would take that ruler away. A handful of lit ports says crewed; a grid
		// of them would say habitat, which this is not.
		greebleDensity: 0.7,
		windowScale: 2,
	},
};

/**
 * The role's albedo plating, RGBA, `PLATE_TEXTURE_SIZE` square.
 *
 * A wrapper over `surface.ts`'s generator since #101, and the role is the
 * **tag**: the generator hashes it, so passing the type reproduces every buffer
 * this module shipped before the split byte for byte. `tests/surface.test.ts`
 * pins all four against checksums taken from the commit before the change,
 * because a structural assertion that the wrapper delegates would still pass on
 * a generator that had been retuned on the way past.
 *
 * `size` is kept in the signature for `station-mesh.ts`, which passes it
 * explicitly beside the two it hands `DataTexture`.
 */
export function platingTexels(type: StationType, size = stationMapSize()) {
	return plateTexels(stationPlating(type), type, size);
}

/**
 * The role's seam normal map under the finish in force, or `null` when the
 * finish paints its seams — which every station did until #202, and which
 * `stock` still does. `null` rather than a flat map, so the material has no
 * normal map at all and pays no tangent frame for a term that is zero.
 */
export function seamTexels(type: StationType, size = stationMapSize()) {
	const profile = stationPlating(type);
	if (profile.seamDepth <= 0) return null;
	return seamNormalTexels(profile, size);
}

/**
 * The role's roughness and metalness map, RGBA.
 *
 * The albedo is optional *here* and required by the generator underneath, and
 * the difference is deliberate: this module's callers have always been able to
 * ask for the wear map alone, and the generator's contract is that the two maps
 * come from one buffer. Defaulting it here is the one place that reconciles
 * them, rather than every caller remembering to.
 */
export function surfaceTexels(
	type: StationType,
	size = stationMapSize(),
	precomputed?: Uint8Array,
) {
	const profile = stationPlating(type);
	return wearTexels(
		profile,
		precomputed ?? plateTexels(profile, type, size),
		size,
	);
}

/**
 * A hull strobe's brightness at `gameTime`, 0–1 (§5.2).
 *
 * `offsetS` puts the second strobe half a period behind the first: two lights
 * flashing together read as one light, and it is the *alternation* sweeping
 * round with the hull that shows the station is turning and how fast — the
 * physical fact `docking.md` §4's roll match is matched against, at the range
 * where the slot itself has not resolved.
 *
 * A short ramp at each edge of the flash rather than a hard square: at 60 fps a
 * square pulse of this duty is a flash a frame can miss entirely, and the
 * symptom is a strobe that looks like it is failing.
 */
export function strobeIntensity(
	type: StationType,
	gameTime: number,
	offsetS: number,
): number {
	const { strobePeriodS, strobeDuty } = STATION_VISUALS[type].activity;
	if (strobePeriodS <= 0 || strobeDuty <= 0) return 0;
	const phase = ((((gameTime + offsetS) / strobePeriodS) % 1) + 1) % 1;
	if (phase >= strobeDuty) return 0;
	const p = phase / strobeDuty;
	const ramp = 0.08;
	if (p < ramp) return p / ramp;
	if (p > 1 - ramp) return (1 - p) / ramp;
	return 1;
}

/**
 * A hazard beacon's brightness at `gameTime`, 0–1 (§5.2, #300).
 *
 * The strobe's shape — a short ramp at each edge so no frame misses the blink
 * — on the beacon's own period and duty: it repeats faster than a strobe and
 * holds each flash longer. Zero for a role that
 * declares no beacon, so a caller multiplies unconditionally.
 */
export function beaconIntensity(
	type: StationType,
	gameTime: number,
	offsetS: number,
): number {
	const { beaconPeriodS, beaconDuty } = STATION_VISUALS[type].activity;
	if (beaconPeriodS <= 0 || beaconDuty <= 0) return 0;
	const phase = ((((gameTime + offsetS) / beaconPeriodS) % 1) + 1) % 1;
	if (phase >= beaconDuty) return 0;
	const p = phase / beaconDuty;
	const ramp = 0.08;
	if (p < ramp) return p / ramp;
	if (p > 1 - ramp) return (1 - p) / ramp;
	return 1;
}

/**
 * The role's work-light flicker at `gameTime`, 0–1 (§5.2).
 *
 * 1 for a role whose profile declares no depth, so a caller multiplies by this
 * unconditionally rather than branching — a steady light is the depth-zero case
 * of the same expression, not a different code path.
 *
 * Stepped for the shipyard's arc and interpolated for the refinery's flare,
 * because those are different physical things: an arc strikes and dies, and a
 * flare breathes. Both are hashes of the quantised clock, so both look
 * stochastic and both replay exactly.
 */
export function flickerIntensity(type: StationType, gameTime: number): number {
	const { flickerHz, flickerDepth, flickerSmooth } =
		STATION_VISUALS[type].activity;
	if (flickerDepth <= 0 || flickerHz <= 0) return 1;
	const p = gameTime * flickerHz;
	const tick = Math.floor(p);
	let n = hash01(`${type}-flicker`, tick, 0);
	if (flickerSmooth) {
		const f = p - tick;
		const smooth = f * f * (3 - 2 * f);
		n = n * (1 - smooth) + hash01(`${type}-flicker`, tick + 1, 0) * smooth;
	}
	return 1 - flickerDepth * n;
}

/**
 * The waveform one fixture kind rides, 0–1 (§5.2).
 *
 * Here rather than in `station-mesh.ts`, which was deciding that `work` and
 * `flare` share the flicker while the strobes read `strobeIntensity`. This
 * module is documented as owning the one signature and the one motion a role
 * carries, so a role that wants its flare and its work light on different
 * waveforms should be editable here rather than in the Three-side module.
 *
 * A switch with a return in every arm: a fifth kind falls off the end with no
 * return, which is a compile error rather than a light that silently inherits
 * the flicker.
 */
export function fixtureIntensity(
	type: StationType,
	kind: StationFixtureKind,
	gameTime: number,
	/** The fixture's own place in its waveform, seconds. Only a chase lamp and
	 *  a beacon read it; required anyway, so a caller cannot forget it on the
	 *  kinds that do and light a whole ring in unison. */
	offsetS: number,
): number {
	switch (kind) {
		case "chase":
			return strobeIntensity(type, gameTime, offsetS);
		case "beacon":
			return beaconIntensity(type, gameTime, offsetS);
		case "strobe-a":
			return strobeIntensity(type, gameTime, 0);
		case "strobe-b":
			return strobeIntensity(
				type,
				gameTime,
				STATION_VISUALS[type].activity.strobePeriodS / 2,
			);
		case "work":
		case "flare":
			return flickerIntensity(type, gameTime);
	}
}
