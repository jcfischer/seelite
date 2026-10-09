/** Default Coriolis: authored exterior with production berths and navigation fittings. */
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loadingPanel, type ModelLoadView } from "./model-load-view";
import { ModelProgress } from "./model-progress";
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
import { CORIOLIS_GLB_URL } from "./model-urls";

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
		// Recess only the rendered mouth; berth coordinates remain the sim's.
		const bay = buildStationInterior("trade", interior, 0.03);
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

/** `GLTFLoader`'s `onProgress`: bytes received of a model, and its total (0
 *  when the response has no length). */
export type ModelProgressListener = (event: ProgressEvent) => void;

let ready: Promise<void> | undefined;
/** Await before any game, postcard or station workbench constructs station
 * geometry. `onProgress` hears the download this call starts; a call that
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

/**
 * Every model a page needs before it builds its world, downloaded behind a
 * visible Retry (#833 split it from the panel that draws it). `also` names
 * the page's other required models — a Game's cockpit (`cockpit-model.ts`).
 * `view` draws the state: the loading panel, or the Commander overlay that
 * opens during the download. A failure waits on the view's Retry and tries
 * again; it never throws, so the boot cannot proceed without the models.
 */
export async function loadRequiredModels(
	also: readonly ((onProgress?: ModelProgressListener) => Promise<void>)[],
	view: ModelLoadView,
): Promise<void> {
	const loads = [prepareCoriolisModel, ...also];
	const ids = loads.map((_, i) => String(i));
	for (;;) {
		const progress = new ModelProgress(ids);
		const show = () => view({ kind: "loading", fraction: progress.fraction() });
		show();
		try {
			await Promise.all(
				loads.map((load, i) =>
					load((e) => {
						progress.report(
							ids[i] as string,
							e.loaded,
							e.lengthComputable ? e.total : 0,
						);
						show();
					}).then(() => {
						progress.complete(ids[i] as string);
						show();
					}),
				),
			);
			view({ kind: "done" });
			return;
		} catch (error) {
			console.warn("Model download failed", error);
			await new Promise<void>((retry) => view({ kind: "failed", retry }));
		}
	}
}

/** The asset is required for the world, so an interrupted download gets a
 * visible retry before any Game (or save-store attachment) is constructed.
 * The full-screen panel's form of `loadRequiredModels`, for every page whose
 * world waits on nothing else. */
export function prepareCoriolisPage(
	also: readonly ((onProgress?: ModelProgressListener) => Promise<void>)[] = [],
): Promise<void> {
	return loadRequiredModels(
		also,
		loadingPanel(also.length ? "game" : "station"),
	);
}
