/**
 * The authored Porter (node #813): the O2 Modular Carrier the principal
 * approved on #797, drawn as `freighter/b` in place of the procedural Porter.
 *
 * The model is a Blender export (`spikes/porter-hull/build_model.py`) in
 * metres, Y up, nose +Z; `spikes/porter-hull/prepare-game-asset.mjs` encodes
 * it losslessly into `public/models/porter.glb`, the one Porter file the game
 * ships. A hull mesh is kilometres with the nose at −Z, so the template is
 * turned half a turn about Y and scaled by `PORTER_KM_PER_M`.
 *
 * **Turned, not mirrored, and that puts the cargo to port.** The spike's
 * README and build script call the cassettes' side (+X) starboard, but glTF's
 * frame makes +X the ship's left when its nose is +Z, and the approved frames
 * (`evidence/hero.png`, `target.png`) show the cassettes on the left of a
 * pilot looking forward. A rigid turn draws exactly the object the principal
 * approved; a mirror would keep the word and ship a chirality nobody has seen.
 * `tests/porter-model.test.ts` holds the side.
 *
 * The template is measured and shared once: every Porter — the player's,
 * Traffic's, a fleet review's — clones it, so its geometry, materials and
 * textures are marked `shared` and survive any one ship's teardown.
 */
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { shared } from "./gpu-teardown";
import { EMISSIVE_CEILING } from "./light-rig";
import { authoredDriveGlow, installAuthoredPorter } from "./ship-mesh";

export const PORTER_MODEL_URL = "/models/porter.glb";

/** Hull kilometres per model metre. */
export const PORTER_KM_PER_M = 0.001;

/**
 * The spike viewer's bump: each textured material's wear map, read again as a
 * height. Three normalises the surface derivatives (`bumpmap_pars_fragment`),
 * so the figure carries from the viewer's metres to the game's kilometres.
 */
export const PORTER_BUMP_SCALE = 0.022;

/**
 * The model's drive nozzles, model metres, read off `build_model.py`'s
 * `nozzle(x, y, z, r)` calls: the aft drive pod on the keel and the five
 * nozzles under the cassettes. Each nozzle's recess ends in a dark wall
 * `1.8` m inside its mouth at `0.64 r`; the glow sits just aft of that
 * wall, facing out of the nozzle.
 */
export const PORTER_NOZZLES_M = [
	{ name: "porter-drive", x: -14.7, y: -0.3, z: -34.6, r: 4.9 },
	...[-5, 1, 7, 13, 19].map((x, i) => ({
		name: `porter-drive-${i + 1}`,
		x,
		y: -1.4,
		z: -31.5,
		r: 1.3,
	})),
] as const;

/** How far the glow stands off the nozzle's back wall, metres. */
const GLOW_STANDOFF_M = 0.05;

/**
 * The drive glow every hull carries (`isDriveBell`), seated in the model's
 * nozzles. The model was approved without one; the game's drive cue and the
 * main drive's plumes are drawn at these discs, as on every procedural hull.
 */
function addDriveGlows(scene: THREE.Object3D): void {
	for (const n of PORTER_NOZZLES_M) {
		const glow = authoredDriveGlow(n.name, n.r * 0.55);
		glow.position.set(n.x, n.y, n.z + 1.8 - GLOW_STANDOFF_M);
		// A circle faces +Z; the model's aft is −Z.
		glow.rotation.y = Math.PI;
		scene.add(glow);
	}
}

/** Normalise and share a loaded model once, then install it as `freighter/b`. */
export function adoptPorterTemplate(scene: THREE.Object3D): void {
	const materials = new Set<THREE.MeshStandardMaterial>();
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		for (const m of Array.isArray(o.material) ? o.material : [o.material])
			if (m instanceof THREE.MeshStandardMaterial) materials.add(m);
	});
	// The export's service lamps (3) and displays (1.7) are brighter than the
	// game's exposure contract allows; scale every emissive by one divisor so
	// their relative strengths are the ones the principal approved.
	const divisor = Math.max(
		1,
		...[...materials].map((m) => m.emissiveIntensity / EMISSIVE_CEILING),
	);
	for (const m of materials) {
		m.emissiveIntensity /= divisor;
		if (m.map) {
			m.map.anisotropy = 8;
			m.bumpMap = m.map;
			m.bumpScale = PORTER_BUMP_SCALE;
			m.needsUpdate = true;
		}
	}
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		shared(o.geometry);
		for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
			shared(m);
			for (const value of Object.values(m))
				if (value instanceof THREE.Texture) shared(value);
		}
	});
	addDriveGlows(scene);
	const model = new THREE.Group();
	model.name = "porter-model";
	// Exactly half a turn about Y: (x, y, z) → (−x, y, −z), with no rounding
	// residue mixing the axes as `rotation.y = Math.PI` would leave.
	model.quaternion.set(0, 1, 0, 0);
	model.scale.setScalar(PORTER_KM_PER_M);
	model.add(scene);
	installAuthoredPorter(model);
}

let ready: Promise<void> | undefined;

/** Await before anything builds a ship: every page that can draw a Porter. */
export function preparePorterModel(): Promise<void> {
	return (ready ??= new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.loadAsync(PORTER_MODEL_URL)
		.then((gltf) => adoptPorterTemplate(gltf.scene))
		.catch((error) => {
			ready = undefined;
			throw error;
		}));
}
