const BUILD_ID = "interiors-r8-shared-kit-20261010";
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
import { stationInterior, type InteriorFace } from "../../src/station-interior";
import { STATION_GEOMETRY } from "../../src/station";
import { buildInteriorKit } from "../../src/interior-kit";
import { disposeSubtree } from "../../src/gpu-teardown";
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
	shipGroup = new THREE.Group(),
	guides = new THREE.Group(),
	kit = new THREE.Group();
let fitGroup = new THREE.Group();
assembly.add(shipGroup, guides);
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
	lods?.clear();
	plan = planInterior(theme, role, seed);
	history.replaceState(null, "", `?theme=${theme}&role=${role}&seed=${seed}`);
	$<HTMLSelectElement>("role").value = role;
	$<HTMLInputElement>("seed").value = String(seed);
	const previous = assembly.getObjectByName("authored-interior");
	if (previous) {
		previous.removeFromParent();
		disposeSubtree(previous);
	}
	clearGroup(assembly);
	clearGroup(shipGroup);
	clearGroup(guides);
	clearGroup(kit);
	const interior = stationInterior(
		role,
		STATION_GEOMETRY[role].aperturePlaneKm,
		seed,
	);
	const authored = buildInteriorKit(
		interior,
		seed,
		theme,
		assets,
		lodRecords,
		0,
		1,
	);
	// The review stage is centred on the mouth in metres; the game uses kilometres.
	authored.position.z = 0;
	// Review illumination is supplied by this stage's spot/area rig.
	for (const child of [...authored.children])
		if (child instanceof THREE.PointLight) child.removeFromParent();
	assembly.add(authored);
	fitGroup = authored.getObjectByName("interior-fittings") as THREE.Group;
	fitGroup.visible = $("fittings").getAttribute("aria-pressed") === "true";
	lods = authored.userData.interiorLods;
	lods.setMode($<HTMLSelectElement>("lod").value as LodMode);
	const { hx, hy } = plan;
	const ax = plan.lane.max[0],
		ay = plan.lane.max[1];
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
	for (const [i, b] of plan.berths.entries()) {
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
for (const [id, getGroup] of [
	["fittings", () => fitGroup],
	["ships", () => shipGroup],
	["clearance", () => guides],
] as const)
	$(id).onclick = () => {
		const group = getGroup();
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
	for (const asset of assets.values())
		asset.traverse((o) => {
			if (!(o as THREE.Mesh).isMesh) return;
			const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
			if (m.map) m.map = sharedPaint;
		});
	build();
	$("loading").remove();
} catch (error) {
	$("loading").textContent =
		"Could not load interior modules. Reload to retry.";
	console.error(error);
}
