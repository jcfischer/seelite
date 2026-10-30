/** Default Coriolis: authored exterior with production berths and navigation fittings. */
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loadingPanel, loadRequiredModels } from "./model-load-view";
import type { ModelLoader, ModelProgressListener } from "./model-progress";
import {
	buildCoriolisNavigation,
	installCoriolisBuilder,
	setStationDetail,
	type StationFixture,
	stationSilhouetteKm,
	type StationMesh,
} from "./station-mesh";
import { STATION_GEOMETRY } from "./station";
import { stationInterior } from "./station-interior";
import { buildStationInterior, NAMEPLATE_NAME } from "./station-interior-mesh";
import { EMISSIVE_CEILING } from "./light-rig";
import { shared, disposeSubtree } from "./gpu-teardown";
import { CORIOLIS_DETAIL_GLB_URL, CORIOLIS_GLB_URL } from "./model-urls";

/** Principal ruling: https://github.com/jcfischer/seelite/issues/1142 */
export const CORIOLIS_PAINT_LIFT = 2.3;
export const CORIOLIS_KEY_GAIN = 2;
export const CORIOLIS_AMBIENT_GAIN = 0.6;
/** Navigation lamps alone exceed EMISSIVE_CEILING to bloom, at the principal's gain:
 * https://github.com/jcfischer/seelite/issues/1142#issuecomment-6526047964 */
export const CORIOLIS_BEACON_GAIN = 8;

export const isCoriolisBeacon = (name: string) =>
	name === "navigation-red" || name === "navigation-green";

const DIRECT_LINE = "getDirectionalLightInfo( directionalLight, directLight );";
const HEMISPHERE_LINE =
	"irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );";
const LIGHTS_INCLUDE = "#include <lights_fragment_begin>";

export function coriolisLightsChunk(
	chunk = THREE.ShaderChunk.lights_fragment_begin,
) {
	for (const marker of [DIRECT_LINE, HEMISPHERE_LINE])
		if (chunk.split(marker).length !== 2)
			throw new Error(
				"three's lights_fragment_begin no longer matches the Coriolis splice",
			);
	return chunk
		.replace(
			DIRECT_LINE,
			`${DIRECT_LINE}\n\t\tdirectLight.color *= ${CORIOLIS_KEY_GAIN.toFixed(3)};`,
		)
		.replace(
			HEMISPHERE_LINE,
			HEMISPHERE_LINE.replace(
				"irradiance += ",
				`irradiance += ${CORIOLIS_AMBIENT_GAIN.toFixed(3)} * `,
			),
		);
}

const keyLit = new WeakSet<THREE.MeshStandardMaterial>();
function applyCoriolisKeyLight(material: THREE.MeshStandardMaterial) {
	if (keyLit.has(material) || material.emissive.getHex() !== 0) return;
	keyLit.add(material);
	const previous = material.onBeforeCompile;
	const previousKey = material.customProgramCacheKey();
	material.onBeforeCompile = (shader, renderer) => {
		previous.call(material, shader, renderer);
		if (shader.fragmentShader.split(LIGHTS_INCLUDE).length !== 2)
			throw new Error(
				"Coriolis material no longer includes three's lights_fragment_begin",
			);
		shader.fragmentShader = shader.fragmentShader.replace(
			LIGHTS_INCLUDE,
			coriolisLightsChunk(),
		);
	};
	material.customProgramCacheKey = () =>
		`${previousKey}|coriolis-key-${CORIOLIS_KEY_GAIN}-ambient-${CORIOLIS_AMBIENT_GAIN}`;
}

function standardMaterials(root: THREE.Object3D) {
	const materials = new Set<THREE.MeshStandardMaterial>();
	root.traverse((o) => {
		if (o instanceof THREE.Mesh)
			for (const m of Array.isArray(o.material) ? o.material : [o.material])
				if (m instanceof THREE.MeshStandardMaterial) materials.add(m);
	});
	return materials;
}

export function emissiveDivisor(
	materials: Iterable<THREE.MeshStandardMaterial>,
) {
	return Math.max(
		1,
		...[...materials].map((m) => m.emissiveIntensity / EMISSIVE_CEILING),
	);
}

function exposeCoriolisMaterial(
	m: THREE.MeshStandardMaterial,
	divisor: number,
) {
	m.emissiveIntensity /= divisor;
	if (isCoriolisBeacon(m.name)) m.emissiveIntensity *= CORIOLIS_BEACON_GAIN;
	applyCoriolisKeyLight(m);
}

export type IndustrialCoriolisBuilder = ((
	berthSeed: number,
	color: number,
) => StationMesh) & {
	addDetail(detail: THREE.Group): void;
};

export function createIndustrialCoriolisBuilder(
	template: THREE.Group,
	requestDetail: () => void = () => {},
): IndustrialCoriolisBuilder {
	const materials = standardMaterials(template);
	const divisor = emissiveDivisor(materials);
	for (const m of materials) exposeCoriolisMaterial(m, divisor);
	const byName = new Map([...materials].map((m) => [m.name, m]));
	const maps = new Map<string, THREE.Texture>();
	for (const m of materials) if (m.map) maps.set(m.map.name, m.map);
	let detail: THREE.Group | undefined;
	const live = new Map<StationMesh, THREE.Object3D>();
	const attach = (mesh: StationMesh, exterior: THREE.Object3D) => {
		if (!detail) return;
		for (const part of detail.children) {
			const copy = part.clone(true);
			exterior.add(copy);
			copy.traverse((o) => {
				if (o.userData.minDetail) mesh.accessories.push(o);
			});
		}
		exterior.updateMatrixWorld(true);
		setStationDetail(mesh, mesh.detail);
	};
	// https://github.com/jcfischer/seelite/issues/1142
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
	const build = (berthSeed: number, _color: number): StationMesh => {
		const exterior = template.clone(true);
		exterior.scale.setScalar(0.001);
		exterior.traverse((o) => {
			if (
				!(o instanceof THREE.Mesh) ||
				!(o.material instanceof THREE.MeshStandardMaterial) ||
				!o.name.startsWith("ceramic-steel-")
			)
				return;
			const key = o.material.uuid;
			let paint = palettes.get(key);
			if (!paint) {
				paint = shared(o.material.clone());
				paint.color.multiplyScalar(CORIOLIS_PAINT_LIFT);
				paint.roughness = Math.max(paint.roughness, 0.82);
				applyCoriolisKeyLight(paint);
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
		// Recess only the rendered mouth; berth coordinates remain the sim's.
		const bay = buildStationInterior("trade", interior, 0.03, berthSeed);
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
		const mesh: StationMesh = {
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
			dispose: () => {
				live.delete(mesh);
				disposeSubtree(root);
			},
			lateDetail: {
				request: () => {
					if (!detail) requestDetail();
				},
				get attached() {
					return detail !== undefined;
				},
			},
		};
		if (detail) attach(mesh, exterior);
		else live.set(mesh, exterior);
		return mesh;
	};
	const addDetail = (scene: THREE.Group) => {
		if (detail) return;
		scene.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			o.castShadow = true;
			o.receiveShadow = true;
			shared(o.geometry);
			const own = o.material as THREE.MeshStandardMaterial;
			const base = byName.get(own.name);
			if (base) {
				o.material = base;
				return;
			}
			exposeCoriolisMaterial(own, divisor);
			const map = maps.get(own.userData.baseColorMap);
			if (map) {
				own.map = map;
				own.needsUpdate = true;
			}
			byName.set(own.name, shared(own));
		});
		detail = scene;
		for (const [mesh, exterior] of live) attach(mesh, exterior);
		live.clear();
	};
	return Object.assign(build, { addDetail });
}

async function loadIndustrialStationBuilder(
	onProgress?: ModelProgressListener,
) {
	const gltf = await new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.loadAsync(CORIOLIS_GLB_URL, onProgress);
	gltf.scene.traverse((o) => {
		if (o instanceof THREE.Mesh) {
			o.castShadow = true;
			o.receiveShadow = true;
		}
	});
	let detail: Promise<void> | undefined;
	const build = createIndustrialCoriolisBuilder(gltf.scene, () => {
		detail ??= new GLTFLoader()
			.setMeshoptDecoder(MeshoptDecoder)
			.loadAsync(CORIOLIS_DETAIL_GLB_URL)
			.then((loaded) => build.addDetail(loaded.scene))
			.catch((error) =>
				console.warn("Coriolis scale detail failed to load", error),
			);
	});
	return build;
}

let ready: Promise<void> | undefined;
/** Required when the home exterior or postcard frame draws trade/a; otherwise
 * the session queue installs this behind the procedural stand-in. `onProgress` hears the download this call starts; a call that
 * finds one already started or done hears nothing, and the boot's tracker
 * counts it on resolve (`model-progress.ts`). */
export function prepareCoriolisModel(
	onProgress?: ModelProgressListener,
): Promise<void> {
	return (ready ??= loadIndustrialStationBuilder(onProgress)
		.then(installCoriolisBuilder)
		.catch((error) => {
			ready = undefined;
			throw error;
		}));
}

/** Workbench loading panel. Game and postcard boot select their required
 * model IDs in main.ts instead of unconditionally requiring a Coriolis. */
export function prepareCoriolisPage(
	also: readonly ModelLoader[] = [],
): Promise<void> {
	return loadRequiredModels(
		[prepareCoriolisModel, ...also],
		loadingPanel(also.length ? "game" : "station"),
	);
}
