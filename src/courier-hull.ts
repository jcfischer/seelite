/**
 * The authored courier exterior (node #812): the O4 hull the principal
 * approved on #795 (visual commit `720c928`), drawn as the courier's selected
 * variant in place of the procedural Kestrel.
 *
 * The study (`spikes/courier-hull/`) is metres, Y up, **+Z forward**; a hull
 * mesh here is kilometres with its nose at **-Z** (`buildShipMesh`). So the
 * model is turned a half-turn about Y and scaled — uniformly, which is what
 * keeps the approved silhouette.
 *
 * **The scale is set by the courier's length and nothing else, and that is a
 * decision about the roster rather than about this hull.** Every hull's turn
 * rate is solved against the courier's: `referenceHandling` in
 * `scripts/measure-vent-shares.ts` scales each row's agility by
 * `thrust / length` *over the courier's*, so a courier drawn at the study's
 * own 61.0 m would retune the angular figures of all twelve hulls. The model
 * is scaled to land inside the declared 57.5 m instead; its beam and height
 * are then what the mesh measures, and `HULL_SPECS.courier.env` carries them
 * (`tests/hull.test.ts` holds every declared box to its built one, and the
 * test preload installs this model, so the courier's row measures it).
 *
 * **Its box sits where the old one did**: centred on `envCentre`, so the
 * collision box, the station proxies' reach and a wreck's box keep the frame
 * they were written in.
 *
 * The study's four `interior-screen-*` faces carried fixture navigation and
 * flight values in its viewer. Those are not the ship's, and the exterior's
 * cabin is never the one a pilot reads (the cabin pass draws that), so here
 * they are unpowered — the cockpit model's own convention for a screen with
 * no live source.
 *
 * **Every Traffic courier is this model, so the detail band switches it.**
 * Inside the band's first edge (`DETAIL_RADII.full`) a courier is the
 * approved model, triangle for triangle; beyond it, a reduced copy made to a
 * **target** error of half a device pixel at that edge, in
 * `LEVEL_FRAME` (`courierLevelErrorKm`), and beyond the second edge
 * a coarser one made to the same target. A target and not a bound: the error
 * is the simplifier's own metric, and how the switch looks is judged by eye. Both copies are made here, once,
 * from the loaded model, and share its materials and textures; the cabin and
 * the pilot behind the canopy are left out of both (`authored-levels.ts`
 * makes them, as it makes the miner's). A reduced level is drawn
 * and never measured: its meshes take no ray (`AuthoredLevelMesh`), so the nav lights, the muzzles
 * and the vent throats are placed on the approved metal.
 */
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { levelErrorKm, reducedLevel } from "./authored-levels";
import { disposeSubtree, shared } from "./gpu-teardown";
import type { ModelProgressListener } from "./model-progress";
import { COURIER_HULL_GLB_URL } from "./model-urls";
import { HULL_SPECS } from "./hull";
import { EMISSIVE_CEILING } from "./light-rig";
import {
	AUTHORED_COURIER_VARIANT,
	type AuthoredHullBuilder,
	HULL_REACH_KM,
	buildShipMesh,
	installAuthoredCourier,
} from "./ship-mesh";
import { ventThroats } from "./vent-plumes";

/** The frame every authored courier's levels and glows hang under. */
export const COURIER_FRAME_NAME = "courier-hull-frame";

/** The three levels' object names under `COURIER_FRAME_NAME`: the model
 *  and its two reduced copies. One copy of the names, for the instruments
 *  and rows that pick a level out of a built courier. */
export const COURIER_LEVEL_NAMES = {
	full: "courier-hull-model",
	reduced: "courier-hull-reduced",
	outline: "courier-hull-outline",
} as const;

/** The study's four fixture screens: unpowered in the game (see above). */
export const FIXTURE_SCREEN_PREFIX = "interior-screen-";

/** The cabin and the pilot, seen only through the canopy: left out of the
 *  reduced levels, where the canopy is a few pixels across. */
const BEHIND_THE_CANOPY = /^(interior-|pilot-)/;

/**
 * The target error the courier's reduced levels are made to, kilometres:
 * half a device pixel in `LEVEL_FRAME` at each level's band edge, in courier
 * reaches (`levelErrorKm`, `authored-levels.ts`).
 */
export const courierLevelErrorKm = (level: "reduced" | "outline"): number =>
	levelErrorKm(level, HULL_REACH_KM.courier);

/**
 * How far inside the declared length the model is drawn, kilometres. The
 * envelope row allows a declared box at most 0.1 m over the built one and
 * never under it; half that keeps both sides clear of float error.
 */
export const COURIER_LENGTH_INSET_KM = 0.00005;

/**
 * The two drive nozzles, study metres: the throat's centre on each nacelle, // glossary-ignore: throat
 * the closed throat plate's plane, the bowl's lip plane and radii. Read off // glossary-ignore: throat
 * `build_model.py` (its "aft circular thrust chamber"): the throat plate is // glossary-ignore: throat
 * the 2.34 m ring at z −25.8 and the inner wall runs out to the 2.94 m ring
 * at z −27.7. The glow sits a few centimetres inside that wall.
 */
export const COURIER_NOZZLES_M = {
	x: 21.9,
	y: -0.38,
	throatZ: -25.9,
	lipZ: -27.55,
	throatRadius: 2.25,
	lipRadius: 2.85,
} as const;

/** The drive glow's profile, study metres, (radius, z), throat to lip: `v` // glossary-ignore: throat
 *  runs 0 at the throat's centre to 1 at the lip, the axis the shared // glossary-ignore: throat
 *  exhaust ramp grades along. */
function bowlProfile(): THREE.Vector2[] {
	const n = COURIER_NOZZLES_M;
	return [
		new THREE.Vector2(0, n.throatZ + 0.02),
		new THREE.Vector2(n.throatRadius * 0.5, n.throatZ),
		new THREE.Vector2(n.throatRadius, n.throatZ - 0.05),
		new THREE.Vector2(
			(n.throatRadius + n.lipRadius) / 2,
			(n.throatZ + n.lipZ) / 2,
		),
		new THREE.Vector2(n.lipRadius, n.lipZ),
	];
}

/**
 * The glow bowl about the study's Z axis, opening aft (−Z), its faces
 * winding and lit outward. The shipped finishes draw a drive glow
 * `BackSide` — its far wall is what a viewer looking into the nozzle sees —
 * so outward is the winding that draws; `tests/courier-hull.test.ts` checks
 * it.
 */
function bowlGeometry(): THREE.BufferGeometry {
	const lathe = new THREE.LatheGeometry(bowlProfile(), 48);
	// Lathe revolves about Y; turn Y onto Z so a profile's `y` is the study z.
	lathe.rotateX(Math.PI / 2);
	const position = lathe.getAttribute("position") as THREE.BufferAttribute;
	const index = lathe.getIndex() as THREE.BufferAttribute;
	// Wind outward: test one face away from the axis, flip every face if not.
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	let outward = 0;
	for (let f = 0; f < index.count; f += 3) {
		a.fromBufferAttribute(position, index.getX(f));
		b.fromBufferAttribute(position, index.getX(f + 1));
		c.fromBufferAttribute(position, index.getX(f + 2));
		const normal = new THREE.Vector3().subVectors(b, a).cross(c.clone().sub(a));
		const radial = new THREE.Vector3(
			(a.x + b.x + c.x) / 3,
			(a.y + b.y + c.y) / 3,
			0,
		);
		outward += Math.sign(normal.dot(radial));
	}
	if (outward < 0) {
		for (let f = 0; f < index.count; f += 3) {
			const first = index.getX(f + 1);
			index.setX(f + 1, index.getX(f + 2));
			index.setX(f + 2, first);
		}
	}
	lathe.computeVertexNormals();
	return lathe;
}

/** The glow as a flat disc on the throat plate, facing aft: the drive the // glossary-ignore: throat
 *  `stock` finish draws, whose exhaust material is front-sided and unmapped. */
function discGeometry(): THREE.BufferGeometry {
	const n = COURIER_NOZZLES_M;
	const disc = new THREE.CircleGeometry(n.throatRadius, 32);
	disc.rotateY(Math.PI);
	disc.translate(0, 0, n.throatZ);
	return disc;
}

/**
 * Prepare a loaded study scene once and return the builder `buildShipMesh`
 * calls for every courier: the template's geometry, materials and textures
 * are shared by every copy and survive any one ship's teardown, and so are
 * its two reduced levels, made here.
 */
export async function createCourierHullBuilder(
	template: THREE.Object3D,
): Promise<AuthoredHullBuilder> {
	await MeshoptSimplifier.ready;
	// The study's lamps were set for its own viewer; the game's exposure
	// contract caps an authoring dial at white. Normalise once, keeping the
	// relative strengths, as the Coriolis and the cockpit models do.
	const materials = new Set<THREE.MeshStandardMaterial>();
	template.traverse((o) => {
		if (o instanceof THREE.Mesh)
			for (const m of Array.isArray(o.material) ? o.material : [o.material])
				if (m instanceof THREE.MeshStandardMaterial) materials.add(m);
	});
	const divisor = Math.max(
		1,
		...[...materials].map((m) => m.emissiveIntensity / EMISSIVE_CEILING),
	);
	for (const m of materials) m.emissiveIntensity /= divisor;
	const unpowered = shared(new THREE.MeshBasicMaterial({ color: 0x01090b }));
	unpowered.name = "interior-screen-unpowered";
	template.name = COURIER_LEVEL_NAMES.full;
	template.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const screen = o.name.startsWith(FIXTURE_SCREEN_PREFIX);
		if (screen) o.material = unpowered;
		// The cabin and the pilot sit inside the closed hull: nothing they
		// would shade is lit through it, so they stay out of the shadow pass.
		o.castShadow = !screen && !BEHIND_THE_CANOPY.test(o.name);
		o.receiveShadow = true;
		shared(o.geometry);
		for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
			shared(m);
			for (const value of Object.values(m))
				if (value instanceof THREE.Texture) shared(value);
		}
	});

	template.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(template);
	const studyLengthM = box.max.z - box.min.z;
	const spec = HULL_SPECS.courier;
	const kmPerM = (spec.env.lengthKm - COURIER_LENGTH_INSET_KM) / studyLengthM;
	const studyCentre = box.getCenter(new THREE.Vector3());
	// A half-turn about Y sends (x, y, z) to (−x, y, −z). The box centre then
	// lands on `envCentre`: starboard +x, dorsal +y, forward −z.
	const offset = new THREE.Vector3(
		spec.envCentre.rightKm + studyCentre.x * kmPerM,
		spec.envCentre.upKm - studyCentre.y * kmPerM,
		-spec.envCentre.foreKm + studyCentre.z * kmPerM,
	);
	const bowl = shared(bowlGeometry());
	const disc = shared(discGeometry());
	const behindTheCanopy = {
		skip: (mesh: THREE.Mesh) => BEHIND_THE_CANOPY.test(mesh.name),
	};
	const levels = {
		reduced: reducedLevel(
			template,
			courierLevelErrorKm("reduced") / kmPerM,
			kmPerM,
			COURIER_LEVEL_NAMES.reduced,
			behindTheCanopy,
		),
		outline: reducedLevel(
			template,
			courierLevelErrorKm("outline") / kmPerM,
			kmPerM,
			COURIER_LEVEL_NAMES.outline,
			behindTheCanopy,
		),
	};

	return (root, exhaust) => {
		const frame = new THREE.Group();
		frame.name = COURIER_FRAME_NAME;
		frame.rotation.y = Math.PI;
		frame.scale.setScalar(kmPerM);
		frame.position.copy(offset);
		const full = template.clone(true);
		const reduced = levels.reduced.clone(true);
		const outline = levels.outline.clone(true);
		frame.add(full, reduced, outline);
		// The bowl when the finish's glow is a bowl, the disc when it is not:
		// a back-sided material on a disc draws nothing from astern.
		const glow = exhaust.side === THREE.BackSide ? bowl : disc;
		// What this root carries, for `ventThroats`: the finish in force when
		// it is asked need not be the one it was built under.
		root.userData.courierGlow = glow === bowl ? "bowl" : "disc";
		// Named by the ship's sides, starboard being the mesh's +x: the
		// half-turn puts the study's +x nozzle there on the port side.
		for (const [side, x] of [
			["port", COURIER_NOZZLES_M.x],
			["starboard", -COURIER_NOZZLES_M.x],
		] as const) {
			const mesh = new THREE.Mesh(glow, exhaust);
			mesh.name = `courier-${side}-exhaust`;
			mesh.position.set(x, COURIER_NOZZLES_M.y, 0);
			frame.add(mesh);
		}
		root.add(frame);
		return { full, reduced, outline };
	};
}

let ready: Promise<void> | undefined;

/** Await before any Game, postcard or ship workbench builds a courier.
 *  `onProgress` hears the download this call starts (#833), as
 *  `prepareCoriolisModel`'s does: without it the boot's tracker has no total
 *  for this model and draws its bar without a value until it resolves. */
export function prepareCourierHullModel(
	onProgress?: ModelProgressListener,
): Promise<void> {
	return (ready ??= new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.loadAsync(COURIER_HULL_GLB_URL, onProgress)
		.then(async (gltf) => {
			installAuthoredCourier(await createCourierHullBuilder(gltf.scene));
			// One courier built now, behind the loading panel: the first build
			// places the nav lights by raycast against the model, about 0.3 s,
			// and without this the first Traffic courier drawn mid-flight
			// would pay it. Every later build reuses them. Its throats are
			// measured off the same build for the same reason (`ventThroats`
			// keeps them): a pilot flying a courier pays it at boot otherwise,
			// and a shipyard swap to one pays it on the frame.
			const { root } = buildShipMesh("courier", AUTHORED_COURIER_VARIANT);
			ventThroats(root, "courier");
			disposeSubtree(root);
		})
		.catch((error) => {
			ready = undefined;
			throw error;
		}));
}
