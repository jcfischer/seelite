/**
 * The three shipyards (node #818): the approved studies' flight exports as
 * the game draws them. Form `a` is Gantry Works, `b` Foundry Hangar, `c`
 * Crescent Slipway, replacing the procedural forms one for one (principal,
 * 2026-10-11). The procedural forms stay as the stand-in until a model
 * installs, and for good when one fails to load.
 *
 * **The asset says where it docks.** Each export carries two marks on its
 * life capsule: `aperture-plane`, the drum's frontmost point, and `hub-face`,
 * the hull the slot is cut into, behind the coaming. The builder puts the
 * plane on the sim's (`STATION_GEOMETRY.shipyard.aperturePlaneKm`) with the
 * drum on the spin axis, and recesses the bay's rendered mouth to the hub
 * face. The bay, its berths, the slot and the spin stay the sim's; the
 * collision proxy is `station-proxy.ts`'s, generated from these same files.
 *
 * The drum turns in the spinner; the yard, its bearing and the enclosed
 * spine stand still around it, attached at the drum's rear face.
 */ // glossary-ignore: Hangar
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeSubtree, shared } from "./gpu-teardown";
import { EMISSIVE_CEILING } from "./light-rig";
import type { ModelLoader, ModelProgressListener } from "./model-progress";
import { SHIPYARD_GLB_URLS } from "./model-urls";
import { STATION_GEOMETRY } from "./station";
import { NAMEPLATE_NAME } from "./station-interior-mesh";
import {
	buildShipyardNavigation,
	installShipyardBuilder,
	type ShipyardForm,
	type StationFixture,
	type StationMesh,
	stationSilhouetteKm,
} from "./station-mesh";

export const SHIPYARD_FORMS: readonly ShipyardForm[] = ["a", "b", "c"];

/** Where an export sits in the station's frame, in metres, read off its marks. */
export function shipyardFrame(template: THREE.Object3D) {
	template.updateMatrixWorld(true);
	const capsule = template.getObjectByName("life-capsule");
	const plane = template.getObjectByName("aperture-plane");
	const face = template.getObjectByName("hub-face");
	if (!capsule || !plane || !face)
		throw new Error(
			"shipyard model: expected life-capsule, aperture-plane and hub-face",
		);
	const toCapsule = capsule.matrixWorld.clone().invert();
	const local = (o: THREE.Object3D) =>
		o.getWorldPosition(new THREE.Vector3()).applyMatrix4(toCapsule).z;
	const planeM = local(plane);
	// The capsule's frame, moved along its axis so the plane lands on the sim's.
	const shiftM = STATION_GEOMETRY.shipyard.aperturePlaneKm * 1000 - planeM;
	return {
		/** Yard (export root) to station frame, metres. */
		yardToStation: new THREE.Matrix4()
			.makeTranslation(0, 0, shiftM)
			.multiply(toCapsule),
		/** The capsule's origin on the spin axis, metres. */
		shiftM,
		mouthRecessKm: (planeM - local(face)) / 1000,
	};
}

export function createShipyardBuilder(
	form: ShipyardForm,
	template: THREE.Object3D,
) {
	// The study's lamps are brighter than the game's exposure contract allows.
	// Normalise once, keeping their relative strengths (as the Coriolis does).
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
	const frame = shipyardFrame(template);
	const coreRadiusKm = STATION_GEOMETRY.shipyard.coreRadiusKm;

	return (berthSeed: number, _color: number): StationMesh => {
		const authored = template.clone(true);
		authored.name = `shipyard-${form}-exterior`;
		const capsule = authored.getObjectByName("life-capsule")!;
		capsule.removeFromParent();
		// The yard, in the station's frame. It does not turn.
		authored.applyMatrix4(frame.yardToStation);
		const yard = new THREE.Group();
		yard.name = "shipyard-yard";
		yard.scale.setScalar(0.001);
		yard.add(authored);
		// The drum: its own frame, on the spin axis.
		capsule.position.set(0, 0, frame.shiftM);
		capsule.quaternion.identity();
		capsule.scale.setScalar(1);
		const drum = new THREE.Group();
		drum.name = "shipyard-drum";
		drum.scale.setScalar(0.001);
		drum.add(capsule);
		capsule.traverse((o) => {
			if (o.name.startsWith("capsulecladding-pale-steel-0")) o.name = "core";
			if (o.name.startsWith("capsuleamber-lamp")) {
				o.name = "windows";
				o.userData.minDetail = "reduced";
			}
		});
		const fixtures: StationFixture[] = [];
		const spinner = new THREE.Group();
		spinner.name = "shipyard-spinner";
		spinner.add(
			drum,
			buildShipyardNavigation(fixtures, berthSeed, frame.mouthRecessKm),
		);
		const km = new THREE.Group();
		km.name = "km";
		km.scale.setScalar(1 / coreRadiusKm);
		km.add(yard, spinner);
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
			type: "shipyard",
			formId: form,
			silhouetteKm: stationSilhouetteKm("shipyard", form),
			detail: "full",
			fixtures,
			accessories,
			nameplates,
			greebles: [],
			dispose: () => disposeSubtree(root),
		};
	};
}

const ready = new Map<ShipyardForm, Promise<void>>();
const installed = new Set<(form: ShipyardForm) => void>();

/** Hear each form as it installs; returns the unsubscribe. */
export function onShipyardInstalled(listener: (form: ShipyardForm) => void) {
	installed.add(listener);
	return () => installed.delete(listener);
}

/** Load and install one form. A failure clears its promise, so a Retry
 *  fetches again; `onProgress` hears the download this call starts. */
export function prepareShipyardModel(
	form: ShipyardForm,
	onProgress?: ModelProgressListener,
): Promise<void> {
	let promise = ready.get(form);
	if (!promise) {
		promise = new GLTFLoader()
			.setMeshoptDecoder(MeshoptDecoder)
			.loadAsync(SHIPYARD_GLB_URLS[form], onProgress)
			.then((gltf) => {
				installShipyardBuilder(form, createShipyardBuilder(form, gltf.scene));
				for (const listener of installed) listener(form);
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
export const shipyardModelLoaders: readonly ModelLoader[] = SHIPYARD_FORMS.map(
	(form) => (onProgress?: ModelProgressListener) =>
		prepareShipyardModel(form, onProgress),
);
