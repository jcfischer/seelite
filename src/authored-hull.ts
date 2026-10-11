/**
 * The one way an authored hull exterior becomes a hull mesh (node #814,
 * extracted from node #812's `courier-hull.ts`): the courier and the tug are
 * both built here, and each hull module supplies only what is its own — the
 * scale, the nozzles and the meshes it treats differently.
 *
 * A study (`spikes/<hull>/`) is metres, Y up, **+Z forward**; a hull mesh is
 * kilometres with its nose at **-Z** (`buildShipMesh`). So the model is turned
 * a half-turn about Y and scaled uniformly, which keeps the approved
 * silhouette, and its box is centred on the hull's `envCentre`, so the
 * collision box, the station proxies' reach and a wreck's box keep the frame
 * they were written in.
 *
 * **Every Traffic ship of the hull is this model, so the detail band switches
 * it.** Inside the band's first edge (`DETAIL_RADII.full`) it is the approved
 * model, triangle for triangle; beyond it, a reduced copy made to a **target**
 * error of half a device pixel at that edge, in `LEVEL_FRAME`, and beyond the
 * second edge a coarser one made to the same target (`authored-levels.ts`).
 * Both copies are made here, once, from the loaded model, and share its
 * materials and textures. A reduced level is drawn and never measured: its
 * meshes take no ray (`AuthoredLevelMesh`), so the nav lights, the muzzles and
 * the vent throats are placed on the approved metal.
 */
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { levelErrorKm, reducedLevel } from "./authored-levels";
import { disposeSubtree, shared } from "./gpu-teardown";
import { HULL_SPECS } from "./hull";
import { EMISSIVE_CEILING } from "./light-rig";
import type { ModelProgressListener } from "./model-progress";
import {
	type AfterBootHullId,
	type AuthoredHullBuilder,
	HULL_REACH_KM,
	buildShipMesh,
	installAuthoredHull,
} from "./ship-mesh";
import { ventThroats } from "./vent-plumes";

/** One drive nozzle pair, study metres: the throat's centre on the starboard
 *  side of the study (`x`; the port one is its mirror), the closed throat // glossary-ignore: throat
 *  plate's plane, the bowl's lip plane and radii. */
export interface StudyNozzles {
	readonly x: number;
	readonly y: number;
	readonly throatZ: number; // glossary-ignore: throat
	readonly lipZ: number;
	readonly throatRadius: number; // glossary-ignore: throat
	readonly lipRadius: number;
}

/** What one authored hull supplies; everything else is built the same way. */
export interface AuthoredHullDesign {
	readonly hull: AfterBootHullId;
	/** The frame every copy's levels and glows hang under. */
	readonly frameName: string;
	/** The three levels' object names under the frame. */
	readonly levelNames: {
		readonly full: string;
		readonly reduced: string;
		readonly outline: string;
	};
	/** Kilometres per study metre, from the study's box. */
	readonly kmPerM: (studyBox: THREE.Box3) => number;
	readonly nozzles: StudyNozzles;
	/** Once per mesh of the template, before it is shared: a material swap
	 *  or a shadow rule. The default casts and receives shadows. */
	readonly prepareMesh?: (mesh: THREE.Mesh) => void;
	/** Meshes left out of both reduced levels. */
	readonly skipInLevels?: (mesh: THREE.Mesh) => boolean;
}

/**
 * The machined alloy's roughness floor (#843). The courier study's alloy was a
 * flat, unmapped mirror at roughness 0.28, and under a station bay's flood
 * lights one panel flashed for exactly one frame as the lights turned past it
 * (`probe-station-mouth`). 0.40 is the smallest tried that cleared it. The
 * tug's study alloy is 0.23, so the same floor applies.
 */
export const AUTHORED_ALLOY_MATERIAL = "machined-alloy";
export const AUTHORED_ALLOY_ROUGHNESS = 0.4;

/** The glow's profile, study metres, (radius, z), throat to lip: `v` runs 0 // glossary-ignore: throat
 *  at the throat's centre to 1 at the lip, the axis the shared exhaust ramp // glossary-ignore: throat
 *  grades along. */
function bowlProfile(n: StudyNozzles): THREE.Vector2[] {
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
function bowlGeometry(n: StudyNozzles): THREE.BufferGeometry {
	const lathe = new THREE.LatheGeometry(bowlProfile(n), 48);
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
function discGeometry(n: StudyNozzles): THREE.BufferGeometry {
	const disc = new THREE.CircleGeometry(n.throatRadius, 32);
	disc.rotateY(Math.PI);
	disc.translate(0, 0, n.throatZ);
	return disc;
}

/**
 * Prepare a loaded study scene once and return the builder `buildShipMesh`
 * calls for every ship of the hull: the template's geometry, materials and
 * textures are shared by every copy and survive any one ship's teardown, and
 * so are its two reduced levels, made here.
 */
export async function createAuthoredHullBuilder(
	template: THREE.Object3D,
	design: AuthoredHullDesign,
): Promise<AuthoredHullBuilder> {
	await MeshoptSimplifier.ready;
	// A study's lamps were set for its own viewer; the game's exposure
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
	for (const m of materials)
		if (m.name === AUTHORED_ALLOY_MATERIAL)
			m.roughness = Math.max(m.roughness, AUTHORED_ALLOY_ROUGHNESS);
	template.name = design.levelNames.full;
	template.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		o.castShadow = true;
		o.receiveShadow = true;
		design.prepareMesh?.(o);
		shared(o.geometry);
		for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
			shared(m);
			for (const value of Object.values(m))
				if (value instanceof THREE.Texture) shared(value);
		}
	});

	template.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(template);
	const spec = HULL_SPECS[design.hull];
	const kmPerM = design.kmPerM(box);
	const studyCentre = box.getCenter(new THREE.Vector3());
	// A half-turn about Y sends (x, y, z) to (−x, y, −z). The box centre then
	// lands on `envCentre`: starboard +x, dorsal +y, forward −z.
	const offset = new THREE.Vector3(
		spec.envCentre.rightKm + studyCentre.x * kmPerM,
		spec.envCentre.upKm - studyCentre.y * kmPerM,
		-spec.envCentre.foreKm + studyCentre.z * kmPerM,
	);
	const bowl = shared(bowlGeometry(design.nozzles));
	const disc = shared(discGeometry(design.nozzles));
	const rules = design.skipInLevels ? { skip: design.skipInLevels } : undefined;
	const reach = HULL_REACH_KM[design.hull];
	const levels = {
		reduced: reducedLevel(
			template,
			levelErrorKm("reduced", reach) / kmPerM,
			kmPerM,
			design.levelNames.reduced,
			rules,
		),
		outline: reducedLevel(
			template,
			levelErrorKm("outline", reach) / kmPerM,
			kmPerM,
			design.levelNames.outline,
			rules,
		),
	};

	return (root, exhaust) => {
		const frame = new THREE.Group();
		frame.name = design.frameName;
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
		root.userData.authoredGlow = glow === bowl ? "bowl" : "disc";
		// Named by the ship's sides, starboard being the mesh's +x: the
		// half-turn puts the study's +x nozzle there on the port side.
		for (const [side, x] of [
			["port", design.nozzles.x],
			["starboard", -design.nozzles.x],
		] as const) {
			const mesh = new THREE.Mesh(glow, exhaust);
			mesh.name = `${design.hull}-${side}-exhaust`;
			mesh.position.set(x, design.nozzles.y, 0);
			frame.add(mesh);
		}
		root.add(frame);
		return { full, reduced, outline };
	};
}

/**
 * The loader a hull module exports as its `prepare…HullModel`: fetch the
 * shipped GLB, make its builder and install it, memoised, so the Game's
 * after-boot load, the postcard and the workbench share one download. A
 * failure clears the memo, so the Retry panel's next attempt fetches again.
 * `onProgress` hears the download this call starts (#833), as
 * `prepareCoriolisModel`'s does: without it the boot's tracker has no total
 * for the model and draws its bar without a value until it resolves.
 */
export function authoredHullLoader(
	id: AfterBootHullId,
	url: string,
	createBuilder: (template: THREE.Object3D) => Promise<AuthoredHullBuilder>,
): (onProgress?: ModelProgressListener) => Promise<void> {
	let ready: Promise<void> | undefined;
	return (onProgress) =>
		(ready ??= new GLTFLoader()
			.setMeshoptDecoder(MeshoptDecoder)
			.loadAsync(url, onProgress)
			.then(async (gltf) => {
				installAuthoredHull(id, await createBuilder(gltf.scene));
				// One ship built now, before the stand-ins are refreshed: the first
				// build places the nav lights by raycast against the model, and
				// without this the first Traffic ship drawn mid-flight would pay
				// it. Every later build reuses them. Its throats are measured off
				// the same build for the same reason (`ventThroats` keeps them):
				// otherwise a pilot pays it during replacement, and a shipyard swap
				// to one pays it on the frame.
				const { root } = buildShipMesh(id, HULL_SPECS[id].variant);
				ventThroats(root, id);
				disposeSubtree(root);
			})
			.catch((error) => {
				ready = undefined;
				throw error;
			}));
}
