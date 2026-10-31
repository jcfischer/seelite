import * as THREE from "three";
import { exposeStationMaterial, exposeStationMaterials } from "./station-light";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeSubtree, shared } from "./gpu-teardown";
import type { ModelProgressListener } from "./model-progress";
import { RING_DETAIL_GLB_URL, TRADE_GLB_URLS } from "./model-urls";
import { STATION_GEOMETRY } from "./station";
import { stationInterior } from "./station-interior";
import { buildStationInterior, NAMEPLATE_NAME } from "./station-interior-mesh";
import {
	type AuthoredTradeForm,
	buildCoriolisNavigation,
	installTradeBuilder,
	setStationDetail,
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
	fetchDetail?: () => Promise<THREE.Group>,
	now: () => number = () => performance.now(),
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
	const divisor = exposeStationMaterials(materials);
	const byName = new Map([...materials].map((m) => [m.name, m]));
	const maps = new Map<string, THREE.Texture>();
	for (const m of materials) if (m.map) maps.set(m.map.name, m.map);
	let detail: THREE.Group | undefined;
	let pending = false;
	let failure: unknown;
	let retryAt = 0;
	const live = new Map<StationMesh, THREE.Object3D>();
	const attach = (mesh: StationMesh, model: THREE.Object3D) => {
		if (!detail) return;
		const copy = detail.clone(true);
		model.add(copy);
		copy.traverse((o) => {
			if (o.userData.minDetail) mesh.accessories.push(o);
		});
		model.updateMatrixWorld(true);
		setStationDetail(mesh, mesh.detail);
	};
	const addDetail = (scene: THREE.Group) => {
		if (detail) return;
		const material = (m: THREE.Material) => {
			if (!(m instanceof THREE.MeshStandardMaterial)) return shared(m);
			const base = byName.get(m.name);
			if (base) return base;
			exposeStationMaterial(m, divisor);
			const map = maps.get(m.userData.baseColorMap);
			if (map) m.map = map;
			byName.set(m.name, shared(m));
			return m;
		};
		scene.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			shared(o.geometry);
			o.material = Array.isArray(o.material)
				? o.material.map(material)
				: material(o.material);
			o.castShadow = true;
			o.receiveShadow = true;
		});
		detail = scene;
		for (const [mesh, model] of live) attach(mesh, model);
		live.clear();
	};
	const requestDetail = () => {
		if (detail || pending || !fetchDetail || now() < retryAt) return;
		pending = true;
		fetchDetail()
			.then((scene) => {
				addDetail(scene);
				failure = undefined;
			})
			.catch((error: unknown) => {
				failure = error;
				retryAt = now() + 10_000;
			})
			.finally(() => {
				pending = false;
			});
	};
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
	const build = (berthSeed: number, _color: number): StationMesh => {
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
		const mesh: StationMesh = {
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
			dispose: () => {
				live.delete(mesh);
				disposeSubtree(root);
			},
			...(fetchDetail
				? {
						lateDetail: {
							request: requestDetail,
							get attached() {
								return detail !== undefined;
							},
							get failure() {
								return failure;
							},
						},
					}
				: {}),
		};
		if (detail) attach(mesh, model);
		else if (fetchDetail) live.set(mesh, model);
		return mesh;
	};
	return Object.assign(build, { addDetail });
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
				installTradeBuilder(
					form,
					createTradeBuilder(
						form,
						gltf.scene,
						form === "b"
							? async () => {
									const loaded = await new GLTFLoader()
										.setMeshoptDecoder(MeshoptDecoder)
										.loadAsync(RING_DETAIL_GLB_URL);
									return loaded.scene;
								}
							: undefined,
					),
				);
			})
			.catch((error) => {
				ready.delete(form);
				throw error;
			});
		ready.set(form, pending);
	}
	return pending;
}
