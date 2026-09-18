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
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import { starField } from "./backdrop";
import {
	SeeliteOutputPass,
	VIGNETTE_MAX,
	composerTarget,
	grantedSamples,
	setComposerSamples,
} from "./output-stage";
import {
	EXPOSURE,
	LIGHT_RIG,
	envRotation,
	equirectEnvironment,
} from "./light-rig";
import {
	CLOSED_GATE,
	enclosureRad,
	OCCLUSION,
	type OcclusionGate,
	SHADOW_MAP_TEXELS,
	type ShadowSubject,
	shadowBox,
	shadowFit,
	stepOcclusionGate,
} from "./occlusion";
import {
	hideNonOccluders,
	markOcclusion,
	restoreVisibility,
	subjectOf,
} from "./occlusion-mesh";
import { SettingsStore } from "./settings";
/**
 * Static, unlike `frame-attribution` below.
 *
 * The controller is a few hundred bytes of arithmetic with no Three.js and no
 * WebGL, and the settings row that switches it on has to be answerable on the
 * frame it is read. The sampler stays dynamic because *it* is the thing #223's
 * item 6 keeps off the default route.
 */
import {
	type AdaptiveDiagnostics,
	AdaptiveResolution,
	displaySignature,
	nearestRung,
	RENDER_SCALE_LADDER,
} from "./adaptive-resolution";
import type {
	FrameAttribution,
	FrameAttributionMode,
	FrameAttributionSnapshot,
} from "./frame-attribution";
import { AudioFX } from "./audio";
import { CombatPrototypeRig } from "./combat-rig";
import {
	COURSE_CUE_LABEL,
	FLIGHT_FLOOR_LABELS,
	SCANNER_RANGE_KM,
	type CourseCue,
	chargeReadsEmpty,
	courseCue,
	courseCueWidest,
	jumpRefusalText,
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
	type Mass,
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
import {
	beginCruiseGuidance,
	stepCruiseGuidance,
	type CruiseGuidanceState,
} from "./cruise-guidance";
import { GOVERNMENT_NAMES, JUMP_RANGE_LY, type SystemRecord } from "./galaxy";
import { type Course, courseProgress, setCourse } from "./galaxy-route";
// The pad, normalised. What any of it *means* is `pollPad` and the panel
// routing below, and nowhere else — that module was copied in from seekolous
// and must not learn what a station is.
import { GamepadSource, type PadFrame } from "./gamepad";
import {
	type PadContext,
	type PadIntents,
	contextFliesShip,
	padFireHeld,
	padFlightAxes,
	padIntents,
	pointerLockMove,
} from "./pad-bindings";
import type { PerfPanelHandle } from "./perf-panel";
import type { SettingsPanelHandle } from "./settings-panel";
import {
	JUMP_CHARGE_S,
	JUMP_TANK_LY,
	type JumpCharge,
	type JumpRefusal,
	beginCharge,
	cancelCharge,
	charging,
	idleCharge,
	planJump,
	stepCharge,
} from "./hyperspace";
import {
	type MarkerLabelBounds,
	MarkerLabelDeclutter,
	angleOffNose,
	directionTo,
	duration,
	edgeOf,
	horizonRoll,
	prograde,
	projectDirection,
} from "./hud";
import {
	ASSIST_CAP_KMS,
	type Angular,
	type FlightPerformance,
	flightPerformance,
	type Body,
	type FlightControl,
	type System,
	type World,
	advanceWorldClock,
	bodyAccelerationBound,
	bodyVelocity,
	stationHostIdOf,
	jumpWorldTo,
	makeSystem,
	makeWorld,
	restoreWorld,
	canResetWorldToStart,
	resetWorldToStart,
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
import { type ReliefPath, RELIEF_PATHS } from "./planet-shaders";
import {
	BAKE_FACE_SIZES,
	type SurfacePath,
	bakeFacePxFor,
	focalPx,
	projectedRadiusPx,
	surfacePathFor,
} from "./relief-bands";

import { SPIN_RPM_RANGE, STATION_GEOMETRY } from "./station";
import { PROMPT_FILL, PROMPT_FONT, TextRaster } from "./text-raster";
import {
	type ApertureFrame,
	type Clearance,
	type DockingState,
	type EntryOutcome,
	type EntryPose,
	TRAVERSAL_SECONDS_DEEP,
	TRAVERSAL_SECONDS_NEAR,
	AXIS_TOLERANCE_DEG,
	DOCKING_COMPUTER,
	frameAtPhase,
	ROLL_TOLERANCE_DEG,
	VICINITY_KM,
	V_GATE_KMS,
	apertureFrame,
	attemptEntry,
	dockingComputerStep,
	grantLive,
	newDockingState,
	orthonormalise,
	planeCrossing,
	releaseBerth,
	requestClearance,
	slewToward,
	slotBasis,
	tickDocking,
	type ComputerPhase,
	offAxisKm,
} from "./docking";
import {
	type ShieldSide,
	type ShipCondition,
	applyDamage,
	fullCondition,
	headOnPool,
	isAlive,
	sideStruck,
	stepCondition,
} from "./ship-condition";
import { type DuelPilot, type PlayerShot, raiderInSights } from "./duel";
import {
	type Engagement,
	chargedOffence,
	engage,
	fliesItsRoute,
	flownVoyageOrdinal,
	flyingTrafficActors,
	parkedTrafficActors,
	stepEngagement,
	trafficDiversion,
	trafficInSights,
	trafficKillTransitions,
	trafficPresence,
} from "./traffic-engagement";
import { carrierName } from "./carrier-name";
import {
	type CarrierStanding,
	carrierInstanceSeed,
	carrierStanding,
} from "./carrier-standing";
import { DOMAIN } from "./domains";
import { carrierManifest } from "./carrier-manifest";
import {
	type CarrierReading,
	type ScanConsoleReadout,
	type ScanHold,
	type ScanSubject,
	SCAN_CHARGE_S,
	SCAN_RANGE_KM,
	beginScanHold,
	carrierReading,
	scanCompleted,
	scanConeHeld,
	scanFitted,
	scanInRange,
	scanProgress,
	scanStandoff,
	scanRefusal,
	stepScanHold,
} from "./carrier-scan";
import {
	type Offence,
	heatAt,
	legalStandingAt,
	marginalOffenceHeat,
	withOffence,
} from "./legal";
import {
	DUEL_ROW_LABELS,
	duelConsoleReadout,
	duelRowCells,
	duelRowWidest,
	onTargetMark,
	raiderCueTone,
	targetConditionLine,
	showDuelRow,
} from "./duel-hud";
import {
	type GunFeedback,
	QUIET_GUN,
	SHOT_SOUND_GAP_S,
	STRUCK_FLASH_S,
	drawScoopNotice,
	drawEnemyBeam,
	drawStruckRim,
	TRACER_AIM,
	TRACER_HOLD_S,
	TRACER_PORTS,
	drawGunTracer,
	stepGunFeedback,
} from "./gun-feedback";
import {
	GIMBAL_CONE_RAD,
	angleBetween,
	clampToCone,
	stepGimbal,
} from "./gimbal";
import { formatRaiderLogLine, newestFirst, raiderLog } from "./raider-log";
import {
	RELAY_HIT_RADIUS_KM,
	RELAY_IDENTIFY_RANGE_KM,
	RELAY_INTEGRITY,
	RELAY_NAME,
	type RelayPlan,
	type RelaySignal,
	relayDestruction,
	relayDetection,
	relayInSights,
	relayLog,
	relayPlan,
	relayPosition,
	relaySignal,
	relaySlot,
	relayVelocity,
} from "./pirate-relay";
import { buildRelayMesh } from "./relay-mesh";
import type { RelayCue } from "./relay-cue";
import {
	CANISTER_RADIUS_KM,
	CARGO_CONTACT_COLOUR,
	CARGO_CONTACT_CSS,
	type Canister,
	driftCanister,
	dropCanisters,
	dropManifestCanisters,
	raiderDestruction,
	stepCanisters,
} from "./raider-wreck";
import {
	SCOOP_NOTICE_S,
	type ScoopNotice,
	nextScoopNotice,
	scoopExit,
} from "./cargo-notice";
import {
	type Encounter,
	type EncounterContact,
	type EncounterEnd,
	RAIDER_CONTACT_RADIUS_KM,
	forceEncounter,
	scheduleEncounter,
	stepEncounter,
} from "./encounter";
import {
	type EncounterBearing,
	RAIDER_HULL_ID,
	type RouteDetection,
} from "./raider-slots";
import { berthCentre, recomposeDirection } from "./arrival";
import {
	type DockPhase,
	type DockSession,
	berthOf,
	canSkipTraversal,
	enterArrival,
	interiorOfStation,
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
	warmStationMaps,
} from "./station-mesh";
import { SPEC_FIXTURE_NAMES } from "./station-visuals";
import {
	HULL_SPECS,
	PLAYER_BASELINE_HULL,
	PURCHASABLE_HULL_IDS,
	type HullEnvelope,
	type HullId,
	type HullVariantId,
} from "./hull";
import {
	type FleetSlot,
	HULL_REACH_KM,
	HULL_VARIANTS,
	buildShipMesh,
	fleetLayout,
} from "./ship-mesh";
import {
	type DesignationScan,
	type ScanStandoff,
	type DisplayContact,
	isDisplayContact,
	relativeLabel,
	targetAgeLabel,
	targetDesignation,
} from "./display-contact";
import {
	compareStationTurns,
	materializeTrafficContact,
	parkedTrafficProjection,
	stationTrafficRoster,
	TRAFFIC_DEMATERIALIZE_KM,
	TRAFFIC_MATERIALIZE_KM,
	TRAFFIC_STATION_EXCLUSION_KM,
	trafficScheduleAt,
	type TrafficActor,
	type TrafficProjection,
	type LaneRefusal,
	type LaneRequest,
	playerLaneRefusal,
} from "./station-traffic";
import {
	projectParkedTrafficActor,
	projectSystemTrafficAuthority,
	type TrafficCruiseCache,
	type SystemTrafficProjection,
	type TrafficBerthCache,
	type TrafficArbitrationEvent,
} from "./station-route";
import {
	COCKPIT_EMISSIVE_INTENSITIES,
	COCKPIT_KEY_LIGHT,
	applyCockpitQuality,
	cockpitForm,
	cockpitMaterial,
	plateCockpitUVs,
	railLamps,
	registerKeyLight,
} from "./cockpit-surface";
import { applyHullQuality } from "./ship-surface";
import type { StationInterior } from "./station-interior";
import {
	LiveCockpit,
	type LeftTab,
	type LiveCockpitState,
	type RightTab,
} from "./live-cockpit";
import { readDeficit } from "./deficits";
import {
	emptyRequests,
	fixtureOffers,
	requestAction,
} from "./requests-prototype";
import type { RequestsView } from "./requests-prototype-view";
import {
	type CommanderRecord,
	type SaveEnvelope,
	newCommanderRecord,
	serializeSave,
} from "./save-envelope";
import {
	CommanderCatalog,
	DEFAULT_SLOT,
	type FlushReason,
	SAVE_BLOCKED_MESSAGE,
	SAVE_CLOSED_MESSAGE,
	SAVE_DB_NAME,
	SAVE_DB_VERSION,
	SAVE_DEBOUNCE_MS,
	SAVE_POINTER_STORE_NAME,
	SAVE_RETRY_LIMIT,
	SAVE_STORE_NAME,
	SaveStore,
	indexedDbSaveBackend,
	webSlotLocks,
} from "./save-store";
import { type BootMode, bootMode } from "./boot-mode";
import {
	attachCommander,
	CommanderSwitch,
	flushFault,
	messageOf,
	pendingFor,
	permadeathAtAttach,
	planBoot,
	randomSeed,
	withLockFault,
	withRestoreFault,
	writeFault,
} from "./commander-flow";
import {
	COMMANDER_KEY,
	type CommanderOverlayHandle,
	mountCommanderOverlay,
} from "./commander-overlay";
import {
	mountSaveBadge,
	type SaveBadgeHandle,
	hasHeldSaveFault,
	heldSaveFault,
} from "./save-badge";
import { marketStationOf } from "./market";
import { exposeMarketLaw } from "./market-probe-hook";
import { type CarrierKey, carrierKey, compareCarrierKeys } from "./carrier-key";
import { NO_KNOWLEDGE } from "./knowledge-labels";
import { disposeSubtree } from "./gpu-teardown";
import {
	commanderHold,
	newCommander,
	scoopCargo,
	transactAtStation,
	type StationAction,
} from "./station-commerce";
import {
	newWorld as newPersistentWorld,
	observeDocking,
	observeScan,
	advanceTo,
	applyTransition,
	effectiveCarrier,
	type EffectiveCarrier,
	observe,
	observeSystemRelay,
	readKnowledge,
	type OperationalCondition,
	setDeficits,
	type TransitionEvent,
	visit,
	type WorldState,
} from "./world-state";
import {
	type StationConsoleTab,
	stationEquipmentScreen,
	stationMarketScreen,
} from "./station-console";
import type { GalaxyChart } from "./galaxy-map";
import { type WarpField, warpField } from "./warp";
import {
	type Vec3,
	add,
	dot,
	length,
	normalizeOr,
	scale,
	sub,
	v3,
} from "./vec3";
// One path to `./units`, deliberately. Keeping a namespace import beside a named
// one would let this file reach `FAR_SCALE` and `units.FAR_SCALE` as separate
// spellings of the same constant — the two-public-paths pattern this branch
// removed from `sim.ts` and pinned with a source-scan test.
import * as units from "./units";

/**
 * Cube faces drawn per frame, across every bake in flight (#208).
 *
 * One. A face is a full-screen evaluation of the class shader — the thing #248
 * measured at 43.5 ms filling a 1440x900 frame at device scale 2 — and twelve
 * of them per body. At one a frame a fourteen-body system finishes in 168
 * frames, under three seconds at 60 Hz, and no single frame carries more than
 * one extra draw. Raising it trades that stall against a hitch, and the node's
 * "do not let a bake block the first frame after a jump" is which way the trade
 * goes.
 */
const BAKE_FACES_PER_FRAME = 1;

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
 * **Read off the roster now rather than declared here** (#181). This was a
 * hardcoded pair, and its own comment said #26 would replace it — #26 ruled the
 * courier the `player-baseline` and #181 gave every hull a selected variant, so
 * both halves come from `HULL_SPECS` and the renderer names no roster fact of
 * its own. A shipyard that sells a second hull changes this to a saved value; it
 * does not change where the variant comes from.
 */
const PLAYER_HULL: readonly [HullId, HullVariantId] = ((): readonly [
	HullId,
	HullVariantId,
] => {
	// **`?hull=<id>` is a development affordance and the node that closes on
	// flying one.** #26's D5 says a freighter is sluggish and an interceptor is
	// sharp; a probe cannot fail on *this feels wrong*, so the sluggish end of
	// the roster has to be flown by a person, and until a shipyard exists there
	// is no other way to be in one. It is the same shape as `?combat=1` and
	// `?seed=` — a query the game reads once at load, not a mode.
	//
	// A shipyard replaces it with a **saved** value; it does not change where the
	// variant comes from, and it does not make this a second place a hull is
	// chosen. An unknown or absent id falls back to the baseline rather than
	// throwing, because a typo in a URL should not be a black screen.
	const asked = new URLSearchParams(window.location.search).get("hull");
	const id = (PURCHASABLE_HULL_IDS as readonly string[]).includes(asked ?? "")
		? (asked as HullId)
		: PLAYER_BASELINE_HULL;
	// **It says so when it falls back.** Silently flying a courier while the
	// pilot believes they are judging a freighter is the one way this affordance
	// could produce a wrong answer, and the whole point of it is a judgement.
	if (asked !== null && asked !== id)
		console.warn(
			`[seelite] ?hull=${asked} is not one of ${PURCHASABLE_HULL_IDS.join(", ")} — flying the ${id}`,
		);
	return [id, HULL_SPECS[id].variant];
})();

/** The player hull's envelope, which is what a berth's fit predicate compares
 *  against (§13.2). Read off the roster rather than restated — and it is the
 *  *measured* box of the selected variant, which is the half #181 fixed. */
const PLAYER_ENVELOPE = HULL_SPECS[PLAYER_HULL[0]].env;

/** The player hull's handling (#26's D5). One derivation per hull, computed
 *  once: `flightPerformance` is pure and the roster does not change mid-frame. */
const PLAYER_PERFORMANCE: FlightPerformance = flightPerformance(PLAYER_HULL[0]);

/** A whole ship of the flown hull. A function, because a condition is mutable
 *  state and every caller needs its own. */
const playerFullCondition = (): ShipCondition => fullCondition(PLAYER_HULL[0]);

/**
 * `?raider` puts a raider on every cruise leg, five seconds in (#324), and
 * `?raider=off` (or `0`, or `false`) puts one on none.
 *
 * Both are affordances of `?hull=`'s kind. The leg law is a chance, and a pilot
 * judging the contest should not have to fly legs until one comes; the bearing
 * cycles through behind, alongside and ahead by leg. And a probe or a capture
 * that cruises for another reason — an arrival, a detour, a traversal — should
 * not have its leg ended by an interdiction it is not about, which the raised
 * leg chance (`RAIDER_LEG_CHANCE`, combat-model §3) made likely. Neither gates
 * `forceRaider`. With neither, the leg law runs as a player meets it.
 */
const RAIDER_PARAM = new URLSearchParams(window.location.search).get("raider");
const RAIDERS_OFF =
	RAIDER_PARAM !== null && ["off", "0", "false"].includes(RAIDER_PARAM);
const RAIDER_PLAYTEST = RAIDER_PARAM !== null && !RAIDERS_OFF;
/**
 * #43's pirate relay prototype: development builds only, on
 * `?relay-prototype=1`, the way #343's Requests trial is gated. The relay's
 * carrier key exists regardless (`pirate-relay.ts`), so nothing about a save
 * depends on the query string; what the flag turns on is the drawn relay, its
 * signal, its target and its dial on the leg law. In a production build the
 * flag is `false` and its branches fold; the relay modules, the mesh and the
 * cue's aside are still in the bundle, inert.
 */
const RELAY_PARAM = new URLSearchParams(window.location.search).get(
	"relay-prototype",
);
const RELAY_PROTOTYPE =
	import.meta.env.DEV &&
	RELAY_PARAM !== null &&
	!["off", "0", "false"].includes(RELAY_PARAM);

/** What one frame read of the relay (#43), for the renderer and the glass. */
interface RelayView {
	key: CarrierKey;
	pos: Vec3;
	vel: Vec3;
	condition: OperationalCondition;
	identified: boolean;
	signal: RelaySignal | null;
	/** The watched station's display name. */
	watched: string;
}
const PLAYTEST_BEARINGS: readonly EncounterBearing[] = [
	"behind",
	"alongside",
	"ahead",
];

/** What the cockpit says when an encounter ends. `null` for an end the pilot
 *  never saw. */
const ENCOUNTER_END_NOTICE: Record<
	EncounterEnd,
	((name: string) => string) | null
> = {
	missed: null,
	lost: null,
	broken: (name) => `broke ${name}'s lock`,
	escaped: (name) => `escaped ${name}`,
	fled: (name) => `${name} fled`,
	destroyed: (name) => `${name} destroyed`,
};

/** Shared empty fallback for stations with no player or Traffic berth reservations. */
const EMPTY_BERTHS: ReadonlySet<string> = new Set<string>();

/** The route phases in which a Carrier is at a berth and not moving — the set
 *  `probe-traffic-continuity.mjs` asserts a berth cannot change across. */
const SETTLED_PHASES: readonly string[] = [
	"parked-home",
	"docked-away",
	"launch-queued",
];

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
/**
 * How fast a fully-deflected stick drags the galaxy chart, pixels per second.
 *
 * In the pointer's own unit, because `Handle.orbit` takes a drag in pixels — so
 * the figure reads as "a full stick is this much mouse drag a second", which is
 * a thing that can be compared with one.
 */
const CHART_ORBIT_PX_PER_S = 420;
const THROTTLE_UP = "shift";
const THROTTLE_DOWN = "control";
/** Ten seconds from idle to full inside the station zone, rather than one. */
const STATION_THROTTLE_RATE_SCALE = 0.1;

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
 *
 * **Read from `hyperspace.ts` since #187, rather than declared.** It was a `3`
 * here because the thing §4 says it borrows from did not exist; it does now, so
 * the borrowing runs the direction the spec states it in and the two windows
 * cannot drift into the second mechanic §4 refuses. `probe-live-cockpit.mjs`
 * asserts the page still reports 3.
 */
const SPOOL_S = JUMP_CHARGE_S;

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
	/** The berth this ship holds (§13.2), or `null` when it holds none. */
	berthId: string | null;
	/** The parked up-vector that berth gives, in world space — the direction
	 *  away from its surface (§13.3). `null` when no berth is held. A probe
	 *  aiming a free look needs the roll the sim parked the ship at, and
	 *  deriving one from `basis` would be a second spelling of it. */
	berthUp: { x: number; y: number; z: number } | null;
	/** Where that berth parks the ship, as an axial distance from the station's
	 *  centre — so a probe reads the bay's depth off the page instead of
	 *  restating a constant that would go falsely red when the module retunes
	 *  it. `null` when no berth is held. */
	berthAxialKm: number | null;
	/** E9's generated name for this station. */
	stationName: string;
	condition: ShipCondition;
	alive: boolean;
	/** The full head-on pool (`headOnPool`), which §2.1's bound is against. */
	poolMax: number;
	/** A full condition for the flown hull, for a probe that resets to it. */
	conditionFull: ShipCondition;
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
/** The course row's band and the duel row's, counted up from the strip as 1. */
const COURSE_BAND = 2;
const DUEL_BAND = 3;
/**
 * How many bands the floor stacks: §5.1's strip, §8.3's course row above it,
 * and #324's duel row above that. **It is the top band's number, not a count
 * kept beside it.** A band added above the duel row must become this value.
 *
 * **One height for both, because `floorFont` sizes every glyph on the floor
 * from `FLOOR_STRIP_HEIGHT_PX`.** A course band declared as its own number is a
 * box whose contents another number governs — raise the strip's type and the
 * row's glyphs climb above a `top` the record still reports as fixed, which is
 * the value a sampler reads. It was briefly an alias for exactly that reason,
 * which is worse than a count: an alias exists so the two *can* diverge, and
 * `floorBox` wrote the strip's height into every box regardless.
 *
 * **The course band is reserved whether or not a course is set.** The row is
 * absent with no course (#117 D2), but the prompt and §3's clearance line are
 * offset by it unconditionally — a line that jumps a row the moment the player
 * commits to a destination is a worse instrument than one sitting a row higher
 * always.
 */
const FLOOR_BANDS = DUEL_BAND;
/** A `PROMPT_FONT` line's own band, which both lines below occupy. */
const PROMPT_LINE_HEIGHT_PX = 18;
/**
 * How far the cruise/jump prompt clears the floor's topmost band.
 *
 * **A fixed gap, which is what every band it clears is.** The value it replaced
 * was a *fraction* — 0.04h against a glass bottom of 0.66h — so the old gap
 * above the strip was 4.4 px at the probe's 760 and 7.76 px at 844. Calling it
 * "exactly" the same thing was true of h = 900 alone.
 */
const PROMPT_ABOVE_FLOOR_PX = 10;
/**
 * How far §3's clearance line clears the same band — **a prompt line further,
 * because the two share the anchor now.**
 *
 * It was a bare 16 against a `h * 0.62` prompt, which at the probe's 760 left
 * 11.6 px between two 13 px lines. Anchoring the prompt to `floorTopY` closed
 * that to 6 and nothing measured it: the pair is drawn by two methods, each
 * writing a correct record of its own. This is the same collision the course
 * row had with the prompt, one surface further out, and it is stacked rather
 * than spaced by eye.
 */
const CLEARANCE_ABOVE_FLOOR_PX = PROMPT_ABOVE_FLOOR_PX + PROMPT_LINE_HEIGHT_PX;

/**
 * The top of the floor's band stack — above the strip and above §8.3's course
 * row — as a y on the overlay.
 *
 * **One owner, because this PR exists for the want of one.** The course band
 * was added and the prompt did not know about it, so the two drew on one
 * baseline; the clearance line was spared only because it already derived
 * itself from the strip's band. Three sites read this now, and a fourth band
 * is one edit rather than three.
 */
const floorTopY = (h: number) => floorBandTopY(h, FLOOR_BANDS);
/**
 * The top of band `band` of the floor, counting up from the strip as 1.
 *
 * **The duel row is reserved like the course row** (#324): the band is there
 * whether or not a fight is on, so the prompt and §3's clearance line sit a
 * band higher always rather than jumping when a raider appears — the rule the
 * course band's own comment gives, applied to the third band.
 */
const floorBandTopY = (h: number, band: number) =>
	h * GLASS_BOTTOM_FRACTION - FLOOR_STRIP_HEIGHT_PX * band;
/** The widest reading the duel row can print, for the floor's fit. */
const DUEL_ROW_WIDEST = duelRowWidest();
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

/**
 * Where one floor run landed, and the band it landed in.
 *
 * **One shape, because this PR proved what four copies cost**: adding `top` and
 * `height` so a sampler could stop keeping its own glyph height meant editing
 * the field's type, the local it is built into, and the course row's separate
 * literal. The course row has a label like any other cell (`COURSE_CUE_LABEL`),
 * so it is one of these rather than a second shape.
 */
interface FloorBox {
	label: string;
	x: number;
	y: number;
	width: number;
	/** The band the run occupies, so a sampler reads it rather than keeping a
	 *  glyph height that goes lenient when the type is raised. */
	height: number;
	top: number;
}

/**
 * A floor box from its band, so the band→baseline rule is written once.
 *
 * The strip derived its baseline down from the glass bottom while the course
 * row derived its own up from `floorTopY` — the same rule from opposite ends,
 * in two six-field literals. That is "two runs on one floor authored two ways"
 * again, in the block whose comment argues against it.
 */
function floorBox(
	label: string,
	x: number,
	width: number,
	top: number,
): FloorBox {
	return {
		label,
		x,
		width,
		top,
		height: FLOOR_STRIP_HEIGHT_PX,
		y: top + FLOOR_STRIP_HEIGHT_PX * (1 - FLOOR_BASELINE_FRACTION),
	};
}

/**
 * Paint one floor cell: its label, then its value in §4's tone.
 *
 * **One painter, because the floor has two runs.** §5.2 says "two runs on one
 * floor authored two ways is how a floor comes to look like two instruments",
 * and the course row was authored the second way in the same change that wrote
 * the sentence — the strip's loop and the row each repeating the same
 * font/fill/label/value sequence, so a tone or gap change had to land twice.
 * Copying the block is also what dropped the strip's `ctx.restore()`: the
 * course block brought its own save/restore pair and read as the closing one.
 */
function drawFloorCell(
	ctx: CanvasRenderingContext2D,
	cell: FloorCell,
	at: { x: number; baselineY: number; labelWidth: number },
	type: { labelGap: number; labelFont: string; valueFont: string },
) {
	ctx.font = type.labelFont;
	ctx.fillStyle = FLOOR_LABEL_FILL;
	ctx.fillText(cell.label, at.x, at.baselineY);
	ctx.font = type.valueFont;
	ctx.fillStyle = FLOOR_TONE_FILL[cell.tone];
	// The label width comes from the measuring pass rather than a second
	// `measureText` here — four labels re-measured every frame for a value that
	// changes only with the viewport.
	ctx.fillText(cell.value, at.x + at.labelWidth + type.labelGap, at.baselineY);
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

/** The set course's chain as last planned — one shape, named because the cache
 *  field and the method that fills it both spelled it out. */
interface CourseChain {
	destination: SystemRecord;
	nextHop: SystemRecord | null;
	remaining: number;
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

/**
 * A quaternion's forward direction, in sim space.
 *
 * `-Z` is forward throughout — `buildShipMesh`'s callers read the hull back out
 * that way. Free rather than a method because two rotations want it and they
 * are not the same rotation: `nose()` asks the *ship's* orientation, and
 * `weaponAim()` the *camera's*, which differ whenever the pilot looks off the
 * nose. Written out twice, the pair looked like a copy rather than like a
 * distinction.
 */
function forwardOf(q: THREE.Quaternion): Vec3 {
	const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
	return v3(f.x, f.y, f.z);
}

/**
 * The scan facts one frame shares between the Target instrument and the Flight
 * console: the cell's own inputs, the actor behind the selection, and the
 * reading the pilot's knowledge row holds. A frame's value, not a fact about the
 * world — everything in it is re-derived from the row beside the live world, and
 * the memo below is only what stops that derivation running twice for one ship.
 */
interface ScanFacts {
	designation: DesignationScan;
	actor: TrafficActor | undefined;
	reading: CarrierReading | null;
}

/** A memoised answer, with everything it was true about. */
interface ScanFrame {
	target: Body | null;
	gameTime: number;
	chargeS: number;
	fitted: boolean;
	standoff: ScanStandoff | null;
	stamp: number;
	facts: ScanFacts;
}

class Game {
	readonly world: World;
	readonly renderer: THREE.WebGLRenderer;
	readonly composer: EffectComposer;
	/** The exact post-processing budget browser probes read back. */
	readonly exposure = EXPOSURE;

	/** Background: stars only, no depth, re-centred on the camera each frame. */
	readonly backdropScene = new THREE.Scene();
	/** Far: system bodies at `FAR_SCALE`, angular size preserved. */
	readonly farScene = new THREE.Scene();
	/** Approach: close stars, planets, and moons at intermediate scale. */
	readonly approachScene = new THREE.Scene();
	/** Switchable from the perf panel; see `perf-panel.ts`. */
	private bloomPass!: UnrealBloomPass;
	/** The last pass: tone map, dither, vignette (#200). Public so a probe can
	 *  reach the dither's control arm through `window.__seelite`. */
	outputPass!: SeeliteOutputPass;
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

	/**
	 * The throttle, 0..1.
	 *
	 * Read-only, and here for the same reason `heldKeyCount` is: the pad's
	 * triggers *trim* this value rather than setting it (#283), and "a light
	 * pull trims more slowly than a full one" is otherwise only a comment. The
	 * cockpit draws the throttle as a texture and a lit fill, neither of which a
	 * probe can read a number out of.
	 */
	get throttleFraction() {
		return this.throttle;
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
	/** The system's star. Every body's sun direction is measured from it, and it
	 *  is re-resolved by `buildBodies` — which a jump runs again (#187). */
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
	/**
	 * The face size of the cube each body was last asked to bake at (#208).
	 *
	 * The *request*, which is not the same fact as `BodyVisual.bakedFacePx()`:
	 * that one is `0` until the bake completes, so a handoff would restart the
	 * same bake on every frame if it read that. Held here rather than in the
	 * visual because it is the schedule's own bookkeeping, and the visual has no
	 * business knowing what layer it is in.
	 */
	private readonly bakeFacePx = new Map<string, number>();
	/**
	 * Bodies with a bake in flight, oldest first.
	 *
	 * A queue rather than a scan of every visual, so the per-frame cost of the
	 * schedule is the faces it draws and not the bodies it does not.
	 *
	 * A body re-baked while already queued is enqueued twice, and **it is the
	 * later duplicate that is dropped**: `stepBake` reads the visual's current
	 * bake rather than one carried on the entry, so the older entry steps the new
	 * bake and the body is served in its original place. The comment here said
	 * the opposite for four rounds (sage, PR #256, round 5). Cheaper than keeping
	 * the queue unique, and the ordering it costs is one body's turn.
	 */
	private readonly bakeQueue: string[] = [];
	/**
	 * The body allowed to hold the large cube pair, and how big it looked.
	 *
	 * Reset every frame before the body loop, so it is last frame's answer while
	 * the loop runs — which is what lets the sizing decision be made in the same
	 * pass that computes the apparent radii. See the comment at its use.
	 */
	private widestBodyId: string | undefined;
	private widestRadiusPx = 0;
	/**
	 * The focal length #207's bands are measured in, CSS pixels.
	 *
	 * Recomputed in `resize` rather than per frame — it is a function of the
	 * window and the field of view, and neither changes inside a frame. Seeded
	 * from the same call at construction so the first frame has a real value
	 * rather than a zero that would put every body in the smallest band.
	 */
	private focalPx = focalPx(window.innerHeight, 60);
	private shipMesh!: THREE.Group;
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
	/** Primary mouse fire is held state, matching the keyboard laser control. */
	private mouseFiring = false;
	/**
	 * THROWAWAY #48's prototype, or `null` in normal flight.
	 *
	 * **Existence is the opt-in.** It is constructed only for `?combat=1`, so a
	 * production flight allocates nothing, intercepts no key and draws no
	 * prototype chrome — and deleting the prototype is deleting `combat-rig.ts`
	 * and this field, rather than unpicking eight guarded branches from paths
	 * that have nothing to do with combat (#61).
	 */
	readonly combatRig: CombatPrototypeRig | null;
	/** The floor strip's fitted scale for the width it was solved at. One memo
	 *  and not a map: the fit is a property of the viewport, and a resize drag
	 *  through a thousand widths should not leave a thousand entries behind. */
	private floorFit: {
		width: number;
		scale: number;
		overflowPx: number;
	} | null = null;

	/** rAF handle, so the loop can be frozen and driven by hand. */
	private animationFrame = 0;
	/**
	 * Optional because frame attribution is a query-gated diagnostic. The
	 * default route never constructs or attaches one, so these two guarded reads
	 * are its entire footprint there and no timer query is issued.
	 */
	private frameAttribution: FrameAttribution | null = null;
	private frameAttributionEnable: Promise<FrameAttribution | null> | null =
		null;
	/** The mode `frameAttributionEnable` is building; see the replacement rule. */
	private frameAttributionEnableMode: FrameAttributionMode | null = null;
	private frameAttributionGeneration = 0;
	/**
	 * #352's Auto controller, constructed only while the row says `"auto"`.
	 *
	 * Null is the manual case, and it is the *whole* of the manual case: with no
	 * controller there is nothing to step, nothing to ask, and
	 * `effectiveRenderScale` returns the number the player chose. A controller
	 * that existed and was ignored would be a second opinion about the drawing
	 * buffer waiting for someone to read it by mistake.
	 */
	private adaptive: AdaptiveResolution | null = null;
	/**
	 * The multiplier the drawing buffer was last built with.
	 *
	 * Read when Auto starts, so switching it on over a planet begins at the rung
	 * the player is already looking at rather than jumping to 100%, stuttering,
	 * and climbing back down through every rung to where it began.
	 */
	private appliedRenderScale = 1;
	/** The display the controller's measurements were taken on; see `displaySignature`. */
	private adaptiveDisplay: string | null = null;
	private rendererInfoAutoReset: boolean | null = null;
	readonly audio = new AudioFX();
	/**
	 * The pad (#283). Constructed here because construction reaches for nothing —
	 * `navigator` is touched inside `poll()` alone, which is rule 2 of the
	 * module's header and the reason it sits on the headless list.
	 */
	private readonly pad = new GamepadSource();
	/**
	 * The pad's last frame, or `null` before the first poll.
	 *
	 * Null rather than a synthetic disconnected frame: a probe that cancels the
	 * frame loop and steps the world by hand never polls, and a zeroed frame
	 * would let it read "a pad is present and holding nothing" — which is a
	 * different claim from "nobody has asked".
	 */
	private padFrame: PadFrame | null = null;
	/**
	 * Said once per session, not per frame: the pad cannot open an
	 * `AudioContext`, so a session begun on the pad is silent until any key or
	 * click. See `padAudioNotice`.
	 */
	private padAudioNoticeSaid = false;
	private throttle = 0;
	private frameBody: Body | null = null;
	/** A surface stop can happen farther than `NEAR_FAR_KM` from a giant's
	 * centre. Hold that one blocker's frame while the ship remains in its
	 * near-surface band; ordinary nearest-centre selection is unchanged. */
	private proximityFrameBodyId: string | null = null;
	/** View-local head direction. It does not change the ship's orientation. */
	headLook: HeadLook = "forward";
	private rightTab: RightTab = "Flight";
	private leftTab: LeftTab = "Navigation";
	/** The forward station console keeps its tab across a head turn while docked. */
	private stationConsoleTab: StationConsoleTab = "Market";
	private requests = emptyRequests();
	private requestSelectedId: string | null = null;
	private requestMessage = "";
	private requestRevision = 0;
	private readonly requestFixtures =
		import.meta.env.DEV &&
		new URLSearchParams(window.location.search).has("requests-prototype");
	private requestOffersCacheKey: string | null = null;
	private requestOffersCache: ReturnType<typeof fixtureOffers> = [];
	/** Commander-owned mutable commerce state; no renderer may write it. */
	private commander = newCommander(PLAYER_HULL[0]);
	/** The game-owned per-galaxy state holds the station deficit map. */
	private commerceWorld!: WorldState;
	/** #89's D7 flag, chosen at new game and never edited. Read by the death
	 *  path, not enforced by it — see `save-store.ts`. */
	private permadeath = false;
	/** Set by the load arm, read once by the constructor: a restored ship keeps
	 *  the attitude it was saved with rather than being turned to face a star. */
	private restoredAttitude = false;
	/** The save, once the boot has opened a store. Null in every workbench
	 *  route and in a probe that did not ask for one, so every call site is a
	 *  no-op there rather than a guard at each. */
	saveStore: SaveStore | null = null;
	/** Why the boot's load refused, if it did. D9: the player is told which
	 *  Commander failed and why; the record itself is left alone. */
	saveFault: string | null = null;
	/**
	 * Whether the world clock is held (`persistent-world-state.md` §11.2 step 4,
	 * S7). The frame loop still draws and polls the pad; the step receives no
	 * time. Held from construction until the boot attaches a store or the
	 * player chooses Continue, so a permadeath choice still finds the clock at
	 * zero.
	 */
	clockHeld = false;
	/**
	 * Called once, on the frame the hull reaches zero (#324). The boot sets it:
	 * it restores the last dock, or opens the Commander overlay when there is
	 * nothing to restore.
	 */
	onDeath: (() => Promise<void>) | null = null;
	/** Set when the hull reaches zero. The clock holds from then on. */
	dead = false;
	/** The Commander overlay, once the boot has mounted it (§11). */
	commanderOverlay: CommanderOverlayHandle | null = null;
	/** The save-fault badge (`hud-and-scanner.md` §5.3), once mounted. */
	saveBadge: SaveBadgeHandle | null = null;
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
	/** Last rendered Navigation order; tiny range changes do not reshuffle it. */
	private navOrder: string[] = [];
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
	/**
	 * §8's hyperspace wind-up, or the idle state (#187).
	 *
	 * Public for the reason the cruise regime's state is: a probe has to be able
	 * to drive it and read it. Session state rather than world state — the
	 * charge is something the player started, and `sim.ts` owns only what a
	 * `World` is.
	 */
	jumpCharge: JumpCharge = idleCharge();
	/**
	 * The committed destination (`galaxy-route.ts`'s `Course`), or `null`.
	 *
	 * **Owned here rather than by the chart**, which is what makes it survive
	 * closing the Navigation tab — the chart is disposed on every tab toggle and
	 * a course held inside it went with it. `persistent-world-state.md` §8's
	 * rule is that the *intent* is the thing: the chain is re-derived from
	 * wherever the ship actually is, so an off-plan jump is a re-plan rather
	 * than a desync. It is not saved: #89 owns save/load and the galaxy
	 * envelope has no field for it yet.
	 */
	course: Course | null = null;
	/** Why the last jump was refused, or what it did — shown on the glass beside
	 *  the cruise prompt. Empty when there is nothing to say. */
	jumpNotice = "";
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
	/** The selectable bodies, in display order. Invalidated by changing system,
	 *  which is why this is a field rather than a `readonly` built in the
	 *  constructor — `performJump` clears it (#187). */
	private selectableCache: Body[] | null = null;
	/** Producers register stable objects; only selection and scanner merge them. */
	private readonly contacts: DisplayContact[] = [];
	private registerContact(contact: DisplayContact) {
		if (!this.contacts.includes(contact)) this.contacts.push(contact);
	}
	private unregisterContact(contact: DisplayContact) {
		const at = this.contacts.indexOf(contact);
		if (at >= 0) this.contacts.splice(at, 1);
	}
	/** The raider encounter on this leg, from its draw to its end (#324). */
	encounter: Encounter | null = null;
	/** Where the encounter's raider is this frame, for the renderer. */
	private encounterView: EncounterContact | null = null;
	/**
	 * The raider's hull and scanner contact, built once and reused by every
	 * encounter. Render only moves them, so a new encounter never allocates and
	 * nothing a leg could inherit is assigned on the display path.
	 */
	private readonly raiderMesh = (() => {
		const root = buildShipMesh(
			RAIDER_HULL_ID,
			HULL_SPECS[RAIDER_HULL_ID].variant,
		).root;
		root.name = "raider";
		return root;
	})();
	/** Whether `raiderContact` is registered. Kept beside it rather than read
	 *  off the contact list, which only selection and the scanner read. */
	private raiderListed = false;
	private readonly raiderContact: DisplayContact = {
		id: "",
		name: "",
		kind: "ship",
		pos: v3(),
		velocity: v3(),
		radiusKm: RAIDER_CONTACT_RADIUS_KM,
		color: 0xff6a4a,
		shipType: RAIDER_HULL_ID,
		standing: null,
		scannerClass: "hostile",
	};
	/** The scan charge, in progress. Session state like the jump charge: a scan
	 *  half-held is not a fact about the world, and saving it would let a pilot
	 *  bank a charge by reloading (#364, §4). */
	private scanHold: ScanHold = beginScanHold();

	/** One frame's memoised scan answer. Session state like the hold beside it,
	 *  and for the same reason: it pictures this frame, and saving it would hand a
	 *  loaded game a reading its pilot never earned. */
	private scanFacts: ScanFrame | null = null;
	/** #43: the pirate relay's plan for the system the ship is in, cached by
	 *  system index. Pure in the system, so never saved. */
	private relayPlanCache: RelayPlan | null = null;
	private relayPlanSystem = -1;
	/** Hull points left on the relay this visit. Flight state: not saved, and
	 *  a jump leaves it behind (`clearSystemScopedState`). */
	relayHull = RELAY_INTEGRITY;
	/** The instance the hull belongs to: a replacement starts whole (sage
	 *  #350 — the replacement inherited the wreck's zero and died on one pulse). */
	private relayHullInstance = 0;
	private relayListed = false;
	private readonly relayContact: DisplayContact = {
		id: "",
		name: RELAY_NAME.toUpperCase(),
		kind: "relay",
		pos: v3(),
		velocity: v3(),
		radiusKm: RELAY_HIT_RADIUS_KM,
		color: 0xff6a4a,
		standing: null,
		scannerClass: "hostile",
	};
	private readonly relayMesh = buildRelayMesh();
	/** What this frame read of the relay, for the renderer and the glass. */
	private relayView: RelayView | null = null;
	/** Current-system Traffic authority is pure; these are disposable presentation caches. */
	private trafficSystemIndex = -1;
	private trafficTick = Number.NaN;
	/** Game time represented by the current authoritative `trafficRoutes`. */
	private trafficProjectionAtS = Number.NaN;
	/** Prior authoritative pose set, retained only for one-tick presentation interpolation. */
	private readonly trafficPreviousRoutes = new Map<
		CarrierKey,
		SystemTrafficProjection
	>();
	private trafficPreviousProjectionAtS = Number.NaN;
	private trafficActors: TrafficActor[] = [];
	private readonly trafficContacts = new Map<CarrierKey, DisplayContact>();
	private readonly trafficMeshes = new Map<CarrierKey, THREE.Group>();
	/**
	 * Ordinary carriers the player has fired on (`civilian-combat.md` H2, H3):
	 * flown rather than projected while engaged. An engagement ends in a kill
	 * or, in this change, when the ship leaves the materialization band.
	 */
	private readonly trafficEngagements = new Map<CarrierKey, Engagement>();
	private readonly trafficForward = new THREE.Vector3(0, 0, -1);
	private readonly trafficNose = new THREE.Vector3();
	private readonly trafficUp = new THREE.Vector3();
	private readonly trafficOrigin = new THREE.Vector3();
	private readonly trafficAttitude = new THREE.Matrix4();
	private readonly trafficFromQuaternion = new THREE.Quaternion();
	private readonly trafficToQuaternion = new THREE.Quaternion();
	/** Selected-target-first admission and release hysteresis for glass labels. */
	private readonly markerLabels = new MarkerLabelDeclutter();
	private readonly trafficExactParked = new Map<
		CarrierKey,
		TrafficProjection
	>();
	private readonly trafficCruiseCache: TrafficCruiseCache = new Map();
	/** Berths already granted to physical visits; prevents historical route rewrites. */
	private readonly trafficBerthCache: TrafficBerthCache = new Map();
	/** Actors shown parked while their authoritative canonical replay warms. */
	private readonly trafficColdActors = new Set<CarrierKey>();
	/** Cold canonical replays share a bounded per-frame warm-up budget. */
	private trafficWarmIndex = 0;
	/** Probe-visible readback of the pure projections used for this frame. */
	readonly trafficRoutes: SystemTrafficProjection[] = [];
	/** Explicit transient player events consumed by canonical Traffic replay. */
	readonly trafficPlayerTimeline: TrafficArbitrationEvent[] = [];
	/** Completed and active Carrier lane commitments retained for canonical replay. */
	private readonly trafficCarrierTimeline: TrafficArbitrationEvent[] = [];
	private readonly playerLaneRequests = new Map<
		string,
		{ readyAt: number; movement: "arrival" | "launch" }
	>();
	/** A launch Traffic refused, waiting for the lane (#314). */
	private launchHold: { stationId: string; refusal: LaneRefusal } | null = null;
	/** The system a fired wind-up is waiting to move the world to, taken at the
	 *  end of the frame it fired on. See `takePendingJump` (#187). */
	private pendingJump: number | null = null;
	/**
	 * The parked review fleet, gated on `?fleet`.
	 *
	 * Off by default because thirty-six hulls is a showroom, not a star
	 * system: these targetable, scannable hulls have no behaviour or collision.
	 * Behind the gate it is honest — a static display arrangement, anchored
	 * once, with no entry in `sim.ts` and no roster meaning. #26 still owns
	 * anything that is meant to be a ship rather than a picture of one.
	 */
	private readonly fleetReview = new URLSearchParams(
		window.location.search,
	).has("fleet");
	private fleet: {
		mesh: THREE.Object3D;
		slot: FleetSlot;
		contact: DisplayContact;
	}[] = [];
	private fleetAnchored = false;
	/** The speed law's masses, rebuilt once per clock value. See `masses()`. */
	private massesCache: Mass[] | null = null;
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
	/** Internal route state only: targetId remains the selected station. */
	private detour: CruiseGuidanceState | null = null;
	/** Reused while steering an active detour; cruise must not make per-frame Three allocations. */
	private readonly detourDirection = new THREE.Vector3();
	private readonly detourCurrentNose = new THREE.Vector3();
	private readonly detourOrientation = new THREE.Quaternion();
	private readonly detourForward = new THREE.Vector3(0, 0, -1);
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
	/**
	 * The course chain as last planned, and what it was planned from.
	 *
	 * `courseRow` owns it; see that method for why a per-frame `planRoute` is
	 * not an option. `chain: null` records a course that did not resolve, so a
	 * corrupt one is searched for once rather than on every frame.
	 */
	private courseChainCache: {
		key: string;
		chain: CourseChain | null;
	} | null = null;
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
		boxes: FloorBox[];
		/** §8.3's course row as painted, or `null` where no course is set and
		 *  the row was deliberately not drawn. */
		courseRow: FloorCell | null;
		courseBox: FloorBox | null;
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
		/** #324's duel row as painted, or `null` where no fight is on and the
		 *  row was deliberately not drawn. */
		duelRow: FloorCell[] | null;
		duelBox: FloorBox | null;
		source: {
			regime: string;
			spoolLeftS: number;
			jumpChargeLeftS: number;
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
	/**
	 * Whether the raider fired on the player this frame (#324). The hostile cue
	 * turns red while it does, by the principal's ruling.
	 */
	raiderFiring = false;
	/** Seconds of canopy flash left after the raider's fire landed (#324). */
	struckFor = 0;
	/** The raider's fire as the last frame drew it: the beam's two ends on the
	 *  overlay, or `null` without a beam, and the rim's strength — so a probe
	 *  knows where to sample the paint. */
	hostileFireRender: {
		beam: {
			from: { x: number; y: number };
			to: { x: number; y: number };
		} | null;
		rim: number;
	} = { beam: null, rim: 0 };
	/** The pulse laser's tracer and shot-sound pacing (`gun-feedback.ts`). */
	gunFeedback: GunFeedback = QUIET_GUN;
	/** A destroyed raider's cargo canisters in flight (#324 part d). Session
	 *  state: they expire in five minutes and are not saved. */
	canisters: Canister[] = [];
	/**
	 * The canister fade itself, reachable from a measurement.
	 *
	 * On the same admission test as the ray arithmetic above: a pure function
	 * already exported, whose rule an instrument would otherwise restate.
	 * `scripts/measure-canister-drift.mjs` has to run the **old** rule beside
	 * the new one to print a "before", and a hand copy of the arithmetic there
	 * would keep measuring the fade this module used to have on the day this
	 * one changes (sage #355).
	 */
	readonly canisterFade = driftCanister;
	/** One selectable contact per live canister, by canister id (#324). Kept
	 *  beside the canisters rather than searched for in the contact list, which
	 *  only selection and the scanner read. */
	private readonly cargoContacts = new Map<string, DisplayContact>();
	/** The scoop's acknowledgement: its words, what is left of its time on the
	 *  glass, and which outcome it is (#324). A scoop wrote `lastExit` and
	 *  nothing else, and every `lastExit` goes to `#hud`, which the page clips
	 *  to one pixel — so the sixth playtest saw a canister vanish and nothing
	 *  say why. One object rather than three fields, so a jump clears it in one
	 *  assignment and the field does not share a name with the function that
	 *  builds its text (sage #355). */
	scoop: ScoopNotice = {
		text: "",
		left: 0,
		accepted: true,
		canisterId: null,
	};
	/** What the notice drew this frame, for a probe to read rather than
	 *  restate: the text, its alpha and its outcome, or null when nothing
	 *  is up. */
	scoopRender: { text: string; alpha: number; accepted: boolean } | null = null;
	/** The gimballed beam's direction, or `null` before the first step, when it
	 *  is the boresight (`gimbal.ts`). */
	gunAim: Vec3 | null = null;
	/** The tracer's geometry and pacing, for a probe to read rather than restate. */
	readonly gunTracer = {
		ports: TRACER_PORTS,
		aim: TRACER_AIM,
		holdS: TRACER_HOLD_S,
		soundGapS: SHOT_SOUND_GAP_S,
	} as const;
	/**
	 * The hostile firing cue as drawn this frame, or `null` when no raider is
	 * the selected target. Written by the draw, like `floorRender`.
	 */
	cueRender: {
		tone: FloorTone;
		onTarget: boolean;
		/** The selected raider's condition line as drawn, or `null` without one. */
		enemyLine: string | null;
		/** The ring's centre on the overlay, or `null` when the edge arrow is
		 *  drawn instead — so a probe samples the paint, not this record. */
		at: { x: number; y: number } | null;
	} | null = null;
	/**
	 * The selected target's label as painted this frame, or `null` when none was
	 * painted. Written by the draw, like `cueRender`, so a probe reads the mark a
	 * pilot sees rather than re-deriving it (sage #368: a civilian's ON TARGET had
	 * no record at all).
	 */
	selectedRender: { id: string; text: string; onTarget: boolean } | null = null;
	/** What the HUD last displayed, quantised to its own resolution — so a frame
	 *  that would render the same text neither builds nor writes it. */
	private hudKey = "";
	/** Frames drawn since boot. A probe's cheapest proof that the loop runs. */
	frames = 0;

	/**
	 * Explicitly start attribution without coupling its enable/disable cycle to
	 * the panel.
	 *
	 * The dynamic import is the default-route boundary: constructing Game does
	 * not evaluate the sampler module, allocate queries, or change renderer.info.
	 * A later adaptive controller can call this same method without mounting DOM.
	 */
	async enableFrameAttribution(
		mode: FrameAttributionMode = "full",
	): Promise<FrameAttribution | null> {
		// **There is never a second sampler.** Two on one context would each
		// mark every frame into their own ring, and the one the controller reads
		// would not be the one `?perf` prints.
		//
		// **But a `full` request is not satisfied by a `cadence` sampler**, and
		// this line used to say it was: whichever arrived first won. A saved
		// Auto row starts its cadence sampler at boot, before `?perf` mounts, so
		// a player with Auto on got a diagnostic with no GPU timer and no
		// counters — #223's instrument quietly depending on a settings row.
		// Sage found it.
		//
		// So the cadence sampler is **replaced**, which is the word
		// `FrameAttributionMode` already used while the code did otherwise. A
		// full sampler marks frames too, so this costs Auto nothing but its
		// retained periods: the controller reads `this.frameAttribution` on every
		// step and finds the new one there, empty, and primes up from it the way
		// it does after any rung change. The old one is disabled first, which
		// bumps the generation, so a slow import cannot land it back.
		//
		// The other direction is left alone: Auto asking for `cadence` over a
		// running `full` sampler already has its signal.
		const existing = this.frameAttribution;
		if (existing && !(mode === "full" && existing.snapshotMode === "cadence"))
			return existing;
		if (existing) this.disableFrameAttribution();
		if (this.frameAttributionEnable) {
			// **The same rule for a sampler still being built**, and the
			// replacement above missed it. A saved Auto row starts a `cadence`
			// enable at boot whose import may not have resolved when the perf
			// panel asks for `full`, and this line handed that pending promise
			// straight back — so the panel still got a cadence sampler, by a race
			// rather than by order. Sage's second round found it. Waiting for the
			// pending one and asking again lands on the replacement path.
			if (mode !== "full" || this.frameAttributionEnableMode !== "cadence")
				return this.frameAttributionEnable;
			await this.frameAttributionEnable;
			return this.enableFrameAttribution("full");
		}
		const generation = this.frameAttributionGeneration;
		const pending = (async () => {
			const { FrameAttribution } = await import("./frame-attribution");
			if (generation !== this.frameAttributionGeneration) return null;
			// A second caller may have completed while this import was pending.
			if (this.frameAttribution) return this.frameAttribution;
			const attribution = new FrameAttribution({
				mode,
				gl: this.renderer.getContext() as WebGL2RenderingContext,
				contextEvents: this.renderer.domElement,
				rendererFacts: () => ({
					calls: this.renderer.info.render.calls,
					triangles: this.renderer.info.render.triangles,
					programs: this.renderer.info.programs?.length ?? 0,
					geometries: this.renderer.info.memory.geometries,
					textures: this.renderer.info.memory.textures,
					drawingBufferWidth: this.renderer.domElement.width,
					drawingBufferHeight: this.renderer.domElement.height,
					effectivePixelRatio: this.renderer.getPixelRatio(),
					// The rung, never the row: `"auto"` is not a number, and a
					// diagnostic that printed it would be describing the
					// player's choice rather than the frame that was drawn.
					renderScale: this.effectiveRenderScale(),
					composerPassCount: this.composer.passes.filter((pass) => pass.enabled)
						.length,
				}),
			});
			attribution.enable();
			// **Only a `full` sampler takes Three's counters over.** A cadence
			// sampler reports no `renderer.info` figure, and flipping
			// `autoReset` for it would put a default-route side effect on the
			// renderer in exchange for nothing — the sort of thing that is
			// invisible until something else reads a counter and finds it
			// accumulating.
			if (mode === "full") {
				this.rendererInfoAutoReset = this.renderer.info.autoReset;
				this.renderer.info.autoReset = false;
			}
			this.frameAttribution = attribution;
			return attribution;
		})();
		this.frameAttributionEnable = pending;
		this.frameAttributionEnableMode = mode;
		try {
			return await pending;
		} finally {
			if (this.frameAttributionEnable === pending) {
				this.frameAttributionEnable = null;
				this.frameAttributionEnableMode = null;
			}
		}
	}

	/** Stop attribution, delete its query ring, and restore Three's counter mode. */
	disableFrameAttribution(): void {
		this.frameAttributionGeneration++;
		this.frameAttributionEnable = null;
		this.frameAttributionEnableMode = null;
		const attribution = this.frameAttribution;
		if (!attribution) return;
		this.frameAttribution = null;
		if (this.rendererInfoAutoReset !== null) {
			this.renderer.info.autoReset = this.rendererInfoAutoReset;
			this.rendererInfoAutoReset = null;
		}
		attribution.disable();
	}

	/**
	 * Empty the sampler's frame-period ring, for an instrument changing a rung.
	 *
	 * Public because `measure-adaptive-resolution.mjs` needs each row to hold
	 * only its own rung's frames, and its first version believed it had that:
	 * it called `attributionSnapshot()` and `enableFrameAttribution()` under a
	 * comment saying "reprimed first". Neither clears anything — a snapshot is
	 * a read and an enable returns the running sampler — so every row carried
	 * the previous rung's periods, which moves a p95 below about 46 fps and a
	 * median below about 24. Sage found it.
	 */
	reprimeFrameCadence(): void {
		this.frameAttribution?.reprimeCadence();
	}

	/** Probe/diagnostic access to the immutable sampler-owned snapshot. */
	attributionSnapshot(): FrameAttributionSnapshot | null {
		return this.frameAttribution?.snapshot() ?? null;
	}

	/**
	 * The one answer to "what is the drawing buffer multiplied by".
	 *
	 * Every consumer goes through here — `onResize`, which applies it, and the
	 * attribution facts, which report it. **There is no second multiplier**: in
	 * Auto the player's row is `"auto"` and carries no number at all, so the
	 * controller's rung is the only factor there is, and in manual the
	 * controller does not exist. That is deliberate rather than incidental;
	 * `light-rig.ts` records the round in which the perf panel and the settings
	 * screen each applied half of this value, and an adaptive second factor
	 * would be that again with one half invisible in a diff.
	 */
	effectiveRenderScale(): number {
		const chosen = this.settings.value.renderScale;
		if (chosen !== "auto") return chosen;
		return this.adaptive?.scale ?? RENDER_SCALE_LADDER[0];
	}

	/** What Auto is doing, for `?perf` and the settings row. Null in manual. */
	adaptiveDiagnostics(): AdaptiveDiagnostics | null {
		return this.adaptive?.diagnostics ?? null;
	}

	/**
	 * Ask the controller once per frame, and apply a rung it accepts.
	 *
	 * **The resize is the only application path**, which is what keeps one owner
	 * of the drawing buffer: the controller changes a number, `onResize` reads
	 * `effectiveRenderScale` and rebuilds, and every transition — trial, revert
	 * and accept alike — goes through that same line. A trial is a real buffer
	 * change rather than a pretend one; there is no way to learn what a rung
	 * costs except to render at it.
	 *
	 * **A rung change invalidates the cadence**, so the sampler is reprimed on
	 * the controller's say-so. The periods still in the ring were delivered at
	 * the previous rung; left to blend out, a 33 ms history would hold a
	 * freshly-halved frame over the downshift trigger and step it down again.
	 *
	 * ## A display move is compared for, not listened for
	 *
	 * Item 7 of the node asks for a re-prime on a display change. On the
	 * principal's two displays no event carries one: `?perf` reports an
	 * effective pixel ratio of 2.00 on both, so neither `resize` nor the
	 * pixel-ratio media query fires, while the cost per pixel changes by 2.02x.
	 *
	 * **This comment used to conclude that re-measurement would recover it, and
	 * that was wrong.** `refreshFloorMs` only goes down and only `prime` resets
	 * it, so once the 120 Hz laptop set it to 8.33 ms the 60 Hz external's
	 * vsync-pinned 16.67 ms frames never read as capped again and the 44-second
	 * recovery came back. Sage caught it.
	 *
	 * So the screen's geometry is compared on every step — a handful of property
	 * reads — and a change primes. `displaySignature` says what is compared and
	 * what has not been verified.
	 */
	/**
	 * Throw away what Auto has measured, keeping the rung it is on.
	 *
	 * Both halves have to be primed or neither is: the controller holds the
	 * curve and the sampler holds the periods, and clearing one leaves the other
	 * answering about a world that is gone. The rung itself is kept — dropping
	 * to 100% on every window drag would give the player a stutter per pixel of
	 * mouse movement, and the rung that was right a moment ago is still the best
	 * guess available.
	 */
	private primeAdaptive(reason: string): void {
		this.adaptive?.prime(reason);
		this.frameAttribution?.reprimeCadence();
	}

	private stepAdaptiveResolution(): void {
		const controller = this.adaptive;
		const attribution = this.frameAttribution;
		if (!controller || !attribution) return;
		const display = displaySignature(window.screen, window.devicePixelRatio);
		// `null` is the first step after Auto starts, which has nothing to
		// compare against and nothing measured to throw away.
		if (this.adaptiveDisplay !== null && display !== this.adaptiveDisplay)
			this.primeAdaptive("display changed");
		this.adaptiveDisplay = display;
		// `cadence()`, not `snapshot().cadence`: see the accessor for what the
		// full snapshot cost once a frame.
		const cadence = attribution.cadence();
		const decision = controller.step({
			nowMs: performance.now(),
			periodMedianMs: cadence.medianMs,
			minPeriodMs: cadence.minPeriodMs,
			sampleCount: cadence.sampleCount,
			hidden: document.visibilityState === "hidden",
		});
		if (decision.transition === "none") return;
		if (decision.reprime) attribution.reprimeCadence();
		this.onResize();
	}

	/**
	 * Start or stop Auto to match the row, and tell the sampler what it needs.
	 *
	 * Auto needs a frame period on the **default route**, where #223's build
	 * contract item 6 forbids issuing timer queries — so it asks for a
	 * `"cadence"` sampler, which allocates no query ring at all. `?perf` asks
	 * for a `"full"` one; whichever arrives first wins, and the second caller
	 * gets the sampler that exists rather than a second one, because two
	 * samplers on one context would each mark every frame into their own ring.
	 */
	private async applyResolutionMode(): Promise<void> {
		const auto = this.settings.value.renderScale === "auto";
		if (!auto) {
			this.adaptive = null;
			return;
		}
		if (this.adaptive) return;
		// A new controller has measured nothing, so it has no display to compare
		// against. Left over from a previous Auto session, the old signature
		// would prime the new controller on its first step for a move that
		// happened while it did not exist.
		this.adaptiveDisplay = null;
		this.adaptive = new AdaptiveResolution({
			// Start from the rung the player last had applied rather than from
			// the top: switching to Auto over a planet would otherwise jump to
			// 100%, stutter, and climb back down through every rung.
			initialScale: nearestRung(this.appliedRenderScale),
		});
		await this.enableFrameAttribution("cadence");
	}

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

	/** `station-visuals.md` §5's fixture names per role, on the handle for the
	 *  same reason: `probe-station-visuals.mjs` asserts a floor per fixture, and
	 *  a probe holding its own copy would stay green the day §5 gains one. */
	readonly specFixtures = SPEC_FIXTURE_NAMES;

	/** `persistent-world-state.md` §2's composite key, for the same reason. The
	 *  docking probe built `${systemIndex}:${localCarrierId}` itself, which is a
	 *  second implementation of a structure the spec owns. */
	readonly carrierKey = carrierKey;

	/**
	 * Which hull is flying, and what that means — the roster's own figures, not a
	 * probe's copy of them.
	 *
	 * On the handle because `?hull=` makes the answer a runtime question for the
	 * first time (#181): a capture or a probe that assumed the courier would be
	 * measuring whichever hull the URL happened to name, and would report a
	 * sluggish approach as a regression.
	 */
	readonly playerHull = {
		id: PLAYER_HULL[0],
		variant: PLAYER_HULL[1],
		spec: HULL_SPECS[PLAYER_HULL[0]],
		performance: PLAYER_PERFORMANCE,
	};

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
	/** The widest reading §8.3's course row can take, on the handle for the same
	 *  reason `floorWidest` is: a probe measuring the fit drives the run the
	 *  layout was solved for rather than a copy of it. */
	readonly courseWidest = courseCueWidest();
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
		TRAVERSAL_SECONDS_NEAR,
		TRAVERSAL_SECONDS_DEEP,
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
	 * Rebuilt from deterministic Traffic projections at 10 Hz and augmented by
	 * player reservations. It remains writable so controlled probes can force the
	 * queued branch through the same allocator the game uses.
	 */
	readonly berthOccupancy = new Map<string, Set<string>>();

	/** The player and Traffic berth holds at one station (§13.2). */
	private occupiedAt(id: string): ReadonlySet<string> {
		const traffic = this.berthOccupancy.get(id) ?? EMPTY_BERTHS;
		const playerBerth = this.dockingStates.get(id)?.berthId;
		if (!playerBerth || traffic.has(playerBerth)) return traffic;
		return new Set([...traffic, playerBerth]);
	}

	private trafficAuthorityReady(): boolean {
		return (
			Number.isFinite(this.trafficTick) &&
			this.trafficWarmIndex >= this.trafficActors.length &&
			// **The carriers Traffic draws, not the roster** (civilian-combat H1,
			// H3b). A destroyed carrier has no route, so against the roster a kill
			// left authority "warming" until the replacement completed, and every
			// lane request in the system was refused for half an hour. A diverted
			// one is on the other side of that line: it holds a route Traffic has
			// to answer, and it never asks for a lane. So the equality is over who
			// is drawn, and a strike must not be able to close the lanes behind it.
			this.trafficRoutes.length ===
				this.flyingTraffic().length + this.divertedTraffic().length
		);
	}

	/**
	 * The player ship's condition (`ship-condition.ts`, #324): fore and aft
	 * shields, hull, energy and laser heat, stepped every frame.
	 *
	 * Three writers: `step` advances it, `resetFlightToStart` refills it, and
	 * `takeDamage` is the only place damage lands — so every source of damage
	 * cancels what damage cancels. The one exception is `?combat=1`: the rig
	 * still damages its own balance model, never this condition, and cancels
	 * nothing, until #324 (d) moves it onto this module.
	 *
	 * **Shields recover and hull does not.** A failed dock at the gate lands
	 * inside a full fore shield, so it costs a few seconds of lowered shields
	 * and nothing that lasts — the principal's ruling on #324 (2026-09-14),
	 * recorded in `docking.md` §10. Hull damage stays until something repairs
	 * it, and nothing does yet. **Not saved**, as before #324, so a reload
	 * refills the whole condition.
	 */
	condition: ShipCondition = playerFullCondition();

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

	/**
	 * The phase the computer's last step returned at `lastComputerStationId`,
	 * fed back into the next one (#315). `"idle"` whenever it did not fly on the
	 * last step or the nearest station changed, so a run-in always starts on
	 * the tight side of that station's corridor hysteresis.
	 */
	private lastComputerPhase: ComputerPhase = "idle";
	private lastComputerStationId: string | null = null;

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

	/**
	 * A new game, or a loaded one.
	 *
	 * **The load is a constructor arm rather than a method**, and that is
	 * `resetWorldToStart`'s argument applied: `Game` calls `makeWorld` exactly
	 * once and holds per-system caches deliberately never invalidated on that
	 * basis — the baked `environmentMap`, the `interiors` berth catalogue. A
	 * `load()` that swapped `this.world` mid-session would be the world rebuild
	 * that comment rules out.
	 */
	constructor(seed: number, save: SaveEnvelope | null = null) {
		if (save) {
			// `restoreWorld` rather than `makeWorld` plus a jump: `jumpWorldTo`
			// throws across a galaxy boundary on purpose, so a save taken in
			// galaxy 3 is unreachable that way.
			this.world = restoreWorld(
				save.world.seed,
				save.commander.galaxyIndex,
				save.commander.systemIndex,
				save.world.gameTime,
			);
			this.commerceWorld = save.world;
			this.commander = save.commander.state;
			this.requests = save.commander.requests;
			this.chargeAu = save.commander.chargeAu;
			this.permadeath = save.commander.permadeath;
			// **A docked save resumes in flight at the arrival point, and that
			// is a deliberate scale-down rather than an omission.** Re-entering
			// a berth means rebuilding a whole dock session — the grant, the
			// reservation, the interior, the on-rails placement — inside state
			// #72 is open to extract from this class. Restoring `flight.pos`
			// without that session would be worse than not trying: the berth
			// pose is *inside* the station, so the ship would resume in flight
			// inside the hull. `dockedAt` is recorded, round-trips, and is
			// honoured by the node that extracts the session.
			if (save.commander.dockedAt === null) {
				const f = save.commander.flight;
				this.world.ship.pos = v3(f.pos[0], f.pos[1], f.pos[2]);
				this.world.ship.vel = v3(f.vel[0], f.vel[1], f.vel[2]);
				this.orientation.set(
					f.orientation[0],
					f.orientation[1],
					f.orientation[2],
					f.orientation[3],
				);
				// **A save taken in cruise resumes at rest in normal flight, at
				// the position it was taken at.** The leg is lost; the place is
				// not.
				//
				// This was `regime = f.regime` plus the throttle and the leg's
				// start time, and the probe's in-flight arm showed the ship
				// coming back in normal flight at zero anyway — because a leg is
				// none of those three. `stepCruise` reads the target, the
				// detour and `cruiseSpeedKms`, which are leg state this record
				// does not carry; with them at their defaults the first frame
				// disengages and `exitVelocity` writes the ship to a stop. So
				// the arm was restoring something that could not survive one
				// step, and reporting success.
				//
				// Carrying them is a real design question rather than four more
				// fields — a resumed leg re-enters a guard sweep against bodies
				// that have moved, and #30's rules are written for a leg that
				// was engaged from where the ship is. It is charted, not
				// guessed at here. And a saved cruise **velocity** must not be
				// restored under any arm: it is the cruise law's, up to ~10⁶×
				// combat speed, and handing it to normal flight is a ship that
				// cannot be flown.
				if (f.regime === "cruise") {
					this.world.ship.vel = v3();
					this.regime = "normal";
					this.throttle = 0;
				} else {
					this.regime = f.regime;
					this.throttle = f.throttle;
				}
				this.restoredAttitude = true;
			}
		} else {
			this.world = makeWorld(seed);
			this.commerceWorld = newPersistentWorld(seed);
			// §7's visited flag for the system a new game starts in. Recorded
			// here rather than only on arrival, so the set is "everywhere the
			// ship has been" rather than "everywhere it has jumped to" (#187).
			this.commerceWorld = visit(
				this.commerceWorld,
				this.world.system.record.galaxy,
				this.world.system.record.index,
			);
		}
		this.observeCurrentSystemRelay();
		for (const _body of this.world.system.bodies)
			this.scannerContactBuffer.push({} as ScannerContact);
		this.updateLocalFrameBody();
		// **Not on a restored attitude.** A loaded commander is pointed where
		// they were pointed; facing the star would be the boot overwriting the
		// one field of `flight` that is hardest to notice being wrong, because
		// a ship facing a star looks exactly like a ship that was.
		if (!this.restoredAttitude) this.faceTheStar();

		this.renderer = new THREE.WebGLRenderer({
			// **`false`, and that is the honest setting** (#200). This flag
			// configures the *default* framebuffer, which this game never draws
			// into: every frame lands in the composer's targets and reaches the
			// screen as a full-screen blit of an already-resolved texture. It was
			// `true` from the first frame this game drew and it smoothed nothing —
			// it only reserved a multisampled back buffer nobody rendered to.
			// `output-stage.ts` owns the antialiasing that works.
			antialias: false,
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
		// **#201's shadow map, and it is enabled here rather than in
		// `applyQuality`.** `WebGLRenderer.shadowMap.enabled` is a program key:
		// flipping it recompiles every material in the frame, which is a stall
		// the player would feel on a settings change. The gate is on the *light*
		// instead — `sun.castShadow` — so low pays a boolean per frame and not a
		// recompile, and the map is simply never rendered.
		//
		// `PCFSoftShadowMap` because the alternative at this map size is a hard
		// stair-stepped edge on a hull's own self-shadow, which reads as a
		// texture artefact rather than as a shadow.
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
		this.buildLights();
		this.buildShip();
		this.buildCockpit();
		// THROWAWAY #48, opt-in and self-contained: the rig allocates its own
		// scene objects, so normal flight builds none of them (#61).
		//
		// **The loop control is an inline literal, and that is the third attempt.**
		// It stops the frame loop, so a production page must have no path to it —
		// and `private` is erased at runtime while this instance is published
		// whole as `window.__seelite`, so *neither* a field nor a method is
		// private in the sense that matters. Round 1 made it
		// `private readonly probeLoopControl = {...}`, reachable as
		// `__seelite.probeLoopControl`. Round 2 made it `private loopControl()`,
		// reachable as `__seelite.loopControl()` — the same hole moved onto the
		// prototype, and the check written to catch it scanned only own
		// properties, so it passed green over the regression it existed for.
		//
		// Built here, the closures are captured by the rig and by nothing else:
		// with no rig there is no reference, and there is no member of `Game` —
		// own or inherited — that is one or returns one. `probe-boot.mjs` walks
		// the prototype chain to assert exactly that.
		this.combatRig =
			new URLSearchParams(window.location.search).get("combat") === "1"
				? new CombatPrototypeRig(
						this.nearScene,
						{
							freeze: () => {
								if (this.animationFrame) {
									cancelAnimationFrame(this.animationFrame);
									this.animationFrame = 0;
								}
							},
							resume: () => {
								if (!this.animationFrame) this.animate();
							},
						},
						this.world.ship,
						// After `faceTheStar` above, and the rig's constructor says why:
						// read before the boot facing this is the identity nose.
						this.nose(),
						this.world.seed,
					)
				: null;
		this.warp = warpField(this.world.seed);
		if (this.combatRig) this.registerContact(this.combatRig.contact);
		this.nearScene.add(this.warp.object);
		// Something is selected on frame one. §6 makes selection a convenience
		// rather than a rail, but a cruise panel with an empty target field on
		// boot reads as broken, and the nearest station is what a ship at the
		// arrival point is there to reach.
		this.selectBootTarget();
		this.refreshScannerContacts();

		// **The composer is handed its own target, and that is what carries the
		// antialiasing** (#200). The renderer's own `antialias` flag configures
		// the *default* framebuffer, which this game never draws into: every
		// frame lands in the composer's targets and reaches the screen as a blit
		// of an already-resolved texture. It was `true` for years and smoothed
		// nothing, which is why it is `false` above. `output-stage.ts` owns the
		// antialiasing that works.
		this.composer = new EffectComposer(
			this.renderer,
			composerTarget(this.renderer, this.settings.value.antialias),
		);
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
		// **Depth, though — and that is `resolveDepthBuffer: false`'s companion**
		// (#200). This used to inherit the backdrop's depth buffer, which was
		// safe because the backdrop writes none. With the depth resolve off,
		// three invalidates the multisampled framebuffer's depth after every
		// `render`, so what this pass would inherit is undefined rather than
		// empty. Clearing it is free — there was nothing in it to keep — and it
		// is what makes the two changes one change.
		farPass.clearDepth = true;
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
		// **#201's ambient occlusion, between the near pass and the bloom.**
		//
		// Between them and not after, because bloom reads luminance: AO applied
		// afterwards would darken a contact the halo had already been computed
		// from, and the halo would go on glowing out of a crevice that is now
		// dark. Before the near pass is not an option either — there is nothing
		// to occlude yet.
		//
		// **It is scoped to the near scene by construction, which is what
		// answers the node's worry about `clearDepth`.** `GTAOPass` does not read
		// the composite's depth at all: it renders its *own* normal-and-depth
		// buffer from the scene and camera handed to it here, so the depth it
		// samples is the near layer's whether or not the near pass cleared
		// anything. The fallback to `SAOPass` the node allowed for is not needed
		// and is not taken. Where the near layer drew nothing the depth is the
		// far plane and the AO shader discards, leaving the far layer's planets
		// exactly as the near pass composited them.
		//
		// Sized at a fraction of the drawing buffer, like bloom and for a reason
		// that was measured rather than assumed — `OCCLUSION.ao.resolutionScale`
		// carries the table. The short of it: at the full buffer this pass alone
		// is 2.9x the whole rest of the frame, and halving it is a 3.1x saving.
		// **That brings this pass inside #201's one-to-two-millisecond estimate
		// and it does not bring the pair inside it**: with the shadow map beside
		// it the two cost 2.32–2.46 ms against a 1.85–2.03 ms frame.
		// `settings.ts` carries the table and the open question.
		this.gtaoPass = new GTAOPass(
			this.nearScene,
			this.nearCamera,
			...aoResolution(this.renderer.getPixelRatio()).toArray(),
		);
		this.gtaoPass.blendIntensity = OCCLUSION.ao.blendIntensity;
		this.gtaoPass.updateGtaoMaterial({
			radius: OCCLUSION.ao.radius,
			distanceExponent: OCCLUSION.ao.distanceExponent,
			thickness: OCCLUSION.ao.thicknessKm,
			scale: OCCLUSION.ao.scale,
			samples: OCCLUSION.ao.samples,
			screenSpaceRadius: OCCLUSION.ao.screenSpaceRadius,
		});
		// **Three's own visibility override, replaced.** The pass renders its
		// G-buffer over everything visible in the scene with
		// `MeshNormalMaterial`, which writes depth for materials that do not —
		// and the canopy is one, so the occlusion of a sheet of glass was
		// landing on the sky behind it. `occlusion-mesh.ts` owns the rule and
		// the figures; the short of it is that the two passes now see the same
		// surfaces, because a thing that casts no shadow occludes nothing.
		//
		// Replaced on the instance rather than subclassed: three calls these two
		// as methods on itself, `_visibilityCache` is the map it hands back to
		// `restoreVisibility`, and a subclass would exist to hold two functions.
		const pass = this.gtaoPass as unknown as {
			scene: THREE.Scene;
			_visibilityCache: Map<THREE.Object3D, boolean>;
			overrideVisibility(): void;
			restoreVisibility(): void;
		};
		//
		// **And the shadow map is pinned across it, which is a frame the pass was
		// paying twice.** `GTAOPass.renderOverride` is a full
		// `WebGLRenderer.render` of the near scene with a normal material — so
		// three re-rendered the whole 2048² depth map, every caster in it, for a
		// G-buffer that samples no shadow at all. `shadowMap.autoUpdate` off for
		// the duration is the standard way to say "the map you have is current",
		// and these two hooks are the natural place because they already bracket
		// exactly that render.
		pass.overrideVisibility = () => {
			this.shadowAutoUpdate = this.renderer.shadowMap.autoUpdate;
			this.renderer.shadowMap.autoUpdate = false;
			hideNonOccluders(pass.scene, pass._visibilityCache);
		};
		pass.restoreVisibility = () => {
			restoreVisibility(pass._visibilityCache);
			this.renderer.shadowMap.autoUpdate = this.shadowAutoUpdate;
		};
		this.composer.addPass(this.gtaoPass);
		// **The stored choice, applied once both passes exist to apply it to.**
		//
		// The settings subscription fires on a *difference*, so nothing reruns
		// the gate on a page that simply loads with a stored preference — the
		// same line `output-stage.ts` records for the dither. #201 needed it
		// twice over: `applyQuality` runs from `buildEnvironment`, which is
		// inside `buildLights`, and at that moment neither the shadow-casting
		// sun nor this pass exists, so `setOcclusion` guarded both fields and
		// returned. `Pass.enabled` then defaults to `true` and
		// `DirectionalLight.castShadow` is set a few lines later, so a player who
		// had chosen `low` and come back got both passes anyway until they
		// touched the setting.
		//
		// This is the last of the two constructions, so one call here covers
		// both. `probe-occlusion.mjs`'s cold-boot row is the check, and it goes
		// red on this line alone being removed.
		this.setOcclusion();
		// Kept as a field so `perf-panel.ts` can switch it live. A full-screen
		// multi-pass blur at up to 2x device pixel ratio is a fixed cost every
		// frame whatever is on screen, so it is the first thing to price against
		// a shader that is only expensive when a body fills the view.
		this.bloomPass = new UnrealBloomPass(
			bloomResolution(),
			EXPOSURE.bloom.strength,
			EXPOSURE.bloom.radius,
			EXPOSURE.bloom.threshold,
		);
		this.composer.addPass(this.bloomPass);
		// Kept as a field for the same reason `bloomPass` is: the vignette is set
		// per frame from the view, and the dither has a control arm a probe
		// switches. #200.
		this.outputPass = new SeeliteOutputPass();
		// **The stored choice, applied here and not only on change.** The
		// subscription below fires on a *difference*, and `applied` starts at the
		// loaded settings — so a player who turned the dither off and came back
		// got it on again, silently, until they toggled it twice. The samples and
		// the vignette do not need this line and it is worth saying why: the
		// composer is constructed from `antialias` a few lines above, and the
		// frame loop reads `vignette` on every frame beside the view.
		this.outputPass.setDither(this.settings.value.dither === "on");
		this.composer.addPass(this.outputPass);

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
			onRequestAction: (action, id) => this.actOnRequest(action, id),
			onStationAction: (type, name) => {
				const action: StationAction =
					type === "buy-fuel"
						? { type }
						: type === "buy-equipment"
							? { type, equipment: name }
							: { type, commodity: name };
				this.transactStation(action);
			},
			// A refused press holds the launch, and the hold is on the console, so
			// both outcomes repaint (#314).
			onLaunch: () => {
				this.launch();
				this.updateCockpit();
			},
			onCancelLaunch: () => {
				this.cancelLaunch();
				this.updateCockpit();
			},
			onChartHost: (host) => this.setChartHost(host),
		});
		window.addEventListener("resize", () => {
			// A different window size is a different number of pixels, so every
			// period in the ring and every point on the curve was measured
			// against a frame that no longer exists.
			this.primeAdaptive("resized");
			this.onResize();
		});
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
			if (next.renderScale !== applied.renderScale) {
				// Leaving Auto is synchronous: the player's number is already
				// in hand, and only *entering* needs the sampler that
				// `applyResolutionMode` awaits.
				if (next.renderScale !== "auto") this.adaptive = null;
				void this.applyResolutionMode();
				this.onResize();
			}
			if (next.quality !== applied.quality) this.applyQuality();
			// #200's three rows. The sample count reallocates both composer
			// buffers, so it is guarded by the same comparison and for the same
			// reason as the resolution. The vignette needs no line here at all:
			// the frame loop reads it from the settings on every frame, because
			// it already reads the view there.
			if (next.antialias !== applied.antialias) this.setComposerSamples();
			if (next.dither !== applied.dither)
				this.outputPass.setDither(next.dither === "on");
			// #201's occlusion, on its own row. `setOcclusion` re-reads **both**
			// terms from their owners rather than taking the one that changed, so
			// this call rewrites `castShadow` from the lighting row on its way
			// past. In the idle state that makes an occlusion toggle bring an
			// idled shadow back — a cross-row effect, measured and printed by
			// `probe-occlusion.mjs` and owned by node #233 along with the
			// unreachable restore behind it.
			if (next.ao !== applied.ao) this.setOcclusion();
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
				this.primeAdaptive("pixel ratio changed");
				this.onResize();
				this.combatRig?.onResize();
				watchRatio();
			};
			q.addEventListener("change", once);
		};
		watchRatio();
		// Once at boot, so the renderer and the composer cannot be given a ratio
		// in only one place.
		this.onResize();
		// A hidden tab is already a non-action inside the controller; this is
		// the other half, which is that the frame period spanning the absence is
		// not a frame period at all. Its first mark on return is separated from
		// its last by however long the person was away.
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible")
				this.primeAdaptive("tab restored");
		});
		this.renderer.domElement.addEventListener("webglcontextrestored", () =>
			this.primeAdaptive("context restored"),
		);
		// The saved row may already say `"auto"`, and nothing else starts it:
		// the subscription above only fires on a change.
		void this.applyResolutionMode();
		window.addEventListener("keydown", (e) => this.onKey(e, true));
		window.addEventListener("keyup", (e) => this.onKey(e, false));
		// Audio cannot open before a gesture, so it opens on the first one.
		this.renderer.domElement.addEventListener("pointerdown", (e) => {
			if (e.button === 0) this.mouseFiring = true;
		});
		window.addEventListener("pointerup", (e) => {
			if (e.button === 0) this.mouseFiring = false;
		});
		// A window that loses focus never sees the release, and a trigger stuck
		// down survives the tab switch.
		window.addEventListener("blur", () => {
			this.mouseFiring = false;
		});
		// **A key unlocks the sound as well as a click**, because #283's pad
		// notice tells the player so: "press any key or click once to enable
		// sound". Only the pointer path existed, so a player who did what the
		// line said got no context and no second notice — the once-only flag was
		// already spent. Sage found it, round 4. Both are *activation triggering
		// input events* as the HTML specification lists them, which is exactly
		// what a gamepad button is not.
		const unlockAudio = () => {
			this.audio.ensure();
			// **Only once it worked.** Removing both paths unconditionally spent
			// them on any keystroke — Escape first, and every later key and click
			// found no listener while the context stayed suspended. Sage found it,
			// round 5. `silent` is the context's own state, so this asks whether
			// the unlock happened rather than whether it was attempted.
			if (this.audio.silent) return;
			window.removeEventListener("pointerdown", unlockAudio);
			window.removeEventListener("keydown", unlockAudio);
		};
		window.addEventListener("pointerdown", unlockAudio);
		window.addEventListener("keydown", unlockAudio);
		// Pointer lock on click, Escape to release — the browser's own contract,
		// and the only way to get relative mouse deltas that do not stop at the
		// edge of the window. Keyboard steering stays live throughout, so a
		// player who never clicks can still fly.
		//
		// **And only where the mouse flies the ship** (#371): `pointerLockMove`'s
		// answer, asked of the surface read afresh rather than through the cached
		// one, because a click can land in the same frame that drew the console it
		// was aimed at and the cached answer is the frame's.
		this.renderer.domElement.addEventListener("click", () => {
			const consoleDrawn = this.consoleIsDrawn();
			if (
				pointerLockMove(
					this.readPadContext(consoleDrawn),
					consoleDrawn,
					this.canvasHoldsLock(),
				) !== "capture"
			)
				return;
			// **A refusal is read, not thrown** — it is the ordinary case, not the
			// exceptional one: Chrome holds out after the player's own Escape and
			// past a rate limit whatever the reason, a window that is not the key
			// window cannot be locked at all, and Safari refuses outright without a
			// gesture it may or may not have just seen. Dropping the promise made
			// every refused click an unhandled rejection, which surfaces as a page
			// error — which is why `probe-gun-feedback.mjs` had to stub this call
			// out to keep its own click real. **And the promise is not assumed:**
			// the returning form of this call is not universal, and on an engine
			// that hands back `undefined` a `.catch` taken straight off it is the
			// very uncaught error this line exists to remove. TypeScript cannot see
			// that, because its own `lib.dom` declares the Promise. The retry is the
			// next click, which is where we are standing.
			void Promise.resolve(this.renderer.domElement.requestPointerLock()).catch(
				() => {},
			);
		});
		window.addEventListener("mousemove", (e) => {
			if (!this.canvasHoldsLock()) return;
			this.mouseDx += e.movementX;
			this.mouseDy += e.movementY;
		});

		// #207's three relief programs per class, compiled before the first frame
		// and **after the composer**, which is what makes them the variants the
		// game will actually use (sage, PR #254).
		this.prewarmReliefPrograms();

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
				// **The station's own berth draw**, not the default: the drawn bay
				// and the sim's catalogue have to agree about which side an
				// outpost's seeded berth is on, and a mesh built at seed 0 while
				// `interiorOfStation` reads `station.berthSeed` puts the ship on a
				// berth with no pad under it.
				const built = buildStationMesh(
					station.type,
					body.color,
					station.berthSeed,
					station.assemblySeed,
				);
				mesh = built.root;
				// **E10's other half.** `station-mesh.ts` built the shields as
				// geometry and supplied no pixels, because that module is
				// headless-tested with no `document` reference in it. The renderer
				// is where a canvas is allowed to exist, so the name is drawn here
				// — once per station at build, not per frame: the name never
				// changes, and #109 makes it a fixed-slot seeded value that does
				// not move.
				paintNameplates(built, this.nameOfStation(body.id));
				// #201. After the nameplates, so the plates — `MeshBasicMaterial`,
				// a lit sign — are already in the subtree the rule refuses them
				// from rather than being added behind the walk's back.
				this.markedOcclusion.push([
					`station-${station.type}`,
					markOcclusion(built.root),
				]);
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
		// The warm-up is **not** called here, and that is deliberate: this runs
		// before the composer exists, and a program compiled with no render
		// target bound is keyed to the default framebuffer's colour space rather
		// than the composer target's (sage, PR #254). The constructor and the
		// jump path both call it once the composer is up.
	}

	/**
	 * Compile all three of #207's relief programs for every class in this
	 * system, at system build, so a band change in flight never hitches.
	 *
	 * A path is a `#define`, so each band is a different program and the first
	 * frame that selects one pays its compile. That frame is the one a body
	 * crosses a threshold on, which is a frame the player is looking at the
	 * body — the worst possible place to spend a compile.
	 *
	 * **`renderer.compile` on the live scenes, not on a hidden mesh.** The node
	 * suggested a hidden one, and an earlier version of this comment rejected
	 * that by claiming three skips invisible objects — which is false, and sage
	 * caught it (PR #254). `WebGLRenderer.compile` uses `traverseVisible` only to
	 * gather lights; materials are initialised through a plain `scene.traverse`,
	 * so a hidden mesh would have compiled perfectly well.
	 *
	 * The real reason is smaller and holds: the bodies are already here, already
	 * carry the right class, and are the exact materials the frame loop will
	 * switch. A hidden stand-in is a second thing to build, keep in step with
	 * the class roster, and dispose — for a warm-up that costs the same either
	 * way.
	 *
	 * Every body is put back on the path it had, which on a fresh system is
	 * four-tap for all of them; `render` selects the real band on the first
	 * frame. The cost is three compiles per *class* rather than per body,
	 * because `cachedFragment` keys on class and path and three's own program
	 * cache keys on the source string.
	 */
	/**
	 * Draw at most `BAKE_FACES_PER_FRAME` cube faces, oldest bake first.
	 *
	 * The queue is drained rather than scanned: an entry whose body is gone, or
	 * whose bake has finished or been replaced, reports nothing left to draw and
	 * is dropped without spending any of the budget. So a stale entry costs one
	 * map lookup on the frame it surfaces, and the budget is only ever spent on
	 * a face that actually lands.
	 */
	/**
	 * Start a bake for one body and put it on the schedule.
	 *
	 * **One entry point, because the two halves are one act.** `startBake` on the
	 * handle allocates the cubes and the material; the queue is what draws into
	 * them. A caller that did the first without the second gets a bake that never
	 * fills — and it fails *quietly*, because the body keeps drawing from the
	 * cube it already had. That is exactly how two of `probe-planet-surfaces.mjs`'s
	 * own checks came to compare a cube against itself and report determinism.
	 *
	 * Public because the probe drives it: proving a bake is deterministic means
	 * baking a second time on demand, which nothing in the game asks for.
	 */
	rebake(id: string, facePx: number) {
		const visual = this.bodyVisuals.get(id);
		if (!visual?.canBake()) return;
		visual.startBake(facePx);
		this.bakeFacePx.set(id, facePx);
		this.bakeQueue.push(id);
	}

	private stepBakes() {
		let budget = BAKE_FACES_PER_FRAME;
		while (budget > 0 && this.bakeQueue.length > 0) {
			const id = this.bakeQueue[0];
			const visual = id === undefined ? undefined : this.bodyVisuals.get(id);
			if (!visual?.stepBake(this.renderer)) {
				this.bakeQueue.shift();
				continue;
			}
			budget--;
		}
	}

	private prewarmReliefPrograms() {
		// **Bound to the composer's target, because the colour space is in the
		// program's cache key** (sage, PR #254). `getProgramCacheKeyParameters`
		// pushes `outputColorSpace`, and `getParameters` derives it as the
		// renderer's own when no target is bound and `LinearSRGBColorSpace` when
		// one is. Every planet is drawn by a `RenderPass` into the composer's
		// target, so a warm-up with nothing bound compiles a variant the game
		// never uses and leaves the real one to compile on the first crossing —
		// a warm-up that is *entirely* wasted, with a green build behind it.
		const wasTarget = this.renderer.getRenderTarget();
		this.renderer.setRenderTarget(this.composer.renderTarget1);
		// The roster from the module that owns it. A second exhaustive list here
		// is how the instrument's copy went stale for a commit (sage, PR #254).
		// **The bake off for the relief walk** (#208). `applyReliefBand` swaps the
		// *procedural* material's program, and a body already drawn from a cube
		// would have the walk change a shader nothing is rendering — so `compile`
		// would not see the variant and the warm-up would silently do nothing for
		// that body. Nothing is baked this early on the boot path; it is the jump
		// path, where the previous system's bodies were, that this is for.
		this.setBakeAllowed(false);
		const paths = RELIEF_PATHS;
		const before = new Map<string, ReliefPath>();
		for (const [id, visual] of this.bodyVisuals)
			before.set(id, visual.reliefPath());
		for (const path of paths) {
			// `applyReliefBand`, not `setReliefPath`: the warm-up is the frame
			// loop's own work brought forward, and pinning every body during it
			// would switch #207's selector off for the whole session.
			for (const visual of this.bodyVisuals.values())
				visual.applyReliefBand(path);
			for (const [scene, camera] of [
				[this.farScene, this.farCamera],
				[this.approachScene, this.approachCamera],
				[this.nearScene, this.nearCamera],
			] as const)
				this.renderer.compile(scene, camera);
		}
		for (const [id, visual] of this.bodyVisuals) {
			const was = before.get(id);
			if (was) visual.applyReliefBand(was);
		}
		/**
		 * And the baked programs (#208), which the loop above cannot reach.
		 *
		 * `applySurfaceBand("baked")` refuses while the cube is incomplete, and at
		 * this point in the boot every cube is — the bake has not had a frame yet.
		 * That refusal is right for drawing and wrong here, so `prewarmBaked`
		 * attaches the material past it and hands back the undo. Compiling against
		 * an unfilled cube is safe: `compile` does not draw.
		 *
		 * One compile per class, like the loop above, because the source string is
		 * what three's program cache keys on.
		 */
		this.setBakeAllowed(true);
		// The **bake** programs, which nothing above reaches: they draw a quad
		// into a cube target and are not in any of the three scenes. Left to the
		// first `stepBakes` they would compile on the frame after a jump, which
		// is the frame the node says must not stall.
		for (const visual of this.bodyVisuals.values())
			visual.prewarmBake(this.renderer);
		const restores: (() => void)[] = [];
		for (const visual of this.bodyVisuals.values()) {
			const undo = visual.prewarmBaked();
			if (undo) restores.push(undo);
		}
		if (restores.length > 0) {
			for (const [scene, camera] of [
				[this.farScene, this.farCamera],
				[this.approachScene, this.approachCamera],
				[this.nearScene, this.nearCamera],
			] as const)
				this.renderer.compile(scene, camera);
			for (const undo of restores) undo();
		}
		this.renderer.setRenderTarget(wasTarget);
	}

	/**
	 * The rig that lights whatever `buildBodies` drew — **once per `Game`, and
	 * not once per system** (#187).
	 *
	 * Split out of `buildBodies` because a jump calls that a second time and
	 * this must not run again: `layerLights` is a `push`, and the suns and
	 * hemispheres are `scene.add`ed, so a second pass would double every light
	 * in every layer and the symptom would be a system that is simply twice as
	 * bright as the one before it. Nothing here is per-system — a directional
	 * light has no position, only a direction, and the direction is aimed at
	 * the star every frame — which is exactly why the split is safe.
	 *
	 * The one part that *is* per-system is the baked environment, whose tint
	 * comes from the star's own colour; `buildEnvironment` is called again on a
	 * jump and disposes what it replaces.
	 *
	 * The `layerLights` docstring said "built once by `buildLights`" while the
	 * loop lived in `buildBodies`. The method exists now.
	 */
	private buildLights() {
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

		// **#201: one shadow-casting light in the game, and it is the near
		// layer's sun.** The far and approach suns are left alone — a planet
		// three astronomical units away has nothing in front of it to receive,
		// and its own surface shader never samples a shadow map in any case
		// (`planet-surface.ts` is a `ShaderMaterial`; the environment does not
		// reach it either, for the same reason).
		//
		// The cockpit's two point lights are left alone too, and that is a
		// decision rather than an omission: a point light's shadow is six
		// renders of the scene into a cube, per light, per frame. The sun is the
		// direction the cabin was missing.
		const nearSun = this.layerLights.find(
			(rig) => rig.scene === this.nearScene,
		);
		if (nearSun) {
			this.shadowSun = nearSun.sun;
			this.shadowSun.shadow.mapSize.set(SHADOW_MAP_TEXELS, SHADOW_MAP_TEXELS);
			// **A target of its own, in the scene.** Every other light here aims
			// by `position` alone against the default target at the origin, which
			// works because a directional light's *direction* is all three layers
			// read. A shadow camera reads the position as well: it stands at the
			// light and looks at the target, so a subject that is not at the
			// origin — a station four kilometres away — needs the pair moved
			// together. `render` sets both, and the direction between them stays
			// exactly `STAR_DIR`, so nothing about the lighting changes.
			this.shadowTarget.name = "sun-shadow-target";
			this.nearScene.add(this.shadowTarget);
			this.shadowSun.target = this.shadowTarget;
			// `up` is set per frame in `fitShadowCamera`, not here: three's
			// shadow camera is aimed with `lookAt`, which is degenerate when the
			// view direction is parallel to `up` — and the view direction here is
			// the star's, which sweeps the whole sphere as the ship crosses a
			// system.
			//
			// **The stored choice is applied where the composer is built, not
			// here**, and the difference took a red build to establish. Both
			// passes were on at boot whatever the player had saved — the shadow
			// because `buildEnvironment` ends with `applyQuality` before this
			// block assigns `shadowSun`, the ambient occlusion because the
			// composer does not exist yet either — and the obvious repair was a
			// `setOcclusion()` at each of the two sites. It is one call, at the
			// later of them: by the time the composer has its pass this field is
			// long since set, so a call here is inert. Deleting it leaves
			// `probe-occlusion.mjs`'s cold-boot row green, which is how that was
			// found and why it is not here.
		}
	}

	/** The near layer's sun, once `buildLights` has given it a shadow camera —
	 *  the one shadow-casting light in the game (#201). */
	private shadowSun: THREE.DirectionalLight | null = null;
	/** What that sun looks at. Moved to the fitted subject's centre each frame;
	 *  `buildLights` says why a target object is needed at all. */
	private readonly shadowTarget = new THREE.Object3D();
	/** Scratch for the frame's subject list, so a render allocates no array. */
	private readonly shadowCandidates: ShadowSubject[] = [];

	/** The two star-aimed lights of each layer, with the scene they belong to.
	 *  Built once by `buildLights` — once per `Game` and not per system, which
	 *  is what that method's docstring is about — and read every frame. */
	private readonly layerLights: {
		scene: THREE.Scene;
		sun: THREE.DirectionalLight;
		hemisphere: THREE.HemisphereLight;
	}[] = [];

	/** What `shadowMap.autoUpdate` was before the ambient-occlusion pass pinned
	 *  it, so the pass restores the renderer's setting rather than assuming it
	 *  was on (#201). */
	private shadowAutoUpdate = true;

	/** #201's ambient-occlusion pass, kept as a field for the reason `bloomPass`
	 *  is: the quality gate enables and disables it per frame, and
	 *  `measure-occlusion-cost.mjs` needs the same switch without going through
	 *  the settings store. Built with the composer. */
	private gtaoPass!: GTAOPass;

	/** The baked lighting environment, kept so the quality setting can put it
	 *  back after dropping it — `scene.environment = null` is how low drops it,
	 *  and the texture has to survive that to be reassigned.
	 *
	 *  **Baked per system, from that system's own star.** It was baked once per
	 *  `Game` while there was no path that changed the system a game is in;
	 *  `rebuildSystem` calls `buildEnvironment` again on every jump (#187),
	 *  which is why that method disposes what it is replacing rather than
	 *  assuming it is the first call. */
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
		// The cabin half (#105), and the same rule for the same reason: one
		// answer for every plated surface in the game rather than one per
		// surface. `cockpit-surface.ts` owns what a cabin surface costs.
		applyCockpitQuality(this.settings.value.quality);
		// #201's two passes. A call rather than two lines here for
		// `setComposerSamples`'s reason: an instrument that priced them by moving
		// the player's setting would write `localStorage` and notify every other
		// listener, and each term has to be movable on its own to be priced apart
		// from the other.
		this.setOcclusion();
	}

	/**
	 * Turn #201's shadow map and ambient occlusion on or off — **one row each**
	 * by default, an explicit pair for an instrument. The shadow reads the
	 * lighting row through `LIGHT_RIG.quality`; the occlusion reads its own `ao`
	 * row, which is the whole of what the principal's ruling changed.
	 *
	 * The shadow gate is `castShadow` on the one light rather than
	 * `renderer.shadowMap.enabled`. **Both are program keys and the difference
	 * is not that one is free** — that is what an earlier version of this
	 * paragraph claimed, and it is wrong: `WebGLLights` counts shadow-casting
	 * directional lights, `WebGLPrograms` puts `numDirLightShadows` in the cache
	 * key, so flipping the light's flag also lands on a shader variant the
	 * context may not have built yet. What it buys is *which* variants: the two
	 * this setting moves between are the two the game already draws, so the pair
	 * is compiled once each and switching thereafter is a cache hit, while
	 * `shadowMap.enabled` is a renderer-wide flag whose effect on the frame was
	 * measured and is larger than the pass it gates —
	 * `probe-ship-visuals.mjs`'s seam row and `probe-navigation-console.mjs`'s
	 * frame count both moved when it alone was flipped.
	 */
	setOcclusion(shadows?: boolean, ao?: boolean) {
		this.occlusionWanted = {
			shadows:
				shadows ?? LIGHT_RIG.quality[this.settings.value.quality].shadows,
			// The player's own row since the principal's ruling on #235, not the
			// lighting key. `light-rig.ts` says why the two were separated, and
			// #241's gate sits in front of both of them either way: a row says
			// whether the player wants the term at all, the gate says whether
			// this frame is one where it shows anything.
			ao: ao ?? this.settings.value.ao === "on",
		};
		// **An explicit argument pins the pass past #241's gate, and a bare call
		// un-pins it.** `probe-occlusion.mjs` and
		// `scripts/measure-occlusion-cost.mjs` both name the arm they are
		// measuring, and a gate that overrode them would silently re-arm the
		// control: an instrument asking for "shadow on" in empty space would
		// measure the gate refusing, and report the pass as free. `undefined`
		// rather than `arguments.length` so a caller reading the signature can
		// see which half it is pinning.
		this.occlusionPinned = shadows !== undefined || ao !== undefined;
		this.applyOcclusion();
	}

	/**
	 * Pin every planet's surface program, or hand them back to the bands.
	 *
	 * **`"baked"` is a pinnable path** (#208), which is what lets an instrument
	 * take a reading inside a band the selector would refuse — the `planet-fill`
	 * capture the resolution finding owes, and the 2 radii and 1.02 radii cells
	 * of the ablation ladder. It is still refused where there is no complete
	 * cube, so an instrument settles the bake queue first and reads the path
	 * back.
	 *
	 * **The same shape as `setOcclusion`, and for the same reason**, which the
	 * comment above states in full: an instrument that names an arm must not
	 * have the frame loop overwrite it. Here the failure would be quieter than
	 * the occlusion one. `measure-planet-cost.mjs` sets a path through
	 * `setSurfaceAndRelief` and then reads the `?fps` line; with a per-frame
	 * selector running, the very next frame would put the path back and the
	 * table would print the *selector's* choice under the arm's label, in every
	 * cell, with nothing red anywhere. That is the trap this file already
	 * records for the vignette, where a probe measured its own assignment being
	 * overwritten.
	 *
	 * `null` un-pins. A pinned path is written once, here, rather than every
	 * frame: the recompile is the expensive part and a pin does not change.
	 */
	setSurfacePin(path: SurfacePath | null) {
		if (path === null) {
			for (const visual of this.bodyVisuals.values()) visual.unpinSurface();
			return;
		}
		for (const visual of this.bodyVisuals.values()) visual.setSurfacePath(path);
	}

	/**
	 * Take the baked program off the menu for every body, or put it back (#208).
	 *
	 * **Not a pin**, which is the whole reason it is a second entry point beside
	 * `setReliefPin`. `baked: off` is a control arm — it says "measure the same
	 * body with #207's bands still choosing" — and pinning would switch the
	 * selector off along with the thing being measured, which is the confound
	 * `measure-light-cost.mjs` records under a different name.
	 *
	 * A body already drawn from a cube reverts on the call rather than on the
	 * next band crossing, because an arm that landed several seconds later would
	 * be attributed to whatever the instrument did next.
	 */
	setBakeAllowed(allowed: boolean) {
		for (const visual of this.bodyVisuals.values())
			visual.setBakeAllowed(allowed);
	}

	/**
	 * Write the two flags from the player's row, the pin, and #241's gate.
	 *
	 * **Both guards are real and both have a call site that follows them.**
	 * `applyQuality` runs from `buildEnvironment`, which is inside `buildLights`
	 * — before the sun is wired and long before the composer exists — so on the
	 * boot path this runs twice against two null fields. Each field's own
	 * construction site calls `setOcclusion` again, which is what makes the
	 * player's saved setting arrive. Neither guard is a "harmless" skip:
	 * dropping either call site leaves that pass on at boot whatever was saved,
	 * and nothing in the frame says so.
	 *
	 * The gate is an `&&` rather than a third state: `quality: low` still turns
	 * both passes off outright, and the gate only ever declines work that
	 * `quality: high` would otherwise pay for nothing.
	 */
	private applyOcclusion() {
		const gated = this.occlusionPinned || this.occlusionGate.open;
		if (this.shadowSun)
			this.shadowSun.castShadow = this.occlusionWanted.shadows && gated;
		if (this.gtaoPass) this.gtaoPass.enabled = this.occlusionWanted.ao && gated;
	}

	/**
	 * What the gate is doing, for a probe and for an instrument — #241.
	 *
	 * A read-only view rather than four public fields, and no permanent HUD
	 * element: the four numbers a check needs are the row's answer, whether an
	 * instrument has pinned it, whether the gate is open, and the enclosure the
	 * gate read. Without this, `probe-occlusion.mjs`'s cold-boot arms could only
	 * see the two flags — and with a gate in front of them, a saved `high` in
	 * open space produces the same two `false`s as a saved `low`, so the arm
	 * that caught #201's boot bug twice would stop being able to.
	 */
	get occlusionState() {
		return {
			wanted: this.occlusionWanted,
			pinned: this.occlusionPinned,
			open: this.occlusionGate.open,
			pending: this.occlusionGate.pending,
			enclosureRad: enclosureRad(this.stationSubjects),
		};
	}

	/** What the player's row and any instrument pin ask for, before #241's gate
	 *  is applied to it. */
	private occlusionWanted = { shadows: false, ao: false };
	/** Whether an instrument named both halves explicitly, which wins over the
	 *  gate for as long as it is held. */
	private occlusionPinned = false;
	/** #241's gate, advanced once per frame in `render`. */
	private occlusionGate: OcclusionGate = CLOSED_GATE;
	/** This frame's near-layer stations, as shadow subjects. Built once at the
	 *  top of the shadow work and read by both the gate and `fitShadowCamera`,
	 *  because `subjectOf` walks a mesh's world matrix and doing it twice a
	 *  frame for the same station buys nothing. */
	private readonly stationSubjects: ShadowSubject[] = [];

	/**
	 * The near-layer stations, as shadow subjects, into the scratch array.
	 *
	 * Neither the cabin nor the player hull is one, and that is #241's whole
	 * point rather than an omission: the cabin is visible in every cockpit frame,
	 * so a gate that counted it would never close; and #233 measures the
	 * exterior shadow on the hull alone as *absent* rather than small —
	 * `mean|d|` 0.0000 at 20, 12 and 8 radii on a threshold-free column.
	 */
	private buildStationSubjects() {
		const into = this.stationSubjects;
		into.length = 0;
		for (const [id, layer] of this.layers) {
			if (layer !== "near") continue;
			const mesh = this.stationVisuals.get(id)?.root;
			if (mesh) into.push(subjectOf(mesh));
		}
		return into;
	}

	/**
	 * Re-gate the composer's multisampling — #200.
	 *
	 * A method rather than a line in the settings subscription because
	 * `probe-output-stage.mjs` and `scripts/measure-light-cost.mjs` both need the
	 * *same* switch with a count they name: a claim about antialiasing measured
	 * by moving the player's setting would move it through the store, notify
	 * every other listener, and write it to `localStorage`. The default argument
	 * is the player's row; an explicit one is a control arm.
	 */
	setComposerSamples(samples: number = this.settings.value.antialias) {
		// Clamped to what *this* context will multisample a half-float target at,
		// which is not what `MAX_SAMPLES` answers for. `output-stage.ts` has the
		// argument; the short version is that a count this context cannot grant
		// leaves the framebuffer incomplete and the frame black.
		// Called before the composer exists on some paths — a `!` here would
		// throw on boot. Harmless rather than a hole: the composer is *built* at
		// the player's count a few lines after the lights, from the same field.
		if (!this.composer) return;
		// Both buffers, because `EffectComposer` swaps them: multisampling one
		// would antialias alternate passes and read as a flicker rather than as a
		// missing term.
		setComposerSamples(
			[this.composer.renderTarget1, this.composer.renderTarget2],
			grantedSamples(this.renderer, samples),
		);
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
		const visual = this.bodyVisuals.get(body.id);
		visual?.setLayer(layer);
		/**
		 * A body with no cube at all gets one started, at the smallest size (#208).
		 *
		 * **Not sized by the layer**, which is where the first version of this
		 * looked and was wrong in a way nothing rendered differently:
		 * `massiveLayerFor` admits a massive body to `approach` or `far` and never
		 * to `near`, so a per-layer table gave every planet in the game the small
		 * cube however close it got and the large rung was never allocated at all.
		 * The size follows apparent size and is chosen in `render`, where the
		 * apparent size is; this only has to make sure something exists to
		 * pre-warm and to draw from before the first frame runs.
		 */
		if (!this.bakeFacePx.has(body.id)) this.rebake(body.id, BAKE_FACE_SIZES[0]);
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
		// Every role's station maps now, beside the hull's: built lazily they
		// land inside a jump's populate, 32-47 ms a role under `worn`.
		warmStationMaps();
		this.shipMesh.name = "ship";
		// #201. Once at build, not per frame: a hull's materials do not change
		// class after it is built, and the walk is a full traverse.
		this.markedOcclusion.push(["ship", markOcclusion(this.shipMesh)]);
		this.nearScene.add(this.shipMesh);
		if (this.fleetReview) {
			this.buildFleetReview();
			// **After the review's hulls exist, and it is not decoration.** An
			// unmarked mesh has `castShadow` false, and `hideNonOccluders` reads
			// exactly that flag — so a review hull would be hidden from the
			// ambient occlusion's own G-buffer as well as casting nothing, and
			// the mode that exists to compare hulls side by side would compare
			// them under a different renderer from the one the game ships.
			for (const parked of this.fleet)
				this.markedOcclusion.push([
					`fleet-${parked.mesh.name || "hull"}`,
					markOcclusion(parked.mesh),
				]);
		}
	}

	private openPlayerTrafficEvent(
		stationId: string,
		kind: TrafficArbitrationEvent["kind"],
		fromS: number,
		movement?: "arrival" | "launch",
		hull?: HullEnvelope,
	) {
		if (
			this.trafficPlayerTimeline.some(
				(event) =>
					event.stationId === stationId &&
					event.kind === kind &&
					event.toS === Number.POSITIVE_INFINITY,
			)
		)
			return;
		this.trafficPlayerTimeline.push({
			stationId,
			kind,
			fromS,
			toS: Number.POSITIVE_INFINITY,
			participant: { kind: "player" },
			...(kind === "lane" ? { committed: true } : {}),
			...(movement ? { movement } : {}),
			...(hull ? { hull } : {}),
		});
	}

	private closePlayerTrafficEvent(
		stationId: string,
		kind: TrafficArbitrationEvent["kind"],
	) {
		for (let i = this.trafficPlayerTimeline.length - 1; i >= 0; i--) {
			const event = this.trafficPlayerTimeline[i];
			if (
				event.stationId === stationId &&
				event.kind === kind &&
				event.toS === Number.POSITIVE_INFINITY
			) {
				event.toS = this.world.gameTime;
				return;
			}
		}
	}

	/** Retain exactly the event horizon the pure current/previous-visit replay can read. */
	private pruneTrafficTimelines(gameTime: number) {
		let oldestReplayS = gameTime;
		for (const actor of this.trafficActors) {
			const schedule = trafficScheduleAt(actor, gameTime);
			const departureAtS =
				schedule.desired === "away"
					? schedule.boundaryS
					: schedule.boundaryS - actor.schedule.awayS;
			oldestReplayS = Math.min(
				oldestReplayS,
				departureAtS - actor.schedule.cycleS,
			);
		}
		for (let i = this.trafficPlayerTimeline.length - 1; i >= 0; i--)
			if (this.trafficPlayerTimeline[i].toS < oldestReplayS)
				this.trafficPlayerTimeline.splice(i, 1);
		for (let i = this.trafficCarrierTimeline.length - 1; i >= 0; i--)
			if (this.trafficCarrierTimeline[i].toS < oldestReplayS)
				this.trafficCarrierTimeline.splice(i, 1);
	}

	/** Record or extend the physical lane interval a Carrier has already won. */
	private recordCarrierTrafficLane(
		projection: SystemTrafficProjection,
		toS: number,
	): TrafficArbitrationEvent | null {
		if (
			!projection.terminalStationId ||
			projection.laneStartedAtS === null ||
			(projection.phase !== "departing" && projection.phase !== "arriving")
		)
			return null;
		const movement = projection.phase === "departing" ? "launch" : "arrival";
		let existing: TrafficArbitrationEvent | undefined;
		for (let i = this.trafficCarrierTimeline.length - 1; i >= 0; i--) {
			const candidate = this.trafficCarrierTimeline[i];
			if (
				candidate.stationId === projection.terminalStationId &&
				candidate.participant.kind === "carrier" &&
				candidate.participant.key === projection.key &&
				candidate.movement === movement &&
				candidate.fromS === projection.laneStartedAtS
			) {
				existing = candidate;
				break;
			}
		}
		if (existing) {
			existing.toS = Math.max(existing.toS, toS);
			return existing;
		}
		const event: TrafficArbitrationEvent = {
			stationId: projection.terminalStationId,
			kind: "lane",
			fromS: projection.laneStartedAtS,
			toS,
			participant: { kind: "carrier", key: projection.key },
			movement,
			committed: true,
		};
		this.trafficCarrierTimeline.push(event);
		return event;
	}

	private disposeTrafficPresentation() {
		for (const contact of this.trafficContacts.values())
			this.unregisterContact(contact);
		for (const mesh of this.trafficMeshes.values()) {
			mesh.removeFromParent();
			disposeSubtree(mesh);
		}
		this.trafficContacts.clear();
		this.trafficMeshes.clear();
	}

	/** Reset presentation and transient authority when its system changes. */
	private clearTrafficPresentation() {
		this.disposeTrafficPresentation();
		this.trafficEngagements.clear();
		this.trafficRoutes.length = 0;
		this.trafficPlayerTimeline.length = 0;
		this.trafficCarrierTimeline.length = 0;
		this.trafficCruiseCache.clear();
		this.trafficBerthCache.clear();
		this.trafficColdActors.clear();
		this.trafficWarmIndex = 0;
		this.playerLaneRequests.clear();
		this.launchHold = null;
		this.berthOccupancy.clear();
		this.trafficTick = Number.NaN;
		this.trafficProjectionAtS = Number.NaN;
		this.trafficPreviousRoutes.clear();
		this.trafficPreviousProjectionAtS = Number.NaN;
		this.selectableCache = null;
		this.markerLabels.reset();
	}

	private ensureTrafficActors() {
		const index = this.world.system.record.index;
		if (this.trafficSystemIndex === index) return;
		this.clearTrafficPresentation();
		this.trafficSystemIndex = index;
		this.trafficActors = this.world.system.contents.stations
			.flatMap((station) => stationTrafficRoster(index, station))
			.sort((a, b) => compareCarrierKeys(a.key, b.key));
		// Before the first scheduled departure is the only parked state the
		// base schedule proves without replaying a physical visit. A later
		// `desired: parked` boundary is only intent: a delayed outbound trip may
		// still be away, so presenting it at home would invent both a ship and
		// an occupied berth until authority finishes warming.
		for (const actor of this.trafficActors)
			if (this.world.gameTime < actor.schedule.departureAtS)
				this.trafficColdActors.add(actor.key);
		this.refreshColdTraffic(this.world.gameTime);
	}

	/** Keep parked ships attached to their moving stations until hand-off: the
	 *  roster's cold carriers, and the diverted ones sitting out their repairs. */
	private refreshColdTraffic(gameTime: number, projectionSystem?: System) {
		this.trafficRoutes.length = 0;
		this.berthOccupancy.clear();
		this.trafficPreviousRoutes.clear();
		this.trafficPreviousProjectionAtS = Number.NaN;
		this.trafficProjectionAtS = gameTime;
		const system =
			projectionSystem ?? makeSystem(this.world.system.record, gameTime);
		for (const projection of this.divertedProjections(gameTime, system)) {
			this.trafficRoutes.push(projection);
			this.holdBerth(projection);
		}
		for (const actor of this.flyingTraffic()) {
			if (!this.trafficColdActors.has(actor.key)) continue;
			const projection = projectParkedTrafficActor({
				actor,
				gameTime,
				projectionSystem: system,
			});
			if (!projection.berthId) continue;
			this.trafficRoutes.push(projection);
			this.holdBerth(projection);
		}
	}

	/** One projection's berth, held at the station it is standing at, named for
	 *  whoever has to remember it.
	 *
	 *  `into` is the map the caller is dealing berths from: the saved one, or the
	 *  one a live authority tick is working through. There is one rule because
	 *  there is one fact — the berth a carrier is *drawn* in is the berth it
	 *  *holds* — and a rule dealt out of two copies is a rule that drifts. */
	private holdBerth(
		projection: SystemTrafficProjection,
		into: Map<string, Set<string>> = this.berthOccupancy,
	): string | null {
		const stationId = projection.terminalStationId;
		if (!projection.berthId || !stationId) return null;
		const held = new Set(into.get(stationId) ?? EMPTY_BERTHS);
		held.add(projection.berthId);
		into.set(stationId, held);
		return this.berthHoldKey(stationId, projection.berthId);
	}

	/** A berth named by the station it is in. Two holders of one berth have to
	 *  be able to say so, and the name is how a set answers that. */
	private berthHoldKey(stationId: string, berthId: string): string {
		return `${stationId}/${berthId}`;
	}

	/** Advance generated Traffic authority at the simulation boundary. */
	private updateTrafficAuthority() {
		this.ensureTrafficActors();
		const tick = Math.floor(this.world.gameTime * 10 + 1e-8);
		if (this.trafficWarmIndex < this.trafficActors.length) {
			const projectionSystem = makeSystem(this.world.system.record, tick / 10);
			this.refreshColdTraffic(tick / 10, projectionSystem);
			// Four equal slices share one 100-tick frame ceiling. Finishing a cheap
			// actor advances immediately instead of suppressing every Carrier for at
			// least one whole frame per roster entry.
			for (
				let slice = 0;
				slice < 4 && this.trafficWarmIndex < this.trafficActors.length;
				slice++
			) {
				const actor = this.trafficActors[this.trafficWarmIndex];
				const warmed = projectSystemTrafficAuthority({
					record: this.world.system.record,
					actor,
					gameTime: tick / 10,
					playerTimeline: this.trafficPlayerTimeline,
					cruiseCache: this.trafficCruiseCache,
					projectionSystem,
					cruiseTickBudget: 25,
				});
				if (!warmed.warmIncomplete) this.trafficWarmIndex++;
			}
			return;
		}
		if (tick !== this.trafficTick) {
			this.trafficTick = tick;
			this.trafficPreviousRoutes.clear();
			for (const route of this.trafficRoutes)
				this.trafficPreviousRoutes.set(route.key, route);
			this.trafficPreviousProjectionAtS = this.trafficProjectionAtS;
			this.trafficProjectionAtS = tick / 10;
			this.trafficRoutes.length = 0;
			this.pruneTrafficTimelines(tick / 10);
			const projectionSystem = makeSystem(this.world.system.record, tick / 10);
			const occupied = new Map<string, Set<string>>();
			for (const [stationId, state] of this.dockingStates) {
				if (!state.berthId) continue;
				const set = occupied.get(stationId) ?? new Set<string>();
				set.add(state.berthId);
				occupied.set(stationId, set);
			}
			const previousBerthByActor = new Map<
				CarrierKey,
				{ stationId: string; berthId: string }
			>();
			for (const route of this.trafficPreviousRoutes.values()) {
				if (!route.berthId) continue;
				const routeActor = this.trafficActors.find(
					(candidate) => candidate.key === route.key,
				);
				const stationId =
					route.terminalStationId ??
					(route.phase === "parked-home"
						? routeActor?.homeStationId
						: route.destinationStationId);
				if (!stationId) continue;
				const set = occupied.get(stationId) ?? new Set<string>();
				set.add(route.berthId);
				occupied.set(stationId, set);
				previousBerthByActor.set(route.key, {
					stationId,
					berthId: route.berthId,
				});
			}
			// Berths a diverted carrier is standing in, named so that nothing
			// dealing berths this tick can hand one out again. They are seeded into
			// `occupied` below, and a flying actor's own-berth cleanup must not
			// empty one: the struck ship's schedule still says it is away, so on
			// the tick of the strike the only thing marking that berth as held is
			// this seed, and a visitor already parked there would otherwise be
			// dealt it again with the struck hull drawn in it (sage #387).
			const divertedBerths = new Set<string>();
			const berthHeldByOther = (
				actorKey: CarrierKey,
				own: { stationId: string; berthId: string },
			) =>
				divertedBerths.has(this.berthHoldKey(own.stationId, own.berthId)) ||
				this.dockingStates.get(own.stationId)?.berthId === own.berthId ||
				[...previousBerthByActor].some(
					([key, candidate]) =>
						key !== actorKey &&
						candidate.stationId === own.stationId &&
						candidate.berthId === own.berthId,
				);
			const occupiedWithoutOwnPreviousBerth = (
				actorKey: CarrierKey,
			): ReadonlyMap<string, ReadonlySet<string>> => {
				const own = previousBerthByActor.get(actorKey);
				if (!own || berthHeldByOther(actorKey, own)) return occupied;
				const withoutOwn = new Map<string, ReadonlySet<string>>(occupied);
				const station = new Set(occupied.get(own.stationId) ?? EMPTY_BERTHS);
				station.delete(own.berthId);
				withoutOwn.set(own.stationId, station);
				return withoutOwn;
			};
			const playerTimeline = [
				...this.trafficPlayerTimeline,
				...this.trafficCarrierTimeline,
			];
			for (const [stationId, request] of this.playerLaneRequests)
				playerTimeline.push({
					stationId,
					kind: "lane",
					fromS: request.readyAt,
					toS: tick / 10 + 0.1,
					participant: { kind: "player" },
					movement: request.movement,
				});
			if (
				(this.dock.phase === "arriving" || this.dock.phase === "launching") &&
				this.dock.stationId
			)
				playerTimeline.push({
					stationId: this.dock.stationId,
					kind: "lane",
					fromS: 0,
					toS: tick / 10 + 0.1,
					participant: { kind: "player" },
					movement: this.dock.phase === "launching" ? "launch" : "arrival",
					committed: true,
				});
			const arbitrationTimeline = [...playerTimeline];
			const activeVisitFor = (actorKey: CarrierKey) => {
				const prior = this.trafficPreviousRoutes.get(actorKey);
				return prior &&
					prior.phase !== "parked-home" &&
					prior.visitDepartureAtS !== undefined &&
					prior.visitLaunchReadyAtS !== undefined &&
					prior.visitAwayOrdinal !== undefined
					? {
							departureAtS: prior.visitDepartureAtS,
							launchReadyAtS: prior.visitLaunchReadyAtS,
							awayOrdinal: prior.visitAwayOrdinal,
							homeBerthId: prior.visitHomeBerthId,
							outboundDepartureAtS: prior.visitOutboundDepartureAtS,
							outboundArrivalAtS: prior.visitOutboundArrivalAtS,
							returnDepartureAtS: prior.visitReturnDepartureAtS,
							returnArrivalAtS: prior.visitReturnArrivalAtS,
						}
					: undefined;
			};
			// **A diverted carrier holds its berth before anyone else is dealt
			// one.** Its schedule still says it is away on the leg it was pulled
			// off, so the flying actors would otherwise be handed berths from a
			// catalogue that does not know a ship is standing in one — and one
			// tick of that is two hulls drawn in one berth, with the
			// lower-priority one deleted a frame later. Seeded from the same projection it is
			// drawn with, so the berth it holds and the berth it is seen in are
			// one fact rather than two that have to agree.
			for (const projection of this.divertedProjections(
				tick / 10,
				projectionSystem,
			)) {
				this.trafficRoutes.push(projection);
				const held = this.holdBerth(projection, occupied);
				if (held) divertedBerths.add(held);
			}
			const baselines = this.flyingTraffic().map((actor) => ({
				actor,
				projection: projectSystemTrafficAuthority({
					record: this.world.system.record,
					actor,
					gameTime: tick / 10,
					playerTimeline: arbitrationTimeline,
					occupiedByStation: occupiedWithoutOwnPreviousBerth(actor.key),
					cruiseCache: this.trafficCruiseCache,
					berthCache: this.trafficBerthCache,
					recordBerthAssignments: false,
					projectionSystem,
					activeVisit: activeVisitFor(actor.key),
				}),
			}));
			const orderedActors = baselines.sort((a, b) => {
				const turn = (row: (typeof baselines)[number]) =>
					row.projection.laneRequest
						? {
								participant: row.projection.laneRequest.participant,
								readyAt: row.projection.laneRequest.readyAt,
								kind: row.projection.laneRequest.kind,
							}
						: {
								participant: { kind: "carrier" as const, key: row.actor.key },
								readyAt:
									row.projection.queueRequest?.readyAt ??
									Number.POSITIVE_INFINITY,
								kind: "clearance" as const,
							};
				return compareStationTurns(turn(a), turn(b));
			});
			const touchedBerthAssignments = new Set<string>();
			for (const { actor } of orderedActors) {
				const priorRoute = this.trafficPreviousRoutes.get(actor.key);
				const priorBerth = previousBerthByActor.get(actor.key);
				const priorBerthHeldByOther = priorBerth
					? berthHeldByOther(actor.key, priorBerth)
					: false;
				if (priorBerth && !priorBerthHeldByOther)
					occupied.get(priorBerth.stationId)?.delete(priorBerth.berthId);
				let activeVisit = activeVisitFor(actor.key);
				const projectActor = () =>
					projectSystemTrafficAuthority({
						record: this.world.system.record,
						actor,
						gameTime: tick / 10,
						playerTimeline: arbitrationTimeline,
						occupiedByStation: occupied,
						cruiseCache: this.trafficCruiseCache,
						berthCache: this.trafficBerthCache,
						berthCacheTouched: touchedBerthAssignments,
						projectionSystem,
						activeVisit,
					});
				let projection = projectActor();
				const visitFrom = (route: SystemTrafficProjection) =>
					route.visitDepartureAtS !== undefined &&
					route.visitLaunchReadyAtS !== undefined &&
					route.visitAwayOrdinal !== undefined
						? {
								departureAtS: route.visitDepartureAtS,
								launchReadyAtS: route.visitLaunchReadyAtS,
								awayOrdinal: route.visitAwayOrdinal,
								homeBerthId: route.visitHomeBerthId,
								outboundDepartureAtS: route.visitOutboundDepartureAtS,
								outboundArrivalAtS: route.visitOutboundArrivalAtS,
								returnDepartureAtS: route.visitReturnDepartureAtS,
								returnArrivalAtS: route.visitReturnArrivalAtS,
							}
						: undefined;
				// A schedule boundary is intent, not elapsed physical travel. A visit
				// first leaving a parked pose starts now; it may not replay a departure
				// that happened only on paper while another visit was still finishing.
				if (
					priorRoute?.phase === "parked-home" &&
					projection.phase !== "parked-home" &&
					projection.phase !== "launch-queued" &&
					(projection.departureStartedAtS ?? -Infinity) < tick / 10 - 0.05
				) {
					const nextVisit = visitFrom(projection);
					if (nextVisit) {
						activeVisit = {
							...nextVisit,
							homeBerthId: priorRoute.berthId ?? nextVisit.homeBerthId,
							launchReadyAtS: tick / 10,
							outboundDepartureAtS: undefined,
							outboundArrivalAtS: undefined,
							returnDepartureAtS: undefined,
							returnArrivalAtS: undefined,
						};
						projection = projectActor();
					}
				}
				// Queue promotion likewise starts an arrival at this authority tick.
				// Replaying its old ready time here skipped the visible tunnel in one
				// frame when a berth or lane finally became available.
				if (
					(priorRoute?.phase === "clearance-queued" ||
						priorRoute?.phase === "lane-queued") &&
					projection.phase !== "clearance-queued" &&
					projection.phase !== "lane-queued"
				) {
					const continuing = activeVisit ?? visitFrom(projection);
					if (continuing) {
						const returning =
							priorRoute.destinationStationId === actor.homeStationId;
						activeVisit = {
							...continuing,
							...(returning
								? { returnArrivalAtS: tick / 10 }
								: { outboundArrivalAtS: tick / 10 }),
						};
						projection = projectActor();
					}
				}
				/**
				 * **A settled Carrier keeps the berth it is settled in.**
				 *
				 * Once the prior route reads `parked-home`, `activeVisitFor` stops
				 * remembering the finished visit — correctly, it is over — and the
				 * projector replays it from the schedule instead. The replay's
				 * `launchReadyAtS` lands a tick earlier than the remembered one, and
				 * `readyAtS` is part of the berth-assignment cache key, so the next
				 * authority tick misses the cache and re-promotes a ship that has not
				 * moved. A promotion is free to answer with a different berth, and a
				 * parked ship then changes berths without moving.
				 *
				 * Measured at seed 54: `232:station-trade/traffic-03` parked in
				 * `deck-deep` at 1088.0 s under key `…|parked-home|774.1762186` and
				 * was re-promoted to `port-near` at 1088.1 s under
				 * `…|parked-home|774.0762186` — the same visit, the key 0.1 s apart.
				 *
				 * **This is older than the visitor berth and was masked by slack.**
				 * With one carrier per berth the re-promotion had a single candidate
				 * and returned the berth the ship was already in; #279 freed a berth
				 * and the allocator started answering differently. So the pin is here
				 * rather than on the cache key: a key that tolerated the wobble would
				 * hide the re-promotion instead of preventing it.
				 */
				if (
					priorRoute?.berthId &&
					projection.berthId &&
					projection.berthId !== priorRoute.berthId &&
					SETTLED_PHASES.includes(priorRoute.phase) &&
					SETTLED_PHASES.includes(projection.phase) &&
					priorRoute.terminalStationId === projection.terminalStationId
				) {
					// Written into the cache the projector already consults, and not
					// through `activeVisit`: a parked projection replays the finished
					// visit and takes its home berth from *that* replay
					// (`homeBerthId: previous?.berthId` in `station-route.ts`), which
					// overrides anything the caller supplies. The cache is the one
					// channel the promotion reads before it allocates.
					//
					// The keys are the ones this projection just touched, so the
					// rewrite lands on the decision that produced the move rather than
					// on a stale one. If the prior berth turns out to be held by
					// someone else, the collision pass below deletes the entry and
					// re-promotes — which is the same guard a genuine grant gets.
					// **Matched on the key's fields, not on a substring.** A berth id is
					// station-local — every station has a `deck-deep` — so a rewrite
					// keyed on the actor and the berth alone could land on this
					// actor's assignment at a *different* station that happens to name
					// the same berth. `station-route.ts` builds the key as
					// `record | actor | origin | destination | awayOrdinal | phase |
					// readyAtS`, and an actor key carries no `|`, so splitting is
					// exact.
					for (const key of touchedBerthAssignments) {
						const [, keyActor, , keyDestination] = key.split("|");
						if (
							keyActor === actor.key &&
							keyDestination === projection.terminalStationId &&
							this.trafficBerthCache.get(key) === projection.berthId
						)
							this.trafficBerthCache.set(key, priorRoute.berthId);
					}
					projection = projectActor();
				}
				const stationIdFor = (route: SystemTrafficProjection) =>
					route.terminalStationId ??
					(route.phase === "parked-home"
						? actor.homeStationId
						: route.destinationStationId);
				let stationId = stationIdFor(projection);
				// A cached historical grant is normally what prevents a Carrier from
				// swapping pods when current occupancy is replayed. If that grant now
				// collides with an older committed Carrier or the player's reservation,
				// however, it cannot remain authoritative: keeping it would draw two
				// ships on one pad and later make the lower-priority one disappear.
				if (
					projection.berthId &&
					stationId &&
					occupied.get(stationId)?.has(projection.berthId)
				) {
					for (const [key, berthId] of this.trafficBerthCache)
						if (
							berthId === projection.berthId &&
							key.includes(`|${actor.key}|`)
						)
							this.trafficBerthCache.delete(key);
					projection = projectActor();
					stationId = stationIdFor(projection);
				}
				this.trafficRoutes.push(projection);
				if (
					projection.terminalStationId &&
					(projection.phase === "departing" || projection.phase === "arriving")
				) {
					const event = this.recordCarrierTrafficLane(
						projection,
						tick / 10 + 0.1,
					);
					if (event && !arbitrationTimeline.includes(event))
						arbitrationTimeline.push(event);
				}
				if (projection.berthId) {
					if (stationId) {
						const set = occupied.get(stationId) ?? new Set<string>();
						set.add(projection.berthId);
						occupied.set(stationId, set);
					}
				}
			}
			for (const key of this.trafficBerthCache.keys())
				if (!touchedBerthAssignments.has(key))
					this.trafficBerthCache.delete(key);
			this.berthOccupancy.clear();
			for (const [stationId, berths] of occupied)
				this.berthOccupancy.set(stationId, berths);
		}
	}

	/** Convert a projected nose/up pair to the quaternion the ship mesh uses. */
	private trafficQuaternion(
		projection: Pick<TrafficProjection, "nose" | "up">,
		out: THREE.Quaternion,
	): boolean {
		if (!projection.nose) return false;
		this.trafficNose
			.set(projection.nose.x, projection.nose.y, projection.nose.z)
			.normalize();
		if (!projection.up) {
			out.setFromUnitVectors(this.trafficForward, this.trafficNose);
			return true;
		}
		this.trafficUp
			.set(projection.up.x, projection.up.y, projection.up.z)
			.normalize();
		this.trafficAttitude.lookAt(
			this.trafficOrigin,
			this.trafficNose,
			this.trafficUp,
		);
		out.setFromRotationMatrix(this.trafficAttitude);
		return true;
	}

	/** Synchronize contacts and meshes from authority without changing it. */
	private updateTrafficPresentation(cameraPos: Vec3) {
		// Flying poses remain at render time while their 10 Hz authority correction
		// is spread across the next six 60 Hz frames. Both endpoints are predicted
		// forward below; interpolating their stale absolute positions would put an
		// orbiting station's traffic one full tick behind the station itself.
		const spanS = this.trafficProjectionAtS - this.trafficPreviousProjectionAtS;
		const blend =
			Number.isFinite(spanS) && spanS > 0
				? Math.max(
						0,
						Math.min(
							1,
							(this.world.gameTime - this.trafficProjectionAtS) / spanS,
						),
					)
				: 1;
		this.trafficExactParked.clear();
		for (const projection of this.trafficRoutes) {
			const actor = this.trafficActors.find(
				(candidate) => candidate.key === projection.key,
			);
			if (!actor) continue;
			// Flown, not projected, while engaged; and a carrier that is not in the
			// world any more — destroyed, or a replacement still being built — is
			// not drawn from its stale route. **A diverted one is**, and from its
			// berth: `parked-home` is a place to be, not an absence.
			if (
				this.trafficEngagements.has(actor.key) ||
				!this.trafficShown(actor.key)
			)
				continue;
			const previous = this.trafficContacts.get(actor.key);
			const settled =
				projection.phase === "parked-home" ||
				projection.phase === "docked-away" ||
				projection.phase === "launch-queued";
			let presented: TrafficProjection = projection;
			if (settled && projection.terminalStationId && projection.berthId) {
				presented = parkedTrafficProjection(
					this.world.system,
					projection.terminalStationId,
					projection.berthId,
					actor,
					this.world.gameTime,
					this.interiorOf(projection.terminalStationId),
				);
				this.trafficExactParked.set(actor.key, presented);
			}
			const prior = settled
				? null
				: this.trafficPreviousRoutes.get(projection.key);
			// Interpolate the *correction*, not two stale absolute positions. A
			// station can translate several kilometres during one 10 Hz authority
			// interval. Blending its old and new world-space poses therefore shows
			// the Carrier one whole tick behind the current station/player frame;
			// the recording from #266 exposed that as a 10 Hz jump between two
			// apparent positions. Predict each authority sample to render time first,
			// then blend between those predictions. The result is continuous at a
			// tick boundary while retaining the smooth correction of a course change.
			const predictAtRender = (
				pose: Pick<TrafficProjection, "pos" | "vel">,
				atS: number,
			) => {
				const dt = Number.isFinite(atS)
					? Math.max(0, this.world.gameTime - atS)
					: 0;
				return {
					x: pose.pos.x + pose.vel.x * dt,
					y: pose.pos.y + pose.vel.y * dt,
					z: pose.pos.z + pose.vel.z * dt,
				};
			};
			// A settled pose was resampled from the station at render time just
			// above. Predicting it again from the authority tick would apply the
			// station's orbital velocity twice.
			const currentAtRender = settled
				? presented.pos
				: predictAtRender(presented, this.trafficProjectionAtS);
			const previousAtRender = prior
				? predictAtRender(prior, this.trafficPreviousProjectionAtS)
				: null;
			const sampledPos = previousAtRender
				? {
						x:
							previousAtRender.x +
							(currentAtRender.x - previousAtRender.x) * blend,
						y:
							previousAtRender.y +
							(currentAtRender.y - previousAtRender.y) * blend,
						z:
							previousAtRender.z +
							(currentAtRender.z - previousAtRender.z) * blend,
					}
				: currentAtRender;
			const dx = sampledPos.x - this.world.ship.pos.x;
			const dy = sampledPos.y - this.world.ship.pos.y;
			const dz = sampledPos.z - this.world.ship.pos.z;
			const rangeKm = previous
				? TRAFFIC_DEMATERIALIZE_KM
				: TRAFFIC_MATERIALIZE_KM;
			const visible =
				projection.phase !== "abstract-away" &&
				dx * dx + dy * dy + dz * dz <= rangeKm * rangeKm;
			if (!visible) {
				if (previous) {
					this.unregisterContact(previous);
					this.trafficContacts.delete(actor.key);
					this.selectableCache = null;
				}
				this.trafficMeshes.get(actor.key)?.removeFromParent();
				continue;
			}
			if (previous) {
				previous.pos.x = sampledPos.x;
				previous.pos.y = sampledPos.y;
				previous.pos.z = sampledPos.z;
				previous.velocity.x = projection.vel.x;
				previous.velocity.y = projection.vel.y;
				previous.velocity.z = projection.vel.z;
			} else {
				const shown = materializeTrafficContact(
					actor,
					{ ...projection, pos: sampledPos },
					this.world.ship.pos,
				);
				if (!shown) continue;
				this.trafficContacts.set(actor.key, shown);
				this.registerContact(shown);
				this.selectableCache = null;
			}
			// The contact's standing is **what the pilot has recorded**, re-derived
			// from the knowledge row's own clock, not the rotation running now: a
			// carrier the pilot has never scanned reads UNKNOWN however the galaxy
			// happens to feel about it today (F8, §6).
			const contact = previous ?? this.trafficContacts.get(actor.key);
			if (contact) contact.standing = this.recordedStanding(actor);
			let mesh = this.trafficMeshes.get(actor.key);
			if (!mesh) {
				mesh = buildShipMesh(actor.hullId, actor.variant).root;
				mesh.name = `traffic-${actor.localCarrierId}`;
				this.trafficMeshes.set(actor.key, mesh);
				this.nearScene.add(mesh);
			} else if (!mesh.parent) this.nearScene.add(mesh);
		}

		for (const projection of this.trafficRoutes) {
			if (this.trafficEngagements.has(projection.key)) continue;
			const contact = this.trafficContacts.get(projection.key);
			const mesh = this.trafficMeshes.get(projection.key);
			if (!contact || !mesh || !mesh.parent) continue;
			mesh.position.set(
				contact.pos.x - cameraPos.x,
				contact.pos.y - cameraPos.y,
				contact.pos.z - cameraPos.z,
			);
			const exact = this.trafficExactParked.get(projection.key);
			const prior = exact
				? null
				: this.trafficPreviousRoutes.get(projection.key);
			const target = exact ?? projection;
			if (!this.trafficQuaternion(target, this.trafficToQuaternion)) continue;
			if (prior && this.trafficQuaternion(prior, this.trafficFromQuaternion)) {
				this.trafficFromQuaternion.slerp(this.trafficToQuaternion, blend);
				mesh.quaternion.copy(this.trafficFromQuaternion);
			} else mesh.quaternion.copy(this.trafficToQuaternion);
		}

		// Engaged carriers are drawn from their flight (civilian-combat H3).
		for (const [key, engagement] of this.trafficEngagements) {
			const contact = this.trafficContacts.get(key);
			const mesh = this.trafficMeshes.get(key);
			if (!contact || !mesh) continue;
			const { ship, nose, up } = engagement.flight;
			contact.pos.x = ship.pos.x;
			contact.pos.y = ship.pos.y;
			contact.pos.z = ship.pos.z;
			contact.velocity.x = ship.vel.x;
			contact.velocity.y = ship.vel.y;
			contact.velocity.z = ship.vel.z;
			if (!mesh.parent) this.nearScene.add(mesh);
			mesh.position.set(
				ship.pos.x - cameraPos.x,
				ship.pos.y - cameraPos.y,
				ship.pos.z - cameraPos.z,
			);
			if (this.trafficQuaternion({ nose, up }, this.trafficToQuaternion))
				mesh.quaternion.copy(this.trafficToQuaternion);
		}
	}

	/** The Traffic actors flying their projection now: the operational ones. */
	private flyingTraffic(): TrafficActor[] {
		return flyingTrafficActors(this.trafficActors, (key) =>
			this.carrierCondition(key),
		);
	}

	/**
	 * The diverted carriers, drawn standing in their home berths (H3b).
	 *
	 * Not `projectSystemTrafficAuthority`: a struck carrier is not arbitrating
	 * for a lane, has no visit to hold, and its schedule's current term is the
	 * leg it was pulled off mid-way. The one projection that answers "where does
	 * this carrier stand in its own berth" is the parked one — the same
	 * projection a carrier before its first departure is drawn with, which is
	 * what makes the divert need no new form of its own.
	 */
	private divertedTraffic(): TrafficActor[] {
		return parkedTrafficActors(this.trafficActors, (key) =>
			this.carrierCondition(key),
		);
	}

	private divertedProjections(
		gameTime: number,
		projectionSystem: System,
	): SystemTrafficProjection[] {
		return this.divertedTraffic().map((actor) =>
			projectParkedTrafficActor({ actor, gameTime, projectionSystem }),
		);
	}

	private trafficOperational(key: CarrierKey): boolean {
		return fliesItsRoute(this.carrierCondition(key));
	}

	/** Drawn at all? A diverted carrier is, in its berth; a destroyed one and a
	 *  replacement under construction are not. */
	private trafficShown(key: CarrierKey): boolean {
		return trafficPresence(this.carrierCondition(key)) !== "absent";
	}

	/**
	 * One frame of civilian combat (`civilian-combat.md` H2, H3, H10).
	 *
	 * **A shot that lands on a projected carrier engages it**: the carrier is
	 * handed from its projection to flight at the pose it is drawn in, and the
	 * same step then lands the shot. An engaged carrier is stepped through the
	 * shared condition model on its own hull; an armed one's return fire goes
	 * through `takeDamage` like the raider's. **A survivor is diverted** (H3b,
	 * H3c): the frame that spends hull points writes its `disable` and its
	 * repair, and the pilot keeps flying the ship that runs — until it is out of
	 * the band, where it stops being flown and starts being a carrier parked at
	 * home (`parkedTrafficActors`).
	 */
	private stepTrafficEngagements(dt: number, shot: PlayerShot) {
		const pilot: DuelPilot = {
			ship: this.world.ship,
			nose: this.nose(),
			aimOrigin: this.cameraPos(),
			aimNose: this.beamAim(),
			hull: this.condition.hull,
			frameVel: this.localFrame(),
		};
		if (shot.fired && shot.damage > 0) this.engageStruckTraffic(pilot);
		this.stepEngagedTraffic(pilot, shot, dt);
	}

	/** Hand every projected carrier the beam lands on to flight at the pose it
	 *  is drawn in; the same frame's step then lands the shot. */
	private engageStruckTraffic(pilot: DuelPilot) {
		const record = this.world.system.record;
		for (const [key, contact] of this.trafficContacts) {
			if (this.trafficEngagements.has(key)) continue;
			const actor = this.trafficActorByKey(key);
			if (!actor) continue;
			if (
				!trafficInSights(
					pilot.aimOrigin,
					pilot.aimNose,
					contact.pos,
					actor.hullId,
				)
			)
				continue;
			const route = this.trafficRouteByKey(key);
			// Its drawn attitude, or failing that the way it is moving.
			const nose =
				route?.nose ??
				normalizeOr(sub(contact.velocity, pilot.frameVel), v3(0, 0, -1));
			this.trafficEngagements.set(
				key,
				engage(
					{
						key,
						hullId: actor.hullId,
						pos: contact.pos,
						vel: contact.velocity,
						nose,
						up: route?.up ?? null,
						voyageOrdinal: this.trafficVoyage(actor),
					},
					carrierInstanceSeed(
						record.seed,
						key,
						this.carrierCondition(key).instanceOrdinal,
						DOMAIN.TRAFFIC_ENGAGEMENT,
					),
				),
			);
		}
	}

	/** Step the engaged carriers: return fire, a kill, a divert, or out of range
	 *  back to the projection. */
	private stepEngagedTraffic(pilot: DuelPilot, shot: PlayerShot, dt: number) {
		for (const [key, engagement] of this.trafficEngagements) {
			const actor = this.trafficActorByKey(key);
			if (!actor) {
				this.trafficEngagements.delete(key);
				continue;
			}
			const step = stepEngagement(engagement, pilot, shot, dt);
			if (step.returnFire)
				this.takeDamage(
					step.returnFire.amount,
					step.returnFire.side,
					`fired on by ${actor.callsign}`,
				);
			if (step.destroyed) {
				this.destroyTrafficCarrier(actor, step.engagement);
				continue;
			}
			// The strike is written the frame the hull gives way, and the fight
			// carries on: H3's intent does not stop because the world has decided
			// where this ship sleeps tonight.
			if (step.hullStruck) this.divertTrafficCarrier(actor);
			const rangeKm = length(
				sub(step.engagement.flight.ship.pos, this.world.ship.pos),
			);
			if (rangeKm > TRAFFIC_DEMATERIALIZE_KM) {
				this.trafficEngagements.delete(key);
				// A survivor the pilot merely outran goes back to the projection it
				// was struck in, and keeps its contact: the next frame draws it at
				// the pose it would have had. **A diverted one has nowhere to go
				// back to** — its projection is a berth, and the berth is not where
				// the pilot is standing. Leaving the contact alive would snap the
				// ship from the sky onto its berth the frame the fight ends.
				if (!this.trafficOperational(key)) this.forgetTrafficContact(key);
				continue;
			}
			this.trafficEngagements.set(key, step.engagement);
		}
	}

	private trafficActorByKey(key: CarrierKey): TrafficActor | undefined {
		return this.trafficActors.find((a) => a.key === key);
	}

	/** Take one carrier out of what the player can look at: the scanner's list,
	 *  the selectable set. Not the lock — a diverted carrier is still out there
	 *  with a lock worth keeping, and only the kill drops that with the ship. */
	private forgetTrafficContact(key: CarrierKey): void {
		const contact = this.trafficContacts.get(key);
		if (!contact) return;
		this.unregisterContact(contact);
		this.trafficContacts.delete(key);
		this.selectableCache = null;
	}

	private trafficRouteByKey(key: CarrierKey) {
		return this.trafficRoutes.find((r) => r.key === key);
	}

	/** The voyage a carrier flies now: its engagement's, fixed when the fight
	 *  began, or else its route's (`flownVoyageOrdinal`). */
	private trafficVoyage(actor: TrafficActor): number {
		return (
			this.trafficEngagements.get(actor.key)?.voyageOrdinal ??
			flownVoyageOrdinal(
				this.trafficRouteByKey(actor.key),
				trafficScheduleAt(actor, this.world.gameTime).awayOrdinal,
			)
		);
	}

	/** One carrier's manifest for one voyage — the one expression the kill drops
	 *  and a probe reads, so the two cannot drift apart (sage #368). */
	private trafficManifest(
		actor: TrafficActor,
		instanceOrdinal: number,
		voyageOrdinal: number,
	) {
		const record = this.world.system.record;
		return carrierManifest(
			record.seed,
			actor.key,
			instanceOrdinal,
			voyageOrdinal,
			{
				holdT: HULL_SPECS[actor.hullId].holdT,
				government: record.government,
			},
		);
	}

	/**
	 * A hull strike (`civilian-combat.md` H3b, H3c, H3d): the carrier is disabled
	 * by the player's own fire and booked into its home berth in the same tick,
	 * and the strike is an offence.
	 *
	 * **Gated on `operational`, and the gate is load-bearing.** `disable` is
	 * legal from an `operational` carrier only — `world-state.ts` throws rather
	 * than no-oping — and a fight lasts dozens of frames after the hull gives
	 * way. The gate reads the world rather than a flag on the engagement,
	 * because the divert outlives the session that caused it: reload into a
	 * fight with a carrier already heading home and no engagement remembers
	 * having struck it.
	 *
	 * **Nothing here ends the fight.** The ship that survives keeps fleeing on
	 * its own hull (H3), and the pilot keeps the lock: what changes is where the
	 * world says it will be afterwards.
	 */
	/**
	 * What one offence against one carrier costs the pilot, written (H4, H9).
	 *
	 * `before` is the carrier's row as it stood **before** the offence was
	 * applied. That ordering is the rule, not a preference: the divert books its
	 * own repair in the same tick as the disable, so a row read afterwards
	 * already describes a struck carrier and the strike would credit itself its
	 * own charge.
	 *
	 * **The standing the strike was judged on is re-derived, not remembered.**
	 * Standing is never saved — it is a pure derivation from the instance and the
	 * clock — and the repair's `startedAt` *is* the strike's clock, because H3c
	 * writes both in one tick. So the kill can ask what the earlier hit actually
	 * cost: a strike on a carrier that was Wanted then charged nothing (H4), and
	 * the kill that finishes it is worth its full 40 even if the six-hour
	 * rotation has since turned the target Clean. Standing off the row's own clock
	 * is how that is known without adding a field to the save.
	 */
	private chargeTrafficOffence(
		record: SystemRecord,
		actor: TrafficActor,
		before: EffectiveCarrier,
		offence: Offence,
		now: number,
	): number {
		const standingOf = (atS: number) =>
			carrierStanding(record.seed, actor.key, before.instanceOrdinal, atS);
		const heat = marginalOffenceHeat(
			standingOf(now),
			offence,
			chargedOffence(
				before,
				before.recovery === undefined
					? null
					: standingOf(before.recovery.startedAt),
			),
		);
		if (heat > 0) {
			this.commerceWorld = withOffence(
				this.commerceWorld,
				record.galaxy,
				heat,
				now,
			);
			this.saveDirty();
		}
		return heat;
	}

	private divertTrafficCarrier(actor: TrafficActor) {
		const record = this.world.system.record;
		const now = this.world.gameTime;
		const carrier = this.carrierCondition(actor.key);
		if (carrier.condition !== "operational") return;
		for (const event of trafficDiversion(record.index, actor, now))
			this.applyCarrierTransition(actor.key, event);
		const heat = this.chargeTrafficOffence(
			record,
			actor,
			carrier,
			"struck",
			now,
		);
		this.lastExit =
			heat > 0
				? `${actor.callsign} disabled — running home, and that is an offence`
				: `${actor.callsign} disabled — running home`;
	}

	/**
	 * A kill (`civilian-combat.md` H1, H4, H9, H11): the carrier's destroy with
	 * its scheduled replacement, the manifest a scan would have shown dropped as
	 * canisters, and the offence judged on its true standing and written.
	 */
	private destroyTrafficCarrier(actor: TrafficActor, engagement: Engagement) {
		const record = this.world.system.record;
		const now = this.world.gameTime;
		// Read once, before anything is written: the instance that is about to
		// die, the condition the kill has to be legal from, and — if the pilot
		// finished off a carrier they had already struck — the offence this
		// episode has already cost them (H9).
		const carrier = this.carrierCondition(actor.key);
		const { instanceOrdinal } = carrier;
		const standing = carrierStanding(
			record.seed,
			actor.key,
			instanceOrdinal,
			now,
		);
		const manifest = this.trafficManifest(
			actor,
			instanceOrdinal,
			engagement.voyageOrdinal,
		);
		for (const event of trafficKillTransitions(
			record.index,
			actor,
			carrier.condition,
			now,
		))
			this.applyCarrierTransition(actor.key, event);
		this.canisters = [
			...this.canisters,
			...dropManifestCanisters({
				systemSeed: record.seed,
				key: actor.key,
				manifest,
				killedAt: now,
				pos: engagement.flight.ship.pos,
				vel: engagement.flight.ship.vel,
				frameVel: this.localFrame(),
				frameBodyId: this.frameBody?.id ?? null,
			}),
		];
		const heat = this.chargeTrafficOffence(
			record,
			actor,
			carrier,
			"destroyed",
			now,
		);
		this.audio.explosion();
		this.lastExit =
			heat > 0
				? `${actor.callsign} destroyed — an offence`
				: `${actor.callsign} destroyed`;
		this.trafficEngagements.delete(actor.key);
		this.forgetTrafficContact(actor.key);
		// The lock goes with the ship, as the raider's, relay's and canister's
		// do. The replacement comes back under the same key (H1), and a lock left
		// here would hand it back already selected with the gimbal on it
		// (sage #368).
		if (this.targetId === actor.key) this.targetId = null;
		this.trafficMeshes.get(actor.key)?.removeFromParent();
	}

	/**
	 * What a probe reads of ordinary traffic under fire: each materialized
	 * carrier with its condition, true standing and hold now, whether it is
	 * engaged, and the player's legal status. Derived on read, as the game
	 * derives them, so a probe restates none of it.
	 */
	trafficReadout() {
		const record = this.world.system.record;
		const now = this.world.gameTime;
		return {
			contacts: [...this.trafficContacts].map(([key, contact]) => {
				const actor = this.trafficActorByKey(key);
				const carrier = this.carrierCondition(key);
				const engagement = this.trafficEngagements.get(key);
				return {
					key,
					callsign: actor?.callsign ?? null,
					hullId: actor?.hullId ?? null,
					pos: { ...contact.pos },
					vel: { ...contact.velocity },
					condition: carrier.condition,
					instanceOrdinal: carrier.instanceOrdinal,
					// Where the row leaves it, as Traffic draws it: on a route, in a
					// berth, or not at all.
					presence: trafficPresence(carrier),
					repairCompletesAt: carrier.recovery?.completesAt ?? null,
					standing: carrierStanding(
						record.seed,
						key,
						carrier.instanceOrdinal,
						now,
					),
					manifest: actor
						? this.trafficManifest(
								actor,
								carrier.instanceOrdinal,
								this.trafficVoyage(actor),
							)
						: [],
					engaged: engagement !== undefined,
					phase: engagement?.flight.phase ?? null,
					hull: engagement?.condition.hull ?? null,
				};
			}),
			legal: {
				...this.legalStatus(),
				// The stored pair is at its stamp; `heatNow` is decayed to the clock,
				// which is what the standing reads.
				heatNow: heatAt(this.legalStatus(), now),
				standing: this.legalStanding(),
			},
			// Every carrier Traffic is holding at a berth rather than on a route,
			// and the clock it rejoins its schedule at — read off the roster rather
			// than the materialized set, because a probe checking that a struck
			// carrier has left its route is standing somewhere else when it asks.
			parkedHome: this.divertedTraffic().map((actor) => ({
				key: actor.key,
				callsign: actor.callsign,
				homeStationId: actor.homeStationId,
				backAtS: this.carrierCondition(actor.key).recovery?.completesAt ?? null,
			})),
			authorityReady: this.trafficAuthorityReady(),
		};
	}

	/** The selected ordinary carrier, or `undefined` for anything else — a
	 *  station, a relay, a canister, a pirate (F10: raiders keep their kill-time
	 *  draw and are not this verb's subject). */
	private scanSubject(target: Body | null): TrafficActor | undefined {
		if (!target || !isDisplayContact(target)) return undefined;
		return this.trafficActorByKey(target.id as CarrierKey);
	}

	/**
	 * One frame of the scan (§4).
	 *
	 * **Automatic on the hold, with no key bound to it** — the principal's
	 *  ruling, and every letter on the flight deck is taken. The charge builds
	 *  while the nose holds a scannable carrier inside the cone and the range,
	 *  and the writing of the record is the one transition, so a long lock ages
	 *  the reading instead of renewing it.
	 */
	private stepScan(dt: number) {
		const target = this.targetBody();
		const actor = this.scanSubject(target);
		const fitted = scanFitted(this.commander.ownedEquipment);
		// **A subject, not a boolean.** Five seconds spent with the nose swinging
		// across three carriers is five seconds on none of them, and a charge that
		// does not record whose it is cannot say when to start over — the blocker
		// sage #384 round 1 found, where one long lock could bank a charge on one
		// ship and spend it on another.
		// **The cone is on the sightline, not on the hull.** `nose()` is the
		// ship's rotation and `weaponAim()` is the camera's, and `main.ts`'s own
		// note beside `forwardOf` says they "differ whenever the pilot looks off
		// the nose". The guns already settled which one "where I am pointing"
		// means in this game: they fire along `weaponAim()`. Measuring the scan
		// from the hull meant a pilot had to put a carrier far down the cockpit
		// screen — off the reticle, onto the hull — to start a scan they could see
		// they were aimed at. Found by flying it, not by any test of mine: every
		// row and probe places the nose and the sight on one ray, which makes them
		// the same vector by construction and cannot see this at all.
		const aim = this.weaponAim();
		const held: ScanSubject | null =
			actor !== undefined &&
			fitted &&
			target !== null &&
			scanInRange(length(sub(target.pos, this.world.ship.pos))) &&
			scanConeHeld(aim, normalizeOr(sub(target.pos, this.world.ship.pos), aim))
				? { key: actor.key }
				: null;
		const before = this.scanHold;
		this.scanHold = stepScanHold(before, held, dt);
		if (!actor || !scanCompleted(before, this.scanHold)) return;
		const { instanceOrdinal } = this.carrierCondition(actor.key);
		this.commerceWorld = observeScan(
			this.commerceWorld,
			this.world.system.record.galaxy,
			actor.key,
			this.world.gameTime,
			{ instanceOrdinal, voyageOrdinal: this.trafficVoyage(actor) },
		);
		this.saveDirty();
	}

	/** What the pilot has recorded about this carrier, re-derived from the row's
	 *  own clock and voyage. `null` is F8's `UNKNOWN`. */
	private recordedReading(actor: TrafficActor): CarrierReading | null {
		const record = this.world.system.record;
		return carrierReading({
			systemSeed: record.seed,
			key: actor.key,
			row: readKnowledge(this.commerceWorld.galaxies[record.galaxy], actor.key),
			holdT: HULL_SPECS[actor.hullId].holdT,
			government: record.government,
			gameTime: this.world.gameTime,
		});
	}

	/** The standing the pilot recorded for this carrier, and nothing else.
	 *
	 *  **The presentation loop asks for the standing alone.** It runs over every
	 *  carrier in the system each frame, and the full reading also derives the
	 *  manifest — an RNG draw over the hold for a string this loop never prints
	 *  (sage #384 round 1). The reading the panel wants stays `recordedReading`.
	 */
	private recordedStanding(actor: TrafficActor): CarrierStanding | null {
		const record = this.world.system.record;
		const row = readKnowledge(
			this.commerceWorld.galaxies[record.galaxy],
			actor.key,
		);
		const scan = row?.scan;
		if (!scan) return null;
		return carrierStanding(
			record.seed,
			actor.key,
			scan.observedInstanceOrdinal,
			scan.observedAt,
		);
	}

	/** The scan facts the designation cell and the console share.
	 *
	 *  **Memoised per frame, keyed on every input.** Both surfaces want the same
	 *  standing, manifest and drawn name every frame, and the manifest is an RNG
	 *  draw: deriving it twice for one target bought a second draw of the same
	 *  figures (sage #384 round 1). The key is the target's identity, the world
	 *  clock, the charge, whether the module is fitted, and the recorded row's
	 *  stamp — so a memo cannot outlive the frame it was true in, and a caller
	 *  handing over a different body, which is what a probe does with a synthetic
	 *  contact, recomputes instead of inheriting the selected ship's reading.
	 *  `fitted` is in the key because the probe that fits and un-fits the module
	 *  between two reads on one frozen clock found it missing, and printed
	 *  `NO SCANNER` at a pilot who had just bought one.
	 */
	private scanReadout(target: Body | null): ScanFacts {
		const stamp = this.scanStamp(target);
		const fitted = scanFitted(this.commander.ownedEquipment);
		// Computed before the memo is consulted, and part of its key: the cue is
		// the one input that moves with the ship rather than with the clock, so a
		// frame that turned the sight off a carrier without the clock moving must
		// not be served the reading taken while it was on.
		const standoff = this.scanStandoffNow(target);
		const memo = this.scanFacts;
		if (
			memo !== null &&
			memo.target === target &&
			memo.gameTime === this.world.gameTime &&
			memo.chargeS === this.scanHold.chargeS &&
			memo.fitted === fitted &&
			memo.standoff === standoff &&
			memo.stamp === stamp
		)
			return memo.facts;
		const facts = this.computeScanFacts(target, standoff);
		this.scanFacts = {
			target,
			gameTime: this.world.gameTime,
			chargeS: this.scanHold.chargeS,
			fitted,
			standoff,
			stamp,
			facts,
		};
		return facts;
	}

	/** Why the sight is not holding this carrier, in geometry alone. The cell
	 *  decides whether to show it; this answers the question without deciding
	 *  anything about the target being scannable, so it cannot drift out of step
	 *  with the predicate `stepScan` uses — both call the same two functions. */
	private scanStandoffNow(target: Body | null): ScanStandoff | null {
		if (!target || !isDisplayContact(target)) return null;
		const aim = this.weaponAim();
		const toTarget = sub(target.pos, this.world.ship.pos);
		return scanStandoff(length(toTarget), aim, normalizeOr(toTarget, aim));
	}

	/** The recorded scan row's stamp for this target, or -1. A map lookup, paid
	 *  once per frame the memo is consulted, which is what makes the memo's key
	 *  cheap enough to be honest about. */
	private scanStamp(target: Body | null): number {
		const actor = this.scanSubject(target);
		if (!actor) return -1;
		return (
			readKnowledge(
				this.commerceWorld.galaxies[this.world.system.record.galaxy],
				actor.key,
			)?.scan?.observedAt ?? -1
		);
	}

	private computeScanFacts(
		target: Body | null,
		standoff: ScanStandoff | null,
	): ScanFacts {
		const actor = this.scanSubject(target);
		const reading = actor ? this.recordedReading(actor) : null;
		const scannable = actor !== undefined;
		const refusal = scanRefusal(
			scanFitted(this.commander.ownedEquipment),
			scannable,
		);
		// A completed charge sits at the ceiling, so the progress is only a
		// charge while it is still running: after that the cell shows the
		// standing the pilot earned, not a number stuck at 100.
		// **`chargeS > 0` is load-bearing.** A hold at zero has not started, and
		// printing its progress reads as `SCANNING 0%` on a ship nobody is
		// scanning — which is worse than `UNKNOWN`, because it tells the pilot a
		// scan is underway when the nose is simply not on the target.
		const progress =
			!refusal &&
			scannable &&
			this.scanHold.chargeS > 0 &&
			this.scanHold.chargeS < SCAN_CHARGE_S
				? scanProgress(this.scanHold)
				: undefined;
		return {
			designation: {
				ageS: reading?.ageS,
				progress,
				refusal,
				// Only where it means something: a pirate's cell and a station's are
				// not this verb's, a refusal already names the actionable absence,
				// and a carrier with a reading is being read. So: fitted, scannable,
				// nothing running, nothing recorded.
				standoff:
					!refusal && scannable && reading === null && progress === undefined
						? standoff
						: null,
			},
			actor,
			reading,
		};
	}

	/**
	 * The Flight console's reading block (§6: the manifest does not fit the
	 * designation line, so the glass carries the minimum and this console the
	 * whole reading).
	 *
	 * **Both of F3's strings, because they answer different questions**: the
	 *  drawn name is the quarry a pilot remembers, the composed registry is the
	 *  where-it-belongs fact a drawn name loses.
	 *
	 * **It shows for any scannable carrier, scanned or not** — F8's `UNKNOWN` is
	 *  a reading, and a block that appears only after a scan teaches a pilot that
	 *  the console has nothing to say about a ship they have never looked at.
	 */
	private scanConsoleRow(scan: ScanFacts): ScanConsoleReadout | null {
		const { actor, reading } = scan;
		if (!actor) return null;
		return {
			name: this.drawnName(actor),
			registry: actor.callsign,
			standing: (reading?.standing ?? "unknown").toUpperCase(),
			// The manifest has no empty arm: an empty hold is an empty list, and
			// `MANIFEST` over nothing is the truth. `BALAST` would have been a
			// fourth spelling of absence beside `NOT READ` and `NEVER`, each with
			// its own meaning for the pilot to learn (sage #384 round 1).
			manifest: reading
				? reading.manifest
						.map((row) => `${row.good.toUpperCase()} ${row.tonnes}t`)
						.join(" · ")
				: "NOT READ",
			age: reading ? targetAgeLabel(reading.ageS) : "NEVER",
		};
	}

	/** The name the glass and the console give a carrier: F3's drawn name, at the
	 *  instance flying now. **One function because it is one question** — a seed
	 *  and an instance ordinal spelled out at two call sites is one refactor away
	 *  from the instrument and the console naming different ships. */
	private drawnName(actor: TrafficActor): string {
		return carrierName(
			this.world.system.record.seed,
			actor.key,
			this.carrierCondition(actor.key).instanceOrdinal,
		);
	}

	/** Whether a shot along the beam lands on the selected ordinary carrier now.
	 *  No actor, no mark — as `engageStruckTraffic` lands no shot without one,
	 *  rather than a hit radius from a hull nobody named (sage #368). */
	private trafficOnTarget(camPos: Vec3, selected: Body): boolean {
		if (!this.trafficSelected()) return false;
		const actor = this.trafficActorByKey(selected.id as CarrierKey);
		return (
			actor !== undefined &&
			trafficInSights(camPos, this.beamAim(), selected.pos, actor.hullId)
		);
	}

	/** This galaxy's saved legal status, the pair at its stamp. */
	private legalStatus() {
		return this.commerceWorld.galaxies[this.world.system.record.galaxy]
			.legalStatus;
	}

	/** The player's standing now, from the galaxy's heat (H4, H7). */
	legalStanding() {
		return legalStandingAt(this.legalStatus(), this.world.gameTime);
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
			const contact: DisplayContact = {
				id: hull.name,
				name: HULL_VARIANTS[slot.id].find(
					(variant) => variant.id === slot.variant,
				)!.name,
				kind: "ship",
				shipType: slot.id,
				pos: v3(),
				velocity: v3(),
				radiusKm: HULL_REACH_KM[slot.id],
				color: 0x8cbedc,
				standing: null,
				scannerClass: "unknown",
			};
			this.fleet.push({ mesh: hull, slot, contact });
			this.registerContact(contact);
		}
		this.nearScene.add(group);
	}

	/** The physical cockpit and its one, deck-mounted scanner. */
	private buildCockpit() {
		this.cockpit = {} as CockpitHardware;
		// The three structural finishes, and why they are not declared here:
		// `COCKPIT_FINISHES`. The short of it is that a finish named at this call
		// site is one the calibration pass cannot see, and the cabin's roughest
		// turned out not to be expressible over the wear curve without it.
		const metal = cockpitMaterial("metal");
		const trim = cockpitMaterial("trim");
		const inset = cockpitMaterial("inset");
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
		// #105's one added light. The lamp above lifts the cabin evenly; what it
		// does not give is a *gradient*, and a gradient is what the deck and the
		// console tops were missing — both cockpit views render the same flat
		// tone whether the star is ahead of the ship or 175° behind it. Warm
		// against the lamp's cool, which is the contrast the reference cabins
		// have. Its range dies before the canopy on purpose: a key that reached
		// the glass would light the frame the player sees space through.
		const keyLight = new THREE.PointLight(
			COCKPIT_KEY_LIGHT.color,
			COCKPIT_KEY_LIGHT.intensity,
			COCKPIT_KEY_LIGHT.rangeKm,
			2,
		);
		keyLight.name = "cockpit-key-light";
		keyLight.position.set(...COCKPIT_KEY_LIGHT.position);
		cockpit.add(keyLight);
		// **Gated, and this is the term #105 added.** A point light here is
		// evaluated for every standard material in `nearScene`, so leaving it
		// ungated would make every hull and station fragment pay for a cabin
		// gradient. `cockpit-surface.ts` owns which side of `quality` it is on
		// and puts it in the state the current setting asks for.
		registerKeyLight(keyLight);
		const addBox = (
			size: [number, number, number],
			position: [number, number, number],
			rotation: [number, number, number] = [0, 0, 0],
			material: THREE.Material = metal,
		) => {
			// **A chamfered form, not a box.** The rim on every cut edge is what
			// gives a moulding its scale — `chamfer-box.ts` has the argument, and
			// it is what replaced the panel grid the principal rejected against
			// the reference frames.
			//
			// `plateCockpitUVs` still runs: it is already non-indexed, so the call
			// only writes the kilometre projection. It returns the geometry to use
			// either way, and dropping that return value would leave a fitting
			// unplated in a way that looks exactly like the map failing to load.
			const mesh = new THREE.Mesh(cockpitForm(...size), material);
			mesh.position.set(...position);
			mesh.rotation.set(...rotation);
			cockpit.add(mesh);
			return mesh;
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
			// Plated like everything else on `metal`, and `plateCockpitUVs`
			// directly rather than `cockpitForm`: a rail is a cylinder, and
			// chamfering one is meaningless. A normalised cylinder unwrap would
			// tile the whole 72 m map onto a rail a metre across, which reads as
			// noise rather than as a surface.
			const mesh = new THREE.Mesh(
				plateCockpitUVs(
					new THREE.CylinderGeometry(
						radius * 0.82,
						radius,
						direction.length(),
						8,
					),
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
		/**
		 * The two canopy side rails, and the **one** place their endpoints live.
		 *
		 * The lamp placement below claimed to take "the rail's own endpoints, so
		 * the two cannot drift apart" while re-typing the same six literals — a
		 * comment describing a binding that did not exist. An editor who trusted
		 * it and moved only the `addStrut` call would leave six lamps floating at
		 * the old position, with nothing going red. Both readers take this array.
		 */
		const CANOPY_SIDE_RAILS = [
			{
				side: "port",
				from: [-0.043, -0.013, -0.065] as [number, number, number],
				to: [-0.05, 0.018, -0.065] as [number, number, number],
			},
			{
				side: "starboard",
				from: [0.043, -0.013, -0.065] as [number, number, number],
				to: [0.05, 0.018, -0.065] as [number, number, number],
			},
		];
		for (const rail of CANOPY_SIDE_RAILS)
			addStrut(rail.from, rail.to, 0.00125, `canopy-side-rail-${rail.side}`);
		// Three lamps on each, and nowhere else. The first pass ran continuous
		// lit bars under the header, under the sill and along each console; none
		// of that is in the reference, where the canopy frame carries a few small
		// lamps and everything else that glows is an instrument.
		for (const rail of CANOPY_SIDE_RAILS)
			for (const lamp of railLamps(rail.from, rail.to)) cockpit.add(lamp);
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
		// #201, and the cabin is the frame the node was opened over: both cockpit
		// views rendered the same tone with the star ahead and 175° behind, which
		// `cockpit-surface.ts` records as an open weakness. The lamps and the
		// canopy glass fall out of the walk by the rule — they are
		// `MeshBasicMaterial` — so what is left casting is the fittings.
		this.markedOcclusion.push(["cockpit", markOcclusion(cockpit)]);
		this.nearScene.add(cockpit);
	}

	/** What each occlusion walk marked, kept for `probe-occlusion.mjs` to read
	 *  off the page. A walk that matched nothing renders a perfect frame with
	 *  the feature silently missing, so the count is the only evidence there
	 *  is that the rule found anything (#201). */
	readonly markedOcclusion: [
		string,
		{ participating: number; excluded: number },
	][] = [];

	/** Build the fitted scanner plate, instrument canvases, and throttle hardware. */
	private buildScannerAssembly(
		scannerMount: THREE.Group,
		metal: THREE.MeshStandardMaterial,
		trim: THREE.MeshStandardMaterial,
		inset: THREE.MeshStandardMaterial,
	) {
		const deck = new THREE.Mesh(cockpitForm(0.032, 0.0016, 0.022), metal);
		deck.name = "scanner-deck";
		scannerMount.add(deck);
		const scannerWell = new THREE.Mesh(
			cockpitForm(0.029, 0.00025, 0.0155),
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
			const bezel = new THREE.Mesh(cockpitForm(sx, 0.00075, sz), trim);
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
			const backing = new THREE.Mesh(cockpitForm(0.014, 0.0014, 0.011), trim);
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
			cockpitForm(0.0022, 0.0014, 0.014),
			inset,
		);
		throttleTrack.name = "throttle-track";
		throttleTrack.position.set(-0.0168, 0.0008, 0);
		scannerMount.add(throttleTrack);
		this.cockpit.throttleFillMaterial = new THREE.MeshStandardMaterial({
			color: 0x9b5a20,
			emissive: 0x4a1905,
			emissiveIntensity: COCKPIT_EMISSIVE_INTENSITIES.throttleIdle,
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
		const scan = this.scanReadout(target);
		// **F3's two strings, split by where they are read.** The glass carries
		// the drawn name — `Kestrel TR-03` is a registration number, and the
		// whole reason §1 draws a name is so a bounty target is a ship a pilot can
		// remember — while the composed registry stays on the console, which is
		// where *where it belongs* is read. Everything else on the glass keeps the
		// name it always had.
		const drawn =
			scan.actor === undefined
				? (target?.name ?? "")
				: this.drawnName(scan.actor);
		const targetText = target ? `${drawn}  ${range(targetKm)}` : "NO TARGET";
		const eta = this.etaCache === null ? "CALC" : duration(this.etaCache);
		// REL rides this instrument and not only the left console, which is
		// hidden unless the pilot turns their head (`hud-and-scanner.md` §3).
		// **It does add repaints**: it moves with the ship's *or* the target's
		// velocity, so a canister slowing to rest changes it while `speed`
		// stands still. `targetSecondary` is in the key below, which is what
		// keeps the canvas honest — the note under that key is about a figure
		// no painted pixel depended on, which is not this one.
		const targetSecondary = `ETA ${eta}${relativeLabel(
			this.targetRelativeKms(),
			"  ",
		)}`;
		const designation = targetDesignation(target, scan.designation);
		// `chargeAu` is **not** in this key any more: the target instrument stopped
		// printing it when §5's strip took it, and a key holding a value no
		// painted pixel depends on repaints two canvas textures on the frame the
		// drive regenerates a hundredth of an AU — about once a second, forever.
		const key = `${speed}|${velocity.context}|${targetText}|${designation}|${targetSecondary}|${this.throttle}|${this.assist}`;
		if (key === this.cockpit.instrumentKey) return;
		this.cockpit.instrumentKey = key;
		const paint = (
			instrument: Instrument,
			title: string,
			primary: string,
			secondary: string,
			accent: string,
			designation = "",
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
			if (designation) ctx.fillText(designation, 28, 78);
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
			targetSecondary,
			"#ffd17a",
			designation,
		);
		this.cockpit.flightInstrument.texture.needsUpdate = true;
		this.cockpit.targetInstrument.texture.needsUpdate = true;
		// The low end is nearest/lower on the sloped deck. Keep it anchored there
		// and extend toward the windscreen as throttle rises; the old fill started
		// at the top and slid down, the inverse of a physical throttle cue.
		this.cockpit.throttleFill.scale.z = Math.max(0.08, this.throttle);
		this.cockpit.throttleFill.position.z = (1 - this.throttle) * 0.006;
		this.cockpit.throttleFillMaterial.emissiveIntensity =
			COCKPIT_EMISSIVE_INTENSITIES.throttleIdle +
			this.throttle *
				(COCKPIT_EMISSIVE_INTENSITIES.throttleFull -
					COCKPIT_EMISSIVE_INTENSITIES.throttleIdle);
	}

	/**
	 * Where the pad's discrete controls are pointed this frame (#283).
	 *
	 * Read off the game's own state rather than off a flag the pad sets, which
	 * is what keeps seekolous's rule intact: nothing records which device is in
	 * charge, so the mouse can act on the same panel in the same frame.
	 *
	 * `modal` is the settings screen. `console` is a head turned to a side
	 * console, or the station console on the forward wall while docked, and it
	 * **suspends the pad's sticks and triggers, and the mouse** — a console
	 * claims six discrete controls and every other button still reaches the
	 * ship, so "suspends the pad" was four times wider than the code, and the
	 * entry point for the context reader is the worst place to overstate it.
	 * The keyboard keeps flying, which is the principal's ruling rather than an
	 * omission; the reason is at the pointer gate — see
	 * `pad-bindings.ts`'s header for the
	 * principal's reversal and why the footer it cites is a claim about the
	 * world rather than about the controls. `instrument` is the `?perf` overlay,
	 * which claims a console's buttons and keeps the sticks.
	 */
	/**
	 * The context, as read once at the top of this frame.
	 *
	 * Cached rather than recomputed: `readPadContext` asks the DOM which panel
	 * is drawn, and `step` and `hasControlInput` both want the answer on every
	 * frame. Three `querySelector` calls a frame on the flight path is the sort
	 * of thing that only shows up in a profile, and the answer cannot change
	 * between them — nothing inside one step mounts a panel.
	 *
	 * A probe that cancels the frame loop and steps the world by hand never
	 * polls, so this stays at whatever it last said — `"flight"` if nothing ever
	 * polled.
	 *
	 * **That used to be harmless and no longer is.** The argument was that with
	 * no poll there is no `padFrame` either, so every pad term downstream is
	 * zero and the context decides nothing. Since the reversal it also decides
	 * whether a *pointer* delta reaches the ship, and the mouse has no
	 * `padFrame` to be absent. A stale value therefore means a probe stepping by
	 * hand flies with whatever suspension state the last poll left.
	 *
	 * **And `"flight"` is the fail-*open* direction, not the safe one.** An
	 * earlier version of this paragraph called it safe and added that "every
	 * probe here drives the frame loop", which is false —
	 * `probe-docking-traffic` and `probe-traffic-mouth` both cancel the loop and
	 * step by hand. So the fallback below reads the DOM afresh while no poll has
	 * ever happened, which is the case that can be answered exactly; a loop
	 * cancelled *after* polling keeps the last answer, and that is stated rather
	 * than dressed up. Sage found both the stale claim and the inversion.
	 */
	private padContextThisFrame: PadContext = "flight";
	// The drawn console beside it, for the same reason and with the same caveat: the
	// pointer's rule wants this fact whether or not it owns the pad, and asking twice
	// a frame would make a rendered-DOM read a per-frame cost twice.
	private consoleDrawnThisFrame = false;

	private padContext(): PadContext {
		// Before the first poll there is no cached answer, so read the truth
		// rather than the initial value — that is the one staleness case which
		// can be settled exactly, and post-reversal the default decides whether a
		// pointer delta reaches the ship.
		return this.padFrame === null
			? this.readPadContext()
			: this.padContextThisFrame;
	}

	/**
	 * Whether a console is **drawn** — which is not the same question as which
	 * context owns the pad, and the difference is the whole of #371's instrument
	 * case: `readPadContext` answers `instrument` before it ever asks this.
	 *
	 * `hasFocusScope` reads the rendered DOM, so this cannot claim a console the
	 * player is not looking at. One owner for both callers: the context below, and
	 * `pointerLockMove`'s answer about the pointer.
	 */
	private consoleIsDrawn() {
		return this.view === "cockpit" && this.liveCockpit.hasFocusScope();
	}

	private readPadContext(consoleDrawn = this.consoleIsDrawn()): PadContext {
		if (this.commanderOverlay?.isOpen() || this.settingsPanel?.isOpen())
			return "modal";
		// The instrument takes what a side console takes — six controls — and
		// **not the sticks**: it is an overlay on a running game, and a mode that
		// stopped the ship would be measuring a different frame from the one it
		// is there to measure. That is why it has its own context rather than
		// sharing the console's, which since the principal's reversal suspends
		// flight input.
		if (this.perfPanel?.isFocused()) return "instrument";
		// A console is whichever surface is actually drawn, which is not only a
		// turned head: docked with the head forward, the station console is on
		// the forward wall and is the only thing on it. `hasFocusScope` reads
		// the rendered DOM, so this cannot claim a console the player is not
		// looking at.
		return consoleDrawn ? "console" : "flight";
	}

	/**
	 * Whether the pointer belongs to the glass right now.
	 *
	 * `document.pointerLockElement` is the only answer to that, so nothing here
	 * keeps a shadow copy of it. Three callers ask, and all three ask it the same
	 * way from one place: which element holds the lock is a question about the
	 * browser's state, and a comparison written out at each call site is one more
	 * place to be wrong about which element the glass is.
	 */
	private canvasHoldsLock() {
		return document.pointerLockElement === this.renderer.domElement;
	}

	/**
	 * Hand the pointer back whenever the drawn surface stops being one the mouse
	 * flies (#371) — the frame's door onto `pointerLockMove`, which owns why.
	 *
	 * It reads the two answers `pollPad` took a moment earlier of the rendered DOM —
	 * the context and the drawn console — so this costs no query of its own and
	 * covers every surface that has or gets a console rather than the four call sites
	 * that draw one.
	 *
	 * **The Commander's overlay keeps its own release beside it, and that is not the
	 * third copy this repo fights**: one rule, and this is the only place it is
	 * written. The overlay's line is the same answer taken a different moment,
	 * because that screen opens on a keystroke and does not wait for a frame — and a
	 * probe is allowed to cancel the frame loop, on which path nothing here runs.
	 * `tests/pad-bindings.test.ts` pins both release sites by name, so a third has to
	 * be said out loud to land.
	 */
	private reconcilePointerLock() {
		if (
			pointerLockMove(
				this.padContextThisFrame,
				this.consoleDrawnThisFrame,
				this.canvasHoldsLock(),
			) === "release"
		)
			document.exitPointerLock();
	}

	/**
	 * The settings screen, once it has been mounted.
	 *
	 * Held so the pad can drive the cursor the screen already has. The screen
	 * keeps owning the keyboard — it takes `keydown` in the capture phase — and
	 * nothing here changes that; this is a second way in, not a replacement.
	 */
	settingsPanel: SettingsPanelHandle | null = null;

	/**
	 * The frame instrument, when `?perf` mounted one.
	 *
	 * `null` for every player: the panel is behind a query gate and nothing in
	 * the default route constructs it. Held so d-pad down can hand it the pad.
	 */
	perfPanel: PerfPanelHandle | null = null;

	/**
	 * Act on a panel's share of the pad.
	 *
	 * Split from `pollPad` because the two answer different questions: that one
	 * decides *where the pad is pointed*, this one does what was asked once the
	 * answer is known.
	 */
	private applyPanelIntents(intents: PadIntents, context: PadContext) {
		if (context === "modal") {
			// The Commander overlay first: at boot it is the only thing on the
			// glass, and settings does not open over it.
			const overlay = this.commanderOverlay;
			if (overlay?.isOpen()) {
				if (intents.back) return overlay.back();
				if (intents.focusDelta !== 0) overlay.moveCursor(intents.focusDelta);
				if (intents.valueDelta !== 0) overlay.stepValue(intents.valueDelta);
				if (intents.activate) overlay.activate();
				return;
			}
			const panel = this.settingsPanel;
			if (!panel) return;
			if (intents.back) return panel.close();
			if (intents.focusDelta !== 0) panel.moveCursor(intents.focusDelta);
			if (intents.valueDelta !== 0) panel.stepValue(intents.valueDelta);
			// Cross advances the focused row, which is what clicking it does on
			// that screen. The branch ignored `activate` entirely, so the one
			// button a pad player reaches for first did nothing. Sage, round 5.
			if (intents.activate) panel.stepValue(1);
			return;
		}
		// The instrument first: while it holds the pad it holds all six of the
		// controls a console would, so a live-cockpit panel behind it must not
		// also read them.
		const perf = this.perfPanel;
		if (perf?.isFocused()) {
			// **Circle, and not d-pad down again.** While the instrument holds the
			// pad, down walks its rows, so `instrument` is never asked for from in
			// here and a branch reading it was unreachable —
			// `probe-pad-instrument.mjs` found that, not review. The context is
			// its own since the reversal, rather than the console's this comment
			// used to name: a console suspends flight input and the instrument
			// must not.
			if (intents.back) return perf.setFocused(false);
			if (intents.focusDelta !== 0) perf.moveCursor(intents.focusDelta);
			if (intents.activate) perf.activate();
			for (const key of intents.keys) this.command(key);
			return;
		}
		// A console. It takes six discrete controls **and** suspends flight
		// input; `pad-bindings.ts`'s header owns why, and this comment asserted
		// the opposite for a round after the reversal landed.
		if (intents.back) {
			// Circle is the way out. It is also what frees Cross to activate a
			// row rather than launch — and nothing is lost, because LAUNCH is a
			// button *on* the right console and Cross still presses it.
			this.setHeadLook("forward");
			return;
		}
		if (intents.focusDelta !== 0)
			this.liveCockpit.stepFocus(intents.focusDelta);
		if (intents.tabDelta !== 0) this.liveCockpit.stepTab(intents.tabDelta);
		// The console acts on its own rows and refuses the chart's, which are
		// drawn inside the same panel and belong to a handle it does not hold.
		if (intents.activate && !this.liveCockpit.activateFocus())
			this.activateChartRow(this.liveCockpit.focusedElement());
		for (const key of intents.keys) this.command(key);
	}

	/**
	 * Whether the chart has taken the right stick this frame.
	 *
	 * The one thing a stick still *does* inside a console — everything else it
	 * would have done is suspended there, which is the principal's reversal.
	 *
	 * **This paragraph said the opposite for four rounds.** It described the
	 * pre-reversal world, where a console kept the sticks and this was the one
	 * place that claimed one: "the left stick still rolls, the triggers still
	 * trim". Neither is true now — `padFlightAxes` returns nothing at all in a
	 * console, and the same diff's test asserts a pulled trigger reads `0` there.
	 * A fourth copy of "does this context fly?", surviving beside the
	 * `contextFliesShip` that was introduced to end exactly that. Sage found it.
	 *
	 * What remains true is why the chart gets its stick when nothing else does:
	 * the mouse already behaves this way, since dragging the chart means leaving
	 * pointer lock, so the pointer cannot orbit the cluster and fly at the same
	 * instant either.
	 */
	private chartHasStick(): boolean {
		return (
			this.chart !== null &&
			this.view === "cockpit" &&
			this.headLook === "left" &&
			this.leftTab === "Galaxy Map"
		);
	}

	/**
	 * Orbit the chart from the right stick.
	 *
	 * Driven from `animate` rather than from `step`, because `step` returns
	 * early while docked (§12 suspends flight) and the chart is readable there —
	 * a camera that froze on arrival would be a chart the player could not turn
	 * exactly when they are planning the next leg.
	 *
	 * The stick is a rate and `orbit` takes pixels, so the product is a *pixel
	 * rate*: a full deflection sweeps `CHART_ORBIT_PX_PER_S` pixels of drag per
	 * second, which is the unit the pointer hands it.
	 */
	private stepChartOrbit(dt: number) {
		// **The modal check is here as well as in `padFlightAxes`.** This method
		// reads `frame.axes` raw rather than going through that function, so the
		// settings screen — which takes the *whole* pad — was leaving the right
		// stick turning the chart behind the dialog. Sage found it, round 1.
		if (dt <= 0 || this.padContext() === "modal" || !this.chartHasStick())
			return;
		const frame = this.padFrame;
		if (!frame?.connected) return;
		const dx = frame.axes.rightX * CHART_ORBIT_PX_PER_S * dt;
		const dy = frame.axes.rightY * CHART_ORBIT_PX_PER_S * dt;
		if (dx === 0 && dy === 0) return;
		this.chart?.handle.orbit(dx, dy);
	}

	/**
	 * Work one of the chart's own controls from the pad.
	 *
	 * **Through `GalaxyChart.handle`, which is the chart's own API** — not
	 * through a synthetic click on the element. The element is only how the
	 * cursor *names* the row; what it does is a method call, the same one the
	 * chart's own click listener makes.
	 *
	 * `haze` and the jump budget are toggles rather than commands, so each is
	 * read before it is written: the button publishes its state in
	 * `aria-pressed`, and the budget lives on the finder's filter.
	 */
	private activateChartRow(element: HTMLElement | null) {
		const chart = this.chart?.handle;
		if (!element || !chart) return;
		const data = element.dataset;
		if (data.mapHaze !== undefined) {
			chart.setHaze(!chart.state.haze);
		} else if (data.mapCourse !== undefined) {
			chart.commitCourse();
		} else if (data.mapClear !== undefined) {
			// The chart's own Clear action, not a reconstruction of it. Round 3
			// had this dropping the course alone while the mouse listener also
			// deselected; round 4 made both call one named action rather than
			// leaving two copies to be kept in step. Sage, both times.
			chart.clearAll();
		} else if (data.mapFinderEconomy !== undefined) {
			chart.toggleFinderEconomy(Number(data.mapFinderEconomy));
		} else if (data.mapFinderBudgetDown !== undefined) {
			chart.stepFinderBudget(-1);
		} else if (data.mapFinderBudgetUp !== undefined) {
			chart.stepFinderBudget(1);
		} else if (data.mapFinderCentre !== undefined) {
			chart.centreOn(Number(data.mapFinderCentre));
		} else if (data.mapFinderRow !== undefined) {
			chart.select(Number(data.mapFinderRow));
		}
	}

	/**
	 * Read the pad, once per frame, and act on its edges.
	 *
	 * Called from `animate` before `step`, so a press and the frame it belongs
	 * to are the same frame. `poll` is the only thing in the module that touches
	 * `navigator`, and calling it twice in one frame would leave the second call
	 * with an empty `pressed` set — so there is exactly one caller.
	 */
	private pollPad() {
		const frame = this.pad.poll();
		this.padFrame = frame;
		// Read once, here, even with no pad attached: `step` and
		// `hasControlInput` read the cached value, and a stale one would answer
		// for a panel that has since closed.
		this.consoleDrawnThisFrame = this.consoleIsDrawn();
		this.padContextThisFrame = this.readPadContext(this.consoleDrawnThisFrame);
		// **Told, not guessed, and told *after* the read.** The console cannot
		// see which context owns the pad — `readPadContext` answers `instrument`
		// and `modal` before it ever asks whether a console is drawn — so a panel
		// merely *on screen* was wearing the marker while something else held the
		// pad. The game knows, so the game says. Written first, this read last
		// frame's context and the marker lagged a frame; the comment claiming it
		// came after was wrong before this line moved.
		this.liveCockpit.setPadHolds(
			frame.connected && this.padContextThisFrame === "console",
		);
		if (!frame.connected) return;
		const context = this.padContextThisFrame;
		const intents = padIntents(frame, context);
		const acted = intents.keys.length > 0 || intents.activate;
		if (context !== "flight") {
			this.applyPanelIntents(intents, context);
			if (acted) this.padAudioNotice();
			return;
		}
		if (intents.instrument) this.perfPanel?.setFocused(true);
		// Through `command`, not through a second copy of what each key does.
		// The pad presses the key; one implementation stays one implementation.
		for (const key of intents.keys) this.command(key);
		// **After the dispatch, not before it.** `command` opens by clearing
		// `jumpNotice` — #187's "dismissed by playing" — so a notice written
		// first was wiped by the very press that triggered it, and the once-only
		// flag was already spent. The player got silence and no explanation.
		// Sage found it, round 1.
		if (acted) this.padAudioNotice();
	}

	/**
	 * Say once that the pad cannot make a sound.
	 *
	 * A gamepad button is not an *activation triggering input event* — the HTML
	 * specification's list is pointer, keyboard and touch — so it cannot open an
	 * `AudioContext`. A session begun on the pad and played without touching the
	 * keyboard or mouse is therefore silent, and the player has no way to guess
	 * why. Any key or click unlocks it.
	 *
	 * Said on the first pad *action* rather than on the first connected frame,
	 * because the browser hides a pad until a button is pressed and that first
	 * press is deliberately swallowed as a wake-up.
	 */
	private padAudioNotice() {
		if (this.padAudioNoticeSaid || !this.audio.silent) return;
		this.padAudioNoticeSaid = true;
		this.jumpNotice = "PAD: press any key or click once to enable sound";
	}

	private onKey(e: KeyboardEvent, down: boolean) {
		const key = e.key.toLowerCase();
		// Releases must clear flight state even when a panel now owns the key.
		if (!down) this.keys.delete(key);
		if (
			this.view === "cockpit" &&
			this.liveCockpit?.requestsSurfaceOpen() &&
			key === " " &&
			e.target instanceof HTMLButtonElement &&
			e.target.hasAttribute("data-live-request-action")
		) {
			// Native buttons activate on Space release. Do not fire or prevent it.
			return;
		}
		if (
			this.view === "cockpit" &&
			!e.altKey &&
			this.liveCockpit?.requestsSurfaceOpen() &&
			["arrowup", "arrowdown", "arrowleft", "arrowright", "enter"].includes(key)
		) {
			e.preventDefault();
			if (down && !e.repeat) {
				if (key === "enter") this.liveCockpit.activateKeyboardFocus(e.target);
				else {
					// Arrow walking hands input back to the shared cursor. A native
					// button left focused would otherwise steal the following Enter.
					if (e.target instanceof HTMLElement) e.target.blur();
					if (key === "arrowleft" || key === "arrowright")
						this.liveCockpit.stepTab(key === "arrowleft" ? -1 : 1);
					else this.liveCockpit.stepFocus(key === "arrowup" ? -1 : 1);
				}
			}
			return;
		}
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
		// **The jump notice is dismissed by playing** (#187). It is the last
		// thing that happened — a refusal, a commitment, an arrival — and it
		// holds the one prompt line until the pilot does something, which is the
		// only clock this glass has: a timeout would need a lifetime no spec
		// states, and a message that vanished on its own is one a pilot looking
		// at the scanner never read. `chargeJump` clears and rewrites it, so the
		// jump key itself is not a dismissal.
		// **Not while the drive is charging.** The dismissal exists so a refusal
		// clears on the next key; during the wind-up the same line is carrying
		// the countdown, and blanking it left an empty prompt for the rest of
		// the window — the exact failure `chargeJump`'s comment says it fixed,
		// reintroduced through the dismissal path (sage round 2).
		if (this.jumpNotice && key !== "`" && !charging(this.jumpCharge))
			this.jumpNotice = "";
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
				if (this.combatRig?.command("/")) return;
				break;
			case "q":
				if (this.combatRig?.command("q")) return;
				break;
			case "j":
				if (this.regime === "cruise") this.dropOut("dropped by the player");
				else if (this.spoolLeftS > 0) this.cancelSpoolUp();
				else this.engageCruise();
				return;
			case "`":
				// §8's jump, on the one key left.
				//
				// **A key rather than a button on the chart**, and not the letter
				// it wants: `h` is the perf panel's, and the comment on `Enter`
				// below is right that every letter is bound —
				// `tests/perf-panel-keys.test.ts` is what says so rather than a
				// count. The chart is where a *course* is chosen (#11's set
				// course, #70's "which tab, never which application"); this is
				// only the commitment, and it has to be reachable from the flight
				// view because §8's window is a thing you are vulnerable inside.
				this.chargeJump();
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
			// The pad's trim counts for the same reason the keys do. The sticks
			// are already in `yaw`/`pitch`/`roll` above, and they reach here
			// **deadzoned** — `applyRadialDeadzone` returns a hard zero inside
			// the zone, so a resting stick cannot disengage an autopilot the
			// player never touched (#283's F3).
			padFlightAxes(this.padFrame, this.padContext()).throttleTrim !== 0 ||
			// **Only while flying.** A panel swallows the pointer delta below, so
			// counting it here would let a mouse moved over an open console
			// disengage the docking computer without touching the ship.
			(contextFliesShip(this.padContext()) &&
				(this.mouseDx !== 0 || this.mouseDy !== 0))
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
					// **Both getters, for the same reason `currentSystem` is one.**
					// Held as values these froze at mount: a jump with the map
					// open runs `observeCurrentSystemRelay` and then
					// `handle.jumpTo`, and `observeSystemRelay` replaces the
					// envelope — so the destination's just-relayed stations
					// rendered `STATUS UNKNOWN` while their ages ticked up.
					// **`NO_KNOWLEDGE`, not a fresh `{}`.** The panel compares the
					// map by identity to decide whether to re-project, and a
					// literal here allocates a new object on every render — so
					// a galaxy with no envelope yet would miss the memo every
					// frame and re-project 256 systems for a map that never
					// changes.
					knowledge: () =>
						this.commerceWorld.galaxies[this.world.system.record.galaxy]
							?.knowledge ?? NO_KNOWLEDGE,
					now: () => this.world.gameTime,
					// The course is the game's, not the chart's (#187) — the chart
					// is disposed on every tab toggle and a course held inside it
					// went with it.
					course: this.course,
					onCourse: (course) => this.setCourseTo(course),
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
				// Through `velocityOf`, not `bodyVelocity`: the striker is
				// selectable and is not a world body.
				vel: this.velocityOf(target.id),
			},
			this.masses(),
			this.cruiseParams,
			this.regime === "cruise" ? this.throttle : 1,
		);
	}

	/**
	 * Turn the head to a side console, or back to forward.
	 *
	 * **A camera pan, and not only one.** Flight controls and the ship's nose stay
	 * live — that half is #283's ruling, and a key still flies the ship while the
	 * head is turned. What the turn also does is end the pointer lock's claim on the
	 * mouse, **by drawing a console rather than by anything said here**: the next
	 * frame's `reconcilePointerLock` reads the surface this rendered (#371). Nothing
	 * here releases the pointer, and that is the point: the release belongs to the
	 * drawn surface, so any way a console gets drawn gets it.
	 */
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
				.map((b) => ({
					id: b.id,
					pos: { ...b.pos },
					radiusKm: b.radiusKm,
					vel: bodyVelocity(this.world.system, b.id, this.world.gameTime),
					accelerationBoundKms2: bodyAccelerationBound(this.world.system, b.id),
				}));
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
			const order = {
				station: 0,
				planet: 1,
				star: 2,
				moon: 3,
				ship: 4,
				relay: 5,
				// Contacts are appended after the sort and never reach the
				// comparator, but the map is indexed by the whole `BodyKind`, so a
				// kind missing here is a build error rather than a silent NaN.
				cargo: 6,
			} as const;
			this.selectableCache = this.world.system.bodies
				.filter((b) => b.kind !== "moon")
				.sort(
					(a, b) => order[a.kind] - order[b.kind] || a.id.localeCompare(b.id),
				);
			this.selectableCache.push(...this.contacts);
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
		if (!this.targetId) return null;
		return this.bodyFor(this.targetId);
	}

	/** Resolve through the same selection projection that exposes contacts. */
	private bodyFor(id: string): Body | null {
		return (
			this.world.system.byId.get(id) ??
			this.selectable().find((body) => body.id === id) ??
			null
		);
	}

	/** The selected target's current range in simulation kilometres, if any. */
	targetRange(): number | null {
		const target = this.targetBody();
		return target ? length(sub(target.pos, this.world.ship.pos)) : null;
	}

	/**
	 * The speed between the ship and the selected target, in km/s, or `null`
	 * with nothing selected.
	 *
	 * The same quantity `scoops` tests; `hud-and-scanner.md` §3 owns why it is
	 * this and not a range rate. Public because it is the figure a scoop is
	 * flown on (#324). Not `closingKms`: that name is taken on `Game` by the
	 * approach pose.
	 */
	targetRelativeKms(): number | null {
		const target = this.targetBody();
		if (!target) return null;
		return length(sub(this.world.ship.vel, this.targetVelocity()));
	}

	/**
	 * Whether this body is the selected target.
	 *
	 * One predicate, read by both canister draw loops, because they carry
	 * complementary conditions: if they stop being exact inverses a canister is
	 * drawn twice or not at all (sage #353).
	 */
	private isSelectedTarget(id: string): boolean {
		return id === this.targetId;
	}

	/**
	 * What to do next, in one phrase, or "" when there is nothing to say.
	 *
	 * Shown whenever normal flight cannot reasonably reach the selected target —
	 * which at the 2 km/s assist cap is anything past a few thousand kilometres,
	 * and is *most of a system*.
	 */
	private cruisePrompt(targetKm: number | null): string {
		// §8's window and its outcome outrank everything below (#187). The pilot
		// is committed for three seconds and then in another star system; a line
		// about the drive charge would be answering a question nobody asked.
		//
		// **The notice is what a refused key press has instead of silence.** A
		// jump key that sometimes does nothing is indistinguishable from one that
		// is not bound, and the MODE cell can only show a window that opened.
		if (charging(this.jumpCharge) || this.jumpNotice) return this.jumpNotice;
		if (this.spoolLeftS > 0) return "";
		if (this.detour?.targetId === this.targetId)
			return `DETOUR AROUND ${this.bodyFor(this.detour.bodyId)?.name ?? this.detour.bodyId}`;
		if (this.regime === "cruise") return "";
		// **The same predicate the strip's tone reads.** As `chargeAu <= 0` this
		// and the strip disagreed on the frame after a starve-out: regeneration
		// lifts the raw value off zero immediately, so the prompt returned to
		// "press J to cruise" beside a cell still printing "0.0/12 AU".
		if (chargeReadsEmpty(this.chargeAu))
			return "no drive charge — wait for it to regenerate";
		// **A set course outranks the cruise hint, and that is a playtest
		// correction.** The jump line used to sit inside the `targetKm` branch
		// below, so it appeared only with a target selected *and* the ship
		// already within 7,200 km of it — and a ship arrives 1 AU out. The
		// principal set a course, flew forward, and saw nothing: the one prompt
		// for the mechanic this node exists to build was unreachable in practice.
		// Five sage rounds and 1,110 headless tests had not found it, because
		// none of them asks whether a player would ever see the line.
		//
		// It wins over "press J to cruise" rather than sharing the row, because
		// cruise is discoverable without this line — the key help along the
		// bottom of the frame names it — and the jump was not discoverable
		// anywhere.
		//
		// **This is the prompt only.** A *persistent* indication that a course is
		// set is #117's, and it is a real gap: today the set course appears in
		// the legacy HUD alone (`?legacy`), because `hud-and-scanner.md` §5 fixes
		// the floor strip at four cells and gives it no home. This line does not
		// stand in for that.
		const hop = this.nextHop();
		if (hop) {
			// **The same gate §8.3's course row reddens on.** The row carried the
			// tone and this line carried the sentence, and §5.2 said so — but
			// this line never asked `planJump`, so a tank too short for the next
			// hop painted a red row beside "press ` to jump to ANDIMA" and the
			// refusal arrived only after the key was pressed. That is #92's
			// `chargeReadsEmpty` defect exactly: two halves of one reading
			// disagreeing on the glass, and the fix is the same one — one
			// predicate, read by both.
			const decision = this.jumpDecision(hop);
			return decision.ok
				? `press \` to jump to ${hop.name}`
				: jumpRefusalText(decision.refusal, hop.name);
		}
		if (targetKm === null) return "T selects a target";
		// An hour at the cap, which is 7,200 km. Below that the crawl is the
		// intended experience — #10 §3 bounds the drop radius by exactly this
		// argument — and above it the answer is always cruise.
		if (targetKm < 3600 * ASSIST_CAP_KMS) return "";
		return "press J to cruise";
	}

	/**
	 * The planet hosting the selected station, if the target is a station —
	 * #30's arrival rule reads it. This deliberately returns null for planets:
	 * the automatic detour contract belongs to station travel, not to every body
	 * with an orbital parent.
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
		return this.targetId ? this.velocityOf(this.targetId) : v3();
	}

	/**
	 * How fast a **selectable** thing is moving, whether or not the world holds
	 * it.
	 *
	 * One place, because `bodyVelocity` **throws** on an id it cannot find —
	 * deliberately, since `sim.ts` reads a missing body as the two halves
	 * disagreeing about what is in the system — and #53 put something selectable
	 * outside `byId` for the first time. Two callers reach it: `targetVelocity`
	 * on every cruise frame, and `timeToBody` from the panel without cruising at
	 * all, so a guard written into only one of them left the other live.
	 */
	private velocityOf(id: string): Vec3 {
		const body = this.bodyFor(id);
		if (body && isDisplayContact(body)) return body.velocity;
		return bodyVelocity(this.world.system, id, this.world.gameTime);
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
		if (this.proximityFrameBodyId) {
			const held = this.world.system.byId.get(this.proximityFrameBodyId);
			if (held) {
				const surfaceKm =
					length(sub(held.pos, this.world.ship.pos)) - held.radiusKm;
				if (surfaceKm <= NEAR_FAR_KM) {
					this.frameBody = held;
					return;
				}
			}
			this.proximityFrameBodyId = null;
		}
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
		return forwardOf(this.orientation);
	}

	/** The weapon ray is the sightline through the cockpit's central reticle —
	 *  `nose()`'s arithmetic against the camera's rotation rather than the
	 *  ship's, which is the whole of the difference between the two. */
	private weaponAim() {
		return forwardOf(this.cameraRotation());
	}

	/** Where the gimballed beam points (#324): the boresight turned toward the
	 *  selected target within the gimbal's cone. */
	private beamAim(): Vec3 {
		const bore = this.weaponAim();
		// **Clamped at every read, not only when stepped.** The gimbal steps at
		// the frame's start, and the attitude can change later in the same frame;
		// a stored beam read after that could point outside the new cone. The
		// duel-hud probe turned the ship a quarter turn between step and render
		// and still saw ON TARGET.
		return this.gunAim ? clampToCone(this.gunAim, bore, GIMBAL_CONE_RAD) : bore;
	}

	/** One step of the gimbal toward the selected target, before the shot. */
	private stepGunGimbal(dt: number) {
		const bore = this.weaponAim();
		// **Only a combat target pulls the beam** (sage #330): a station or a
		// planet selected near the nose would turn it off the boresight, and a
		// raider on the boresight but not selected would then be missed. The
		// relay is one (#43): the principal flew the first build with the beam
		// held on the boresight and could not hit it beside a planet.
		const target =
			this.raiderSelected() || this.relaySelected() || this.trafficSelected()
				? this.targetBody()
				: null;
		const targetDir = target ? directionTo(this.cameraPos(), target.pos) : null;
		this.gunAim = stepGimbal(this.gunAim ?? bore, bore, targetDir, dt);
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
	 * The berth catalogue for one station (§13).
	 *
	 * Through `interiorOfStation` rather than a second `stationInterior` call,
	 * so the renderer, the protocol and the traversal read one catalogue at one
	 * seed — a second lookup with a different seed is an outpost whose drawn
	 * berth is on the other wall from the one the ship parks in.
	 */
	interiorOf(id: string): StationInterior {
		// **Memoised, because the protocol tick reads it for every station every
		// frame and the docked tick reads it 60 times a second.**
		// `stationInterior` maps `ROLE_BERTHS` into up to eight fresh `Berth`
		// records with two offsets each; the argument it replaced was a map
		// lookup, and the line two below it already treats one map write per
		// station per frame as a cost worth avoiding.
		//
		// **System-scoped, and cleared on a jump.** The catalogue is a pure
		// function of the station's type, its geometry and its `berthSeed`, so
		// it never goes stale *within* a system — this comment used to say a
		// `Game` holds one system for its whole life and that a build adding a
		// jump owed the map a clear. #187 is that build, and `performJump`
		// clears it beside the other per-system state.
		const cached = this.interiors.get(id);
		if (cached) return cached;
		const built = interiorOfStation(stationOf(this.world.system, id));
		this.interiors.set(id, built);
		return built;
	}

	private readonly interiors = new Map<string, StationInterior>();

	/** The traffic record `stepDockingProtocol` fills and reuses. Mutable and
	 *  private, because `tickDocking` reads it synchronously and keeps nothing;
	 *  the hull never changes while #26's roster is one hull. */
	private readonly traffic = {
		interior: null as unknown as StationInterior,
		hull: PLAYER_ENVELOPE,
		occupied: EMPTY_BERTHS as ReadonlySet<string>,
		sessionHere: false,
	};

	/** How long the traversal in progress takes, seconds, or `null` when none
	 *  is (§13.3). On the page because the duration is priced on the *route* —
	 *  a caller scaling by a constant is scaling by the wrong one for any berth
	 *  but the shortest. */
	get dockTraversalSeconds(): number | null {
		return this.dock.law?.durationS ?? null;
	}

	/** The berth ids one station offers (§13.2), so a probe asks the sim which
	 *  berths exist rather than rebuilding a catalogue of its own. */
	berthIdsOfStation(id: string): string[] {
		return this.interiorOf(id).berths.map((berth) => berth.id);
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
			// §13.2: a grant reserves a berth, so the protocol needs the catalogue
			// and the envelope it has to fit.
			interior: this.interiorOf(chosen.id),
			hull: PLAYER_ENVELOPE,
			// §6.1: the same live Traffic occupancy map the route projector fills.
			occupied: this.occupiedAt(chosen.id),
			// #13 §5.1.1's shipyard scan. The predicate behind it is #8's and
			// unbuilt, so nothing fails one yet — the *moment* is what this node
			// owes, and it is here.
			scanFails: false,
		});
		this.dockingStates.set(chosen.id, next);
		if (next.clearance.kind === "queued")
			this.openPlayerTrafficEvent(
				chosen.id,
				"clearance",
				this.world.gameTime,
				undefined,
				PLAYER_ENVELOPE,
			);
		else this.closePlayerTrafficEvent(chosen.id, "clearance");
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
		const interior = this.interiorOf(target);
		// The berth this ship holds **at this station** — `null` at any other,
		// which is what keeps the three fields below from asking one station's
		// catalogue for another station's address.
		const heldBerth =
			this.dock.stationId === target
				? (this.dock.berthId ?? state.berthId)
				: state.berthId;
		const full = playerFullCondition();
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
			offAxisKm: offAxisKm(frame, pose.rel),
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
			// §13's reservation, on the page: which berth the grant holds and
			// where the ship parks in it. A probe reading `berthId` against
			// `berthAxialKm` is reading the reservation the sim placed the ship
			// by rather than re-deriving a catalogue of its own.
			// **All three read one source and one catalogue.** `berthId` fell back
			// to the protocol state while the other two read the session's, so a
			// probe comparing them was comparing two different berths — and
			// `berthOf` throws on an address the target's catalogue does not
			// have, so a snapshot of a *different* station while docked
			// (`overhead-near` against a refinery) aborted the run rather than
			// answering.
			berthId: heldBerth,
			berthAxialKm: heldBerth
				? berthCentre(berthOf(interior, heldBerth)).axial
				: null,
			berthUp: heldBerth
				? recomposeDirection(
						frame,
						berthOf(interior, heldBerth).normal,
						frame.phaseRad,
					)
				: null,
			// E9's generated name, read off the page rather than re-derived by a
			// probe: a probe with its own copy of a rule goes falsely red the day
			// the rule changes.
			stationName: this.nameOfStation(target),
			condition: this.condition,
			alive: isAlive(this.condition),
			// The full head-on pool and the full condition, so a probe asserting
			// §2.1's quarter-pool bound — and resetting to full before it — reads
			// both off the page instead of restating the shield and hull figures.
			poolMax: headOnPool(full),
			conditionFull: full,
			lastEntry: this.lastEntry,
		};
	}

	/** §7's toggle. Refused without the equipment, and it never bypasses a
	 *  check — `dockingComputerStep` refuses the same conditions a pilot fails. */
	toggleDockingComputer() {
		if (!this.hasDockingComputer) return;
		this.dockingComputerEngaged = !this.dockingComputerEngaged;
		this.lastComputerPhase = "idle";
		if (this.dockingComputerEngaged) this.lastComputerRefusal = null;
		else this.clearPlayerArrivalLaneRequests();
	}

	/** A cancelled computer approach must not keep an invisible arrival turn. */
	private clearPlayerArrivalLaneRequests() {
		for (const [stationId, request] of this.playerLaneRequests)
			if (request.movement === "arrival")
				this.playerLaneRequests.delete(stationId);
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
			const next = tickDocking(state, this.world.gameTime, {
				interior: this.interiorOf(id),
				hull: PLAYER_ENVELOPE,
				occupied: this.occupiedAt(id),
				sessionHere: this.dock.stationId === id && this.dock.phase !== "flying",
			});
			if (state.clearance.kind === "queued" && next.clearance.kind !== "queued")
				this.closePlayerTrafficEvent(id, "clearance");
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
			// `planeCrossing` intentionally solves an infinite mathematical plane.
			// It says when a trajectory reaches the aperture depth, not whether the
			// station occupies that point. Without this physical-volume gate, an
			// ordinary fly-by 1.6 km off a 0.6 km station counted as barging through
			// its entrance and silently made the station hostile. The body's radius
			// is the authored bound of the dockable core; outside it there is neither
			// hull nor aperture to enter.
			const body = this.world.system.byId.get(id);
			if (!body || length(crossing.rel) > body.radiusKm) continue;
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
		const arrivalRequest = this.playerLaneRequests.get(id);
		const outcome = attemptEntry({
			frame,
			pose: crossing,
			state: this.dockingStateOf(id),
			gameTime: this.world.gameTime,
			laneAvailable: this.playerWinsTrafficLane(
				id,
				arrivalRequest?.movement === "arrival"
					? arrivalRequest.readyAt
					: this.world.gameTime,
				"arrival",
			),
		});
		if (arrivalRequest?.movement === "arrival")
			this.playerLaneRequests.delete(id);
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
			const station = this.world.system.contents.stations.find(
				(candidate) => candidate.id === id,
			);
			// **Loud, not silent.** `if (station)` made a docked id missing from
			// the roster a no-op, so §9.10's docking write would vanish with
			// nothing said — and the reservation lookup below already refuses
			// the analogous case out loud rather than papering over it.
			if (!station)
				throw new Error(
					`docked at ${id}, which is not in this system's roster`,
				);
			this.commerceWorld = observeDocking(
				this.commerceWorld,
				this.world.system.record.galaxy,
				carrierKey(this.world.system.record.index, station.localCarrierId),
				this.world.gameTime,
				station.type === "refinery",
			);
			// **E2: crossing the plane hands the ship over.** The skill test
			// ended here, so from this instant the ship is on rails and nothing
			// can fail — the arrival is a position law, and `stepDockedWorld`
			// places the ship every frame until it parks.
			const interior = this.interiorOf(id);
			// The berth the grant reserved (§13.2). A dock with no reservation is
			// the protocol and the crossing having disagreed, not a case to paper
			// over with a default berth — `attemptEntry` cannot return `docked`
			// without a live grant, and a live grant carries a berth.
			const reserved = outcome.state.berthId;
			if (!reserved) throw new Error(`docked at ${id} with no berth reserved`);
			// A dock ends §8's window: the ship is parked inside a station on a
			// berth reservation, which is not a place to jump from (#187). The
			// charge is cancelled rather than frozen, because a frozen one would
			// resume on launch with a notice from before the dock.
			this.cancelJumpCharge("docked");
			// A dock ends any encounter: a station is not a place a raider follows.
			this.encounter = null;
			this.encounterView = null;
			this.raiderFiring = false;
			this.dock = enterArrival(
				id,
				frame,
				interior,
				berthOf(interior, reserved),
				crossing.rel,
				{ nose: crossing.nose, up: crossing.up },
				this.world.gameTime,
			);
			this.openPlayerTrafficEvent(id, "lane", this.world.gameTime, "arrival");
			this.world.ship.vel = stationVel;
			// D4's unconditional dock flush, and the one that lays down #89's
			// `lastDocked` checkpoint — the record a non-permadeath death
			// restores.
			//
			// **After `enterArrival`, not before it.** It fired at the plane
			// crossing for a round, where the dock session did not yet name a
			// station: both records then carried `dockedAt: null` and a
			// `flight.pos` in the mouth with inward velocity, so a death restore
			// would have taken the in-flight arm and put the ship at the
			// aperture with no grant — which by #9's protocol is a hostile
			// station on load. From this line the arrival is on rails and cannot
			// fail, so the write still cannot record a dock that did not happen.
			this.saveDirty();
			this.saveFlush("dock");
			return;
		}
		// §2.0: repelled, damaged, and left outside — never inside the station.
		// The pool is the side facing the station: `crossing.rel` is the ship from
		// the station's centre, so the station lies along its negation. A nose-first
		// entry meets it on the fore shield. Through `takeDamage`, so the clip
		// cancels a jump charge (#187) and a cruise spool-up alike.
		this.takeDamage(
			outcome.damage,
			sideStruck(crossing.nose, scale(crossing.rel, -1)),
			// Not "hull damage": a clip at the gate stays inside the fore shield.
			"struck the station",
		);
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
		const wasAt = this.dock.stationId;
		const wasLaunching = this.dock.phase === "launching";
		const wasArriving = this.dock.phase === "arriving";
		const out = stepDockedWorld(
			this.world,
			this.dock,
			dt,
			this.dock.stationId ? this.interiorOf(this.dock.stationId) : undefined,
		);
		this.dock = out.session;
		// **§13.2's release, at the one moment the receipt names**: the outward
		// aperture crossing, which is where the launch law ends. Held through
		// arrival, docking and the launch itself, so a ship that sat docked for
		// twenty minutes never lost its berth to a lapsed grant.
		if (wasLaunching && this.dock.phase === "flying" && wasAt) {
			const state = this.dockingStates.get(wasAt);
			if (state) this.dockingStates.set(wasAt, releaseBerth(state));
			// **This is where `dockedAt` becomes null**, so this is where the
			// record stops describing a parked ship. Left to the debounce, a tab
			// closed in the first moments of a launch reloaded as still parked —
			// which is what the flush above was wrongly credited with
			// preventing.
			this.saveDirty();
		}
		if (
			wasAt &&
			((wasLaunching && this.dock.phase === "flying") ||
				(wasArriving && this.dock.phase === "docked"))
		)
			this.closePlayerTrafficEvent(wasAt, "lane");
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
		const stationId = this.dock.stationId;
		const pending = this.playerLaneRequests.get(stationId);
		const readyAt =
			pending?.movement === "launch" ? pending.readyAt : this.world.gameTime;
		this.playerLaneRequests.set(stationId, {
			readyAt,
			movement: "launch",
		});
		const refusal = this.trafficLaneRefusal(stationId, readyAt, "launch");
		if (refusal) {
			// **Held, not dropped (#314).** A refused press used to delete the
			// request, so nothing on screen said why and every retry went to the
			// back of the queue. The request keeps its first `readyAt`, which is its
			// place in `playerWinsLane`'s order, and `stepHeldLaunch` retries it.
			// The reason the old code deleted it still stands — a request nobody
			// will act on makes every later Traffic tick lose — so a hold ends on
			// cancel and on any step the ship is not docked at that station.
			this.launchHold = { stationId, refusal };
			return false;
		}
		this.launchHold = null;
		this.playerLaneRequests.delete(stationId);
		this.dock = requestLaunch(
			this.dock,
			this.apertureFrameOf(this.dock.stationId),
			this.interiorOf(this.dock.stationId),
			this.world.gameTime,
		);
		if (this.dock.phase === "launching") {
			this.openPlayerTrafficEvent(stationId, "lane", readyAt, "launch");
			// D4's undock flush. **The record still names the station here** —
			// `commanderRecord` reads every phase that is not `flying`, and this
			// runs inside `phase === "launching"` — so what this writes is a ship
			// on rails on its way out, which restores at the arrival point like
			// any other non-flying phase. The comment here claimed the opposite
			// for a round. What actually clears `dockedAt` is the outward
			// crossing below, and that is where the second write is.
			this.saveDirty();
			this.saveFlush("undock");
		}
		return this.dock.phase === "launching";
	}

	/** Give up a held launch (#314). The request goes with it. */
	cancelLaunch() {
		const hold = this.launchHold;
		if (!hold) return;
		this.launchHold = null;
		if (this.playerLaneRequests.get(hold.stationId)?.movement === "launch")
			this.playerLaneRequests.delete(hold.stationId);
	}

	/**
	 * Retry a held launch, or end it once there is nothing to launch from (#314).
	 *
	 * Every step and every phase: a hold outliving the dock — a restore, a
	 * reset — would leave a launch request no one acts on, which is the starved
	 * Traffic the old delete prevented.
	 */
	private stepHeldLaunch() {
		const hold = this.launchHold;
		if (!hold) return;
		if (this.dock.phase !== "docked" || this.dock.stationId !== hold.stationId)
			this.cancelLaunch();
		else this.launch();
	}

	/** One arbitration rule for the player's two directions through the lane. */
	private playerWinsTrafficLane(
		stationId: string,
		readyAt: number,
		movement: "arrival" | "launch",
	): boolean {
		return this.trafficLaneRefusal(stationId, readyAt, movement) === null;
	}

	/**
	 * Why the lane is not the player's yet, or `null`.
	 *
	 * Cold parked projections make berth occupancy truthful, but they do not
	 * reconstruct an actor already committed to the shared transit lane — so
	 * an authority still warming refuses. A pre-registered computer/launch
	 * request is represented in Traffic's authority timeline, but it still
	 * competes by the same oldest-ready ordering: registration prevents later
	 * generated turns from overtaking; it does not grant the player priority
	 * over an older queued Carrier. The order itself is `playerLaneRefusal`'s.
	 */
	private trafficLaneRefusal(
		stationId: string,
		readyAt: number,
		movement: LaneRequest["kind"],
	): LaneRefusal | null {
		return playerLaneRefusal({
			authorityReady: this.trafficAuthorityReady(),
			routes: this.trafficRoutes,
			stationId,
			readyAt,
			movement,
		});
	}

	/** Skip the traversal in progress. Unconditional on both sides since §13.3:
	 *  an arrival's skip completes at the reserved berth, a launch's outside the
	 *  aperture. E4's per-type novelty flags are retired, not stored. */
	skipDockTraversal(): boolean {
		if (!canSkipTraversal(this.dock)) return false;
		const stationId = this.dock.stationId;
		this.dock = skipTraversal(this.dock, this.world.gameTime);
		if (stationId) this.closePlayerTrafficEvent(stationId, "lane");
		return true;
	}

	private stepDockingComputer(
		dt: number,
		approaches: Map<string, DockingApproach>,
	): boolean {
		// Taken before anything can return. Every early exit leaves the corridor,
		// so the stored phase is idle unless a step runs and records its own.
		let previousPhase = this.lastComputerPhase;
		this.lastComputerPhase = "idle";
		if (!this.dockingComputerEngaged || this.dockedAt) return false;
		// The first entry is the nearest station: `dockingApproaches` walks in
		// range order.
		const [nearestId, approach] = approaches.entries().next().value ?? [];
		if (!nearestId || !approach) return false;
		// A phase belongs to one station's corridor; carried to another it would
		// start that run-in on the wide side of the hysteresis.
		if (nearestId !== this.lastComputerStationId) {
			previousPhase = "idle";
			this.lastComputerStationId = nearestId;
		}
		const { frame } = approach;
		const stationState = this.dockingStateOf(nearestId);
		const awaitingBerth = stationState.clearance.kind === "queued";
		const command = dockingComputerStep({
			frame,
			pose: approach.pose,
			// A queued request is permission to line up and wait, not to enter.
			// Feed the geometric controller a temporary live grant so it can track
			// the rotating corridor; the run-in speed is held at zero below until
			// the real protocol state promotes the request and names its berth.
			state: awaitingBerth
				? {
						...stationState,
						clearance: {
							kind: "granted",
							expiresAtS: Number.POSITIVE_INFINITY,
						},
					}
				: stationState,
			gameTime: this.world.gameTime,
			maxSpeedKms: ASSIST_CAP_KMS,
			previousPhase,
		});
		this.lastComputerPhase = command.phase;
		if (!command.engaged) {
			// **Silent disengagement is the failure mode here.** §8's HUD cues are
			// not this node's, so nothing tells the player the autopilot stopped —
			// and a grant taken at the far edge of `VICINITY_KM` expires mid-approach
			// (§11.7), which is precisely when this fires. Leaving the throttle
			// where the computer put it would hand back a ship still closing at a
			// speed nobody chose, so the throttle goes to zero and the reason is
			// recorded for the HUD node to read.
			this.dockingComputerEngaged = false;
			this.clearPlayerArrivalLaneRequests();
			this.lastComputerRefusal = command.refused;
			this.throttle = 0;
			return false;
		}
		const rate = PLAYER_PERFORMANCE.angularMax;
		const nose = slewToward(this.nose(), command.nose, rate.yaw * dt);
		const up = slewToward(this.shipUp(), command.up, rate.roll * dt);
		this.setAttitude(nose, up);
		let speedKms = command.speedKms;
		if (command.phase === "run-in") {
			if (awaitingBerth) speedKms = 0;
			else {
				const pending = this.playerLaneRequests.get(nearestId);
				const readyAt =
					pending?.movement === "arrival"
						? pending.readyAt
						: this.world.gameTime;
				this.playerLaneRequests.set(nearestId, {
					readyAt,
					movement: "arrival",
				});
				// The computer waits at the corridor entrance instead of testing a busy
				// aperture and bouncing. An older non-preemptive movement still finishes;
				// once it does, Traffic sees this request and later actors queue behind it.
				if (!this.playerWinsTrafficLane(nearestId, readyAt, "arrival"))
					speedKms = 0;
			}
		}
		this.throttle = Math.min(1, speedKms / ASSIST_CAP_KMS);
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
	 * What is selected on frame one.
	 *
	 * One method with two callers — the constructor and `resetFlightToStart` — because
	 * it was briefly two copies and they diverged immediately: the reset set
	 * `null` while a boot selects the nearest station, and a browser check with
	 * its own hardcoded `null` reported that as boot state for five runs. The
	 * name scan in `tests/leg-reset-coverage.test.ts` compares names, not
	 * values, and would never have caught it. One expression cannot disagree
	 * with itself.
	 */
	private selectBootTarget() {
		// Something is selected on frame one: a cruise panel with an empty target
		// field on boot reads as broken.
		this.targetId = this.nearestOfKind("station")?.id ?? null;
	}

	/**
	 * Put the **flight session** back where a fresh boot leaves it, without
	 * rebuilding the world.
	 *
	 * ## Who this is for
	 *
	 * `probe-arrival.mjs` flies two cruise legs and needs the second to start
	 * where the first did. It used to get that by reloading the page between
	 * them, which timed out at 30 s against a 4.2-7.4 s cold boot — the leg
	 * before it runs a full step-and-render loop inside one `page.evaluate`, so
	 * the navigation is the first call that has to interrupt whatever that left
	 * running, and the timeout landed there rather than on the cause. #121
	 * ratified removing the navigation instead of raising the number.
	 *
	 * ## What it is, and what it deliberately is not
	 *
	 * A **ship-state reset within one system**, never a rebuild.
	 * `resetWorldToStart` in `sim.ts` carries the argument for why, and owns the
	 * clock, the bodies and the arrival point. Neither the reasoning nor the
	 * values are restated here; what is left is this class's own session state.
	 *
	 * ## On being reachable from a production console
	 *
	 * `private` is erased at runtime and this instance is published whole as
	 * `window.__seelite`, which is why the combat rig's loop control took three
	 * attempts to place and why `probe-boot.mjs` walks the prototype chain to
	 * keep it off. This method is deliberately *not* held to that, and the
	 * difference is the state each one leaves behind. Stopping the frame loop
	 * puts the page somewhere the game never goes and cannot leave, and there is
	 * no way back. This lands somewhere the game does go, with the loop running —
	 * but only for what its name covers. **Called mid-dock it leaves the docking
	 * session part-way through**, which is a state no boot produces; that is why
	 * the method is `resetFlightToStart` and not `resetToStart`, and it is the
	 * limit below rather than a footnote to a safety claim.
	 *
	 * It adds no *reach*: the ship, the clock and the whole session are already
	 * writable fields on the published object, so anything this can do was a few
	 * assignments away. What it adds is a **name** on the shipped console
	 * surface, which #89's save/load will be expected to keep working rather
	 * than to replace.
	 *
	 *
	 * ## What it does not reset, and why the name says so
	 *
	 * The **docking session**. `dock`, `interimCondition` and the commerce clock
	 * stamp are written by `stepDockPhase`, `enterArrival` and `applyDamage`,
	 * none of which is on the coverage scan's declared list — so the guard cannot
	 * see this gap either, which is why it is written here and why the method is
	 * named for the half it does deliver. Called after a leg that entered an
	 * aperture it would put the ship at the arrival point with a docking phase
	 * part-way through. `probe-arrival` never docks. Anything that does needs the
	 * docking path added to this method **and** to `LEG_PATH`, and then the name
	 * can lose its qualifier.
	 *
	 * ## Why the list is long
	 *
	 * Because a short one would be wrong. `tests/leg-reset-coverage.test.ts`
	 * reads this method and every method a leg runs through, and goes red if the
	 * flight path assigns a field this does not. The failure it exists to
	 * prevent is silent: a forgotten field starts the next leg in a state no
	 * player ever has, and the probe flying that leg reports a well-formed
	 * number about the wrong start.
	 *
	 * The caches are in the list for a sharper reason than tidiness. They are
	 * stamped with the clock, and this is the only operation in the game that
	 * moves the clock backwards — a value stamped at t=900 and read at t=0 is
	 * being asked something a forward-only game never asks it.
	 */
	/**
	 * Everything held *about a system* — dropped when the ship is no longer in
	 * one.
	 *
	 * Two kinds, and they are here together because they have one lifetime.
	 * **Per-station protocol state**: a grant is a berth reservation (#147), and
	 * there is no berth in the new system to honour one at. **Caches**: every one
	 * below is keyed on a body set or on a clock that has just changed under it.
	 *
	 * Extracted from `performJump` in sage round 4 — that method had grown to
	 * hold world movement, renderer rebuild, protocol teardown and cache
	 * invalidation in one block, so the four evolved together whether or not
	 * they meant to.
	 */
	private clearSystemScopedState() {
		this.dockingStates.clear();
		this.berthOccupancy.clear();
		this.interiors.clear();
		this.stationConsoleCache = null;
		this.stationConsoleCacheKey = null;
		this.massesCache = null;
		this.massesAt = Number.NaN;
		this.etaCache = null;
		this.etaAt = Number.NEGATIVE_INFINITY;
		this.navEtaCache.clear();
		this.navEtaAt = Number.NEGATIVE_INFINITY;
		this.navOrder = [];
		this.selectableCache = null;
		// #43: the relay is the system's; its plan and its hull go with the system.
		this.relayPlanSystem = -1;
		this.relayPlanCache = null;
		this.relayHull = RELAY_INTEGRITY;
		this.relayHullInstance = 0;
	}

	/**
	 * Everything a flight session is, cleared — the state that must not survive
	 * arriving somewhere new, whether that is a jump or a reset to the start.
	 *
	 * **Extracted because it was written twice** (sage round 2). `performJump`
	 * and `resetFlightToStart` both spelled these fifteen assignments, and only
	 * one of them is watched by `tests/leg-reset-coverage.test.ts` — so a field
	 * added to the flight session would have been zeroed on a reset and left
	 * running across a jump, which is the half nothing would have caught.
	 *
	 * What is deliberately **not** here is what the two do differently:
	 * a reset refills the drive charge and clears the jump charge, because a
	 * boot has both; a jump refills neither, since §7 refills the drive on
	 * docking and a jump is not a dock. Caches and per-station protocol state
	 * stay at their call sites for the same reason — a jump has a system's worth
	 * to drop and a reset has a clock rewind's worth.
	 */
	private clearFlightSession() {
		this.regime = "normal";
		this.spoolLeftS = 0;
		this.throttle = 0;
		this.cruiseSpeedKms = 0;
		this.closingKms = 0;
		this.legStartedAtS = null;
		this.lastLegS = null;
		// A raider belongs to the leg it was drawn on: a jump or a reset leaves it
		// behind. Render drops its contact and hull on the next frame.
		this.encounter = null;
		this.encounterView = null;
		// A charge belongs to the leg it was held on, exactly as a raider does.
		// Without this, five seconds spent on a carrier in one system would arrive
		// part-way banked in the next, where a stranger's scan finishes under the
		// pilot's nose — the rule cruise and docking already keep, which `stepScan`
		// cannot reach because it runs on the flight tail. `tests/leg-reset-coverage`
		// asked for both fields the moment they were assigned on the flight path.
		this.scanHold = beginScanHold();
		this.scanFacts = null;
		this.raiderFiring = false;
		this.gunFeedback = QUIET_GUN;
		this.canisters = [];
		// And their contacts, now, rather than on the next step: `performJump`
		// refreshes the scanner before any step runs, so the arrival frame would
		// otherwise carry the old system's canister blips — and a reset while
		// docked returns through `stepDockPhase` before the sync, leaving them
		// selectable until launch (sage #353).
		this.syncCargoContacts();
		// And the scoop's acknowledgement: a notice about cargo taken on the last
		// leg has nothing to say after a jump or a reset, and `leg-reset-coverage`
		// is the row that insists on it.
		this.scoop = { text: "", left: 0, accepted: true, canisterId: null };
		this.scoopRender = null;
		this.gunAim = null;
		this.struckFor = 0;
		this.lastExit = "";
		this.detour = null;
		this.frameBody = null;
		this.proximityFrameBodyId = null;
		this.dockingComputerEngaged = false;
		// An armed jump does not survive arriving somewhere. `takePendingJump`
		// clears it before it calls `performJump`, so this is the reset's case
		// and any later one — the coverage scan asked for it the moment the
		// field existed, which is the scan doing its job.
		this.pendingJump = null;
		this.rates = { pitch: 0, yaw: 0, roll: 0 };
		this.mouseDx = 0;
		this.mouseDy = 0;
		this.chaseYaw = 0;
	}

	resetFlightToStart() {
		// **Asked before the reset, because afterwards the answer is always yes.**
		// `resetWorldToStart` is total: from another star it rebuilds the start
		// system rather than refusing. The renderer's meshes and body maps are
		// the departed system's, so without the rebuild below a reset after a
		// jump simulates one system while drawing another — sage round 3 (codex)
		// caught this as the cost of round 2's fix, which is the shape this node
		// has hit twice now.
		const replacesSystem = !canResetWorldToStart(this.world);
		resetWorldToStart(this.world);
		if (replacesSystem) {
			this.rebuildSystem();
			// **And the state held *about* that system.** Round 3 rebuilt the
			// meshes and stopped there; `clearSystemScopedState` did not exist
			// until round 4, and round 5 caught that the reset never gained it.
			// Station ids are per-system and reused, so a reset after docking in
			// a jumped-to system would hand the start system that system's
			// cached interior and its live docking state under the same id.
			this.clearSystemScopedState();
			// `render` can follow this reset before another simulation step. Replace
			// the departed system's traffic now so that frame cannot draw stale routes;
			// this seeds only parked traffic and leaves full authority to normal warm-up.
			this.ensureTrafficActors();
		}
		this.clearFlightSession();
		// A reset is a boot, and a boot has a whole ship. Here and not in
		// `clearFlightSession`, which a jump shares: a jump repairs nothing.
		this.condition = playerFullCondition();

		// **#241's gate goes back to shut, which is where a boot in open space
		// finds it.** Left open, a reset would draw both passes for the whole
		// close window — thirty frames of a doubled frame at the arrival point,
		// where they darken 0.002% of it. `applyOcclusion` writes the two flags
		// straight away rather than waiting for the next `render`, so a probe
		// that resets and reads them back sees the reset state.
		this.occlusionGate = CLOSED_GATE;
		this.applyOcclusion();

		// A boot has no jump charging, so a reset has none either.
		// `resetWorldToStart` rebuilds the start system when the ship is
		// elsewhere, so this method is total after a jump too — it was not, for
		// one review round, and the throw reached this published handle (#187).
		this.jumpCharge = idleCharge();
		this.jumpNotice = "";
		this.chargeAu = CHARGE_CAPACITY_AU;
		// Selection is not written by the flight path, so the coverage scan does
		// not ask for it, and it is not spelled here either — the constructor and
		// this method call the same `selectBootTarget`. Two copies is how the
		// first version came to set `null`, a state no boot produces, and stay
		// green for five runs.
		this.selectBootTarget();

		// **Attitude, and it is not one of the assignments above.** `step` turns the
		// ship with `this.orientation.multiply(turn)` — an in-place mutation of a
		// `readonly` field, so a scan looking for `this.x =` cannot see it, and
		// the first version of this method restored position and velocity while
		// leaving the nose pointing wherever the last leg finished. A boot calls
		// `faceTheStar`, so this does. The coverage test now reads in-place
		// mutation as its own class for exactly this reason.
		this.faceTheStar();
		this.keys.clear();
		this.navEtaCache.clear();
		this.navOrder = [];

		this.massesCache = null;
		this.massesAt = Number.NaN;
		this.etaCache = null;
		this.etaAt = Number.NEGATIVE_INFINITY;
		this.navEtaAt = Number.NEGATIVE_INFINITY;
		this.selectableCache = null;
	}

	// ---- §8's jump (#187) ---------------------------------------------------

	/** The hyperspace tank, light years — the commander's, and on the handle so
	 *  a probe reads the game's number rather than its own. */
	get fuelLy(): number {
		return this.commander.fuelLy;
	}

	/**
	 * And writable, for the same reason `chargeAu` is.
	 *
	 * §8.3's course row reddens on exactly the condition `planJump` refuses
	 * (#117 D3), and the browser tier has to *reach* that condition to check
	 * that the refusal paints rather than merely that a record says so. The
	 * alternative is a probe reaching through the handle into `commander`,
	 * which is a second path to one quantity and the thing every accessor on
	 * this handle exists to prevent.
	 */
	set fuelLy(ly: number) {
		this.commander.fuelLy = ly;
	}

	/** The tank's capacity, likewise. */
	readonly fuelCapacityLy = JUMP_TANK_LY;

	/**
	 * The commander's balance, credits — likewise on the handle so a probe reads
	 * the game's number rather than its own.
	 *
	 * Here because a station action is otherwise invisible from outside: #283's
	 * panel probe has to show that Cross on a BUY row *bought something*, and
	 * "a row was focused" is not that.
	 */
	get creditsCr(): number {
		return this.commander.credits;
	}

	/**
	 * Commit to a destination, or clear one — the chart's "set course" button,
	 * arriving through `onCourse`.
	 *
	 * Held here rather than in the chart so it survives the tab being closed;
	 * see the `course` field.
	 */
	setCourseTo(course: Course | null) {
		this.course = course;
		this.jumpNotice = "";
	}

	/**
	 * Commit to a destination by system index, through `setCourse`.
	 *
	 * On the handle so the browser tier drives the **shipped** commit — the same
	 * function the chart's "set course" button calls — rather than assembling a
	 * `Course` literal beside its own copy of `COURSE_SCHEMA_VERSION`. A probe
	 * with its own copy of a constant goes falsely red the day the module
	 * changes it, and a probe with its own copy of a *commit* is not checking
	 * the commit at all.
	 *
	 * **It is a second path to the commit, deliberately.** The chart's own
	 * `commitCourse` is a longer sequence — select, `setCourse`, hold, `onCourse`,
	 * recompute the legend and the card — and this skips all of it but the
	 * `setCourse`, because the chart need not be mounted for a course to exist
	 * (#187: the course is the game's, not the chart's). What the probe drives
	 * through this is the commit and the state, never the chart's button; the
	 * button is `probe-galaxy-map`'s.
	 *
	 * Returns whether a course was set: `setCourse` refuses a destination
	 * `planRoute` cannot reach.
	 */
	commitCourseTo(index: number): boolean {
		const here = this.world.system.record;
		const to = this.world.galaxy.systems.find(
			(s) => s.galaxy === here.galaxy && s.index === index,
		);
		if (to === undefined) return false;
		const course = setCourse(this.world.galaxy.systems, here, to);
		// **Both refusals leave any standing course alone.** An unknown index
		// returned early above while an unroutable destination fell through to
		// `setCourseTo(null)` — two refusals of one call, returning the same
		// `false` with opposite side effects.
		if (course === null) return false;
		this.setCourseTo(course);
		return true;
	}

	/**
	 * The next system on the set course, or `null`.
	 *
	 * **Never remembered as a cursor**: an off-plan jump re-plans instead of
	 * desyncing, which is `galaxy-route.ts`'s own rule and the reason a `Course`
	 * is a destination and not a chain. Re-derived whenever the course or the
	 * ship's system changes — this said "every time it is asked" while the body
	 * had been routed through `courseChain`'s cache.
	 */
	nextHop(): SystemRecord | null {
		// **Through the same cache the course row reads.** This ran
		// `courseProgress` — a 256-node Dijkstra with four typed-array
		// allocations — on every call, and `cruisePrompt` calls it from the
		// per-frame overlay draw. So the chain cache added for the row bought
		// the frame nothing while the identical search ran twenty lines away,
		// and the cache's own comment claimed the per-frame search was gone.
		const cue = this.courseChain();
		return cue?.nextHop ?? null;
	}

	/** `planJump` against this ship and this tank — the first and third
	 *  arguments are always these two fields, and four sites spelled them. */
	private jumpDecision(to: SystemRecord) {
		return planJump(this.world.system.record, to, this.commander.fuelLy);
	}

	/**
	 * Start §8's wind-up towards the next hop, or say why not.
	 *
	 * ## Why it refuses in the states it does
	 *
	 * The wind-up is the mechanic: you commit, you are vulnerable, and something
	 * has a few seconds to stop you. That only means anything in normal flight,
	 * so a jump is refused inside cruise, inside cruise's own spool, and while
	 * docked — one commitment at a time. Docked is the sharpest of the three:
	 * flight is suspended (#73's E5) and the ship is parked inside a station, so
	 * a jump from there would take the station's berth reservation with it.
	 *
	 * Every refusal writes `jumpNotice` rather than failing silently, because a
	 * key that sometimes does nothing is indistinguishable from a key that is
	 * not bound.
	 */
	chargeJump(): boolean {
		// **Before the clear, not after it.** The window's own notice is what
		// `cruisePrompt` prints while charging, so returning through the clear
		// blanked the line for the rest of the window — and the claim below that
		// every refusal writes a notice was false for exactly this arm.
		if (charging(this.jumpCharge)) return false;
		this.jumpNotice = "";
		if (this.dock.phase !== "flying") {
			this.jumpNotice = "cannot jump from a station";
			return false;
		}
		if (this.regime === "cruise" || this.spoolLeftS > 0) {
			this.jumpNotice = "drop out of cruise first";
			return false;
		}
		const to = this.nextHop();
		if (!to) {
			this.jumpNotice = this.course
				? "course complete — set another on the galaxy chart"
				: "no course set — pick one on the galaxy chart";
			return false;
		}
		const decision = this.jumpDecision(to);
		if (!decision.ok) {
			this.jumpNotice = jumpRefusalText(decision.refusal, to.name);
			return false;
		}
		this.jumpCharge = beginCharge(to.index);
		this.jumpNotice = `jumping to ${to.name}`;
		return true;
	}

	/**
	 * The one way the player ship takes damage (#324).
	 *
	 * Damage cancels two windows, and a source that wrote the condition itself
	 * would have to remember both: §8's jump charge (`cancelJumpCharge`) and
	 * `in-system-travel.md` §4's cruise spool-up, which before #324 only the
	 * player's own key could cancel. The failed dock calls this today; weapon fire
	 * will.
	 */
	takeDamage(amount: number, side: ShieldSide, reason: string) {
		if (!(amount > 0)) return;
		this.condition = applyDamage(this.condition, amount, side);
		// The one place damage lands is the one place a death is noticed.
		if (!isAlive(this.condition) && !this.dead) {
			this.dead = true;
			this.clockHeld = true;
			this.lastExit = "ship destroyed";
			void this.onDeath?.();
		}
		this.cancelJumpCharge(reason);
		this.cancelSpoolUp(reason);
	}

	/**
	 * `in-system-travel.md` §4's cruise spool-up, cancelled — by the player's
	 * key (no reason) or by damage. One method for both, for the reason
	 * `cancelJumpCharge` is one.
	 */
	cancelSpoolUp(reason?: string) {
		if (this.spoolLeftS <= 0) return;
		this.spoolLeftS = 0;
		this.detour = null;
		this.lastExit = reason
			? `spool-up cancelled — ${reason}`
			: "spool-up cancelled";
	}

	/**
	 * The pilot's trigger: Space or the left mouse button, in flight. Off while
	 * the `?combat=1` rig runs, which reads the same inputs for its own gun.
	 */
	private triggerHeld(): boolean {
		return (
			!this.combatRig &&
			flightLive(this.dock.phase) &&
			(this.keys.has(" ") ||
				this.mouseFiring ||
				padFireHeld(this.padFrame, this.padContext()))
		);
	}

	/**
	 * One frame of the leg's raider encounter (#324): step it, then do the
	 * three things only `Game` can — drop the player out of cruise, land the
	 * raider's fire through `takeDamage`, and say how it ended.
	 */
	private stepRaider(dt: number, shot: PlayerShot) {
		const encounter = this.encounter;
		if (!encounter) return;
		const { name } = encounter;
		const step = stepEncounter(encounter, {
			gameTime: this.world.gameTime,
			dt,
			inCruise: this.regime === "cruise",
			pilot: {
				ship: this.world.ship,
				nose: this.nose(),
				aimOrigin: this.cameraPos(),
				// The gimballed beam, not the boresight (#324).
				aimNose: this.beamAim(),
				hull: this.condition.hull,
				// The raider's assist holds speed in the player's frame (#324).
				frameVel: this.localFrame(),
			},
			shot,
		});
		this.encounter = step.encounter;
		this.encounterView = step.contact;
		this.raiderFiring = step.raiderHit !== null;
		if (step.raiderHit) this.struckFor = STRUCK_FLASH_S;
		if (step.drop) this.dropOut(`interdicted by ${name}`);
		if (step.raiderHit)
			this.takeDamage(
				step.raiderHit.amount,
				step.raiderHit.side,
				`fired on by ${name}`,
			);
		if (step.encounter.phase === "over") {
			// #324 part d: a kill is the slot's world-state destruction, which
			// schedules its replacement, and the wreck drops its cargo.
			if (step.encounter.end === "destroyed" && step.wreck) {
				const record = this.world.system.record;
				const now = this.world.gameTime;
				this.applyCarrierTransition(
					encounter.slot.key,
					raiderDestruction(record.index, now),
				);
				this.canisters = [
					...this.canisters,
					...dropCanisters({
						systemSeed: record.seed,
						government: record.government,
						key: encounter.slot.key,
						killedAt: now,
						pos: step.wreck.pos,
						vel: step.wreck.vel,
						frameVel: this.localFrame(),
						// The body the kill happened beside owns the frame these rest
						// in, so they keep station with it after the player leaves.
						frameBodyId: this.frameBody?.id ?? null,
					}),
				];
				this.audio.explosion();
			}
			const notice = step.encounter.end
				? ENCOUNTER_END_NOTICE[step.encounter.end]
				: null;
			if (notice) this.lastExit = notice(name);
			this.encounter = null;
			// A raider that fired on its last step would otherwise leave the cue
			// red until the next encounter's first step.
			this.raiderFiring = false;
		}
	}

	/**
	 * Whether a raider slot can field a raider now (#324 part d): operational
	 * in world state at this game time. A destroyed or repairing slot is no
	 * route threat.
	 */
	private readonly slotOperational = (key: CarrierKey): boolean =>
		this.carrierCondition(key).condition === "operational";

	/**
	 * Drift the canisters, expire the old ones, and scoop any the ship passes
	 * close and slow (#324 part d). A full hold leaves the canister in space.
	 */
	private stepCargoCanisters(dt: number) {
		if (this.canisters.length === 0) return;
		// `stepCanisters` owns the order (scoop, then drift); this owns the hold.
		const step = stepCanisters(
			this.canisters,
			this.world.ship,
			dt,
			this.world.gameTime,
			(canister) => {
				const took = scoopCargo(
					this.commander,
					canister.commodity,
					canister.tonnes,
				);
				if (took.accepted) this.commander = took.commander;
				return took.tonnes;
			},
			// Each canister's own frame, as it stands (#324). Not `localFrame()`:
			// that is the *observer's* nearest body, so a pilot who flies past
			// `NEAR_FAR_KM` would drop every canister at the station to star rest
			// and lose them inside their five minutes (sage #355).
			(canister) =>
				canister.frameBodyId
					? bodyVelocity(
							this.world.system,
							canister.frameBodyId,
							this.world.gameTime,
						)
					: v3(),
		);
		this.canisters = step.kept;
		// A refused notice stands while the ship is beside the canister, and a
		// later notice replaces it as usual.
		for (const { canister, accepted, tonnes } of step.scoops) {
			// A refusal reports the canister's tonnes; a take what it took and,
			// when the hold could not take it all, what is left (H11).
			const event = {
				canisterId: canister.id,
				commodity: canister.commodity,
				tonnes: accepted ? tonnes : canister.tonnes,
				accepted,
				leftT: accepted ? canister.tonnes - tonnes : undefined,
			};
			// The exit line and the glass: the canister disappearing is what
			// expiring and flying past also look like, so the event needs to say
			// which of the three it was. `nextScoopNotice` owns when a notice
			// stands, re-arms or sounds.
			const next = nextScoopNotice(this.scoop, event);
			if (next.notice !== this.scoop) this.lastExit = scoopExit(event);
			this.scoop = next.notice;
			if (next.sound === "scoop") this.audio.scoop();
			else if (next.sound === "alert") this.audio.alert();
		}
		if (step.scoops.some((s) => s.accepted)) this.saveDirty();
	}

	/**
	 * Give every live canister a selectable contact, and take it back when the
	 * canister is scooped or expires (#324, the principal's ruling after the
	 * fifth playtest — "targetable, keep 5 min"). A canister was a green diamond
	 * with a range label and nothing else: it could not be selected, so the
	 * approach had no range or closing readout to fly by, and the lifetime was
	 * never the complaint.
	 *
	 * Stepped every frame rather than beside the drop, and deliberately **not**
	 * inside `stepCargoCanisters`, which returns early on an empty list — an
	 * empty list is exactly when the last contact has to go.
	 */
	private syncCargoContacts() {
		for (const canister of this.canisters) {
			const known = this.cargoContacts.get(canister.id);
			if (known) {
				// `driftCanister` returns a new canister each step, so these are
				// assignments and not a mutation of a shared vector.
				known.pos = canister.pos;
				known.velocity = canister.vel;
				continue;
			}
			const contact: DisplayContact = {
				id: canister.id,
				name: canister.commodity.toUpperCase(),
				kind: "cargo",
				pos: canister.pos,
				velocity: canister.vel,
				radiusKm: CANISTER_RADIUS_KM,
				color: CARGO_CONTACT_COLOUR,
				standing: null,
				scannerClass: "unknown",
			};
			this.cargoContacts.set(canister.id, contact);
			this.registerContact(contact);
			this.selectableCache = null;
		}
		if (this.cargoContacts.size === this.canisters.length) return;
		const live = new Set(this.canisters.map((canister) => canister.id));
		for (const [id, contact] of this.cargoContacts) {
			if (live.has(id)) continue;
			this.unregisterContact(contact);
			this.cargoContacts.delete(id);
			this.selectableCache = null;
			// A lock on a canister that no longer exists would resolve through
			// `bodyFor` to nothing and leave the panel naming a gap.
			if (this.targetId === id) this.targetId = null;
		}
	}

	/** Draw the leg's encounter, if the leg has none running. */
	private scheduleLegEncounter() {
		if (this.combatRig || RAIDERS_OFF) return;
		if (this.encounter && this.encounter.phase !== "over") return;
		const record = this.world.system.record;
		const now = this.world.gameTime;
		const leg = Math.floor(now);
		// #43: the relay's dial on this leg — `law` unless the leg's target is the
		// station the relay watches.
		const detection = this.relayDetectionNow();
		this.encounter =
			scheduleEncounter(
				this.slotOperational,
				record.index,
				record,
				leg,
				now,
				detection,
			) ??
			(RAIDER_PLAYTEST
				? forceEncounter(
						this.slotOperational,
						record.index,
						record.government,
						PLAYTEST_BEARINGS[leg % PLAYTEST_BEARINGS.length],
						now + 5,
						30,
					)
				: null);
	}

	/**
	 * A raider on demand, `inS` seconds from now — for a probe, or for a pilot
	 * at the console (`__seelite.forceRaider("ahead")`). The player must be in
	 * cruise from now until it appears: leaving cruise first ends it as missed.
	 */
	forceRaider(bearing: EncounterBearing = "behind", inS = 1, rangeKm = 30) {
		const record = this.world.system.record;
		this.encounter = forceEncounter(
			this.slotOperational,
			record.index,
			record.government,
			bearing,
			this.world.gameTime + inS,
			rangeKm,
		);
	}

	/** Place the raider's hull and contact, or take them away. */
	private updateEncounterPresentation(cameraPos: Vec3) {
		const view = this.encounterView;
		const contact = this.raiderContact;
		if (!view) {
			if (this.raiderListed) {
				this.unregisterContact(contact);
				this.raiderListed = false;
				this.selectableCache = null;
				// A target that is no longer in the world would throw in
				// `velocityOf` on the next cruise frame.
				if (this.targetId === contact.id) this.targetId = null;
			}
			this.raiderMesh.removeFromParent();
			return;
		}
		contact.id = view.key;
		contact.name = view.name;
		contact.pos.x = view.pos.x;
		contact.pos.y = view.pos.y;
		contact.pos.z = view.pos.z;
		contact.velocity.x = view.vel.x;
		contact.velocity.y = view.vel.y;
		contact.velocity.z = view.vel.z;
		if (!this.raiderListed) {
			this.registerContact(contact);
			this.raiderListed = true;
			this.selectableCache = null;
		}
		if (!this.raiderMesh.parent) this.nearScene.add(this.raiderMesh);
		this.raiderMesh.position.set(
			view.pos.x - cameraPos.x,
			view.pos.y - cameraPos.y,
			view.pos.z - cameraPos.z,
		);
		this.trafficQuaternion(view, this.raiderMesh.quaternion);
	}

	/** #43: the relay's plan for the system the ship is in, cached by system. */
	private currentRelayPlan(): RelayPlan | null {
		const { record, contents } = this.world.system;
		if (this.relayPlanSystem !== record.index) {
			this.relayPlanSystem = record.index;
			this.relayPlanCache = relayPlan(contents, record.seed);
		}
		return this.relayPlanCache;
	}

	/**
	 * #43: read the relay this frame, identify it inside its range, and land
	 * the player's shot on it.
	 *
	 * Identification is a knowledge write through `observe`, so the row rides
	 * the save the way a docking report does. The shot is the beam test the
	 * duel uses (`playerLaserHit`) against the relay's own hull sphere, from
	 * the gimballed aim the duel fires along. The kill is the slot's `destroy`
	 * through `applyCarrierTransition`, the one writer every carrier
	 * transition in the game goes through.
	 */
	private stepRelay(shot: PlayerShot) {
		const plan = RELAY_PROTOTYPE ? this.currentRelayPlan() : null;
		if (!plan) {
			this.relayView = null;
			return;
		}
		const { record, contents } = this.world.system;
		const now = this.world.gameTime;
		const key = relaySlot(record.index).key;
		const pos = relayPosition(plan, contents, now);
		const vel = relayVelocity(plan, contents, now);
		const signal = relaySignal(this.world.ship.pos, pos);
		let identified =
			readKnowledge(this.commerceWorld.galaxies[record.galaxy], key) !==
			undefined;
		if (!identified && signal && signal.km <= RELAY_IDENTIFY_RANGE_KM) {
			this.commerceWorld = observe(
				this.commerceWorld,
				record.galaxy,
				key,
				now,
				"identification",
			);
			this.saveDirty();
			identified = true;
			this.lastExit = "pirate relay identified";
		}
		const carrier = this.carrierCondition(key);
		if (carrier.instanceOrdinal !== this.relayHullInstance) {
			this.relayHullInstance = carrier.instanceOrdinal;
			this.relayHull = RELAY_INTEGRITY;
		}
		if (
			carrier.condition === "operational" &&
			shot.fired &&
			shot.damage > 0 &&
			relayInSights(this.cameraPos(), this.beamAim(), pos)
		) {
			this.relayHull = Math.max(0, this.relayHull - shot.damage);
			if (this.relayHull === 0) {
				this.applyCarrierTransition(
					key,
					relayDestruction(record.index, now, plan.watchedStationId),
				);
				this.audio.explosion();
				this.lastExit = "pirate relay destroyed";
			}
		}
		this.relayView = {
			key,
			pos,
			vel,
			condition: this.carrierCondition(key).condition,
			identified,
			signal,
			watched:
				this.world.system.byId.get(plan.watchedStationId)?.name ??
				plan.watchedStationId,
		};
	}

	/** #43: what the glass shows of the relay, or null with nothing to show. */
	private relayCue(): RelayCue | null {
		const v = this.relayView;
		// Inside the signal's range only, identified or not: an identified relay a
		// system away is the Navigation list's to find, not a cue to carry.
		if (!v?.signal) return null;
		// At the clock as it stands, for `relayNow`'s reason: the cue is what
		// the pilot steers by, and read from the frame start it put the relay
		// 0.9 km off at 4.9 km in one capture.
		const { pos } = this.relayNow(v);
		const dir = directionTo(this.world.ship.pos, pos);
		const offNoseDeg = dir
			? (angleOffNose(dir, this.nose()) * 180) / Math.PI
			: 0;
		return {
			phase: !v.identified
				? "signal"
				: v.condition === "operational"
					? "identified"
					: "down",
			strength: v.signal?.strength ?? 0,
			offNoseDeg,
			arrowDeg: targetArrowBearingDeg(
				this.world.ship.pos,
				pos,
				this.orientation,
			),
			watched: v.watched,
			km: v.identified ? length(sub(pos, this.world.ship.pos)) : null,
			condition: v.condition,
		};
	}

	/** #43: place the relay's mesh and contact, or take them away. The contact
	 *  is listed only once identified; the mesh is drawn whenever the relay is
	 *  read, because it is a physical thing whether or not it has been found. */
	private updateRelayPresentation(cameraPos: Vec3) {
		const v = this.relayView;
		const contact = this.relayContact;
		const delist = () => {
			if (!this.relayListed) return;
			this.unregisterContact(contact);
			this.relayListed = false;
			this.selectableCache = null;
			if (this.targetId === contact.id) this.targetId = null;
		};
		if (!v) {
			delist();
			this.relayMesh.root.removeFromParent();
			return;
		}
		if (!v.identified || contact.id !== v.key) delist();
		// **At the clock as it stands now, not at the frame's start.** The step
		// read the relay before the flight advanced the ship, and a relay on a
		// station's orbit moves tens of kilometres a second — so a contact and
		// a mesh placed from that reading sit kilometres behind the relay
		// beside a ship that has moved on. Bodies are placed the same way, from
		// the clock, by `advanceSystem`.
		const { pos, vel } = this.relayNow(v);
		contact.id = v.key;
		contact.pos.x = pos.x;
		contact.pos.y = pos.y;
		contact.pos.z = pos.z;
		contact.velocity.x = vel.x;
		contact.velocity.y = vel.y;
		contact.velocity.z = vel.z;
		if (v.identified && !this.relayListed) {
			this.registerContact(contact);
			this.relayListed = true;
			this.selectableCache = null;
		}
		const root = this.relayMesh.root;
		if (!root.parent) this.nearScene.add(root);
		if (root.userData.condition !== v.condition)
			this.relayMesh.setCondition(v.condition);
		root.position.set(
			pos.x - cameraPos.x,
			pos.y - cameraPos.y,
			pos.z - cameraPos.z,
		);
	}

	/** The relay where the clock stands now, or the frame-start reading when
	 *  the plan is gone (a jump between the step and the render). */
	private relayNow(v: RelayView): { pos: Vec3; vel: Vec3 } {
		const plan = this.currentRelayPlan();
		if (!plan) return { pos: v.pos, vel: v.vel };
		const { contents } = this.world.system;
		const now = this.world.gameTime;
		return {
			pos: relayPosition(plan, contents, now),
			vel: relayVelocity(plan, contents, now),
		};
	}

	/** #43: the relay as a probe reads it. */
	relayReadout() {
		const plan = this.currentRelayPlan();
		const record = this.world.system.record;
		return {
			enabled: RELAY_PROTOTYPE,
			plan,
			// The relay where the clock stands, for the same reason the
			// presentation reads it there: a probe aiming at the frame-start
			// reading aims kilometres behind it.
			view: this.relayView && {
				...this.relayView,
				...this.relayNow(this.relayView),
			},
			hull: this.relayHull,
			listed: this.relayListed,
			detection: this.relayDetectionNow(),
		};
	}

	/** #43: the relay's dial on a leg to the selected target, as it stands.
	 *  One expression, read by the scheduler and by the probe readout. */
	private relayDetectionNow(): RouteDetection {
		if (!RELAY_PROTOTYPE) return "law";
		const record = this.world.system.record;
		return relayDetection(
			this.currentRelayPlan(),
			this.targetId,
			this.slotOperational(relaySlot(record.index).key),
		);
	}

	/**
	 * §8's interruption: **taking damage cancels the charge.**
	 *
	 * Called from `takeDamage`, so anything that damages the ship inherits the
	 * rule by going through that instead of remembering this. Also called on a
	 * dock, which is not damage.
	 */
	cancelJumpCharge(reason: string) {
		// **The pending jump too, and that is the half the blocker turned on.**
		// A charge that has fired is already idle, so a `charging` guard alone
		// would let damage on the terminal frame report a cancellation and the
		// jump happen anyway.
		if (!charging(this.jumpCharge) && this.pendingJump === null) return;
		this.jumpCharge = cancelCharge();
		this.pendingJump = null;
		this.jumpNotice = `jump cancelled — ${reason}`;
	}

	/**
	 * One frame of the wind-up, and the jump at the end of it.
	 *
	 * Runs before the flight step for the reason cruise's spool does not: the
	 * jump replaces the world the rest of the step would read. Doing it after
	 * would step the old system, tear it down and throw the result away — which
	 * is not wrong so much as a frame of work spent on a system nobody is in.
	 */
	private stepJumpCharge(dt: number) {
		const step = stepCharge(this.jumpCharge, dt);
		this.jumpCharge = step.charge;
		if (step.fired === null) return;
		// **Armed, not taken.** See `pendingJump`.
		this.pendingJump = step.fired;
	}

	/**
	 * The jump the wind-up armed, taken at the end of the frame it armed on.
	 *
	 * **This is sage round 3's blocker, and it was a real contradiction.** §8
	 * sells the wind-up on the ship being *vulnerable* through it and on damage
	 * cancelling the charge — but the first build fired inside `stepJumpCharge`,
	 * advanced the clock by hand and returned before `stepWorld` and
	 * `stepDocking` ran. So on the one frame that decides the jump, no flight,
	 * no damage and no dock check happened, and a failed entry on exactly that
	 * frame could not cancel anything. Round 2 made the *comment* honest about
	 * that ("a clocked frame, not a flown one"), which documented the defect
	 * instead of fixing it.
	 *
	 * Now the terminal frame is flown like any other: the charge arms this, the
	 * rest of the step runs normally — advancing the clock once, through
	 * `stepWorld`, rather than twice — and the jump is taken afterwards if it
	 * survived. `cancelJumpCharge` clears it, so a clip on the last frame stops
	 * the jump, which is what §8 says happens.
	 */
	private takePendingJump() {
		const index = this.pendingJump;
		if (index === null) return;
		this.pendingJump = null;
		const to = this.world.galaxy.systems.find((s) => s.index === index);
		// A destination that is not in this galaxy's records is a bug in whoever
		// began the charge, not a move to absorb quietly.
		if (!to) throw new Error(`jump fired at unknown system ${index}`);
		this.performJump(to);
		// **The frame this fires on is flown, and that is round 3's fix.** The
		// first build advanced the clock here by hand and jumped, returning
		// before `stepWorld` and `stepDocking` ran — so the one frame that
		// decides the jump had no flight, no damage and no dock check, and §8's
		// "damage cancels the charge" could not fire on it. Round 2 rewrote this
		// comment to describe that honestly, which documented the defect instead
		// of removing it; round 4 caught the description still standing after
		// round 3 removed the behaviour.
		//
		// Nothing is advanced here now. The charge is stepped, a jump is armed,
		// and the rest of the step runs normally — one clock advance, through
		// `stepWorld`, like any other frame.
	}

	/**
	 * Take the jump: spend the tank, move the world, rebuild the renderer.
	 *
	 * ## What the fuel spend is, and what it is not
	 *
	 * The tank pays the distance, and `planJump` is asked again here rather than
	 * the plan being carried through the wind-up. That is deliberate: the ship
	 * can lose fuel during the window in a later build (a scoop failure, #8's
	 * damage model), and a plan priced three seconds ago would let it jump on
	 * fuel it no longer has. A refusal at this point cancels rather than
	 * half-jumping.
	 *
	 * ## What is rebuilt, and why the list is not shorter
	 *
	 * Everything the renderer holds that is keyed on *this* system. The
	 * `interiors` berth catalogue's own comment named this build ("a build that
	 * adds a jump owes it a clear"); the docking protocol's grants are per
	 * station and a grant at a station that is now light years away is a
	 * reservation nobody can honour; the caches are stamped with a clock and a
	 * body set that have both moved. `selectableCache`'s comment says it is a
	 * field rather than a `readonly` precisely because a system change would
	 * invalidate it, "which nothing does yet".
	 */
	private performJump(to: SystemRecord) {
		const decision = planJump(
			this.world.system.record,
			to,
			this.commander.fuelLy,
		);
		if (!decision.ok) {
			this.jumpNotice = `jump aborted — ${decision.refusal}`;
			return;
		}
		this.commander = {
			...this.commander,
			fuelLy: decision.plan.fuelLeftLy,
		};

		jumpWorldTo(this.world, to);
		this.rebuildSystem();

		// §7's visited flag, per galaxy (`persistent-world-state.md` §7). The
		// start system is recorded at boot; this is every system after it.
		this.commerceWorld = visit(this.commerceWorld, to.galaxy, to.index);
		this.observeCurrentSystemRelay();

		// The flight session, reset to what arriving in a system is: at rest, in
		// normal flight, pointed at the new star, with nothing left of the leg
		// that ended in another system. The drive charge is deliberately **not**
		// refilled — §7 refills it on docking, and a jump is not a dock.
		this.clearFlightSession();
		this.clearSystemScopedState();
		// A jump is taken at the end of a step and `render` follows immediately.
		// Do the bounded system hand-off now: clear the departed routes and seed the
		// destination's parked ships without running full traffic projection here.
		this.ensureTrafficActors();
		this.updateLocalFrameBody();
		this.selectBootTarget();
		this.faceTheStar();
		this.refreshScannerContacts();
		// The chart, if the Navigation tab is open. `jumpTo` is the chart's own
		// "the ship moved" entry point, so the course re-derives from the new
		// origin instead of the chart drawing a route from a system the ship has
		// left.
		this.chart?.handle.jumpTo(to.index);
		this.jumpNotice = `arrived at ${to.name}`;
		// D4's jump flush, **after the arrival is finished and not before it**.
		// It ran beside `visit`, above `clearFlightSession` and `faceTheStar`,
		// so the record carried the departure system's regime, throttle and
		// attitude beside the new arrival position — and the flush cleared the
		// dirty flag, so nothing below re-armed a write. A restore from that
		// record resumed at the new arrival point under the old throttle,
		// pointed away from the star. Same class as the dock flush this branch
		// already moved, and found the same way.
		this.saveDirty();
		this.saveFlush("jump");
	}

	/** The System relay is an arrival channel, never a map-opening side effect. */
	private observeCurrentSystemRelay(): void {
		const { record, contents } = this.world.system;
		this.commerceWorld = observeSystemRelay(
			this.commerceWorld,
			record.galaxy,
			contents.stations.map((station) =>
				carrierKey(record.index, station.localCarrierId),
			),
			this.world.gameTime,
		);
		this.saveDirty();
	}

	/**
	 * Tear the old system's drawn objects down and build the new one's (#187).
	 *
	 * **The order is teardown, then build**, and it matters for one reason that
	 * is not obvious: `buildBodies` writes into the same three maps this clears,
	 * so building first would overwrite the handles the teardown needs to reach.
	 *
	 * `buildLights` is *not* called again — see its docstring. `buildEnvironment`
	 * is, because the bake is the star's own colour and this is a different
	 * star; it disposes what it replaces, which its own comment says it does
	 * "rather than assuming it is the first call". That day has arrived.
	 *
	 * What frees what is `gpu-teardown.ts`'s business, and the two failures it
	 * can have are `tests/gpu-teardown.test.ts`'s.
	 */
	private rebuildSystem() {
		for (const mesh of this.meshes.values()) mesh.removeFromParent();
		for (const visual of this.bodyVisuals.values()) visual.dispose();
		for (const station of this.stationVisuals.values()) station.dispose();
		this.meshes.clear();
		this.bodyVisuals.clear();
		this.stationVisuals.clear();
		this.layers.clear();
		// #208's schedule is keyed on body ids, and the next system's bodies get
		// the same ones (`planet-1`, `moon-2-1`). A queue entry that survived
		// would step the *new* body's bake at the wrong moment, and a stale
		// `bakeFacePx` would tell `setLayer` the new body already has the cube the
		// old one had. `visual.dispose()` above has already freed both cubes.
		this.bakeFacePx.clear();
		this.bakeQueue.length = 0;
		this.widestBodyId = undefined;
		this.widestRadiusPx = 0;
		this.starBody = undefined;

		// #201's per-station walk runs again inside `buildBodies`, so the record
		// of what it marked has to drop the system being left or it grows by a
		// station per jump — and a probe reading the last entry would be reading
		// a station that is no longer in the scene.
		for (let i = this.markedOcclusion.length - 1; i >= 0; i--)
			if (this.markedOcclusion[i][0].startsWith("station-"))
				this.markedOcclusion.splice(i, 1);

		this.buildBodies();
		this.buildEnvironment();
		// #207's programs for the new system's classes, now that its bodies exist.
		// The composer is long up on this path, so the target below is the one the
		// game renders into.
		this.prewarmReliefPrograms();

		// The scanner's buffer is one entry per body, filled in place every frame
		// so the projection allocates nothing. A system with more bodies than the
		// last would silently drop the surplus, and one with fewer would leave
		// stale contacts on the scanner.
		const bodies = this.world.system.bodies.length;
		while (this.scannerContactBuffer.length < bodies)
			this.scannerContactBuffer.push({} as ScannerContact);
		this.scannerContactBuffer.length = bodies;
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
		// One commitment at a time (#187). §8's window is a gamble the player has
		// taken; letting cruise start inside it would let them take it back.
		if (charging(this.jumpCharge)) {
			this.lastExit = "jump charging";
			return;
		}
		if (this.chargeAu <= 0) {
			this.lastExit = "no drive charge";
			return;
		}
		this.detour = null;
		// **Cruise breaks the charge, it does not pause it.** A scan is attention
		// paid to a ship in front of the canopy; five seconds of it cannot include
		// a jump leg, and the nose is nowhere during one.
		this.scanHold = beginScanHold();
		const target = this.targetBody();
		const targetParentId = this.targetParentId();
		if (target && targetParentId) {
			const begun = beginCruiseGuidance({
				from: this.world.ship.pos,
				target,
				masses: this.masses(),
				targetParentId,
			});
			if (begun.error) {
				const id = begun.error.blockerId;
				this.lastExit = `detour unavailable: ${this.bodyFor(id)?.name ?? id}`;
				return;
			}
			this.detour = begun.guidance;
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
	 * `matchBodyId` is what separates them. An arrival uses the selected body's
	 * frame; a proximity stop uses the blocker and stops at zero relative speed.
	 * A manual or charge exit passes no body and remains in the star frame.
	 */
	dropOut(
		reason: string,
		matchBodyId: string | null = null,
		stopInBodyFrame = false,
	) {
		if (this.regime !== "cruise") {
			this.spoolLeftS = 0;
			return;
		}
		// In the target's frame (`cruise.ts`'s `exitVelocity`): a station on a
		// 1 AU orbit moves at ~30 km/s, so an absolute clamp to the 2 km/s assist
		// cap would drop the player next to a target already leaving at fifteen
		// times the speed normal flight can manage.
		const frameVelocity = matchBodyId ? this.velocityOf(matchBodyId) : v3();
		this.world.ship.vel = stopInBodyFrame
			? frameVelocity
			: exitVelocity(this.nose(), this.cruiseSpeedKms, frameVelocity);
		this.proximityFrameBodyId = stopInBodyFrame ? matchBodyId : null;
		if (this.proximityFrameBodyId)
			this.frameBody =
				this.world.system.byId.get(this.proximityFrameBodyId) ?? null;
		this.regime = "normal";
		// The other end of the leg — see the note beside the engage.
		this.saveDirty();
		this.detour = null;
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
		this.updateTrafficAuthority();
		// Before the phase branch, so a hold is retried while docked and ended in
		// every other phase (#314).
		this.stepHeldLaunch();
		// Every phase, docked included: energy regenerates and shields recharge
		// on the sim clock wherever the ship is. The trigger is the pilot's
		// (`triggerHeld`), and what the gun delivered is this frame's shot.
		const gun = stepCondition(this.condition, dt, this.triggerHeld());
		this.condition = gun.condition;
		const shot: PlayerShot = { fired: gun.fired, damage: gun.damage };
		// What the player sees and hears of the shot. Without these a held
		// trigger drew nothing and played nothing, and read as a dead key.
		const feedback = stepGunFeedback(this.gunFeedback, gun.fired, dt);
		this.gunFeedback = feedback.feedback;
		if (feedback.playSound) this.audio.laser();
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
			// **Drop the pointer delta here too.** The flight tail below is what
			// normally consumes it, and this returns above that — so a mouse
			// moved while docked banked its delta for the whole session and
			// delivered it as a `MOUSE_MAX_STEP` kick on the first frame after
			// launch. Docked at the station console is exactly the case this
			// branch's reversal is about, and the comment there claimed the
			// delta was consumed. Sage found it.
			this.mouseDx = 0;
			this.mouseDy = 0;
			// Same reason as the delta above: `stepScan` runs on the flight tail,
			// so this branch is a way off it. A charge banked before docking would
			// otherwise wait out the whole visit and complete on the first frame
			// back in the seat, with no attention paid in between.
			this.scanHold = beginScanHold();
			this.stepDockPhase(dt);
			return;
		}
		// Combat contacts integrate below, before the player flight step. Cruise
		// needs their position and velocity at the same frame-start instant as the
		// ship and world masses, including the frame on which spool-up completes.
		let contactTargetAtFrameStart: Mass | null = null;
		if (
			this.regime === "cruise" ||
			(this.spoolLeftS > 0 && this.spoolLeftS <= dt)
		) {
			const target = this.targetBody();
			if (target && isDisplayContact(target)) {
				contactTargetAtFrameStart = {
					id: target.id,
					pos: { ...target.pos },
					radiusKm: target.radiusKm,
					vel: { ...target.velocity },
					accelerationBoundKms2: 0,
				};
			}
		}
		// The raider reads the player where the frame starts, as the ship and the
		// world masses are read, and may drop the player out of cruise before the
		// regime branch below chooses how to fly this frame.
		this.struckFor = Math.max(0, this.struckFor - dt);
		this.scoop.left = Math.max(0, this.scoop.left - dt);
		this.stepGunGimbal(dt);
		this.stepRaider(dt, shot);
		this.stepRelay(shot);
		this.stepTrafficEngagements(dt, shot);
		this.stepCargoCanisters(dt);
		this.syncCargoContacts();
		// #48 deliberately couples no combat entity to the world yet: this is a
		// flyable balance rig over the shared flight loop, not production combat.
		this.combatRig?.step(dt, this.keys, this.regime === "cruise", {
			ship: this.world.ship,
			nose: this.nose(),
			mouseFiring: this.mouseFiring,
			// The sightline through the reticle, not the ship's attitude: a player
			// looking off the nose aims where they are looking.
			aimOrigin: this.cameraPos(),
			aimNose: this.weaponAim(),
		});
		// The pad's sticks sit **beside** the key set rather than through it, so
		// the pad's contribution keeps its own magnitude (#283's F1). Nothing
		// clamps the sum here: `stepAngular` clamps the command to [-1, 1]
		// itself, and the keyboard's own 1.41x on a diagonal is left exactly as
		// it was.
		// **The chart's zeroing is back, and deleting it was a blocker.** It
		// exists so a stick orbiting the cluster does not also fly the ship or
		// cancel the docking computer. I removed it claiming the branch could
		// never be taken now that a console returns no axes — and that claim was
		// false: `readPadContext` answers `"instrument"` before it ever tests for
		// a console, the instrument *does* fly, and its d-pad ← is unclaimed so
		// it falls through to head-look. Pad-focus the instrument, turn to port,
		// open Galaxy Map, and the right stick orbited the cluster and yawed the
		// ship. Sage found it; the prose was the defect.
		const padAxes = padFlightAxes(this.padFrame, this.padContext());
		const stickToChart = this.chartHasStick();
		const padYaw = stickToChart ? 0 : padAxes.yaw;
		const padPitch = stickToChart ? 0 : padAxes.pitch;
		const yaw = this.axis(["arrowright", "d"], ["arrowleft", "a"]) + padYaw;
		const pitch = this.axis(["arrowdown", "s"], ["arrowup", "w"]) + padPitch;
		const roll = this.axis(["e"], ["q"]) + padAxes.roll;

		// §7: any control input cancels the computer. Read before the rates are
		// stepped, so the cancel and the input land on the same frame rather than
		// the computer getting one more frame of authority over a player who has
		// already taken the stick.
		//
		// **The throttle counts.** It was left out of the first version, and the
		// result was worse than no cancel: `stepDockingComputer` overwrites
		// `this.throttle` on the same frame, so a player pushing the throttle got
		// neither a cancel nor an effect — an input that visibly does nothing.
		// §8's wind-up. It only *arms* a jump — the frame it fires on is flown
		// like any other so damage and a failed entry can still cancel it
		// (`takePendingJump`), and the jump is taken at the end of the step,
		// after which nothing of this frame means anything in the new system.
		//
		// **Before the docking-computer branch, because that branch returns.**
		// It sat after it until sage round 4 (codex): a player who charged a
		// jump with the autopilot engaged got frames that flew and docked but
		// never decremented the charge, so the jump stayed armed until docking
		// cancelled it. The autopilot path calls `advanceNormalFlight` like any
		// other, so it takes an armed jump — it simply never armed one.
		if (charging(this.jumpCharge)) this.stepJumpCharge(dt);

		if (this.dockingComputerEngaged && this.hasControlInput(yaw, pitch, roll)) {
			this.dockingComputerEngaged = false;
			this.clearPlayerArrivalLaneRequests();
		}
		if (this.detour && this.hasControlInput(yaw, pitch, roll)) {
			this.detour = null;
			// A throttle key is the player's chosen value for this same frame.
			// Do not briefly promote throttle-down to full cruise before its normal
			// input handling below can apply it.
			//
			// **The trigger is a throttle input too**, and leaving it out of this
			// guard made braking *accelerate*: the trim counts as control input,
			// so a left-trigger pull cancelled the detour and then fell through to
			// full cruise — 98.3% throttle where the same act on `control` leaves
			// 18.3%. Sage found it, round 4, and it is exactly the failure the
			// keyboard half of this guard was written for.
			if (
				!this.keys.has(THROTTLE_UP) &&
				!this.keys.has(THROTTLE_DOWN) &&
				padAxes.throttleTrim === 0
			)
				this.throttle = 1;
		}

		// One range scan and one orbital evaluation per station for the whole
		// step: the autopilot reads the same approach the crossing test then uses
		// as its "before" half, and neither moves the ship, so a second
		// evaluation would be the same answer at the same clock value.
		const approaches = this.dockingApproaches();
		const throttleRate = [...approaches.values()].some(
			({ pose }) => length(pose.rel) <= TRAFFIC_STATION_EXCLUSION_KM,
		)
			? STATION_THROTTLE_RATE_SCALE
			: 1;

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
		//
		// **A panel suspends it, exactly as it suspends the sticks.** A player
		// reading a console with the pointer captured had the same ship flying
		// off underneath them. The accumulated delta is **consumed** rather than
		// held, so closing the panel does not deliver a turn built up while it
		// was open.
		//
		// **The keyboard is deliberately not in this, and that is now a ruling
		// rather than an omission.** `this.axis(...)` a few lines below is
		// unconditional, and the principal confirmed it should stay so when the
		// question was put to them. The difference is real: a key has to be
		// *held*, so a keyboard player reading a console is not flying unless
		// they are still pressing something, while a stick drifts and a pointer
		// nudges without sustained intent. An earlier version of this comment
		// said the reason "was never about the device", which overreached in the
		// other direction; sage caught that.
		const flying = contextFliesShip(this.padContext());
		const impulse = flying
			? {
					pitch: clampAbs(-this.mouseDy * MOUSE_RAD_PER_PX, MOUSE_MAX_STEP),
					yaw: clampAbs(-this.mouseDx * MOUSE_RAD_PER_PX, MOUSE_MAX_STEP),
					roll: 0,
				}
			: { pitch: 0, yaw: 0, roll: 0 };
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
			PLAYER_PERFORMANCE,
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
			this.throttle = Math.min(1, this.throttle + dt * throttleRate);
		if (this.keys.has(THROTTLE_DOWN))
			this.throttle = Math.max(0, this.throttle - dt * throttleRate);
		// The triggers **trim** the throttle rather than setting it (#283's F2).
		// A pull is a speed, not a position: let go and the throttle stays where
		// it was, which is what a throttle is — and it keeps `throttleRate`,
		// which is scaled down near a station so docking stays flyable, and
		// keeps every existing writer of `this.throttle` from being fought on
		// the next frame. `pad-bindings.ts` argues the rejected arm.
		if (padAxes.throttleTrim !== 0)
			this.throttle = Math.min(
				1,
				Math.max(0, this.throttle + padAxes.throttleTrim * dt * throttleRate),
			);
		this.audio.ambient(this.throttle);

		// The spool-up runs in whichever regime the ship is in, and hands over at
		// zero. Cruise begins at full throttle, because a wind-up that ends with
		// the ship still stationary is a wind-up the player has to follow with a
		// second input for no reason.
		if (this.spoolLeftS > 0) {
			this.spoolLeftS = Math.max(0, this.spoolLeftS - dt);
			if (this.spoolLeftS === 0) {
				this.regime = "cruise";
				// **A leg's two ends are transitions, and its middle is not.** Position
				// and attitude are saved state (`CommanderRecord.flight`) and vary every
				// frame, so they ride on whatever else writes — but a within-system
				// cruise leg with no market event would write nothing at all, including
				// at quit, which is the leg-loss D4 rejected. The engage and the exit
				// are the two moments worth a write.
				this.saveDirty();
				this.proximityFrameBodyId = null;
				this.throttle = 1;
				this.legStartedAtS = this.world.gameTime;
				// The leg's draw: whether a raider comes, and when.
				this.scheduleLegEncounter();
			}
		}

		if (this.regime === "cruise") {
			this.stepCruise(dt, contactTargetAtFrameStart);
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
		stepWorld(this.world, this.control(), dt, PLAYER_PERFORMANCE);
		// After the world moved, because the hold is measured against where the
		// target *is* this frame: a carrier that drove out of range mid-charge
		// breaks it, and reading the old position would hold it forever.
		this.stepScan(dt);
		// §7: the tank refills passively in normal flight, and that is the
		// anti-stranding rule rather than a convenience.
		this.chargeAu = chargeAfterRegen(this.chargeAu, dt);
		this.stepDocking(before);
		// Last, because §8's wind-up is only vulnerable if the frame it fires on
		// is flown first — `stepDocking` is what applies a failed entry's damage,
		// and damage cancels the charge.
		this.takePendingJump();
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
	 * Ship, target and mass snapshots are all taken at the frame-start clock.
	 * `advanceCruise` evaluates their relative motion at the same sub-step times;
	 * the world clock moves exactly once after it returns. The ship is *placed*
	 * rather than integrated: §1 nose-locks velocity, so there is no momentum
	 * here to carry across frames.
	 *
	 * `ship.vel` is still written, because the HUD and everything downstream read
	 * it — but it is a **report** of this frame's motion, not a state the next
	 * frame integrates. That is the difference between the two regimes stated in
	 * one line of code.
	 */
	private stepCruise(dt: number, contactTargetAtFrameStart: Mass | null) {
		if (!this.stepDetour(dt)) return;
		const nose = this.nose();
		const target = this.targetBody();
		const targetMotion = target
			? isDisplayContact(target) && contactTargetAtFrameStart?.id === target.id
				? contactTargetAtFrameStart
				: {
						pos: { ...target.pos },
						radiusKm: target.radiusKm,
						vel: this.targetVelocity(),
						accelerationBoundKms2: isDisplayContact(target)
							? 0
							: bodyAccelerationBound(this.world.system, target.id),
					}
			: null;
		const step = advanceCruise({
			pos: this.world.ship.pos,
			nose,
			throttle: this.throttle,
			dt,
			masses: this.masses(),
			target: targetMotion,
			params: this.cruiseParams,
			chargeAu: this.chargeAu,
			targetParentId: this.targetParentId(),
		});
		// One explicit frame timeline: cruise consumes snapshots at `t`, then the
		// world moves once to `t + dt`. The pure step already carried a proximity
		// stop with its blocker through the unconsumed interval.
		advanceWorldClock(this.world, dt);
		this.world.ship.pos = step.pos;
		this.cruiseSpeedKms = step.speedKms;
		this.closingKms = step.closingKms;
		this.world.ship.vel = scale(nose, step.speedKms);
		this.chargeAu = chargeAfterTravel(this.chargeAu, step.travelledKm);
		if (step.dropped) {
			// The frame follows the physical event. Arrival matches the target;
			// proximity matches the blocker even when another target is selected.
			const matchBodyId =
				step.exit === "arrival" ? this.targetId : (step.exitBodyId ?? null);
			this.dropOut(
				step.exit === "proximity"
					? `dropped by proximity to ${step.exitBodyId ?? "a body"}`
					: `arrived at ${this.targetId ?? "target"}`,
				matchBodyId,
				step.exit === "proximity",
			);
			return;
		}
		// **After** the arrival test: a frame that both arrives and runs the tank
		// dry is an arrival — the ship is at its target, and reporting an
		// empty tank instead would drop it there in the wrong frame.
		if (step.starved) this.dropOut("drive charge exhausted");
	}

	/** Turn toward the current internal waypoint; physical motion remains cruise. */
	private stepDetour(dt: number): boolean {
		if (!this.detour) return true;
		if (this.detour.targetId !== this.targetId) {
			this.detour = null;
			this.throttle = 1;
			return true;
		}
		const target = this.targetBody();
		if (!target) {
			this.detour = null;
			this.throttle = 1;
			return true;
		}
		const guided = stepCruiseGuidance({
			guidance: this.detour,
			pos: this.world.ship.pos,
			nose: this.nose(),
			target,
			masses: this.masses(),
			targetParentId: this.targetParentId(),
			dt,
			speedKms: this.cruiseSpeedKms,
			steerDirect: false,
		});
		if (guided.error) {
			const id = guided.error.blockerId;
			this.dropOut(`detour unavailable: ${this.bodyFor(id)?.name ?? id}`);
			return false;
		}
		this.detour = guided.guidance;
		this.throttle = guided.throttle;
		const desired = this.detourDirection.set(
			guided.nose.x,
			guided.nose.y,
			guided.nose.z,
		);
		this.detourCurrentNose
			.copy(this.detourForward)
			.applyQuaternion(this.orientation);
		this.detourOrientation.setFromUnitVectors(this.detourCurrentNose, desired);
		this.orientation.premultiply(this.detourOrientation).normalize();
		return true;
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
		this.updateTrafficPresentation(camPos);
		this.updateEncounterPresentation(camPos);
		this.updateRelayPresentation(camPos);

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
		this.combatRig?.render(this.view, viewRotation, camPos);

		// The star, resolved once at build time rather than scanned for per frame:
		// every body's sun direction is measured from it, and there is no path
		// that changes the system a game is in.
		const star = this.starBody;
		const starPos = star ? star.pos : ORIGIN;

		/**
		 * **This frame's answer is accumulated in locals and assigned after the
		 * loop**, so the read inside it is genuinely last frame's (sage, PR #256,
		 * round 5).
		 *
		 * Clearing the field here instead made it a *running max*: the first body
		 * reached always beat 0 and took the id, and so did every body that was
		 * the running max when its turn came — so a system whose bodies arrive in
		 * ascending apparent size handed the large pair to all of them, which is
		 * the 224 MB the policy exists to refuse. Three files said "last frame's
		 * answer by construction" and it was a running one.
		 */
		let widestId: string | undefined;
		let widestPx = 0;

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
				// How big the star looks from this body, in radians — the width of
				// the penumbra #210's ring shadow is drawn with. Computed here for
				// the same reason `sunDir` is: it is a fact about where this body
				// is. Radius over distance, so a body an AU further out sees a
				// *smaller* star and gets a **sharper** shadow. The star itself
				// takes 0, which is the same "no answer needed" case the
				// direction's fallback covers.
				const starAngularRadius = sd > 0 ? (star?.radiusKm ?? 0) / sd : 0;
				visual.setSunDirection(SUN_DIR, starAngularRadius);
				// The world clock, not a frame counter: cloud drift and stellar
				// granulation are `f(gameTime)` like every other time-varying thing
				// (#6), so they survive a pause and a save.
				visual.setTime(this.world.gameTime);

				/**
				 * #207's band, from the size this body actually looks.
				 *
				 * Here rather than beside `massiveLayerFor` above, because it is a
				 * different question about the same distance: the layer is where a
				 * body is drawn and this is which program draws it. Both read
				 * `distanceKm`, which is computed from sim positions a few lines up
				 * — never back out of an `Object3D`.
				 *
				 * **The pin is checked inside `applyReliefBand`, per body**, and
				 * there is deliberately no second flag on the `Game` beside it: two
				 * owners of one fact is how they come to disagree, and the panel
				 * pins by walking scenes with no handle to set a second one on.
				 */
				const radiusPx = projectedRadiusPx(
					body.radiusKm,
					distanceKm,
					this.focalPx,
				);
				/**
				 * #208's band sits over #207's, and one call decides both.
				 *
				 * `bakedFacePx()` is `0` until this body's cube is complete, which
				 * is the dozen frames after a jump and every frame of a class that
				 * cannot bake — so the same call is what keeps a half-filled cube
				 * off the screen. It is also the *resolution of the cube this body
				 * actually has*, not the one its layer would like: a body still
				 * carrying the approach layer's 256 leaves the band further out
				 * than one that has re-baked at 512, and that is correct rather
				 * than an approximation.
				 */
				/**
				 * The cube's **size** follows the apparent radius too (#208).
				 *
				 * Here rather than at the layer handoff, because the layer is not the
				 * question: a 256 face reaches the tolerance at about
				 * 3.69 radii and a 512 at about 2.18, and which of those a body needs
				 * is a fact about how big it looks. Hysteresis lives inside
				 * `bakeFacePxFor` for the reason the band's does — a re-bake is
				 * twelve full-screen evaluations of the most expensive shader here.
				 */
				const held = this.bakeFacePx.get(body.id) ?? null;
				/**
				 * **One large pair in the system, and it goes to the nearest body.**
				 *
				 * `bakeFacePxFor` hands 512 to every body inside about 3.69 of its own
				 * radii, and a system can have several — so the memory census's
				 * "68.0 MB worst case" was a hope rather than a bound, with fourteen
				 * large pairs at 224 MB the thing actually permitted (sage, PR #256,
				 * round 4). The largest apparent radius wins because that is the body
				 * the resolution is for; every other body takes the small pair, which
				 * it would anyway unless two are close at once.
				 *
				 * Decided against the *previous* frame's widest, held in a field, so
				 * this stays a single pass over the bodies rather than a pass to find
				 * the winner and a pass to size everything. One frame of lag on a
				 * threshold nothing crosses abruptly — and the field is written after
				 * the loop, not during it, or the answer is a running max and every
				 * body in ascending order takes the large pair.
				 */
				if (radiusPx > widestPx) {
					widestPx = radiusPx;
					widestId = body.id;
				}
				const mayHoldLarge = body.id === this.widestBodyId;
				const wantFacePx = mayHoldLarge
					? bakeFacePxFor(radiusPx, this.focalPx, held)
					: BAKE_FACE_SIZES[0];
				// `canBake()` and not a stored flag: the perf panel can put a gas
				// giant's class on a rocky body, and a scheduler that asked anyway
				// threw out of the frame loop (sage, PR #256, round 3).
				if (visual.canBake() && held !== wantFacePx)
					this.rebake(body.id, wantFacePx);

				const facePx = visual.bakedFacePx();
				visual.applySurfaceBand(
					surfacePathFor(
						radiusPx,
						visual.surfacePath(),
						facePx > 0,
						this.focalPx,
						facePx,
					),
				);
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
		// **After the loop, not inside it** — see the declaration above.
		this.widestBodyId = widestId;
		this.widestRadiusPx = widestPx;

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
				.fromArray(LIGHT_RIG.fill.direction)
				.normalize()
				.applyQuaternion(this.orientation);

		const shipRel = sub(this.world.ship.pos, camPos);
		this.shipMesh.position.set(shipRel.x, shipRel.y, shipRel.z);
		this.shipMesh.quaternion.copy(this.orientation);
		this.anchorFleet();
		for (const parked of this.fleet)
			parked.mesh.position.set(
				parked.contact.pos.x - camPos.x,
				parked.contact.pos.y - camPos.y,
				parked.contact.pos.z - camPos.z,
			);
		// The hull is the camera in cockpit view, and drawing a cube around the
		// near plane fills the screen with its inside faces.
		this.shipMesh.visible = this.view === "chase";

		// **#241's gate, then #201's shadow camera** — in that order, because the
		// gate decides whether there is a shadow to fit at all and
		// `fitShadowCamera` reads `castShadow` on its first line.
		//
		// Stepped every frame whatever the gate says, including while it is shut:
		// a gate that stopped being advanced when it closed could never open
		// again. And stepped before the passes are drawn rather than after, so
		// the frame that opens it is the frame that draws with it.
		// **Before the passes, and strictly budgeted** (#208). A bake draws a
		// full-screen quad of the most expensive shader in the game into a cube
		// face; twelve of those per body, on a system that can hold fourteen
		// bakeable bodies, is the load-time stall the node forbids. One face a
		// frame spreads a system over about two seconds at 60 Hz, during which
		// every body is drawn procedurally exactly as it is today.
		this.stepBakes();

		this.occlusionGate = stepOcclusionGate(
			this.occlusionGate,
			this.buildStationSubjects(),
		);
		this.applyOcclusion();
		this.fitShadowCamera();

		// **Cockpit only** (#200). A vignette is a lens artefact; in cockpit view
		// it reads as the canopy's own falloff and keeps the frame's corners from
		// competing with the instruments, and on an exterior shot with no lens in
		// the fiction it reads as a photograph of a spaceship.
		this.outputPass.setVignette(
			this.view === "cockpit" && this.settings.value.vignette === "on"
				? VIGNETTE_MAX
				: 0,
		);

		const attribution = this.frameAttribution;
		if (attribution?.snapshotMode === "full") this.renderer.info.reset();
		const renderStartedAt = attribution ? performance.now() : 0;
		// **Before `beginGpuFrame`, and unconditionally.** The mark is what the
		// cadence is built from and a frame the query ring skips is still a
		// frame; #352 split the two for exactly this call site.
		attribution?.markFrame(renderStartedAt);
		attribution?.beginGpuFrame(renderStartedAt);
		try {
			this.composer.render();
		} finally {
			attribution?.endGpuFrame();
		}
		if (attribution)
			attribution.recordCpu(
				"render submission/composer",
				performance.now() - renderStartedAt,
			);
		this.drawMarkers(camPos);
		this.frames++;
	}

	/**
	 * Point the sun's shadow camera at this frame's near subject and cut its box
	 * to fit — #201.
	 *
	 * ## Which subject, and why it is not all of them
	 *
	 * One 2048² map serves a near layer whose subjects are four orders of
	 * magnitude apart, so the box is the thing that decides what a shadow can
	 * resolve. The rule is the node's, written out:
	 *
	 * - **cockpit view — the cabin alone.** The cabin is a ~30 m box *at* the
	 *   camera and a station is a kilometre of structure some kilometres away;
	 *   the union of the two is the station, and the cabin's shadows would be
	 *   drawn at a texel two metres across. The cabin is what the player looks
	 *   through and what the node's defect is about, so it wins and the station
	 *   ahead takes no shadow. That is a stated limit, not an oversight — it
	 *   took none before either, and the ambient occlusion still reaches it.
	 * - **otherwise — the hull, and whichever near-layer stations `shadowBox`
	 *   admits.** Not every one of them: the near layer reaches ten thousand
	 *   kilometres and a system has one to three stations, so the first version
	 *   of this unioned the fixture's second station 405 km away and cut a box
	 *   with a 455 m texel. `occlusion.ts` owns the two admissions and the
	 *   figures behind them. In `hull-chase` nothing else is near, so the box
	 *   is the hull alone and its texel is the smallest in the game; in
	 *   `station-flank` it spans the hull and the station it is beside, at a
	 *   measured 1.85 m — where an aperture and a boom cast cleanly, a greeble
	 *   casts something soft, and the bay's corners are the ambient occlusion's
	 *   job rather than this map's. The figures a run reports are
	 *   `scripts/probe-occlusion.mjs`'s to print and to bound; `hull-chase` has
	 *   no reading because no check frames it, which is worth saying rather
	 *   than filling in.
	 *
	 * ## Moving the light without moving the light
	 *
	 * `render` above has already put every sun's `position` on `STAR_DIR`, a
	 * unit vector, against a target at the origin — which is all the other two
	 * layers need, because a directional light's contribution is a direction.
	 * A shadow camera also reads the position, so this moves the pair: the
	 * target to the subject's centre and the light to `centre + STAR_DIR ×
	 * pushback`. The difference between them is still exactly `STAR_DIR`, so
	 * nothing the player sees is lit differently by this.
	 */
	private fitShadowCamera() {
		const sun = this.shadowSun;
		if (!sun) return;
		if (!sun.castShadow) {
			// **The target goes home, and that is a fix rather than tidiness.**
			// A directional light's contribution is `position - target`, and
			// `render` puts `position` back on `STAR_DIR` — a *unit* vector —
			// every frame. Leave the target at the last fitted subject's centre
			// and the difference is `STAR_DIR - centre`, which for a station four
			// kilometres away is barely `STAR_DIR` at all. So turning the shadow
			// off did not turn a shadow off: it swung the near layer's sun onto a
			// new bearing, and every shadow-on-against-off reading in
			// `probe-occlusion.mjs` was a comparison against a **relit** frame
			// rather than an unshadowed one. Sage found it; the exterior figure
			// went from a confident 0.467% to 0.003% when the two arms started
			// differing only by the shadow.
			this.shadowTarget.position.set(0, 0, 0);
			return;
		}
		const candidates = this.shadowCandidates;
		candidates.length = 0;
		if (this.view === "cockpit") {
			if (this.cockpit.mesh.visible)
				candidates.push(subjectOf(this.cockpit.mesh));
		} else {
			if (this.shipMesh.visible) candidates.push(subjectOf(this.shipMesh));
			// Already built this frame, for #241's gate a few lines up in
			// `render`. Rebuilding them here would walk every station's world
			// matrix a second time for the same answer.
			for (const station of this.stationSubjects) candidates.push(station);
		}
		const subject = shadowBox(candidates);
		if (!subject) {
			// Nothing in the near layer this frame. Leave the map as it was
			// rather than fitting a degenerate box: three still renders it, and
			// an empty one is a map of nothing that shadows nothing.
			sun.castShadow = false;
			this.shadowSunIdle = true;
			return;
		}
		if (this.shadowSunIdle) {
			sun.castShadow = true;
			this.shadowSunIdle = false;
		}
		const fit = shadowFit(subject.radiusKm);
		// A reference axis the star is not on. `lookAt` builds the camera's frame
		// from the view direction and `up`, and returns a degenerate one — every
		// shadow NaN, the map black — when the two are parallel. `STAR_DIR`
		// sweeps the whole sphere over a system crossing, so it passes through
		// the world's up axis for real rather than in principle.
		const camera = sun.shadow.camera;
		if (Math.abs(STAR_DIR.y) > 0.99) camera.up.set(1, 0, 0);
		else camera.up.set(0, 1, 0);
		this.shadowTarget.position.set(...subject.center);
		sun.position.set(
			subject.center[0] + STAR_DIR.x * fit.pushbackKm,
			subject.center[1] + STAR_DIR.y * fit.pushbackKm,
			subject.center[2] + STAR_DIR.z * fit.pushbackKm,
		);
		camera.left = -fit.halfExtentKm;
		camera.right = fit.halfExtentKm;
		camera.top = fit.halfExtentKm;
		camera.bottom = -fit.halfExtentKm;
		camera.near = fit.nearKm;
		camera.far = fit.farKm;
		camera.updateProjectionMatrix();
		sun.shadow.bias = fit.bias;
		sun.shadow.normalBias = fit.normalBias;
		// Held for `probe-occlusion.mjs`, which cannot otherwise tell a box that
		// was fitted from one that was left at three's 5-unit default — both
		// render, and only one of them renders the right thing.
		this.shadowTexelKm = fit.texelKm;
	}

	/** Whether `fitShadowCamera` turned the sun's shadow off for want of a
	 *  subject, so it knows to turn it back on rather than leaving the quality
	 *  gate's answer overwritten. */
	private shadowSunIdle = false;
	/** The footprint of one shadow texel on the last frame's subject, in
	 *  kilometres — the figure a framing's shadow quality is read from. */
	shadowTexelKm = 0;

	private animate = () => {
		this.animationFrame = requestAnimationFrame(this.animate);
		// Before the step, so a press and the frame it belongs to are the same
		// frame. Exactly one caller: `poll` computes its edges against the
		// previous call, so a second one in the same frame reports no presses.
		this.pollPad();
		// #371: the pointer goes with the surface `pollPad` just read. Why it is
		// taken here and not at the screens that draw a console is
		// `reconcilePointerLock`'s to say, and this line is not a second copy.
		this.reconcilePointerLock();
		const now = performance.now();
		const dt = this.lastTime
			? Math.min(MAX_DT, (now - this.lastTime) / 1000)
			: 0;
		this.lastTime = now;
		// After `dt` and before the step: the chart's camera is not flight, and
		// it must keep turning while §12 has flight suspended.
		this.stepChartOrbit(dt);
		const updateStartedAt = this.frameAttribution ? performance.now() : 0;
		// **The clock is held, not the loop** (§11.2): `lastTime` above still
		// moves, so the frame after Continue carries one frame of time rather than
		// everything since the page opened.
		if (dt > 0 && !this.clockHeld) this.step(dt);
		if (this.frameAttribution)
			this.frameAttribution.recordCpu(
				"simulation/step",
				performance.now() - updateStartedAt,
			);
		this.stepAdaptiveResolution();
		this.render(dt);
		this.updateCockpit();
		if (this.legacyHud) this.updateHud();
		// Here and not in `updateCockpit`, which returns early in chase: §5.3's
		// badge shows in every view.
		// Not while the Commander overlay is open: it states the fault itself, and
		// the badge showed dimly behind it at a boot fault (the principal's call).
		this.saveBadge?.update(
			this.saveFaultShown() && !this.commanderOverlay?.isOpen(),
		);
	};

	private readonly chaseOffset = new THREE.Vector3();

	/**
	 * Pin the review avenue in front of the ship, once.
	 *
	 * Laid out along the ship's own axes rather than the world's: the ship does
	 * not boot facing -Z, it boots facing the station, and an avenue built on
	 * the world axes put thirty-six hulls out of frame with nothing wrong in
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
			parked.contact.pos = v3(
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
		const dockContext = this.dockedStationContext();
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
				? `${target.name} · ${range(targetKm)}${relativeLabel(
						this.targetRelativeKms(),
					)}`
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
			legalStatus: this.legalStanding().toUpperCase(),
			charge: floorCellValue(this.floorCells(), "CHARGE"),
			// #324's full duel detail, only while the glass shows the duel row.
			duel: this.duelRowShown() ? duelConsoleReadout(this.condition) : null,
			// #364: what the scan channel has recorded about what is selected.
			scan: this.scanConsoleRow(this.scanReadout(target)),
			// #324 part d: the raider lifecycle on the Communications console,
			// derived from world state, newest first.
			// Derived only while that console's tab is open (sage #330).
			raiderLog:
				this.leftTab === "Communications"
					? newestFirst([
							...raiderLog(
								this.commerceWorld.galaxies[this.world.system.record.galaxy],
								this.world.system.record.index,
								this.world.system.record.government,
								this.world.gameTime,
							),
							// #43: the relay's lifecycle in the same log, same derivation.
							...(RELAY_PROTOTYPE
								? relayLog(
										this.commerceWorld.galaxies[
											this.world.system.record.galaxy
										],
										this.world.system.record.index,
										this.world.gameTime,
									)
								: []),
						])
							.slice(0, 6)
							.map(formatRaiderLogLine)
					: [],
			relay: this.relayCue(),
			tuning: this.tuningSummary(),
			requests: this.requestFixtures
				? this.requestsView(dockContext)
				: undefined,
			stationConsole: this.stationConsoleState(dockContext),
			launchHold: this.launchHold ? { refusal: this.launchHold.refusal } : null,
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
	private requestsView(context = this.dockedStationContext()): RequestsView {
		if (this.requestFixtures && context) {
			const key = `${context.galaxyIndex}:${context.stationKey}`;
			if (key !== this.requestOffersCacheKey) {
				this.requestOffersCache = fixtureOffers(
					context.galaxyIndex,
					context.stationKey,
					this.nameOfStation(context.station.id),
					0,
				);
				this.requestOffersCacheKey = key;
			}
		}
		return {
			state: this.requests,
			offers: this.requestFixtures && context ? this.requestOffersCache : [],
			selectedId: this.requestSelectedId,
			message: this.requestMessage,
			revision: this.requestRevision,
			now: this.world.gameTime,
			docked: context
				? { galaxyIndex: context.galaxyIndex, carrierKey: context.stationKey }
				: null,
			fixtures: this.requestFixtures,
		};
	}

	private actOnRequest(action: string, id: string): void {
		// Every action here belongs to the isolated fixture experiment. Imported
		// experiment journals must not pay rewards in a normal Commander session.
		if (!this.requestFixtures) return;
		const view = this.requestsView();
		if (action === "details") {
			if (
				!view.offers.some((o) => o.id === id) &&
				!this.requests.byId[id] &&
				!this.requests.leadsById[id]
			)
				return;
			this.requestSelectedId = id;
			this.requestMessage = "";
		} else {
			const result = requestAction(this.requests, view.offers, action, id, {
				now: this.world.gameTime,
				docked: view.docked,
				armed: this.condition.hull > 0,
			});
			this.requestMessage = result.message;
			if (result.ok) {
				this.requests = result.state;
				if (result.rewardCr)
					this.commander = {
						...this.commander,
						credits: this.commander.credits + result.rewardCr,
					};
				this.stationConsoleRevision += 1;
				this.saveDirty();
			}
		}
		this.requestRevision += 1;
		this.updateCockpit();
	}

	private stationConsoleState(context = this.dockedStationContext()) {
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
				// The flown hold, bay included — the same figure the transaction
				// uses (#182), read through `commanderHold` rather than off the
				// roster so the screen and the till cannot disagree about whether
				// a Large Cargo Bay counts.
				holdT: commanderHold(this.commander).capacityT,
				// The system's tech level, which is what §5.6's cut is a function
				// of. Read from the same record the transaction reads it from, so
				// the quote on the glass is the quote the till charges.
				displayTL: this.world.system.record.displayTL,
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
			fuelLy: this.commander.fuelLy,
			fuelCapacityLy: this.fuelCapacityLy,
			revision: this.stationConsoleRevision,
		};
		return this.stationConsoleCache;
	}

	/**
	 * The player half of a save, read **at the moment a write fires** (#89 D5).
	 *
	 * Every field here is renderer session state with no other typed home,
	 * which is what #90 was asked to fix: the galaxy and system indices, the
	 * station the ship is parked in, the cruise reserve, the permadeath flag,
	 * and — the one #89 could not have listed, because it decided a cadence and
	 * not a load path — where the ship actually is.
	 */
	commanderRecord(): CommanderRecord {
		const base = newCommanderRecord(this.commander.hull);
		// **Every phase that is not `flying`**, not just `docked`. A record
		// written during an arrival or a launch has the ship on rails inside a
		// station's geometry, and `dockedAt` is what routes the load to the
		// arrival point instead of to `flight.pos` — which on a launch is the
		// berth pose, *inside the hull*. Reading `docked` alone put both of
		// those cases on the in-flight arm.
		const station =
			this.dock.phase !== "flying" && this.dock.stationId
				? stationOf(this.world.system, this.dock.stationId)
				: null;
		return {
			...base,
			state: this.commander,
			requests: this.requests,
			galaxyIndex: this.world.system.record.galaxy,
			systemIndex: this.world.system.record.index,
			dockedAt: station
				? carrierKey(this.world.system.record.index, station.localCarrierId)
				: null,
			chargeAu: this.chargeAu,
			permadeath: this.permadeath,
			flight: {
				pos: [
					this.world.ship.pos.x,
					this.world.ship.pos.y,
					this.world.ship.pos.z,
				],
				vel: [
					this.world.ship.vel.x,
					this.world.ship.vel.y,
					this.world.ship.vel.z,
				],
				orientation: [
					this.orientation.x,
					this.orientation.y,
					this.orientation.z,
					this.orientation.w,
				],
				regime: this.regime,
				throttle: this.throttle,
			},
		};
	}

	/**
	 * #89's D7, at the one moment it can be chosen.
	 *
	 * **It refuses on a loaded commander**, because a flag that can be flipped
	 * later is a setting and not a choice — and the one thing D7 does promise is
	 * that the flag was written at creation.
	 */
	choosePermadeath(): void {
		if (this.commerceWorld.gameTime > 0)
			throw new Error("permadeath is chosen at new game, not later");
		this.permadeath = true;
		this.saveDirty();
	}

	/**
	 * Apply a carrier transition to the live world — the path #43's prototype
	 * needs and nothing in the game yet reaches.
	 *
	 * `persistent-world-state.md` §4's table has been implemented and tested
	 * since #46, and until now the only caller was its own test: nothing in
	 * flight damages a carrier, so the whole domain was unreachable from a
	 * running game. A prototype should not have to build the wire before it can
	 * ask its question, and #90 is the node that owns the wire.
	 *
	 * It is the module's writer, unedited — the clock refusal, the galaxy
	 * bound and `materializeDue` all apply, so a debug hook cannot put the
	 * world in a state a real writer could not.
	 */
	applyCarrierTransition(key: CarrierKey, event: TransitionEvent): void {
		this.commerceWorld = applyTransition(
			this.commerceWorld,
			this.world.system.record.galaxy,
			key,
			event,
		);
		this.saveDirty();
	}

	/** The effective condition of one carrier right now, for the same caller. */
	carrierCondition(key: CarrierKey) {
		return effectiveCarrier(
			this.commerceWorld.galaxies[this.world.system.record.galaxy],
			key,
			this.world.gameTime,
		);
	}

	/**
	 * The whole save, world and commander, as the store asks for it.
	 *
	 * **The clock is advanced here, and that is the one-clock rule closing its
	 * last gap.** `commerceWorld.gameTime` only moves inside `withEnvelope`, so
	 * it is the time of the last *world* event — a dock, a relay observation, a
	 * trade. `commanderRecord().flight.pos` is read now. A cruise leg with no
	 * market event would therefore pair a current position with a stale clock,
	 * and `restoreWorld(…, save.world.gameTime)` would then do exactly what its
	 * own comment forbids: leave every planet an orbit out of date beside a ship
	 * that is where it is.
	 *
	 * `advanceTo` is the module's own verb and materializes any completion the
	 * advance passes, so this cannot step over one.
	 */
	saveEnvelope(): SaveEnvelope {
		this.commerceWorld = advanceTo(this.commerceWorld, this.world.gameTime);
		return { world: this.commerceWorld, commander: this.commanderRecord() };
	}

	/**
	 * #89's D4 trigger: **any** change to saved state, coalesced by the store.
	 *
	 * A no-op with no store, which is every workbench route and any probe that
	 * did not ask for one — so a call site is a bare call rather than a guard
	 * repeated a dozen times.
	 */
	private saveDirty(): void {
		this.saveStore?.markDirty();
	}

	/** D4's unconditional flushes. Deliberately **not** called on death: the
	 *  tab-close window is left open, which is #89's correction read as written. */
	saveFlush(reason: FlushReason): void {
		// **No slot argument.** `SaveStore` owns which slot is active, because the
		// debounce writes `live` off that field and a second owner here would
		// split `live` and `lastDocked` across two slots the moment anything
		// selected one.
		void this.saveStore?.flush(reason).catch((error) => {
			// D9: a failed write leaves the previous record in place. Stale
			// rather than broken, and said out loud rather than swallowed. The
			// store holds the failure against the kinds it did not write, which is
			// what the badge and its overlay read (§11.5, `saveFaultText`).
			console.error(`save: ${flushFault(reason, error)}`, error);
		});
	}

	/**
	 * The save fault the badge stands for, in the overlay's words, or `null`
	 * while none is held (`heldSaveFault`). The one reader for the frame loop's
	 * badge and for the overlay the badge opens, so the two cannot disagree.
	 */
	saveFaultText(): string | null {
		return heldSaveFault(this.saveStore, this.saveFault);
	}

	/** Whether the badge shows: `saveFaultText() !== null` without building the
	 *  words, because the frame loop asks it every frame. */
	saveFaultShown(): boolean {
		return hasHeldSaveFault(this.saveStore, this.saveFault);
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
		// Through the module's own writer, not by hand. `setDeficits` carries
		// the galaxy bound, the "no write before the clock" refusal and
		// `materializeDue`, and it takes the world clock in **seconds** — the
		// spread this replaced set `gameTime` to the *minutes* figure beside it,
		// which is the unit a deficit row's `updatedAt` wants and the clock
		// never does.
		this.commerceWorld = setDeficits(
			this.commerceWorld,
			galaxyIndex,
			result.deficits,
			this.world.gameTime,
		);
		this.saveDirty();
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
		const rows = projectNavTargets(
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
				previousOrder: this.navOrder,
				etaFor: ({ id }) => {
					const cached = this.navEtaCache.get(id);
					if (cached !== undefined) return cached;
					const body = this.bodyFor(id);
					const eta = body ? this.timeToBody(body) : null;
					this.navEtaCache.set(id, eta);
					return eta;
				},
			},
		);
		this.navOrder = rows.map(({ id }) => id);
		return rows;
	}

	private refreshScannerContacts() {
		projectScannerContacts(
			this.world.ship.pos,
			this.world.system.bodies,
			this.targetId,
			{
				orientation: this.orientation,
				output: this.scannerContactBuffer,
				flooredContacts: this.contacts,
			},
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
				// The hyperspace tank and the set course (#187). They are here and
				// not on the floor strip because `hud-and-scanner.md` §5 fixes
				// that strip at four cells and gives the tank no home at all —
				// which is a HUD question this node surfaced and did not settle.
				`fuel ${this.commander.fuelLy.toFixed(1)}/${this.fuelCapacityLy} LY`,
				(() => {
					const to = this.nextHop();
					return to ? `next ${to.name}` : "";
				})(),
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
			jumpChargeLeftS: this.jumpCharge.leftS,
			throttle: this.throttle,
			assist: this.assist,
			chargeAu: this.chargeAu,
			chargeCapacityAu: CHARGE_CAPACITY_AU,
			chargeRegenAuPerS: CHARGE_REGEN_AU_PER_S,
		});
	}

	/**
	 * The set course's chain, planned once per (course, where the ship is).
	 *
	 * **Re-derived, never remembered as a cursor**, for `galaxy-route.ts`'s own
	 * reason: a `Course` is a destination and not a chain, so an off-plan jump
	 * re-plans instead of desyncing.
	 *
	 * **But not re-planned every frame.** `courseProgress` runs `planRoute` — a
	 * 256-node Dijkstra with four typed-array allocations — and the chart
	 * already records that a getter which looks free was one full search per
	 * read. Two callers share this: §8.3's row, and `nextHop`, which
	 * `cruisePrompt` reaches from the per-frame overlay draw. They did not for a
	 * round, so the cache bought the frame nothing while the identical search
	 * ran twenty lines away — and this comment claimed otherwise.
	 *
	 * `null` is "no course, or one that does not resolve" — §5.2 owns what the
	 * second of those means and this does not restate it, because the two
	 * sentences were written separately and disagreed about which states are
	 * corrupt.
	 */
	private courseChain(): CourseChain | null {
		const course = this.course;
		if (!course) return null;
		const here = this.world.system.record;
		// **Every input `courseProgress` reads is in the key.** The ship's
		// galaxy as well as the course's — a course is per-galaxy, and §5.2
		// names what a mismatch between the two means — and the jump range,
		// which is `courseProgress`'s fourth argument and today a constant.
		// #185 makes the range hull-aware, and a key blind to it would then
		// serve the previous hull's chain.
		// One local, passed *and* keyed. Interpolating the constant while letting
		// `courseProgress` take its own default keyed a number this call could
		// not vary — protection the comment claimed and the key did not give.
		const maxJump = JUMP_RANGE_LY;
		const key = `${course.galaxy}:${course.destinationIndex}:${here.galaxy}:${here.index}:${maxJump}`;
		if (this.courseChainCache?.key !== key) {
			const progress = courseProgress(
				this.world.galaxy.systems,
				course,
				here,
				maxJump,
			);
			this.courseChainCache =
				progress === null
					? { key, chain: null }
					: {
							key,
							chain: {
								destination: progress.route.to,
								nextHop: progress.nextHop?.system ?? null,
								remaining: progress.remaining,
							},
						};
		}
		return this.courseChainCache.chain;
	}

	/**
	 * §8.3's course row **as a state**, or `null` for no row at all.
	 *
	 * Named for the state rather than the row because `courseCue` is the
	 * formatter: `courseRow(): CourseCue` beside `courseCue(): FloorCell` read
	 * as each other's inverse, and the call site said so out loud —
	 * `const courseRow = courseCue(this.courseRow())`.
	 */
	courseCueState(): CourseCue | null {
		const chain = this.courseChain();
		if (chain === null) return null;
		if (chain.nextHop === null)
			return { kind: "arrived", destination: chain.destination.name };
		return {
			kind: "underway",
			nextHop: chain.nextHop.name,
			remaining: chain.remaining,
			// **The gate itself, not a copy of it.** The cue reddens on exactly
			// the condition that refuses the jump, so the row and the refusal it
			// predicts cannot drift apart.
			affordable: this.jumpDecision(chain.nextHop).ok,
		};
	}

	/** Whether a raider is the selected target and on the scanner (#324). */
	private raiderSelected(): boolean {
		return (
			this.raiderListed &&
			this.targetId !== null &&
			this.targetId === this.raiderContact.id
		);
	}

	/** Whether the pirate relay is the selected target (#43): it pulls the
	 *  gimbal and earns the on-target mark as a raider does. */
	private relaySelected(): boolean {
		return (
			this.relayListed &&
			this.targetId !== null &&
			this.targetId === this.relayContact.id
		);
	}

	/** Whether an ordinary carrier is the selected target (civilian-combat H3):
	 *  the third combat target #43's rule names, so it pulls the gimbal and
	 *  earns the on-target mark. */
	private trafficSelected(): boolean {
		return (
			this.targetId !== null &&
			this.trafficContacts.has(this.targetId as CarrierKey)
		);
	}

	/** Whether the duel row shows: a raider contesting, dueling or selected. */
	private duelRowShown(): boolean {
		return showDuelRow({
			encounterPhase: this.encounter?.phase ?? null,
			targetIsRaider: this.raiderSelected(),
		});
	}

	private drawFlightFloor(ctx: CanvasRenderingContext2D, w: number, h: number) {
		const cells = this.floorCells();
		const courseRow = courseCue(this.courseCueState());

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
			// **Both runs on the floor are fitted, not just the strip.** The
			// course row is centred on the same axis and drawn at the same
			// scale, so a solve that ignored it would fit one instrument and
			// clip the other — which is #92's own failure with a second run
			// added to the floor.
			const widestCourse = [
				{ label: COURSE_CUE_LABEL, value: this.courseWidest },
			];
			// And the duel row (#324), for the same reason: a third run on the
			// same axis at the same scale.
			const widestDuel = DUEL_ROW_LABELS.map((label) => ({
				label,
				value: DUEL_ROW_WIDEST[label],
			}));
			const runAt = (scale: number) =>
				Math.max(
					floorRunWidths(ctx, widestCells, scale).total,
					floorRunWidths(ctx, widestCourse, scale).total,
					floorRunWidths(ctx, widestDuel, scale).total,
				);
			const atOne = runAt(1);
			const solved = Math.max(
				FLOOR_MIN_SCALE,
				Math.min(1, available / Math.max(1, atOne)),
			);
			// Rounded down to a step so a one-pixel viewport change does not
			// re-lay the strip out at an imperceptibly different size.
			const stepped = Math.max(FLOOR_MIN_SCALE, Math.floor(solved * 50) / 50);
			const fitted = runAt(stepped);
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
		// The three typography arguments are identical at both call sites and
		// come from one fit solve, so they travel together rather than as three
		// of eight positionals a reader has to align.
		const floorType = { labelGap, labelFont, valueFont };

		const glassBottomY = h * GLASS_BOTTOM_FRACTION;
		const baselineY =
			glassBottomY - FLOOR_STRIP_HEIGHT_PX * FLOOR_BASELINE_FRACTION;
		let x = (w - total) / 2;
		const boxes: FloorBox[] = [];
		ctx.save();
		ctx.textAlign = "left";
		for (const [i, cell] of cells.entries()) {
			// Every floor box states its own band, so nothing sampling one keeps
			// a glyph height of its own.
			boxes.push(
				floorBox(
					cell.label,
					x,
					widths[i],
					glassBottomY - FLOOR_STRIP_HEIGHT_PX,
				),
			);
			drawFloorCell(
				ctx,
				cell,
				{ x, baselineY, labelWidth: labelWidths[i] },
				floorType,
			);
			x += widths[i] + cellGap;
		}
		// §8.3's course row, above the strip and on the same centre axis.
		//
		// **Drawn from the same run-measuring pass as the strip**, so the two
		// cannot come to be laid out two ways; it is one cell in the strip's own
		// label/value/tone grammar, in its own band, rather than a fifth cell
		// (#117 D1). With no course it is absent, and absence here moves nothing
		// below it (#117 D2).
		// One painter for every centred row above the strip: measure the run,
		// centre it, box it in its band, paint each cell. The course row and
		// #324's duel row were this block twice.
		const drawBandRow = (
			rowCells: FloorCell[],
			label: string,
			band: number,
		): FloorBox => {
			const run = floorRunWidths(ctx, rowCells, scale);
			let rowX = (w - run.total) / 2;
			const box = floorBox(label, rowX, run.total, floorBandTopY(h, band));
			for (const [i, cell] of rowCells.entries()) {
				drawFloorCell(
					ctx,
					cell,
					{ x: rowX, baselineY: box.y, labelWidth: run.labelWidths[i] },
					floorType,
				);
				rowX += run.widths[i] + cellGap;
			}
			return box;
		};
		const courseBox =
			courseRow === null
				? null
				: drawBandRow([courseRow], courseRow.label, COURSE_BAND);
		// #324's duel row, in the top band: shield pools and the heat lock, only
		// while a raider is contesting, dueling or selected.
		const duelRow = this.duelRowShown() ? duelRowCells(this.condition) : null;
		const duelBox =
			duelRow === null
				? null
				: drawBandRow(duelRow, DUEL_ROW_LABELS.join(" "), DUEL_BAND);
		// **The strip's own save, closed once for both runs.** It was closed at
		// the end of the cell loop until the course block was pasted in there
		// with a save/restore pair of its own, which read as the closing one —
		// so `ctx.save()` ran every frame with no match, pushing an entry onto
		// the 2D state stack and leaking `textAlign`, the value font and the
		// last cell's fill into every later draw on the overlay.
		ctx.restore();

		this.floorRender = {
			cells,
			boxes,
			// **Written by the draw, from what the draw drew.** `null` is the
			// row that was not painted, which is the state #117 D2 chose — and
			// a record assembled beside the draw would let a probe assert a
			// course row that never landed.
			courseRow,
			courseBox,
			duelRow,
			duelBox,
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
				jumpChargeLeftS: this.jumpCharge.leftS,
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
		// Derived from the floor's own bands rather than restated, so raising
		// the strip — or the course row #117 put above it — cannot leave this
		// line sitting on top of either. The course band is subtracted whether
		// or not a course is set: see `FLOOR_BANDS`.
		ctx.fillText(clearanceText, cx, floorTopY(h) - CLEARANCE_ABOVE_FLOOR_PX);
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
		// Written again below only if a raider is selected and drawn this frame.
		this.cueRender = null;
		this.selectedRender = null;
		this.hostileFireRender = { beam: null, rim: 0 };
		// §8 M4/M10: arrival and launch are scripted, and a docked ship is not
		// flyable. The forward station console owns the docked glass; no stale
		// flight-floor, scanner, director, or attitude marks may leak through it.
		if (this.view === "cockpit" && this.dock.phase !== "flying") {
			this.cockpitPrompt.reset();
			this.combatRig?.clearOverlay();
			this.directorRender = null;
			this.floorRender = null;
			return;
		}
		// A focused console replaces the forward glass. Leaving target brackets
		// here would make an HTML panel look like an accidental overlay rather
		// than the deliberate head-turn view the cockpit contract calls for.
		if (this.view === "cockpit" && this.headLook !== "forward") {
			this.cockpitPrompt.reset();
			this.combatRig?.clearOverlay();
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

		// #324 part d: cargo canisters, a small green diamond with the good and
		// range, so a pilot can find them after a kill. **Canisters that land
		// within a few pixels of each other share one marker.** A kill drops them
		// at one point, and at any range their labels printed over each other
		// into an unreadable smear on the first captured frame.
		const cargoMarks: { x: number; y: number; goods: string[]; km: number }[] =
			[];
		for (const canister of this.canisters) {
			// The selected canister is drawn by the marker loop below, with the
			// ring and the label every selected target gets. Drawing it here too
			// would put a diamond inside that ring.
			if (this.isSelectedTarget(canister.id)) continue;
			const dir = directionTo(camPos, canister.pos);
			const at = dir && place(dir);
			if (!at?.on) continue;
			const km = length(sub(canister.pos, camPos));
			const near = cargoMarks.find(
				(m) => Math.hypot(m.x - at.x, m.y - at.y) < 14,
			);
			if (near) {
				near.goods.push(canister.commodity);
				near.km = Math.min(near.km, km);
			} else
				cargoMarks.push({ x: at.x, y: at.y, goods: [canister.commodity], km });
		}
		ctx.strokeStyle = CARGO_CONTACT_CSS;
		ctx.fillStyle = CARGO_CONTACT_CSS;
		ctx.lineWidth = 1.5;
		ctx.font = "11px ui-monospace, Menlo, monospace";
		for (const mark of cargoMarks) {
			ctx.beginPath();
			ctx.moveTo(mark.x, mark.y - 6);
			ctx.lineTo(mark.x + 6, mark.y);
			ctx.lineTo(mark.x, mark.y + 6);
			ctx.lineTo(mark.x - 6, mark.y);
			ctx.closePath();
			ctx.stroke();
			const what =
				mark.goods.length === 1
					? mark.goods[0].toUpperCase()
					: `×${mark.goods.length}`;
			ctx.fillText(`CARGO ${what}  ${range(mark.km)}`, mark.x + 10, mark.y + 4);
		}
		// The production gun's tracer: on the glass in the cockpit, and over the
		// whole frame in chase, where there is no glass (sage #328 — a chase view
		// with no tracer is the dead-key defect again). The rig draws its own
		// below, and with the rig on the trigger never reaches this gun.
		// The raider's fire and its hits on the player (#324, found missing in
		// the second playtest): its beam from its point on the glass while it
		// fires, and a canopy rim for a moment after a hit lands.
		const glassBottom = this.view === "cockpit" ? GLASS_BOTTOM_FRACTION : 1;
		if (this.raiderFiring && this.raiderListed) {
			const toRaider = directionTo(camPos, this.raiderContact.pos);
			const raiderAt = toRaider && place(toRaider);
			if (raiderAt?.on) {
				// In the cockpit the player sits below the glass; in chase the hull
				// is on screen, and the beam ends on it (sage #330).
				const shipDir =
					this.view === "cockpit"
						? null
						: directionTo(camPos, this.world.ship.pos);
				const shipAt = shipDir && place(shipDir);
				const to = shipAt?.on
					? { x: shipAt.x, y: shipAt.y }
					: { x: w / 2, y: h * glassBottom };
				drawEnemyBeam(ctx, w, h, glassBottom, raiderAt, to);
				this.hostileFireRender.beam = {
					from: { x: raiderAt.x, y: raiderAt.y },
					to,
				};
			}
		}
		if (this.view === "cockpit") {
			const rim = this.struckFor / STRUCK_FLASH_S;
			drawStruckRim(ctx, w, h, glassBottom, rim);
			this.hostileFireRender.rim = Math.max(0, rim);
		}
		// The scoop's acknowledgement (#324). In **every** view, not only the
		// cockpit: the canister marker is drawn in both, so the event that
		// removes it has to be answered in both. It fades over its last stretch
		// rather than cutting, so a scoop reads as one event even when three
		// land within a few seconds of each other.
		if (this.scoop.left > 0 && this.scoop.text) {
			const alpha = Math.min(1, this.scoop.left / (SCOOP_NOTICE_S * 0.4));
			// §4's grammar: green confirms, red refuses. A full hold drawn in the
			// cargo green read as a successful scoop (sage #355).
			drawScoopNotice(ctx, w, h, glassBottom, {
				text: this.scoop.text,
				alpha,
				fill: this.scoop.accepted ? CARGO_CONTACT_CSS : FLOOR_TONE_FILL.refused,
			});
			this.scoopRender = {
				text: this.scoop.text,
				alpha,
				accepted: this.scoop.accepted,
			};
		} else this.scoopRender = null;
		// The gimballed beam's point on the glass (#324): the tracer ends there,
		// and while the gimbal has turned the beam off the boresight a small pip
		// shows where it points.
		const beam = this.beamAim();
		const beamAt = place(beam);
		const beamOnGlass = beamAt?.on
			? { x: beamAt.x / w, y: beamAt.y / h }
			: null;
		if (
			beamAt?.on &&
			angleBetween(beam, this.weaponAim()) > 0.2 * (Math.PI / 180)
		) {
			ctx.strokeStyle = "rgba(116, 234, 255, 0.9)";
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(beamAt.x, beamAt.y, 5, 0, Math.PI * 2);
			ctx.stroke();
		}
		if (this.gunFeedback.tracerLeftS > 0)
			drawGunTracer(ctx, w, h, glassBottom, beamOnGlass ?? undefined);
		this.combatRig?.drawTracer(ctx, w, h, this.view, GLASS_BOTTOM_FRACTION);
		// Not folded into the call above: outgoing fire is gated on the trigger
		// being held and incoming fire is not, and a player being shot while not
		// shooting back is the case that needs telling about most.
		this.combatRig?.drawStruck(ctx, w, h, this.view, GLASS_BOTTOM_FRACTION);

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
			// **Above the floor's bands, derived from them.** This was `h * 0.62`,
			// which at the shipped glass bottom of `h * 0.66` is a gap of 0.04h —
			// 36 px at 900, or the strip's own 26 plus ten. §5.1 already says the
			// strip draws "below the cruise prompt", so the prompt is anchored to
			// the floor and was merely spelled as a fraction that happened to
			// clear it. #117's course row went into that gap and the two drew on
			// top of each other: `COURSE ERBILE 6 jumps` and "press ` to jump to
			// ERBILE" on one baseline, both centred. No probe row saw it — the
			// record each writes is perfectly correct — and it was obvious in the
			// first captured frame.
			const y = floorTopY(h) - PROMPT_ABOVE_FLOOR_PX;
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
		this.combatRig?.drawOverlay(ctx, w, h, this.view);

		// The selected target owns the amber sky marker. Green remains prograde,
		// and the other bodies stay cool blue navigation context.
		ctx.font = "11px ui-monospace, Menlo, monospace";
		this.markerLabels.beginFrame(this.world.gameTime);
		const labelBounds = (
			x: number,
			y: number,
			text: string,
		): MarkerLabelBounds => ({
			left: x - 3,
			top: y - 12,
			right: x + ctx.measureText(text).width + 3,
			bottom: y + 5,
		});
		const occupiedLabels: MarkerLabelBounds[] = [];
		const selectedBody = this.targetBody();
		const selectedDir = selectedBody && directionTo(camPos, selectedBody.pos);
		const selectedAt = selectedDir && place(selectedDir);
		// **#324's firing cue is the selected target's own marker**, not a second
		// aiming language (§3). A raider's ring and edge arrow take the duel tone
		// — amber, red while it fires — and an on-target mark when a shot along
		// the sightline would land now. The laser is a ray, so that is the whole
		// of a firing solution: there is no lead to draw.
		//
		// **Only in the duel.** The raider is selectable from the contest on, but
		// `stepEncounter` flies `stepDuel` in the duel phase alone, so a mark in
		// the contest would promise a shot that does nothing.
		const raiderSelected = selectedBody !== null && this.raiderSelected();
		const raiderTone = raiderCueTone(this.raiderFiring);
		const selectedColour = raiderSelected
			? FLOOR_TONE_FILL[raiderTone]
			: "rgba(255, 214, 120, 0.95)";
		// The relay earns the mark whenever a shot would land (#43): it has no
		// phases, and `stepRelay` lands the shot in every one of them.
		const relaySelected = selectedBody !== null && this.relaySelected();
		const onTarget =
			(raiderSelected &&
				onTargetMark(
					this.encounter?.phase ?? null,
					raiderInSights(camPos, this.beamAim(), selectedBody.pos),
				)) ||
			(relaySelected &&
				relayInSights(camPos, this.beamAim(), selectedBody.pos)) ||
			// An ordinary carrier (civilian-combat H3) earns it as the relay does:
			// `stepTrafficEngagements` lands a shot whenever this test passes.
			(selectedBody !== null && this.trafficOnTarget(camPos, selectedBody));
		// Built once, because the declutter reservation and the paint must agree.
		const selectedLabel = (name: string, km: number) =>
			`${name}  ${range(km)}${onTarget ? "  ON TARGET" : ""}`;
		if (raiderSelected)
			this.cueRender = {
				tone: raiderTone,
				onTarget,
				at: selectedAt?.on ? { x: selectedAt.x, y: selectedAt.y } : null,
				enemyLine:
					selectedAt?.on && this.encounter?.raider
						? targetConditionLine(this.encounter.raider.condition).text
						: null,
			};
		// Reserve the selected label before the stable station/ship walk below.
		// Its label is never submitted to decluttering, so context can disappear
		// behind it but it can never disappear behind context.
		if (selectedBody && selectedAt?.on) {
			const text = selectedLabel(
				selectedBody.name,
				length(sub(selectedBody.pos, camPos)),
			);
			occupiedLabels.push(
				labelBounds(selectedAt.x + 20, selectedAt.y + 4, text),
			);
		}
		for (const body of this.selectable()) {
			const dir = directionTo(camPos, body.pos);
			if (!dir) continue;
			const selected = this.isSelectedTarget(body.id);
			// An unselected canister keeps the clustered green diamond above: a
			// kill drops them at one point, and brackets on each would be the
			// smear that clustering was added to stop.
			if (body.kind === "cargo" && !selected) continue;
			const at = place(dir);
			if (at?.on) {
				const r = selected ? 14 : 7;
				ctx.strokeStyle = selected
					? selectedColour
					: "rgba(140, 190, 220, 0.4)";
				ctx.lineWidth = selected ? 1.5 : 1;
				if (selected) {
					ctx.beginPath();
					ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
					ctx.stroke();
					const km = length(sub(body.pos, camPos));
					ctx.fillStyle = selectedColour;
					if (onTarget) {
						// A filled centre: a shot along the sightline lands now.
						ctx.beginPath();
						ctx.arc(at.x, at.y, 4, 0, Math.PI * 2);
						ctx.fill();
					}
					const label = selectedLabel(body.name, km);
					ctx.fillText(label, at.x + r + 6, at.y + 4);
					this.selectedRender = { id: body.id, text: label, onTarget };
					// The selected raider's shields and hull under its name (#324,
					// the principal's ruling), in the duel row's tones.
					const enemy = raiderSelected
						? this.encounter?.raider?.condition
						: undefined;
					if (enemy) {
						const line = targetConditionLine(enemy);
						ctx.fillStyle = FLOOR_TONE_FILL[line.tone];
						ctx.fillText(line.text, at.x + r + 6, at.y + 18);
						ctx.fillStyle = selectedColour;
					}
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
				if (
					body.kind === "station" ||
					body.kind === "ship" ||
					body.kind === "relay"
				) {
					const km = length(sub(body.pos, camPos));
					const text = `${body.name}  ${range(km)}`;
					const x = at.x + r + 6;
					const y = at.y + 4;
					const bounds = labelBounds(x, y, text);
					if (
						bounds.right > w ||
						bounds.top < 0 ||
						bounds.bottom > h ||
						!this.markerLabels.claim(
							body.id,
							bounds,
							occupiedLabels,
							this.world.gameTime,
						)
					)
						continue;
					ctx.fillStyle = "rgba(140, 190, 220, 0.55)";
					ctx.fillText(text, x, y);
				}
				continue;
			}
			if (!selected) continue;
			const edge = edgeOf(dir, this.orientation, EDGE_MARGIN);
			const p = toPixels(edge.ndcX, edge.ndcY);
			ctx.save();
			ctx.translate(p.x, p.y);
			ctx.rotate(-edge.angleRad);
			ctx.fillStyle = selectedColour;
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
		const scale = this.effectiveRenderScale();
		this.appliedRenderScale = scale;
		const ratio = Math.min(window.devicePixelRatio, 2) * scale;
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
		// #207's bands are in **CSS** pixels, so this is the CSS height and not
		// the drawing buffer's — see `relief-bands.ts` for why a resolution
		// setting must not be able to change what the surface looks like. Every
		// camera shares one field of view, so one focal length serves all four.
		this.focalPx = focalPx(h, this.nearCamera.fov);
		this.renderer.setSize(w, h);
		this.composer.setSize(w, h);
		// **After** the composer, not before. `EffectComposer.setSize` calls
		// `setSize` on every pass it holds, so bloom's own resolution has to be
		// re-applied afterwards or it is immediately overwritten with the full
		// drawing buffer — which is what the first version of this did, and the
		// mip chain went on being built at 451x321, 113x81, 57x41.
		const bloom = bloomResolution();
		this.bloomPass?.setSize(bloom.x, bloom.y);
		// **The same trap, and it is why this line is here rather than absent.**
		// `EffectComposer.setSize` calls `setSize` on every pass it holds, so an
		// AO pass sized at construction is resized to the full drawing buffer by
		// the first resize — and boot calls `onResize` once, so it would never
		// have run at a half in the first place.
		const ao = aoResolution(ratio);
		this.gtaoPass?.setSize(ao.x, ao.y);
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
/**
 * The ambient-occlusion pass's own size, as `bloomResolution` is bloom's.
 *
 * A fraction of the **drawing buffer**, which is why the ratio is an argument
 * rather than read here: it follows the device pixel ratio *and* the player's
 * `renderScale`, the way every other per-fragment cost does. Sized off
 * `window.innerWidth` alone the pass would run at a quarter of its intended
 * share on a retina panel. The fraction and the measurements behind it live in
 * `occlusion.ts`.
 *
 * Floored at one pixel rather than at bloom's 32: this pass builds no mip
 * chain, so there is no halving for an odd size to break.
 */
function aoResolution(pixelRatio: number) {
	return new THREE.Vector2(window.innerWidth, window.innerHeight)
		.multiplyScalar(pixelRatio * OCCLUSION.ao.resolutionScale)
		.round()
		.max(new THREE.Vector2(1, 1));
}

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
 * `?seed=` when it is usable, and `null` when it is absent or not a number —
 * which is what `?seed`'s set-aside and New game's pre-fill ask (§11.6). A
 * random seed standing in for an unusable one would set a Commander aside for a
 * world nobody asked for.
 *
 * The emptiness test cannot be dropped in favour of `Number()` alone:
 * `Number("")` and `Number("   ")` are both 0, so `?seed=` would pin world 0
 * rather than reject the request.
 */
function querySeed(): number | null {
	const raw = new URLSearchParams(window.location.search).get("seed");
	if (raw === null) return null;
	const pinned = Number(raw);
	if (raw.trim() !== "" && Number.isFinite(pinned))
		return Math.abs(Math.trunc(pinned)) >>> 0;
	console.warn(`[seelite] ignoring unusable ?seed=${JSON.stringify(raw)}`);
	return null;
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
	// #89's store and §11's boot around it. The load is a constructor arm
	// rather than a method (see `Game`'s constructor), so the save has to be
	// read first — which is why this boot awaits IndexedDB rather than handing
	// the game a store to fill in later.
	//
	// **The decisions are `commander-flow.ts`'s, and this block carries them
	// out.** This file cannot run under bun, so the one-shot continue, the
	// pending new game, the pointer's fallback and `?seed`'s set-aside live
	// where `tests/commander-flow.test.ts` reaches them. What is left here is
	// what only a page has: the `Game`, the held clock, `pagehide` and the
	// reload.
	//
	// **A failure to open or parse never blocks the boot.** D9: the player is
	// told which Commander failed and why, the bad record is left exactly where
	// it is so it can still be exported, and the game starts fresh rather than
	// refusing to start at all.
	//
	// **An explicit `?seed=` outranks a save under `?boot=direct`, and it does
	// not delete one.** Once any save existed at an origin, every later
	// `?seed=N` visit booted somebody else's galaxy with nothing said, so a
	// direct boot sets the Commander aside. Without direct the overlay asks
	// which world is wanted, and the seed only pre-fills New game (§11.6).
	const boot = bootMode(query);
	const noSave = query.has("no-save");
	// Fixture progress and payments use an entirely separate Commander catalog.
	// The production build cannot enable fixtures by adding a URL flag.
	const fixtureTrial = import.meta.env.DEV && query.has("requests-prototype");
	const saveBackend = indexedDbSaveBackend(
		indexedDB,
		fixtureTrial ? "seelite-requests-prototype-saves" : undefined,
	);
	const saveLocks = webSlotLocks(
		navigator.locks,
		fixtureTrial ? "seelite-requests-prototype:" : undefined,
	);
	// Read once: an unusable `?seed` warns as it is read.
	const askedSeed = querySeed();
	const catalog = new CommanderCatalog({
		backend: saveBackend,
		locks: saveLocks,
		allowRequestsPrototype: fixtureTrial,
	});
	let plan = await planBoot({
		catalog,
		backend: saveBackend,
		boot,
		noSave,
		querySeed: askedSeed,
	});
	for (const line of [plan.fault, plan.notice])
		if (line !== null) console.warn(`save: ${line}`);
	// **Inside the same fallback as the parse.** The comment above promises a
	// failure never blocks the boot, and for a round `new Game(seed, loaded)`
	// sat outside the guard: a record that parsed and then would not restore
	// threw at module scope and the page did not boot at all. The bounds in
	// `parseCommander` close the known route in; this closes the class.
	const worldSeed = plan.pending?.seed ?? askedSeed ?? randomSeed();
	let game: Game;
	try {
		game = new Game(worldSeed, plan.loaded);
	} catch (error) {
		console.error("save: the loaded save would not restore", error);
		plan = withRestoreFault(plan, error);
		game = new Game(worldSeed, null);
	}
	// Held until a store is attached or the player chooses (§11.2 step 4).
	game.clockHeld = true;
	game.saveFault = plan.fault;
	/** The Commander this tab's store writes, once one is attached. */
	let attachedSlot: string | null = null;
	// **D9's one promise: the bad record is never overwritten**, and §11.2
	// step 5 extends it to every boot: no store is attached to a Commander
	// nobody chose. A store attached to a record that refused would write over
	// it on the first dirty event, and that record is the only copy of
	// whatever is left. So the boot attaches only on a plan with no fault, and
	// `attachCommander` wires a store only once its lock is held (§11.3).
	const attach = async (slot: string): Promise<string | null> => {
		const pending = pendingFor(plan, slot);
		const result = await attachCommander({
			slot,
			catalog,
			backend: saveBackend,
			bootRecord: plan.record,
			pending,
			makeStore: (name) =>
				new SaveStore({
					backend: saveBackend,
					locks: saveLocks,
					allowRequestsPrototype: fixtureTrial,
					slot: name,
					schedule: (fn, ms) => {
						const id = window.setTimeout(fn, ms);
						return () => window.clearTimeout(id);
					},
					current: () => game.saveEnvelope(),
					// A debounced write has no caller to reject to. The store raises
					// the badge at `SAVE_RETRY_LIMIT` (§11.5); this is the log line.
					// **Not `saveFault`**: one field written by every failure named a
					// write that had since landed (sage, #311 round 1).
					onWriteFailed: (error, consecutive) => {
						if (consecutive === 1 || consecutive >= SAVE_RETRY_LIMIT)
							console.error(`save: ${writeFault(consecutive, error)}`, error);
					},
				}),
			onHeld: (store) => {
				game.saveStore = store;
				attachedSlot = slot;
				// D4's quit flush. `pagehide` and not `beforeunload`: the latter
				// does not fire on a mobile tab kill, and a persisted page is
				// frozen rather than gone. **There is no death flush beside it** —
				// #89 leaves that window open deliberately.
				window.addEventListener("pagehide", () => game.saveFlush("quit"));
				// **Chosen at new game, and only at new game** (#89's D7).
				// **After the store, not before it**: `choosePermadeath` marks the save
				// dirty, and with no store the mark is dropped.
				if (permadeathAtAttach(plan, slot, query.has("permadeath")))
					game.choosePermadeath();
			},
		});
		if (result.stale) {
			// **Another tab saved this Commander after this page read it.** The game
			// on this page is the older world, so it is not continued: the reload
			// builds the game from the save, and the one-shot skips the overlay the
			// player just answered. `attachCommander` gave the lock back first.
			try {
				await catalog.chooseCommander(slot);
			} catch (error) {
				return messageOf(error);
			}
			window.location.reload();
			return new Promise<never>(() => {});
		}
		// Every result, not only a fault: a lock fault from a one-shot boot is
		// stale once a later Continue attaches.
		game.saveFault = result.fault;
		if (result.fault !== null) console.warn(`save: ${result.fault}`);
		return result.attached ? null : result.fault;
	};
	// **A death (#324, the principal's ruling O5).** With a store attached and a
	// commander who is not permadeath, the last dock is copied over `live`, the
	// one-shot continue names the Commander, and the page reloads into the dock.
	// Otherwise — permadeath, `?no-save`, or a restore that failed — the ship
	// stays destroyed and the Commander overlay opens.
	game.onDeath = async () => {
		const store = game.saveStore;
		const slot = attachedSlot;
		try {
			const restored =
				store && slot
					? await store.revertToLastDocked(game.commanderRecord())
					: null;
			if (restored && slot) {
				await catalog.chooseCommander(slot);
				window.location.reload();
				return;
			}
		} catch (error) {
			console.error("save: the last dock could not be restored", error);
			game.saveFault = messageOf(error);
		}
		game.commanderOverlay?.open();
	};
	let openAtBoot = plan.mode === "overlay";
	if (plan.mode === "direct") {
		if (!noSave && plan.fault === null) await attach(plan.slot);
		game.clockHeld = false;
	} else if (plan.mode === "continue") {
		// §11.3: a one-shot whose Commander another tab took in the meantime is
		// discarded, and the overlay opens with that fault.
		const fault = await attach(plan.slot);
		if (fault === null) game.clockHeld = false;
		else {
			plan = withLockFault(plan, fault);
			openAtBoot = true;
		}
	}
	game.commanderOverlay = mountCommanderOverlay({
		catalog: noSave ? null : catalog,
		switcher: noSave
			? null
			: new CommanderSwitch({
					catalog,
					store: () => game.saveStore,
					reload: () => window.location.reload(),
				}),
		boot: {
			slot: plan.slot,
			canContinue: plan.canContinue,
			pendingName: plan.pending?.name ?? null,
			fault: plan.fault,
			faultSlot: plan.faultSlot,
			notice: plan.notice,
			seedPrefill: plan.seedPrefill,
		},
		openAtBoot,
		inPlay: () => attachedSlot,
		// The badge's own reader, so the two cannot disagree.
		fault: () => game.saveFaultText(),
		onContinue: async (slot) => {
			// **A dead page never resumes** (#324, sage round 1). After a death
			// with nothing to restore, Continue reloads and the boot loads the
			// Commander from its save — unholding the clock here would fly a hull
			// at zero that can never die again. The store's own lock goes back
			// first, or the one-shot below is refused by this very tab.
			if (game.dead) {
				if (!noSave) {
					game.saveStore?.release();
					try {
						await catalog.chooseCommander(slot);
					} catch (error) {
						return messageOf(error);
					}
				}
				window.location.reload();
				return null;
			}
			const fault = noSave ? null : await attach(slot);
			if (fault === null) game.clockHeld = false;
			return fault;
		},
		releaseHeldKeys: () => game.releaseHeldKeys(),
	});
	game.saveBadge = mountSaveBadge(() => game.commanderOverlay?.open());
	// The handle probes and the browser console reach the game through. Everything
	// a probe needs to assert on has to be reachable from here, or the probe ends
	// up asserting on pixels for want of a number.
	(window as unknown as { __seelite: Game }).__seelite = game;
	// Read off the page by `scripts/probe-save.mjs` rather than restated there:
	// a probe with its own copy of the debounce goes falsely red the day the
	// module moves it.
	(
		window as unknown as {
			__seelite: { save: Record<string, unknown> };
		}
	).__seelite.save = {
		debounceMs: SAVE_DEBOUNCE_MS,
		retryLimit: SAVE_RETRY_LIMIT,
		dbName: SAVE_DB_NAME,
		dbVersion: SAVE_DB_VERSION,
		storeName: SAVE_STORE_NAME,
		pointerStoreName: SAVE_POINTER_STORE_NAME,
		blockedMessage: SAVE_BLOCKED_MESSAGE,
		closedMessage: SAVE_CLOSED_MESSAGE,
		defaultSlot: DEFAULT_SLOT,
		backend: saveBackend,
		// The module function, not a method on the game: a probe that wants a
		// blob at a chosen size needs the serializer, and adding a "give me a
		// big save" method to `Game` would be production state existing for one
		// caller.
		serialize: serializeSave,
	};
	// The spread's own law, for `probe-station-console.mjs`. The shared helper, not an
	// inline assignment: the designer gallery renders a market too and the probe visits
	// both, so the hook has to exist on both entries.
	exposeMarketLaw();
	// The boot mode this page read (#306, `persistent-world-state.md` §11.6).
	// Exposed so `probe-boot.mjs` can show that `gameUrl`'s `?boot=direct`
	// reached the page rather than being assumed to.
	(window as unknown as { __seelite: { boot: BootMode } }).__seelite.boot =
		boot;
	// The Commander boot as the plan decided it, and the overlay's handle, for
	// `probe-commander.mjs` — read off the page rather than inferred from the DOM.
	// **Not `commander`**: `__seelite` is the `Game`, and that name is its
	// commerce state, which a handle assigned over it would silently replace.
	(
		window as unknown as {
			__seelite: { commanderBoot: Record<string, unknown> };
		}
	).__seelite.commanderBoot = {
		key: COMMANDER_KEY,
		mode: plan.mode,
		slot: plan.slot,
		fault: plan.fault,
		overlay: game.commanderOverlay,
		catalog,
		attached: () => attachedSlot,
		clockHeld: () => game.clockHeld,
	};

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
	import("./settings-panel").then(({ mountSettingsPanel }) => {
		// Held on the game so the pad can drive the cursor the screen already
		// has (#283). The screen keeps owning the keyboard in the capture phase;
		// this is a second way in rather than a replacement.
		game.settingsPanel = mountSettingsPanel(
			game.settings,
			() => game.releaseHeldKeys(),
			// What the antialiasing row is *actually* rendering at, when the GPU
			// grants less than the player asked for (#200). Without this the row
			// reads "4x" on a machine giving 2x or none, which is a setting that
			// lies about itself — and the clamp exists precisely because the
			// alternative to granting less is a black frame.
			(key, value) => {
				// #352's Auto shares this column with #200's antialiasing, and
				// for the same reason: a row that says "Auto" and nothing else
				// is a setting that will not tell the player what it did. The
				// rung is the answer to the question they are asking when they
				// open this screen over a planet.
				if (key === "renderScale" && value === "auto") {
					const diagnostics = game.adaptiveDiagnostics();
					if (!diagnostics) return null;
					return `${Math.round(diagnostics.scale * 100)}% now`;
				}
				if (key !== "antialias" || value === 0) return null;
				const got = grantedSamples(game.renderer, value as number);
				return got === value
					? null
					: got === 0
						? "unsupported here"
						: `${got}x here`;
			},
		);
	});

	if (query.has("perf"))
		import("./perf-panel").then(async ({ mountPerfPanel }) => {
			const attribution = await game.enableFrameAttribution();
			if (!attribution) return;
			const perf = mountPerfPanel({
				scenes: [game.nearScene, game.approachScene, game.farScene],
				bloom: game.bloom,
				attribution,
				occlusion: () => game.occlusionState,
				adaptive: () => game.adaptiveDiagnostics(),
			});
			if (!perf) return;
			// Held on the game so d-pad down can hand the pad to the instrument
			// and take it back (#283). `?perf` is the only route to one, so the
			// field is null for every player.
			game.perfPanel = perf;
			let tornDown = false;
			const teardown = (event: PageTransitionEvent) => {
				// A persisted page is frozen, not gone. Keep its diagnostic ownership
				// intact so it resumes with the rest of the BFCache document.
				if (event.persisted) return;
				if (tornDown) return;
				tornDown = true;
				perf.unmount();
				game.perfPanel = null;
				game.disableFrameAttribution();
			};
			window.addEventListener("pagehide", teardown);
		});
}

export type { Game };
