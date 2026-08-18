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
import { GOVERNMENT_NAMES } from "./galaxy";
import { type Body, type World, makeWorld, stepWorld } from "./sim";
import { add, length, scale, sub, v3 } from "./vec3";
// One path to `./units`, deliberately. Keeping a namespace import beside a named
// one would let this file reach `FAR_SCALE` and `units.FAR_SCALE` as separate
// spellings of the same constant — the two-public-paths pattern this branch
// removed from `sim.ts` and pinned with a source-scan test.
import * as units from "./units";

const {
	AU_KM,
	BACKDROP_RADIUS,
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

/** Ship thrust, km/s². About 0.2 g — enough to feel responsive at the scale the
 *  station sits at, and not a flight-model claim. */
const THRUST = 2.0;

/** Radians per second at full deflection, for each rotation axis. */
const YAW_RATE = 0.9;
const PITCH_RATE = 0.9;
const ROLL_RATE = 1.4;

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

/** Largest frame delta the simulation will accept, in seconds. A backgrounded
 *  tab returns with a delta of whole seconds, and integrating that in one step
 *  puts the ship somewhere absurd. */
const MAX_DT = 0.1;

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

	private readonly meshes = new Map<string, THREE.Mesh>();
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
	private lastTime = 0;
	private hud: HTMLElement;
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

		this.hud = document.getElementById("hud") as HTMLElement;
		window.addEventListener("resize", () => this.onResize());
		window.addEventListener("keydown", (e) => this.onKey(e, true));
		window.addEventListener("keyup", (e) => this.onKey(e, false));
		// Audio cannot open before a gesture, so it opens on the first one.
		window.addEventListener("pointerdown", () => this.audio.ensure(), {
			once: true,
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
		const inward = scale(this.world.ship.pos, -1 / d);
		this.orientation.setFromRotationMatrix(
			new THREE.Matrix4().lookAt(
				new THREE.Vector3(0, 0, 0),
				new THREE.Vector3(inward.x, inward.y, inward.z),
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
			const material =
				body.kind === "star"
					? new THREE.MeshBasicMaterial({ color: body.color })
					: new THREE.MeshStandardMaterial({
							color: body.color,
							roughness: 0.9,
							metalness: 0.0,
						});
			const mesh = new THREE.Mesh(unitSphere, material);
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
		// Arrow keys and space scroll the page otherwise, which under a
		// full-viewport canvas looks like the controls simply not working.
		if (key.startsWith("arrow") || key === " ") e.preventDefault();
	}

	private axis(negative: string[], positive: string[]): number {
		const neg = negative.some((k) => this.keys.has(k)) ? 1 : 0;
		const pos = positive.some((k) => this.keys.has(k)) ? 1 : 0;
		return pos - neg;
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

		// Rotations composed in the ship's own frame — multiply on the right —
		// so pitch is about the wing axis wherever the nose happens to point,
		// rather than about a world axis the player cannot see.
		const turn = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(
				pitch * PITCH_RATE * dt,
				yaw * YAW_RATE * dt,
				roll * ROLL_RATE * dt,
				"XYZ",
			),
		);
		this.orientation.multiply(turn).normalize();

		if (this.keys.has("shift")) this.throttle = Math.min(1, this.throttle + dt);
		if (this.keys.has("control"))
			this.throttle = Math.max(0, this.throttle - dt);
		this.audio.ambient(this.throttle);

		// -Z is forward, which is Three.js's own convention for a camera and for
		// anything that is going to be looked along.
		const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
			this.orientation,
		);
		const accel = v3(
			forward.x * THRUST * this.throttle,
			forward.y * THRUST * this.throttle,
			forward.z * THRUST * this.throttle,
		);
		// The whole world, not just the ship: `dt` is sim seconds and the bodies
		// are on orbits driven by the same clock. Stepping the ship alone would
		// freeze the system around it, which is the state the scaffold was in.
		stepWorld(this.world, accel, dt);
	}

	/** Where the camera is in *sim* space — behind and above the ship. */
	private cameraPos() {
		const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.orientation);
		const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.orientation);
		return add(
			this.world.ship.pos,
			add(
				scale(v3(back.x, back.y, back.z), CHASE_BACK_KM),
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
	render() {
		const camPos = this.cameraPos();

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

		this.composer.render();
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
		this.render();
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
		const key = `${Math.floor(gameTime)}|${throttle}|${speed}|${station}`;
		if (key === this.hudKey) return;
		this.hudKey = key;

		const r = system.record;
		this.hud.textContent = [
			`${r.name}  TL ${r.displayTL}  ${GOVERNMENT_NAMES[r.government]}`,
			`t+${clock(gameTime)}`,
			`throttle ${throttle}%`,
			`${speed} km/s`,
			station,
			`seed ${this.world.seed}`,
		].join("   ");
	}

	private onResize() {
		const w = window.innerWidth;
		const h = window.innerHeight;
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
