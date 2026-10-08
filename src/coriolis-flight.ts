/** Default Coriolis: authored exterior with production berths and navigation fittings. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
	buildCoriolisNavigation,
	installCoriolisBuilder,
	type StationFixture,
	stationSilhouetteKm,
	type StationMesh,
} from "./station-mesh";
import { STATION_GEOMETRY } from "./station";
import { stationInterior } from "./station-interior";
import { buildStationInterior, NAMEPLATE_NAME } from "./station-interior-mesh";
import { EMISSIVE_CEILING } from "./light-rig";
import { shared, disposeSubtree } from "./gpu-teardown";

export function createIndustrialCoriolisBuilder(template: THREE.Group) {
	// The display export has brighter lamps than the game's exposure contract.
	// Normalize once, preserving the authored relative strengths.
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
	const base =
		[...materials].find((m) => m.name === "ceramic-steel-0")?.color.clone() ??
		new THREE.Color(1, 1, 1);
	// A small palette per requested role colour, retained with the loaded asset.
	const palettes = new Map<string, THREE.MeshStandardMaterial>();
	// One loaded asset for this page, retained across system changes.
	template.name = "industrial-coriolis-exterior";
	template.traverse((o) => {
		if (o instanceof THREE.Mesh) {
			shared(o.geometry);
			for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
				shared(m);
				for (const value of Object.values(m))
					if (value instanceof THREE.Texture) shared(value);
			}
		}
	});
	return (berthSeed: number, color: number): StationMesh => {
		const exterior = template.clone(true);
		exterior.scale.setScalar(0.001);
		const tint = new THREE.Color(color);
		exterior.traverse((o) => {
			if (
				!(o instanceof THREE.Mesh) ||
				!(o.material instanceof THREE.MeshStandardMaterial) ||
				!o.name.startsWith("ceramic-steel-")
			)
				return;
			const key = o.material.uuid + "/" + color;
			let paint = palettes.get(key);
			if (!paint) {
				paint = shared(o.material.clone());
				// Keep panel-to-panel contrast while applying the station role's paint.
				paint.color.setRGB(
					(o.material.color.r * tint.r) / base.r,
					(o.material.color.g * tint.g) / base.g,
					(o.material.color.b * tint.b) / base.b,
				);
				palettes.set(key, paint);
			}
			o.material = paint;
			if (o.name === "ceramic-steel-0") o.name = "core";
		});
		const spinner = new THREE.Group();
		spinner.name = "industrial-coriolis-spinner";
		const geometry = STATION_GEOMETRY.trade;
		const interior = stationInterior(
			"trade",
			geometry.aperturePlaneKm,
			berthSeed,
		);
		const bay = buildStationInterior("trade", interior);
		// The authored hull skin is 24.5m behind the aperture plane. Recess
		// only the bay mouth and trim its side walls; berths stay at sim coordinates.
		const recess = 0.03;
		bay.traverse((o) => {
			if (o.name === "interior-bulkhead" || o.name === "interior-lane-edge")
				o.position.z -= recess;
			if (o.name === "interior-shell" || o.name === "interior-rail") {
				// These boxes use a shared unit cube; scale.z is their actual depth.
				o.scale.z -= recess;
				o.position.z -= recess / 2;
			}
		});
		const fixtures: StationFixture[] = [];
		const aperture = buildCoriolisNavigation(fixtures, exterior);
		aperture.add(bay);
		spinner.add(exterior, aperture);
		exterior.traverse((o) => {
			if (o.name === "habitation-amber") {
				o.name = "windows";
				o.userData.minDetail = "reduced";
			}
		});
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
			formId: "a",
			silhouetteKm: stationSilhouetteKm("trade", "a"),
			detail: "full",
			fixtures,
			accessories,
			nameplates,
			greebles: [],
			dispose: () => disposeSubtree(root),
		};
	};
}

async function loadIndustrialStationBuilder() {
	const gltf = await new GLTFLoader().loadAsync(
		"/spikes/coriolis/coriolis-industrial-flight.glb",
	);
	gltf.scene.traverse((o) => {
		if (o instanceof THREE.Mesh) {
			o.castShadow = true;
			o.receiveShadow = true;
		}
	});
	return createIndustrialCoriolisBuilder(gltf.scene);
}

let ready: Promise<void> | undefined;
/** Await before any game, postcard or station workbench constructs station geometry. */
export function prepareCoriolisModel(): Promise<void> {
	return (ready ??= loadIndustrialStationBuilder().then(
		installCoriolisBuilder,
	));
}
