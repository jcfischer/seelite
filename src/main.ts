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
import { AudioFX } from "./audio";
import {
	CHARGE_CAPACITY_AU,
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
import { SPIN_RPM_RANGE } from "./station";
import { buildStationMesh } from "./station-mesh";
import { type WarpField, warpField } from "./warp";
import { type Vec3, add, dot, length, scale, sub, v3 } from "./vec3";
// One path to `./units`, deliberately. Keeping a namespace import beside a named
// one would let this file reach `FAR_SCALE` and `units.FAR_SCALE` as separate
// spellings of the same constant — the two-public-paths pattern this branch
// removed from `sim.ts` and pinned with a source-scan test.
import * as units from "./units";

/** Scratch vectors for aiming a station's aperture, allocated once: the render
 *  loop runs per body per frame, and a `Vector3` built there is garbage by the
 *  time it is read — the same trade `vec3.ts` names for `Vec3`. */
const MESH_AXIS = new THREE.Vector3(0, 0, 1);
const STATION_AXIS = new THREE.Vector3();

const {
	AU_KM,
	BACKDROP_RADIUS,
	C_KMS,
	MAX_DT,
	FAR_FAR_UNITS,
	FAR_NEAR_UNITS,
	FAR_SCALE,
	NEAR_FAR_KM,
	NEAR_NEAR_KM,
	layerFor,
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
 * Mouse sensitivity: radians of rotation per pixel of pointer movement.
 *
 * Relative deltas under pointer lock rather than an absolute virtual stick,
 * which is what "like E:D" means in practice for mouse: the pointer has no
 * position to return to, so the ship holds an attitude when the hand stops
 * rather than springing back to centre.
 */
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

/** How far inside the viewport an off-screen target arrow sits, as a fraction
 *  of the half-width. */
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
 * The `cruise.ts` functions a probe may call through `window.__seelite`.
 *
 * Declared rather than inferred from the object literal, so adding one is an
 * edit to a named surface rather than an append. The admission test: a pure
 * function already exported from `cruise.ts` whose rule a probe would otherwise
 * restate. Anything that reads or writes game state does not belong here.
 */
interface ProbeGeometry {
	closestApproachKm: typeof closestApproachKm;
}

class Game {
	readonly world: World;
	readonly renderer: THREE.WebGLRenderer;
	readonly composer: EffectComposer;

	/** Background: stars only, no depth, re-centred on the camera each frame. */
	readonly backdropScene = new THREE.Scene();
	/** Far: system bodies at `FAR_SCALE`, angular size preserved. */
	readonly farScene = new THREE.Scene();
	/** Near: ships, stations, anything at 1:1 kilometres. */
	readonly nearScene = new THREE.Scene();

	readonly backdropCamera: THREE.PerspectiveCamera;
	readonly farCamera: THREE.PerspectiveCamera;
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
	/** The rotating part of each station, and the phase it is currently drawn
	 *  at. The phase comes from `stationPose` in sim; nothing reads it back off
	 *  the `Object3D` (`docking.md` §4.1). */
	private readonly stationSpinners = new Map<string, THREE.Object3D>();
	/**
	 * Which layer each body is currently drawn in.
	 *
	 * Held rather than recomputed from the scene graph, because reading it back
	 * out of an `Object3D` is exactly what rule 2 above forbids — and because the
	 * hysteresis makes the answer depend on the previous frame, which the scene
	 * graph does not record.
	 */
	private readonly layers = new Map<string, "near" | "far">();
	private shipMesh!: THREE.Mesh;
	private stars!: THREE.Points;
	private starMaterial!: THREE.ShaderMaterial;

	private readonly keys = new Set<string>();
	readonly audio = new AudioFX();
	private throttle = 0;

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
	/** The last time-to-target estimate, and the clock value it was made at. */
	private etaCache: number | null = null;
	private etaAt = Number.NEGATIVE_INFINITY;
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

	/** Probe-callable cruise geometry, kept separate from the constant handles:
	 *  a constant can be diffed and versioned, exported arithmetic cannot. */
	readonly geometry: ProbeGeometry = { closestApproachKm };

	/** §4's spin range, reachable from the handle for the same reason: the spin
	 *  probe drives a station to both ends of it, and a probe that restated
	 *  0.6 and 3.0 would assert against its own copy. */
	readonly spinRange = SPIN_RPM_RANGE;

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

	constructor(seed: number) {
		this.world = makeWorld(seed);
		this.faceTheStar();

		this.renderer = new THREE.WebGLRenderer({
			antialias: true,
			powerPreference: "high-performance",
		});
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
		this.nearCamera = new THREE.PerspectiveCamera(
			fov,
			aspect,
			NEAR_NEAR_KM,
			NEAR_FAR_KM,
		);

		this.buildBackdrop();
		this.buildBodies();
		this.buildShip();
		this.warp = warpField(this.world.seed);
		this.nearScene.add(this.warp.object);
		// Something is selected on frame one. §6 makes selection a convenience
		// rather than a rail, but a cruise panel with an empty target field on
		// boot reads as broken, and the nearest station is what a ship at the
		// arrival point is there to reach.
		this.targetId = this.nearestOfKind("station")?.id ?? null;

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
		const nearPass = new RenderPass(this.nearScene, this.nearCamera);
		nearPass.clear = false;
		nearPass.clearDepth = true;
		this.composer.addPass(backdropPass);
		this.composer.addPass(farPass);
		this.composer.addPass(nearPass);
		this.composer.addPass(
			new UnrealBloomPass(
				new THREE.Vector2(window.innerWidth, window.innerHeight),
				0.55,
				0.6,
				0.85,
			),
		);
		this.composer.addPass(new OutputPass());

		this.overlay = document.getElementById("overlay") as HTMLCanvasElement;
		this.overlayCtx = this.overlay.getContext("2d") as CanvasRenderingContext2D;
		// Sized **here** as well as on resize: a canvas that has never seen a
		// resize event keeps its 300x150 default, and every marker lands inside
		// that box in the top-left corner while the CSS stretches nothing.
		this.sizeOverlay();
		this.hud = document.getElementById("hud") as HTMLElement;
		window.addEventListener("resize", () => this.onResize());
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

	private buildBodies() {
		// One unit sphere, shared by every body, sized per body with `mesh.scale`.
		//
		// Not a memory saving — it is what makes the handoff a scale assignment
		// rather than a geometry rebuild. Baking the radius into the geometry means
		// a body crossing `HANDOFF_KM` has to be re-tessellated at the new scale
		// mid-flight, which allocates on the frame the player is most likely to be
		// looking at the thing.
		const unitSphere = new THREE.SphereGeometry(1, 32, 16);
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
				this.stationSpinners.set(body.id, built.spinner);
			} else {
				const material =
					body.kind === "star"
						? new THREE.MeshBasicMaterial({ color: body.color })
						: new THREE.MeshStandardMaterial({
								color: body.color,
								roughness: 0.9,
								metalness: 0.0,
							});
				mesh = new THREE.Mesh(unitSphere, material);
			}
			mesh.name = body.id;
			this.meshes.set(body.id, mesh);
			// Everything starts far. The arrival point is 1 AU from the star and a
			// real crossing from every station, so this is the truth on frame one
			// rather than a default — and `render` corrects it before the first draw
			// in any case.
			this.setLayer(body, "far");
		}

		// One light per layer, both standing in for the same star. A single light
		// cannot serve two scenes at two scales — a `PointLight` at the far
		// layer's star position is 1,500 units away there and 1.5·10⁸ km away
		// here, and its falloff would be wrong in whichever scene it was not
		// authored for. Directional light sidesteps that: it has no position, only
		// a direction, and the direction is the same in both.
		for (const scene of [this.farScene, this.nearScene]) {
			const sun = new THREE.DirectionalLight(0xfff0d8, 3.0);
			sun.name = "sun";
			scene.add(sun);
			// A little ambient, so an unlit hull is dark rather than black. Space has
			// no ambient light; a screen with no detail in the shadows has no
			// information in it either.
			scene.add(new THREE.AmbientLight(0x223044, 0.6));
		}

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
		const fill = new THREE.DirectionalLight(0x9fb6d0, 0.9);
		fill.name = "fill";
		this.nearScene.add(fill);
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
	private setLayer(body: Body, layer: "near" | "far") {
		const mesh = this.meshes.get(body.id);
		if (!mesh) return;
		const k = layer === "near" ? 1 : FAR_SCALE;
		mesh.scale.setScalar(body.radiusKm * k);
		(layer === "near" ? this.nearScene : this.farScene).add(mesh);
		this.layers.set(body.id, layer);
	}

	private buildShip() {
		// A cube, 20 metres on a side, and honestly a cube — the ship roster is an
		// open decision and a placeholder that looked like a design would be worse
		// than one that plainly is not.
		const geometry = new THREE.BoxGeometry(0.02, 0.012, 0.03);
		const material = new THREE.MeshStandardMaterial({
			color: 0xc8ccd4,
			roughness: 0.45,
			metalness: 0.55,
		});
		this.shipMesh = new THREE.Mesh(geometry, material);
		this.shipMesh.name = "ship";
		this.nearScene.add(this.shipMesh);
	}

	private onKey(e: KeyboardEvent, down: boolean) {
		const key = e.key.toLowerCase();
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
			case "x":
				// #5's assist toggle. Not in force inside cruise (#10 §1), where the
				// regime is nose-locked — the state is kept and applied on exit.
				this.assist = !this.assist;
				return;
			case "v":
				this.view = this.view === "cockpit" ? "chase" : "cockpit";
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
		if (this.chargeAu <= 0)
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
		let best: Body | null = null;
		let bestKm = NEAR_FAR_KM;
		for (const b of this.world.system.bodies) {
			const km = length(sub(b.pos, this.world.ship.pos));
			if (km < bestKm) {
				best = b;
				bestKm = km;
			}
		}
		return best
			? bodyVelocity(this.world.system, best.id, this.world.gameTime)
			: v3();
	}

	/** The nose, as a sim-space unit vector. In cruise this *is* the direction of
	 *  travel (§1). */
	private nose() {
		const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation);
		return v3(f.x, f.y, f.z);
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
		if (!target) return null;
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
				vel: this.targetVelocity(),
			},
			this.masses(),
			this.cruiseParams,
			this.regime === "cruise" ? this.throttle : 1,
		);
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
		const yaw = this.axis(["arrowright", "d"], ["arrowleft", "a"]);
		const pitch = this.axis(["arrowdown", "s"], ["arrowup", "w"]);
		const roll = this.axis(["e"], ["q"]);

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

		if (this.keys.has("shift")) this.throttle = Math.min(1, this.throttle + dt);
		if (this.keys.has("control"))
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

		// The whole world, not just the ship: `dt` is sim seconds and the bodies
		// are on orbits driven by the same clock. Stepping the ship alone would
		// freeze the system around it, which is the state the scaffold was in.
		stepWorld(this.world, this.control(), dt);
		// §7: the tank refills passively in normal flight, and that is the
		// anti-stranding rule rather than a convenience.
		this.chargeAu = chargeAfterRegen(this.chargeAu, dt);
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
		const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.orientation);
		return add(
			this.world.ship.pos,
			add(
				scale(v3(-forward.x, -forward.y, -forward.z), CHASE_BACK_KM),
				scale(v3(up.x, up.y, up.z), CHASE_UP_KM),
			),
		);
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

		// All three cameras share the ship's orientation and sit at the origin.
		for (const cam of [this.backdropCamera, this.farCamera, this.nearCamera]) {
			cam.position.set(0, 0, 0);
			cam.quaternion.copy(this.orientation);
		}
		// The star sphere follows the camera so it never parallaxes — which is
		// what makes it read as infinitely far away rather than as a small ball
		// the ship is inside. The camera being at the origin means this is a
		// no-op today; it is written out because the moment the camera stops
		// being pinned there, its absence is a bug that takes an hour to see.
		this.stars.position.copy(this.backdropCamera.position);

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
			const layer = layerFor(was, Math.hypot(dx, dy, dz));
			if (layer !== was) this.setLayer(body, layer);
			const k = layer === "near" ? 1 : FAR_SCALE;
			mesh.position.set(dx * k, dy * k, dz * k);

			// Stations are aimed and spun; everything else is a sphere and has no
			// orientation worth writing. Both numbers come from `stationPose` in
			// sim — the renderer mirrors the slot's phase rather than owning it
			// (`docking.md` §4.1), so a docking check never depends on frame
			// timing.
			const spinner = this.stationSpinners.get(body.id);
			if (spinner) {
				// Through the handle's own accessor, not a second copy of the same
				// argument triple: `poseOfStation` is documented as "the pose the
				// renderer is mirroring", and a probe asserting through it has to be
				// asserting the path the renderer actually takes.
				const pose = this.poseOfStation(body.id);
				// Local +Z is the aperture axis, which is the contract
				// `station-mesh.ts` is built to.
				STATION_AXIS.set(pose.axis.x, pose.axis.y, pose.axis.z);
				mesh.quaternion.setFromUnitVectors(MESH_AXIS, STATION_AXIS);
				spinner.rotation.z = pose.phaseRad;
			}
		}

		// The star also aims the light, in both scenes. Its direction is the same
		// at either scale, which is the property that let one light stand for two.
		const star = this.world.system.bodies.find((b) => b.kind === "star");
		if (star) {
			const toStar = sub(star.pos, camPos);
			const d = Math.max(1e-9, length(toStar));
			for (const scene of [this.farScene, this.nearScene]) {
				const sun = scene.getObjectByName("sun") as THREE.DirectionalLight;
				if (sun) sun.position.set(toStar.x / d, toStar.y / d, toStar.z / d);
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
		// The hull is the camera in cockpit view, and drawing a cube around the
		// near plane fills the screen with its inside faces.
		this.shipMesh.visible = this.view === "chase";

		this.composer.render();
		this.drawMarkers(camPos);
		this.frames++;
	}

	private animate = () => {
		requestAnimationFrame(this.animate);
		const now = performance.now();
		const dt = this.lastTime
			? Math.min(MAX_DT, (now - this.lastTime) / 1000)
			: 0;
		this.lastTime = now;
		if (dt > 0) this.step(dt);
		this.render(dt);
		this.updateHud();
	};

	private updateHud() {
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
		// The estimate integrates 64 samples of the speed law, and the readout it
		// feeds is quantised to tenths of a minute. Recomputing that every frame is
		// paying sixty times over for a number that cannot change that fast.
		if (gameTime - this.etaAt >= ETA_INTERVAL_S) {
			this.etaCache = this.timeToTarget();
			this.etaAt = gameTime;
		}
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

		// The prompt, on the glass rather than only in the corner: the mechanic it
		// names is the one the whole prototype is about, and the first flight of
		// this build was spent in normal flight watching a distance not change.
		const promptTarget = this.targetBody();
		const prompt = this.cruisePrompt(
			promptTarget ? length(sub(promptTarget.pos, camPos)) : null,
		);
		if (prompt) {
			ctx.font = "13px ui-monospace, Menlo, monospace";
			ctx.textAlign = "center";
			ctx.fillStyle = "rgba(255, 214, 120, 0.9)";
			ctx.fillText(prompt, w / 2, h * 0.62);
			ctx.textAlign = "left";
		}

		// Every selectable body gets a bracket, because "I have no idea where to
		// fly to" is answered by seeing the targets, not by naming one of
		// them in a text field.
		ctx.font = "11px ui-monospace, Menlo, monospace";
		for (const body of this.selectable()) {
			const dir = directionTo(camPos, body.pos);
			if (!dir) continue;
			const selected = body.id === this.targetId;
			const at = place(dir);
			if (at?.on) {
				const r = selected ? 13 : 7;
				ctx.strokeStyle = selected
					? "rgba(255, 214, 120, 0.95)"
					: "rgba(140, 190, 220, 0.4)";
				ctx.lineWidth = selected ? 1.5 : 1;
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
				if (selected || body.kind === "station") {
					const km = length(sub(body.pos, camPos));
					ctx.fillStyle = selected
						? "rgba(255, 214, 120, 0.95)"
						: "rgba(140, 190, 220, 0.55)";
					ctx.fillText(`${body.id}  ${range(km)}`, at.x + r + 6, at.y + 4);
				}
				continue;
			}
			// Off screen: only the selected target gets an arrow. Twelve of them
			// around the rim would be noise, and the question being answered is
			// "which way to the place I picked".
			if (!selected) continue;
			const e = edgeOf(dir, this.orientation, EDGE_MARGIN);
			const p = toPixels(e.ndcX, e.ndcY);
			ctx.save();
			ctx.translate(p.x, p.y);
			ctx.rotate(-e.angleRad);
			ctx.fillStyle = "rgba(255, 214, 120, 0.95)";
			ctx.beginPath();
			ctx.moveTo(11, 0);
			ctx.lineTo(-6, 6);
			ctx.lineTo(-6, -6);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
			const off = angleOffNose(dir, this.nose());
			ctx.fillStyle = "rgba(255, 214, 120, 0.8)";
			ctx.fillText(
				`${this.targetId}  ${((off * 180) / Math.PI).toFixed(0)}° off`,
				Math.min(w - 150, Math.max(10, p.x - 60)),
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

	private onResize() {
		const w = window.innerWidth;
		const h = window.innerHeight;
		this.sizeOverlay();
		for (const cam of [this.backdropCamera, this.farCamera, this.nearCamera]) {
			cam.aspect = w / h;
			cam.updateProjectionMatrix();
		}
		this.renderer.setSize(w, h);
		this.composer.setSize(w, h);
		this.starMaterial.uniforms.uPixelScale.value =
			this.renderer.domElement.height * STAR_PIXEL_SCALE;
	}
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
 * A distance in the unit that makes it readable: kilometres up close, AU once
 * the kilometre figure has stopped meaning anything to a human.
 *
 * The switch is at 0.01 AU with three decimals on each side, which is a
 * continuous readout: 1.5·10⁶ km reads as "0.010 AU", and one AU-step is
 * 1.5·10⁵ km against a last km-step of 0.1 km. An earlier version switched at
 * 1e5 km — 0.00067 AU — where three AU decimals cannot resolve anything: every
 * distance from 10⁵ to 2.2·10⁵ km displayed as the same "0.001 AU".
 */
const RANGE_AU_SWITCH_KM = 0.01 * AU_KM;

function range(km: number): string {
	return km < RANGE_AU_SWITCH_KM
		? `${km.toFixed(1)} km`
		: `${(km / AU_KM).toFixed(3)} AU`;
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

const game = new Game(seedFromQuery());
// The handle probes and the browser console reach the game through. Everything
// a probe needs to assert on has to be reachable from here, or the probe ends
// up asserting on pixels for want of a number.
(window as unknown as { __seelite: Game }).__seelite = game;

export type { Game };
