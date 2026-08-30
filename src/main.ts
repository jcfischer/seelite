/**
 * The renderer: three layers, one camera orientation, camera always at the
 * origin.
 *
 * ## The architecture, and where it comes from
 *
 * This is the scale research's recommendation
 * (`docs/research/space-scale-rendering.md`) built out, not a fresh design. The
 * three rules it settles:
 *
 * 1. **The camera never moves.** It sits at (0,0,0) and only rotates. Every
 *    frame, each visible entity is placed at `simPos - simCameraPos`, computed
 *    in float64 in `sim.ts` and handed to the scene graph as a small number.
 *    This is camera-relative rendering rather than threshold rebasing: with
 *    tens of nearby objects the per-frame cost is nothing, and it has no rebase
 *    *event* to get wrong — no stale cached world positions, no shadow pop.
 * 2. **The scene graph is display only.** Nothing reads a position back out of
 *    an `Object3D`. The authoritative numbers live in `sim.ts`, which cannot
 *    import Three.js.
 * 3. **Three depth layers, drawn back to front with depth cleared between.**
 *    Background (stars, no depth at all), far (bodies at `FAR_SCALE`), near
 *    (ships and stations at 1:1 km). Each layer's near:far ratio stays inside
 *    what a 24-bit depth buffer carries, which is why
 *    `logarithmicDepthBuffer` is off — it would cost several milliseconds a
 *    frame to solve a problem this scheme does not have.
 *
 * The layers are three `RenderPass`es in one `EffectComposer` rather than three
 * `renderer.render()` calls, because the bloom has to see the composite: a
 * star's glow spilling over a planet's limb is the whole reason bloom is here,
 * and per-layer post-processing would composite the glow behind it.
 *
 * ## The layer a body draws in
 *
 * Its **distance**, not its kind. Every body is drawn in the near layer within
 * `HANDOFF_KM` of the camera and in the far layer beyond it, with a hysteresis
 * band so a body sitting on the threshold does not swap every frame.
 *
 * This replaced a fixed split — planets far, stations near — which was correct
 * for a scaffold whose ship was parked 40 km off its only station and wrong the
 * moment the real generator landed: a system's stations orbit planets an AU or
 * more from the arrival point, and 1 AU drawn at 1:1 is fifty thousand times
 * past the near camera's far plane. The fixed rule did not render them badly,
 * it rendered nothing.
 *
 * Apparent size survives the swap because `FAR_SCALE` multiplies a body's
 * position *and* its radius, so the angle it subtends is the same on both
 * sides. `scripts/probe-handoff.mjs` is spec §9.10 measuring exactly that, and
 * it is the check this content finally made possible.
 *
 * ## Cross-scale visibility
 *
 * The approach pass clears far depth and the near pass clears approach depth. A
 * local ship or station therefore always draws over a close massive body; exact
 * physical occlusion across scales needs depth reconstruction and is outside
 * Issue #47. Cruise stops well outside surface gameplay, including the 5 km
 * approach-camera near clip, so this pass is an approach view rather than a
 * landing renderer.
 *
 * ## What is a placeholder
 *
 * The flight controls. Yaw, pitch, roll and throttle on the keyboard, feeding
 * `stepShip`'s stand-in integrator. #5 resolved the flight model to assisted
 * Newtonian and none of it is built; this is what makes the game something you
 * can fly around in meanwhile, and it is expected to be deleted rather than
 * tuned.
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import { starField } from "./backdrop";
import { LIGHT_RIG, envRotation, equirectEnvironment } from "./light-rig";
import { SettingsStore } from "./settings";
import { AudioFX } from "./audio";
import {
	createCombatPrototype,
	duelTargetInCone,
	stepCombatPrototype,
	type CombatPrototypeState,
} from "./combat-prototype";
import {
	FLIGHT_FLOOR_LABELS,
	SCANNER_RANGE_KM,
	chargeReadsEmpty,
	flightFloorWidest,
	type FloorCell,
	type FloorTone,
	type HeadLook,
	type NavFilter,
	type NavRow,
	type ScannerContact,
	flightFloorCells,
	projectNavTargets,
	projectScannerContacts,
	targetArrowBearingDeg,
} from "./cockpit";
import {
	CHARGE_CAPACITY_AU,
	CHARGE_REGEN_AU_PER_S,
	type CruiseParams,
	DEFAULT_CRUISE,
	HOST_CLEARANCE_KM,
	SURFACE_MARGIN,
	advanceCruise,
	closestApproachKm,
	chargeAfterRegen,
	chargeAfterTravel,
	exitVelocity,
	legSeconds,
} from "./cruise";
import { GOVERNMENT_NAMES } from "./galaxy";
import {
	angleOffNose,
	directionTo,
	duration,
	edgeOf,
	horizonRoll,
	prograde,
	projectDirection,
} from "./hud";
import {
	ANGULAR_MAX,
	ASSIST_CAP_KMS,
	type Angular,
	type Body,
	type FlightControl,
	type World,
	advanceWorldClock,
	bodyVelocity,
	stationHostIdOf,
	makeWorld,
	stationOf,
	stationPose,
	stepAngular,
	stepWorld,
} from "./sim";
import type { SurfaceClass } from "./planet-appearance";
import {
	type BodyVisual,
	buildBodyVisual,
	surfaceSphere,
} from "./planet-surface";
import { SPIN_RPM_RANGE, STATION_GEOMETRY } from "./station";
import {
	type ApertureFrame,
	type Clearance,
	type DockingState,
	type EntryOutcome,
	type EntryPose,
	type ShipCondition,
	ARRIVAL_SECONDS,
	AXIS_TOLERANCE_DEG,
	DOCKING_COMPUTER,
	frameAtPhase,
	ROLL_TOLERANCE_DEG,
	VICINITY_KM,
	V_GATE_KMS,
	apertureFrame,
	applyDamage,
	attemptEntry,
	dockingComputerStep,
	fullCondition,
	grantLive,
	isAlive,
	newDockingState,
	orthonormalise,
	poolOf,
	planeCrossing,
	requestClearance,
	slewToward,
	slotBasis,
	tickDocking,
} from "./docking";
import { dockedAxialKm } from "./arrival";
import {
	type DockPhase,
	type DockSession,
	canSkipTraversal,
	enterArrival,
	flightLive,
	newDockSession,
	requestLaunch,
	skipTraversal,
	stepDockedWorld,
} from "./dock-session";
import {
	DIRECTOR_RANGE_KM,
	type DirectorState,
	dockingDirector,
	directorEngaged,
} from "./docking-director";
import {
	type StationMesh,
	buildStationMesh,
	stationVisualSnapshot,
	updateStationVisuals,
} from "./station-mesh";
import {
	type HullId,
	type HullVariantId,
	type FleetSlot,
	buildShipMesh,
	fleetLayout,
} from "./ship-mesh";
import { applyHullQuality } from "./ship-surface";
import {
	LiveCockpit,
	type LeftTab,
	type LiveCockpitState,
	type RightTab,
} from "./live-cockpit";
import { marketStationOf, readDeficit } from "./market";
import { carrierKey } from "./carrier-key";
import {
	newCommander,
	transactAtStation,
	type StationAction,
} from "./station-commerce";
import { newWorld as newPersistentWorld, type WorldState } from "./world-state";
import {
	type StationConsoleTab,
	stationEquipmentScreen,
	stationMarketScreen,
} from "./station-console";
import type { GalaxyChart } from "./galaxy-map";
import { type WarpField, warpField } from "./warp";
import { type Vec3, add, dot, length, scale, sub, v3 } from "./vec3";
// One path to `./units`, deliberately. Keeping a namespace import beside a named
// one would let this file reach `FAR_SCALE` and `units.FAR_SCALE` as separate
// spellings of the same constant — the two-public-paths pattern this branch
// removed from `sim.ts` and pinned with a source-scan test.
import * as units from "./units";

/** Scratch vector for aiming a station's aperture, allocated once: the render
 *  loop runs per body per frame, and a `Vector3` built there is garbage by the
 *  time it is read — the same trade `vec3.ts` names for `Vec3`. */
/** Scratch for the per-body sun direction. One vector reused every frame for
 *  every body: the uniform copies out of it immediately, and allocating one per
 *  body per frame is garbage inside the hottest loop in the renderer. */
const SUN_DIR = new THREE.Vector3();

/** Where the star is when a system somehow has none. Only the sun direction
 *  reads it, and only to avoid a NaN. */
const ORIGIN = v3(0, 0, 0);

const STATION_AXIS = new THREE.Vector3();

/** The camera's unit direction to the star, and the rotation carrying the
 *  bake's own star direction onto it. Allocated once for the reason above: they
 *  are written every frame and read in the same statement. */
const STAR_DIR = new THREE.Vector3();
const ENV_QUAT = new THREE.Quaternion();
const ENV_EULER = new THREE.Euler();
/** Local +Z, which `station-mesh.ts` builds every station's aperture axis
 *  along — the vector a station's mesh is rotated *from* when it is aimed. */
/** Scratch for the aperture basis a station is aimed with — allocated once,
 *  like `STATION_AXIS`, because this runs per station per frame. */
const STATION_ACROSS = new THREE.Vector3();
const STATION_UP = new THREE.Vector3();
const STATION_BASIS = new THREE.Matrix4();
const HEAD_AXIS = new THREE.Vector3(0, 1, 0);

const {
	APPROACH_FAR_UNITS,
	APPROACH_NEAR_UNITS,
	APPROACH_SCALE,
	AU_KM,
	range,
	BACKDROP_RADIUS,
	C_KMS,
	MAX_DT,
	FAR_FAR_UNITS,
	FAR_NEAR_UNITS,
	FAR_SCALE,
	NEAR_FAR_KM,
	NEAR_NEAR_KM,
	isMassive,
	layerFor,
	massiveLayerFor,
	scaleFor,
} = units;

/** How many stars the backdrop draws. Cheap at this count; the research puts
 *  the point where a `Points` layer starts costing anything nearer 10⁵. */
const STAR_COUNT = 4000;

/** Multiplier from a star's stored size to pixels, against the canvas height.
 *  Point sizes are in *pixels* and a fixed value would read differently on
 *  every display, so it scales with the buffer. */
const STAR_PIXEL_SCALE = 0.35;

/**
 * The chase camera's offset from the ship, in kilometres: behind and above.
 *
 * 140 m back and 40 m up, set by looking at it. At 60 m the 30-metre hull filled
 * the lower half of the frame and the station 40 km ahead was a speck above it —
 * a view that shows the placeholder and hides the thing the placeholder is meant
 * to let you judge. These two numbers are the scaffold's only tuned-by-eye
 * constants, and the flight-model node owns them from here.
 */
const CHASE_BACK_KM = 0.14;
const CHASE_UP_KM = 0.04;

/**
 * The hull the player flies: the courier `Kestrel`.
 *
 * Named as a pair because `buildShipMesh("courier")` defaults its variant, and
 * a default is exactly what the spec forbids a roster to take — the comment
 * that used to sit here claimed the choice was explicit while the code let the
 * builder pick. #26 still owns the roster; when it arrives it replaces this
 * constant, and it will be able to see what it is replacing.
 */
const PLAYER_HULL: readonly [HullId, HullVariantId] = ["courier", "a"];

/**
 * How fast the chase camera swings round the hull while a key is held.
 *
 * A full circle in a little over five seconds. Faster and the hull's far side
 * arrives before the eye has read the near one; slower and checking what is off
 * the port quarter costs more attention than the look is worth.
 */
const CHASE_ORBIT_RATE = 1.2;

/**
 * Fold an angle back into (-π, π].
 *
 * Local rather than in `units.ts` because that file is a leaf of the unit
 * scheme and `tests/headless.test.ts` asserts it imports nothing; a camera
 * convenience does not belong in the scheme the sim is measured in.
 */
function wrapAngle(radians: number) {
	const turn = Math.PI * 2;
	return ((((radians + Math.PI) % turn) + turn) % turn) - Math.PI;
}

/**
 * Mouse sensitivity: radians of rotation per pixel of pointer movement.
 *
 * Relative deltas under pointer lock rather than an absolute virtual stick,
 * which is what "like E:D" means in practice for mouse: the pointer has no
 * position to return to, so the ship holds an attitude when the hand stops
 * rather than springing back to centre.
 */
/** The throttle bindings, named once. `step` moves the throttle on them and
 *  §7's cancel test asks whether the player is holding one; a rebind that
 *  reached only the first would move the throttle without cancelling the
 *  autopilot that is overwriting it. */
const THROTTLE_UP = "shift";
const THROTTLE_DOWN = "control";

const MOUSE_RAD_PER_PX = 0.0022;

/** How far a single frame's mouse movement may turn the ship, radians. A
 *  flicked pointer or a re-focused window can deliver a delta of hundreds of
 *  pixels in one event, and without this the ship spins. */
const MOUSE_MAX_STEP = 0.12;

/** The cockpit camera's offset from the hull's centre, kilometres — 8 metres
 *  forward, so the view is from the nose rather than from inside the cube. */
const COCKPIT_FORWARD_KM = 0.008;

/** Below this speed the prograde marker is hidden: the velocity is noise, and a
 *  marker chasing it would swing around a screen belonging to a ship that is
 *  effectively stationary. */
const PROGRADE_MIN_KMS = 0.02;

/** How far inside the viewport the selected target's sky arrow sits. */
const EDGE_MARGIN = 0.07;

/**
 * §4's spool-up, seconds — reused here for the voluntary case.
 *
 * The spec introduces it for re-entry after an interdiction, deliberately
 * borrowing #6's hyperspace wind-up rather than inventing a second escape
 * mechanic. Applying it to every entry is this prototype's reading: the wind-up
 * is what makes engaging cruise a commitment rather than a reflex, and whether
 * three seconds is the right commitment is one of the things flying it answers.
 */
const SPOOL_S = 3;

/**
 * The dials, and why they are lists rather than a slider.
 *
 * This node's whole question is which of the spec's derived numbers survive
 * being flown (§10). A judgement like "23 c or 20 c" is made by *comparing*,
 * and comparing means being able to step to the next value and back on the same
 * leg — not typing a number, and not restarting with a different query string.
 * Each list is centred on the spec's own figure so that "what the spec says" is
 * always one keypress from wherever the tuning has wandered.
 */
const V_MAX_DIAL_C = [5, 10, 15, 20, 23, 30, 50];
const EXPONENT_DIAL = [0.5, 0.6, 0.75, 0.9, 1.0];
const DROP_RADIUS_DIAL_KM = [20, 50, 100, 250, 1000];
/** §3's speed threshold — the dial between §2.3's arrive-for-you drop-out and
 *  §3's cut-the-throttle one. `cruise.ts` explains why both are implemented. */
const DROP_SPEED_DIAL_KMS = [2, 20, 200, 2000];
/** The approach clamp's two numbers, both of them findings rather than spec —
 *  see `cruise.ts`'s `vicinityKm`. */
const VICINITY_DIAL_KM = [2000, 5000, 10000, 25000, 50000];
const APPROACH_LEAD_DIAL_S = [1.5, 3, 5, 8];

/** The one dial whose list is not in the parameter's own unit: `v_max` is
 *  argued in multiples of c, and stored in km/s. */
const IN_C = {
	display: (kms: number) => kms / C_KMS,
	store: (c: number) => c * C_KMS,
};

/** How often the time-to-target estimate is recomputed, in sim seconds. Four a
 *  second — far faster than the readout's own resolution, and a sixteenth of
 *  the work. */
const ETA_INTERVAL_S = 0.25;

/** What the ship is doing: #5's two regimes are one state here (the flight
 *  model is still the scaffold's stand-in) and cruise is the other. */
type Regime = "normal" | "cruise";

/**
 * The `cruise.ts` ray arithmetic a probe may call through `window.__seelite`.
 *
 * Not `geometry`: this repo uses that for drawn shape (`STATION_GEOMETRY`, a
 * `BufferGeometry`), and this is sim-space maths.
 *
 * Declared rather than inferred from the object literal, so adding one is an
 * edit to a named surface rather than an append. The admission test: a pure
 * function already exported from `cruise.ts` whose rule a probe would otherwise
 * restate. Anything that reads or writes game state does not belong here.
 */
/**
 * One station's docking geometry and the ship's pose in it, for one step.
 *
 * The pair rather than the pose alone: a crossing test needs both, they cost
 * the same orbital evaluation to produce, and computing the frame twice per
 * station per frame was measurable work for no answer that changed.
 */
/**
 * What `dockingSnapshot` hands a probe — declared rather than inferred.
 *
 * Flat rather than grouped into geometry/protocol/ship, deliberately: §9.2's
 * probes assert on *relationships across* those groups (a bounce that damaged
 * the ship and left it alive, a crossing refused for containment rather than
 * for an angle), and a grouped shape costs every read an extra hop for a
 * tidiness the consumer does not want. What the grouping was really asking for
 * is that the shape be *documented*, which a named interface does.
 */
interface DockingSnapshot {
	stationId: string;
	rangeKm: number;
	closingKms: number;
	frameBodyId: string | null;
	throttle: number;
	offAxisKm: number;
	axialKm: number;
	planeKm: number;
	apertureKind: "slot" | "pad";
	apertureWidthKm: number;
	apertureHeightKm: number;
	phaseRad: number;
	axis: Vec3;
	basis: { across: Vec3; up: Vec3 };
	reference: Vec3;
	spinRpm: number;
	clearance: Clearance;
	grantLive: boolean;
	hostile: boolean;
	computerEngaged: boolean;
	computerRefusal: "no-clearance" | "hostile" | "out-of-range" | null;
	dockedAt: string | null;
	/** §12.3's three exempt states, distinguishable from ordinary flight —
	 *  obligation 8's checkable half, and what #75 will read. */
	dockPhase: DockPhase;
	/** Where §12.2 parks the ship, as an axial distance from the station's
	 *  centre — so a probe reads the throat's depth off the page instead of
	 *  restating a constant that would go falsely red when the module retunes
	 *  it. */
	dockedAxialKm: number;
	/** E9's generated name for this station. */
	stationName: string;
	condition: ShipCondition;
	alive: boolean;
	poolMax: number;
	lastEntry: EntryOutcome | null;
}

interface DockingApproach {
	frame: ApertureFrame;
	pose: EntryPose;
}

interface ProbeRayMath {
	closestApproachKm: typeof closestApproachKm;
}

interface Instrument {
	ctx: CanvasRenderingContext2D;
	texture: THREE.CanvasTexture;
	/** The last primary string painted, for browser verification against the
	 *  simulation record rather than OCR of a rescaled canvas. */
	primaryText: string;
	secondaryText: TextRaster;
}

const INSTRUMENT_SECONDARY_FONT = "20px ui-monospace, monospace";
const PROMPT_FONT = "13px ui-monospace, Menlo, monospace";
const PROMPT_FILL = "rgba(255, 214, 120, 0.9)";
const TEXT_RASTER_DEFAULTS: Readonly<{
	text: string;
	font: string;
	fillStyle: string;
	textAlign: CanvasTextAlign;
	x: number;
	y: number;
	background: string | undefined;
}> = Object.freeze({
	text: "",
	font: "",
	fillStyle: "",
	textAlign: "left" as CanvasTextAlign,
	x: 0,
	y: 0,
	background: undefined as string | undefined,
});
const TEXT_RASTER_BOUNDS_DEFAULTS: Readonly<{
	left: number;
	top: number;
	width: number;
	height: number;
}> = Object.freeze({
	left: 0,
	top: 0,
	width: 0,
	height: 0,
});

/**
 * Where the flying glass ends and the physical cockpit begins, as a fraction of
 * the frame height.
 *
 * Shared by the laser tracer and the docking director rather than spelled twice:
 * the director shipped without a clip and drew its rings down over the dash
 * deck, the scanner well and both console housings, which is what a second copy
 * of this number would have let happen again.
 */
const GLASS_BOTTOM_FRACTION = 0.66;

/**
 * The band §5's mode/throttle/assist/charge strip occupies, measured up from
 * the bottom of the glass.
 *
 * **One owner, because three things are anchored to it**: the strip's own
 * baseline, its type size, and the docking director's clearance line above it.
 * §3 says that line carries its reason, and it used to be offset by a literal
 * of its own while the strip placed itself at `glassBottomY - 9` with a fixed
 * 13 px font — so the comment claimed an ownership the code did not have, and
 * raising the type would have slid the strip under the line without touching
 * this number.
 */
const FLOOR_STRIP_HEIGHT_PX = 26;
/** Where the baseline sits inside the band, and how big the value type is —
 *  both fractions of it, so the band is the one thing to change. */
const FLOOR_BASELINE_FRACTION = 0.35;
const FLOOR_VALUE_FRACTION = 0.5;
const FLOOR_LABEL_FRACTION = 0.385;

/** §4's grammar, once. `cockpit.ts` decides which tone a reading earned; this
 *  is the only place a tone becomes a colour. */
const FLOOR_TONE_FILL: Record<FloorTone, string> = {
	passive: "rgba(150, 205, 240, 0.92)",
	action: "rgba(255, 196, 110, 0.95)",
	confirmed: "rgba(150, 255, 190, 0.95)",
	refused: "rgba(255, 110, 96, 0.97)",
};
const FLOOR_LABEL_FILL = "rgba(120, 165, 195, 0.75)";
const FLOOR_FONT_FAMILY = "ui-monospace, Menlo, monospace";
/** Between a label and its value, and between one cell and the next. */
const FLOOR_LABEL_GAP_PX = 5;
const FLOOR_CELL_GAP_PX = 22;
/** Clear of the glass edges at every viewport. */
const FLOOR_MARGIN_PX = 14;
/** How far the strip may be shrunk to fit. Below this it is not an instrument
 *  read at a glance, and the answer would have to be a different layout. */
const FLOOR_MIN_SCALE = 0.62;

/** How far past the tolerance ring the nose marker is allowed to sit before it
 *  stops moving. Beyond this the error is off-scale and the marker says so. */
const MARKER_MAX_FRACTION = 1.3;

/** The throat is the thing the ship goes through, so it is the brightest line
 *  in the corridor — and it carries the blocking state, because a refusal has
 *  to reach the part of the picture the pilot is aiming at. */
/** A font at a scale, built rather than parsed back out of a declaration. */
const floorFont = (fraction: number, scale: number): string =>
	`${Math.max(7, Math.round(FLOOR_STRIP_HEIGHT_PX * fraction * scale))}px ${FLOOR_FONT_FAMILY}`;

/**
 * One run's per-cell widths and their total.
 *
 * **The fit and the draw share this.** They each had their own copy of
 * `label + gap + value`, which is two spellings of the metric the fit exists to
 * guarantee — a change to the layout that landed in one would have made the fit
 * describe a run the draw does not produce. The pairs carry their own labels
 * rather than being indexed against `FLIGHT_FLOOR_LABELS`, so the two paths
 * also agree on where a label comes from.
 */
function floorRunWidths(
	ctx: CanvasRenderingContext2D,
	cells: readonly { label: string; value: string }[],
	scale: number,
): { widths: number[]; total: number; labelWidths: number[] } {
	const labelFont = floorFont(FLOOR_LABEL_FRACTION, scale);
	const valueFont = floorFont(FLOOR_VALUE_FRACTION, scale);
	const labelGap = FLOOR_LABEL_GAP_PX * scale;
	const labelWidths: number[] = [];
	const widths = cells.map((cell) => {
		ctx.font = labelFont;
		const label = ctx.measureText(cell.label).width;
		labelWidths.push(label);
		ctx.font = valueFont;
		return label + labelGap + ctx.measureText(cell.value).width;
	});
	return {
		widths,
		labelWidths,
		total:
			widths.reduce((a, b) => a + b, 0) +
			FLOOR_CELL_GAP_PX * scale * (cells.length - 1),
	};
}

/** One cell's value by label. Throws rather than printing `undefined` on a
 *  label that does not exist — a blank readout is what this is fixing. */
function floorCellValue(cells: readonly FloorCell[], label: string): string {
	const cell = cells.find((c) => c.label === label);
	if (cell === undefined)
		throw new Error(`flight floor: no ${label} cell to read`);
	return cell.value;
}

function throatColour(state: DirectorState): string {
	if (state.blocking) return "rgba(255, 110, 96, 0.95)";
	return state.aligned
		? "rgba(150, 255, 190, 0.95)"
		: "rgba(255, 209, 122, 0.9)";
}

/**
 * What the docking director actually painted on the glass this frame.
 *
 * Pixel geometry, not a second copy of the state: `state` below is the object
 * `docking-director.ts` returned, and everything beside it is where the draw
 * put it and in what state it painted it — the distinction `cockpitPrompt`
 * exists for.
 *
 * **It records what the draw decided, not that anything reached the canvas.**
 * The record is assembled at the end of the method whether or not the strokes
 * landed, so deleting every `ctx.stroke()` would leave it unchanged. That gap
 * is closed in the probe rather than here: `probe-docking.mjs` reads the
 * overlay's own pixels on the funnel ring, because a canvas is the one thing a
 * renderer cannot honestly self-report.
 */
interface DirectorRender {
	state: DirectorState;
	/** Screen centre — the nose, and the thing the axis marker is flown into. */
	centre: { x: number; y: number };
	/**
	 * Pixel radius of the tolerance ring — a **fixed gauge**, not a projection.
	 * At a 60° field of view check 2's 35° cone projects to 1.21 times half the
	 * canvas height, so a true ring is larger than the screen; the first build
	 * drew one and it read as arcs running off every edge.
	 */
	funnelRadiusPx: number;
	/** Where the nose marker was drawn: the true on-glass *direction* of the
	 *  docking axis, at a radius that is the error as a fraction of tolerance.
	 *  Whether that radius still means anything is `markerOffScale`, not a
	 *  property of the point — the coordinates are on canvas either way. */
	axisMarker: { x: number; y: number } | null;
	/** True when the nose error is past the gauge's range, so the marker has
	 *  stopped moving and no longer reads as a distance. */
	markerOffScale: boolean;
	/** How many of the corridor's rectangles were fully on screen and stroked. */
	tunnelRingsDrawn: number;
	/**
	 * The throat's four corners as drawn, in canvas pixels, or `null` when it did
	 * not project.
	 *
	 * Here because the corridor is what carries check 4 now that the roll ticks
	 * are gone, and "the rectangle turns with the slot" is a fact about the
	 * *geometry* that says nothing about whether a rolled pilot can read a roll
	 * error off the glass. The rectangle's screen-space tilt is that reading.
	 */
	throatCornersPx: { x: number; y: number }[] | null;
	/** Which state the funnel was **painted** in. The record carries it because
	 *  it is the one cue decision the draw makes rather than copies: without it
	 *  a funnel that stayed green past the tolerance passes every browser row. */
	funnelState: "clear" | "off-axis" | "blocked";
	/** The clearance line as drawn, and whether it was drawn as blocking. */
	clearanceText: string;
	blocking: boolean;
}

class TextRaster {
	text = TEXT_RASTER_DEFAULTS.text;
	font = TEXT_RASTER_DEFAULTS.font;
	fillStyle = TEXT_RASTER_DEFAULTS.fillStyle;
	textAlign = TEXT_RASTER_DEFAULTS.textAlign;
	x = TEXT_RASTER_DEFAULTS.x;
	y = TEXT_RASTER_DEFAULTS.y;
	bounds = { ...TEXT_RASTER_BOUNDS_DEFAULTS };
	background = TEXT_RASTER_DEFAULTS.background;

	reset() {
		Object.assign(this, TEXT_RASTER_DEFAULTS);
		Object.assign(this.bounds, TEXT_RASTER_BOUNDS_DEFAULTS);
	}

	setInstrumentSecondary(text: string, accent: string, canvasWidth: number) {
		this.reset();
		this.text = text;
		this.font = INSTRUMENT_SECONDARY_FONT;
		this.fillStyle = accent;
		this.textAlign = "left";
		this.x = 28;
		this.y = 192;
		this.bounds.left = 28;
		this.bounds.top = 168;
		this.bounds.width = canvasWidth - 56;
		this.bounds.height = 30;
		this.background = "rgba(1, 8, 11, .9)";
	}

	setCenteredPrompt(
		text: string,
		x: number,
		y: number,
		width: number,
		font = PROMPT_FONT,
	) {
		this.reset();
		this.text = text;
		this.font = font;
		this.fillStyle = PROMPT_FILL;
		this.textAlign = "center";
		this.x = x;
		this.y = y;
		this.bounds.left = Math.floor(x - width / 2);
		this.bounds.top = Math.floor(y - 14);
		this.bounds.width = Math.ceil(width);
		this.bounds.height = 18;
		this.background = undefined;
	}
}

interface HologramGlyph {
	mast: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
	diamond: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

interface HologramSystem {
	root: THREE.Group;
	contactGlyphs: THREE.Group;
	mastGeometry: THREE.CylinderGeometry;
	diamondGeometry: THREE.BufferGeometry;
	glyphPool: HologramGlyph[];
	contactMaterial: THREE.LineBasicMaterial;
	targetMaterial: THREE.LineBasicMaterial;
	contactMastMaterial: THREE.MeshBasicMaterial;
	targetMastMaterial: THREE.MeshBasicMaterial;
}

interface CockpitHardware {
	mesh: THREE.Group;
	scannerTexture: THREE.CanvasTexture;
	scannerCtx: CanvasRenderingContext2D;
	hologram: HologramSystem;
	flightInstrument: Instrument;
	targetInstrument: Instrument;
	throttleFill: THREE.Mesh;
	throttleFillMaterial: THREE.MeshStandardMaterial;
	instrumentKey: string;
}

class Game {
	readonly world: World;
	readonly renderer: THREE.WebGLRenderer;
	readonly composer: EffectComposer;

	/** Background: stars only, no depth, re-centred on the camera each frame. */
	readonly backdropScene = new THREE.Scene();
	/** Far: system bodies at `FAR_SCALE`, angular size preserved. */
	readonly farScene = new THREE.Scene();
	/** Approach: close stars, planets, and moons at intermediate scale. */
	readonly approachScene = new THREE.Scene();
	/** Switchable from the perf panel; see `perf-panel.ts`. */
	private bloomPass!: UnrealBloomPass;
	/**
	 * Resolution has exactly one owner, and it is the player's setting.
	 *
	 * This game is fill-rate bound — a planet filling the view costs its surface
	 * shader per pixel — so the buffer size is the largest single lever there
	 * is, and a retina panel makes it four times what the same window costs at
	 * ratio 1.
	 *
	 * There was briefly a second multiplier here, driven by the perf panel, and
	 * it multiplied with the setting rather than replacing it: panel at 50% and
	 * setting at 50% gave 25%, while the panel's readout reported only its own
	 * half. A diagnostic may not co-own player state. The panel prices the terms
	 * that are not settings; this one is a setting.
	 *
	 * **What was observed, and what it does and does not license.** The same
	 * view over a venusian gave 17 fps on a retina laptop panel and 70 on an
	 * external display. The 4:1 ratio matches the pixel counts, and an earlier
	 * version of this comment concluded "that is the pixel count and nothing
	 * else". It is not entitled to: two physical displays differ in refresh
	 * rate, compositor path, GPU power state and thermal headroom as well as in
	 * pixels, and the comparison controlled for none of them.
	 *
	 * The controlled test is a keypress and has not been run: set the setting to
	 * 50% on the *laptop*, where the buffer then matches the external display's,
	 * and see whether the rate does. Until then the honest reading is that
	 * resolution is a large lever — which the buffer sizes prove on their own —
	 * and not that it is the whole of that particular gap.
	 */
	readonly settings = new SettingsStore();

	/**
	 * Drop every held key.
	 *
	 * A dialog that takes `keydown` does not take back the keys already down:
	 * a throttle or pitch key held when the settings screen opens stays in this
	 * set, and the ship goes on flying behind a screen the player is reading.
	 * The settings screen calls this as it opens, and `probe-boot` fails if it
	 * stops.
	 */
	releaseHeldKeys() {
		this.keys.clear();
	}
	/** How many keys the game currently believes are down — what `probe-boot`
	 *  asserts on, since "the ship kept flying" is otherwise only a comment. */
	get heldKeyCount() {
		return this.keys.size;
	}

	/** The bloom pass, for the perf panel to switch. */
	get bloom() {
		return this.bloomPass ?? null;
	}
	/** Near: ships, stations, anything at 1:1 kilometres. */
	readonly nearScene = new THREE.Scene();

	readonly backdropCamera: THREE.PerspectiveCamera;
	readonly farCamera: THREE.PerspectiveCamera;
	readonly approachCamera: THREE.PerspectiveCamera;
	readonly nearCamera: THREE.PerspectiveCamera;

	/** Ship orientation. Positions live in `sim.ts`; this does not, and the
	 *  module docstring there says why. */
	readonly orientation = new THREE.Quaternion();

	/**
	 * The drawn object per body id — a `Mesh` for a sphere, a `Group` for a
	 * station, which is why this is typed as `Object3D` rather than `Mesh`.
	 *
	 * A station is not a sphere any more (#28): three procedural silhouettes,
	 * built in kilometres by `station-mesh.ts`. That is what `meshScale` below
	 * exists for.
	 */
	private readonly meshes = new Map<string, THREE.Object3D>();
	/**
	 * Each station's built mesh handle: the rotating part, the detail level it is
	 * currently drawn at, and the materials the clock drives (#36).
	 *
	 * The whole handle rather than just the spinner, because the render loop now
	 * has two things to write per station and they are computed from the same
	 * distance. The spin phase comes from `stationPose` in sim and nothing reads
	 * it back off the `Object3D` (`docking.md` §4.1); the detail level and the
	 * lights come from `station-mesh.ts`, driven by the same game clock.
	 */
	private readonly stationVisuals = new Map<string, StationMesh>();
	/** The shader surface for every body that is a sphere — star, planet, moon.
	 *  A station is not in here; `stationVisuals` above is its equivalent. */
	private readonly bodyVisuals = new Map<string, BodyVisual>();
	/** The system's star, resolved once. Every body's sun direction is measured
	 *  from it, and the system is fixed for a game's lifetime. */
	private starBody?: Body;
	/**
	 * Which layer each body is currently drawn in.
	 *
	 * Held rather than recomputed from the scene graph, because reading it back
	 * out of an `Object3D` is exactly what rule 2 above forbids — and because the
	 * hysteresis makes the answer depend on the previous frame, which the scene
	 * graph does not record.
	 */
	private readonly layers = new Map<string, "near" | "approach" | "far">();
	private shipMesh!: THREE.Group;
	/** Throwaway #48 target: a renderer-only silhouette, never a #35 traffic actor. */
	private combatTargetMesh!: THREE.Mesh;
	/** Bright, camera-local tracer shown only while the throwaway weapon is held. */
	private combatLaser!: THREE.Line;
	/** Cockpit structure follows the ship, while the camera pans within it. */
	private cockpit!: CockpitHardware;
	private tuningKey = "";
	private tuningText = "";
	/** Exposed for the browser probe; sourced fresh from simulation every frame. */
	private readonly scannerContactBuffer: ScannerContact[] = [];
	scannerContacts: ScannerContact[] = this.scannerContactBuffer;
	/** The browser probe reads this live value instead of copying scanner range. */
	readonly scannerRangeKm = SCANNER_RANGE_KM;
	private stars!: THREE.Points;
	private starMaterial!: THREE.ShaderMaterial;

	private readonly keys = new Set<string>();
	/** Throwaway #48 balance state: it is not world or persistent combat state. */
	combat: CombatPrototypeState = createCombatPrototype();
	/** Prototype chrome is opt-in, so the normal flight HUD stays production-only. */
	private readonly combatPrototypeEnabled =
		new URLSearchParams(window.location.search).get("combat") === "1";
	private combatIncoming = false;
	private combatEcm = false;
	/** The floor strip's fitted scale for the width it was solved at. One memo
	 *  and not a map: the fit is a property of the viewport, and a resize drag
	 *  through a thousand widths should not leave a thousand entries behind. */
	private floorFit: {
		width: number;
		scale: number;
		overflowPx: number;
	} | null = null;

	/** Fitted overlay font cache: keyed by role + glass width; the fit is
	 *  computed against a widest-case text so any live state fits. */
	private combatStatusFit = new Map<
		string | number,
		{ font: string; worstWidth?: number }
	>();
	/** The fitted width of the widest status text at the current glass width. */
	combatStatusWorstWidth = 0;
	/** The overlay lines drawn last frame, at the font each was fitted to. */
	combatOverlayLines: { text: string; font: string; width: number }[] = [];
	/** Probe-only laser visibility override; the renderer honours it. */
	probeForceLaserHidden = false;
	/** rAF handle, so a probe can freeze the loop and render by hand. */
	private animationFrame = 0;
	/** Freeze the frame loop; the caller renders manually with a fixed sim state. */
	probeFreezeLoop() {
		if (!this.combatPrototypeEnabled) return;
		if (this.animationFrame) {
			cancelAnimationFrame(this.animationFrame);
			this.animationFrame = 0;
		}
	}
	/** Resume the frame loop. */
	probeResumeLoop() {
		if (!this.combatPrototypeEnabled) return;
		if (!this.animationFrame) this.animate();
	}
	readonly audio = new AudioFX();
	private throttle = 0;
	private frameBody: Body | null = null;
	/** View-local head direction. It does not change the ship's orientation. */
	headLook: HeadLook = "forward";
	private rightTab: RightTab = "Flight";
	private leftTab: LeftTab = "Navigation";
	/** The forward station console keeps its tab across a head turn while docked. */
	private stationConsoleTab: StationConsoleTab = "Market";
	/** Commander-owned mutable commerce state; no renderer may write it. */
	private commander = newCommander();
	/** The game-owned per-galaxy state holds the station deficit map. */
	private commerceWorld!: WorldState;
	/** Docked console screens are stable until station or tab changes; do not rebuild them each frame. */
	private stationConsoleCache: LiveCockpitState["stationConsole"] = null;
	private stationConsoleCacheKey: string | null = null;
	private stationConsoleRevision = 0;
	/**
	 * What the Navigation list is narrowed to.
	 *
	 * Held here rather than inside `LiveCockpit` because the filter decides
	 * which rows exist, and the rows decide which bodies get an ETA — which is
	 * `timeToBody`'s integration. A panel that owned the filter privately would
	 * make the cost of a frame a fact the game could not see.
	 */
	private navFilter: NavFilter = { kinds: [], query: "" };
	/** Per-row arrival estimates, refreshed on `ETA_INTERVAL_S`. */
	private readonly navEtaCache = new Map<string, number | null>();
	private navEtaAt = Number.NEGATIVE_INFINITY;
	/** The Galaxy Map tab's chart, while that tab is open. */
	private chart: GalaxyChart | null = null;
	/** Which mount request is current; see `setChartHost`. */
	private chartGeneration = 0;
	private readonly headRotation = new THREE.Quaternion();
	private readonly viewRotation = new THREE.Quaternion();
	private readonly liveCockpit: LiveCockpit;

	/**
	 * The cruise regime's whole state, public because a probe has to be able to
	 * drive it and read it.
	 *
	 * Held on the renderer rather than in `cruise.ts` deliberately: that module
	 * is a pure law with no memory, which is what lets a headless test replay a
	 * leg at three frame rates and demand the same answer. The *session* — which
	 * regime, how much charge, what is selected, how long the last leg took — is
	 * the game's, and it is the half that a save file will eventually carry.
	 */
	regime: Regime = "normal";
	/** A copy, not the module's object: the dials mutate this, and the spec's
	 *  own figures stay reachable as `DEFAULT_CRUISE` for the reset key. */
	cruiseParams: CruiseParams = { ...DEFAULT_CRUISE };
	/** §7's drive charge, AU. Starts full — a new game docks first. */
	chargeAu = CHARGE_CAPACITY_AU;
	/** Seconds left of §4's spool-up before cruise actually engages. */
	spoolLeftS = 0;
	/** What the drop-out and the readouts are measured against (§6: selection is
	 *  a convenience, never a rail). */
	targetId: string | null = null;
	/**
	 * #5's flight assist, a player toggle defaulting on.
	 *
	 * Remembered rather than applied inside cruise, which is a distinct dynamic
	 * that does not honour it (#10 §1) — so leaving cruise puts the ship back in
	 * whichever regime it was flying before.
	 */
	assist = true;
	/** #5 made cockpit the default and chase a toggle. The hull is hidden in
	 *  cockpit, which is what makes the HUD markers load-bearing. */
	view: "cockpit" | "chase" = "cockpit";
	/** Chase orbit about the ship's own up axis; zero is directly astern. Held
	 *  across a view toggle, because a look you set up is a look you meant. */
	chaseYaw = 0;
	/** How fast the ship is turning, radians per second — rotation has momentum,
	 *  and `sim.ts`'s `stepAngular` owns the dynamics. */
	rates: Angular = { pitch: 0, yaw: 0, roll: 0 };
	/** Pointer movement accumulated since the last step, in pixels. Consumed
	 *  each frame — a delta applied twice is a ship that turns at the frame
	 *  rate rather than at the hand's speed. */
	private mouseDx = 0;
	private mouseDy = 0;
	/** The selectable bodies, in display order. Invalidated by changing system —
	 *  which nothing does yet, and which is why this is a field rather than a
	 *  `readonly` built in the constructor. */
	private selectableCache: Body[] | null = null;
	/**
	 * The parked review fleet, gated on `?fleet`.
	 *
	 * Off by default because thirty-three hulls is a showroom, not a star
	 * system: it is a lot of geometry, and a hull the player can fly past but
	 * never scan, target or collide with would be a lie in the shipped game.
	 * Behind the gate it is honest — a static display arrangement, anchored
	 * once, with no entry in `sim.ts` and no roster meaning. #26 still owns
	 * anything that is meant to be a ship rather than a picture of one.
	 */
	private readonly fleetReview = new URLSearchParams(
		window.location.search,
	).has("fleet");
	private fleet: { mesh: THREE.Object3D; slot: FleetSlot; pos: Vec3 }[] = [];
	private fleetAnchored = false;
	/** The speed law's masses, rebuilt once per clock value. See `masses()`. */
	private massesCache: { id: string; pos: Vec3; radiusKm: number }[] | null =
		null;
	private massesAt = Number.NaN;
	/** The overlay the markers are drawn on: a 2D canvas over the WebGL one. */
	private overlay!: HTMLCanvasElement;
	private overlayCtx!: CanvasRenderingContext2D;

	/** Speed the cruise integrator reported last frame, km/s. */
	cruiseSpeedKms = 0;
	/** And the same speed in the target's frame — the one that decides whether
	 *  the approach arrives or sails past. */
	closingKms = 0;
	/** `gameTime` at which the current leg's spool-up finished, and how long the
	 *  last completed leg took. The number this node exists to judge: 68 s on a
	 *  typical leg is either a journey or dead time, and nothing but the clock
	 *  can say which. */
	legStartedAtS: number | null = null;
	lastLegS: number | null = null;
	/** Why cruise ended last time — shown on the HUD, so an overshoot is legible
	 *  as an overshoot rather than as the regime having dropped out for no
	 *  visible reason. */
	lastExit = "";
	private warp!: WarpField;
	private lastTime = 0;
	private hud: HTMLElement;
	/** The old text HUD stays probe-addressable without taxing the live cockpit. */
	private readonly legacyHud = new URLSearchParams(window.location.search).has(
		"legacy-hud",
	);
	/** The last time-to-target estimate, and the clock value it was made at. */
	private etaCache: number | null = null;
	private etaAt = Number.NEGATIVE_INFINITY;
	/** Text geometry from the current glass pass, exposed so the visual probe can
	 * compare the rendered glyphs with the renderer's own placement contract. */
	readonly cockpitPrompt = new TextRaster();
	/** Prototype-only glass status, exposed for the browser probe. */
	readonly combatOverlayStatus = new TextRaster();
	/**
	 * What §5's flight-floor strip painted this frame, or `null` when it painted
	 * nothing — a focused console has replaced the glass.
	 *
	 * **Written by the draw, from the values it drew**, the same pattern as
	 * `directorRender`. A record assembled beside the draw from the same state
	 * would let a probe assert a strip that was never painted, which is the
	 * check-that-cannot-fail this repo has shipped once already.
	 */
	floorRender: {
		cells: FloorCell[];
		boxes: { label: string; x: number; y: number; width: number }[];
		baselineY: number;
		glassBottomY: number;
		/** What the strip was shrunk by to fit its widest reading in this
		 *  viewport — 1 where it did not have to shrink at all. */
		scale: number;
		marginPx: number;
		/**
		 * How far the widest reading still overruns the margins at the fitted
		 * scale — zero at both viewports `probe-live-cockpit.mjs` measures.
		 *
		 * **Two things can put it above zero**, and the check does not care
		 * which: the legibility clamp binding on a viewport too narrow for the
		 * widest run, or the type size rounding to a whole pixel above what the
		 * linear solve predicted. The solve assumes width is linear in size,
		 * which is close but not exact, so the confirming measurement is what
		 * decides — and the residue is what it decides *with*.
		 */
		overflowPx: number;
		source: {
			regime: string;
			spoolLeftS: number;
			throttle: number;
			assist: boolean;
			chargeAu: number;
		};
	} | null = null;
	/**
	 * What §3's docking director drew this frame, or `null` when it drew
	 * nothing. The same pattern as `cockpitPrompt`: the record is written by the
	 * draw itself rather than recomputed beside it, so a probe reading it cannot
	 * pass against a director that was never painted.
	 */
	directorRender: DirectorRender | null = null;
	/** What the HUD last displayed, quantised to its own resolution — so a frame
	 *  that would render the same text neither builds nor writes it. */
	private hudKey = "";
	/** Frames drawn since boot. A probe's cheapest proof that the loop runs. */
	frames = 0;

	/**
	 * The unit scheme, reachable from the handle — the whole module, not a copy.
	 *
	 * A probe that restated `HANDOFF_KM` would assert against its own copy, and
	 * the failure that produces is a **false red**: change the module to 5e3 and
	 * the probe still places the ship at 9,990 km expecting the near layer, gets
	 * far, and reports a bug in a renderer that is behaving correctly.
	 *
	 * The namespace rather than a hand-picked literal, because a literal is a
	 * second list to maintain: the first version named five constants, and a probe
	 * wanting `FAR_FAR_UNITS` would have had to edit the renderer to get it.
	 *
	 * The cost of that choice, stated so it is a decision rather than an
	 * accident: **adding an export to `units.ts` widens this page's public
	 * surface.** Everything that module exports — `layerFor` today, whatever is
	 * added later — becomes reachable through `window.__seelite`. That is
	 * acceptable while `units.ts` is a leaf of constants and one pure function;
	 * the day it gains something that should not be reachable from a page, this
	 * goes back to a named list.
	 *
	 * The trade is worth naming: a probe reading the constant cannot notice the
	 * constant being *wrong*. That belongs to the headless tests over the scheme's
	 * own arithmetic — `tests/headless.test.ts` and `sim.test.ts`'s float32 budget.
	 */
	readonly units = units;

	/** #5's assist cap, reachable from the handle for the same reason the unit
	 *  scheme is: a probe that restated it would assert against its own copy and
	 *  go falsely red the day the flight model retunes it. */
	readonly assistCapKms = ASSIST_CAP_KMS;

	/** #14's shell, on the handle for the same reason: `probe-arrival.mjs` states
	 *  its bound as a fraction of this rather than as its own 1.05. */
	readonly surfaceMargin = SURFACE_MARGIN;

	/** #30's host standoff, likewise — the probe reports the stop against this
	 *  rather than restating 5 km. */
	readonly hostClearanceKm = HOST_CLEARANCE_KM;

	/** Probe-callable ray arithmetic, kept apart from the constant handles: a
	 *  constant can be diffed and versioned, exported arithmetic cannot. */
	readonly rayMath: ProbeRayMath = { closestApproachKm };

	/** §4's spin range, reachable from the handle for the same reason: the spin
	 *  probe drives a station to both ends of it, and a probe that restated
	 *  0.6 and 3.0 would assert against its own copy. */
	readonly spinRange = SPIN_RPM_RANGE;

	/**
	 * §6's clearance range, on the handle for the same reason the spin range is.
	 *
	 * Note that this is **not** `cruiseParams.vicinityKm`, which the `m`/`n`
	 * dials move: that one is #14's approach clamp, a tuning knob for how cruise
	 * arrives. This one is the gameplay range at which a station will answer a
	 * clearance request, and `docking.md` §6 keeps the two apart by name so that
	 * retuning the arrival does not silently retune the protocol.
	 */
	readonly dockingVicinityKm = VICINITY_KM;

	/**
	 * §3's tolerances, reachable from the handle — and **only** the tolerances.
	 *
	 * §9.2's probes assert against the gate and the two angles, and a probe
	 * holding its own copy of 0.10 km/s or 35° goes falsely red the day §11.4's
	 * "most likely to move" numbers move. What they do *not* need is
	 * `attemptEntry`, `repel` or `requestClearance`, and the first version of
	 * this line published the whole module and put all three on the page. The
	 * `units` namespace is exposed whole because it is a leaf of constants; this
	 * module has state-mutating entry points, so it gets a named subset.
	 *
	 * Frozen, so a probe cannot write one and then measure against its own
	 * value while reporting that it read the renderer's.
	 */
	/** §3's approach range, on the handle for the same reason the tolerances are:
	 *  a probe that restated it would go falsely red the day it is retuned. */
	readonly directorRangeKm = DIRECTOR_RANGE_KM;
	/** The widest reading §5's floor strip can take, so a probe measuring the
	 *  fit drives the run the layout was solved for rather than a copy of it. */
	readonly floorWidest = flightFloorWidest(
		CHARGE_CAPACITY_AU,
		CHARGE_REGEN_AU_PER_S,
		SPOOL_S,
	);
	/** The wind-up, so a probe driving the strip to its widest reading asks the
	 *  sim how long a spool is rather than assuming one. */
	readonly spoolSeconds = SPOOL_S;

	/** Where the flying glass ends, as a fraction of the frame — on the handle so
	 *  a probe measuring the clip reads the renderer's line, not its own. */
	readonly glassBottomFraction = GLASS_BOTTOM_FRACTION;

	readonly dockingTolerances = Object.freeze({
		V_GATE_KMS,
		AXIS_TOLERANCE_DEG,
		ROLL_TOLERANCE_DEG,
		// **`UNDOCK_CLEAR_KM` retired with #77.** It shipped in #68 as an
		// anti-latch measure and said so in its own docstring — `dockedAt` was
		// set and never cleared, and leaving was never designed. §12.2 designed
		// it, so the tripwire is gone and `dockPhase` is what a probe reads.
		ARRIVAL_SECONDS,
	});

	/**
	 * §6's protocol state, one per station, created on first contact.
	 *
	 * Keyed by station id and held on the game rather than on the `Station`
	 * record, because a station record is generated from the seed and a grant is
	 * something the player did — the same split `station.ts` makes for the
	 * market's stock deficit.
	 */
	private readonly dockingStates = new Map<string, DockingState>();

	/**
	 * §6.1's injected slot occupancy, per station.
	 *
	 * Empty in the live game, and that is the spec's own state of affairs: NPC
	 * traffic is #8's and unbuilt, so every request is granted at once. It is a
	 * writable map rather than a constant zero so the queued branch is reachable
	 * from a probe as well as from the headless tests — an unexercised branch is
	 * what §6.1 refuses.
	 */
	readonly slotOccupancy = new Map<string, number>();

	/**
	 * #8's shield and hull pools, standing in (`docking.md` §10).
	 *
	 * The whole of what the game does with them today is take docking damage.
	 * #8 owns the real pools, the real scale, and — §11.6 — whatever undoes the
	 * damage; until that lands D1's failure model is survivable but not yet
	 * costly.
	 *
	 * **`interim` in the name, matching the `INTERIM_` constants it is built
	 * from.** A field called `condition` on the game handle is the slot #8's real
	 * pools would silently inherit, and inheriting a stand-in is how a temporary
	 * answer stops being visible as one.
	 */
	interimCondition: ShipCondition = fullCondition();

	/**
	 * §12's dock state machine — arriving, docked, launching, or flying.
	 *
	 * One session rather than a `dockedAt` string, because §12 creates three
	 * states and a nullable id can only express one of them. The old field is
	 * kept as a derived getter below: everything that asked "is the ship docked
	 * at this station" still gets the same answer, and nothing has to learn the
	 * new vocabulary to keep working.
	 */
	dock: DockSession = newDockSession();

	/** Which station the ship is **docked** at, or `null` — the arrival and the
	 *  launch are not it (§12.3's three states are distinct). */
	get dockedAt(): string | null {
		return this.dock.phase === "docked" ? this.dock.stationId : null;
	}

	/** §12.3's row, for anything that needs to know which state the ship is in
	 *  rather than only whether it is parked. */
	get dockPhase(): DockPhase {
		return this.dock.phase;
	}

	/**
	 * Put the ship back in flight without flying a launch.
	 *
	 * **For the probe tier, which teleports.** A run that places the ship
	 * somewhere new has to end whatever session the run before it left, and
	 * while the phase is not `flying` `step` runs the arrival and ignores every
	 * input — so a probe that skipped this would fly nothing at all. It exists
	 * as a method rather than as a `g.dock = { … }` literal in the probe because
	 * that tier is not typechecked: a field added to `DockSession` would leave
	 * the probe seeding a malformed session and its rows green against a state
	 * the game never produces.
	 *
	 * Not a launch, and nothing in the game calls it: §12.2's launch is the only
	 * way a *player* leaves.
	 */
	resetDock() {
		this.dock = newDockSession();
	}

	/**
	 * Whether the ship carries §7's 1,000 Cr computer.
	 *
	 * `true` because there is nowhere to buy one: the market module has the
	 * price (`EQUIPMENT`, and this node consumes that rather than pricing it)
	 * and no screen sells it (#70 owns that). Shipping it fitted rather than
	 * absent is what makes §7's behaviour reachable at all, and §7.1's reading —
	 * an early-game skill gate and a late-game option — is a claim about the
	 * economy that cannot be made until the shop exists.
	 *
	 * **The cost of that default is real and it is not the economy.** §3.1's
	 * open question is whether a *person* can hold the 0.10 km/s gate, and a
	 * game that boots with the autopilot fitted is a game where the first thing
	 * anyone flies is the autopilot. The mitigation is that it is off until
	 * asked for (`u`), and that §9.2's two failure runs disengage it explicitly
	 * — but the honest reading is that this default makes the skill gate easy to
	 * never meet, which is the opposite of what §7.1 assumes about the early
	 * game. Once #70's screen exists this should ship `false`.
	 */
	hasDockingComputer = true;

	/** Whether it is flying. Any control input cancels it (§7). */
	dockingComputerEngaged = false;

	/**
	 * Why the computer last stopped flying, or `null`.
	 *
	 * Held rather than dropped because a disengagement the player cannot see is
	 * the same defect §8 records about invisible tolerances. The cue itself
	 * belongs to the HUD node; this is the value it will read.
	 */
	lastComputerRefusal: "no-clearance" | "hostile" | "out-of-range" | null =
		null;

	/** The name it is filed under in the equipment table, on the handle so a
	 *  probe naming it does not restate the string. */
	readonly dockingComputerName = DOCKING_COMPUTER;

	/**
	 * The last crossing of an aperture plane, whatever it did.
	 *
	 * Held for the HUD node and read by the probes: §9.2's mis-rolled and
	 * hull-face runs both assert on the *outcome* of a crossing, and a probe
	 * that had to infer one from the ship's position afterwards would be
	 * measuring the repel rather than the verdict.
	 */
	lastEntry: EntryOutcome | null = null;

	/**
	 * The pose the renderer is mirroring for one station, at the current clock.
	 *
	 * Reachable from the handle for the same reason the unit scheme is: the
	 * spin probe has to know which way a station's aperture faces to view it
	 * face-on, and a probe that derived the axis itself would be asserting its
	 * own copy of the rule rather than the renderer's. It reads sim, never the
	 * scene graph (`docking.md` §4.1).
	 */
	poseOfStation(id: string) {
		return stationPose(this.world.system, id, this.world.gameTime);
	}

	/**
	 * Redraw one body as a class it is not, or restore it.
	 *
	 * **Display-only, and for one question a probe cannot otherwise ask**: does
	 * the surface class decide the pixels? Comparing two *different* bodies
	 * cannot answer it, because the seed decorates within a class and two gas
	 * giants differ about as much as a giant and a moon — so a build that drew
	 * every body with one seed-parameterised shader would look exactly as varied.
	 * Drawing the **same** body under each class holds the seed, the lighting,
	 * the camera and the geometry still, and leaves the class as the only thing
	 * that changed.
	 *
	 * Nothing in the game calls this, and the appearance on the body is
	 * untouched — `sim.ts` still owns what a body *is*, and this only swaps what
	 * is drawn for it. Passing `null` puts the generated class back.
	 */
	redrawBodyAs(id: string, surface: SurfaceClass | null) {
		const body = this.world.system.byId.get(id);
		if (!body?.appearance) return false;
		const old = this.bodyVisuals.get(id);
		if (!old) return false;
		const layer = this.layers.get(id) ?? "far";
		old.group.removeFromParent();
		old.dispose();
		const visual = buildBodyVisual(
			surface ? { ...body.appearance, surface } : body.appearance,
			surfaceSphere(layer),
			this.bodyVisualOptions(),
		);
		visual.group.name = id;
		this.bodyVisuals.set(id, visual);
		this.meshes.set(id, visual.group);
		// Through `setLayer`, so the new group is scaled and parented by the one
		// rule that does it — a hand-placed group would be the second copy of the
		// scale assignment `setLayer`'s own docstring warns about.
		this.setLayer(body, layer);
		return true;
	}

	/**
	 * What #59's surface pass is currently drawing for one body.
	 *
	 * The same handle `visualOfStation` is, and for the same reason: a probe has
	 * to know which class a body is being drawn as, and a probe that recomputed
	 * it would be asserting its own copy of the rule rather than what is on
	 * screen.
	 *
	 * `sunDir` is reported too, but as **state and not as verification**. An
	 * earlier probe read it back and compared it to the same body-to-star
	 * formula the render loop had just used, which confirmed an assignment
	 * rather than a render — a shader ignoring the uniform would have passed. The
	 * claim is checked on pixels now, from the night side; this stays because it
	 * is what a failure looks like when you go to explain one.
	 *
	 * `undefined` for a station, which is drawn by `station-mesh.ts` and has no
	 * surface class. Throwing would make a probe that walks every body have to
	 * know the taxonomy.
	 */
	visualOfBody(id: string) {
		const visual = this.bodyVisuals.get(id);
		if (!visual) return undefined;
		const sun = visual.uniforms.sunDir.value as THREE.Vector3;
		return {
			surface: visual.surface,
			// A copy: the renderer writes through this vector every frame, and a
			// probe holding the live one would read whatever the next frame put
			// there rather than what it measured.
			sunDir: { x: sun.x, y: sun.y, z: sun.z },
		};
	}

	/**
	 * The cost of one rendered frame, with the display's cadence taken out.
	 *
	 * A mean of `requestAnimationFrame` deltas cannot report anything faster
	 * than the refresh interval, so on a 60 Hz display it bottoms out at 16.7 ms
	 * whatever the shaders cost — a measure of the monitor, not of the work.
	 * This renders back to back outside that cadence instead.
	 *
	 * **The fence is a `readPixels`, not `finish()`.** `gl.finish()` is
	 * specified to block until the queue drains, but through a headless
	 * browser's GPU queue it returns immediately, and the loop then measures the
	 * time to *enqueue* the frame, which is approximately zero. `readPixels` has
	 * to hand back real bytes, so it cannot return before the frame has been
	 * rasterised. The same finding `planet-prototype.ts` records: `finish()`
	 * reported 0.0 ms against an observed 76.9 ms cadence for the same scene.
	 *
	 * `render(0)` and not `render(dt)`: a frame budget is about how long a frame
	 * takes to draw, and advancing the world between samples would move the
	 * bodies out from under the measurement.
	 */
	measureRenderMs(samples = 20): number {
		const gl = this.renderer.getContext();
		const fence = new Uint8Array(4);
		const sync = () =>
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, fence);
		// One warm-up, so shader compilation and buffer upload are not charged to
		// the first sample.
		this.render(0);
		sync();
		const started = performance.now();
		for (let i = 0; i < samples; i++) {
			this.render(0);
			// Per iteration rather than once at the end: the driver is free to
			// pipeline a batch of identical frames, and a single trailing fence
			// would measure the last one plus whatever overlapped.
			sync();
		}
		return (performance.now() - started) / samples;
	}

	/**
	 * What #36's visual pass is currently drawing for one station.
	 *
	 * A snapshot of the handle the render loop writes, for the same reason
	 * `poseOfStation` exists: `probe-station-visuals.mjs` has to know which
	 * detail band a station is in and how bright its strobes are at this clock,
	 * and a probe that recomputed either would be asserting its own copy of the
	 * rule. `detail` is the level the renderer settled on, not the level the band
	 * arithmetic would return from scratch — the band is directional, so those are
	 * different questions and this one is the one that is on screen.
	 *
	 * The snapshot itself is `station-mesh.ts`'s, not assembled here: reading
	 * `fixture.material.emissiveIntensity` from the game shell made this depend
	 * on how a fixture stores its drive.
	 */
	visualOfStation(id: string) {
		const station = this.stationVisuals.get(id);
		return station ? stationVisualSnapshot(station) : null;
	}

	/**
	 * The shields themselves, in build order — mouth first, then the interior
	 * one on a slot.
	 *
	 * **The list `station-mesh.ts` collected**, not one a caller re-derives by
	 * traversing for a name. A probe measuring one shield against the other
	 * needs to say *which*, and two spellings of "which objects are the shields"
	 * is one that goes quietly green the day the name moves.
	 */
	nameplatesOfStation(id: string): THREE.Mesh[] {
		return this.stationVisuals.get(id)?.nameplates ?? [];
	}

	/** The docked-only inner gate, exposed so the browser probe reads the live mesh. */
	hangarGateOfStation(id: string): THREE.Object3D | null {
		return this.stationVisuals.get(id)?.hangarGate ?? null;
	}

	constructor(seed: number) {
		this.world = makeWorld(seed);
		this.commerceWorld = newPersistentWorld(seed);
		for (const _body of this.world.system.bodies)
			this.scannerContactBuffer.push({} as ScannerContact);
		this.updateLocalFrameBody();
		this.faceTheStar();

		this.renderer = new THREE.WebGLRenderer({
			antialias: true,
			powerPreference: "high-performance",
		});
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		// The composer is given the same ratio in `onResize`, which is called
		// once during boot so the two can never be set in only one place.
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.0;
		// The passes below manage their own clearing — the composite depends on
		// depth surviving between two of them and being dropped between two
		// others, which an automatic clear would undo.
		this.renderer.autoClear = false;
		document.body.appendChild(this.renderer.domElement);

		const aspect = window.innerWidth / window.innerHeight;
		// One field of view across all three, and that is load-bearing rather than
		// tidy: the layers composite into one image, so a body's projected size
		// has to agree across the seam it crosses.
		const fov = 60;
		// Its far plane just clears the star sphere; the layer writes no depth
		// anyway, so the numbers only have to bracket the geometry.
		this.backdropCamera = new THREE.PerspectiveCamera(
			fov,
			aspect,
			0.1,
			BACKDROP_RADIUS * 2,
		);
		// Both planes come from `units.ts`, which says where they come from: the
		// near one has to admit a body that has not yet crossed `HANDOFF_KM`, and
		// the far one is set by the widest orbit the generator can produce.
		this.farCamera = new THREE.PerspectiveCamera(
			fov,
			aspect,
			FAR_NEAR_UNITS,
			FAR_FAR_UNITS,
		);
		this.approachCamera = new THREE.PerspectiveCamera(
			fov,
			aspect,
			APPROACH_NEAR_UNITS,
			APPROACH_FAR_UNITS,
		);
		this.nearCamera = new THREE.PerspectiveCamera(
			fov,
			aspect,
			NEAR_NEAR_KM,
			NEAR_FAR_KM,
		);

		this.buildBackdrop();
		this.buildBodies();
		this.buildShip();
		this.buildCockpit();
		if (this.combatPrototypeEnabled) {
			this.combatTargetMesh = new THREE.Mesh(
				new THREE.ConeGeometry(0.45, 1.3, 4),
				new THREE.MeshStandardMaterial({
					color: 0x9d2f35,
					emissive: 0x450308,
					emissiveIntensity: 1.2,
				}),
			);
			this.combatTargetMesh.name = "combat-prototype-target";
			this.combatTargetMesh.rotation.x = Math.PI / 2;
			this.nearScene.add(this.combatTargetMesh);
			this.combatLaser = new THREE.Line(
				new THREE.BufferGeometry().setFromPoints([
					new THREE.Vector3(0, 0, -0.6),
					new THREE.Vector3(0, 0, -12),
				]),
				new THREE.LineBasicMaterial({
					color: 0x74eaff,
					transparent: true,
					opacity: 0.95,
				}),
			);
			this.combatLaser.name = "combat-prototype-laser";
			this.nearScene.add(this.combatLaser);
		}
		this.warp = warpField(this.world.seed);
		this.nearScene.add(this.warp.object);
		// Something is selected on frame one. §6 makes selection a convenience
		// rather than a rail, but a cruise panel with an empty target field on
		// boot reads as broken, and the nearest station is what a ship at the
		// arrival point is there to reach.
		this.targetId = this.nearestOfKind("station")?.id ?? null;
		this.refreshScannerContacts();

		this.composer = new EffectComposer(this.renderer);
		// Back to front. The first pass clears colour; the third clears *depth*
		// only, so the near layer cannot be occluded by a planet 3 AU away that
		// the far layer drew at 1/100,000 scale. The second clears nothing,
		// because the background wrote no depth for it to fight with.
		const backdropPass = new RenderPass(
			this.backdropScene,
			this.backdropCamera,
		);
		backdropPass.clear = true;
		const farPass = new RenderPass(this.farScene, this.farCamera);
		farPass.clear = false;
		const approachPass = new RenderPass(
			this.approachScene,
			this.approachCamera,
		);
		approachPass.clear = false;
		approachPass.clearDepth = true;
		const nearPass = new RenderPass(this.nearScene, this.nearCamera);
		nearPass.clear = false;
		nearPass.clearDepth = true;
		this.composer.addPass(backdropPass);
		this.composer.addPass(farPass);
		this.composer.addPass(approachPass);
		this.composer.addPass(nearPass);
		// Kept as a field so `perf-panel.ts` can switch it live. A full-screen
		// multi-pass blur at up to 2x device pixel ratio is a fixed cost every
		// frame whatever is on screen, so it is the first thing to price against
		// a shader that is only expensive when a body fills the view.
		this.bloomPass = new UnrealBloomPass(bloomResolution(), 0.55, 0.6, 0.85);
		this.composer.addPass(this.bloomPass);
		this.composer.addPass(new OutputPass());

		this.overlay = document.getElementById("overlay") as HTMLCanvasElement;
		this.overlayCtx = this.overlay.getContext("2d") as CanvasRenderingContext2D;
		// Sized **here** as well as on resize: a canvas that has never seen a
		// resize event keeps its 300x150 default, and every marker lands inside
		// that box in the top-left corner while the CSS stretches nothing.
		this.sizeOverlay();
		this.hud = document.getElementById("hud") as HTMLElement;
		this.liveCockpit = new LiveCockpit({
			onRightTab: (tab) => {
				this.rightTab = tab;
				this.updateCockpit();
			},
			onLeftTab: (tab) => {
				this.leftTab = tab;
				this.updateCockpit();
			},
			onNavFilter: (filter) => {
				this.navFilter = filter;
				// Widening the filter re-admits rows whose estimate was computed
				// earlier in this interval and then never touched again. Cheaper
				// to drop the whole map on a filter change — which is a keystroke,
				// not a frame — than to key every entry by its tick.
				this.navEtaCache.clear();
				this.updateCockpit();
			},
			onSelectTarget: (id) => {
				// **Through `selectable()`, not through `byId`.** `byId` holds
				// moons, which the list deliberately omits and `cycleTarget`
				// cannot reach — accepting one here would make the list's stated
				// reason for omitting them false, and give the player a target
				// `T` could never return to.
				if (!this.selectable().some((body) => body.id === id)) return;
				this.targetId = id;
				this.updateCockpit();
			},
			onStationTab: (tab) => {
				this.stationConsoleTab = tab;
				this.updateCockpit();
			},
			onStationAction: (type, name) => {
				const action: StationAction =
					type === "buy-equipment"
						? { type, equipment: name }
						: { type, commodity: name };
				this.transactStation(action);
			},
			onLaunch: () => {
				if (this.launch()) this.updateCockpit();
			},
			onChartHost: (host) => this.setChartHost(host),
		});
		window.addEventListener("resize", () => this.onResize());
		// A resolution setting is a change to the drawing buffer, so it lands the
		// same way a window resize does.
		//
		// Which key changed is tracked here rather than asked of the store,
		// because the store deliberately publishes the whole settings object and
		// refuses a no-op set. Without the comparison a lighting change would
		// resize the drawing buffer to the size it already is — a reallocation on
		// the frame the player flipped a switch to *look* at something.
		let applied = this.settings.value;
		this.settings.subscribe((next) => {
			if (next.renderScale !== applied.renderScale) this.onResize();
			if (next.quality !== applied.quality) this.applyQuality();
			applied = next;
		});
		/**
		 * A display change is not always a resize.
		 *
		 * Dragging the window from a retina panel to an external one can leave
		 * the window the same CSS size while `devicePixelRatio` goes from 2 to
		 * 1, and no `resize` fires. A resolution media query does fire, and
		 * re-arms itself because the query it watches is the ratio it just
		 * left.
		 */
		const watchRatio = () => {
			const q = window.matchMedia(
				`(resolution: ${window.devicePixelRatio}dppx)`,
			);
			const once = () => {
				q.removeEventListener("change", once);
				this.onResize();
				this.combatStatusFit.clear();
				watchRatio();
			};
			q.addEventListener("change", once);
		};
		watchRatio();
		// Once at boot, so the renderer and the composer cannot be given a ratio
		// in only one place.
		this.onResize();
		window.addEventListener("keydown", (e) => this.onKey(e, true));
		window.addEventListener("keyup", (e) => this.onKey(e, false));
		// Audio cannot open before a gesture, so it opens on the first one.
		window.addEventListener("pointerdown", () => this.audio.ensure(), {
			once: true,
		});
		// Pointer lock on click, Escape to release — the browser's own contract,
		// and the only way to get relative mouse deltas that do not stop at the
		// edge of the window. Keyboard steering stays live throughout, so a
		// player who never clicks can still fly.
		this.renderer.domElement.addEventListener("click", () => {
			if (document.pointerLockElement !== this.renderer.domElement) {
				this.renderer.domElement.requestPointerLock();
			}
		});
		window.addEventListener("mousemove", (e) => {
			if (document.pointerLockElement !== this.renderer.domElement) return;
			this.mouseDx += e.movementX;
			this.mouseDy += e.movementY;
		});

		this.animate();
	}

	/**
	 * Point the ship inward on a new game.
	 *
	 * The arrival bearing is drawn from the system's own stream and points
	 * *outward* — 1 AU from the star, in an arbitrary direction. A ship left at
	 * the identity quaternion there is looking at whatever the bearing happens to
	 * face, which most of the time is empty sky, and the first thing a player sees
	 * of a newly generated system is nothing in it.
	 *
	 * Normalised in float64 before Three sees it: the ship's position is ~1.5·10⁸
	 * km and a `Vector3` is float32, so handing it the raw coordinates would
	 * quantise the direction before it was a direction. The magnitude is what does
	 * not survive float32, and normalising is exactly the operation that discards
	 * it.
	 */
	private faceTheStar() {
		const d = length(this.world.ship.pos);
		if (d === 0) return;
		this.face(scale(this.world.ship.pos, -1 / d));
	}

	/**
	 * Point the nose at the selected target.
	 *
	 * A **prototype aid**, and worth saying so plainly: §6 makes cruise free —
	 * you point anywhere and go — and an aiming key is one step from the
	 * target-locked cruise the spec rejected. It is here because the
	 * judgement this node is collecting is about *pacing*, and hand-aiming a
	 * 20-metre nose at a 50 km sphere an AU away is a different skill that would
	 * dominate every measurement. Whether the shipped game offers an aiming
	 * assist is a HUD question, and #11 owns the screen it would live on.
	 */
	faceTarget() {
		const target = this.targetBody();
		if (!target) return;
		const to = sub(target.pos, this.world.ship.pos);
		const d = length(to);
		if (d === 0) return;
		this.face(scale(to, 1 / d));
	}

	/**
	 * Point the nose straight out from a body, along the radial.
	 *
	 * The move a player makes when a planet has stopped them and they want to be
	 * anywhere else — and, since #30, one cruise honours: the surface guard fires
	 * on crossing *inward*, so a ship pointed away from the body it is beside is
	 * not stopped by it. `probe-arrival.mjs` flies exactly this to check that the
	 * release is real in the browser and not only in the sweep.
	 *
	 * **Probe affordance, not an input path.** No key is bound to it. It is here
	 * so the manoeuvre has one spelling rather than a probe's own — not as
	 * encapsulation, which it would not buy: `probe-arrival.mjs` writes
	 * `world.ship.pos` directly two lines later, and a handle that hands out the
	 * world is not protecting the orientation.
	 */
	faceAway(bodyId: string) {
		const body = this.world.system.byId.get(bodyId);
		if (!body) return;
		const out = sub(this.world.ship.pos, body.pos);
		const d = length(out);
		if (d === 0) return;
		this.face(scale(out, 1 / d));
	}

	/**
	 * Aim the ship down a sim-space unit vector.
	 *
	 * Normalised by the caller in float64 before Three sees it: sim positions run
	 * to 10⁸ km and a `Vector3` is float32, so handing it raw coordinates would
	 * quantise the direction before it was a direction. The magnitude is what
	 * does not survive float32, and normalising is exactly the operation that
	 * discards it.
	 */
	private face(unit: Vec3) {
		this.orientation.setFromRotationMatrix(
			new THREE.Matrix4().lookAt(
				new THREE.Vector3(0, 0, 0),
				new THREE.Vector3(unit.x, unit.y, unit.z),
				new THREE.Vector3(0, 1, 0),
			),
		);
	}

	private buildBackdrop() {
		const field = starField(this.world.seed, STAR_COUNT);
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(field.positions, 3),
		);
		// Custom attribute names rather than `color`/`size`: a `ShaderMaterial`
		// declares its own attributes, and borrowing the names the built-in
		// materials use invites a collision with the chunks Three injects when a
		// define like USE_COLOR is set.
		geometry.setAttribute("aColor", new THREE.BufferAttribute(field.colors, 3));
		geometry.setAttribute("aSize", new THREE.BufferAttribute(field.sizes, 1));

		this.starMaterial = new THREE.ShaderMaterial({
			uniforms: {
				uPixelScale: {
					value: this.renderer.domElement.height * STAR_PIXEL_SCALE,
				},
			},
			vertexShader: /* glsl */ `
				attribute float aSize;
				attribute vec3 aColor;
				uniform float uPixelScale;
				varying vec3 vColor;
				void main() {
					vColor = aColor;
					// No distance attenuation: the sphere is re-centred on the camera
					// every frame, so every star is exactly BACKDROP_RADIUS away and
					// attenuating by depth would only add rounding.
					gl_PointSize = max(1.0, aSize * uPixelScale);
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				varying vec3 vColor;
				void main() {
					// A soft disc rather than a square. gl_PointCoord runs 0..1 across
					// the sprite, so this is the distance from its centre.
					float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
					float a = smoothstep(1.0, 0.0, r);
					if (a <= 0.004) discard;
					gl_FragColor = vec4(vColor, a);
				}
			`,
			transparent: true,
			// Additive, so overlapping stars brighten rather than occlude, and the
			// bloom pass downstream has something to bloom.
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			depthTest: false,
		});

		this.stars = new THREE.Points(geometry, this.starMaterial);
		// Nothing else is in this scene and the sphere surrounds the camera, so
		// frustum culling has nothing to win and one bounding-sphere test to lose.
		this.stars.frustumCulled = false;
		this.backdropScene.add(this.stars);
	}

	/** What every body's visual is built with. One spelling, because
	 *  `redrawBodyAs` builds them too, and a third option added to one call site
	 *  and not the other is a body drawn under a different star than its
	 *  neighbours. */
	private bodyVisualOptions() {
		return {
			sunColor: this.world.system.contents.star.color,
			starTint: this.world.system.contents.star.color,
		};
	}

	private buildBodies() {
		// One unit sphere, shared by every body, sized per body with `mesh.scale`.
		//
		// Not a memory saving — it is what makes the handoff a scale assignment
		// rather than a geometry rebuild. Baking the radius into the geometry means
		// a body crossing `HANDOFF_KM` has to be re-tessellated at the new scale
		// mid-flight, which allocates on the frame the player is most likely to be
		// looking at the thing.
		//
		// From `planet-surface.ts`, which owns both tiers, because a surface drawn
		// at fewer segments than the atmosphere shell around it is a polygon
		// inside a smooth shell — one invariant rather than two settings. Bodies
		// start far and `setLayer` swaps the tier on the handoff it already
		// re-parents them with.
		const unitSphere = surfaceSphere("far");
		for (const body of this.world.system.bodies) {
			// A station is the one body that is not a sphere: #13 §7's three
			// silhouettes, built in kilometres. Everything else — star, planet,
			// moon — shares the unit sphere above.
			// The placed-body → station join lives in sim, like the pose: the two
			// representations disagreeing is a generator fault, not a rendering
			// question, and `stationOf` throws where `colorFor` already does.
			const station =
				body.kind === "station"
					? stationOf(this.world.system, body.id)
					: undefined;

			let mesh: THREE.Object3D;
			if (station) {
				// One core radius across, like the unit sphere — so the scaling rule
				// below is the same for every body regardless of kind.
				// `body.color` is `STATION_COLORS[station.type]` — §7's secondary
				// cue, which the mesh paints its hull with.
				const built = buildStationMesh(station.type, body.color);
				mesh = built.root;
				// **E10's other half.** `station-mesh.ts` built the shields as
				// geometry and supplied no pixels, because that module is
				// headless-tested with no `document` reference in it. The renderer
				// is where a canvas is allowed to exist, so the name is drawn here
				// — once per station at build, not per frame: the name never
				// changes, and #109 makes it a fixed-slot seeded value that does
				// not move.
				paintNameplates(built, this.nameOfStation(body.id));
				this.stationVisuals.set(body.id, built);
			} else if (body.appearance) {
				// #54's classes, drawn by the game rather than by the gallery.
				//
				// The class arrives on the body (`sim.ts`), computed from the
				// generator's own `aAu`, `isGasGiant` and star luminosity — so this
				// is a lookup, not a second derivation. `body.color` is no longer
				// what a planet is painted with; it stays because the scanner and
				// the target markers read it, and a symbol that changed colour with
				// the terminator would be unreadable.
				const visual = buildBodyVisual(
					body.appearance,
					unitSphere,
					this.bodyVisualOptions(),
				);
				this.bodyVisuals.set(body.id, visual);
				mesh = visual.group;
			} else {
				// A body the contents does not classify. `appearanceOf` throws
				// rather than returning `undefined` for anything but a station, and
				// a station took the branch above — so this is unreachable today and
				// is a visible grey rather than a crash if that ever stops being
				// true.
				mesh = new THREE.Mesh(
					unitSphere,
					new THREE.MeshStandardMaterial({
						color: body.color,
						roughness: 0.9,
						metalness: 0.0,
					}),
				);
			}
			mesh.name = body.id;
			this.meshes.set(body.id, mesh);
			// Everything starts far. The arrival point is 1 AU from the star and a
			// real crossing from every station, so this is the truth on frame one
			// rather than a default — and `render` corrects it before the first draw
			// in any case.
			this.setLayer(body, "far");
		}

		this.starBody = this.world.system.bodies.find((b) => b.kind === "star");

		// One light per layer, both standing in for the same star. A single light
		// cannot serve two scenes at two scales — a `PointLight` at the far
		// layer's star position is 1,500 units away there and 1.5·10⁸ km away
		// here, and its falloff would be wrong in whichever scene it was not
		// authored for. Directional light sidesteps that: it has no position, only
		// a direction, and the direction is the same in both.
		for (const scene of [this.farScene, this.approachScene, this.nearScene]) {
			const sun = new THREE.DirectionalLight(
				LIGHT_RIG.sun.color,
				LIGHT_RIG.sun.intensity,
			);
			sun.name = "sun";
			scene.add(sun);
			// A little ambient, so an unlit hull is dark rather than black. Space has
			// no ambient light; a screen with no detail in the shadows has no
			// information in it either.
			//
			// A hemisphere rather than the flat `AmbientLight` this was (#99): a
			// flat lift has no gradient, and a flat-lit object has no edges. Its
			// axis is aimed at the star each frame rather than at world up, because
			// "up" means nothing out here — what the eye reads is a star side that
			// is lifted and a far side that is not.
			const hemi = new THREE.HemisphereLight(
				LIGHT_RIG.hemisphere.sky,
				LIGHT_RIG.hemisphere.ground,
				LIGHT_RIG.hemisphere.intensity,
			);
			hemi.name = "hemisphere";
			scene.add(hemi);
			// Held rather than found again each frame. The names stay for a probe
			// to address them by, but the render loop indexes this instead: a
			// `getObjectByName` walks every descendant, and the near scene holds
			// every drawn body.
			this.layerLights.push({ scene, sun, hemisphere: hemi });
		}
		// The image-based term, baked once from the star's own colour. This is the
		// change that makes `metalness` mean anything: before it, every metal
		// surface was subtracting diffuse and adding nothing back, and the trade
		// station rendered as flat grey facets. `light-rig.ts` has the figures.
		//
		// One texture across all three layers, for the same reason one direction
		// serves all three suns: an environment has no position, only directions.
		this.buildEnvironment();

		// A camera-side fill, near layer only — and it is a fix rather than a
		// flourish. Measured on the first render: with the star behind the ship,
		// the hull took no light at all and rendered as a black cutout that could
		// be identified only by the stars it occluded. Ambient alone did not save
		// it, because ambient is flat and a flat-lit cube has no edges.
		//
		// Off-axis rather than straight down the barrel: a light exactly at the
		// camera flattens everything it touches, which is the other way to make a
		// cube unreadable. Far-layer bodies deliberately do not get one — a planet
		// lit from the viewer's shoulder would lose its terminator, and the
		// crescent is the whole reason it reads as a sphere.
		const fill = new THREE.DirectionalLight(
			LIGHT_RIG.fill.color,
			LIGHT_RIG.fill.intensity,
		);
		fill.name = "fill";
		this.nearScene.add(fill);
	}

	/** The two star-aimed lights of each layer, with the scene they belong to.
	 *  Built once by `buildLights` and read every frame; see the push site. */
	private readonly layerLights: {
		scene: THREE.Scene;
		sun: THREE.DirectionalLight;
		hemisphere: THREE.HemisphereLight;
	}[] = [];

	/** The baked lighting environment, kept so the quality setting can put it
	 *  back after dropping it — `scene.environment = null` is how low drops it,
	 *  and the texture has to survive that to be reassigned.
	 *
	 *  **Baked once per `Game`, and a `Game` is one system.** Nothing rebuilds the
	 *  world in place — `makeWorld` is called exactly once, in the constructor —
	 *  so the star's tint is fixed for this object's life and there is no jump
	 *  path for it to go stale across. The day one exists it calls
	 *  `buildEnvironment` again, which is why that method disposes what it is
	 *  replacing rather than assuming it is the first call. */
	private environmentMap: THREE.Texture | null = null;

	/**
	 * Bake the star's environment once and hand it to all three layers.
	 *
	 * `PMREMGenerator` convolves the equirectangular image into the roughness
	 * chain every `MeshStandardMaterial` samples. It is a handful of small
	 * render passes at load and nothing per frame — which is what makes this
	 * affordable at all, and why the quality gate is about the per-fragment
	 * sample rather than about this call.
	 *
	 * The source is `light-rig.ts`, which knows nothing about Three.js, so the
	 * model is testable and this is three lines and no decisions.
	 */
	private buildEnvironment() {
		// Idempotent by disposal rather than by assuming a single call: a PMREM
		// cube is a GPU texture, and a second bake that dropped the first would
		// leak it silently.
		this.environmentMap?.dispose();
		const { data, width, height } = equirectEnvironment(
			this.world.system.contents.star.color,
		);
		const source = new THREE.DataTexture(
			data,
			width,
			height,
			THREE.RGBAFormat,
			THREE.FloatType,
		);
		source.mapping = THREE.EquirectangularReflectionMapping;
		source.colorSpace = THREE.LinearSRGBColorSpace;
		source.needsUpdate = true;
		const pmrem = new THREE.PMREMGenerator(this.renderer);
		this.environmentMap = pmrem.fromEquirectangular(source).texture;
		// Both are done once the cube exists: the generator's own render targets
		// and the source image are not read again, and holding them would keep a
		// float texture per system jumped to alive for the session.
		pmrem.dispose();
		source.dispose();
		// Once, here: it is a constant, and `applyQuality` runs on every quality
		// change — writing it there dirtied every material's uniforms for a value
		// that cannot have changed.
		for (const { scene } of this.layerLights)
			scene.environmentIntensity = LIGHT_RIG.environmentIntensity;
		this.applyQuality();
	}

	/**
	 * Put the environment on the scenes, or take it off — #98's quality gate.
	 *
	 * Assignment rather than a rebuild, so the setting is live: the player sees
	 * the same frame with and without the term, which is the only way to judge
	 * what it is worth. Rebaking on every change would also make the setting
	 * cost more than the thing it gates.
	 */
	private applyQuality() {
		const mode = LIGHT_RIG.quality[this.settings.value.quality];
		for (const { scene } of this.layerLights)
			scene.environment = mode.environment ? this.environmentMap : null;
		this.renderer.toneMappingExposure = mode.exposure;
		// The hull half of the same gate (#101): low drops the seam normal map.
		// It is a separate call rather than a second field on `LIGHT_RIG`,
		// because that record is the lighting model and a texture on a material
		// is not part of it — `ship-surface.ts` owns what a hull surface costs.
		applyHullQuality(this.settings.value.quality);
	}

	/**
	 * Move a body into a layer and size it for that layer's scale.
	 *
	 * The two halves are one operation and must stay one: a mesh reparented
	 * without being rescaled is drawn 10⁵ times too large or too small, which for
	 * a planet at the near scale fills the screen with a flat colour that reads as
	 * a shader bug rather than as a misplaced sphere.
	 *
	 * `Object3D.add` removes the mesh from its previous parent, so there is no
	 * `remove` to forget.
	 */
	private setLayer(body: Body, layer: "near" | "approach" | "far") {
		const mesh = this.meshes.get(body.id);
		if (!mesh) return;
		mesh.scale.setScalar(body.radiusKm * scaleFor(layer));
		// Detail follows the layer, on the same rule and at the same moment as the
		// scale — an assignment between two shared geometries, never a rebuild, so
		// nothing allocates on the frame the player is most likely to be looking
		// at the body. Only the surface mesh: the shells are one geometry each and
		// a body in the far layer draws them at a few pixels either way.
		this.bodyVisuals.get(body.id)?.setLayer(layer);
		const scene =
			layer === "near"
				? this.nearScene
				: layer === "approach"
					? this.approachScene
					: this.farScene;
		scene.add(mesh);
		this.layers.set(body.id, layer);
	}

	private buildShip() {
		// One hull, and it is the player's.
		//
		// Chase used to carry an interceptor and a freighter alongside, as a
		// relative-scale check while the archetypes were being designed. They
		// were children of this mesh, so they inherited the player's orientation
		// and turned with it exactly — glued to the hull rather than flying
		// beside it, which the chase orbit made impossible to miss. Their job
		// belongs to `?model-viewer=ship`, which frames each hull against its own
		// declared reach; real traffic needs simulation positions, and those are
		// #26's to give.
		this.shipMesh = buildShipMesh(...PLAYER_HULL).root;
		this.shipMesh.name = "ship";
		this.nearScene.add(this.shipMesh);
		if (this.fleetReview) this.buildFleetReview();
	}

	/** Build the review hulls. Where they go is settled on the first frame. */
	private buildFleetReview() {
		const group = new THREE.Group();
		group.name = "fleet-review";
		group.userData.displayOnly = true;
		for (const slot of fleetLayout()) {
			const hull = buildShipMesh(slot.id, slot.variant).root;
			hull.name = `fleet-${slot.id}-${slot.variant}`;
			group.add(hull);
			this.fleet.push({ mesh: hull, slot, pos: v3(0, 0, 0) });
		}
		this.nearScene.add(group);
	}

	/** The physical cockpit and its one, deck-mounted scanner. */
	private buildCockpit() {
		this.cockpit = {} as CockpitHardware;
		// The first pass used a repeated cyan grid. It read as wallpaper at this
		// distance, not a manufactured cabin. Let the hard edges and separate
		// fittings carry the construction instead of printing a texture onto every
		// surface.
		const metal = new THREE.MeshStandardMaterial({
			color: 0x0a1114,
			roughness: 0.72,
			metalness: 0.48,
			emissive: 0x010304,
			emissiveIntensity: 0.08,
		});
		const trim = new THREE.MeshStandardMaterial({
			color: 0x1a2c32,
			roughness: 0.46,
			metalness: 0.72,
			emissive: 0x03090b,
			emissiveIntensity: 0.14,
		});
		const inset = new THREE.MeshStandardMaterial({
			color: 0x020607,
			roughness: 0.48,
			metalness: 0.3,
		});
		const canopyGlass = new THREE.MeshBasicMaterial({
			color: 0x0a2635,
			transparent: true,
			opacity: 0.08,
			side: THREE.DoubleSide,
			depthWrite: false,
		});
		const cockpit = new THREE.Group();
		cockpit.name = "cockpit";
		// Space remains black, but the pilot's own instruments should not. This
		// lamp is parented to the cockpit, so it illuminates the cabin alone as
		// the ship turns rather than behaving like a second sun in the scene.
		const interiorLight = new THREE.PointLight(0x9bc5dc, 0.35, 0.065, 2);
		interiorLight.name = "cockpit-light";
		interiorLight.position.set(0, 0.004, -0.029);
		cockpit.add(interiorLight);
		const addBox = (
			size: [number, number, number],
			position: [number, number, number],
			rotation: [number, number, number] = [0, 0, 0],
			material: THREE.Material = metal,
		) => {
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
			mesh.position.set(...position);
			mesh.rotation.set(...rotation);
			cockpit.add(mesh);
		};
		const addStrut = (
			from: [number, number, number],
			to: [number, number, number],
			radius = 0.00045,
			name?: string,
		) => {
			const start = new THREE.Vector3(...from);
			const end = new THREE.Vector3(...to);
			const direction = end.clone().sub(start);
			const mesh = new THREE.Mesh(
				new THREE.CylinderGeometry(
					radius * 0.82,
					radius,
					direction.length(),
					8,
				),
				metal,
			);
			mesh.position.copy(start.add(end).multiplyScalar(0.5));
			mesh.quaternion.setFromUnitVectors(HEAD_AXIS, direction.normalize());
			if (name) mesh.name = name;
			cockpit.add(mesh);
		};
		// These are kilometres because they live in the normal near scene. The
		// closest face stays beyond the 10 m near plane, which avoids the camera
		// slicing the cockpit open as a pilot turns their head.
		// A real windscreen frame: the former rails did not meet a sill or header,
		// so they read as objects floating in space. The glass stays subtle, while
		// the connected trapezoid gives the player a stable cockpit boundary.
		const canopyShape = new THREE.Shape();
		canopyShape.moveTo(-0.043, -0.013);
		canopyShape.lineTo(-0.05, 0.018);
		canopyShape.lineTo(0.05, 0.018);
		canopyShape.lineTo(0.043, -0.013);
		canopyShape.closePath();
		const canopyPane = new THREE.Mesh(
			new THREE.ShapeGeometry(canopyShape),
			canopyGlass,
		);
		canopyPane.name = "canopy-glass";
		canopyPane.position.z = -0.065;
		cockpit.add(canopyPane);
		addStrut(
			[-0.043, -0.013, -0.065],
			[-0.05, 0.018, -0.065],
			0.00125,
			"canopy-side-rail-port",
		);
		addStrut(
			[0.043, -0.013, -0.065],
			[0.05, 0.018, -0.065],
			0.00125,
			"canopy-side-rail-starboard",
		);
		addBox([0.102, 0.0013, 0.002], [0, 0.018, -0.065], [0, 0, 0], trim);
		addBox([0.088, 0.002, 0.004], [0, -0.013, -0.065], [0, 0, 0], trim);
		// Header braces close the upper corners into the nearer cockpit frame. The
		// former side rails only framed the pane itself, leaving the windscreen
		// visually detached from the overhead cockpit boundary.
		addStrut(
			[-0.05, 0.018, -0.065],
			[-0.042, 0.028, -0.032],
			0.0011,
			"canopy-header-brace-port",
		);
		addStrut(
			[0.05, 0.018, -0.065],
			[0.042, 0.028, -0.032],
			0.0011,
			"canopy-header-brace-starboard",
		);
		// The canopy runs into light A-pillars, not opaque corner blocks. The
		// cockpit boundary should give scale and framing while preserving a broad
		// flight view.
		for (const side of [-1, 1]) {
			addStrut(
				[side * 0.043, -0.013, -0.065],
				[side * 0.032, -0.015, -0.034],
				0.0009,
			);
		}
		// Layered side consoles, structural seams, and a raised centre deck give
		// the cabin a constructed spacecraft language without closing the pilot's
		// forward sightline.
		addBox([0.01, 0.0022, 0.022], [-0.038, -0.019, -0.047], [0.24, 0, 0.06]);
		addBox([0.01, 0.0022, 0.022], [0.038, -0.019, -0.047], [0.24, 0, -0.06]);
		addBox(
			[0.006, 0.0008, 0.014],
			[-0.038, -0.0179, -0.047],
			[0.24, 0, 0.06],
			inset,
		);
		addBox(
			[0.006, 0.0008, 0.014],
			[0.038, -0.0179, -0.047],
			[0.24, 0, -0.06],
			inset,
		);
		for (const side of [-1, 1]) {
			const x = side * 0.038;
			const roll = side * -0.06;
			for (const z of [-0.05, -0.045])
				addBox(
					[0.005, 0.00035, 0.0006],
					[x, -0.0171, z],
					[0.24, 0, roll],
					trim,
				);
		}
		for (const side of [-1, 1]) {
			addBox(
				[0.001, 0.0028, 0.019],
				[side * 0.038, -0.0184, -0.047],
				[0.24, 0, side * -0.06],
				trim,
			);
			addBox(
				[0.003, 0.0032, 0.019],
				[side * 0.012, -0.015, -0.052],
				[0.24, 0, 0],
				trim,
			);
		}
		const dashboardPitch = 0.58;
		const scannerMount = new THREE.Group();
		scannerMount.name = "scanner-mount";
		scannerMount.position.set(0, -0.014, -0.038);
		scannerMount.rotation.x = dashboardPitch;
		cockpit.add(scannerMount);
		this.buildScannerAssembly(scannerMount, metal, trim, inset);

		this.buildHologramSystem(scannerMount);
		this.cockpit.mesh = cockpit;
		this.nearScene.add(cockpit);
	}

	/** Build the fitted scanner plate, instrument canvases, and throttle hardware. */
	private buildScannerAssembly(
		scannerMount: THREE.Group,
		metal: THREE.MeshStandardMaterial,
		trim: THREE.MeshStandardMaterial,
		inset: THREE.MeshStandardMaterial,
	) {
		const deck = new THREE.Mesh(
			new THREE.BoxGeometry(0.032, 0.0016, 0.022),
			metal,
		);
		deck.name = "scanner-deck";
		scannerMount.add(deck);
		const scannerWell = new THREE.Mesh(
			new THREE.BoxGeometry(0.029, 0.00025, 0.0155),
			inset,
		);
		scannerWell.name = "scanner-well";
		scannerWell.position.y = 0.00093;
		scannerMount.add(scannerWell);
		for (const [x, z, sx, sz] of [
			[0, -0.0083, 0.0308, 0.0008],
			[0, 0.0083, 0.0308, 0.0008],
			[-0.015, 0, 0.0008, 0.0168],
			[0.015, 0, 0.0008, 0.0168],
		] as const) {
			const bezel = new THREE.Mesh(
				new THREE.BoxGeometry(sx, 0.00075, sz),
				trim,
			);
			bezel.name = "scanner-bezel";
			bezel.position.set(x, 0.00145, z);
			scannerMount.add(bezel);
		}
		const scannerCanvas = document.createElement("canvas");
		scannerCanvas.width = 800;
		scannerCanvas.height = 400;
		this.cockpit.scannerCtx = scannerCanvas.getContext(
			"2d",
		) as CanvasRenderingContext2D;
		this.cockpit.scannerTexture = new THREE.CanvasTexture(scannerCanvas);
		this.cockpit.scannerTexture.colorSpace = THREE.SRGBColorSpace;
		this.paintScannerBackground();
		const scanner = new THREE.Mesh(
			new THREE.PlaneGeometry(0.027, 0.0135),
			new THREE.MeshBasicMaterial({
				map: this.cockpit.scannerTexture,
				polygonOffset: true,
				polygonOffsetFactor: -1,
				polygonOffsetUnits: -1,
			}),
		);
		scanner.name = "scanner";
		scanner.position.y = 0.00108;
		scanner.rotation.x = -Math.PI / 2;
		scannerMount.add(scanner);
		const makeInstrument = (name: string, x: number) => {
			const backing = new THREE.Mesh(
				new THREE.BoxGeometry(0.014, 0.0014, 0.011),
				trim,
			);
			backing.position.set(x, 0.0002, 0);
			scannerMount.add(backing);
			const canvas = document.createElement("canvas");
			canvas.width = 512;
			canvas.height = 256;
			const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
			const texture = new THREE.CanvasTexture(canvas);
			texture.colorSpace = THREE.SRGBColorSpace;
			const face = new THREE.Mesh(
				new THREE.PlaneGeometry(0.0118, 0.0059),
				new THREE.MeshBasicMaterial({
					map: texture,
					transparent: true,
					depthWrite: false,
				}),
			);
			face.name = name;
			face.position.set(x, 0.001, 0);
			face.rotation.x = -Math.PI / 2;
			scannerMount.add(face);
			return { ctx, texture, primaryText: "", secondaryText: new TextRaster() };
		};
		this.cockpit.flightInstrument = makeInstrument("flight-instrument", -0.025);
		this.cockpit.targetInstrument = makeInstrument("target-instrument", 0.025);
		const throttleTrack = new THREE.Mesh(
			new THREE.BoxGeometry(0.0022, 0.0014, 0.014),
			inset,
		);
		throttleTrack.name = "throttle-track";
		throttleTrack.position.set(-0.0168, 0.0008, 0);
		scannerMount.add(throttleTrack);
		this.cockpit.throttleFillMaterial = new THREE.MeshStandardMaterial({
			color: 0x9b5a20,
			emissive: 0x4a1905,
			emissiveIntensity: 0.04,
		});
		this.cockpit.throttleFill = new THREE.Mesh(
			new THREE.BoxGeometry(0.0011, 0.0017, 0.012),
			this.cockpit.throttleFillMaterial,
		);
		this.cockpit.throttleFill.name = "throttle-fill";
		this.cockpit.throttleFill.position.set(-0.0168, 0.0018, 0.006);
		scannerMount.add(this.cockpit.throttleFill);
	}

	/** Create the static radar geometry and the reusable live-contact pool. */
	private buildHologramSystem(scannerMount: THREE.Group) {
		const root = new THREE.Group();
		root.name = "scanner-hologram";
		root.position.y = 0.0013;
		scannerMount.add(root);
		const hologramMaterial = new THREE.LineBasicMaterial({
			color: 0xf1ab38,
			transparent: true,
			opacity: 0.7,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		const hologramOptions = {
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthTest: false,
			depthWrite: false,
		};
		const lineHologram = (color: number, opacity: number) =>
			new THREE.LineBasicMaterial({ color, opacity, ...hologramOptions });
		const mastHologram = (color: number, opacity: number) =>
			new THREE.MeshBasicMaterial({ color, opacity, ...hologramOptions });
		const contactMaterial = lineHologram(0x74d9ff, 0.85);
		const targetMaterial = lineHologram(0xffd26b, 1);
		const contactMastMaterial = mastHologram(0x74d9ff, 0.78);
		const targetMastMaterial = mastHologram(0xffd26b, 0.92);
		const mastGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
		const diamondGeometry = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(-1, 0, 0),
			new THREE.Vector3(0, 0, -0.5),
			new THREE.Vector3(1, 0, 0),
			new THREE.Vector3(0, 0, 0.5),
			new THREE.Vector3(-1, 0, 0),
		]);
		for (let ring = 1; ring <= 5; ring++) {
			const points: THREE.Vector3[] = [];
			const fraction = ring / 5;
			for (let step = 0; step < 33; step++) {
				const angle = (step / 32) * Math.PI * 2;
				points.push(
					new THREE.Vector3(
						Math.cos(angle) * 0.0105 * fraction,
						0,
						Math.sin(angle) * 0.0052 * fraction,
					),
				);
			}
			const rangeRing = new THREE.LineLoop(
				new THREE.BufferGeometry().setFromPoints(points),
				hologramMaterial,
			);
			rangeRing.name = "scanner-range-ring";
			root.add(rangeRing);
		}
		const referenceLine = new THREE.Line(
			new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(0, 0, -0.0052),
				new THREE.Vector3(0, 0, 0.0052),
			]),
			hologramMaterial,
		);
		referenceLine.name = "scanner-reference-line";
		root.add(referenceLine);
		const contactGlyphs = new THREE.Group();
		contactGlyphs.name = "scanner-contact-glyphs";
		root.add(contactGlyphs);
		this.cockpit.hologram = {
			root,
			contactGlyphs,
			mastGeometry,
			diamondGeometry,
			glyphPool: [],
			contactMaterial,
			targetMaterial,
			contactMastMaterial,
			targetMastMaterial,
		};
	}

	/** Paint the scanner's unchanging dark surface once, before the first draw. */
	private paintScannerBackground() {
		const ctx = this.cockpit.scannerCtx;
		const w = ctx.canvas.width;
		const h = ctx.canvas.height;
		ctx.fillStyle = "#010506";
		ctx.fillRect(0, 0, w, h);
		const shade = ctx.createRadialGradient(
			w / 2,
			h / 2,
			0,
			w / 2,
			h / 2,
			w / 2,
		);
		shade.addColorStop(0, "rgba(30, 59, 48, .16)");
		shade.addColorStop(1, "rgba(0, 0, 0, 0)");
		ctx.fillStyle = shade;
		ctx.fillRect(0, 0, w, h);
		this.cockpit.scannerTexture.needsUpdate = true;
	}

	private updateHologramContacts(contacts: readonly ScannerContact[]) {
		const hologram = this.cockpit.hologram;
		for (const glyph of hologram.glyphPool)
			glyph.mast.visible = glyph.diamond.visible = false;
		for (const [index, contact] of contacts.entries()) {
			const x = ((contact.baseXPercent - 50) / 42) * 0.0105;
			const z = ((contact.baseYPercent - 50) / 31) * 0.0052;
			const height =
				0.0009 +
				Math.min(0.0036, (Math.abs(contact.tipOffsetPx) / 54) * 0.0036);
			const signedHeight = Math.sign(contact.tipOffsetPx) * height;
			let glyph = hologram.glyphPool[index];
			if (!glyph) {
				const mast = new THREE.Mesh(
					hologram.mastGeometry,
					hologram.contactMastMaterial,
				);
				const diamond = new THREE.LineLoop(
					hologram.diamondGeometry,
					hologram.contactMaterial,
				);
				glyph = { mast, diamond };
				hologram.glyphPool.push(glyph);
				hologram.contactGlyphs.add(mast, diamond);
			}
			const { mast, diamond } = glyph;
			const mastName = `scanner-contact-mast-${contact.id}`;
			if (mast.name !== mastName) mast.name = mastName;
			mast.position.set(x, signedHeight / 2, z);
			mast.scale.set(
				contact.selected ? 0.00009 : 0.00007,
				height,
				contact.selected ? 0.00009 : 0.00007,
			);
			mast.material = contact.selected
				? hologram.targetMastMaterial
				: hologram.contactMastMaterial;
			mast.visible = true;
			const r = contact.selected ? 0.00065 : 0.0004;
			const diamondName = `scanner-contact-diamond-${contact.id}`;
			if (diamond.name !== diamondName) diamond.name = diamondName;
			diamond.position.set(x, signedHeight, z);
			diamond.scale.set(r, 1, r);
			diamond.material = contact.selected
				? hologram.targetMaterial
				: hologram.contactMaterial;
			diamond.visible = true;
		}
	}

	/** Refresh the shared target estimate at the resolution either HUD can show. */
	private updateEtaEstimate() {
		if (this.world.gameTime - this.etaAt < ETA_INTERVAL_S) return;
		this.etaCache = this.timeToTarget();
		this.etaAt = this.world.gameTime;
	}

	private updateInstruments(
		target: Body | null,
		targetKm: number,
		velocity: ReturnType<Game["velocityReadout"]>,
	) {
		const speed = velocity.speed;
		const targetText = target
			? `${target.name}  ${range(targetKm)}`
			: "NO TARGET";
		const eta = this.etaCache === null ? "CALC" : duration(this.etaCache);
		// `chargeAu` is **not** in this key any more: the target instrument stopped
		// printing it when §5's strip took it, and a key holding a value no
		// painted pixel depends on repaints two canvas textures on the frame the
		// drive regenerates a hundredth of an AU — about once a second, forever.
		const key = `${speed}|${velocity.context}|${targetText}|${eta}|${this.throttle}|${this.assist}`;
		if (key === this.cockpit.instrumentKey) return;
		this.cockpit.instrumentKey = key;
		const paint = (
			instrument: Instrument,
			title: string,
			primary: string,
			secondary: string,
			accent: string,
		) => {
			const { ctx, secondaryText: raster } = instrument;
			const { width, height } = ctx.canvas;
			ctx.clearRect(0, 0, width, height);
			ctx.fillStyle = "rgba(1, 8, 11, .9)";
			ctx.fillRect(0, 0, width, height);
			ctx.strokeStyle = accent;
			ctx.globalAlpha = 0.72;
			ctx.lineWidth = 4;
			ctx.strokeRect(12, 12, width - 24, height - 24);
			ctx.globalAlpha = 1;
			ctx.fillStyle = accent;
			ctx.font = "22px ui-monospace, monospace";
			ctx.fillText(title, 28, 46);
			let primarySize = 42;
			const primaryWidth = width - 56;
			ctx.font = `${primarySize}px ui-monospace, monospace`;
			while (
				primarySize > 24 &&
				ctx.measureText(primary).width > primaryWidth
			) {
				primarySize -= 1;
				ctx.font = `${primarySize}px ui-monospace, monospace`;
			}
			ctx.fillStyle = "#e7f6ff";
			ctx.fillText(primary, 28, 128);
			instrument.primaryText = primary;
			raster.setInstrumentSecondary(secondary, accent, width);
			ctx.font = raster.font;
			ctx.fillStyle = accent;
			ctx.fillText(secondary, 28, 192);
		};
		paint(
			this.cockpit.flightInstrument,
			velocity.title,
			speed,
			velocity.context,
			"#75d7ff",
		);
		paint(
			this.cockpit.targetInstrument,
			"TARGET",
			targetText,
			// **Charge is gone from here.** It is a second consumable with its own
			// regeneration (#10) and §5 puts it on the floor; riding the *target*
			// instrument made it read as a property of the thing being flown to.
			`ETA ${eta}`,
			"#ffd17a",
		);
		this.cockpit.flightInstrument.texture.needsUpdate = true;
		this.cockpit.targetInstrument.texture.needsUpdate = true;
		// The low end is nearest/lower on the sloped deck. Keep it anchored there
		// and extend toward the windscreen as throttle rises; the old fill started
		// at the top and slid down, the inverse of a physical throttle cue.
		this.cockpit.throttleFill.scale.z = Math.max(0.08, this.throttle);
		this.cockpit.throttleFill.position.z = (1 - this.throttle) * 0.006;
		this.cockpit.throttleFillMaterial.emissiveIntensity =
			0.04 + this.throttle * 0.28;
	}

	private onKey(e: KeyboardEvent, down: boolean) {
		const key = e.key.toLowerCase();
		if (down && !e.repeat && e.altKey) {
			if (this.view !== "cockpit") {
				e.preventDefault();
				return;
			}
			if (key === "arrowleft") this.setHeadLook("left");
			else if (key === "arrowright") this.setHeadLook("right");
			else if (key === "arrowup") this.setHeadLook("forward");
			else return;
			e.preventDefault();
			return;
		}
		if (down) this.keys.add(key);
		else this.keys.delete(key);
		// One-shot commands fire on the press, not on the held state: engaging
		// cruise and stepping a dial are events, and reading them out of `keys`
		// each frame would repeat them sixty times a second.
		if (down && !e.repeat) this.command(key);
		// Arrow keys and space scroll the page otherwise, which under a
		// full-viewport canvas looks like the controls simply not working.
		if (key.startsWith("arrow") || key === " ") e.preventDefault();
	}

	/**
	 * The discrete controls: the regime, the target, and the tuning dials.
	 *
	 * The dials are why this node is a prototype rather than an implementation.
	 * Every one of them steps a number the spec *derived* (§10 lists the two most
	 * likely to be wrong), and the judgement being asked for — is a 68-second leg
	 * a journey or dead time — can only be made by flying the same leg at two
	 * settings and preferring one. Rebuilding between them would put a minute
	 * and a page reload between the two things being compared, which is exactly
	 * long enough to forget what the first one felt like.
	 */
	private command(key: string) {
		switch (key) {
			case "1":
				if (this.view === "cockpit") this.setHeadLook("left");
				return;
			case "2":
				if (this.view === "cockpit") this.setHeadLook("forward");
				else this.chaseYaw = 0;
				return;
			case "3":
				if (this.view === "cockpit") this.setHeadLook("right");
				return;
			case "/":
				if (this.combatPrototypeEnabled) {
					this.combatIncoming = true;
					return;
				}
				break;
			case "q":
				if (this.combatPrototypeEnabled) {
					this.combatEcm = true;
					return;
				}
				break;
			case "j":
				if (this.regime === "cruise") this.dropOut("dropped by the player");
				else if (this.spoolLeftS > 0) {
					this.spoolLeftS = 0;
					this.lastExit = "spool-up cancelled";
				} else this.engageCruise();
				return;
			case "t":
				this.cycleTarget(1);
				return;
			case "g":
				this.cycleTarget(-1);
				return;
			case "f":
				this.faceTarget();
				return;
			case "c":
				// §6's request. A no-op outside `VICINITY_KM`, which is a refusal
				// to answer rather than a denial — see `requestClearance`.
				this.requestDockingClearance();
				return;
			case "u":
				this.toggleDockingComputer();
				return;
			case "enter":
				// §12.2's launch, and obligation 5's skip, on one key.
				//
				// **A key, and deliberately not a screen.** M9 puts the launch
				// control on the Flight console and #70 owns that surface; §12 owns
				// what happens after it is pressed, and a binding is the smallest
				// thing that makes the motion reachable without deciding #70's
				// layout by implementation.
				//
				// **`Enter` rather than a letter, because every letter is taken** —
				// twenty-six flight and dial bindings, plus `PERF_KEYS`,
				// `RESTORE_KEY` and `SETTINGS_KEY`, which
				// `tests/perf-panel-keys.test.ts` enforces are not flight bindings.
				//
				// Press to launch, press again to skip the traversal: one key, and
				// the second press is the skip §12.2 makes unconditional. The skip
				// refuses on an *arrival*, which is E4's unmet dependency rather
				// than a policy — `canSkipTraversal` carries that argument.
				if (this.dock.phase === "docked") this.launch();
				else this.skipDockTraversal();
				return;
			case "x":
				// #5's assist toggle. Not in force inside cruise (#10 §1), where the
				// regime is nose-locked — the state is kept and applied on exit.
				this.assist = !this.assist;
				return;
			case "v":
				this.view = this.view === "cockpit" ? "chase" : "cockpit";
				if (this.view === "chase") this.setHeadLook("forward");
				return;
			case "0":
				// Back to the spec's own figures, from wherever the tuning has got
				// to. The reset is what makes the dials safe to wander with.
				this.cruiseParams = { ...DEFAULT_CRUISE };
				return;
			case "]":
				this.dial("exponent", EXPONENT_DIAL, 1);
				return;
			case "[":
				this.dial("exponent", EXPONENT_DIAL, -1);
				return;
			case "=":
				this.dial("vMaxKms", V_MAX_DIAL_C, 1, IN_C);
				return;
			case "-":
				this.dial("vMaxKms", V_MAX_DIAL_C, -1, IN_C);
				return;
			case "'":
				this.dial("dropRadiusKm", DROP_RADIUS_DIAL_KM, 1);
				return;
			case ";":
				this.dial("dropRadiusKm", DROP_RADIUS_DIAL_KM, -1);
				return;
			case ".":
				this.dial("dropSpeedKms", DROP_SPEED_DIAL_KMS, 1);
				return;
			case ",":
				this.dial("dropSpeedKms", DROP_SPEED_DIAL_KMS, -1);
				return;
			case "m":
				this.dial("vicinityKm", VICINITY_DIAL_KM, 1);
				return;
			case "n":
				this.dial("vicinityKm", VICINITY_DIAL_KM, -1);
				return;
			case "l":
				this.dial("approachLeadS", APPROACH_LEAD_DIAL_S, 1);
				return;
			case "k":
				this.dial("approachLeadS", APPROACH_LEAD_DIAL_S, -1);
				return;
			default:
		}
	}

	/**
	 * Has the player taken the stick this frame?
	 *
	 * A named predicate rather than a six-term disjunction inside `step`,
	 * because the next input source added has to be threaded somewhere and an
	 * unnamed boolean is the wrong somewhere. The mouse terms are read here and
	 * consumed below in the same step on every path — the autopilot branch
	 * zeroes them before returning, and the hand-flown path folds them into
	 * `impulse` — so nothing carries a delta into a later frame.
	 */
	private hasControlInput(yaw: number, pitch: number, roll: number): boolean {
		return (
			yaw !== 0 ||
			pitch !== 0 ||
			roll !== 0 ||
			// §7 counts the throttle. Leaving it out was worse than no cancel:
			// `stepDockingComputer` overwrites `this.throttle` on the same frame,
			// so a player pushing the throttle got neither a cancel nor an effect.
			this.keys.has(THROTTLE_UP) ||
			this.keys.has(THROTTLE_DOWN) ||
			this.mouseDx !== 0 ||
			this.mouseDy !== 0
		);
	}

	/**
	 * Mount or take down the Galaxy Map tab's chart.
	 *
	 * The import is dynamic because `galaxy-map.ts` pulls in its own scene, and
	 * a player who never opens the tab should not pay for it in the initial
	 * bundle. `tests/nav-list.test.ts` pins that no module in `src/`
	 * statically imports it, because a stray value import would fold the chunk back in
	 * without changing a line of this method.
	 *
	 * The **generation counter** is what the await costs. Disposal is
	 * synchronous and mounting is not, so a player toggling the tab twice
	 * inside one chunk load has two mounts in flight against a `this.chart`
	 * that is already `null`: the older one resolves last, overwrites the field,
	 * and the newer chart is left running with nothing holding its `dispose`.
	 * `host.isConnected` does not see this — the first host can still be
	 * attached. Only "am I still the current request" does.
	 */
	private setChartHost(host: HTMLElement | null) {
		const generation = ++this.chartGeneration;
		this.chart?.dispose();
		this.chart = null;
		if (!host) return;
		import("./galaxy-map")
			.then(({ mountGalaxyChart }) => {
				if (!host.isConnected) return;
				const chart = mountGalaxyChart({
					host,
					worldSeed: this.world.seed,
					galaxyIndex: this.world.system.record.galaxy,
					currentIndex: this.world.system.record.index,
				});
				// Superseded while the chunk was loading. Take it down rather than
				// dropping the handle, which would leak the loop and the context.
				if (generation !== this.chartGeneration) chart.dispose();
				else this.chart = chart;
			})
			.catch((error) => {
				// A stale deploy or an offline reload rejects here. Without this the
				// promise rejects unhandled and the tab is an empty bordered box
				// that looks exactly like a chart still loading.
				console.error("[seelite] galaxy chart failed to load", error);
				if (generation === this.chartGeneration && host.isConnected)
					host.dataset.liveChartError = "true";
			});
	}

	/**
	 * How long to reach one body, seconds — `timeToTarget` for an arbitrary
	 * body rather than the selected one.
	 *
	 * Split out because the Navigation list needs the same figure per row, and
	 * a second implementation of it is how the panel and the instrument beside
	 * it come to disagree about the same trip.
	 */
	private timeToBody(target: Body): number | null {
		const from = this.world.ship.pos;
		const remaining = length(sub(target.pos, from));
		if (remaining <= this.cruiseParams.dropRadiusKm) return 0;

		// **In normal flight the answer is a division, not an integral.** The
		// cruise law is a different regime's arithmetic and would report a minute
		// for a crossing that takes two years at the assist cap — which is exactly
		// the confusion that has to be designed out here rather than papered over:
		// a whole session was spent at full throttle in normal flight watching
		// 0.837 AU not change, because the panel said nothing.
		//
		// A blank was the previous answer and it is worse than a wrong number: it
		// hides the one fact the player needs, which is that *this regime cannot
		// get there*. At rest with the throttle shut the honest question is not
		// "how long at zero" but "how long if I flew there", so the figure falls
		// back to the regime's best speed.
		if (this.regime !== "cruise" && this.spoolLeftS === 0) {
			// **Progress along the line of sight, not absolute speed.** Flying
			// across a target at 20 km/s with the assist off is not approaching it,
			// and an absolute figure reported that leg ten times faster than the
			// ship was actually closing — the same mistake the speed readout below
			// argues against, made by the line beside it.
			//
			// The target's *own* motion is deliberately **not** subtracted here,
			// which is the opposite of what the drop-out does, because the two
			// answer different questions. The drop-out asks "am I arriving", and a
			// station's 30 km/s is the frame that decides it. This asks "how long
			// if I fly there", and a station's orbit is not progress the pilot can
			// spend: subtracting it would swing the readout between 48 days and
			// never as the station came round, while the ship sat still.
			//
			// The floor is the assist cap, because at rest with the throttle shut
			// the honest answer is what the trip would cost, not infinity. A blank
			// is what hid this regime's two-year crossings for a whole session.
			const progress = dot(
				this.world.ship.vel,
				scale(sub(target.pos, from), 1 / remaining),
			);
			// The floor is the cap itself: `cap × throttle` can never exceed it, so a
			// third term for the throttle was arithmetic that could not fire.
			return remaining / Math.max(progress, ASSIST_CAP_KMS);
		}

		// In cruise, `cruise.ts` owns the arithmetic — `legSeconds` integrates the
		// same `speedFor` the ship is flown by, clamp included. The renderer held
		// its own copy of that integration for one round and it had already
		// diverged: keyed to the nearest mass alone, it read ~30× too fast over a
		// station's final approach and omitted the clamp's 16 s entirely.
		return legSeconds(
			from,
			{
				pos: target.pos,
				radiusKm: target.radiusKm,
				vel: bodyVelocity(this.world.system, target.id, this.world.gameTime),
			},
			this.masses(),
			this.cruiseParams,
			this.regime === "cruise" ? this.throttle : 1,
		);
	}

	/** A camera pan only: flight controls and the ship's nose stay live. */
	setHeadLook(headLook: HeadLook) {
		this.headLook = headLook;
		this.updateCockpit();
	}

	/**
	 * Step one dial to its neighbouring value, clamped at the ends.
	 *
	 * Clamped rather than wrapping: a dial that wraps from 50 c to 5 c on one
	 * keypress too many changes the thing being judged by a factor of ten
	 * without the player having asked to, and at these speeds that is the
	 * difference between an approach and a system crossing.
	 *
	 * The nearest current value rather than a held index, so the dial still
	 * behaves after a reset or a value set from elsewhere.
	 */
	private dial(
		field:
			| "exponent"
			| "dropRadiusKm"
			| "dropSpeedKms"
			| "vMaxKms"
			| "vicinityKm"
			| "approachLeadS",
		values: number[],
		step: number,
		// Named `unit`, not `scale`: `scale` is the vector helper this file uses
		// everywhere, and a parameter by that name would silently capture it for
		// any vector arithmetic added inside this method.
		unit: { display: (v: number) => number; store: (v: number) => number } = {
			display: (v) => v,
			store: (v) => v,
		},
	) {
		// `v_max`'s list is written in multiples of c, because that is the unit
		// #10 argues the decision in (§0, §2.3) — the scale is what lets one dial
		// serve it and the three that are already in their stored units. Two
		// copies of the clamp rule is how one dial's edge behaviour gets fixed and
		// the other's does not.
		const current = unit.display(this.cruiseParams[field]);
		let at = 0;
		for (let i = 1; i < values.length; i++) {
			if (Math.abs(values[i] - current) < Math.abs(values[at] - current))
				at = i;
		}
		const next = Math.min(values.length - 1, Math.max(0, at + step));
		this.cruiseParams = {
			...this.cruiseParams,
			[field]: unit.store(values[next]),
		};
	}

	/** `1` swings to port and `3` to starboard, matching the panel keys those
	 *  two are in the cockpit — left is left in both views. */
	private chaseOrbitInput(): number {
		return this.axis(["1"], ["3"]);
	}

	private axis(negative: string[], positive: string[]): number {
		const neg = negative.some((k) => this.keys.has(k)) ? 1 : 0;
		const pos = positive.some((k) => this.keys.has(k)) ? 1 : 0;
		return pos - neg;
	}

	/** The nearest body of a kind, by centre distance — what picks the boot-time
	 *  target, so the panel names something reachable on frame one. */
	private nearestOfKind(kind: Body["kind"]): Body | null {
		let best: Body | null = null;
		let bestKm = Number.POSITIVE_INFINITY;
		for (const b of this.world.system.bodies) {
			if (b.kind !== kind) continue;
			const km = length(sub(b.pos, this.world.ship.pos));
			if (km < bestKm) {
				best = b;
				bestKm = km;
			}
		}
		return best;
	}

	/**
	 * What the speed law keys off: stars and planets only (§2.1).
	 *
	 * Rebuilt each frame from the live body list rather than cached, because the
	 * bodies move — the whole point of #6's clock — and a cached array of
	 * positions would be a second copy of the world going stale at orbital
	 * speed. The list is a handful of entries; the cost is nothing beside what
	 * the sub-step loop then does with it.
	 */
	private masses() {
		// Cached on the clock, not on the frame counter: body positions are
		// `f(seed, gameTime)` (#6 §7.3), so two calls at the same `gameTime` are
		// asking about the same world and the second is pure allocation. Both
		// callers — the cruise step and the ETA integrator — run inside one frame.
		if (this.massesAt !== this.world.gameTime || !this.massesCache) {
			this.massesCache = this.world.system.bodies
				.filter((b) => b.kind === "star" || b.kind === "planet")
				.map((b) => ({ id: b.id, pos: b.pos, radiusKm: b.radiusKm }));
			this.massesAt = this.world.gameTime;
		}
		return this.massesCache;
	}

	/**
	 * Everything selectable, in a stable order — stations first, then planets,
	 * each by id. Stable so that cycling is a walk rather than a reshuffle as the
	 * ship moves.
	 *
	 * Built **once**. The marker overlay walks this every frame and the set it
	 * walks changes only when the system does; the sort is the expensive half,
	 * because `localeCompare` is ICU collation rather than a comparison. The
	 * order is position-independent, which is what makes one build enough.
	 */
	private selectable(): Body[] {
		if (!this.selectableCache) {
			const order = { station: 0, planet: 1, star: 2, moon: 3 } as const;
			this.selectableCache = this.world.system.bodies
				.filter((b) => b.kind !== "moon")
				.sort(
					(a, b) => order[a.kind] - order[b.kind] || a.id.localeCompare(b.id),
				);
		}
		return this.selectableCache;
	}

	/**
	 * The ids `selectable()` holds — the one answer to "can this be targeted".
	 *
	 * Public because the Navigation list's central claim is that a row is a
	 * thing the game can select, and both halves of that pairing only exist in
	 * a browser. A probe that rebuilt the rule from `world.system.bodies` would
	 * be comparing two copies of the projection's own filter and binding
	 * neither to `cycleTarget` or `onSelectTarget`.
	 */
	selectableIds(): string[] {
		return this.selectable().map((body) => body.id);
	}

	cycleTarget(step: number) {
		const list = this.selectable();
		if (list.length === 0) return;
		const at = list.findIndex((b) => b.id === this.targetId);
		const next = (at + step + list.length * 2) % list.length;
		this.targetId = list[next].id;
	}

	/**
	 * Set the throttle directly, 0…1.
	 *
	 * Public because §3 makes deceleration **player-managed** — the throttle is
	 * the whole of the arrival skill — and a probe that cannot work it can only
	 * measure a ship flying into its target at full power. That is not a
	 * hypothetical: the first run of `probe-cruise.mjs` did exactly that and
	 * never arrived, because a station's speed is keyed to its *planet's*
	 * distance and stays in the thousands of km/s right up to the hull.
	 */
	setThrottle(value: number) {
		this.throttle = Math.min(1, Math.max(0, value));
	}

	targetBody(): Body | null {
		return this.targetId
			? (this.world.system.byId.get(this.targetId) ?? null)
			: null;
	}

	/** The selected target's current range in simulation kilometres, if any. */
	targetRange(): number | null {
		const target = this.targetBody();
		return target ? length(sub(target.pos, this.world.ship.pos)) : null;
	}

	/**
	 * What to do next, in one phrase, or "" when there is nothing to say.
	 *
	 * Shown whenever normal flight cannot reasonably reach the selected target —
	 * which at the 2 km/s assist cap is anything past a few thousand kilometres,
	 * and is *most of a system*.
	 */
	private cruisePrompt(targetKm: number | null): string {
		if (this.spoolLeftS > 0) return "";
		if (this.regime === "cruise") return "";
		// **The same predicate the strip's tone reads.** As `chargeAu <= 0` this
		// and the strip disagreed on the frame after a starve-out: regeneration
		// lifts the raw value off zero immediately, so the prompt returned to
		// "press J to cruise" beside a cell still printing "0.0/12 AU".
		if (chargeReadsEmpty(this.chargeAu))
			return "no drive charge — wait for it to regenerate";
		if (targetKm === null) return "T selects a target";
		// An hour at the cap, which is 7,200 km. Below that the crawl is the
		// intended experience — #10 §3 bounds the drop radius by exactly this
		// argument — and above it the answer is always cruise.
		if (targetKm < 3600 * ASSIST_CAP_KMS) return "";
		return "press J to cruise";
	}

	/**
	 * The body the selected target orbits, if any — #30's arrival rule reads it.
	 *
	 * `sim.ts` owns the rule; this is the handle's spelling of it, and it is
	 * public because `probe-arrival.mjs` asks the page the same question rather
	 * than keeping its own copy.
	 */
	targetParentId(): string | null {
		return this.targetId
			? stationHostIdOf(this.world.system, this.targetId)
			: null;
	}

	/** How fast the selected target is moving through sim space, km/s — the frame
	 *  the arrival is judged in. Zero when nothing is selected. */
	targetVelocity(): Vec3 {
		return this.targetId
			? bodyVelocity(this.world.system, this.targetId, this.world.gameTime)
			: v3();
	}

	/** What the player is asking of the flight model this frame (#5's model, in
	 *  `sim.ts`). The assist is a toggle and its state is remembered through
	 *  cruise, which does not honour it (#10 §1). */
	private control(): FlightControl {
		return {
			nose: this.nose(),
			throttle: this.throttle,
			assist: this.assist,
			frameVel: this.localFrame(),
		};
	}

	/**
	 * The velocity the assist treats as at rest — the nearest body's, if the ship
	 * is close enough to be *at* it, and the star's otherwise.
	 *
	 * The threshold is `NEAR_FAR_KM`, the reach of the near layer, and that is
	 * not a coincidence: inside it a body is drawn at 1:1 and is a place the ship
	 * is at rather than a light in the distance, which is exactly when its frame
	 * is the one the player is flying in.
	 *
	 * This is a **finding of the prototype**, not something #10 specified. Sim
	 * space is star-centred, so without it "throttle to zero" beside a station
	 * means stopping relative to the star while the station leaves at 30 km/s —
	 * measured in `probe-cruise.mjs`, which could not hold station after a
	 * perfectly good arrival. It binds #9: docking happens in this frame.
	 */
	private localFrame(): Vec3 {
		const body = this.frameBody;
		return body
			? bodyVelocity(this.world.system, body.id, this.world.gameTime)
			: v3();
	}

	/** The nearby body's inertial frame makes station-keeping legible at idle. */
	private updateLocalFrameBody() {
		let best: Body | null = null;
		let bestKm = NEAR_FAR_KM;
		for (const b of this.world.system.bodies) {
			const km = length(sub(b.pos, this.world.ship.pos));
			if (km < bestKm) {
				best = b;
				bestKm = km;
			}
		}
		this.frameBody = best;
	}

	/**
	 * Normal flight is displayed relative to the body whose frame assist uses.
	 * The inertial value remains visible as context: near a station it is mostly
	 * orbital drift, not an implication that an idle throttle is still burning.
	 */
	private velocityReadout() {
		if (this.regime === "cruise")
			return {
				title: "CRUISE VELOCITY",
				speed: `${(this.cruiseSpeedKms / C_KMS).toFixed(2)} c`,
				context: "NOSE-LOCKED CRUISE",
			};
		const frameBody = this.frameBody;
		const frameVelocity = frameBody
			? bodyVelocity(this.world.system, frameBody.id, this.world.gameTime)
			: v3();
		const relativeKms = length(sub(this.world.ship.vel, frameVelocity));
		const inertialKms = length(this.world.ship.vel);
		return {
			title: "REL. VELOCITY",
			speed: `${relativeKms.toFixed(3)} km/s`,
			context: `${frameBody ? `${frameBody.kind.toUpperCase()} FRAME` : "STAR FRAME"} · INERTIAL ${inertialKms.toFixed(0)} km/s`,
		};
	}

	/** The nose, as a sim-space unit vector. In cruise this *is* the direction of
	 *  travel (§1). */
	private nose() {
		const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation);
		return v3(f.x, f.y, f.z);
	}

	/** The ship's up-vector in sim space — what `docking.md` §3's roll match is
	 *  measured against, and the second half of an attitude the flight model
	 *  deliberately does not hold (`sim.ts` keeps positions, not orientation). */
	private shipUp() {
		const u = new THREE.Vector3(0, 1, 0).applyQuaternion(this.orientation);
		return v3(u.x, u.y, u.z);
	}

	/**
	 * One station's velocity, sim space — the frame §1 states every tolerance in.
	 *
	 * A one-line pass through to `bodyVelocity`, and it is public because a
	 * probe placing a ship beside a station has to place it *co-moving*: at 1 AU
	 * the station is carried at ~30 km/s, so a ship parked at zero sim velocity
	 * is closing at three hundred times the gate before it has done anything.
	 */
	stationVelocity(id: string): Vec3 {
		return bodyVelocity(this.world.system, id, this.world.gameTime);
	}

	/** §6's state for one station, created on first contact. */
	dockingStateOf(id: string): DockingState {
		const held = this.dockingStates.get(id);
		if (held) return held;
		const fresh = newDockingState();
		this.dockingStates.set(id, fresh);
		return fresh;
	}

	/**
	 * The aperture frame for one station, at this frame's clock.
	 *
	 * Composed from `stationPose` in sim, which is where §4.1 puts the phase —
	 * nothing here reads an `Object3D`, and the renderer mirrors the same call.
	 */
	apertureFrameOf(id: string): ApertureFrame {
		const pose = stationPose(this.world.system, id, this.world.gameTime);
		return apertureFrame(
			stationOf(this.world.system, id).type,
			pose.axis,
			pose.phaseRad,
			pose.reference,
		);
	}

	/**
	 * The ship relative to one station, **in the station's frame** (§1).
	 *
	 * The single conversion every caller in this file makes. Sim space is
	 * star-centred and a station on a 1 AU orbit is carried at ~30 km/s, so a
	 * check evaluated on raw sim velocities describes a different game — which
	 * is `probe-cruise.mjs`'s finding turned into one function.
	 */
	entryPoseOf(
		id: string,
		pos = this.world.ship.pos,
		vel = this.world.ship.vel,
	): EntryPose {
		const body = this.world.system.byId.get(id);
		if (!body) throw new Error(`station ${id} has no placed body`);
		return {
			rel: sub(pos, body.pos),
			vRel: sub(vel, bodyVelocity(this.world.system, id, this.world.gameTime)),
			nose: this.nose(),
			up: this.shipUp(),
		};
	}

	/** Every station in the system, nearest first — what a clearance request and
	 *  the computer both need, and neither should scan for itself. */
	private stationsByRange(): { id: string; km: number }[] {
		return this.world.system.contents.stations
			.map((s) => {
				const body = this.world.system.byId.get(s.id);
				return {
					id: s.id,
					km: body
						? length(sub(body.pos, this.world.ship.pos))
						: Number.POSITIVE_INFINITY,
				};
			})
			.sort((a, b) => a.km - b.km);
	}

	/**
	 * §6's request, against the selected station or the nearest one.
	 *
	 * Selection first, because §6 says "when a station is the selected target" —
	 * falling back to the nearest is a convenience for a player who has not
	 * selected anything, and it can only reach a station that is already inside
	 * `VICINITY_KM`, so it grants nothing selection would not have.
	 */
	requestDockingClearance(): { id: string | null; state: DockingState | null } {
		const stations = this.stationsByRange();
		const selected = stations.find((s) => s.id === this.targetId);
		const chosen = selected ?? stations[0];
		if (!chosen || chosen.km > VICINITY_KM) return { id: null, state: null };
		const next = requestClearance(this.dockingStateOf(chosen.id), {
			gameTime: this.world.gameTime,
			rangeKm: chosen.km,
			// §6.1: zero in the live game. #8 replaces the map, not the branch.
			occupancy: this.slotOccupancy.get(chosen.id) ?? 0,
			// #13 §5.1.1's shipyard scan. The predicate behind it is #8's and
			// unbuilt, so nothing fails one yet — the *moment* is what this node
			// owes, and it is here.
			scanFails: false,
		});
		this.dockingStates.set(chosen.id, next);
		return { id: chosen.id, state: next };
	}

	/**
	 * §3's director state for the station the pilot is working, or `null`.
	 *
	 * §3 says the on-glass director "retains the selected target after
	 * Navigation chooses it", and becomes a docking director "for a local
	 * station" — so the selected target wins when it is a station, and the
	 * nearest station is the fallback.
	 *
	 * `directorEngaged` decides whether there is anything to direct: an approach
	 * range **and** an engaged §6 protocol, rather than §6's ten-thousand
	 * kilometre clearance range. The first build gated on the latter and put a
	 * funnel on glass through most of in-system flight, which is the wall of
	 * labels §1 refuses.
	 */
	directorState(): DirectorState | null {
		// **Range-gated before the director is built.** Normal flight is mostly
		// out of §6's vicinity and this runs every frame for a HUD element that
		// then paints nothing, so the cheap test comes first: `entryPoseOf` is one
		// subtraction pair, where `dockingDirector` behind it is an aperture
		// frame, a station pose and a full six-row entry evaluation. The
		// selected-target branch below would otherwise pay all of it twice.
		const of = (id: string) => {
			const pose = this.entryPoseOf(id);
			// The cheap test first: this runs every frame, and `dockingDirector`
			// behind it is an aperture frame, a station pose, a full six-row entry
			// evaluation and a corridor. The selected-target branch would otherwise
			// pay all of it twice.
			if (length(pose.rel) > DIRECTOR_RANGE_KM) return null;
			const body = this.world.system.byId.get(id);
			if (!body) return null;
			const director = dockingDirector({
				stationId: id,
				stationPos: body.pos,
				frame: this.apertureFrameOf(id),
				pose,
				state: this.dockingStateOf(id),
				gameTime: this.world.gameTime,
			});
			return directorEngaged(director) ? director : null;
		};
		// The selected station wins **only while it is local**. Selecting one
		// across the system and flying to another is the ordinary case, and a
		// selection-only rule left the pilot two kilometres off a slot with no
		// director at all — the one place §3 says it becomes a docking director.
		if (
			this.targetId &&
			this.world.system.contents.stations.some((s) => s.id === this.targetId)
		) {
			const selected = of(this.targetId);
			if (selected) return selected;
		}
		const nearest = this.stationsByRange()[0]?.id;
		return nearest ? of(nearest) : null;
	}

	/**
	 * One station's name, or a throw.
	 *
	 * **No `?? id` fallback**, which is what both call sites had: a lookup that
	 * misses would then paint `station-trade` on a shield and report it through
	 * the snapshot, and every ink row — which asks only whether a shield was
	 * drawn — would stay green over a station wearing its lookup key. A station
	 * absent from its own system's contents is the generator and the placement
	 * having disagreed, which is what `stationOf` throws on.
	 */
	private nameOfStation(id: string): string {
		const station = this.world.system.contents.stations.find(
			(s) => s.id === id,
		);
		if (!station) throw new Error(`station ${id} is not in the contents`);
		return station.name;
	}

	/**
	 * Everything a probe needs to judge a docking approach, in one read.
	 *
	 * One call rather than a handful of exposed fields, because §9.2's probes
	 * assert on *relationships* — a bounce that damaged the ship and left it
	 * alive, a crossing refused for containment rather than for an angle — and
	 * sampling those across several page evaluations lets the world move between
	 * them. The numbers are the renderer's own, not a probe's copy of the rules.
	 */
	dockingSnapshot(id?: string): DockingSnapshot | null {
		const target = id ?? this.stationsByRange()[0]?.id;
		if (!target) return null;
		const state = this.dockingStateOf(target);
		const frame = this.apertureFrameOf(target);
		const pose = this.entryPoseOf(target);
		// One lookup for the three fields that need it. This runs per frame on
		// the probe tier — `probe-dock-arrival.mjs` calls it inside a loop of
		// several thousand simulated frames — and `stationOf` walks the contents.
		const station = stationOf(this.world.system, target);
		return {
			stationId: target,
			rangeKm: length(pose.rel),
			/** `|v_rel|` in the station's frame — the scalar check 6 reads. */
			closingKms: length(pose.vRel),
			/** Which body the assist is treating as at rest. A docking approach
			 *  that is holding the wrong one is closing at that body's orbital
			 *  speed while the throttle says zero, which is §1's whole warning. */
			frameBodyId: this.frameBody?.id ?? null,
			throttle: this.throttle,
			offAxisKm: length(
				sub(pose.rel, scale(frame.axis, dot(pose.rel, frame.axis))),
			),
			axialKm: dot(pose.rel, frame.axis),
			planeKm: frame.planeKm,
			apertureKind: frame.aperture.kind,
			apertureWidthKm: frame.aperture.widthKm,
			apertureHeightKm: frame.aperture.heightKm,
			phaseRad: frame.phaseRad,
			axis: frame.axis,
			// The rolled aperture basis, so a probe building an off-centre or
			// mis-rolled approach measures against the renderer's convention
			// rather than deriving its own — a probe with its own copy of a rule
			// goes falsely red the day the rule changes.
			basis: slotBasis(frame),
			// The **unrolled** reference direction — `slotBasis` at phase zero.
			// A probe needing a lateral offset that does not rotate with the slot
			// was seeding its own perpendicular from a world axis, which is a
			// third spelling of a convention `docking.ts` already owns.
			reference: slotBasis({ ...frame, phaseRad: 0 }).across,
			spinRpm: station.spinRpm,
			clearance: state.clearance,
			grantLive: grantLive(state, this.world.gameTime),
			hostile: state.hostile,
			computerEngaged: this.dockingComputerEngaged,
			computerRefusal: this.lastComputerRefusal,
			dockedAt: this.dockedAt,
			// **§12.3's third row, on the page.** Obligation 8's checkable half
			// is that the three exempt states are *distinguishable* from ordinary
			// flight and exposed as such — this is that exposure, and #75 is what
			// reads it.
			dockPhase: this.dock.phase,
			dockedAxialKm: dockedAxialKm(STATION_GEOMETRY[station.type]),
			// E9's generated name, read off the page rather than re-derived by a
			// probe: a probe with its own copy of a rule goes falsely red the day
			// the rule changes.
			stationName: this.nameOfStation(target),
			condition: this.interimCondition,
			alive: isAlive(this.interimCondition),
			// The full pool, so a probe asserting §2.1's quarter-pool bound reads
			// it off the page instead of restating `INTERIM_SHIELD_POOL +
			// INTERIM_HULL_POOL` — the two constants #8 is going to replace.
			poolMax: poolOf(fullCondition()),
			lastEntry: this.lastEntry,
		};
	}

	/** §7's toggle. Refused without the equipment, and it never bypasses a
	 *  check — `dockingComputerStep` refuses the same conditions a pilot fails. */
	toggleDockingComputer() {
		if (!this.hasDockingComputer) return;
		this.dockingComputerEngaged = !this.dockingComputerEngaged;
		if (this.dockingComputerEngaged) this.lastComputerRefusal = null;
	}

	/**
	 * The clock's effect on every §6 protocol state: grants expire, hostility
	 * decays, a queued ship is promoted.
	 *
	 * **Split out of `stepDocking` because it has to run on the docked path
	 * too.** §12's three states return from `step` before the flight tail, and
	 * the first build of that branch left this behind with it — so a ship that
	 * sat docked for twenty minutes came out with a grant that had never
	 * expired and a station whose hostility had never decayed, while #10's
	 * clock ran the whole time. The rule is the one obligation 4 states for the
	 * world: the clock advances, and everything driven by it advances with it.
	 */
	private stepDockingProtocol() {
		for (const [id, state] of this.dockingStates) {
			const next = tickDocking(
				state,
				this.world.gameTime,
				this.slotOccupancy.get(id) ?? 0,
			);
			// `tickDocking` returns the same reference when nothing fired, which is
			// most frames of most stations. Writing it back anyway is a map write
			// per station per frame for a value that did not change.
			if (next !== state) this.dockingStates.set(id, next);
		}
	}

	/**
	 * The docking half of one simulation step: the clock's effect on every
	 * protocol state, then the crossing test against the nearest station.
	 *
	 * Called with the pose from *before* the flight step, because a crossing is
	 * a property of the pair of frames rather than of either one. Sampling the
	 * nearer frame instead makes every tolerance a function of the frame rate —
	 * the class of error §4.1 already refuses for the slot phase.
	 */
	private stepDocking(before: Map<string, DockingApproach>) {
		this.stepDockingProtocol();

		// **The one-way latch is gone, and so is the block that cleared it.**
		// #68 shipped an anti-latch here — a range test that dropped `dockedAt`
		// once the ship drifted `UNDOCK_CLEAR_KM` clear — because docking set a
		// flag nobody ever cleared and leaving was not designed. §12.2 designs
		// it: a launch is a scripted traversal that ends by releasing the ship
		// outside the plane, so the state ends deliberately rather than by the
		// ship wandering out of a radius.

		// **At most one crossing is resolved per step: the first, in
		// start-of-step range order.** `dockingApproaches` sorts by the range the
		// ship had *before* it moved, so this is not strictly the nearest
		// crossing — over one 0.1 s step it is the same station in every case
		// that can arise, since two stations close enough for the order to flip
		// mid-step would be inside each other. A ship cannot dock at two stations
		// at once, and resolving a farther one after a nearer one would apply a
		// repel to a position the nearer outcome had already rewritten.
		for (const [id, from] of before) {
			// A ship in any of §12.3's three exempt states does not re-cross its
			// own plane — `step` does not reach this loop at all while it is in
			// one, and the guard stays as the statement of the rule rather than
			// as the thing enforcing it.
			if (this.dock.stationId === id) continue;
			// **The cached frame, not a fresh one.** `dockingApproaches` built it
			// at the top of the step and `planeCrossing` already documents that it
			// evaluates one frame for both endpoints; rebuilding it here was the
			// dedup this pair exists for, not happening.
			const crossing = planeCrossing(
				from.frame,
				from.pose,
				this.entryPoseOf(id),
			);
			if (!crossing) continue;
			this.resolveCrossing(id, from.frame, crossing);
			return;
		}
	}

	/** One crossing, applied: the outcome, the ship, and the session state that
	 *  follows from it. Split from the tick loop above because this is the half
	 *  that grows — the HUD node's cues and #8's pools both land here. */
	private resolveCrossing(
		id: string,
		frame: ApertureFrame,
		crossing: EntryPose,
	) {
		const outcome = attemptEntry({
			frame,
			pose: crossing,
			state: this.dockingStateOf(id),
			gameTime: this.world.gameTime,
		});
		this.dockingStates.set(id, outcome.state);
		this.lastEntry = outcome;
		// Whatever happens next, the ship ends up in the station's frame or
		// bouncing out of it, so the velocity is wanted either way.
		const stationVel = this.stationVelocity(id);
		// A dock and a bounce are both reasons to stop flying the approach —
		// **and the throttle is part of the approach.** Clearing the engaged flag
		// alone was the first version: `stepDockingComputer` had written the
		// throttle on the same frame, so the next step hand-flew with a throttle
		// nobody set and the assist accelerated a docked ship along its nose,
		// through the station it had just docked at.
		this.dockingComputerEngaged = false;
		this.throttle = 0;

		if (outcome.docked) {
			// **E2: crossing the plane hands the ship over.** The skill test
			// ended here, so from this instant the ship is on rails and nothing
			// can fail — the arrival is a position law, and `stepDockedWorld`
			// places the ship every frame until it parks.
			this.dock = enterArrival(
				id,
				frame,
				crossing.rel,
				{ nose: crossing.nose, up: crossing.up },
				this.world.gameTime,
			);
			this.world.ship.vel = stationVel;
			return;
		}
		// §2.0: repelled, damaged, and left outside — never inside the station.
		this.interimCondition = applyDamage(this.interimCondition, outcome.damage);
		const body = this.world.system.byId.get(id);
		if (body && outcome.repelled) {
			this.world.ship.pos = add(body.pos, outcome.repelled.rel);
			this.world.ship.vel = add(stationVel, outcome.repelled.vRel);
		}
	}

	/**
	 * One frame of an arrival, a parked ship or a launch.
	 *
	 * The placement is written into the ship — position, velocity **and
	 * attitude** — because the traversal owns all three: E2's scripted path is
	 * not a path the player is flying, and an orientation left where the
	 * crossing put it would have the ship sliding down the throat sideways.
	 */
	private stepDockPhase(dt: number) {
		const out = stepDockedWorld(this.world, this.dock, dt);
		this.dock = out.session;
		// The clock moved, so §6 moves with it: grants expire and hostility
		// decays while the player sits docked. This line is the reason the
		// caller's comment names what runs rather than implying the rest — it
		// was missing, and nothing failed.
		this.stepDockingProtocol();
		if (!out.ship) return;
		this.world.ship.pos = out.ship.pos;
		this.world.ship.vel = out.ship.vel;
		this.setAttitude(out.ship.nose, out.ship.up);
		// The rates are zeroed for the reason the docking computer zeroes them:
		// the attitude is being placed directly, and a momentum term still
		// turning underneath it would fight the placement every frame — and
		// would still be turning on the frame a launch hands control back.
		this.rates = { pitch: 0, yaw: 0, roll: 0 };
		this.throttle = 0;
	}

	/**
	 * §12.2's launch, as the game's entry point for it.
	 *
	 * **The motion is this spec's and the control is #70's** — M9 puts the
	 * launch control on the Flight console. This method is the seam: what
	 * happens after it is pressed. **Control**, throughout — `CONTEXT.md`
	 * §Language reserves the other word for **Intervention**, which is a player
	 * action on a carrier's condition and not a thing on a console, and a word
	 * that reads past a glossary is a word that ends up meaning both.
	 */
	launch(): boolean {
		if (this.dock.phase !== "docked" || !this.dock.stationId) return false;
		this.dock = requestLaunch(
			this.dock,
			this.apertureFrameOf(this.dock.stationId),
			this.world.gameTime,
		);
		return this.dock.phase === "launching";
	}

	/** Skip the traversal in progress, where §12.6's obligation 5 allows it —
	 *  which today is a launch and never an arrival, because E4's flag has no
	 *  bounded store yet (§12.7's joint 6). */
	skipDockTraversal(): boolean {
		if (!canSkipTraversal(this.dock)) return false;
		this.dock = skipTraversal(this.dock, this.world.gameTime);
		return true;
	}

	private stepDockingComputer(
		dt: number,
		approaches: Map<string, DockingApproach>,
	): boolean {
		if (!this.dockingComputerEngaged || this.dockedAt) return false;
		// The first entry is the nearest station: `dockingApproaches` walks in
		// range order.
		const [nearestId, approach] = approaches.entries().next().value ?? [];
		if (!nearestId || !approach) return false;
		const { frame } = approach;
		const command = dockingComputerStep({
			frame,
			pose: approach.pose,
			state: this.dockingStateOf(nearestId),
			gameTime: this.world.gameTime,
			maxSpeedKms: ASSIST_CAP_KMS,
		});
		if (!command.engaged) {
			// **Silent disengagement is the failure mode here.** §8's HUD cues are
			// not this node's, so nothing tells the player the autopilot stopped —
			// and a grant taken at the far edge of `VICINITY_KM` expires mid-approach
			// (§11.7), which is precisely when this fires. Leaving the throttle
			// where the computer put it would hand back a ship still closing at a
			// speed nobody chose, so the throttle goes to zero and the reason is
			// recorded for the HUD node to read.
			this.dockingComputerEngaged = false;
			this.lastComputerRefusal = command.refused;
			this.throttle = 0;
			return false;
		}
		const nose = slewToward(this.nose(), command.nose, ANGULAR_MAX.yaw * dt);
		const up = slewToward(this.shipUp(), command.up, ANGULAR_MAX.roll * dt);
		this.setAttitude(nose, up);
		this.throttle = Math.min(1, command.speedKms / ASSIST_CAP_KMS);
		// The rates are zeroed rather than left running: the computer is placing
		// the attitude directly, and a momentum term still turning underneath it
		// would fight the slew every frame.
		this.rates = { pitch: 0, yaw: 0, roll: 0 };
		return true;
	}

	/**
	 * Point the ship, given a nose and an up.
	 *
	 * The up is re-orthogonalised against the nose, because two independently
	 * slewed directions are not an attitude until they are perpendicular.
	 *
	 * Public because §9.2's probes script an approach with a deliberate roll
	 * error and need the renderer's own attitude law rather than a second
	 * spelling of it — the same reason `step` and `render` are public.
	 */
	setAttitude(nose: Vec3, up: Vec3) {
		// The orthonormalisation is `docking.ts`'s, not a second copy here: the
		// headless harness that flies the autopilot needs the same law, and the
		// tier that verifies a thing should not carry its own version of it.
		const basis = orthonormalise(nose, up);
		if (!basis) return;
		const f = new THREE.Vector3(basis.nose.x, basis.nose.y, basis.nose.z);
		const u = new THREE.Vector3(basis.up.x, basis.up.y, basis.up.z);
		const right = new THREE.Vector3().crossVectors(f, u);
		// Columns are (right, up, back): the mesh's nose is -Z, which is what
		// `nose()` reads back out.
		this.orientation.setFromRotationMatrix(
			new THREE.Matrix4().makeBasis(right, u, f.clone().negate()),
		);
	}

	/**
	 * Ask for cruise. It arrives `SPOOL_S` later, or not at all.
	 *
	 * Refused with no charge, because §7 meters cruise by the AU and a regime
	 * that engages on an empty tank would drop out on its first frame — the
	 * player would see a flicker rather than a refusal.
	 */
	engageCruise() {
		if (this.regime === "cruise" || this.spoolLeftS > 0) return;
		if (this.chargeAu <= 0) {
			this.lastExit = "no drive charge";
			return;
		}
		this.spoolLeftS = SPOOL_S;
		this.lastExit = "";
	}

	/**
	 * Leave cruise, for whatever reason, and land in normal flight the way §1
	 * says: velocity along the nose, clamped to the assist cap.
	 *
	 * One method rather than a clamp at each exit site, because there are three
	 * of them — the auto-drop, the player's key and an empty tank — and the exit
	 * rule is the same for all three. A per-site clamp is how one of them ends up
	 * leaving the ship at 140 km/s.
	 *
	 * `matchTarget` is what separates them. **Only an arrival** leaves the ship in
	 * the target's frame: dropping out half an AU away and inheriting the
	 * station's 30 km/s would fling the ship across the system in a direction it
	 * never asked to go, and the 2 km/s assist cap cannot take it back off. Away
	 * from the target the frame is the star's, which is what the sim's
	 * coordinates are stated in anyway.
	 */
	dropOut(reason: string, matchTarget = false) {
		if (this.regime !== "cruise") {
			this.spoolLeftS = 0;
			return;
		}
		// In the target's frame (`cruise.ts`'s `exitVelocity`): a station on a
		// 1 AU orbit moves at ~30 km/s, so an absolute clamp to the 2 km/s assist
		// cap would drop the player next to a target already leaving at fifteen
		// times the speed normal flight can manage.
		this.world.ship.vel = exitVelocity(
			this.nose(),
			this.cruiseSpeedKms,
			matchTarget ? this.targetVelocity() : v3(),
		);
		this.regime = "normal";
		this.cruiseSpeedKms = 0;
		this.throttle = 0;
		this.lastExit = reason;
		if (this.legStartedAtS !== null) {
			this.lastLegS = this.world.gameTime - this.legStartedAtS;
			this.legStartedAtS = null;
		}
	}

	/**
	 * How long the rest of the approach takes at the current throttle, seconds —
	 * §5.1's headline readout. `null` when nothing is selected.
	 *
	 * See `cruise.ts`'s `legSeconds` for why the cruise case integrates instead
	 * of dividing.
	 */
	timeToTarget(): number | null {
		const target = this.targetBody();
		return target === null ? null : this.timeToBody(target);
	}

	/**
	 * One simulation step, in the order the game runs it.
	 *
	 * A method rather than statements inside `animate`, and `dt` an argument
	 * rather than something read from a clock in here — so a probe can cancel
	 * the frame loop and step the world itself with a fixed delta, running
	 * exactly what the game runs rather than its own copy of the order.
	 */
	step(dt: number) {
		this.updateLocalFrameBody();
		// **§12's three states come first, and they return.** E5 suspends
		// flight: the throttle, the stick and the docking computer are all
		// inert, so none of the input handling below runs — and neither does
		// `stepDocking`, which is obligation 2's "nothing re-evaluates §3's
		// checks during it".
		//
		// **What still runs is named, not implied.** `stepDockPhase` advances
		// the clock, moves the bodies (`advanceWorldClock`) and ticks §6's
		// protocol — three things, and the rest of `step`'s flight tail does
		// not. That is enough for obligation 4 as §12.2 states it and enough for
		// every subsystem this game currently has on that tail; it is **not** a
		// standing equivalence, and an earlier version of this comment claimed
		// one. The protocol tick is here because the first build left it out and
		// a docked ship kept a grant that never expired. Anything per-frame
		// added below owes the same question, and the answer has to be written
		// rather than assumed — nothing checks it, because a test for "the
		// world keeps running" cannot tell a running world from three running
		// subsystems.
		if (!flightLive(this.dock.phase)) {
			this.stepDockPhase(dt);
			return;
		}
		// #48 deliberately couples no combat entity to the world yet: this is a
		// flyable balance rig over the shared flight loop, not production combat.
		if (this.combatPrototypeEnabled) {
			const targetInCone = duelTargetInCone(this.combat.elapsed);
			this.combat = stepCombatPrototype(this.combat, {
				dt,
				firing: this.keys.has("s")
					? "beam"
					: this.keys.has(" ")
						? "pulse"
						: null,
				targetInCone,
				// Alternate which target shield bank the fixed weapon meets, so the
				// fore/aft pools both participate in the duel pacing being measured.
				hitAft: Math.floor(this.combat.elapsed / 2) % 2 === 1,
				incomingMissile: this.combatIncoming,
				ecm: this.combatEcm,
				// Interdiction only charges in cruise (it is a cruise mechanic); the
				// probe therefore never observes ACTIVE in normal flight, only CLEAR.
				interdicting: this.regime === "cruise",
				breakAngle: this.keys.has("q") || this.keys.has("e"),
				// The enemy fires on its own schedule, not on the player's aim cone:
				// gating the enemy's damage on targetInCone would let the player
				// only be damaged while happening to point at the enemy. The enemy
				// stops once either side's hull is gone, so the duel has a terminal
				// state; the player's held trigger is their own choice.
				enemyFiring:
					this.combat.targetHull > 0 &&
					this.combat.playerHull > 0 &&
					this.combat.elapsed % 4 < 2,
				enemyHitAft: Math.floor(this.combat.elapsed / 3) % 2 === 1,
			});
		}
		this.combatIncoming = false;
		this.combatEcm = false;
		const yaw = this.axis(["arrowright", "d"], ["arrowleft", "a"]);
		const pitch = this.axis(["arrowdown", "s"], ["arrowup", "w"]);
		const roll = this.axis(["e"], ["q"]);

		// §7: any control input cancels the computer. Read before the rates are
		// stepped, so the cancel and the input land on the same frame rather than
		// the computer getting one more frame of authority over a player who has
		// already taken the stick.
		//
		// **The throttle counts.** It was left out of the first version, and the
		// result was worse than no cancel: `stepDockingComputer` overwrites
		// `this.throttle` on the same frame, so a player pushing the throttle got
		// neither a cancel nor an effect — an input that visibly does nothing.
		if (this.dockingComputerEngaged && this.hasControlInput(yaw, pitch, roll))
			this.dockingComputerEngaged = false;

		// One range scan and one orbital evaluation per station for the whole
		// step: the autopilot reads the same approach the crossing test then uses
		// as its "before" half, and neither moves the ship, so a second
		// evaluation would be the same answer at the same clock value.
		const approaches = this.dockingApproaches();

		if (this.stepDockingComputer(dt, approaches)) {
			this.mouseDx = 0;
			this.mouseDy = 0;
			this.audio.ambient(this.throttle);
			this.advanceNormalFlight(dt, approaches);
			return;
		}

		// The mouse, when it has been captured, and the keyboard always — the
		// principal's choice of "both, mouse on by default". A pointer delta is a
		// *nudge* rather than a stick position, so it enters as an impulse on the
		// rate and is then damped like everything else; the keys are the stick.
		const impulse = {
			pitch: clampAbs(-this.mouseDy * MOUSE_RAD_PER_PX, MOUSE_MAX_STEP),
			yaw: clampAbs(-this.mouseDx * MOUSE_RAD_PER_PX, MOUSE_MAX_STEP),
			roll: 0,
		};
		this.mouseDx = 0;
		this.mouseDy = 0;

		// Rotation carries momentum (`stepAngular`): the ship eases into a turn
		// and, with the assist on, eases out of it. Setting the rate straight from
		// the key state is what made this feel like 1984.
		this.rates = stepAngular(
			this.rates,
			{ pitch, yaw, roll },
			impulse,
			this.assist,
			dt,
		);

		// Rotations composed in the ship's own frame — multiply on the right —
		// so pitch is about the wing axis wherever the nose happens to point,
		// rather than about a world axis the player cannot see.
		const turn = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(
				this.rates.pitch * dt,
				this.rates.yaw * dt,
				this.rates.roll * dt,
				"XYZ",
			),
		);
		this.orientation.multiply(turn).normalize();

		// Held rather than stepped, for the same reason throttle is: an angle the
		// player is choosing by eye wants a rate, not a ladder of fixed stops.
		const orbit = this.view === "chase" ? this.chaseOrbitInput() : 0;
		if (orbit !== 0)
			this.chaseYaw = wrapAngle(this.chaseYaw + orbit * CHASE_ORBIT_RATE * dt);

		if (this.keys.has(THROTTLE_UP))
			this.throttle = Math.min(1, this.throttle + dt);
		if (this.keys.has(THROTTLE_DOWN))
			this.throttle = Math.max(0, this.throttle - dt);
		this.audio.ambient(this.throttle);

		// The spool-up runs in whichever regime the ship is in, and hands over at
		// zero. Cruise begins at full throttle, because a wind-up that ends with
		// the ship still stationary is a wind-up the player has to follow with a
		// second input for no reason.
		if (this.spoolLeftS > 0) {
			this.spoolLeftS = Math.max(0, this.spoolLeftS - dt);
			if (this.spoolLeftS === 0) {
				this.regime = "cruise";
				this.throttle = 1;
				this.legStartedAtS = this.world.gameTime;
			}
		}

		if (this.regime === "cruise") {
			this.stepCruise(dt);
			return;
		}

		this.advanceNormalFlight(dt, approaches);
	}

	/**
	 * The normal-flight tail of a step: the world, the tank, the docking test.
	 *
	 * One method rather than two copies, because the autopilot branch above ends
	 * the same way. Two copies is how a later post-step hook lands in one of
	 * them and the computer silently stops obeying a rule hand flying does.
	 */
	private advanceNormalFlight(
		dt: number,
		before: Map<string, DockingApproach>,
	) {
		// `before` is the approaches from the top of the step, for every station
		// close enough to be flown into: a plane crossing is a property of the
		// pair of frames, and the "before" half stops existing the moment the
		// ship moves.

		// The whole world, not just the ship: `dt` is sim seconds and the bodies
		// are on orbits driven by the same clock. Stepping the ship alone would
		// freeze the system around it, which is the state the scaffold was in.
		stepWorld(this.world, this.control(), dt);
		// §7: the tank refills passively in normal flight, and that is the
		// anti-stranding rule rather than a convenience.
		this.chargeAu = chargeAfterRegen(this.chargeAu, dt);
		this.stepDocking(before);
	}

	/**
	 * Every station near enough to cross a plane this frame: its aperture frame
	 * and the ship's pose in it, computed **once**.
	 *
	 * The frame rides along with the pose because both halves cost the same
	 * orbital evaluation — `stationPose` and `bodyVelocity` each walk the
	 * contents to resolve a parent — and the crossing test needs both. An
	 * earlier version returned poses alone and `stepDocking` then rebuilt the
	 * frame per station, doubling that work every frame for nothing.
	 *
	 * Bounded by `VICINITY_KM` rather than run over the whole system: a station
	 * an AU away cannot be crossed by any step the clamp allows. The walk is in
	 * range order, which is what lets it stop at the first station out of range
	 * — and what makes the nearest crossing the one resolved.
	 */
	private dockingApproaches(): Map<string, DockingApproach> {
		const approaches = new Map<string, DockingApproach>();
		for (const { id, km } of this.stationsByRange()) {
			if (km > VICINITY_KM) break;
			approaches.set(id, {
				frame: this.apertureFrameOf(id),
				pose: this.entryPoseOf(id),
			});
		}
		return approaches;
	}

	/**
	 * One frame of cruise.
	 *
	 * The clock and the bodies move first, exactly as `stepWorld` does it and
	 * for the same reason — a frame must not mix a body position from one clock
	 * value with a ship position from another. Then the ship is *placed* rather
	 * than integrated: §1 nose-locks velocity, so there is no momentum here to
	 * carry across frames, and `cruise.ts` computes the whole displacement from
	 * where the ship is.
	 *
	 * `ship.vel` is still written, because the HUD and everything downstream read
	 * it — but it is a **report** of this frame's motion, not a state the next
	 * frame integrates. That is the difference between the two regimes stated in
	 * one line of code.
	 */
	private stepCruise(dt: number) {
		advanceWorldClock(this.world, dt);
		const nose = this.nose();
		const target = this.targetBody();
		const step = advanceCruise({
			pos: this.world.ship.pos,
			nose,
			throttle: this.throttle,
			dt,
			masses: this.masses(),
			target: target
				? {
						pos: target.pos,
						radiusKm: target.radiusKm,
						vel: this.targetVelocity(),
					}
				: null,
			params: this.cruiseParams,
			chargeAu: this.chargeAu,
			targetParentId: this.targetParentId(),
		});
		this.world.ship.pos = step.pos;
		this.cruiseSpeedKms = step.speedKms;
		this.closingKms = step.closingKms;
		this.world.ship.vel = scale(nose, step.speedKms);
		this.chargeAu = chargeAfterTravel(this.chargeAu, step.travelledKm);
		if (step.dropped) {
			// The frame the ship is left in follows the *reason*. An arrival matches
			// the target. A surface drop matches it too **when the body is the
			// one selected** — cruising to a planet is a target like any other,
			// and leaving the ship in the star's frame beside it would strand it the
			// same way an absolute clamp strands an arrival at a station. Against
			// some other body it was flown at by accident, the star's frame is right.
			const atTarget =
				step.exit === "arrival" || step.exitBodyId === this.targetId;
			this.dropOut(
				step.exit === "proximity"
					? `dropped by proximity to ${step.exitBodyId ?? "a body"}`
					: `arrived at ${this.targetId ?? "target"}`,
				atTarget,
			);
			return;
		}
		// **After** the arrival test: a frame that both arrives and runs the tank
		// dry is an arrival — the ship is at its target, and reporting an
		// empty tank instead would drop it there in the wrong frame.
		if (step.starved) this.dropOut("drive charge exhausted");
	}

	/**
	 * Where the camera is in *sim* space.
	 *
	 * Cockpit by default (#5): a few metres ahead of the hull's centre, so the
	 * view is from the nose and the cube is not in it. Chase is the toggle, and
	 * keeps the offsets the scaffold tuned by eye.
	 */
	private cameraPos() {
		const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
			this.orientation,
		);
		if (this.view === "cockpit") {
			return add(
				this.world.ship.pos,
				scale(v3(forward.x, forward.y, forward.z), COCKPIT_FORWARD_KM),
			);
		}
		// Behind and above in the ship's own frame, then swung round its up axis
		// by the orbit. `cameraRotation` applies the same yaw, so the rig turns
		// as one piece and the hull stays where it was in frame.
		const offset = this.chaseOffset
			.set(0, CHASE_UP_KM, CHASE_BACK_KM)
			.applyAxisAngle(HEAD_AXIS, this.chaseYaw)
			.applyQuaternion(this.orientation);
		return add(this.world.ship.pos, v3(offset.x, offset.y, offset.z));
	}

	/**
	 * Place everything relative to the camera, and draw.
	 *
	 * This is where float64 becomes float32, and it is the only place that
	 * conversion is allowed to happen: every `mesh.position.set` below takes the
	 * *difference* of two sim positions, which is small, rather than a sim
	 * position, which is not.
	 */
	render(dt = 0) {
		const camPos = this.cameraPos();

		// §5: the streaks are a marker on the regime, keyed to the *log* of the
		// speed. A linear fraction of `v_max` sits at nearly zero for the whole
		// approach and then snaps on, which is the one thing a cue must not do.
		const p = this.cruiseParams;
		const span = Math.log(p.vMaxKms / p.vMinKms);
		const intensity =
			this.regime === "cruise" && this.cruiseSpeedKms > p.vMinKms
				? Math.log(this.cruiseSpeedKms / p.vMinKms) / span
				: 0;
		this.warp.update(intensity, this.orientation, dt);

		const viewRotation = this.cameraRotation();
		// All three cameras share the ship's head-look orientation and sit at the
		// origin. The cockpit mesh keeps the ship orientation, so this is a pan
		// inside the hull rather than a yaw of the world or a flight-control input.
		for (const cam of [
			this.backdropCamera,
			this.farCamera,
			this.approachCamera,
			this.nearCamera,
		]) {
			cam.position.set(0, 0, 0);
			cam.quaternion.copy(viewRotation);
		}
		this.cockpit.mesh.quaternion.copy(this.orientation);
		this.cockpit.mesh.visible = this.view === "cockpit";
		// The star sphere follows the camera so it never parallaxes — which is
		// what makes it read as infinitely far away rather than as a small ball
		// the ship is inside. The camera being at the origin means this is a
		// no-op today; it is written out because the moment the camera stops
		// being pinned there, its absence is a bug that takes an hour to see.
		this.stars.position.copy(this.backdropCamera.position);
		// A deliberate prototype target gives the balance controls a visible object
		// without borrowing #35's display-only traffic as a combat entity. It is
		// built only in prototype mode, so the whole update is gated too.
		if (this.combatPrototypeEnabled) {
			// The target holds a fixed bearing off the nose (ship frame, not the
			// head-look camera rotation). The cone test is scripted by elapsed
			// time, so this prototype measures pacing, not aiming skill — the
			// flight-validation note below must not claim aim decides hits.
			this.combatTargetMesh.position
				.set(
					3 * Math.sin(this.combat.elapsed * 0.7),
					1.2 * Math.cos(this.combat.elapsed * 1.1),
					-12,
				)
				.applyQuaternion(this.orientation);
			this.combatTargetMesh.visible = this.view === "cockpit";
			const targetMaterial = this.combatTargetMesh
				.material as THREE.MeshStandardMaterial;
			// Flash on the same scripted cone that scores damage, so the swell
			// tracks hits. The cone is a coarse proxy (up to ~13 degrees off the
			// nose), not a pixel-accurate aim test — this rig measures pacing.
			const hitting =
				this.combat.firing !== null && duelTargetInCone(this.combat.elapsed);
			targetMaterial.emissive.setHex(hitting ? 0x9df6ff : 0x450308);
			targetMaterial.emissiveIntensity = hitting ? 4 : 1.2;
			this.combatTargetMesh.scale.setScalar(hitting ? 1.25 : 1);
			this.combatLaser.quaternion.copy(viewRotation);
			this.combatLaser.visible =
				this.view === "cockpit" &&
				this.combat.firing !== null &&
				!this.probeForceLaserHidden;
		}

		// The star, resolved once at build time rather than scanned for per frame:
		// every body's sun direction is measured from it, and there is no path
		// that changes the system a game is in.
		const star = this.starBody;
		const starPos = star ? star.pos : ORIGIN;

		for (const body of this.world.system.bodies) {
			const mesh = this.meshes.get(body.id);
			if (!mesh) continue;
			// Components rather than a `Vec3`, because this runs per body per frame
			// and the object would be garbage the moment it is read — the trade
			// `vec3.ts`'s own docstring calls the wrong one inside a hot loop. Small
			// N today, and it grows with moons.
			const dx = body.pos.x - camPos.x;
			const dy = body.pos.y - camPos.y;
			const dz = body.pos.z - camPos.z;
			// The distance is computed here and the layer chosen from it, so the
			// mesh is placed in the same pass it may have just been reparented by —
			// a body that changed layer and kept last frame's position would be
			// drawn at the new scale in the old place, for one frame, in front of
			// the player.
			const was = this.layers.get(body.id);
			const distanceKm = Math.hypot(dx, dy, dz);
			const massive = isMassive(body.kind);
			const layer = massive
				? massiveLayerFor(
						was === "approach" ? "approach" : "far",
						distanceKm - body.radiusKm,
					)
				: layerFor(was === "near" ? "near" : "far", distanceKm);
			if (layer !== was) this.setLayer(body, layer);
			const k = scaleFor(layer);
			mesh.position.set(dx * k, dy * k, dz * k);

			// The surface shader's sun is a **per-body** direction, from this body
			// to the star — not the camera-to-star direction the lights below use.
			// At astronomical separations the two disagree by tens of degrees, and
			// the disagreement is exactly the terminator: a planet on the far side
			// of the star is a crescent, and a camera-derived direction would draw
			// it full.
			const visual = this.bodyVisuals.get(body.id);
			if (visual) {
				const sx = starPos.x - body.pos.x;
				const sy = starPos.y - body.pos.y;
				const sz = starPos.z - body.pos.z;
				// The star itself is at zero distance from the star. Its class does
				// not read `sunDir` — a star is not lit — so any unit vector will
				// do, and this avoids a divide by zero producing NaNs that would
				// propagate into the shared uniform.
				const sd = Math.hypot(sx, sy, sz);
				if (sd > 0) SUN_DIR.set(sx / sd, sy / sd, sz / sd);
				else SUN_DIR.set(0, 0, 1);
				visual.setSunDirection(SUN_DIR);
				// The world clock, not a frame counter: cloud drift and stellar
				// granulation are `f(gameTime)` like every other time-varying thing
				// (#6), so they survive a pause and a save.
				visual.setTime(this.world.gameTime);
			}

			// Stations are aimed and spun; everything else is a sphere and has no
			// orientation worth writing. Both numbers come from `stationPose` in
			// sim — the renderer mirrors the slot's phase rather than owning it
			// (`docking.md` §4.1), so a docking check never depends on frame
			// timing.
			const station = this.stationVisuals.get(body.id);
			if (station) {
				const spinner = station.spinner;
				// Detail and lights, from the same distance the layer above was
				// chosen with and the same clock the pose is read at. A second
				// distance computed here would be one more thing to keep in step
				// with the layer rule.
				// The quality key rides along rather than being applied in
				// `applyQuality`: a station built after the setting changed would
				// otherwise draw its clutter for one frame at low, and the
				// alternative — a live registry of every station's greeble meshes
				// — is a set the renderer would have to remember to empty.
				updateStationVisuals(
					station,
					this.world.gameTime,
					distanceKm,
					this.settings.value.quality,
				);
				// The bay is open while approaching and traversing; it seals only once
				// parked, so a docked free-look remains inside the station rather than
				// looking back out through the aperture into space.
				if (station.hangarGate)
					station.hangarGate.visible =
						this.dock.phase === "docked" && this.dock.stationId === body.id;
				// Through the handle's own accessor, not a second copy of the same
				// argument triple: `poseOfStation` is documented as "the pose the
				// renderer is mirroring", and a probe asserting through it has to be
				// asserting the path the renderer actually takes.
				const pose = this.poseOfStation(body.id);
				// Local +Z is the aperture axis, which is the contract
				// `station-mesh.ts` is built to.
				STATION_AXIS.set(pose.axis.x, pose.axis.y, pose.axis.z);
				// **Aimed on the sim's own basis, which is what §4.1 always said
				// and what was not true until #126.** `setFromUnitVectors` took
				// local +Z onto the axis by the shortest turn — exact in the axis
				// and arbitrary in the roll about it — so the slot a player could
				// see sat 64.6° from the slot check 4 measures, on the trade
				// station, and 78.2° on the refinery. A ship parked by §12.2 was
				// two thirds of a right angle out of the slot it was in, which is
				// how it was reported: *"leaves the ship in a felt skewed
				// position"*.
				//
				// Local X goes on the phase-zero `across` and local Y on the `up`
				// that goes with it, so `spinner.rotation.z = phaseRad` reproduces
				// `slotBasis` exactly. This was built and withdrawn once, when the
				// reference was `anyPerpendicular` and jumped on its own `< 0.9`
				// branch as the axis swung; the reference is the station's
				// along-track direction now, and turns smoothly.
				const zero = slotBasis(frameAtPhase(this.apertureFrameOf(body.id), 0));
				STATION_ACROSS.set(zero.across.x, zero.across.y, zero.across.z);
				STATION_UP.set(zero.up.x, zero.up.y, zero.up.z);
				STATION_BASIS.makeBasis(STATION_ACROSS, STATION_UP, STATION_AXIS);
				mesh.quaternion.setFromRotationMatrix(STATION_BASIS);
				spinner.rotation.z = pose.phaseRad;
			}
		}

		// The star also aims the light, in both scenes. Its direction is the same
		// at either scale, which is the property that let one light stand for two.
		// This is the *camera's* direction to the star and it lights the ship and
		// the stations; a planet's own surface shader uses its own, above.
		if (star) {
			const toStar = sub(star.pos, camPos);
			const d = Math.max(1e-9, length(toStar));
			STAR_DIR.set(toStar.x / d, toStar.y / d, toStar.z / d);
			// The bake put its star at `BAKE_STAR_DIR`; this is the rotation that
			// carries it onto the real one. A rotation rather than a rebake because
			// the star direction changes continuously as the ship crosses the
			// system, and a PMREM pass per frame is not a thing to spend a frame on.
			//
			// `envRotation` picks the shortest arc, so the environment also rolls
			// about the star axis as the ship moves. Nothing in the bake varies
			// about that axis — the model is a lobe and a floor — so the roll is
			// unobservable, and it stops being so the day #100's haze arrives.
			// That is the seam, named where the rotation is applied.
			//
			// It is derived in `light-rig.ts` and not here, and that is the fix
			// for #99's review blocker rather than a tidiness point: written here
			// as `setFromUnitVectors(BAKE_STAR_UNIT, STAR_DIR)` it was
			// indistinguishable from its own inverse by anything the repo could
			// run. As a function it has a round trip a headless test sweeps.
			ENV_QUAT.fromArray(envRotation([STAR_DIR.x, STAR_DIR.y, STAR_DIR.z]));
			ENV_EULER.setFromQuaternion(ENV_QUAT);
			// Cached at build rather than looked up: `getObjectByName` walks every
			// descendant, and the near scene holds every drawn body — so the two
			// name lookups this replaced cost six recursive traversals a frame,
			// scaling with the scene rather than with the two lights being found.
			for (const rig of this.layerLights) {
				rig.sun.position.copy(STAR_DIR);
				// The hemisphere's axis is its position, so aiming it at the star is
				// what turns a flat lift into a star-side gradient.
				rig.hemisphere.position.copy(STAR_DIR);
				rig.scene.environmentRotation.copy(ENV_EULER);
			}
		}

		// The fill follows the camera's orientation, so it stays over the viewer's
		// left shoulder however the ship is pointed — which is what makes it read
		// as lighting rather than as a second sun the player can fly around.
		const fill = this.nearScene.getObjectByName(
			"fill",
		) as THREE.DirectionalLight;
		if (fill)
			fill.position
				.set(-0.5, 0.7, 1)
				.normalize()
				.applyQuaternion(this.orientation);

		const shipRel = sub(this.world.ship.pos, camPos);
		this.shipMesh.position.set(shipRel.x, shipRel.y, shipRel.z);
		this.shipMesh.quaternion.copy(this.orientation);
		this.anchorFleet();
		for (const parked of this.fleet)
			parked.mesh.position.set(
				parked.pos.x - camPos.x,
				parked.pos.y - camPos.y,
				parked.pos.z - camPos.z,
			);
		// The hull is the camera in cockpit view, and drawing a cube around the
		// near plane fills the screen with its inside faces.
		this.shipMesh.visible = this.view === "chase";

		this.composer.render();
		this.drawMarkers(camPos);
		this.frames++;
	}

	private animate = () => {
		this.animationFrame = requestAnimationFrame(this.animate);
		const now = performance.now();
		const dt = this.lastTime
			? Math.min(MAX_DT, (now - this.lastTime) / 1000)
			: 0;
		this.lastTime = now;
		if (dt > 0) this.step(dt);
		this.render(dt);
		this.updateCockpit();
		if (this.legacyHud) this.updateHud();
	};

	private readonly chaseOffset = new THREE.Vector3();

	/**
	 * Pin the review avenue in front of the ship, once.
	 *
	 * Laid out along the ship's own axes rather than the world's: the ship does
	 * not boot facing -Z, it boots facing the station, and an avenue built on
	 * the world axes put thirty-three hulls out of frame with nothing wrong in
	 * any of the numbers. Deferred to the first frame because `buildShip` runs
	 * before that boot facing is settled, so a basis read in the constructor is
	 * the identity one and quietly wrong.
	 */
	private anchorFleet() {
		if (this.fleetAnchored || !this.fleet.length) return;
		this.fleetAnchored = true;
		const anchor = this.world.ship.pos;
		const facing = this.orientation;
		// Nose back down the avenue, so the player meets bows rather than tails.
		const about = new THREE.Quaternion().setFromAxisAngle(HEAD_AXIS, Math.PI);
		for (const parked of this.fleet) {
			const offset = new THREE.Vector3(
				parked.slot.x,
				parked.slot.y,
				parked.slot.z,
			).applyQuaternion(facing);
			parked.pos = v3(
				anchor.x + offset.x,
				anchor.y + offset.y,
				anchor.z + offset.z,
			);
			parked.mesh.quaternion.copy(facing).multiply(about);
		}
	}

	private cameraRotation() {
		const yaw =
			this.view === "cockpit"
				? this.headLook === "left"
					? Math.PI / 2.7
					: this.headLook === "right"
						? -Math.PI / 2.7
						: 0
				: this.chaseYaw;
		this.headRotation.setFromAxisAngle(HEAD_AXIS, yaw);
		return this.viewRotation.copy(this.orientation).multiply(this.headRotation);
	}

	private updateCockpit() {
		this.updateEtaEstimate();
		if (this.view !== "cockpit") {
			this.liveCockpit.setVisible(false);
			return;
		}
		const target = this.targetBody();
		const targetKm = target ? length(sub(target.pos, this.world.ship.pos)) : 0;
		const velocity = this.velocityReadout();
		this.refreshScannerContacts();
		this.updateHologramContacts(this.scannerContacts);
		this.updateInstruments(target, targetKm, velocity);
		this.liveCockpit.update({
			visible: true,
			dockPhase: this.dock.phase,
			headLook: this.headLook,
			leftTab: this.leftTab,
			rightTab: this.rightTab,
			navRows: this.navRows(),
			navFilter: this.navFilter,
			systemName: this.world.system.record.name,
			contacts: this.scannerContacts,
			targetId: target?.id ?? null,
			targetName: target?.name ?? null,
			target: target
				? `${target.name} · ${range(targetKm)}`
				: "NO TARGET SELECTED",
			targetBearingDeg: target
				? targetArrowBearingDeg(
						this.world.ship.pos,
						target.pos,
						this.orientation,
					)
				: null,
			mode: this.regime === "cruise" ? "CRUISE" : "NORMAL FLIGHT",
			throttle: `${(this.throttle * 100).toFixed(0)}%`,
			speed: velocity.speed,
			// The floor strip's own words, so the console and the floor cannot
			// describe the same two facts differently.
			assist: floorCellValue(this.floorCells(), "ASSIST"),
			charge: floorCellValue(this.floorCells(), "CHARGE"),
			tuning: this.tuningSummary(),
			stationConsole: this.stationConsoleState(),
		});
	}

	/**
	 * The forward console is a view of the docked station, not a second market.
	 *
	 * `station-console.ts` owns every commodity/equipment rule; this method only
	 * joins the live dock session to the station record and world clock. Market
	 * Deficits come from the current galaxy's persistent envelope, and commander
	 * state comes from the one Game instance that can apply an accepted action.
	 */
	private stationConsoleState() {
		const context = this.dockedStationContext();
		if (!context) {
			this.stationConsoleCache = null;
			this.stationConsoleCacheKey = null;
			return null;
		}
		const { station, market, envelope, stationKey, economy, gameTimeMin } =
			context;
		const key = `${this.dock.stationId}|${this.stationConsoleTab}|${this.stationConsoleRevision}`;
		if (this.stationConsoleCacheKey === key) return this.stationConsoleCache;
		this.stationConsoleCacheKey = key;
		this.stationConsoleCache = {
			label: this.nameOfStation(station.id),
			tab: this.stationConsoleTab,
			market: stationMarketScreen({
				station: market,
				economy,
				gameTimeMin,
				deficitOf: (goodName) =>
					readDeficit(envelope.deficits, stationKey, goodName, gameTimeMin),
			}),
			equipment: stationEquipmentScreen({
				type: market.type,
				displayTL: this.world.system.record.displayTL,
			}),
			credits: this.commander.credits,
			cargo: Object.entries(this.commander.cargo)
				.filter(([, amount]) => amount > 0)
				.map(([name, amount]) => `${name} ${amount}`),
			ownedEquipment: this.commander.ownedEquipment,
			revision: this.stationConsoleRevision,
		};
		return this.stationConsoleCache;
	}

	/** Applies a complete commerce result or leaves both owner states untouched. */
	private transactStation(action: StationAction) {
		const context = this.dockedStationContext();
		if (!context) return;
		const { market, envelope, stationKey, galaxyIndex, economy, gameTimeMin } =
			context;
		const result = transactAtStation({
			commander: this.commander,
			deficits: envelope.deficits,
			station: market,
			stationKey,
			economy,
			gameTimeMin,
			displayTL: this.world.system.record.displayTL,
			action,
		});
		if (!result.accepted) return;
		this.commander = result.commander;
		this.commerceWorld = {
			...this.commerceWorld,
			gameTime: this.world.gameTime / 60,
			galaxies: this.commerceWorld.galaxies.map((current, index) =>
				index === galaxyIndex
					? { ...current, deficits: result.deficits }
					: current,
			),
		};
		this.stationConsoleRevision += 1;
		this.updateCockpit();
	}

	/** Resolves the live dock session once for rendering and commerce actions. */
	private dockedStationContext() {
		if (this.dock.phase !== "docked" || !this.dock.stationId) return null;
		const station = stationOf(this.world.system, this.dock.stationId);
		const galaxyIndex = this.world.system.record.galaxy;
		return {
			station,
			market: marketStationOf(station, this.world.seed),
			envelope: this.commerceWorld.galaxies[galaxyIndex],
			stationKey: carrierKey(
				this.world.system.record.index,
				station.localCarrierId,
			),
			galaxyIndex,
			economy: this.world.system.record.economy,
			gameTimeMin: this.world.gameTime / 60,
		};
	}

	/**
	 * The Navigation console's target list.
	 *
	 * Empty unless the panel is actually showing it. `timeToBody` integrates the
	 * cruise law per row, and paying for a list nobody is looking at would put
	 * that integration on every frame of normal flight — the panel is a view of
	 * the world, not a reason to compute one.
	 */
	private navRows(): NavRow[] {
		if (this.headLook !== "left" || this.leftTab !== "Navigation") return [];
		// The estimates refresh on `ETA_INTERVAL_S`, the same cadence the HUD's
		// single-target readout uses, and the ranges beside them refresh every
		// frame. Two rates on one row is deliberate: the range is a subtraction
		// and the estimate is an integration, and re-integrating a dozen legs
		// sixty times a second to redraw the same rounded minutes is the cost
		// this cache exists to refuse.
		const stale = this.world.gameTime - this.navEtaAt >= ETA_INTERVAL_S;
		if (stale) {
			this.navEtaCache.clear();
			this.navEtaAt = this.world.gameTime;
		}
		return projectNavTargets(
			this.world.ship.pos,
			// **`selectable()`, not `system.bodies`.** It is the one list that
			// decides what can be targeted at all — `cycleTarget` walks it and
			// `onSelectTarget` validates against it — so the list shows exactly
			// what a click on it can do. Handing the projection every body and
			// letting it hold its own kind rule would be a second owner, and the
			// day a body kind is added the two answers diverge silently.
			this.selectable(),
			this.targetId,
			{
				filter: this.navFilter,
				etaFor: ({ id }) => {
					const cached = this.navEtaCache.get(id);
					if (cached !== undefined) return cached;
					const body = this.world.system.byId.get(id);
					const eta = body ? this.timeToBody(body) : null;
					this.navEtaCache.set(id, eta);
					return eta;
				},
			},
		);
	}

	private refreshScannerContacts() {
		projectScannerContacts(
			this.world.ship.pos,
			this.world.system.bodies,
			this.targetId,
			{ orientation: this.orientation, output: this.scannerContactBuffer },
		);
	}

	private tuningSummary() {
		const p = this.cruiseParams;
		const key = `${p.vMaxKms}|${p.exponent}|${p.dropRadiusKm}|${p.dropSpeedKms}|${p.vicinityKm}|${p.approachLeadS}`;
		if (key !== this.tuningKey) {
			this.tuningKey = key;
			this.tuningText = `v_max ${(p.vMaxKms / C_KMS).toFixed(0)} c · exponent ${p.exponent.toFixed(2)} · drop ${p.dropRadiusKm} km · drop speed ${p.dropSpeedKms.toFixed(1)} km/s · vicinity ${range(p.vicinityKm)} · lead ${p.approachLeadS}s`;
		}
		return this.tuningText;
	}

	private updateHud() {
		this.updateEtaEstimate();
		if (!this.hud) return;
		const { ship, system, gameTime } = this.world;

		// The nearest-station scan runs every frame — the key depends on it, so it
		// cannot be gated. What the gate skips is the string composition and the
		// DOM write: six template literals, `clock()`'s `padStart`, and the
		// `textContent` assignment, which invalidates style and layout whether or
		// not the text differs. Every displayed field changes at human speed, so at
		// 60 fps that work lands about once in sixty frames instead of every one.
		let nearest: { id: string; km: number } | null = null;
		for (const b of system.bodies) {
			if (b.kind !== "station") continue;
			const km = length(sub(b.pos, ship.pos));
			if (!nearest || km < nearest.km) nearest = { id: b.id, km };
		}
		// Each displayed value computed **once** and used in both the key and the
		// text. Two spellings of the same quantised number have to stay in step or
		// the cache skips a frame whose text really did change, and nothing would
		// report that — the readout would simply lag by an arbitrary number of
		// frames.
		const speed = length(ship.vel).toFixed(3);
		const throttle = (this.throttle * 100).toFixed(0);
		const station = nearest
			? `${nearest.id} ${range(nearest.km)}`
			: "no station in system";

		// §5.1's panel: selected target, distance, time-to-target, speed in
		// multiples of c, and the drop-out. Quantised into the key at the
		// resolution it is displayed at, so the gate never skips a frame whose
		// text really did change.
		const target = this.targetBody();
		const targetKm = target ? length(sub(target.pos, ship.pos)) : null;
		const eta = this.etaCache;
		const p = this.cruiseParams;
		const state =
			this.spoolLeftS > 0
				? `SPOOLING ${this.spoolLeftS.toFixed(1)}s`
				: this.regime === "cruise"
					? "CRUISE"
					: "normal flight";
		const speedText =
			this.regime === "cruise"
				? `${(this.cruiseSpeedKms / C_KMS).toFixed(2)} c`
				: `${speed} km/s`;
		// Closing speed, not absolute — the panel's job is to answer "will I
		// arrive", and against a station carried around its star at ~30 km/s the
		// absolute figure cannot. This readout is a finding of the prototype
		// rather than something §5.1 asked for.
		const closing =
			this.regime === "cruise" && target
				? `closing ${this.closingKms < 10 ? this.closingKms.toFixed(2) : this.closingKms.toFixed(0)} km/s`
				: "";
		const r = system.record;
		// Built **first**, and the change-key derived from them. The key used to be
		// a hand-written mirror of these lines — a field added to one and not the
		// other freezes on screen, and the eta field did exactly that: the key held
		// `Math.round(eta)` while the line rendered "<1", so the last second of
		// every approach never redrew. Deriving it cannot drift.
		const lines = [
			[
				`${r.name}  TL ${r.displayTL}  ${GOVERNMENT_NAMES[r.government]}`,
				`t+${clock(gameTime)}`,
				`${this.view}  assist ${this.assist ? "on" : "off"}`,
				`throttle ${throttle}%`,
				speedText,
				station,
				`seed ${this.world.seed}`,
			].join("   "),
			[
				state,
				`target ${this.targetId ?? "none"}`,
				targetKm === null ? "" : range(targetKm),
				eta === null ? "eta —" : `eta ${duration(eta)}`,
				closing,
				`charge ${this.chargeAu.toFixed(1)}/${CHARGE_CAPACITY_AU} AU`,
				// The prompt. A prototype whose central mechanic is a keypress the
				// player has not discovered is a prototype that measures the wrong
				// thing — the first session was flown entirely in normal flight.
				this.cruisePrompt(targetKm),
				this.lastLegS === null ? "" : `last leg ${this.lastLegS.toFixed(1)}s`,
				this.lastExit,
			]
				.filter(Boolean)
				.join("   "),
			// The dials, always on screen. A tuning session where the current
			// setting is not visible produces judgements that cannot be written
			// down afterwards, which is the one thing this node has to deliver.
			[
				`v_max ${(p.vMaxKms / C_KMS).toFixed(0)} c [-/=]`,
				`exp ${p.exponent.toFixed(2)} [ [ / ] ]`,
				`drop ${p.dropRadiusKm} km [;/']`,
				`below ${p.dropSpeedKms} km/s [,/.]`,
				`vicinity ${range(p.vicinityKm)} [n/m]`,
				`lead ${p.approachLeadS}s [k/l]`,
			].join("   "),
		];
		// The clock is quantised into the key separately because it is *not* on
		// the first line at full resolution — `clock()` prints whole seconds, and
		// without this the gate would compare a string that changes 60 times a
		// second against itself.
		const key = `${Math.floor(gameTime)}|${lines.join("|")}`;
		if (key === this.hudKey) return;
		this.hudKey = key;
		this.hud.textContent = lines.join("\n");
	}

	/**
	 * §5's persistent mode/throttle/assist/charge strip, along the bottom of the
	 * glass.
	 *
	 * **On the glass rather than on the deck, and that is the whole design
	 * decision.** The deck's only clear band is the 2.3 mm lip outside the
	 * scanner bezel, which at the shipped dashboard pitch is a foreshortened
	 * sliver — and #94 is the recorded case of a geometrically-honest
	 * cockpit instrument being unreadable and having to be rebuilt as a
	 * compressed on-glass one. The floor is the persistent instrument *set*,
	 * not a single surface: §5's attitude and prograde markers are already
	 * here, and this joins them.
	 *
	 * Centred and sized to its content rather than spread across the full
	 * width: four cells stretched over 1440 px is a row of unrelated numbers,
	 * and the prompt and the clearance line it sits under are centred too.
	 */
	/**
	 * §5's four readings, from the ship as it is now.
	 *
	 * **One builder, because two surfaces show these.** The floor strip draws
	 * all four; the right console's Flight and Drive rows show assist and
	 * charge, and those rows shipped as labels with an empty value beside them.
	 * Wiring them from a second expression is how the console comes to say
	 * "ON" while the floor says something else about the same toggle.
	 */
	floorCells(): FloorCell[] {
		return flightFloorCells({
			regime: this.regime,
			spoolLeftS: this.spoolLeftS,
			throttle: this.throttle,
			assist: this.assist,
			chargeAu: this.chargeAu,
			chargeCapacityAu: CHARGE_CAPACITY_AU,
			chargeRegenAuPerS: CHARGE_REGEN_AU_PER_S,
		});
	}

	private drawFlightFloor(ctx: CanvasRenderingContext2D, w: number, h: number) {
		const cells = this.floorCells();

		// **Fitted to the widest reading the strip can take, not to this one.**
		// Sized to the live values it re-centred whenever a digit changed, and
		// the fit taken on a full tank — where the regeneration suffix is
		// absent — was a fifth too narrow for the run drawn a second later. At
		// 390 px that clipped both ends, and the check measuring the incidental
		// run passed.
		const available = w - 2 * FLOOR_MARGIN_PX;
		if (this.floorFit?.width !== w) {
			// **Solved rather than searched.** The step-down loop ran up to
			// nineteen full measurements on every distinct canvas width, and a
			// resize drag missed on every frame and appended to a map nothing
			// evicted. Text width is very nearly linear in the type size, so one
			// measurement gives the ratio; the second confirms it, and the
			// residue is recorded rather than drawn over.
			// The handle's own copy, not a second derivation with the same
			// arguments — a third parameter would otherwise have to be threaded
			// to two call sites that must agree.
			const widestCells = FLIGHT_FLOOR_LABELS.map((label) => ({
				label,
				value: this.floorWidest[label],
			}));
			const atOne = floorRunWidths(ctx, widestCells, 1).total;
			const solved = Math.max(
				FLOOR_MIN_SCALE,
				Math.min(1, available / Math.max(1, atOne)),
			);
			// Rounded down to a step so a one-pixel viewport change does not
			// re-lay the strip out at an imperceptibly different size.
			const stepped = Math.max(FLOOR_MIN_SCALE, Math.floor(solved * 50) / 50);
			const fitted = floorRunWidths(ctx, widestCells, stepped).total;
			this.floorFit = {
				width: w,
				scale: stepped,
				// **The clamp fails open, and says so.** `FLOOR_MIN_SCALE` is a
				// floor on legibility, so a viewport too narrow for the widest
				// run at that size draws anyway — the alternative is a floor
				// instrument that vanishes. What it must not do is fail open
				// *silently*: the overflow is recorded, and the browser check
				// requires it to be zero at every shipped viewport.
				overflowPx: Math.max(0, fitted - available),
			};
		}
		const { scale } = this.floorFit;
		const labelFont = floorFont(FLOOR_LABEL_FRACTION, scale);
		const valueFont = floorFont(FLOOR_VALUE_FRACTION, scale);
		const labelGap = FLOOR_LABEL_GAP_PX * scale;
		const cellGap = FLOOR_CELL_GAP_PX * scale;
		const { widths, labelWidths, total } = floorRunWidths(ctx, cells, scale);

		const glassBottomY = h * GLASS_BOTTOM_FRACTION;
		const baselineY =
			glassBottomY - FLOOR_STRIP_HEIGHT_PX * FLOOR_BASELINE_FRACTION;
		let x = (w - total) / 2;
		const boxes: { label: string; x: number; y: number; width: number }[] = [];
		ctx.save();
		ctx.textAlign = "left";
		for (const [i, cell] of cells.entries()) {
			boxes.push({ label: cell.label, x, y: baselineY, width: widths[i] });
			ctx.font = labelFont;
			ctx.fillStyle = FLOOR_LABEL_FILL;
			ctx.fillText(cell.label, x, baselineY);
			ctx.font = valueFont;
			ctx.fillStyle = FLOOR_TONE_FILL[cell.tone];
			// The label width comes from the measuring pass rather than a second
			// `measureText` here — four labels re-measured every frame for a
			// value that changes only with the viewport.
			ctx.fillText(cell.value, x + labelWidths[i] + labelGap, baselineY);
			x += widths[i] + cellGap;
		}
		ctx.restore();

		this.floorRender = {
			cells,
			boxes,
			baselineY,
			glassBottomY,
			scale,
			marginPx: FLOOR_MARGIN_PX,
			overflowPx: this.floorFit.overflowPx,
			// The scalars the cells were built from, stamped by the draw — so a
			// check can compare the instrument against the ship without
			// restating the projection that maps one to the other.
			source: {
				regime: this.regime,
				spoolLeftS: this.spoolLeftS,
				throttle: this.throttle,
				assist: this.assist,
				chargeAu: this.chargeAu,
			},
		};
	}

	/**
	 * Where a sim-space direction lands, in normalised device coordinates.
	 *
	 * The renderer's one call into `hud.ts`, public so a probe can compare it
	 * against Three.js's own projection of the mesh it is supposed to sit on —
	 * two independent routes to the same pixel, which is the only way to catch a
	 * marker that is internally consistent and still in the wrong place.
	 */
	markerNdc(dir: Vec3) {
		return projectDirection(
			dir,
			this.orientation,
			(this.nearCamera.fov * Math.PI) / 180,
			this.nearCamera.aspect,
		);
	}

	/**
	 * §3's docking director, on the glass.
	 *
	 * **The funnel is centred on the optical axis, not on the station**, and that
	 * is what makes it exact rather than approximate. Check 2's nose half is the
	 * angle between the nose and the inward docking axis; the nose is the screen
	 * centre by construction, so a ring of angular radius `AXIS_TOLERANCE_DEG`
	 * about the centre maps to `tan(θ)/tan(fov/2)` in NDC with no small-angle
	 * assumption, and "the axis marker is inside the ring" is check 2's nose half
	 * and nothing else. A ring drawn *around the station* would have been a conic
	 * section flattened into a circle, and would have read wrong exactly where
	 * the pilot needs it — off to one side, early in the turn.
	 *
	 * The position half cannot be flown with the nose: it is where the ship *is*,
	 * not where it points, so it reads as a corridor bar rather than a second
	 * ring. Two rings would have said the pilot could fix both by turning.
	 */
	private drawDockingDirector(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		camPos: Vec3,
	) {
		const state = this.directorState();
		if (!state) {
			this.directorRender = null;
			return;
		}
		ctx.save();
		// **Clipped to the canopy, for the reason the laser tracer is.** The lower
		// third of the frame is physical cockpit hardware — the dash deck, the
		// scanner well, the console housings — and the director is glass. The
		// first build had no clip and drew its rings straight down over the radar.
		ctx.beginPath();
		ctx.rect(0, 0, w, h * GLASS_BOTTOM_FRACTION);
		ctx.clip();

		const cx = w / 2;
		const cy = h / 2;
		const place = (dir: Vec3) => {
			const m = this.markerNdc(dir);
			if (m.behind) return null;
			return {
				x: (m.ndcX * 0.5 + 0.5) * w,
				y: (1 - (m.ndcY * 0.5 + 0.5)) * h,
			};
		};

		// ---------------------------------------------------------------------
		// The corridor. World geometry, projected — see `docking-tunnel.ts`.
		// ---------------------------------------------------------------------
		// **Cool, and not the cue's colour.** §4 gives cyan to "passive
		// instrumentation and stable reference" and reserves amber and green for
		// the actionable prompt and the confirmed state. The corridor is the
		// reference the pilot flies against; painting it in the cue's own green
		// made the two read as one instrument and lost the ring inside the rails.
		// Red still wins, because §4 puts blocking danger above everything.
		const tunnelColour = state.blocking
			? "rgba(255, 110, 96, 0.5)"
			: "rgba(120, 205, 245, 0.4)";
		let tunnelRingsDrawn = 0;
		let throatCornersPx: DirectorRender["throatCornersPx"] = null;
		const projectedRings: ({ x: number; y: number } | null)[][] = [];
		for (const ring of state.tunnel.rings) {
			const corners = ring.corners.map((corner) =>
				place(sub(add(state.stationPos, corner), camPos)),
			);
			projectedRings.push(corners);
			if (corners.some((corner) => corner === null)) continue;
			const points = corners as { x: number; y: number }[];
			if (ring === state.tunnel.throat) throatCornersPx = points;
			ctx.strokeStyle =
				ring === state.tunnel.throat ? throatColour(state) : tunnelColour;
			ctx.lineWidth = ring === state.tunnel.throat ? 2 : 1;
			ctx.beginPath();
			ctx.moveTo(points[3].x, points[3].y);
			for (const point of points) ctx.lineTo(point.x, point.y);
			ctx.stroke();
			tunnelRingsDrawn++;
		}
		// The four rails, so it reads as one tunnel rather than a stack of frames.
		ctx.strokeStyle = tunnelColour;
		ctx.lineWidth = 1;
		for (let corner = 0; corner < 4; corner++) {
			ctx.beginPath();
			let started = false;
			for (const ring of projectedRings) {
				const point = ring[corner];
				if (!point) {
					started = false;
					continue;
				}
				if (started) ctx.lineTo(point.x, point.y);
				else ctx.moveTo(point.x, point.y);
				started = true;
			}
			ctx.stroke();
		}

		// ---------------------------------------------------------------------
		// The nose cue. Glass, and on a compressed scale.
		// ---------------------------------------------------------------------
		//
		// **The ring is not a projection of the cone, and it cannot be.** At the
		// 60° field of view this game uses, check 2's 35° tolerance projects to
		// `tan(35°)/tan(30°)` — 1.21 times half the canvas height, a ring larger
		// than the screen it is drawn on. The first build drew it truthfully and
		// it read as arcs running off every edge. So the ring is a fixed size and
		// the marker's distance from centre is the error **as a fraction of the
		// tolerance**: at the rim the nose is exactly 35° off, wherever that
		// direction actually lies on the glass. The direction is true; the radius
		// is a gauge.
		const funnelRadiusPx = Math.max(54, Math.min(w, h) * 0.14);
		const funnelColour = state.blocking
			? "rgba(255, 110, 96, 0.85)"
			: state.axis.nose.within
				? "rgba(150, 255, 190, 0.8)"
				: "rgba(255, 209, 122, 0.75)";
		const funnelState: DirectorRender["funnelState"] = state.blocking
			? "blocked"
			: state.axis.nose.within
				? "clear"
				: "off-axis";
		ctx.strokeStyle = funnelColour;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(cx, cy, funnelRadiusPx, 0, Math.PI * 2);
		ctx.stroke();

		const inward = scale(state.axisOut, -1);
		const projected = this.markerNdc(inward);
		let axisMarker: DirectorRender["axisMarker"] = null;
		let markerOffScale = false;
		{
			// Behind the camera the projection has no on-glass direction, so the
			// marker is placed by the negated one and flagged: the pilot is facing
			// away from the slot, and a marker silently pinned to the rim would say
			// "nearly there".
			const sign = projected.behind ? -1 : 1;
			const dx = projected.ndcX * sign;
			const dy = projected.ndcY * sign;
			const norm = Math.hypot(dx, dy);
			const ux = norm === 0 ? 0 : dx / norm;
			const uy = norm === 0 ? -1 : -dy / norm;
			const fraction = state.axis.nose.deg / state.axis.nose.toleranceDeg;
			markerOffScale = projected.behind || fraction > MARKER_MAX_FRACTION;
			const radius = Math.min(fraction, MARKER_MAX_FRACTION) * funnelRadiusPx;
			const x = cx + ux * radius;
			const y = cy + uy * radius;
			axisMarker = { x, y };
			ctx.beginPath();
			ctx.moveTo(x, y - 7);
			ctx.lineTo(x + 7, y);
			ctx.lineTo(x, y + 7);
			ctx.lineTo(x - 7, y);
			ctx.closePath();
			ctx.stroke();
		}

		// The nose itself, so the gauge has a datum to be read against.
		ctx.beginPath();
		ctx.moveTo(cx - 5, cy);
		ctx.lineTo(cx + 5, cy);
		ctx.moveTo(cx, cy - 5);
		ctx.lineTo(cx, cy + 5);
		ctx.stroke();

		// §3: a positive state and the remaining window, or the refusal *with its
		// reason* — a red mark alone never carries the consequence.
		const clearanceText = state.blocking
			? state.blocking.text
			: state.grantRemainingS === null
				? "NO GRANT"
				: `CLEARED · ${duration(state.grantRemainingS)} left`;
		ctx.font = PROMPT_FONT;
		ctx.textAlign = "center";
		ctx.fillStyle = state.blocking
			? "rgba(255, 110, 96, 0.95)"
			: "rgba(150, 255, 190, 0.9)";
		// Anchored to the **glass**, not to the ring. Placed relative to the ring
		// it landed below the clip and was sliced in half by it — a refusal the
		// pilot could only half read, which is the one line §3 says must carry its
		// reason.
		// Above the strip, not 16 px off the glass bottom, which is inside it.
		// Derived from `FLOOR_STRIP_HEIGHT_PX` rather than restated, so raising
		// the strip cannot leave this line sitting on top of it.
		ctx.fillText(
			clearanceText,
			cx,
			h * GLASS_BOTTOM_FRACTION - FLOOR_STRIP_HEIGHT_PX - 16,
		);
		ctx.textAlign = "left";
		ctx.restore();

		this.directorRender = {
			state,
			centre: { x: cx, y: cy },
			funnelRadiusPx,
			axisMarker,
			markerOffScale,
			tunnelRingsDrawn,
			throatCornersPx,
			funnelState,
			clearanceText,
			blocking: state.blocking !== null,
		};
	}

	/**
	 * Draw the HUD markers over the rendered frame.
	 *
	 * The overlay is a 2D canvas rather than geometry in the near scene, and the
	 * reason is the layering: a marker drawn as a world object would have to pick
	 * a layer and a scale, and a reticle is neither near nor far — it is on the
	 * glass. `hud.ts` does the projection, which is why it can be checked without
	 * any of this.
	 *
	 * Everything is placed by **direction**, so a body draws its bracket in the
	 * same place whichever layer rendered it — see that module's docstring.
	 */
	private drawMarkers(camPos: Vec3) {
		const ctx = this.overlayCtx;
		if (!ctx) return;
		const w = this.overlay.width;
		const h = this.overlay.height;
		ctx.clearRect(0, 0, w, h);
		// §8 M4/M10: arrival and launch are scripted, and a docked ship is not
		// flyable. The forward station console owns the docked glass; no stale
		// flight-floor, scanner, director, or attitude marks may leak through it.
		if (this.view === "cockpit" && this.dock.phase !== "flying") {
			this.cockpitPrompt.reset();
			this.combatOverlayStatus.reset();
			this.combatOverlayLines = [];
			this.directorRender = null;
			this.floorRender = null;
			return;
		}
		// A focused console replaces the forward glass. Leaving target brackets
		// here would make an HTML panel look like an accidental overlay rather
		// than the deliberate head-turn view the cockpit contract calls for.
		if (this.view === "cockpit" && this.headLook !== "forward") {
			this.cockpitPrompt.reset();
			this.combatOverlayStatus.reset();
			this.combatOverlayLines = [];
			// The director is glass, and a focused console has replaced the glass.
			// Leaving either record standing would let a probe assert a funnel or
			// a strip that this frame deliberately did not paint.
			this.directorRender = null;
			this.floorRender = null;
			return;
		}
		const toPixels = (ndcX: number, ndcY: number) => ({
			x: (ndcX * 0.5 + 0.5) * w,
			y: (1 - (ndcY * 0.5 + 0.5)) * h,
		});
		const place = (dir: Vec3) => {
			const m = this.markerNdc(dir);
			return m.behind ? null : { ...toPixels(m.ndcX, m.ndcY), on: m.onScreen };
		};

		// The attitude reference: a short level line rolled to the system's
		// reference plane. Faint, because it is a background fact rather than
		// something to look at — but present, because in cockpit view there is no
		// hull left to read attitude off.
		const roll = horizonRoll(this.orientation, v3(0, 0, 1));
		if (roll !== null) {
			ctx.save();
			ctx.translate(w / 2, h / 2);
			ctx.rotate(roll);
			ctx.strokeStyle = "rgba(120, 190, 235, 0.28)";
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(-h * 0.16, 0);
			ctx.lineTo(-h * 0.05, 0);
			ctx.moveTo(h * 0.05, 0);
			ctx.lineTo(h * 0.16, 0);
			ctx.stroke();
			ctx.restore();
		}

		// The nose: where the ship points, which in cruise is also where it goes.
		ctx.strokeStyle = "rgba(200, 230, 255, 0.55)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(w / 2 - 7, h / 2);
		ctx.lineTo(w / 2 - 2, h / 2);
		ctx.moveTo(w / 2 + 2, h / 2);
		ctx.lineTo(w / 2 + 7, h / 2);
		ctx.moveTo(w / 2, h / 2 - 7);
		ctx.lineTo(w / 2, h / 2 - 2);
		ctx.stroke();

		// The Three line is spatial reference; this glass tracer is the readable
		// weapon feedback at every viewport. It shares the cockpit-view gate of
		// the 3D beam it represents.
		if (
			this.combatPrototypeEnabled &&
			this.view === "cockpit" &&
			this.combat.firing !== null &&
			!this.probeForceLaserHidden
		) {
			ctx.save();
			// The lower third is physical cockpit hardware. Clip the glass effect to
			// the windscreen rather than drawing a laser over an instrument panel.
			ctx.beginPath();
			ctx.rect(0, 0, w, h * GLASS_BOTTOM_FRACTION);
			ctx.clip();
			ctx.strokeStyle = "rgba(116, 234, 255, 0.98)";
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.moveTo(w * 0.24, h * 0.64);
			ctx.lineTo(w / 2, h * 0.46);
			ctx.moveTo(w * 0.76, h * 0.64);
			ctx.lineTo(w / 2, h * 0.46);
			ctx.stroke();
			ctx.restore();
		}

		// Prograde and retrograde — the map's HUD constraint, and the thing that
		// makes assist-off flyable at all: with the assist off the nose and the
		// velocity disagree permanently, and this is the only thing on screen that
		// says which way the ship is actually moving.
		const vel = prograde(this.world.ship.vel, PROGRADE_MIN_KMS);
		if (vel) {
			const fwd = place(vel);
			if (fwd?.on) {
				ctx.strokeStyle = "rgba(150, 255, 190, 0.85)";
				ctx.beginPath();
				ctx.arc(fwd.x, fwd.y, 6, 0, Math.PI * 2);
				ctx.moveTo(fwd.x - 10, fwd.y);
				ctx.lineTo(fwd.x - 6, fwd.y);
				ctx.moveTo(fwd.x + 6, fwd.y);
				ctx.lineTo(fwd.x + 10, fwd.y);
				ctx.moveTo(fwd.x, fwd.y - 10);
				ctx.lineTo(fwd.x, fwd.y - 6);
				ctx.stroke();
			}
			const back = place(scale(vel, -1));
			if (back?.on) {
				ctx.strokeStyle = "rgba(255, 160, 150, 0.7)";
				ctx.beginPath();
				ctx.arc(back.x, back.y, 6, 0, Math.PI * 2);
				ctx.moveTo(back.x - 4, back.y - 4);
				ctx.lineTo(back.x + 4, back.y + 4);
				ctx.moveTo(back.x + 4, back.y - 4);
				ctx.lineTo(back.x - 4, back.y + 4);
				ctx.stroke();
			}
		}

		this.drawDockingDirector(ctx, w, h, camPos);
		this.drawFlightFloor(ctx, w, h);

		// The prompt, on the glass rather than only in the corner: the mechanic it
		// names is the one the whole prototype is about, and the first flight of
		// this build was spent in normal flight watching a distance not change.
		const promptTarget = this.targetBody();
		const prompt = this.cruisePrompt(
			promptTarget ? length(sub(promptTarget.pos, camPos)) : null,
		);
		if (prompt) {
			const x = w / 2;
			const y = h * 0.62;
			ctx.font = PROMPT_FONT;
			ctx.textAlign = "center";
			ctx.fillStyle = PROMPT_FILL;
			ctx.fillText(prompt, x, y);
			const promptWidth = ctx.measureText(prompt).width;
			this.cockpitPrompt.setCenteredPrompt(prompt, x, y, promptWidth);
			ctx.textAlign = "left";
		} else {
			this.cockpitPrompt.reset();
		}
		if (this.combatPrototypeEnabled && this.view === "cockpit") {
			ctx.save();
			ctx.textAlign = "center";
			const drawnLines: { text: string; font: string; width: number }[] = [];
			const drawFitted = (
				text: string,
				y: number,
				fill: string,
				startSize: number,
				key: string,
				widest: string,
			) => {
				// The fit depends on the widest text for this line and the glass
				// width, not on the live digits, so cache the fitted font by key.
				const cacheKey = `${key}|${w}`;
				let fittedFont = this.combatStatusFit.get(cacheKey)?.font;
				if (!fittedFont) {
					ctx.font = `${startSize}px ui-monospace, monospace`;
					let size = startSize;
					while (size > 8 && ctx.measureText(widest).width > w - 16) {
						size -= 1;
						ctx.font = `${size}px ui-monospace, monospace`;
					}
					fittedFont = ctx.font;
					this.combatStatusFit.set(cacheKey, {
						font: fittedFont,
						worstWidth: ctx.measureText(widest).width,
					});
				}
				ctx.font = fittedFont;
				const width = ctx.measureText(text).width;
				drawnLines.push({ text, font: fittedFont, width });
				ctx.fillStyle = fill;
				ctx.fillText(text, w / 2, y);
				return fittedFont;
			};
			drawFitted(
				"COMBAT PROTOTYPE — hold SPACE pulse · S beam · / warning · Q ECM",
				h * 0.72,
				"rgba(255, 214, 120, 0.9)",
				12,
				"legend",
				"COMBAT PROTOTYPE — hold SPACE pulse · S beam · / warning · Q ECM",
			);
			drawFitted(
				`TARGET  SHIELDS F ${this.combat.targetForeShield.toFixed(0)}  A ${this.combat.targetAftShield.toFixed(0)}  HULL ${this.combat.targetHull.toFixed(0)}`,
				h * 0.76,
				"rgba(255, 115, 130, 0.95)",
				12,
				"target",
				"TARGET  SHIELDS F 999  A 999  HULL 999",
			);
			drawFitted(
				`PLAYER  SHIELDS F ${this.combat.foreShield.toFixed(0)}  A ${this.combat.aftShield.toFixed(0)}  HULL ${this.combat.playerHull.toFixed(0)}`,
				h * 0.8,
				"rgba(116, 234, 255, 0.95)",
				12,
				"player",
				"PLAYER  SHIELDS F 999  A 999  HULL 999",
			);
			const combatStatus =
				this.combat.playerHull <= 0
					? "DUEL LOST"
					: this.combat.targetHull <= 0
						? "DUEL WON"
						: `FIRE ${this.combat.heatLocked ? "LOCKED" : (this.combat.firing?.toUpperCase() ?? "SAFE")} · H ${this.combat.heat.toFixed(0)} E ${this.combat.energy.toFixed(0)} · LOCK ${this.combat.missileLock ? "READY" : "ACQ"} · MISSILE ${this.combat.incomingMissile ? "WARNING" : "CLEAR"} · INTD ${this.combat.interdiction ? "ACTIVE" : "CLEAR"}`;
			// The status line goes through the same fitter, keyed on its widest
			// text so any live state fits whatever the first frame displayed.
			const longestStatus =
				"FIRE LOCKED · H 100 E 100 · LOCK READY · MISSILE WARNING · INTD ACTIVE";
			const statusFont = drawFitted(
				combatStatus,
				h * 0.84,
				PROMPT_FILL,
				parseInt(PROMPT_FONT, 10),
				"status",
				longestStatus,
			);
			this.combatStatusWorstWidth =
				this.combatStatusFit.get(`status|${w}`)?.worstWidth ?? 0;
			const statusWidth = drawnLines.at(-1)!.width;
			this.combatOverlayStatus.setCenteredPrompt(
				combatStatus,
				w / 2,
				h * 0.84,
				statusWidth,
				statusFont,
			);
			this.combatOverlayLines = drawnLines;
			ctx.restore();
		} else {
			this.combatOverlayStatus.reset();
			this.combatOverlayLines = [];
		}

		// The selected target owns the amber sky marker. Green remains prograde,
		// and the other bodies stay cool blue navigation context.
		ctx.font = "11px ui-monospace, Menlo, monospace";
		for (const body of this.selectable()) {
			const dir = directionTo(camPos, body.pos);
			if (!dir) continue;
			const selected = body.id === this.targetId;
			const at = place(dir);
			if (at?.on) {
				const r = selected ? 14 : 7;
				ctx.strokeStyle = selected
					? "rgba(255, 214, 120, 0.95)"
					: "rgba(140, 190, 220, 0.4)";
				ctx.lineWidth = selected ? 1.5 : 1;
				if (selected) {
					ctx.beginPath();
					ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
					ctx.stroke();
					const km = length(sub(body.pos, camPos));
					ctx.fillStyle = "rgba(255, 214, 120, 0.95)";
					ctx.fillText(`${body.name}  ${range(km)}`, at.x + r + 6, at.y + 4);
					continue;
				}
				// Corner brackets rather than a box: a closed square over a distant
				// station hides the thing it is marking.
				for (const [sx, sy] of [
					[-1, -1],
					[1, -1],
					[-1, 1],
					[1, 1],
				]) {
					ctx.beginPath();
					ctx.moveTo(at.x + sx * r, at.y + sy * r - sy * (r * 0.45));
					ctx.lineTo(at.x + sx * r, at.y + sy * r);
					ctx.lineTo(at.x + sx * r - sx * (r * 0.45), at.y + sy * r);
					ctx.stroke();
				}
				if (body.kind === "station") {
					const km = length(sub(body.pos, camPos));
					ctx.fillStyle = "rgba(140, 190, 220, 0.55)";
					ctx.fillText(`${body.name}  ${range(km)}`, at.x + r + 6, at.y + 4);
				}
				continue;
			}
			if (!selected) continue;
			const edge = edgeOf(dir, this.orientation, EDGE_MARGIN);
			const p = toPixels(edge.ndcX, edge.ndcY);
			ctx.save();
			ctx.translate(p.x, p.y);
			ctx.rotate(-edge.angleRad);
			ctx.fillStyle = "rgba(255, 214, 120, 0.95)";
			ctx.beginPath();
			ctx.moveTo(11, 0);
			ctx.lineTo(-6, 6);
			ctx.lineTo(-6, -6);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
			ctx.fillStyle = "rgba(255, 214, 120, 0.8)";
			ctx.fillText(
				`${body.name}  ${((angleOffNose(dir, this.nose()) * 180) / Math.PI).toFixed(0)}° off`,
				Math.min(w - 120, Math.max(10, p.x - 48)),
				Math.min(h - 10, Math.max(20, p.y + 22)),
			);
		}
	}

	/** The overlay's backing store, in CSS pixels — not device pixels: the
	 *  markers are line work a fraction of a pixel wide, and drawing at the
	 *  device ratio without scaling the context would halve them on a retina
	 *  display. */
	private sizeOverlay() {
		this.overlay.width = window.innerWidth;
		this.overlay.height = window.innerHeight;
	}

	/**
	 * **The pixel ratio is re-applied here, and that is the fix for a real
	 * artefact rather than housekeeping.**
	 *
	 * `setPixelRatio` was called once, at construction, and the composer was
	 * never told a ratio at all. `EffectComposer` sizes its own targets from
	 * what it is given, so after any resize its render targets were CSS pixels
	 * while the renderer's drawing buffer was CSS pixels times the ratio. The
	 * two then disagree, and `UnrealBloomPass` — which samples a mip chain with
	 * texel offsets computed from its own resolution — reads outside its
	 * footprint.
	 *
	 * **The flicker's account lives here**, because four places were each
	 * claiming to be its cause.
	 *
	 * **All of it is one person's eye, and that is worth saying before the rest
	 * of it.** The artefact does not reproduce headlessly — 25 frames in chase
	 * view on a software rasteriser show only the terminator moving — so there
	 * is no recording, no before/after capture and no repeatable procedure
	 * here. Everything below is the principal reporting what he saw on his own
	 * machine, in a session on 2026-08-27, and none of it is stronger than
	 * that.
	 *
	 * What he reported: black rectangles, roughly one coarse bloom texel
	 * across, appearing and vanishing as the frame moves; the same on a build
	 * of `main` served alongside this branch, which is what places the artefact
	 * before this work rather than in it; gone when bloom is switched off,
	 * which is what points at bloom; and smaller but still present after the
	 * mip fix, which is the whole basis for saying that one helped.
	 *
	 * Two candidate inputs were found and both guarded — mip levels built from
	 * an odd start (`bloomResolution`) and non-finite fragment colours
	 * (`SANITISE_GLSL`). Neither is a diagnosis. Whether the second finishes it
	 * is unknown at the time of writing. Anyone reopening this should start by
	 * getting a capture, because the next person will otherwise inherit the
	 * same four unfalsifiable stories this comment replaced.
	 *
	 * The pixel-ratio re-application below is *not* one of those candidates. It
	 * was investigated as one and ruled out. The measurement: with a page opened
	 * at `deviceScaleFactor` 1 and again at 2, then resized,
	 * `renderer.getDrawingBufferSize()` and the composer's `renderTarget1` were
	 * read back and compared — 1000x640 against 1000x640, and 2000x1280 against
	 * 2000x1280, on this branch *and* on main. `EffectComposer.setSize` applies
	 * the ratio itself, so the mismatch this was going to fix does not exist.
	 * It is kept for the display-move case only, where `devicePixelRatio`
	 * changes and a value captured at construction is simply stale.
	 *
	 * Moving a window between displays is the case that bites hardest, because
	 * `devicePixelRatio` itself changes — a retina laptop at 2, an external
	 * panel at 1 — and the value captured at construction is then simply wrong.
	 * It is read again here rather than remembered.
	 */
	private onResize() {
		const w = window.innerWidth;
		const h = window.innerHeight;
		this.sizeOverlay();
		const ratio =
			Math.min(window.devicePixelRatio, 2) * this.settings.value.renderScale;
		this.renderer.setPixelRatio(ratio);
		this.composer.setPixelRatio(ratio);
		for (const cam of [
			this.backdropCamera,
			this.farCamera,
			this.approachCamera,
			this.nearCamera,
		]) {
			cam.aspect = w / h;
			cam.updateProjectionMatrix();
		}
		this.renderer.setSize(w, h);
		this.composer.setSize(w, h);
		// **After** the composer, not before. `EffectComposer.setSize` calls
		// `setSize` on every pass it holds, so bloom's own resolution has to be
		// re-applied afterwards or it is immediately overwritten with the full
		// drawing buffer — which is what the first version of this did, and the
		// mip chain went on being built at 451x321, 113x81, 57x41.
		const bloom = bloomResolution();
		this.bloomPass?.setSize(bloom.x, bloom.y);
		this.starMaterial.uniforms.uPixelScale.value =
			this.renderer.domElement.height * STAR_PIXEL_SCALE;
	}
}

/**
 * Draw E9's name onto a station's shields (**E10**).
 *
 * The pixels half of the split `station-mesh.ts` makes: that module is
 * headless-tested and contains no `document` reference, so it builds the quads
 * and this fills them. A `CanvasTexture` there would force the
 * `typeof document !== "undefined"` branch `station-visuals.ts` names as the
 * failure mode — the branch that ships to players would be the one no test ever
 * takes.
 *
 * One canvas shared by a station's two plates: they carry the same name, and
 * the mouth plate and the interior one are never seen at once.
 */
function paintNameplates(mesh: StationMesh, name: string) {
	const canvas = document.createElement("canvas");
	canvas.width = 1024;
	canvas.height = 256;
	const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
	ctx.fillStyle = "#05070a";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	// A lit sign against a dark plate: the same warm amber the aperture bars
	// around it use, so the shield reads as part of the docking face rather than
	// as a label pasted onto it.
	ctx.fillStyle = "#ffb347";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	// **Fitted, not a fixed size.** Digram names run from two to eight characters;
	// fitting still makes this safe if the vocabulary is widened later, and a fixed size cut long names
	// off mid-word — which is what a look at the frame showed, and what no
	// pixel-difference check would ever have reported: a clipped sign still
	// contributes exactly as much ink as a whole one.
	const text = name.toUpperCase();
	const margin = canvas.width * 0.06;
	let size = 132;
	ctx.font = `bold ${size}px monospace`;
	const width = ctx.measureText(text).width;
	if (width > canvas.width - margin * 2) {
		size = Math.floor((size * (canvas.width - margin * 2)) / width);
		ctx.font = `bold ${size}px monospace`;
	}
	ctx.fillText(text, canvas.width / 2, canvas.height / 2);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	for (const plate of mesh.nameplates) {
		const material = plate.material as THREE.MeshBasicMaterial;
		material.map = texture;
		// Built at zero so a station drawn before its texture arrives shows no
		// shield rather than a blank white one; this is where it lights up.
		material.opacity = 1;
		material.needsUpdate = true;
	}
}

/**
 * The size the bloom chain works at: half the window, quantised to a multiple
 * of 32, and independent of the device pixel ratio.
 *
 * **Divisible by 32, because the chain halves five times.** `UnrealBloomPass`
 * builds five mip levels by repeatedly halving its resolution. An odd width
 * rounds, so the blur of a level samples a footprint its target does not cover,
 * and
 * the outermost row or column of a coarse mip can be left holding whatever was
 * in that memory. On a coarse mip one texel is a large block of the screen —
 * which is the size and shape of the artefact the principal reported, and it
 * would depend on the window size, which is why it appeared on one display and
 * not the other.
 *
 * **Independent of the ratio, because bloom is a blur.** Running the chain over
 * four times as many pixels on a retina panel buys nothing visible: the result
 * is a wide, soft glow either way. This is the one pass where resolution is
 * close to free to give up.
 *
 * That is about the chain's *own* size and says nothing about its input. The
 * resolution setting shrinks the frame bloom reads, and the principal observed
 * the cockpit's glow thinning as it does — fine highlights are averaged away
 * before they can pass the brightness threshold, so fewer of them bloom at all.
 * The two are not in tension: this pass is cheap to shrink, and what it is
 * given still matters. `settings.ts` tells the player the second half, which is
 * the half they can see.
 *
 * Both of those are claims about a machine I cannot see. And the saving is not
 * certain either, which an earlier version of this said it was: switching bloom
 * off entirely moved terran by nothing measurable, so quartering its pixel
 * count cannot be relied on to move it more. The measurement that would settle
 * that was never taken. What *is* established is that the artefact is bloom's,
 * because switching bloom off removes it, and that a whole mip chain is the
 * right shape whether or not it is faster.
 */
function bloomResolution() {
	// A multiple of 32, not merely even: the chain halves five times, so only a
	// starting size divisible by 2^5 keeps every level whole. Rounding to even
	// was the first attempt and left 225, 113, 57, 29, 15 across the widths.
	const quantised = (n: number) => Math.max(32, Math.round(n / 32) * 32);
	return new THREE.Vector2(
		quantised(window.innerWidth / 2),
		quantised(window.innerHeight / 2),
	);
}

/** Clamp a signed value to ±`limit` — the mouse's per-frame guard. */
const clampAbs = (v: number, limit: number): number =>
	Math.min(limit, Math.max(-limit, v));

/** Sim seconds as `h:mm:ss`. The clock is authoritative for body positions
 *  (spec §7.3), so it is worth being able to read it off the screen. */
function clock(seconds: number): string {
	const s = Math.floor(seconds);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/**
 * The world seed: `?seed=` if it is usable, a random one otherwise.
 *
 * The emptiness test cannot be dropped in favour of `Number()` alone:
 * `Number("")` and `Number("   ")` are both 0, so `?seed=` would pin world 0
 * rather than reject the request.
 */
function seedFromQuery(): number {
	const raw = new URLSearchParams(window.location.search).get("seed");
	if (raw !== null) {
		const pinned = Number(raw);
		if (raw.trim() !== "" && Number.isFinite(pinned)) {
			return Math.abs(Math.trunc(pinned)) >>> 0;
		}
		console.warn(`[seelite] ignoring unusable ?seed=${JSON.stringify(raw)}`);
	}
	return (Math.random() * 0x1_0000_0000) >>> 0;
}

// Any family the workbench knows — `ship` (#35) or `station` (#56). The gate
// is presence rather than a name comparison, so adding a third family is one
// edit in `model-viewer.ts` rather than two files' worth; the workbench itself
// mounts nothing for a name it does not recognise.
// A frame-rate readout, on `?fps` and on nothing else — `fps-meter.ts` carries
// the reason it is gated. It mounts before whichever surface is about to be
// built, because what it measures is the page's frame loop rather than any one
// of them.
// One parse for every gate below, rather than one per instrument: the boot
// surface was building a fresh `URLSearchParams` three times in as many
// branches.
const query = new URLSearchParams(window.location.search);

if (query.has("fps")) {
	const { mountFpsMeter } = await import("./fps-meter");
	mountFpsMeter();
}

if (query.has("model-viewer")) {
	const { mountModelViewer } = await import("./model-viewer");
	mountModelViewer();
	// The workbench owns an isolated render loop, so no live simulation is built
	// behind it. It is a visual asset tool rather than a second game mode.
} else if (query.has("hud-gallery")) {
	const { mountStateGallery } = await import("./state-gallery");
	mountStateGallery();
	// The gallery owns its own Three.js scene. Do not build the live game behind
	// it: that would leave two hidden render loops spending CPU and GPU.
} else if (query.has("galaxy-map")) {
	// #11's chart workbench. Its own scene, like every other surface in this
	// chain, and no live game behind it: the map draws a generated galaxy from
	// `galaxy.ts` directly and needs no simulation at all.
	const { mountGalaxyMap } = await import("./galaxy-map");
	mountGalaxyMap();
} else if (query.has("planet-prototype")) {
	// After `hud-gallery`, not before it: this branch is a disposable study, and
	// a disposable route should not outrank a durable one when both flags are on
	// the URL. Same reason it owns its own scene — no live game behind it.
	const { mountPlanetPrototype } = await import("./planet-prototype");
	mountPlanetPrototype();
} else {
	const game = new Game(seedFromQuery());
	// The handle probes and the browser console reach the game through. Everything
	// a probe needs to assert on has to be reachable from here, or the probe ends
	// up asserting on pixels for want of a number.
	(window as unknown as { __seelite: Game }).__seelite = game;

	// `?perf` mounts the cost-attribution panel — live switches for bloom, the
	// two shells, the surface shader and the crater path, so a body can be flown
	// to once and the terms toggled in place rather than compared across two
	// reloads from two positions.
	//
	// Here rather than beside the other query gates above, and that is not
	// tidiness: the panel walks the game's scenes, so it has to be mounted after
	// the game exists. Gated first, so nothing is imported when it is not asked
	// for.
	// The settings screen is a player-facing feature, so it is not gated.
	import("./settings-panel").then(({ mountSettingsPanel }) =>
		mountSettingsPanel(game.settings, () => game.releaseHeldKeys()),
	);

	if (query.has("perf"))
		import("./perf-panel").then(({ mountPerfPanel }) =>
			mountPerfPanel({
				scenes: [game.nearScene, game.approachScene, game.farScene],
				bloom: game.bloom,
			}),
		);
}

export type { Game };
