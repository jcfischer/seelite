/**
 * The authored courier cockpit (#792), as the cabin pass draws it.
 *
 * The model is a Blender export (`spikes/courier-cockpit/build_model.py`) in
 * pilot-local metres, fitted against the courier A hull at true size. The
 * cabin is drawn `CABIN_SCALE` times life size (`cabin-pass.ts`), so one model
 * metre is a tenth of a cabin kilometre, and every camera sits at the origin:
 * the model is moved so the pilot eye (`COCKPIT_MODEL_EYE_M`) lands there.
 *
 * The spike's approved pilot frame looked `COCKPIT_MODEL_PITCH_RAD` below the
 * model's forward. The game camera looks along the nose, so the model is
 * pitched up about the eye by the same angle — the frame the principal saw,
 * with the reticle on the flight direction.
 *
 * The four `screen-*` quads are where the live instruments go. They are not
 * retextured: `main.ts` mounts its own scanner, hologram and readout faces on
 * the frame `screenFrame` derives from each quad, so their names, aspect and
 * hologram alignment stay theirs. `screen-systems` has no live source and is
 * left unpowered.
 */
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CABIN_SCALE, cabinLight } from "./cabin-pass";
import { shared } from "./gpu-teardown";
import { EMISSIVE_CEILING } from "./light-rig";
import type { ModelProgressListener } from "./model-progress";
import { COURIER_COCKPIT_GLB_URL } from "./model-urls";

/** Cabin kilometres per model metre. */
export const COCKPIT_MODEL_KM_PER_M = CABIN_SCALE / 1000;

/**
 * The pilot eye, model metres: the spike's 1.15 m aft of origin (its README),
 * raised 0.3 m (node #806).
 *
 * **Raised because the principal flew the spike's frame and found the cabin
 * too high**: the dash covered the lower part of the view, and two probes had
 * to hide the cabin to see what they measure. Raising the eye moves the whole
 * cabin down the frame without turning the view onto it, so the dash is seen
 * at the angle the spike was approved at. On the centre line the dash top goes
 * from 0.548 of the frame height to 0.600, and the cabin's share of a 4:3
 * frame from 50.0% to 45.8% on a 16 x 12 grid of rays;
 * `tests/cockpit-model.test.ts` pins all four figures. What binds is the
 * scanner screen's bottom edge, which this puts at 0.959 of the height; the
 * same file holds the three live screens inside the frame with a 2% margin,
 * so under 0.98.
 * The unpowered POWER DISTRIBUTION screen reaches the frame's bottom edge.
 */
export const COCKPIT_MODEL_EYE_M = [0, 0.3, 1.15] as const;

/** How far below the model's forward the approved pilot frame looked. */
export const COCKPIT_MODEL_PITCH_RAD = 0.242;

/**
 * The live faces as the procedural cabin sized them, in its units: the
 * scanner's 2:1 plane and each readout's. `main.ts` builds its faces, hologram
 * and throttle at these figures on a `screenMount` and scales the mount, so
 * one number per screen carries all of them onto the model.
 */
export const SCANNER_FACE_KM = [0.027, 0.0135] as const;
export const INSTRUMENT_FACE_KM = [0.0118, 0.0059] as const;

export const COCKPIT_SCREENS = [
	"radar",
	"flight",
	"systems",
	"target",
] as const;
export type CockpitScreen = (typeof COCKPIT_SCREENS)[number];

/**
 * How much brighter the cabin's console lamps read than the spike struck them
 * (node #887): **2.8×**, set by the principal on the live panel in the cockpit and again
 * in the docked cabin.
 *
 * Applied by `main.ts` to each lamp's authored figure **on the way into** `carriedLamp`,
 * rather than written into `COCKPIT_MODEL_LAMPS`, because those figures are the authored
 * study's — `build_model.py`'s emission figures for the housings under the console — and
 * the model owns them. What the game decided is that they were too dim: with the frame
 * lamps off, the centre of the view reads mean 18.5 with a q25 of 1, which is the "dark
 * room with a bright dashboard" this node started from.
 *
 * Going in rather than coming out is equivalent, and it is worth saying why, because the
 * two readings are easy to confuse: `cabinLight`'s carry multiplies intensity by
 * `k^decay`, which is linear in intensity, so scaling the authored figure by 2.8 before
 * the carry scales the cabin's figure by 2.8 as well.
 *
 * **Where the guard lives.** Sage caught #898 twice on this exact point: a test that
 * multiplies the constant by an authored figure cannot see the gain being deleted from
 * `main.ts`, and the suite stays green when the picture goes dark. So the composition is
 * a function here — `carriedConsoleLamp` — the game calls that function and nothing else,
 * and `tests/cabin-lighting-ruling.test.ts` holds both halves: that the composition
 * commutes with the carry, and that `main.ts` reaches for it. Neither half alone is a
 * guard.
 */
export const COCKPIT_MODEL_LAMP_GAIN = 2.8;

/**
 * The spike's under-console lamps, model metres and the viewer's figures.
 * `main.ts` carries them into the cabin's frame by `cabinLight`, at
 * `COCKPIT_MODEL_KM_PER_M`. Names are the procedural cabin's, which probes and
 * the quality gate address them by; `gated` lamps go dark at low quality.
 */
export const COCKPIT_MODEL_LAMPS = [
	{
		name: "cockpit-light",
		gated: false,
		color: 0x39c2e8,
		intensity: 5,
		rangeM: 4,
		positionM: [-1.6, -1.65, -1.65],
	},
	{
		name: "cockpit-key-light",
		gated: true,
		color: 0xffae54,
		intensity: 4,
		rangeM: 4,
		positionM: [1.6, -1.65, -1.65],
	},
	{
		name: "cockpit-centre-light",
		gated: true,
		color: 0xffb050,
		intensity: 1.5,
		rangeM: 4,
		positionM: [0, -1.65, -1.65],
	},
] as const;

/**
 * The exporter drops the multiply node's tint, so the named palette is restored
 * here (`spikes/courier-cockpit/assets.md`). Only mapped materials carry it.
 */
export const COCKPIT_TINTS: Readonly<Record<string, number>> = {
	"weathered-blue-steel": 0x405868,
	"graphite-housings": 0x283842,
	"exposed-machined-edges": 0x8d9395,
	"service-ochre": 0xbc7923,
	"guarded-red": 0x992c20,
};

/**
 * One console lamp, gained and carried into the cabin's frame. The only way the game is
 * allowed to light them — see `COCKPIT_MODEL_LAMP_GAIN`'s note on where the guard lives.
 */
export const carriedConsoleLamp = (
	lamp: (typeof COCKPIT_MODEL_LAMPS)[number],
) =>
	carriedLamp({
		...lamp,
		intensity: lamp.intensity * COCKPIT_MODEL_LAMP_GAIN,
	} as (typeof COCKPIT_MODEL_LAMPS)[number]);

/** A screen quad's frame in the cabin: where a face of a given aspect goes. */
export interface ScreenFrame {
	/** Centre, cabin kilometres. */
	center: THREE.Vector3;
	/** Unit vectors: across the screen, up it, and out of it toward the eye. */
	right: THREE.Vector3;
	up: THREE.Vector3;
	normal: THREE.Vector3;
	widthKm: number;
	heightKm: number;
}

/**
 * Derive a quad's frame from its vertices and texture coordinates.
 *
 * Keyed on the UVs rather than on vertex order, because the encoder reorders
 * vertices: `(0, 0)` is the top-left corner, `(1, 0)` top-right and `(0, 1)`
 * bottom-left, as the spike's canvases were drawn onto them.
 */
export function screenFrame(
	positions: readonly THREE.Vector3[],
	uvs: readonly THREE.Vector2[],
): ScreenFrame {
	const corner = (u: number, v: number) => {
		const i = uvs.findIndex(
			(uv) => Math.abs(uv.x - u) < 1e-3 && Math.abs(uv.y - v) < 1e-3,
		);
		if (i < 0) throw new Error(`screenFrame: no corner at uv (${u}, ${v})`);
		return positions[i];
	};
	const topLeft = corner(0, 0);
	const topRight = corner(1, 0);
	const bottomLeft = corner(0, 1);
	const across = topRight.clone().sub(topLeft);
	const upward = topLeft.clone().sub(bottomLeft);
	const center = topRight.clone().add(bottomLeft).multiplyScalar(0.5);
	const right = across.clone().normalize();
	const up = upward.clone().normalize();
	return {
		center,
		right,
		up,
		normal: right.clone().cross(up).normalize(),
		widthKm: across.length(),
		heightKm: upward.length(),
	};
}

/** The largest face of `aspect` (width / height) the frame contains. */
export function containedFace(
	frame: Pick<ScreenFrame, "widthKm" | "heightKm">,
	aspect: number,
): { widthKm: number; heightKm: number } {
	const widthKm = Math.min(frame.widthKm, frame.heightKm * aspect);
	return { widthKm, heightKm: widthKm / aspect };
}

/**
 * A group whose local frame is the screen's: +x across, +y out toward the eye
 * and +z down the screen. That is the procedural cabin's `scanner-mount`
 * frame, so its faces and hologram keep their own placement on it.
 */
export function screenMount(frame: ScreenFrame): THREE.Group {
	const mount = new THREE.Group();
	const down = frame.up.clone().negate();
	mount.quaternion.setFromRotationMatrix(
		new THREE.Matrix4().makeBasis(frame.right, frame.normal, down),
	);
	mount.position.copy(frame.center);
	return mount;
}

const LABELS: Readonly<Record<string, string>> = {
	"label-radar": "SCOPE  /  RANGE SELECT",
	"label-flight": "FLIGHT  /  RELATIVE",
	"label-systems": "POWER DISTRIBUTION",
	"label-target": "NAVIGATION COMPUTER",
};
const KEYS = [
	"1",
	"2",
	"3",
	"NAV",
	"ENT",
	"4",
	"5",
	"6",
	"DCK",
	"CLR",
	"7",
	"8",
	"9",
	"COM",
	"0",
];

/** What a `label-*` or `key-*` mesh says. Static text, never a reading. */
export const cockpitLabelText = (name: string): string =>
	name.startsWith("key-")
		? (KEYS[Number(name.slice(4))] ?? "")
		: (LABELS[name] ?? "");

/** A painted equipment label or key cap. Static text, never a reading. */
function labelMaterial(name: string): THREE.MeshBasicMaterial {
	const key = name.startsWith("key-");
	const canvas = document.createElement("canvas");
	canvas.width = key ? 256 : 768;
	canvas.height = key ? 96 : 80;
	const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
	ctx.fillStyle = "#111719";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = key ? "#e4c896" : "#aebdc0";
	ctx.font = `${key ? 52 : 46}px monospace`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(cockpitLabelText(name), canvas.width / 2, canvas.height / 2);
	const map = new THREE.CanvasTexture(canvas);
	map.colorSpace = THREE.SRGBColorSpace;
	// glTF texture coordinates are not flipped.
	map.flipY = false;
	return new THREE.MeshBasicMaterial({ map, toneMapped: false });
}

export interface AuthoredCabin {
	/** The model, already placed so the pilot eye is at the origin. */
	root: THREE.Group;
	/** Each screen quad's frame, in `root`'s parent frame. */
	screens: Record<CockpitScreen, ScreenFrame>;
	/** Model-metre placement, for lamps given in model metres. */
	modelSpace: THREE.Group;
}

let template: THREE.Group | null = null;

/**
 * The tuning a mapped model material gets: the exporter-dropped tint, its
 * finish and the albedo as a faint bump. One function so the review viewer
 * shows the materials the game ships. Unmapped materials are left alone.
 */
export function adoptCockpitMaterial(m: THREE.MeshStandardMaterial): void {
	if (!m.map) return;
	m.color.setHex(COCKPIT_TINTS[m.name] ?? 0xffffff);
	m.envMapIntensity = 1.15;
	if (m.name !== "exposed-machined-edges") {
		m.metalness = 0.65;
		m.roughness = m.name === "graphite-housings" ? 0.42 : 0.34;
	}
	m.map.anisotropy = 8;
	m.bumpMap = m.map;
	m.bumpScale = 0.004;
	m.needsUpdate = true;
}

/** A lamp of `COCKPIT_MODEL_LAMPS` carried into the cabin's frame. */
export const carriedLamp = (lamp: (typeof COCKPIT_MODEL_LAMPS)[number]) =>
	cabinLight(
		{
			positionKm: lamp.positionM,
			distanceKm: lamp.rangeM,
			intensity: lamp.intensity,
			decay: 2,
		},
		COCKPIT_MODEL_KM_PER_M,
	);

/**
 * The angle below which two faces meeting at a vertex are one smooth surface
 * (node #839), degrees.
 *
 * The export's `poly()` writes fresh vertices for every face, so every quad of
 * a swept tube is its own island and Blender's weighted-normal step had no
 * adjacent face to average with: the canopy struts were exported flat-shaded,
 * and each quad caught the sun's highlight whole or not at all. Exported, the
 * angles between split normals cluster at the tubes' facet steps — 18°, 22.5°,
 * 30° and 36° for 20-, 16-, 12- and 10-sided sections — and at 45° (chamfer
 * steps and eight-sided studs) and 90° (box edges). Nothing lies between
 * 42.46° and 44.81°, and the crease sits in that gap;
 * `tests/cockpit-model.test.ts` holds both ends of it.
 */
export const COCKPIT_CREASE_DEG = 43.5;

/**
 * The vertex indices of `position` grouped by exact coordinates: one group per
 * point in space, holding every copy the exporter wrote for it. Exact, because
 * the model's 9 mm bevels and 5 mm chips are closer than any grid would allow.
 */
export function groupCopiesByPosition(
	position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): Map<string, number[]> {
	const groups = new Map<string, number[]>();
	for (let i = 0; i < position.count; i++) {
		const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
		const group = groups.get(key);
		if (group) group.push(i);
		else groups.set(key, [i]);
	}
	return groups;
}

/**
 * Join the split normals of faces that meet inside the crease, in place.
 *
 * Each copy of a position takes the mean of every copy within the crease of
 * its own exported normal, weighted by the face's corner angle there — the
 * sum of its triangles' angles at that copy, which a quad's diagonal does not
 * change. A copy with no other copy inside the crease keeps its normal
 * exactly, so a join at or past the crease stays hard. Every join under it is
 * shaded as one surface, across the whole model and not only the struts: the
 * tubes and ducts, the shallow steps of a chamfer beside its face, and copies
 * the exporter had already weighted. Returns how many vertices it rewrote; a
 * rewrite whose copies already agreed leaves the normal where it was.
 */
export function smoothCockpitNormals(
	geometry: THREE.BufferGeometry,
	creaseDeg = COCKPIT_CREASE_DEG,
): number {
	const position = geometry.getAttribute("position");
	const normal = geometry.getAttribute("normal");
	if (!normal) return 0;
	const index = geometry.index;
	const corner = (k: number) => (index ? index.getX(k) : k);
	const weight = new Float64Array(position.count);
	const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
	const u = new THREE.Vector3();
	const v = new THREE.Vector3();
	const cross = new THREE.Vector3();
	const corners = index ? index.count : position.count;
	for (let k = 0; k < corners; k += 3) {
		const ids = [corner(k), corner(k + 1), corner(k + 2)];
		for (let n = 0; n < 3; n++) p[n].fromBufferAttribute(position, ids[n]);
		for (let n = 0; n < 3; n++) {
			u.subVectors(p[(n + 1) % 3], p[n]);
			v.subVectors(p[(n + 2) % 3], p[n]);
			weight[ids[n]] += Math.atan2(cross.crossVectors(u, v).length(), u.dot(v));
		}
	}
	const cos = Math.cos((creaseDeg * Math.PI) / 180);
	// Read once: the attribute may be quantised, and each read denormalises.
	const exported = new Float64Array(normal.count * 3);
	for (let i = 0; i < normal.count; i++)
		for (let a = 0; a < 3; a++) exported[i * 3 + a] = normal.getComponent(i, a);
	const component = (i: number, axis: number) => exported[i * 3 + axis];
	let rewritten = 0;
	for (const ids of groupCopiesByPosition(position).values()) {
		if (ids.length < 2) continue;
		const sums = new Float64Array(ids.length * 3);
		const joined: boolean[] = [];
		ids.forEach((own, m) => {
			let faces = 0;
			for (const other of ids) {
				let dot = 0;
				for (let a = 0; a < 3; a++)
					dot += component(own, a) * component(other, a);
				if (dot <= cos) continue;
				// A degenerate face still carries its direction.
				const w = weight[other] + 1e-12;
				for (let a = 0; a < 3; a++) sums[m * 3 + a] += w * component(other, a);
				faces++;
			}
			joined[m] = faces > 1;
		});
		ids.forEach((i, m) => {
			if (!joined[m]) return;
			const [x, y, z] = sums.subarray(m * 3, m * 3 + 3);
			const length = Math.hypot(x, y, z);
			normal.setXYZ(i, x / length, y / length, z / length);
			rewritten++;
		});
	}
	normal.needsUpdate = true;
	return rewritten;
}

/**
 * Smooth every distinct geometry under `root` once, as adoption does; the
 * review viewer and the instrument go through here too, so all three shade
 * the same normals. Returns how many vertices were rewritten.
 */
export function smoothCockpitScene(root: THREE.Object3D): number {
	const geometries = new Set<THREE.BufferGeometry>();
	root.traverse((o) => {
		if (o instanceof THREE.Mesh) geometries.add(o.geometry);
	});
	let rewritten = 0;
	for (const geometry of geometries)
		rewritten += smoothCockpitNormals(geometry);
	return rewritten;
}

/** Normalise and share a loaded model once, so every cabin clones it. */
export function adoptCockpitTemplate(scene: THREE.Group): void {
	const materials = new Set<THREE.MeshStandardMaterial>();
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		o.castShadow = true;
		o.receiveShadow = true;
		for (const m of Array.isArray(o.material) ? o.material : [o.material])
			if (m instanceof THREE.MeshStandardMaterial) materials.add(m);
	});
	// The export's lamps are brighter than the game's exposure contract allows.
	const divisor = Math.max(
		1,
		...[...materials].map((m) => m.emissiveIntensity / EMISSIVE_CEILING),
	);
	for (const m of materials) {
		m.emissiveIntensity /= divisor;
		adoptCockpitMaterial(m);
	}
	smoothCockpitScene(scene);
	scene.name = "authored-cockpit";
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		shared(o.geometry);
		for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
			shared(m);
			for (const value of Object.values(m))
				if (value instanceof THREE.Texture) shared(value);
		}
	});
	template = scene;
}

/** Whether `prepareCockpitModel` has finished on this page. */
export const cockpitModelReady = (): boolean => template !== null;

/**
 * One cabin's copy of the model, placed in the cabin's frame.
 *
 * Screens and labels get materials of their own, which the cabin's teardown
 * frees; everything cloned from the template is shared and survives it.
 */
export function buildAuthoredCabin(): AuthoredCabin {
	if (!template)
		throw new Error("buildAuthoredCabin: await prepareCockpitModel() first");
	const model = template.clone(true);
	const modelSpace = new THREE.Group();
	modelSpace.name = "cockpit-model-space";
	modelSpace.scale.setScalar(COCKPIT_MODEL_KM_PER_M);
	modelSpace.position.set(
		-COCKPIT_MODEL_EYE_M[0] * COCKPIT_MODEL_KM_PER_M,
		-COCKPIT_MODEL_EYE_M[1] * COCKPIT_MODEL_KM_PER_M,
		-COCKPIT_MODEL_EYE_M[2] * COCKPIT_MODEL_KM_PER_M,
	);
	modelSpace.add(model);
	const root = new THREE.Group();
	root.name = "cockpit-model";
	root.rotation.x = COCKPIT_MODEL_PITCH_RAD;
	root.add(modelSpace);
	root.updateMatrixWorld(true);
	const unpowered = new THREE.MeshBasicMaterial({ color: 0x01090b });
	const screens = {} as Record<CockpitScreen, ScreenFrame>;
	model.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		if (o.name.startsWith("label-") || o.name.startsWith("key-")) {
			o.material = labelMaterial(o.name);
			o.castShadow = false;
			return;
		}
		if (!o.name.startsWith("screen-")) return;
		const name = o.name.slice(7) as CockpitScreen;
		if (!COCKPIT_SCREENS.includes(name)) return;
		o.material = unpowered;
		o.castShadow = false;
		const position = o.geometry.getAttribute("position");
		const uv = o.geometry.getAttribute("uv");
		const positions: THREE.Vector3[] = [];
		const uvs: THREE.Vector2[] = [];
		for (let i = 0; i < position.count; i++) {
			positions.push(
				new THREE.Vector3()
					.fromBufferAttribute(position, i)
					.applyMatrix4(o.matrixWorld),
			);
			uvs.push(new THREE.Vector2().fromBufferAttribute(uv, i));
		}
		screens[name] = screenFrame(positions, uvs);
	});
	for (const name of COCKPIT_SCREENS)
		if (!screens[name])
			throw new Error(`buildAuthoredCabin: the model has no screen-${name}`);
	return { root, screens, modelSpace };
}

let ready: Promise<void> | undefined;

/** Await before any Game constructs its cabin. `onProgress` hears the
 *  download this call starts (#833), as `prepareCoriolisModel`'s does. */
export function prepareCockpitModel(
	onProgress?: ModelProgressListener,
): Promise<void> {
	return (ready ??= new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.loadAsync(COURIER_COCKPIT_GLB_URL, onProgress)
		.then((gltf) => adoptCockpitTemplate(gltf.scene))
		.catch((error) => {
			ready = undefined;
			throw error;
		}));
}

/**
 * How far a perimeter lamp stands off the frame surface it is mounted on, model
 * metres (node #887).
 *
 * The first placement of these lamps put each anchor at the centroid of a band of
 * frame vertices. A centroid of a swept tube is the **middle of solid geometry**:
 * raycast from those anchors toward the eye and the strut's inner surface was 0.180 m
 * away at one station and 0.293 m at another, so a head was drawn inside the tube and
 * its light sat inside closed geometry. `COCKPIT_LAMP.standoffKm` records the same
 * failure on the procedural arch in its own words — "without it the lamps do not
 * exist" — and that lesson did not carry across the cabin's replacement.
 *
 * So an anchor here is the **first frame surface along a look-direction from the eye**
 * — the surface the pilot actually sees — drawn back along that ray by this margin.
 * 60 mm, because the head is a flat disc that must clear whatever it stands on.
 * `tests/perimeter-lamps.test.ts` re-measures both directions against the shipped GLB.
 */
export const PERIMETER_LAMP_STANDOFF_M = 0.06;

/**
 * The look-directions the lamps were placed from: degrees off the nose, degrees
 * below the eye line, after the cabin's own pitch (`COCKPIT_MODEL_PITCH_RAD`).
 *
 * Recorded because they are how `positionM` below was derived and how it is re-derived
 * if the cabin is ever re-authored: cast from `COCKPIT_MODEL_EYE_M` along each
 * direction, take the first `weathered-blue-steel` or `exposed-machined-edges`
 * surface, stand off by `PERIMETER_LAMP_STANDOFF_M`. All six land inside the cabin
 * camera's frustum — 60° vertical at aspect 1.6 is ±42.7° horizontally, ±30°
 * vertically — at 13°/11°, 24°/7° and 33°/4°, and every one is on geometry *below* the
 * eye line, which is where `assets.md` puts the cabin's warm service lights: "below
 * window, never a huge roof bar". Nothing here crosses the centre sightline.
 */
export const PERIMETER_LAMP_LOOK_DEG = [
	[13, 11],
	[24, 7],
	[33, 4],
] as const;

/**
 * There is no lamp **head** here, only its cast, and that is a ruling rather than an
 * omission.
 *
 * The first version of these lamps carried a `MeshBasicMaterial` disc 26 cm across,
 * billboarded at the eye, in the tradition of the procedural arch's lamp — which got
 * away with it because the arch's lamps were 14.3 cm and 20 cm from the pilot. At five
 * metres in an authored cabin the disc is not a fitting: it is a flat circle of
 * uniform colour floating in front of a canopy, with no housing, no gradient and no
 * relation to anything the modeller drew. The principal's word from the live panel was
 * "totally unrealistic — just a bright circle", and they turned it to zero.
 *
 * So the light is the thing that comes back, and the fitting the cabin already has is
 * left alone: the authored model carries its own housings and `amber-work-lights`
 * strips under the window sill, which is where `assets.md` says the warm lights live.
 */

/**
 * A perimeter lamp's cast, in the cabin's own units — **not** carried through
 * `cabinLight`, and that distinction is the reason the first six contributed nothing.
 *
 * `cabinLight` multiplies a lamp's intensity by `k^decay` (`cabin-pass.ts`), because it
 * carries a *world* lamp: distances in the cabin's frame are `k = 0.1` times the
 * model's metres, so intensity has to fall by `k^decay` with them for `intensity /
 * d^decay` to come out the same at both ends. A lamp authored in model metres and
 * parented to `modelSpace` is not in that situation — it is already where it will
 * stand, and three's attenuation floor (`max(d², 0.01)` in scene units, i.e. 1 m of
 * real cabin) already flattens everything nearer than that. Multiplying by `k²` shrank
 * these six for nothing: measured on the shipped build they moved the cabin's own side
 * band by **0.00** — 18.14 with them, 18.14 with them hidden — where the three
 * under-console lamps give +0.98, +0.89 and +0.33.
 *
 * **1 is measured, and it is 8 fewer than the first figure here.** With the anchors on
 * geometry the camera could not see, brightness could not be judged from the picture at
 * all, and the figure was swept against the cabin's side band. With the anchors on the
 * frame the pilot actually sees, the same sweep on the centre of the view reads (six
 * casts off: mean 18.47, median 19.5, q25 1.0, p95 32.7, nothing blown):
 *
 * | intensity | mean | median | q25 | p95 | blown |
 * | --- | --- | --- | --- | --- | --- |
 * | 0.05 | 21.48 | 20.6 | 3.1 | 39.6 | 0.00% |
 * | 0.25 | 32.13 | 24.9 | 19.3 | 106.5 | 0.09% |
 * | 0.5 | 43.61 | 31.6 | 26.4 | 149.1 | 0.16% |
 * | **1** | **61.95** | **44.7** | **35.3** | **187.6** | **0.35%** |
 * | 2 | 90.38 | 69.5 | 53.9 | 220.6 | 0.64% |
 * | 8 | 171.06 | 163.9 | 135.3 | 249.1 | 4.29% |
 *
 * The table is why 1 was rejected — it whitens the cabin out — but **0.24 is not read
 * off it. It is the principal's figure, set by eye on the live panel in the cockpit and
 * again in the docked cabin** (the panel drove these same lights and measured the frame
 * back; it is `node scripts/tune-cabin-lights.mjs`). Re-measured on the build with
 * both figures and `CABIN_HEMISPHERE_GAIN` in place, the centre of the view reads mean
 * **31.0**, median **24.2**, p95 **100** with the six on, against 18.9 / 19.9 / 34 with
 * them off, and **0.09%** of pixels blown — a lit cabin whose shadow floor has come up,
 * at a quarter of the blown fraction the row above this one accepted. `COCKPIT_LAMP.intensity` records what
 * overshooting looks like — a lit strut reading as a white bar.
 */
export const PERIMETER_LAMP_CAST_INTENSITY = 0.24;

/**
 * The cast's cut-off in cabin kilometres: **2.2 model metres**, set on the same panel
 * run as the intensity.
 *
 * It matters more than it looks. At 3.5 m the six reach across the cabin and light the
 * far wall, which is what made the sweep blow pixels at every intensity worth having;
 * at 2.2 m they are what their name says — lamps that light the frame they sit on and
 * the surfaces near it.
 */
export const PERIMETER_LAMP_CAST_RANGE_KM = 0.22;

/** A perimeter lamp's cast as `main.ts` builds it. */
export const perimeterLampCast = () => ({
	color: 0xffc27a,
	intensity: PERIMETER_LAMP_CAST_INTENSITY,
	distanceKm: PERIMETER_LAMP_CAST_RANGE_KM,
	decay: 2,
});

/**
 * The cabin's frame lamps, on the perimeter supports the authored cabin already
 * presents to the pilot (node #887).
 *
 * The procedural arch carried six lamps along its two side rails. They went with the
 * arch when #792's authored cabin replaced the cabin those rails were bolted to, and
 * what is left of the cabin's lighting is `COCKPIT_MODEL_LAMPS`: three point lights at
 * y −1.65 model metres, under the console, below and behind an eye at y 0.3. That is
 * why the cabin reads as a dark room with a bright dashboard — the frame the pilot
 * sees catches nothing.
 *
 * The first attempt at putting them back looked for frame near the eye and found only
 * geometry 45–80° off the nose, and concluded the authored cabin presented no frame at
 * all. **That was the instrument, not the cabin**: the histogram dropped every vertex
 * more than 2.5 m from the eye, and the cabin is 4.5 m deep, so it discarded exactly
 * the forward geometry that appears in view. Re-measured without that cut, 23,669
 * frame vertices are inside the frustum, 3,023 of them within 10° of the nose. These
 * anchors come from that measurement, which is why no new canopy geometry was needed
 * and `assets.md`'s locked composition — clear centre sightline, no roof beam — is
 * untouched.
 *
 * **Every one is gated, and at low quality there is nothing of them left to see.** A
 * cast is a `PointLight`, and three evaluates every one of them for every standard
 * fragment in the cabin's scene whether it lights anything or not — the lesson
 * `cockpit-surface.ts` records from #651, and six of them is a real cost. The
 * procedural cabin's lamp pools could keep their lamp *bodies* visible on low and drop
 * only the casts, because a body was `MeshBasicMaterial`; these lamps have no body — see
 * the note above `PERIMETER_LAMP_LOOK_DEG` — so low quality shows the authored fittings
 * and none of this light. That is the honest consequence of removing the disc, and it is
 * the opposite trade from the one the arch's pools made.
 */
export const COCKPIT_PERIMETER_LAMPS = [
	{
		name: "perimeter-lamp-port-fore",
		gated: true,
		positionM: [-1.015, -1.605, -2.908],
	},
	{
		name: "perimeter-lamp-port-mid",
		gated: true,
		positionM: [-2.156, -1.492, -3.395],
	},
	{
		name: "perimeter-lamp-port-aft",
		gated: true,
		positionM: [-2.772, -1.068, -2.908],
	},
	{
		name: "perimeter-lamp-starboard-fore",
		gated: true,
		positionM: [1.015, -1.605, -2.908],
	},
	{
		name: "perimeter-lamp-starboard-mid",
		gated: true,
		positionM: [2.156, -1.492, -3.395],
	},
	{
		name: "perimeter-lamp-starboard-aft",
		gated: true,
		positionM: [2.772, -1.068, -2.908],
	},
] as const;

/**
 * The cabin's perimeter lamps, ready to add to `AuthoredCabin.modelSpace`.
 *
 * One group per lamp, holding its cast. The cast is quoted in cabin units — see
 * `PERIMETER_LAMP_CAST_INTENSITY` — and a point light's range and intensity ignore its
 * parent's scale, which is why they need no carrying here. There is no head: see the
 * note above `PERIMETER_LAMP_LOOK_DEG`.
 */
export function buildPerimeterLamps(): THREE.Group[] {
	return COCKPIT_PERIMETER_LAMPS.map((lamp) => {
		const group = new THREE.Group();
		group.name = lamp.name;
		const [x, y, z] = lamp.positionM;
		group.position.set(x, y, z);
		const cast = perimeterLampCast();
		const light = new THREE.PointLight(
			cast.color,
			cast.intensity,
			cast.distanceKm,
			cast.decay,
		);
		light.name = lamp.name;
		group.add(light);
		return group;
	});
}
