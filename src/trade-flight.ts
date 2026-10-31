import * as THREE from "three";
import {
	STATION_BEACON_GAIN,
	isStationBeacon,
	applyStationKeyLight,
} from "./station-light";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeSubtree, shared } from "./gpu-teardown";
import { EMISSIVE_CEILING } from "./light-rig";
import type { ModelProgressListener } from "./model-progress";
import { TRADE_GLB_URLS } from "./model-urls";
import { STATION_GEOMETRY } from "./station";
import { stationInterior } from "./station-interior";
import { buildStationInterior, NAMEPLATE_NAME } from "./station-interior-mesh";
import {
	type AuthoredTradeForm,
	buildCoriolisNavigation,
	installTradeBuilder,
	type StationFixture,
	type StationMesh,
	stationSilhouetteKm,
} from "./station-mesh";
import { AUTHORED_EXTERIOR_NAME } from "./station-visuals";
import { TRADE_MOUTH_RECESS_KM } from "./trade-frame";

export const TRADE_FORMS: readonly AuthoredTradeForm[] = ["b", "c", "e"];
export const TRADE_MODEL_NAMES = { b: "ring", c: "drum", e: "wheel" } as const;

export function createTradeBuilder(
	form: AuthoredTradeForm,
	template: THREE.Object3D,
) {
	template.updateMatrixWorld(true);
	const mark = template.getObjectByName("aperture-plane");
	const geometry = STATION_GEOMETRY.trade;
	if (
		!mark ||
		mark
			.getWorldPosition(new THREE.Vector3())
			.distanceTo(new THREE.Vector3(0, 0, geometry.aperturePlaneKm * 1000)) >
			0.01
	)
		throw new Error(
			`trade/${form}: aperture-plane is not on the sim's axis and plane`,
		);
	const materials = new Set<THREE.MeshStandardMaterial>();
	template.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		for (const m of Array.isArray(o.material) ? o.material : [o.material])
			if (m instanceof THREE.MeshStandardMaterial) materials.add(m);
	});
	const divisor = Math.max(
		1,
		...[...materials]
			.filter((m) => !isStationBeacon(m.name))
			.map((m) => m.emissiveIntensity / EMISSIVE_CEILING),
	);
	for (const m of materials) {
		const beacon = isStationBeacon(m.name);
		m.emissiveIntensity /= beacon
			? Math.max(divisor, m.emissiveIntensity / EMISSIVE_CEILING)
			: divisor;
		if (beacon) m.emissiveIntensity *= STATION_BEACON_GAIN;
		applyStationKeyLight(m);
	}
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
	return (berthSeed: number, _color: number): StationMesh => {
		const exterior = new THREE.Group();
		exterior.name = AUTHORED_EXTERIOR_NAME;
		const model = template.clone(true);
		model.name = `trade-${form}-model`;
		model.scale.setScalar(0.001);
		model.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			if (o.name.includes("amber-lamp") && o.userData.minDetail !== "full")
				o.name = "windows";
			else if (o.name === "staticcladding-armour-0") o.name = "core";
		});
		exterior.add(model);
		const fixtures: StationFixture[] = [];
		const aperture = buildCoriolisNavigation(fixtures, exterior, {
			originZ: 0.35,
			strobeX: 0.15,
			beaconX: 0.13,
			beaconY: 0.12,
			nameZ: geometry.aperturePlaneKm,
		});
		const interior = stationInterior(
			"trade",
			geometry.aperturePlaneKm,
			berthSeed,
		);
		aperture.add(
			buildStationInterior("trade", interior, TRADE_MOUTH_RECESS_KM, berthSeed),
		);
		const spinner = new THREE.Group();
		spinner.name = `trade-${form}-spinner`;
		spinner.add(exterior, aperture);
		const km = new THREE.Group();
		km.name = "km";
		km.scale.setScalar(1 / geometry.coreRadiusKm);
		km.add(spinner);
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
			type: "trade",
			formId: form,
			silhouetteKm: stationSilhouetteKm("trade", form),
			detail: "full",
			fixtures,
			accessories,
			nameplates,
			greebles: [],
			dispose: () => disposeSubtree(root),
		};
	};
}

const ready = new Map<AuthoredTradeForm, Promise<void>>();
/** Boot requires only the home exterior; other forms install behind their stand-ins. */
export function prepareTradeModel(
	form: AuthoredTradeForm,
	onProgress?: ModelProgressListener,
): Promise<void> {
	let pending = ready.get(form);
	if (!pending) {
		pending = new GLTFLoader()
			.setMeshoptDecoder(MeshoptDecoder)
			.loadAsync(TRADE_GLB_URLS[form], onProgress)
			.then((gltf) => {
				installTradeBuilder(form, createTradeBuilder(form, gltf.scene));
			})
			.catch((error) => {
				ready.delete(form);
				throw error;
			});
		ready.set(form, pending);
	}
	return pending;
}
