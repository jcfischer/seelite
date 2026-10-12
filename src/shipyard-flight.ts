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
import { fetchBundled } from "./bundle-fetch";
import { disposeSubtree, shared } from "./gpu-teardown";
import { EMISSIVE_CEILING } from "./light-rig";
import type { ModelLoader, ModelProgressListener } from "./model-progress";
import {
	SHIPYARD_GLB_URLS,
	SHIPYARD_LIGHTMAP_URLS,
	SHIPYARD_PROBE_URLS,
} from "./model-urls";
import type { ProbeGrid, YardWorkLight } from "./ship-work-light";
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

/**
 * How bright the baked work lights draw (principal, 2026-10-12: the yards were
 * too dark, and the light is baked). The lightmap holds Blender's light-only
 * diffuse bake divided by the model's `lightmap_scale`; three.js reads a
 * lightmap as irradiance and divides it by π, so π restores Blender's shading
 * and this gain is the one figure tuned by eye.
 */
export const WORK_LIGHT_GAIN = 12;

/** A dev URL's number, for tuning by eye: `?<name>=<value>`. */
function tuning(name: string, fallback: number): number {
	if (typeof location === "undefined") return fallback;
	const value = Number(new URLSearchParams(location.search).get(name));
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Which work lights a dev build draws, for the principal's comparison on
 * 2026-10-12: `?worklights=baked` (the default), `realtime` (`REALTIME_WORK_LIGHTS`,
 * no lightmap) or `off` (neither).
 */
export type WorkLightMode = "baked" | "realtime" | "off";
export function workLightMode(): WorkLightMode {
	if (typeof location === "undefined") return "baked";
	const mode = new URLSearchParams(location.search).get("worklights");
	return mode === "realtime" || mode === "off" ? mode : "baked";
}
/** The real-time arm the comparison shows: measured on O1 (M1 Pro, retina),
 *  8 unshadowed lights cost +1.2 ms a frame and 16 cost +18 ms. */
export const REALTIME_WORK_LIGHTS: WorkLightConfig = {
	count: 8,
	shadows: 4,
	shadowUpdate: "frame",
	intensity: 50,
};

/** How bright the work lights draw on a ship's hull, against the grid's
 *  figures; tuned by eye like `WORK_LIGHT_GAIN`. */
export const SHIP_WORK_LIGHT_GAIN = 1;
/** What the dev panel (`worklight-tuner.ts`) moves while the principal flies:
 *  the bake's gain and the real-time arm, starting from the URL's figures. */
export const workLightTuning = {
	mode: workLightMode(),
	gain: tuning("worklight-gain", WORK_LIGHT_GAIN),
	shipGain: tuning("worklight-ship-gain", SHIP_WORK_LIGHT_GAIN),
	realtime: {
		...REALTIME_WORK_LIGHTS,
		intensity: tuning(
			"worklight-intensity",
			REALTIME_WORK_LIGHTS.intensity ?? 50,
		),
	} as WorkLightConfig,
};
/** A comparison URL loads the lightmap in every mode, so the panel can switch. */
const comparing =
	typeof location !== "undefined" &&
	new URLSearchParams(location.search).has("worklights");
const lightmapped = new Set<{
	material: THREE.MeshStandardMaterial;
	scale: number;
	map: THREE.Texture;
}>();
const shipyardRoots = new Set<THREE.Object3D>();
/** The bake's gain, on every lightmapped material now and every one after. */
export function setWorkLightGain(gain: number): void {
	workLightTuning.gain = gain;
	for (const { material, scale } of lightmapped)
		material.lightMapIntensity = scale * Math.PI * gain;
}
/** The real-time arm, on every drawn yard now and every one built after. */
export function setRealtimeWorkLights(config: WorkLightConfig): void {
	workLightTuning.realtime = config;
	if (workLightTuning.mode !== "realtime") return;
	for (const root of shipyardRoots) setWorkLights(root, config);
}
/** Switch every drawn yard, and every one built after, to `mode`. */
export function setWorkLightMode(mode: WorkLightMode): void {
	workLightTuning.mode = mode;
	for (const { material, scale, map } of lightmapped) {
		material.lightMap = mode === "baked" ? map : null;
		material.lightMapIntensity = scale * Math.PI * workLightTuning.gain;
		material.needsUpdate = true;
	}
	for (const root of shipyardRoots)
		setWorkLights(root, mode === "realtime" ? workLightTuning.realtime : null);
}
if (
	typeof document !== "undefined" &&
	new URLSearchParams(location.search).has("worklights")
)
	void import("./worklight-tuner").then((m) => m.mountWorkLightTuner());

/**
 * Put a yard's baked lightmap on every material of `template`, read through
 * the model's second UV set. Shared by the game and the study viewer.
 */
export function applyShipyardLightmap(
	template: THREE.Object3D,
	lightmap: THREE.Texture,
): void {
	let scale = 1;
	template.traverse((o) => {
		if (typeof o.userData.lightmap_scale === "number")
			scale = o.userData.lightmap_scale;
	});
	lightmap.channel = 1;
	lightmap.flipY = false;
	lightmap.colorSpace = THREE.SRGBColorSpace;
	lightmap.needsUpdate = true;
	template.traverse((o) => {
		if (!(o instanceof THREE.Mesh) || !o.geometry.getAttribute("uv1")) return;
		for (const m of Array.isArray(o.material) ? o.material : [o.material])
			if (m instanceof THREE.MeshStandardMaterial) {
				m.lightMap = workLightTuning.mode === "baked" ? lightmap : null;
				m.lightMapIntensity = scale * Math.PI * workLightTuning.gain;
				m.needsUpdate = true;
				lightmapped.add({ material: m, scale, map: lightmap });
			}
	});
}

/** A yard's probe grid: the float16 file, scaled back by the figures the
 *  export left on its root (`work_light_probes`). Null when either is missing. */
export function decodeProbeGrid(
	template: THREE.Object3D,
	bytes: ArrayBuffer,
): ProbeGrid | null {
	let meta: {
		origin: number[];
		size: [number, number, number];
		step: number;
		scale: number;
	} | null = null;
	template.traverse((o) => {
		if (typeof o.userData.work_light_probes === "string")
			meta = JSON.parse(o.userData.work_light_probes);
	});
	if (!meta) return null;
	const { origin, size, step, scale } = meta;
	const half = new Uint16Array(bytes);
	if (half.length !== size[0] * size[1] * size[2] * 12) return null;
	const data = new Float32Array(half.length);
	for (let i = 0; i < half.length; i++)
		data[i] = THREE.DataUtils.fromHalfFloat(half[i]) * scale;
	return {
		origin: new THREE.Vector3(origin[0], origin[1], origin[2]),
		step,
		size,
		data,
	};
}
const probeGrids = new Map<ShipyardForm, ProbeGrid>();

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
		const mesh: StationMesh = {
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
		const grid = probeGrids.get(form);
		if (grid) {
			const workLight: YardWorkLight = {
				grid,
				frame: authored,
				gain: () =>
					workLightTuning.mode === "baked" ? workLightTuning.shipGain : 0,
			};
			root.userData.workLight = workLight;
		}
		if (comparing) {
			if (workLightTuning.mode === "realtime")
				setWorkLights(root, workLightTuning.realtime);
			shipyardRoots.add(root);
			const dispose = mesh.dispose;
			mesh.dispose = () => {
				shipyardRoots.delete(root);
				dispose();
			};
		}
		return mesh;
	};
}

const ready = new Map<ShipyardForm, Promise<void>>();

/** Load and install one form. A failure clears its promise, so a Retry
 *  fetches again; `onProgress` hears the download this call starts. */
export function prepareShipyardModel(
	form: ShipyardForm,
	onProgress?: ModelProgressListener,
): Promise<void> {
	let promise = ready.get(form);
	if (!promise) {
		// The lightmap is light, not shape: a yard whose lightmap fails still
		// installs, dark as before.
		const lightmap =
			workLightMode() === "baked" || comparing
				? new THREE.TextureLoader()
						.loadAsync(SHIPYARD_LIGHTMAP_URLS[form])
						.catch((error) => {
							console.warn(`shipyard ${form}: no work-light lightmap`, error);
							return null;
						})
				: Promise.resolve(null);
		const probes =
			workLightMode() === "baked" || comparing
				? // A file of this bundle (#830), fetched as `bundle-fetch.ts` allows;
					// in the chain, so a failure is the catch's, as the lightmap's is.
					Promise.resolve()
						.then(() =>
							fetchBundled(
								new URL(SHIPYARD_PROBE_URLS[form], location.href).pathname,
							),
						)
						.then((r) => (r.ok ? r.arrayBuffer() : null))
						.catch(() => null)
				: Promise.resolve(null);
		promise = new GLTFLoader()
			.setMeshoptDecoder(MeshoptDecoder)
			.loadAsync(SHIPYARD_GLB_URLS[form], onProgress)
			.then(async (gltf) => {
				const map = await lightmap;
				const bytes = await probes;
				// Light, not shape: a grid that will not decode leaves the ships
				// unlit and the yard installed.
				let grid: ProbeGrid | null = null;
				try {
					grid = bytes && decodeProbeGrid(gltf.scene, bytes);
				} catch (error) {
					console.warn(`shipyard ${form}: no work-light grid`, error);
				}
				if (grid) probeGrids.set(form, grid);
				if (map) {
					applyShipyardLightmap(gltf.scene, map);
					shared(map);
				}
				installShipyardBuilder(form, createShipyardBuilder(form, gltf.scene));
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

/**
 * The real-time alternative to the baked work lights, for measuring it
 * (principal, 2026-10-12: "build full occlusion lights and measure"). A spot
 * light at each of the first `count` flood marks the export carries
 * (`worklight-flood-*`, aimed along local −Z); the first `shadows` of them cast
 * shadows, re-rendered every frame or rendered once. `null` removes them.
 * Returns how many lights were added. Not wired into the game: a measurement
 * reaches it through `window.__setWorkLights` on a dev server.
 */
/** `count` of the marks, spread over the yard: each next one the farthest from
 *  those already taken, from the one nearest the marks' centre. */
function spread(marks: THREE.Object3D[], count: number): THREE.Object3D[] {
	if (marks.length <= count) return marks;
	const at = marks.map((m) => m.getWorldPosition(new THREE.Vector3()));
	const centre = at
		.reduce((s, p) => s.add(p), new THREE.Vector3())
		.divideScalar(at.length);
	let first = 0;
	at.forEach((p, i) => {
		if (p.distanceTo(centre) < at[first].distanceTo(centre)) first = i;
	});
	const taken = [first];
	const nearest = at.map((p) => p.distanceTo(at[first]));
	while (taken.length < count) {
		let next = 0;
		nearest.forEach((d, i) => {
			if (d > nearest[next]) next = i;
		});
		taken.push(next);
		at.forEach((p, i) => {
			nearest[i] = Math.min(nearest[i], p.distanceTo(at[next]));
		});
	}
	return taken.map((i) => marks[i]);
}

export interface WorkLightConfig {
	count: number;
	shadows: number;
	shadowUpdate: "frame" | "once";
	intensity?: number;
	mapSize?: number;
}
export function setWorkLights(
	root: THREE.Object3D,
	config: WorkLightConfig | null,
): number {
	const old: THREE.Object3D[] = [];
	root.traverse((o) => {
		// Their own key: a yard's root carries `workLight`, its probe grid.
		if (o.userData.realtimeWorkLight) old.push(o);
	});
	for (const o of old) {
		o.removeFromParent();
		if (o instanceof THREE.SpotLight) o.dispose();
	}
	if (!config) return 0;
	// A builder calls this before the root is placed; read the marks in its frame.
	root.updateMatrixWorld(true);
	const marks: THREE.Object3D[] = [];
	root.traverse((o) => {
		if (o.name.startsWith("worklight-flood-")) marks.push(o);
	});
	marks.sort((a, b) => (a.name < b.name ? -1 : 1));
	const lights = spread(marks, config.count);
	lights.forEach((mark, i) => {
		const light = new THREE.SpotLight(
			0xeaf2ff,
			config.intensity ?? 3,
			0,
			THREE.MathUtils.degToRad(40),
			0.45,
			0,
		);
		light.userData.realtimeWorkLight = true;
		light.target.userData.realtimeWorkLight = true;
		light.target.position.set(0, 0, -1);
		mark.add(light, light.target);
		if (i < config.shadows) {
			light.castShadow = true;
			const size = config.mapSize ?? 1024;
			light.shadow.mapSize.set(size, size);
			// The near layer draws in kilometres: 2 m to 4 km.
			light.shadow.camera.near = 0.002;
			light.shadow.camera.far = 4;
			light.shadow.bias = -0.0002;
			light.shadow.normalBias = 0.0005;
			if (config.shadowUpdate === "once") {
				light.shadow.autoUpdate = false;
				light.shadow.needsUpdate = true;
			}
		}
	});
	return lights.length;
}
if (typeof window !== "undefined" && import.meta.env?.DEV)
	(
		window as unknown as { __setWorkLights: typeof setWorkLights }
	).__setWorkLights = setWorkLights;
