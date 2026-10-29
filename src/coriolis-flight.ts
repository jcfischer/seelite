/** Default Coriolis: authored exterior with production berths and navigation fittings. */
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeSubtree, shared } from "./gpu-teardown";
import { EMISSIVE_CEILING } from "./light-rig";
import { loadingPanel, loadRequiredModels } from "./model-load-view";
import type { ModelLoader, ModelProgressListener } from "./model-progress";
import { CORIOLIS_GLB_URL } from "./model-urls";
import { STATION_GEOMETRY } from "./station";
import { stationInterior } from "./station-interior";
import { buildStationInterior, NAMEPLATE_NAME } from "./station-interior-mesh";
import {
	buildCoriolisNavigation,
	installCoriolisBuilder,
	type StationFixture,
	type StationMesh,
	stationSilhouetteKm,
} from "./station-mesh";

/** Spike (station-scale F7): warm authored paint, lifted, in place of the role tint. */
export const CORIOLIS_PAINT_LIFT = 2.3;
/** Spike (station-scale F7): station-scoped light lift instead of global exposure. */
export const CORIOLIS_ENV_LIFT = 1.8;

/** Spike (station-scale lighting F20): the sun's share on Coriolis surfaces. */
export const CORIOLIS_KEY_GAIN = 2;
/** Spike (station-scale lighting F20): the hemisphere's share on Coriolis surfaces. */
export const CORIOLIS_AMBIENT_GAIN = 0.6;
/** Spike (station-scale lighting F21): navigation beacons above the bloom threshold. */
export const CORIOLIS_BEACON_GAIN = 8;

/** Spike (station-scale lighting F22): grazing rim light that outlines the shaded side. */
export const CORIOLIS_RIM = { value: 0 };
const RIM_COLOR = "vec3( 0.55, 0.62, 0.8 )";

const DIRECT_LINE = "getDirectionalLightInfo( directionalLight, directLight );";
const HEMISPHERE_LINE =
	"irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );";

/** The lights chunk with the Coriolis key and ambient gains spliced in. */
export function coriolisLightsChunk(
	chunk = THREE.ShaderChunk.lights_fragment_begin,
) {
	if (!chunk.includes(DIRECT_LINE) || !chunk.includes(HEMISPHERE_LINE))
		throw new Error(
			"three's lights_fragment_begin no longer matches the Coriolis splice",
		);
	const rim = `\nreflectedLight.indirectDiffuse += coriolisRim * pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 3.0 ) * ${RIM_COLOR} * diffuseColor.rgb;\n`;
	return `${chunk}${rim}`
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

const keyLit = new WeakSet<THREE.Material>();
function applyCoriolisKeyLight(m: THREE.MeshStandardMaterial) {
	if (keyLit.has(m) || m.emissive.getHex() !== 0) return;
	keyLit.add(m);
	m.userData.coriolisRim = CORIOLIS_RIM;
	const previous = m.onBeforeCompile;
	const previousKey = m.customProgramCacheKey;
	m.onBeforeCompile = (shader, renderer) => {
		previous.call(m, shader, renderer);
		shader.uniforms.coriolisRim = CORIOLIS_RIM;
		shader.fragmentShader = `uniform float coriolisRim;\n${shader.fragmentShader.replace(
			"#include <lights_fragment_begin>",
			coriolisLightsChunk(),
		)}`;
	};
	m.customProgramCacheKey = () => `${previousKey.call(m)}|coriolis-key`;
}

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
	for (const m of materials) {
		m.emissiveIntensity /= divisor;
		if (/^navigation-(red|green)$/.test(m.name))
			m.emissiveIntensity *= CORIOLIS_BEACON_GAIN;
		if (m.emissive.getHex() === 0) m.envMapIntensity = CORIOLIS_ENV_LIFT;
	}
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
		exterior.traverse((o) => {
			if (o instanceof THREE.Mesh)
				for (const m of Array.isArray(o.material) ? o.material : [o.material])
					if (m instanceof THREE.MeshStandardMaterial) applyCoriolisKeyLight(m);
		});
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
				paint.color.copy(o.material.color).multiplyScalar(CORIOLIS_PAINT_LIFT);
				paint.roughness = Math.max(paint.roughness, 0.82);
				palettes.set(key, paint);
			}
			applyCoriolisKeyLight(paint);
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
	return createIndustrialCoriolisBuilder(gltf.scene);
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
