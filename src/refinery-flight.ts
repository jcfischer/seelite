/**
 * The four refineries (node #819): the approved studies' (#804) flight
 * exports as the game draws them. Form `a` is Warren, `b` Collar, `c` Spar,
 * `d` Works, replacing the procedural forms one for one. The procedural forms
 * stay as the stand-in until a model installs, and for good when one fails to
 * load.
 *
 * **The asset is in the station's frame.** The flight export
 * (`spikes/refineries/build_model.py --flight`) moves each model so its
 * `aperture-plane` mark lies on +z at the sim's plane, in metres; this only
 * scales it to kilometres. The pad, its deck, berths and lights are the sim's
 * (`buildRefineryNavigation`), drawn into the model's recessed housing
 * (principal ruling, 2026-10-13). A refinery does not turn.
 */
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeSubtree, shared } from "./gpu-teardown";
import { EMISSIVE_CEILING } from "./light-rig";
import type { ModelLoader, ModelProgressListener } from "./model-progress";
import { REFINERY_GLB_URLS } from "./model-urls";
import { REFINERY_PAD_FRAME } from "./refinery-pad-frame";
import { STATION_GEOMETRY } from "./station";
import { NAMEPLATE_NAME } from "./station-interior-mesh";
import {
	buildRefineryNavigation,
	buildRefineryPadCues,
	installRefineryBuilder,
	type RefineryForm,
	type StationFixture,
	type StationMesh,
	stationSilhouetteKm,
} from "./station-mesh";
import { AUTHORED_EXTERIOR_NAME } from "./station-visuals";

export const REFINERY_FORMS: readonly RefineryForm[] = ["a", "b", "c", "d"];

/** Where the export puts the sim's plane, metres, checked at install: a
 *  model in another frame would draw its pad away from the sim's. */
function checkFrame(template: THREE.Object3D): void {
	template.updateMatrixWorld(true);
	const mark = template.getObjectByName("aperture-plane");
	if (!mark) throw new Error("refinery model: expected aperture-plane");
	const p = mark.getWorldPosition(new THREE.Vector3());
	const planeM = STATION_GEOMETRY.refinery.aperturePlaneKm * 1000;
	if (Math.hypot(p.x, p.y, p.z - planeM) > 0.01)
		throw new Error(
			`refinery model: aperture-plane at ${p.toArray()}, not on +z at ${planeM} m`,
		);
}

export function createRefineryBuilder(
	form: RefineryForm,
	template: THREE.Object3D,
) {
	checkFrame(template);
	// The study's lamps are brighter than the game's exposure contract allows.
	// Normalise once, keeping their relative strengths (as the shipyards do).
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
	// One loaded asset per page, shared by every station of the form.
	template.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		shared(o.geometry);
		for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
			shared(m);
			for (const value of Object.values(m))
				if (value instanceof THREE.Texture) shared(value);
		}
		o.castShadow = true;
		o.receiveShadow = true;
	});
	const coreRadiusKm = STATION_GEOMETRY.refinery.coreRadiusKm;

	return (berthSeed: number, _color: number): StationMesh => {
		const authored = template.clone(true);
		authored.name = `refinery-${form}-model`;
		authored.traverse((o) => {
			// The study's amber lamps are the role's lit windows (§5).
			if (o.name.startsWith("staticamber-lamp")) {
				o.name = "windows";
				o.userData.minDetail = "reduced";
			}
		});
		const exterior = new THREE.Group();
		exterior.name = AUTHORED_EXTERIOR_NAME;
		exterior.scale.setScalar(0.001);
		exterior.add(authored);
		const fixtures: StationFixture[] = [];
		// A refinery does not turn: an empty spinner, as every refinery form's.
		const spinner = new THREE.Group();
		spinner.name = "refinery-spinner";
		const km = new THREE.Group();
		km.name = "km";
		km.scale.setScalar(1 / coreRadiusKm);
		km.add(
			exterior,
			spinner,
			buildRefineryNavigation(fixtures, berthSeed),
			buildRefineryPadCues(fixtures, REFINERY_PAD_FRAME),
		);
		const root = new THREE.Group();
		root.add(km);
		const nameplates: THREE.Mesh[] = [];
		const accessories: THREE.Object3D[] = [];
		root.traverse((o) => {
			if (o.userData.minDetail) accessories.push(o);
			if (o.name === NAMEPLATE_NAME && o instanceof THREE.Mesh)
				nameplates.push(o);
		});
		return {
			root,
			spinner,
			type: "refinery",
			formId: form,
			silhouetteKm: stationSilhouetteKm("refinery", form),
			detail: "full",
			fixtures,
			accessories,
			nameplates,
			greebles: [],
			dispose: () => disposeSubtree(root),
		};
	};
}

const ready = new Map<RefineryForm, Promise<void>>();

/** Load and install one form. A failure clears its promise, so a Retry
 *  fetches again; `onProgress` hears the download this call starts. */
export function prepareRefineryModel(
	form: RefineryForm,
	onProgress?: ModelProgressListener,
): Promise<void> {
	let promise = ready.get(form);
	if (!promise) {
		promise = new GLTFLoader()
			.setMeshoptDecoder(MeshoptDecoder)
			.loadAsync(REFINERY_GLB_URLS[form], onProgress)
			.then((gltf) => {
				installRefineryBuilder(form, createRefineryBuilder(form, gltf.scene));
			})
			.catch((error) => {
				ready.delete(form);
				throw error;
			});
		ready.set(form, promise);
	}
	return promise;
}

/** One loader per form, so a boot's byte progress counts each download. */
export const refineryModelLoaders: readonly ModelLoader[] = REFINERY_FORMS.map(
	(form) => (onProgress?: ModelProgressListener) =>
		prepareRefineryModel(form, onProgress),
);
