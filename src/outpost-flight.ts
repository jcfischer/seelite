/**
 * The outpost Salvage (node #1031): the approved study's (#810) flight export
 * as the game draws it, replacing the procedural form `e`. The procedural form
 * stays as the stand-in until the model installs, and for good when it fails
 * to load.
 *
 * **The asset is in the station's frame.** The flight export
 * (`spikes/stations/build_model.py -- salvage --flight`) moves the model so
 * its `aperture-plane` mark lies on +z at the sim's plane, in metres; this
 * only scales it to kilometres. The pad is the model's (principal ruling,
 * 2026-10-19, option 1): its deck and berths are built to the sim's figures
 * and drawn here as a `station-interior` group; the game adds the lit frame
 * round the lane and both painted names (`buildOutpostNavigation`). The sim's
 * berths, corridor and deck stay authoritative. An outpost does not turn.
 *
 * **The model carries every berth a seed can draw**: `deck-near`, and the side
 * berth on `port-near` or `starboard-near` (`stationInterior`). A station
 * keeps the ones its own seed draws.
 */
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeSubtree, shared } from "./gpu-teardown";
import { EMISSIVE_CEILING } from "./light-rig";
import type { ModelLoader, ModelProgressListener } from "./model-progress";
import { OUTPOST_GLB_URLS } from "./model-urls";
import { STATION_GEOMETRY } from "./station";
import { stationInterior } from "./station-interior";
import {
	buildPadNameplate,
	INTERIOR_GROUP_NAME,
	NAMEPLATE_NAME,
} from "./station-interior-mesh";
import {
	buildOutpostNavigation,
	installOutpostBuilder,
	type OutpostForm,
	type StationFixture,
	type StationMesh,
	stationSilhouetteKm,
} from "./station-mesh";
import { AUTHORED_EXTERIOR_NAME } from "./station-visuals";

export const OUTPOST_FORMS: readonly OutpostForm[] = ["e"];

/** Each form's model, by the name its file carries (`outpost-<name>.glb`).
 *  `OUTPOST_GLB_URLS` restates them as literals vite can rewrite;
 *  `tests/outpost-flight.test.ts` holds the two to agree. */
export const OUTPOST_MODEL_NAMES: Readonly<Record<OutpostForm, string>> = {
	e: "salvage",
};

/** The authored pad's mesh groups, named as the procedural pad's parts
 *  (`station-interior-mesh.ts`), longest prefix first. */
const PAD_PART_NAMES = [
	"interior-lane-edge",
	"interior-deck",
	"interior-rail",
	"interior-flood",
];

/** Where the export puts the sim's plane, metres, checked at install: a
 *  model in another frame would draw its pad away from the sim's. */
function checkFrame(template: THREE.Object3D): void {
	template.updateMatrixWorld(true);
	const mark = template.getObjectByName("aperture-plane");
	if (!mark) throw new Error("outpost model: expected aperture-plane");
	const p = mark.getWorldPosition(new THREE.Vector3());
	const planeM = STATION_GEOMETRY.outpost.aperturePlaneKm * 1000;
	if (Math.hypot(p.x, p.y, p.z - planeM) > 0.01)
		throw new Error(
			`outpost model: aperture-plane at ${p.toArray()}, not on +z at ${planeM} m`,
		);
}

export function createOutpostBuilder(
	form: OutpostForm,
	template: THREE.Object3D,
) {
	checkFrame(template);
	// The study's lamps are brighter than the game's exposure contract allows.
	// Normalise once, keeping their relative strengths (as the refineries do).
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
	const coreRadiusKm = STATION_GEOMETRY.outpost.coreRadiusKm;
	const planeKm = STATION_GEOMETRY.outpost.aperturePlaneKm;

	return (berthSeed: number, _color: number): StationMesh => {
		const interior = stationInterior("outpost", planeKm, berthSeed);
		const authored = template.clone(true);
		authored.name = `outpost-${form}-model`;
		// The authored pad: its meshes leave the exterior for a
		// `station-interior` group of their own, named as the procedural pad's
		// parts are, so what reads a pad finds one, and the proxy fit (the
		// exterior's parts) never sees the deck the sim walls.
		const padMeshes: THREE.Object3D[] = [];
		authored.traverse((o) => {
			if (o.name.startsWith("interior-") || o.name.startsWith("berth-"))
				padMeshes.push(o);
		});
		const pad = new THREE.Group();
		pad.name = INTERIOR_GROUP_NAME;
		const padModel = new THREE.Group();
		padModel.scale.setScalar(0.001);
		pad.add(padModel);
		// Each berth's parts in a `berth-<id>` group, the sim's id, as the
		// procedural pad builds them (`probe-dock-arrival` reads it). A berth
		// this station's seed does not draw is left out.
		const berthIds = interior.berths.map((b) => b.id);
		const berths = new Map<string, THREE.Group>();
		for (const o of padMeshes) {
			o.removeFromParent();
			for (const part of PAD_PART_NAMES)
				if (o.name.startsWith(part)) o.name = part;
			if (!o.name.startsWith("berth-")) {
				padModel.add(o);
				continue;
			}
			const id = berthIds.find((b) => o.name.startsWith(`berth-${b}`));
			if (!id) continue;
			let group = berths.get(id);
			if (!group) {
				group = new THREE.Group();
				group.name = `berth-${id}`;
				berths.set(id, group);
				padModel.add(group);
			}
			group.add(o);
		}
		pad.add(buildPadNameplate(interior));
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
		// An outpost does not turn: an empty spinner, as every outpost form's.
		const spinner = new THREE.Group();
		spinner.name = "outpost-spinner";
		const km = new THREE.Group();
		km.name = "km";
		km.scale.setScalar(1 / coreRadiusKm);
		km.add(exterior, spinner, buildOutpostNavigation(fixtures, berthSeed), pad);
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
			type: "outpost",
			formId: form,
			silhouetteKm: stationSilhouetteKm("outpost", form),
			detail: "full",
			fixtures,
			accessories,
			nameplates,
			greebles: [],
			dispose: () => disposeSubtree(root),
		};
	};
}

const ready = new Map<OutpostForm, Promise<void>>();

/** Load and install one form. A failure clears its promise, so a Retry
 *  fetches again; `onProgress` hears the download this call starts. */
export function prepareOutpostModel(
	form: OutpostForm,
	onProgress?: ModelProgressListener,
): Promise<void> {
	let promise = ready.get(form);
	if (!promise) {
		promise = new GLTFLoader()
			.setMeshoptDecoder(MeshoptDecoder)
			.loadAsync(OUTPOST_GLB_URLS[form], onProgress)
			.then((gltf) => {
				installOutpostBuilder(form, createOutpostBuilder(form, gltf.scene));
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
export const outpostModelLoaders: readonly ModelLoader[] = OUTPOST_FORMS.map(
	(form) => (onProgress?: ModelProgressListener) =>
		prepareOutpostModel(form, onProgress),
);
