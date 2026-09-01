/**
 * THROWAWAY #48's combat prototype, as one removable thing.
 *
 * ## Why it is a file rather than eight guarded branches
 *
 * The rig used to live inside `Game`: ten fields, two meshes built in the
 * constructor, two keys in the command switch, a step branch, a render branch,
 * a resize hook, and the whole fitted-overlay block on the glass. Every one of
 * those sites sat in a production path behind an `if (combatPrototypeEnabled)`,
 * so removing the prototype — which is the *point* of a prototype — meant
 * surgery across code that has nothing to do with combat. #61 is that bill
 * coming due before #8's production combat lands and doubles it.
 *
 * The rig therefore owns everything the prototype touches: its scene objects,
 * its input mapping, its simulation step, its glass, and the hooks the browser
 * probe drives it with. `Game` reaches it through one nullable field.
 *
 * **What removal costs is a grep, not a number in a comment.** Two earlier
 * drafts of this paragraph put a figure here and both were wrong — the first
 * said "a file and a field" and undercounted by an order of magnitude, the
 * second gave a precise reference count that was off by two and omitted four
 * files. A frozen inventory in prose is a claim that rots on the next commit,
 * which is the failure this file is otherwise about. So:
 *
 * ```
 * rg -l 'combat' src tests scripts     # every file the prototype reaches
 * rg -c 'combatRig' src/main.ts scripts/probe-live-cockpit.mjs
 * ```
 *
 * That spans this file, `combat-prototype.ts` and its test, the boundary test,
 * the absence block in `probe-boot.mjs`, and the rig's references in
 * `probe-live-cockpit.mjs`. It is a lot more than a file and a field.
 *
 * **The claim worth making is about shape rather than size.** Every site in
 * `Game` is now a `?.` call on one nullable field, which the compiler finds and
 * a source scan can hold at zero (`tests/combat-rig-boundary.test.ts`). Before,
 * it was ten fields and eight guarded branches threaded through the
 * constructor, the command switch, the step, the render and two draw paths —
 * and nothing could hold that line, because there was no line to hold.
 *
 * ## What it is not
 *
 * It is not production combat and it couples to no world entity (#48). The
 * target is a renderer-only silhouette on a scripted bearing, never one of
 * #35's traffic actors, and the duel schedule is a function of elapsed time
 * rather than of aim — this rig measures *pacing*, and a claim that aim decides
 * hits would be false of it.
 *
 * ## Existence is the flag
 *
 * There is no `enabled` field. `Game` constructs a rig only for `?combat=1`, so
 * a normal flight holds `null` and every branch that used to test a boolean is
 * now a branch that does not exist. That is what makes the first acceptance
 * line — no allocation, no input interception, no chrome — checkable rather
 * than merely intended.
 */
import * as THREE from "three";
import {
	type CombatEnemyState,
	ENEMY_VISUAL_SCALE,
	PLAYER_LASER_RANGE_KM,
	createCombatEnemy,
	stepCombatEnemy,
} from "./combat-enemy";
import {
	type CombatPrototypeState,
	createCombatPrototype,
	stepCombatPrototype,
} from "./combat-prototype";
import { mix, seedFor } from "./rng";
import { buildShipMesh } from "./ship-mesh";
import type { Body, Ship } from "./sim";
import { PROMPT_FILL, PROMPT_FONT, TextRaster } from "./text-raster";
import { type Vec3, add, cross, length, scale, sub, v3 } from "./vec3";

/** The legend, and the widest text each status line is fitted against. */
const LEGEND =
	"COMBAT PROTOTYPE — hold SPACE pulse · LMB / X beam · / warning · Q ECM";
/**
 * `X`, not `S`.
 *
 * `S` is pitch-down. A beam bound to it meant every held shot also pushed the
 * nose off the thing being shot at, which on a *scripted* target was invisible
 * and on a flown one is the whole difficulty. `probe-live-cockpit.mjs` held the
 * old key for fifteen seconds and timed out rather than saying so.
 */
const BEAM_KEY = "x";

/**
 * Incoming fire, as bolts that travel.
 *
 * **A line drawn to the camera is invisible, and that is geometry rather than a
 * bug in the colour.** The first version ran a `THREE.Line` from the striker's
 * hull to the origin of the near scene — where the camera is — so both ends
 * projected to the same screen point and the tracer had no length to see.
 * Measured on a live fight: the striker fires on 247 frames of 704, the line
 * was `visible` on every one of them, and its far endpoint projected to `NaN`
 * because a point at the eye has no projection at all.
 *
 * So the shot is drawn as short segments moving through the world instead, and
 * they are aimed to pass *beside* the canopy rather than into it — a bolt that
 * arrived exactly at the eye would collapse to a point again on the last frame
 * of its flight, which is the same failure at the other end.
 *
 * **They are a rendering of the firing bit, not the damage.** `stepCombatPrototype`
 * takes shields and hull off per frame while `enemyFiring` is set, with no
 * flight time — it is a damage-per-second model, and #48 says so. A bolt that
 * leaves the striker now and passes the canopy a third of a second later is
 * therefore *late* against the damage it depicts, and nothing should be built
 * on the two agreeing. What the player is owed is the two facts the model does
 * have: that the striker is shooting, and that something is coming off.
 */
const BOLT_POOL = 32;
const BOLT_SPEED_KMS = 6;
const BOLT_LENGTH_KM = 0.16;
const BOLT_INTERVAL_S = 0.13;
/** How wide of the canopy a bolt is aimed, in kilometres. */
const BOLT_MISS_KM = 0.11;
/** A bolt is retired once it is this far past the point it was aimed at. */
const BOLT_OVERSHOOT_KM = 1.2;
/**
 * The head of a bolt, drawn at a floor in screen space.
 *
 * **The segment alone is not enough, and measuring said so.** A bolt on its way
 * to the canopy is pointed almost straight at the camera, so its length
 * foreshortens to nothing: over a 30 s fight, on-screen bolts measured 0.3
 * pixels long on approach and only reached 1709 as one whipped past. The streak
 * is the pass; the head is the approach, and without it the volley is invisible
 * for the whole of its flight and then briefly enormous.
 *
 * Same trick as the hulls' nav lights, and for the same reason: a point drawn
 * at a floor in screen space survives a range at which a physical size does not.
 */
const BOLT_HEAD_NEAR_PX = 10;
const BOLT_HEAD_MIN_PX = 3;
/**
 * Small, and it was 26.
 *
 * The scene runs through `UnrealBloomPass`, so a bright point does not stay the
 * size it is drawn: at 26 pixels and an intensity of 2.8 a single head bloomed
 * into a blob roughly two hundred pixels across, which hid the striker it was
 * being fired by. The bolt has to read as a bolt, not as a light source.
 */
const BOLT_HEAD_MAX_PX = 12;
const BOLT_HEAD_REF_KM = 0.6;
/** How long the canopy flashes after the model takes something off the player. */
const HIT_FLASH_S = 0.22;
/** The striker's intent rides on the target line: the status line has no room
 *  for it at the narrow viewport's fitter floor, and putting it there once
 *  displaced the MISSILE and INTD fields two probe assertions wait on. */
const WIDEST_TARGET =
	"TARGET  SHIELDS F 999  A 999  HULL 999 · AI ACQUIRE · HOSTILE PULSE";
const WIDEST_PLAYER = "PLAYER  SHIELDS F 999  A 999  HULL 999";
const WIDEST_STATUS =
	"FIRE LOCKED · H 100 E 100 · LOCK READY · MISSILE WARNING · INTD ACTIVE";

/**
 * The frame loop, as much of it as the rig is allowed to touch.
 *
 * **It stops the world, so only the rig may hold one.** `Game` builds it as an
 * inline literal at the rig's construction and keeps neither a field nor a
 * method — both are reachable through `window.__seelite`, because `private` is
 * erased at runtime and the instance is published whole. Two attempts got this
 * wrong in turn, a field and then a prototype method, before the closure.
 * `probe-boot.mjs` fails a default boot that exposes a loop control or any of
 * the names that have carried one; its docstring records the shape it still
 * cannot see.
 *
 * `probe-live-cockpit.mjs` uses it to compare tracer pixels against a fixed
 * simulation state. The mechanism is `Game`'s — it owns the
 * `requestAnimationFrame` handle — and the gate is the rig's existence.
 */
export interface LoopControl {
	freeze(): void;
	resume(): void;
}

export type CombatView = "cockpit" | "chase";

/**
 * The status line's text: a terminal verdict, or the live readout.
 *
 * Out of the draw because it is the one part of the overlay that is a decision
 * rather than a placement, and `probe-live-cockpit.mjs` asserts on the strings
 * it produces (`FIRE LOCKED`, `MISSILE WARNING`, `DUEL WON`) rather than on
 * pixels. `WIDEST_STATUS` is the bound every branch of it must fit inside.
 */
function statusText(s: CombatPrototypeState): string {
	if (s.playerHull <= 0) return "DUEL LOST";
	if (s.targetHull <= 0) return "DUEL WON";
	const fire = s.heatLocked ? "LOCKED" : (s.firing?.toUpperCase() ?? "SAFE");
	return `FIRE ${fire} · H ${s.heat.toFixed(0)} E ${s.energy.toFixed(0)} · LOCK ${s.missileLock ? "READY" : "ACQ"} · MISSILE ${s.incomingMissile ? "WARNING" : "CLEAR"} · INTD ${s.interdiction ? "ACTIVE" : "CLEAR"}`;
}

/** A direction, or the fallback when there is no direction to be had. */
const unit = (v: Vec3): Vec3 => {
	const magnitude = length(v);
	return magnitude === 0 ? v3(0, 0, -1) : scale(v, 1 / magnitude);
};

/** Scratch for the striker's attitude and impact point; reused every frame. */
const RIG_NOSE = new THREE.Vector3();
const RIG_UP = new THREE.Vector3();
const RIG_ORIGIN = new THREE.Vector3();
const RIG_ATTITUDE = new THREE.Matrix4();
const RIG_INVERSE = new THREE.Quaternion();
const RIG_IMPACT = new THREE.Vector3();

export class CombatPrototypeRig {
	/** Throwaway #48 balance state: it is not world or persistent combat state. */
	state: CombatPrototypeState = createCombatPrototype();
	/** Prototype-only glass status, exposed for the browser probe. */
	readonly overlayStatus = new TextRaster();
	/** The overlay lines drawn last frame, at the font each was fitted to. */
	overlayLines: { text: string; font: string; width: number }[] = [];
	/** The fitted width of the widest status text at the current glass width. */
	statusWorstWidth = 0;
	/** Probe-only laser visibility override; the renderer honours it. */
	forceLaserHidden = false;

	/**
	 * #53's flown striker.
	 *
	 * It replaces the scripted bearing this rig used to place the target on.
	 * That bearing was two sines and a fixed -12 km, and `duelTargetInCone` was
	 * a third sine standing in for aim — which made the rig a *pacing* rig and
	 * nothing else. The striker flies through `stepFlight`, the player's own
	 * integrator, and the cone is now a real ray against its hull, so what the
	 * duel measures is aim as well as pacing.
	 */
	enemy: CombatEnemyState;
	/** Whether the player's beam is on the striker this frame. */
	targetInCone = false;
	/** Where that beam ends — the hull if it connects, its reach if it does not. */
	laserLengthKm = PLAYER_LASER_RANGE_KM;
	/**
	 * The striker as the scanner and the target list want it.
	 *
	 * Exposed rather than reached for: `main.ts` may not name the prototype
	 * (`tests/combat-rig-boundary.test.ts`), so the two production surfaces the
	 * striker has to appear on read one field each off the nullable rig.
	 */
	readonly contact = { id: "combat-prototype-enemy", pos: v3() };
	readonly targetBody: Body;

	/** #53's striker, drawn: the raider hull from the roster, not a cone. */
	private readonly targetMesh: THREE.Group;
	/** Bright, camera-local tracer shown only while the throwaway weapon is held. */
	private readonly laser: THREE.Line;
	/** The striker's pulse in flight: a fixed pool of segments, live ones first. */
	private readonly bolts: THREE.LineSegments;
	/** The lit head of each live bolt; see `BOLT_HEAD_NEAR_PX`. */
	private readonly boltHeads: THREE.Points;
	private readonly boltState: {
		pos: Vec3;
		vel: Vec3;
		/** Kilometres left before the bolt is past the canopy and retired. */
		range: number;
	}[] = [];
	private boltCooldown = 0;
	private boltDraws = 0;
	private readonly boltSeed: number;
	/** The striker's muzzle, lit while it is shooting. */
	private readonly muzzle: THREE.Mesh;
	private readonly muzzleMaterial: THREE.MeshBasicMaterial;
	/** How much of the player's shields and hull the model took last frame, and
	 *  how long the canopy has left to say so. */
	private playerPool = 0;
	private struckFor = 0;
	/** Local sparks at the point the player's beam met the hull. */
	private readonly impactSparks: THREE.Mesh;
	private readonly impactMaterial: THREE.MeshBasicMaterial;
	private impactPoint?: Vec3;
	private hitFlash = 0;
	private wasHit = false;
	private incoming = false;
	private ecm = false;
	/** Fitted overlay font cache: keyed by role + glass width; the fit is
	 *  computed against a widest-case text so any live state fits. */
	private readonly statusFit = new Map<
		string,
		{ font: string; worstWidth: number }
	>();

	constructor(
		scene: THREE.Scene,
		private readonly loop: LoopControl,
		player: Ship,
		playerNose: Vec3,
		worldSeed: number,
	) {
		// **The nose matters, and it has to be the settled one.** `createCombatEnemy`
		// places the striker on the player's forward axis; built before the boot
		// facing, `nose()` reads the identity orientation and the striker spawns
		// tens of degrees off the boresight, closes down a line nobody is looking
		// along, and is off the top of the frame for the whole approach. `Game`
		// builds this rig after `faceTheStar`.
		// The duel draws from the world's *combat* stream, so `?seed=` picks the
		// opponent as well as the galaxy and a probe can replay one. Derived here
		// rather than by the caller: `main.ts` is held to two mentions of the
		// word combat (`tests/combat-rig-boundary.test.ts`), and a stream name
		// passed in from there would be a third — and a place `Game` had learned
		// something about the prototype.
		this.enemy = createCombatEnemy(
			player,
			playerNose,
			mix(seedFor(worldSeed, "combat"), 53),
		);
		this.contact.pos = this.enemy.ship.pos;
		this.targetBody = {
			id: this.contact.id,
			name: "ENEMY STRIKER",
			kind: "moon",
			pos: this.enemy.ship.pos,
			radiusKm: 0.75,
			color: 0x9d2f35,
		};
		this.targetMesh = buildShipMesh("raider", "a").root;
		this.targetMesh.name = "combat-prototype-target";
		this.targetMesh.scale.setScalar(ENEMY_VISUAL_SCALE);
		scene.add(this.targetMesh);
		this.impactMaterial = new THREE.MeshBasicMaterial({
			color: 0xbfeaff,
			transparent: true,
			opacity: 0,
			depthWrite: false,
		});
		// **Kilometres, in the hull's own local frame.** The raider is
		// `HULL_VISUALS.raider.lengthKm` — 0.066 — from nose to tail, so a sphere
		// of 0.06 is the size of the whole ship, and this one was. A spark has to
		// be a mark on the metal.
		this.impactSparks = new THREE.Mesh(
			new THREE.SphereGeometry(0.005, 8, 6),
			this.impactMaterial,
		);
		this.impactSparks.name = "combat-prototype-impact";
		this.impactSparks.visible = false;
		this.targetMesh.add(this.impactSparks);
		this.boltSeed = mix(seedFor(worldSeed, "combat"), 168);
		const boltPositions = new Float32Array(BOLT_POOL * 6);
		const boltGeometry = new THREE.BufferGeometry();
		boltGeometry.setAttribute(
			"position",
			new THREE.BufferAttribute(boltPositions, 3),
		);
		this.bolts = new THREE.LineSegments(
			boltGeometry,
			new THREE.LineBasicMaterial({
				color: 0xffb08a,
				transparent: true,
				opacity: 0.95,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			}),
		);
		this.bolts.name = "combat-prototype-enemy-laser";
		// Every live bolt is inside the canopy's field or on its way there, and a
		// pool whose unused slots sit at the origin has a bounding sphere that
		// says nothing useful — culling it would drop the whole volley.
		this.bolts.frustumCulled = false;
		scene.add(this.bolts);
		const headGeometry = new THREE.BufferGeometry();
		headGeometry.setAttribute(
			"position",
			new THREE.BufferAttribute(new Float32Array(BOLT_POOL * 3), 3),
		);
		const heads = new THREE.ShaderMaterial({
			uniforms: {
				uPixelRatio: { value: 1 },
				uNearPx: { value: BOLT_HEAD_NEAR_PX },
				uMinPx: { value: BOLT_HEAD_MIN_PX },
				uMaxPx: { value: BOLT_HEAD_MAX_PX },
				uRefKm: { value: BOLT_HEAD_REF_KM },
			},
			vertexShader: `
				uniform float uPixelRatio;
				uniform float uNearPx;
				uniform float uMinPx;
				uniform float uMaxPx;
				uniform float uRefKm;
				varying float vLive;
				void main() {
					// A retired slot is collapsed onto the camera; drawn, it would be a
					// permanent blob in the middle of the canopy.
					vLive = dot(position, position) > 0.0 ? 1.0 : 0.0;
					vec4 mv = modelViewMatrix * vec4(position, 1.0);
					float dist = max(-mv.z, 1e-5);
					gl_PointSize =
						clamp(uNearPx * (uRefKm / dist), uMinPx, uMaxPx) * uPixelRatio;
					gl_Position = projectionMatrix * mv;
				}
			`,
			fragmentShader: `
				varying float vLive;
				void main() {
					if (vLive < 0.5) discard;
					float r = min(length(gl_PointCoord - 0.5) * 2.0, 1.0);
					float core = 1.0 - r;
					float hot = pow(core, 3.0);
					vec3 lit = mix(vec3(1.0, 0.55, 0.32), vec3(1.0), hot * 0.7);
					gl_FragColor = vec4(lit * (core * 0.25 + hot * 1.1), 1.0);
				}
			`,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		this.boltHeads = new THREE.Points(headGeometry, heads);
		this.boltHeads.name = "combat-prototype-enemy-bolts";
		this.boltHeads.frustumCulled = false;
		this.boltHeads.onBeforeRender = (renderer) => {
			heads.uniforms.uPixelRatio.value = renderer.getPixelRatio();
		};
		scene.add(this.boltHeads);
		this.muzzleMaterial = new THREE.MeshBasicMaterial({
			color: 0xffd2a8,
			transparent: true,
			opacity: 0,
			depthWrite: false,
		});
		this.muzzle = new THREE.Mesh(
			new THREE.SphereGeometry(0.004, 8, 6),
			this.muzzleMaterial,
		);
		this.muzzle.name = "combat-prototype-muzzle";
		// On the hull's own nose, in the mesh's local frame — kilometres, and the
		// raider is 0.066 of them long, so its nose is at 0.033. Written as
		// ship-lengths this sat a kilometre and a half ahead of the striker and
		// drew a blob across a third of the canopy, growing as the range closed.
		this.muzzle.position.set(0, 0, -0.033);
		this.muzzle.visible = false;
		this.targetMesh.add(this.muzzle);
		this.laser = new THREE.Line(
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
		this.laser.name = "combat-prototype-laser";
		scene.add(this.laser);
	}

	/**
	 * One discrete key, or a refusal.
	 *
	 * **`command` is deliberate, and `CONTEXT.md` says so.** Its scope note on
	 * the `Command` alias (added by #71) bans the word as a name for *a player
	 * act on a carrier* — "not as an English word" — and names
	 * `Game.command(key)` dispatching a keypress as the sanctioned case. This is
	 * that method's delegate. Renaming it to `Intervention` would make the
	 * canonical consequence-model term mean two things, which is the outcome the
	 * scope note exists to prevent.
	 *
	 * Returns whether the rig consumed it, so `Game`'s switch asks rather than
	 * knows: the two keys the prototype borrows (`/` and `q`) both have other
	 * meanings, and the branch that decides which one applies used to be spelled
	 * twice inside that switch.
	 */
	command(key: string): boolean {
		if (key === "/") {
			this.incoming = true;
			return true;
		}
		if (key === "q") {
			this.ecm = true;
			return true;
		}
		return false;
	}

	/**
	 * One simulation frame: fly the striker, then settle the numbers.
	 *
	 * **The schedule is gone.** `duelInputs` decided the cone, the shield bank
	 * and the enemy's firing window from `elapsed`, which made every reading a
	 * function of the clock rather than of the fight — and pacing was all a
	 * scripted target could ever measure. It survives for
	 * `tests/combat-prototype.test.ts`, which still paces the two weapon arms
	 * against each other and needs a schedule that is identical between them.
	 * What reaches the balance model here is the flown geometry.
	 */
	step(
		dt: number,
		keys: Set<string>,
		inCruise: boolean,
		pilot: {
			ship: Ship;
			nose: Vec3;
			/** The trigger, however it is held — the mouse is not a key. */
			mouseFiring: boolean;
			/** The cockpit sightline, which is not the ship's attitude: the
			 *  player can look off the nose, and the beam follows the reticle. */
			aimOrigin: Vec3;
			aimNose: Vec3;
		},
	): void {
		this.hitFlash = Math.max(0, this.hitFlash - dt);
		const beam = pilot.mouseFiring || keys.has(BEAM_KEY);
		const held = beam || keys.has(" ");
		const flown = stepCombatEnemy(
			this.enemy,
			pilot.ship,
			pilot.nose,
			this.state,
			held,
			dt,
			pilot.aimOrigin,
			pilot.aimNose,
		);
		this.enemy = flown.state;
		this.contact.pos = flown.state.ship.pos;
		this.targetBody.pos = flown.state.ship.pos;
		this.targetInCone = flown.targetInCone;
		this.laserLengthKm = flown.laserEndpointKm;

		// The spark is placed on the frame the beam first connects, so it does not
		// walk along the hull while a held trigger keeps scoring.
		const connecting = held && flown.targetInCone;
		if (connecting && !this.wasHit) {
			this.hitFlash = 0.16;
			this.impactPoint = add(
				pilot.aimOrigin,
				scale(pilot.aimNose, flown.laserEndpointKm),
			);
		}
		this.wasHit = connecting;

		this.state = stepCombatPrototype(this.state, {
			dt,
			firing: beam ? "beam" : keys.has(" ") ? "pulse" : null,
			targetInCone: flown.targetInCone,
			incomingMissile: this.incoming,
			ecm: this.ecm,
			// Interdiction only charges in cruise (it is a cruise mechanic);
			// the probe therefore never observes ACTIVE in normal flight.
			interdicting: inCruise,
			breakAngle: keys.has("q") || keys.has("e"),
			enemyFiring: flown.enemyFiring,
			enemyHitAft: flown.enemyHitAft,
		});
		// One-shot inputs, cleared after the step that read them.
		this.incoming = false;
		this.ecm = false;

		this.stepBolts(dt, pilot.ship.pos);
		// Read off the model rather than off the bolts: the canopy flash says
		// "something came off", and the only thing that knows that is the pool
		// `stepCombatPrototype` just decremented.
		const pool =
			this.state.foreShield + this.state.aftShield + this.state.playerHull;
		if (pool < this.playerPool - 1e-9) this.struckFor = HIT_FLASH_S;
		else this.struckFor = Math.max(0, this.struckFor - dt);
		this.playerPool = pool;
	}

	/**
	 * Advance the volley, and add to it while the striker is shooting.
	 *
	 * Bolts are aimed at the canopy with a drawn lateral offset, so they pass
	 * beside it: see `BOLT_POOL`'s note on why a shot aimed at the eye cannot be
	 * seen. The offset is a draw from the fight's own stream rather than a
	 * wobble on a clock, for the same reason the flight path is.
	 */
	private stepBolts(dt: number, playerPos: Vec3): void {
		for (let i = this.boltState.length - 1; i >= 0; i--) {
			const bolt = this.boltState[i];
			bolt.pos = add(bolt.pos, scale(bolt.vel, dt));
			bolt.range -= BOLT_SPEED_KMS * dt;
			if (bolt.range <= 0) this.boltState.splice(i, 1);
		}
		this.boltCooldown -= dt;
		if (this.state.enemyFiring === null || this.boltCooldown > 0) return;
		this.boltCooldown = BOLT_INTERVAL_S;
		if (this.boltState.length >= BOLT_POOL) return;
		const nose = this.enemy.nose;
		const muzzle = add(this.enemy.ship.pos, scale(nose, BOLT_LENGTH_KM));
		const toPlayer = sub(playerPos, muzzle);
		const range = Math.max(
			1e-4,
			Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z),
		);
		const straight = scale(toPlayer, 1 / range);
		// Any two directions perpendicular to the shot, so the miss is drawn over
		// a full circle and the volley does not all pass on one side.
		const reference = Math.abs(straight.y) < 0.85 ? v3(0, 1, 0) : v3(1, 0, 0);
		const across = unit(cross(straight, reference));
		const up = cross(straight, across);
		const angle =
			(mix(this.boltSeed, this.boltDraws++) / 0x1_0000_0000) * Math.PI * 2;
		const aim = unit(
			add(
				straight,
				scale(
					add(scale(across, Math.cos(angle)), scale(up, Math.sin(angle))),
					BOLT_MISS_KM / range,
				),
			),
		);
		this.boltState.push({
			pos: muzzle,
			vel: scale(aim, BOLT_SPEED_KMS),
			range: range + BOLT_OVERSHOOT_KM,
		});
	}

	/**
	 * The scene objects, placed for this frame.
	 *
	 * The striker is mirrored here from its sim-space ship; the renderer takes
	 * no part in its path, its acquisition or its damage. Attitude comes from
	 * the controller's own nose *and roll reference*: a fixed world up would fly
	 * it flat through every turn and go degenerate the moment the nose reached
	 * vertical, which this controller does routinely.
	 */
	render(
		view: CombatView,
		_orientation: THREE.Quaternion,
		viewRotation: THREE.Quaternion,
		camPos: Vec3,
	): void {
		const ship = this.enemy.ship.pos;
		this.targetMesh.position.set(
			ship.x - camPos.x,
			ship.y - camPos.y,
			ship.z - camPos.z,
		);
		RIG_NOSE.set(this.enemy.nose.x, this.enemy.nose.y, this.enemy.nose.z);
		RIG_UP.set(this.enemy.up.x, this.enemy.up.y, this.enemy.up.z);
		RIG_ATTITUDE.lookAt(RIG_ORIGIN, RIG_NOSE, RIG_UP);
		this.targetMesh.quaternion.setFromRotationMatrix(RIG_ATTITUDE);
		this.targetMesh.visible = view === "cockpit";

		const flash = this.hitFlash / 0.16;
		if (this.impactPoint) {
			RIG_IMPACT.set(
				this.impactPoint.x - ship.x,
				this.impactPoint.y - ship.y,
				this.impactPoint.z - ship.z,
			)
				.applyQuaternion(RIG_INVERSE.copy(this.targetMesh.quaternion).invert())
				.multiplyScalar(1 / ENEMY_VISUAL_SCALE);
			this.impactSparks.position.copy(RIG_IMPACT);
		}
		this.impactSparks.scale.setScalar(1 + (1 - flash) * 0.35);
		this.impactMaterial.opacity = flash * 0.95;
		this.impactSparks.visible =
			view === "cockpit" && flash > 0 && this.impactPoint !== undefined;

		this.laser.quaternion.copy(viewRotation);
		this.laser.visible = this.beamShown(view);

		const firing = this.state.enemyFiring !== null;
		this.muzzle.visible = view === "cockpit" && firing;
		this.muzzleMaterial.opacity = firing ? 0.9 : 0;

		// Camera-relative, like the hull: the bolts are sim-space kilometres and
		// the near scene is drawn around the camera at its origin.
		const segments = this.bolts.geometry.getAttribute(
			"position",
		) as THREE.BufferAttribute;
		const headPoints = this.boltHeads.geometry.getAttribute(
			"position",
		) as THREE.BufferAttribute;
		for (let i = 0; i < BOLT_POOL; i++) {
			const bolt = this.boltState[i];
			if (bolt)
				headPoints.setXYZ(
					i,
					bolt.pos.x - camPos.x,
					bolt.pos.y - camPos.y,
					bolt.pos.z - camPos.z,
				);
			else headPoints.setXYZ(i, 0, 0, 0);
			if (!bolt) {
				// Collapsed onto the camera, where a zero-length segment draws
				// nothing. Leaving a retired bolt at its last position would leave
				// a streak hanging in the sky.
				segments.setXYZ(i * 2, 0, 0, 0);
				segments.setXYZ(i * 2 + 1, 0, 0, 0);
				continue;
			}
			const tail = sub(
				bolt.pos,
				scale(bolt.vel, BOLT_LENGTH_KM / BOLT_SPEED_KMS),
			);
			segments.setXYZ(
				i * 2,
				bolt.pos.x - camPos.x,
				bolt.pos.y - camPos.y,
				bolt.pos.z - camPos.z,
			);
			segments.setXYZ(
				i * 2 + 1,
				tail.x - camPos.x,
				tail.y - camPos.y,
				tail.z - camPos.z,
			);
		}
		segments.needsUpdate = true;
		headPoints.needsUpdate = true;
		this.bolts.visible = view === "cockpit";
		this.boltHeads.visible = view === "cockpit";
	}

	/**
	 * The readable weapon feedback, on the glass.
	 *
	 * The Three line `render` places is spatial reference; this is what makes a
	 * shot legible at every viewport, and it shares the cockpit-view gate of the
	 * 3D beam it represents. `glassBottom` is passed rather than imported: the
	 * lower third of the frame is physical cockpit hardware, that fraction is
	 * the renderer's to own, and a second copy of it here is exactly the kind
	 * that let the docking director draw its rings over the dash deck.
	 */
	drawTracer(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		view: CombatView,
		glassBottom: number,
	): void {
		if (!this.beamShown(view)) return;
		ctx.save();
		// Clip the glass effect to the windscreen rather than drawing a laser over
		// an instrument panel.
		ctx.beginPath();
		ctx.rect(0, 0, w, h * glassBottom);
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

	/**
	 * The canopy, when the player is being hit.
	 *
	 * Separate from `drawTracer` and *not* gated on the beam: this is incoming
	 * fire, and it has to show while the player is not shooting back. It reads
	 * the pool `stepCombatPrototype` decremented rather than the bolts, so it is
	 * the damage the model actually applied and not a picture of it — the bolts
	 * carry flight time the model does not have.
	 */
	drawStruck(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		view: CombatView,
		glassBottom: number,
	): void {
		if (view !== "cockpit" || this.struckFor <= 0) return;
		const strength = this.struckFor / HIT_FLASH_S;
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, w, h * glassBottom);
		ctx.clip();
		// A rim, not a wash. The first cut ran the gradient from the centre at
		// half opacity and tinted the whole canopy red — it told the player they
		// were hit by taking the view away, which on a target this small is the
		// one thing that cannot be spared.
		const reach = Math.hypot(w, h * glassBottom) * 0.6;
		const glow = ctx.createRadialGradient(
			w / 2,
			h * glassBottom * 0.5,
			reach * 0.55,
			w / 2,
			h * glassBottom * 0.5,
			reach,
		);
		glow.addColorStop(0, "rgba(255, 90, 70, 0)");
		glow.addColorStop(1, `rgba(255, 90, 70, ${(0.34 * strength).toFixed(3)})`);
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, w, h * glassBottom);
		ctx.restore();
	}

	/**
	 * The font one status line fits in, and the width its worst case occupies.
	 *
	 * **Fitted against the widest text the line can ever hold, not against the
	 * live digits**, so a reading that grows by a character does not resize the
	 * line under the player. That makes the answer a property of the line and
	 * the glass width alone, which is what lets it be cached: the loop below
	 * measures once per role per width, not once per frame.
	 */
	private fitFont(
		ctx: CanvasRenderingContext2D,
		key: string,
		widest: string,
		startSize: number,
		w: number,
	): { font: string; worstWidth: number } {
		const cacheKey = `${key}|${w}`;
		const held = this.statusFit.get(cacheKey);
		if (held) return held;
		let size = startSize;
		ctx.font = `${size}px ui-monospace, monospace`;
		while (size > 8 && ctx.measureText(widest).width > w - 16) {
			size -= 1;
			ctx.font = `${size}px ui-monospace, monospace`;
		}
		const fitted = {
			font: ctx.font,
			worstWidth: ctx.measureText(widest).width,
		};
		this.statusFit.set(cacheKey, fitted);
		return fitted;
	}

	/** Whether the weapon is showing at all. One predicate, because the 3D beam
	 *  and the glass tracer are two renderings of one thing: spelled twice, a
	 *  new suppression term would silently reach only one of them. */
	private beamShown(view: CombatView): boolean {
		return (
			view === "cockpit" && this.state.firing !== null && !this.forceLaserHidden
		);
	}

	/** The glass, when there is none to draw: a focused console or a docked ship
	 *  has replaced it, and a stale record would let a probe assert a line that
	 *  is not on screen. */
	clearOverlay(): void {
		this.overlayStatus.reset();
		this.overlayLines = [];
		// The third record, and it was missed: `probe-live-cockpit.mjs` asserts
		// `statusWorstWidth > 0`, so leaving it set is exactly the stale reading
		// this method's own docstring says it exists to prevent.
		this.statusWorstWidth = 0;
	}

	/** The status block, fitted to the glass width. */
	drawOverlay(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		view: CombatView,
	): void {
		if (view !== "cockpit") {
			this.clearOverlay();
			return;
		}
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
			const fit = this.fitFont(ctx, key, widest, startSize, w);
			ctx.font = fit.font;
			const width = ctx.measureText(text).width;
			drawnLines.push({ text, font: fit.font, width });
			ctx.fillStyle = fill;
			ctx.fillText(text, w / 2, y);
			return fit;
		};
		const s = this.state;
		drawFitted(
			LEGEND,
			h * 0.72,
			"rgba(255, 214, 120, 0.9)",
			12,
			"legend",
			LEGEND,
		);
		drawFitted(
			`TARGET  SHIELDS F ${s.targetForeShield.toFixed(0)}  A ${s.targetAftShield.toFixed(0)}  HULL ${s.targetHull.toFixed(0)} · AI ${this.enemy.phase.toUpperCase()} · HOSTILE ${s.enemyFiring?.toUpperCase() ?? "SAFE"}`,
			h * 0.76,
			"rgba(255, 115, 130, 0.95)",
			12,
			"target",
			WIDEST_TARGET,
		);
		drawFitted(
			`PLAYER  SHIELDS F ${s.foreShield.toFixed(0)}  A ${s.aftShield.toFixed(0)}  HULL ${s.playerHull.toFixed(0)}`,
			h * 0.8,
			"rgba(116, 234, 255, 0.95)",
			12,
			"player",
			WIDEST_PLAYER,
		);
		const status = statusText(s);
		// The status line goes through the same fitter, keyed on its widest text
		// so any live state fits whatever the first frame displayed. Its fit
		// comes back from the draw rather than being solved a second time or
		// fetched out of the cache, so the width the probe asserts on and the
		// width the line was drawn at are the same value.
		const statusFit = drawFitted(
			status,
			h * 0.84,
			PROMPT_FILL,
			Number.parseInt(PROMPT_FONT, 10),
			"status",
			WIDEST_STATUS,
		);
		this.statusWorstWidth = statusFit.worstWidth;
		const statusWidth = drawnLines.at(-1)?.width ?? 0;
		this.overlayStatus.setCenteredPrompt(
			status,
			w / 2,
			h * 0.84,
			statusWidth,
			statusFit.font,
		);
		this.overlayLines = drawnLines;
		ctx.restore();
	}

	/** A resize invalidates every fit, which was solved against the old width. */
	onResize(): void {
		this.statusFit.clear();
	}

	/** Freeze the frame loop; the caller renders manually with a fixed sim state. */
	freezeLoop(): void {
		this.loop.freeze();
	}

	/** Resume the frame loop. */
	resumeLoop(): void {
		this.loop.resume();
	}

	// **No `dispose`.** One was written and removed before this landed: nothing
	// tears a `Game` down, so it had no caller, no test, and a doc comment
	// claiming it was "the half of removable that runs" — a claim about code
	// that never ran. The removability #61 asks for is the *diff*: this file
	// plus one field. A teardown belongs here the day something calls it.
}
