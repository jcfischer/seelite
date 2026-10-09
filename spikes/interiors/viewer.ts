const BUILD_ID = "interiors-r7-fitting-lod-20261009";
import * as THREE from "three";
import { InteriorLods, type LodRecord } from "./instanced-lod";
import type { LodMode } from "./lod";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildShipMesh } from "../../src/ship-mesh";
import { HULL_SPECS } from "../../src/hull";
import {
	FACE_ROLL,
	THEMES,
	planInterior,
	worldPoint,
	type Theme,
	type V3,
	type Kind,
} from "./layout";
import type { InteriorFace } from "../../src/station-interior";
const $ = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;
const renderer = new THREE.WebGLRenderer({
	antialias: true,
	preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.info.autoReset = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030509);
const camera = new THREE.PerspectiveCamera(
	68,
	innerWidth / innerHeight,
	// Centimetre-separated wall layers need depth precision across a 405 m bay.
	// A 0.3 m near plane produces orbit-dependent z-fighting in WebKit/Metal.
	3,
	5000,
);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 2;
controls.maxDistance = 1000;
const pmrem = new THREE.PMREMGenerator(renderer),
	room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.28;
room.dispose();
pmrem.dispose();
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ao = new SSAOPass(scene, camera, innerWidth, innerHeight, 16);
ao.kernelRadius = 12;
ao.minDistance = 0.0001;
ao.maxDistance = 0.01;
composer.addPass(ao);
const bloom = new UnrealBloomPass(
	new THREE.Vector2(innerWidth, innerHeight),
	0.12,
	0.35,
	1.2,
);
composer.addPass(bloom);
composer.addPass(new OutputPass());
composer.addPass(new SMAAPass(innerWidth, innerHeight));
const assembly = new THREE.Group(),
	fitGroup = new THREE.Group(),
	shipGroup = new THREE.Group(),
	guides = new THREE.Group(),
	kit = new THREE.Group();
assembly.add(fitGroup, shipGroup, guides);
scene.add(assembly, kit);
kit.visible = false;
THREE.Cache.enabled = true;
const assets = new Map<string, THREE.Group>();
let lods: InteriorLods;
let lodRecords: Record<string, LodRecord>;
const loader = new GLTFLoader();
let sharedPaint: THREE.Texture;
const params = new URLSearchParams(location.search);
let theme: Theme = THEMES.some((t) => t.id === params.get("theme"))
	? (params.get("theme") as Theme)
	: "civic";
let role: "trade" | "shipyard" =
		params.get("role") === "shipyard" ? "shipyard" : "trade",
	seed = params.has("seed") ? Number(params.get("seed")) >>> 0 : 205,
	plan = planInterior(theme, role, seed),
	view = "axis";
const materials = new Map<string, THREE.Material>();
const moduleNames = [
	"panel",
	"rib",
	"trunk",
	"berth",
	"command",
	"loading",
	"gangway",
	"utility",
	"crane",
	"airlock",
	"service-civic",
	"service-works",
	"service-frontier",
	"service-survey",
	"wall-hatch",
	"wall-vent",
	"wall-repair",
	"wall-reinforced",
];
const stats = {
	buildId: BUILD_ID,
	loaded: false,
	theme,
	seed,
	role,
	fps: 0,
	triangles: 0,
	calls: 0,
	fittings: 0,
};
RectAreaLightUniformsLib.init();
const lights: (THREE.SpotLight | THREE.RectAreaLight)[] = [];
const floodlights: THREE.SpotLight[] = [];
for (let i = 0; i < 4; i++) {
	const l = new THREE.SpotLight(0xffe4be, 50000, 380, 1.1, 1, 2);
	l.castShadow = true;
	l.shadow.mapSize.set(1024, 1024);
	l.shadow.bias = -0.00008;
	l.shadow.normalBias = 0.2;
	l.shadow.radius = 3;
	scene.add(l, l.target);
	lights.push(l);
	floodlights.push(l);
}
for (const sign of [-1, 1]) {
	const l = new THREE.RectAreaLight(0xffe4be, 6, 8, 330);
	l.position.set(sign * 95, sign * 65, -200);
	l.up.set(0, 0, 1);
	l.lookAt(sign * 140, 0, -200);
	scene.add(l);
	lights.push(l);
}
const starGeo = new THREE.BufferGeometry(),
	starPos: number[] = [];
let rnd = 771;
for (let i = 0; i < 1600; i++) {
	rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0;
	const x = rnd / 4294967296;
	rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0;
	const y = rnd / 4294967296;
	starPos.push((x - 0.5) * 2400, (y - 0.5) * 1800, 1600);
}
starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
scene.add(
	new THREE.Points(
		starGeo,
		new THREE.PointsMaterial({
			color: 0xc4d2d9,
			size: 1.3,
			sizeAttenuation: false,
		}),
	),
);
function material(source: THREE.Material) {
	const key = theme + "/" + source.name;
	if (materials.has(key)) return materials.get(key)!;
	const m = source.clone() as THREE.MeshStandardMaterial;
	m.name = m.name.replace(/\.\d+$/, "");
	const t = THEMES.find((t) => t.id === theme)!;
	if (m.name.includes("paint-") || m.name.includes("pale-steel")) {
		const tint =
			theme === "works"
				? 0x9c9480
				: theme === "frontier"
					? 0xb0a58a
					: theme === "survey"
						? 0xe2e3db
						: 0xe5d9bd;
		m.color.set(tint);
		m.roughness = theme === "frontier" ? 0.76 : 0.52;
		m.metalness = 0.22;
	}
	if (m.name === "theme-accent") {
		m.color.set(t.accent);
		m.map = null;
	}
	if (m.name === "neutral-light" || m.name === "amber-lamp") {
		m.emissive.set(t.light);
		m.emissiveIntensity = 2.1;
	}
	if (m.map) {
		m.map = sharedPaint;
		m.map.anisotropy = 8;
		m.bumpMap = sharedPaint;
		m.bumpScale = 0.09;
	}
	if (m.name.includes("paint-") || m.name.includes("pale-steel")) {
		const wear = theme === "frontier" ? 0.72 : theme === "works" ? 0.45 : 0.22;
		m.onBeforeCompile = (shader) => {
			shader.fragmentShader = shader.fragmentShader.replace(
				"#include <map_fragment>",
				`
          #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          sampledDiffuseColor.rgb = mix(vec3(1.0), sampledDiffuseColor.rgb, ${wear});
          diffuseColor *= sampledDiffuseColor;
          #endif
        `,
			);
		};
		m.customProgramCacheKey = () => `interior-paint-${wear}`;
		m.metalness = 0.12;
		m.bumpScale = 0.025;
	}
	if (
		[
			"dark-structure",
			"machined-alloy",
			"hose-rubber",
			"recess-black",
		].includes(m.name)
	) {
		m.map = null;
		m.bumpScale = 0.018;
	}
	if (m.name === "canopy-glass") {
		m.opacity = 0.35;
		m.transparent = true;
		m.depthWrite = false;
	}
	materials.set(key, m);
	return m;
}
function place(
	name: string,
	pos: V3,
	roll = 0,
	scale: V3 = [1, 1, 1],
	parent = assembly,
	extra?: THREE.Quaternion,
) {
	const q = new THREE.Quaternion().setFromAxisAngle(
		new THREE.Vector3(0, 0, 1),
		roll,
	);
	if (extra) q.multiply(extra);
	lods.add(
		name,
		new THREE.Matrix4().compose(
			new THREE.Vector3(...pos),
			q,
			new THREE.Vector3(...scale),
		),
		parent,
	);
}
function flush() {
	lods.flush();
}

function solid(c: V3, size: V3, color = 0x303b3d) {
	const mesh = new THREE.Mesh(
		new THREE.BoxGeometry(...size),
		new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.35 }),
	);
	mesh.position.fromArray(c);
	mesh.userData.generated = true;
	assembly.add(mesh);
	return mesh;
}
function label(
	text: string,
	pos: V3,
	roll: number,
	width = 20,
	height = 8,
	parent = assembly,
) {
	const canvas = document.createElement("canvas");
	canvas.width = text.length <= 3 ? 512 : 1024;
	canvas.height = 256;
	const ctx = canvas.getContext("2d")!;
	ctx.fillStyle =
		theme === "survey" ? "#436678" : theme === "civic" ? "#326b62" : "#a26926";
	ctx.font = text.length <= 3 ? "bold 220px monospace" : "bold 135px monospace";
	ctx.textAlign = "center";
	ctx.fillText(text, canvas.width / 2, 210);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	const m = new THREE.MeshBasicMaterial({
		map: texture,
		transparent: true,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -1,
	});
	const p = new THREE.Mesh(new THREE.PlaneGeometry(width, height), m);
	p.position.fromArray(pos);
	p.quaternion
		.setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll)
		.multiply(
			new THREE.Quaternion().setFromAxisAngle(
				new THREE.Vector3(1, 0, 0),
				-Math.PI / 2,
			),
		);
	p.userData.generated = true;
	parent.add(p);
}
function clearGroup(group: THREE.Group) {
	for (const child of [...group.children]) {
		if (child === fitGroup || child === shipGroup || child === guides) continue;
		if (child instanceof THREE.InstancedMesh) child.dispose();
		if (child.userData.generated)
			child.traverse((o) => {
				if (o instanceof THREE.Mesh) {
					o.geometry.dispose();
					const ms = Array.isArray(o.material) ? o.material : [o.material];
					for (const m of o.userData.sharedMaterial ? [] : ms) {
						if ((m as THREE.MeshBasicMaterial).map)
							(m as THREE.MeshBasicMaterial).map!.dispose();
						m.dispose();
					}
				}
			});
		if (child instanceof THREE.Box3Helper) {
			child.geometry.dispose();
			(child.material as THREE.Material).dispose();
		}
		group.remove(child);
	}
}
const shipAsset = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
function build() {
	stats.loaded = false;
	lods.clear();
	plan = planInterior(theme, role, seed);
	history.replaceState(null, "", `?theme=${theme}&role=${role}&seed=${seed}`);
	$<HTMLSelectElement>("role").value = role;
	$<HTMLInputElement>("seed").value = String(seed);
	clearGroup(assembly);
	clearGroup(fitGroup);
	clearGroup(shipGroup);
	clearGroup(guides);
	clearGroup(kit);
	const faces: InteriorFace[] = ["deck", "port", "overhead", "starboard"],
		{ hx, hy, depth } = plan;
	const ax = plan.lane.max[0],
		ay = plan.lane.max[1];
	const accent = THEMES.find((t) => t.id === theme)!.accent;
	const wallBox = (
		face: InteriorFace,
		s: number,
		h: number,
		z: number,
		size: V3,
		color: number,
	) => {
		const m = solid(worldPoint(face, s, h, z, hx, hy), size, color);
		m.rotation.z = FACE_ROLL[face];
		m.receiveShadow = true;
		return m;
	};
	for (const face of faces) {
		const half = face === "deck" || face === "overhead" ? hx : hy,
			roll = FACE_ROLL[face];
		const across = Math.round((half * 2) / 20),
			along = 20;
		// Broad service shoulders separate quiet panels from working machinery.
		for (const sign of [-1, 1]) {
			wallBox(
				face,
				sign * (half - 32),
				0.35,
				-depth / 2,
				[38, 0.7, depth - 4],
				theme === "survey" ? 0x344b5c : 0x222b2e,
			);
			wallBox(
				face,
				sign * (half - 52),
				0.65,
				-depth / 2,
				[2.5, 1.3, depth - 4],
				accent,
			);
			for (const z of [-65, -202, -345]) {
				wallBox(
					face,
					sign * (half - 33),
					1.2,
					z,
					[33, 1.4, 7],
					theme === "works" ? 0xbd882a : accent,
				);
				if (theme === "works")
					for (let x = -12; x <= 12; x += 6)
						wallBox(
							face,
							sign * (half - 33) + x,
							2.0,
							z,
							[2.7, 0.2, 7],
							0x15191a,
						);
			}
			if (theme === "frontier")
				for (let i = 0; i < 5; i++) {
					const z = -40 - i * 73;
					wallBox(
						face,
						sign * 43,
						0.35,
						z,
						[18, 0.7, 25],
						i % 2 ? 0x626552 : 0x99774c,
					);
				}
		}
		for (let x = 0; x < across; x += 2)
			for (let z = 0; z < along; z += 2) {
				const hash = (x * 7 + z * 3 + faces.indexOf(face)) % 5;
				const split = hash === 0 || (theme === "frontier" && hash === 2);
				for (let dx = 0; dx < (split ? 2 : 1); dx++)
					for (let dz = 0; dz < (split ? 2 : 1); dz++) {
						const span = split ? 1 : 2;
						const family =
							split && dx === 0 && dz === 0
								? theme === "frontier"
									? "wall-repair"
									: theme === "works"
										? "wall-reinforced"
										: hash === 0
											? "wall-hatch"
											: "wall-vent"
								: "panel";
						place(
							family,
							worldPoint(
								face,
								-half + ((x + dx + span / 2) * half * 2) / across,
								0,
								-((z + dz + span / 2) * depth) / along,
								hx,
								hy,
							),
							roll,
							[
								((half * 2) / across / 20) * span,
								1,
								(depth / along / 20) * span,
							],
						);
					}
			}
		for (const side of [-1, 1])
			for (let z = 0; z < 20; z++)
				place(
					"trunk",
					worldPoint(face, side * (half - 8), 0, -10 - z * 20, hx, hy),
					roll,
				);
		for (const z of [-10, -80, -202, -327, -397]) {
			const beamWidth = (half - 65) * 2,
				beamTiles = Math.round(beamWidth / 20);
			for (let x = 0; x < beamTiles; x++)
				place(
					"rib",
					worldPoint(
						face,
						-beamWidth / 2 + ((x + 0.5) * beamWidth) / beamTiles,
						0,
						z,
						hx,
						hy,
					),
					roll,
					[1.7, 4.8, beamWidth / beamTiles / 20],
					assembly,
					new THREE.Quaternion().setFromAxisAngle(
						new THREE.Vector3(0, 1, 0),
						Math.PI / 2,
					),
				);
			// Raised shoulder spans let equipment and gangways pass underneath.
			for (const sign of [-1, 1]) {
				place(
					"rib",
					worldPoint(face, sign * (half - 50), 34, z, hx, hy),
					roll,
					[1.7, 1.4, 30 / 20],
					assembly,
					new THREE.Quaternion().setFromAxisAngle(
						new THREE.Vector3(0, 1, 0),
						Math.PI / 2,
					),
				);
				const a = new THREE.Vector3(
					...worldPoint(face, sign * (half - 67), 17, z, hx, hy),
				);
				const b = new THREE.Vector3(
					...worldPoint(face, sign * (half - 48), 35, z, hx, hy),
				);
				const joint = solid(
					a.clone().add(b).multiplyScalar(0.5).toArray() as V3,
					[4, a.distanceTo(b), 13],
					0x465254,
				);
				joint.quaternion.setFromUnitVectors(
					new THREE.Vector3(0, 1, 0),
					b.sub(a).normalize(),
				);
				joint.castShadow = joint.receiveShadow = true;
			}
		}
		wallBox(face, 0, 22.5, -327, [10, 3, 7], 0x252f34);
		const lens = wallBox(face, 0, 24.2, -325, [4, 0.4, 1.5], 0xffecd1);
		(lens.material as THREE.MeshStandardMaterial).emissive.set(
			THEMES.find((t) => t.id === theme)!.light,
		);
		(lens.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.2;
	}

	// Tiled pressure bulkheads. The aperture keeps its authoritative clear rectangle.
	const frontQ = new THREE.Quaternion().setFromAxisAngle(
		new THREE.Vector3(1, 0, 0),
		-Math.PI / 2,
	);
	const horizontalQ = new THREE.Quaternion().setFromRotationMatrix(
		new THREE.Matrix4().makeBasis(
			new THREE.Vector3(0, 1, 0),
			new THREE.Vector3(0, 0, -1),
			new THREE.Vector3(-1, 0, 0),
		),
	);
	const panelWall = (
		cx: number,
		cy: number,
		z: number,
		w: number,
		h: number,
		back = false,
	) => {
		const nx = Math.max(1, Math.round(w / 35)),
			ny = Math.max(1, Math.round(h / 35));
		for (let ix = 0; ix < nx; ix++)
			for (let iy = 0; iy < ny; iy++)
				place(
					(ix + iy * 3) % 7 === 0
						? "wall-vent"
						: (ix + iy * 3) % 7 === 4
							? "wall-hatch"
							: "panel",
					[
						cx - w / 2 + ((ix + 0.5) * w) / nx,
						cy - h / 2 + ((iy + 0.5) * h) / ny,
						z,
					],
					0,
					[w / nx / 20, 1, h / ny / 20],
					assembly,
					back
						? new THREE.Quaternion().setFromAxisAngle(
								new THREE.Vector3(1, 0, 0),
								Math.PI / 2,
							)
						: frontQ,
				);
	};
	panelWall(0, 0, -depth, hx * 2, hy * 2, true);
	for (const side of [-1, 1]) {
		panelWall((side * (hx + ax)) / 2, 0, 0, hx - ax, hy * 2);
		panelWall(0, (side * (hy + ay)) / 2, 0, ax * 2, hy - ay);
	}
	for (let layer = 0; layer < 4; layer++) {
		const x = ax + 4 + layer * 4,
			y = ay + 4 + layer * 4,
			z = -layer * 2.8;
		for (const side of [-1, 1]) {
			place("rib", [side * x, 0, z], 0, [1, 1, (y * 2) / 20], assembly, frontQ);
			place(
				"rib",
				[0, side * y, z],
				0,
				[1, 1, (x * 2) / 20],
				assembly,
				horizontalQ,
			);
		}
	}
	// A bevelled octagonal pressure collar surrounds, never narrows, the clear rectangle.
	const octagon = (x: number, y: number, c: number) =>
		[
			[-x + c, -y],
			[x - c, -y],
			[x, -y + c],
			[x, y - c],
			[x - c, y],
			[-x + c, y],
			[-x, y - c],
			[-x, -y + c],
		] as [number, number][];
	const outer = octagon(ax + 35, ay + 35, 20),
		inner = octagon(ax + 8, ay + 8, 8);
	for (let i = 0; i < 8; i++) {
		const j = (i + 1) % 8,
			points = [outer[i], outer[j], inner[j], inner[i]].map(
				([x, y]) => new THREE.Vector2(x, y),
			);
		const centre = points
			.reduce((c, p) => c.add(p), new THREE.Vector2())
			.multiplyScalar(0.25);
		const ring = new THREE.Shape(
			points.map((p) => p.sub(centre).multiplyScalar(0.96).add(centre)),
		);
		const collar = new THREE.Mesh(
			new THREE.ExtrudeGeometry(ring, {
				depth: 7,
				bevelEnabled: true,
				bevelThickness: 0.8,
				bevelSize: 0.8,
				bevelSegments: 1,
				steps: 1,
			}),
			new THREE.MeshStandardMaterial({
				color:
					theme === "works" && i % 2 ? 0xa57a32 : i % 2 ? 0x79807c : 0x4f5c60,
				metalness: 0.65,
				roughness: 0.4,
			}),
		);
		collar.position.z = -19 + (i % 2 ? 0 : 2);
		collar.userData.generated = true;
		collar.castShadow = collar.receiveShadow = true;
		assembly.add(collar);
	}
	// Recessed service inserts divide the collar into maintainable sections.
	for (const sign of [-1, 1])
		for (const vertical of [false, true]) {
			const cx = vertical ? sign * (ax + 22) : 0,
				cy = vertical ? 0 : sign * (ay + 22);
			const w = vertical ? 9 : 48,
				h = vertical ? 28 : 9;
			const recess = solid([cx, cy, -20], [w + 2, h + 2, 1.8], 0x20292d);
			recess.receiveShadow = true;
			for (let k = -3; k <= 3; k++) {
				const rib = solid(
					[cx + (vertical ? k : 0), cy + (vertical ? 0 : k), -21.2],
					vertical ? [0.5, h, 1] : [w, 0.5, 1],
					0x7a827e,
				);
				rib.receiveShadow = true;
			}
			for (const side of [-1, 1])
				solid(
					[
						cx + (vertical ? side * (w / 2 + 1) : 0),
						cy + (vertical ? 0 : side * (h / 2 + 1)),
						-21.2,
					],
					vertical ? [0.8, h + 4, 1.5] : [w + 4, 0.8, 1.5],
					accent,
				);
		}
	const rim = octagon(ax + 10, ay + 10, 9);
	for (let i = 0; i < rim.length; i++) {
		const a = new THREE.Vector3(...rim[i], -21),
			b = new THREE.Vector3(...rim[(i + 1) % rim.length], -21);
		const m = new THREE.Mesh(
			new THREE.CylinderGeometry(0.65, 0.65, a.distanceTo(b), 6),
			new THREE.MeshStandardMaterial({
				color: 0xffe0a4,
				emissive: theme === "survey" ? 0x93c7ff : 0xffc06c,
				emissiveIntensity: 5,
			}),
		);
		m.position.copy(a).add(b).multiplyScalar(0.5);
		m.quaternion.setFromUnitVectors(
			new THREE.Vector3(0, 1, 0),
			b.sub(a).normalize(),
		);
		m.userData.generated = true;
		assembly.add(m);
	}
	// Identity is visible from the lane, with a second line for operational use.
	label(
		THEMES.find((t) => t.id === theme)!.name.toUpperCase(),
		[0, ay + 57, -1],
		0,
		110,
		9,
	);
	const identity = assembly.children[assembly.children.length - 1];
	identity.rotation.set(0, Math.PI, 0);
	label(
		theme === "survey"
			? "RESEARCH / B-SERIES"
			: theme === "works"
				? "CARGO TRANSFER / KEEP CLEAR"
				: theme === "frontier"
					? "ANCHORAGE / LOCAL SERVICES"
					: "ARRIVALS / DOCK CONTROL",
		[0, -ay - 56, -1],
		0,
		100,
		7,
	);
	assembly.children[assembly.children.length - 1].rotation.set(0, Math.PI, 0);
	// Luminous fixtures are discrete inset lamps, located outside the opening.
	const fixtureMat = new THREE.MeshStandardMaterial({
		color: 0xffe2b2,
		emissive: 0xffbd6a,
		emissiveIntensity: 3,
	});
	for (const side of [-1, 1])
		for (const axis of ["x", "y"]) {
			const n = axis === "x" ? 5 : 3;
			for (let i = 0; i < n; i++) {
				const pos: V3 =
					axis === "x"
						? [(i - (n - 1) / 2) * 20, side * (ay + 8), -7]
						: [side * (ax + 8), (i - (n - 1) / 2) * 18, -7];
				const size: V3 = axis === "x" ? [8, 1.2, 0.8] : [1.2, 6, 0.8];
				const m = solid(pos, size);
				(m.material as THREE.Material).dispose();
				m.material = fixtureMat;
				m.userData.sharedMaterial = true;
			}
		}
	for (const [i, b] of plan.berths.entries()) {
		const wallPos = worldPoint(b.face, 0, 0, b.centre[2], hx, hy);
		place("berth", wallPos, b.roll);
		// Game hulls have local -Z nose, while every bay nose is +Z.
		const ship = shipAsset.clone(true);
		ship.scale.setScalar(1000);
		ship.position.fromArray(b.centre);
		ship.quaternion
			.setFromAxisAngle(new THREE.Vector3(0, 0, 1), b.roll)
			.multiply(
				new THREE.Quaternion().setFromAxisAngle(
					new THREE.Vector3(0, 1, 0),
					Math.PI,
				),
			);
		shipGroup.add(ship);
		ship.traverse((o) => {
			if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
		});
		label(
			String(i + 1).padStart(2, "0"),
			worldPoint(b.face, 0, 1.8, b.centre[2] - 40, hx, hy),
			b.roll,
			30,
			14,
		);
	}
	for (const f of plan.fittings)
		place(f.kind, f.position, f.roll, [1, 1, 1], fitGroup);
	flush();
	// Module library shares the same assets; labels are always human-readable in this view.
	const kinds: Kind[] = [
		"command",
		"loading",
		"gangway",
		"utility",
		"crane",
		"airlock",
	];
	for (const [i, k] of kinds.entries()) {
		place(
			k,
			[((i % 3) - 1) * 65, -18, -Math.floor(i / 3) * 135],
			0,
			[1, 1, 1],
			kit,
		);
		label(
			k.toUpperCase(),
			[((i % 3) - 1) * 65, -17, 35 - Math.floor(i / 3) * 135],
			0,
			38,
			9,
			kit,
		);
	}
	flush();
	const wire = (min: V3, max: V3, color: number) => {
		const b = new THREE.Box3(
			new THREE.Vector3(...min),
			new THREE.Vector3(...max),
		);
		guides.add(new THREE.Box3Helper(b, color));
	};
	wire(plan.lane.min, plan.lane.max, 0x56eac5);
	for (const b of plan.berths) wire(b.bounds.min, b.bounds.max, 0xffc06e);
	guides.visible = $("clearance").getAttribute("aria-pressed") === "true";
	const t = THEMES.find((t) => t.id === theme)!;
	lights.forEach((l) => l.color.set(t.light));
	$("title").textContent = t.name;
	document
		.querySelectorAll<HTMLButtonElement>("[data-theme]")
		.forEach((b) =>
			b.setAttribute("aria-pressed", String(b.dataset.theme === theme)),
		);
	Object.assign(stats, {
		theme,
		seed,
		role,
		fittings: plan.fittings.length,
		loaded: true,
	});
	setView(view);
}
function setView(next: string) {
	view = next;
	kit.visible = view === "kit";
	assembly.visible = !kit.visible;
	(["deck", "port", "overhead", "starboard"] as InteriorFace[]).forEach(
		(face, i) => {
			const l = floodlights[i];
			l.position.fromArray(
				kit.visible
					? [i % 2 ? 100 : -100, 120, i < 2 ? 80 : -180]
					: worldPoint(face, 0, 26, -325, plan.hx, plan.hy),
			);
			l.target.position.fromArray(
				kit.visible
					? [0, 0, -55]
					: worldPoint(face, 0, 0, -190, plan.hx, plan.hy),
			);
			l.intensity = kit.visible ? 100000 : 18000;
		},
	);
	renderer.shadowMap.needsUpdate = true;
	camera.up.set(0, 1, 0);
	camera.fov = view === "axis" ? 92 : 60;
	camera.updateProjectionMatrix();
	if (view === "axis") {
		camera.position.set(0, 0, -plan.depth + 5);
		controls.target.set(0, 0, -80);
	} else if (view === "arrival") {
		camera.position.set(0, 0, -18);
		controls.target.set(0, 0, -320);
	} else if (view === "kit") {
		camera.position.set(120, 120, 125);
		controls.target.set(0, 0, -55);
	} else {
		const f = plan.fittings.find((f) => f.kind === view);
		if (!f) return;
		const q = new THREE.Quaternion().setFromAxisAngle(
			new THREE.Vector3(0, 0, 1),
			f.roll,
		);
		const base = new THREE.Vector3(...f.position),
			offset = new THREE.Vector3(
				-Math.sign(base.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(q))) *
					25,
				view === "command" ? 28 : 60,
				40,
			).applyQuaternion(q);
		camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(q));
		camera.position.copy(base).add(offset);
		camera.position.z = Math.max(
			-plan.depth + 3,
			Math.min(-3, camera.position.z),
		);
		controls.target
			.copy(base)
			.add(new THREE.Vector3(0, 8, 0).applyQuaternion(q));
	}
	controls.update();
}
for (const t of THEMES) {
	const b = document.createElement("button");
	b.textContent = t.code + " " + t.name;
	b.dataset.theme = t.id;
	b.onclick = () => {
		theme = t.id;
		build();
	};
	$("themes").append(b);
}
$("role").onchange = () => {
	role = $<HTMLSelectElement>("role").value as typeof role;
	build();
};
$("seed").onchange = () => {
	seed = Number($<HTMLInputElement>("seed").value) >>> 0;
	build();
};
$("next").onclick = () => {
	seed = (seed + 1) >>> 0;
	$<HTMLInputElement>("seed").value = String(seed);
	build();
};
for (const [id, group] of [
	["fittings", fitGroup],
	["ships", shipGroup],
	["clearance", guides],
] as const)
	$(id).onclick = () => {
		group.visible = !group.visible;
		renderer.shadowMap.needsUpdate = true;
		$(id).setAttribute("aria-pressed", String(group.visible));
	};
document
	.querySelectorAll<HTMLButtonElement>("[data-view]")
	.forEach((b) => (b.onclick = () => setView(b.dataset.view!)));
$("target").onclick = () => {
	$<HTMLImageElement>("target-dialog").querySelector("img")!.src =
		`./targets/${THEMES.find((t) => t.id === theme)!.code.toLowerCase()}-four-face.png`;
	$<HTMLDialogElement>("target-dialog").showModal();
};
$("close").onclick = () => $<HTMLDialogElement>("target-dialog").close();
$("save").onclick = () => {
	updateLods();
	composer.render();
	const a = document.createElement("a");
	a.href = renderer.domElement.toDataURL();
	a.download = `${theme}-${seed}-${view}.png`;
	a.click();
};
addEventListener("keydown", (e) => {
	if (
		(e as KeyboardEvent).key.toLowerCase() === "h" &&
		!(e.target instanceof HTMLInputElement)
	)
		document.body.classList.toggle("capture");
});
addEventListener("resize", () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
	composer.setSize(innerWidth, innerHeight);
});
let frames = 0,
	last = performance.now();
const drawSize = new THREE.Vector2();
function updateLods() {
	if (lods && lods.update(camera, renderer.getDrawingBufferSize(drawSize).y))
		renderer.shadowMap.needsUpdate = true;
}
$<HTMLSelectElement>("lod").onchange = () =>
	lods.setMode($<HTMLSelectElement>("lod").value as LodMode);
function render() {
	requestAnimationFrame(render);
	controls.update();
	updateLods();
	renderer.info.reset();
	composer.render();
	frames++;
	const now = performance.now();
	if (now - last > 1000) {
		stats.fps = Math.round((frames * 1000) / (now - last));
		stats.triangles = renderer.info.render.triangles;
		stats.calls = renderer.info.render.calls;
		Object.assign(stats, { lod: lods?.stats() });
		frames = 0;
		last = now;
		$("readout").innerHTML =
			`${stats.fps} FPS · ${plan.berths.length} berths · ${plan.fittings.length} fittings<br>${lods?.stats().levels.join(" / ")} modules at LOD 0 / 1 / 2<br>${plan.hx * 2} × ${plan.hy * 2} × ${Math.round(plan.depth)} m · station ${seed}`;
	}
}
render();
(window as any).__interiors = {
	stats,
	renderer,
	camera,
	controls,
	diagnostics: { scene, composer, ao },
	lod: () => lods.stats(),
	setLod: (mode: LodMode) => {
		lods.setMode(mode);
		$<HTMLSelectElement>("lod").value = mode;
		updateLods();
	},
	setView,
	select: (id: Theme) => {
		theme = id;
		build();
	},
	setSeed: (n: number) => {
		seed = n;
		build();
	},
	plan: () => plan,
	capture: () => document.body.classList.add("capture"),
};
let loadedFiles = 0,
	totalFiles = 1;
const loaded = () => {
	$("loading").textContent =
		`LOADING INTERIOR KIT · ${++loadedFiles} / ${totalFiles}`;
};
try {
	const response = await fetch("./lod-report.json");
	if (!response.ok) throw Error("Missing LOD manifest");
	lodRecords = (await response.json()).modules;
	const files = [
		...new Set(
			moduleNames.flatMap((name) => [
				`${name}.glb`,
				...lodRecords[name].levels.map((l) => l.file),
			]),
		),
	];
	totalFiles = files.length + 1;
	await Promise.all([
		new THREE.TextureLoader()
			.loadAsync("./modules/shared-paint.png")
			.then((t) => {
				sharedPaint = t;
				t.wrapS = t.wrapT = THREE.RepeatWrapping;
				t.colorSpace = THREE.SRGBColorSpace;
				t.flipY = false;
				loaded();
			}),
		...files.map(async (file) => {
			assets.set(file, (await loader.loadAsync(`./modules/${file}`)).scene);
			loaded();
		}),
	]);
	$("loading").textContent = "ASSEMBLING STATION";
	lods = new InteriorLods(assets, lodRecords, material);
	build();
	$("loading").remove();
} catch (error) {
	$("loading").textContent =
		"Could not load interior modules. Reload to retry.";
	console.error(error);
}
