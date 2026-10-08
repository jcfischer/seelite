import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";

const names = [
	"ring",
	"drum",
	"assembly",
	"wheel",
	"derrick",
	"buoy",
	"rig",
	"cluster",
	"salvage",
];
const renderer = new THREE.WebGLRenderer({
	antialias: true,
	preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010203);
const camera = new THREE.PerspectiveCamera(
	28,
	innerWidth / innerHeight,
	0.2,
	4000,
);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 12;
controls.maxDistance = 1300;
const pmrem = new THREE.PMREMGenerator(renderer),
	room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.22;
room.dispose();
pmrem.dispose();
const key = new THREE.DirectionalLight(0xfff1da, 4.5);
key.position.set(-180, 260, 250);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
Object.assign(key.shadow.camera, {
	left: -115,
	right: 115,
	top: 115,
	bottom: -115,
	near: 1,
	far: 800,
});
key.shadow.bias = -0.00015;
key.shadow.normalBias = 0.08;
scene.add(key);
const fill = new THREE.DirectionalLight(0xd6e0e6, 0.65);
fill.position.set(180, 60, 150);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xa6bbca, 1.0);
rim.position.set(80, 80, -190);
scene.add(rim);
const inspection = new THREE.HemisphereLight(0xdbe4e9, 0x8b8779, 1.8);
inspection.visible = false;
scene.add(inspection);
let seed = 810;
const rand = () =>
	(seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const stars = new Float32Array(6000);
for (let i = 0; i < stars.length; i += 3) {
	const y = rand() * 2 - 1,
		a = rand() * Math.PI * 2,
		r = Math.sqrt(1 - y * y);
	stars.set([900 * r * Math.cos(a), 900 * y, 900 * r * Math.sin(a)], i);
}
const sg = new THREE.BufferGeometry();
sg.setAttribute("position", new THREE.BufferAttribute(stars, 3));
scene.add(
	new THREE.Points(
		sg,
		new THREE.PointsMaterial({
			color: 0x8e9da5,
			size: 0.7,
			sizeAttenuation: false,
		}),
	),
);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(
	new UnrealBloomPass(
		new THREE.Vector2(innerWidth, innerHeight),
		0.16,
		0.24,
		0.9,
	),
);
composer.addPass(new OutputPass());
composer.addPass(new SMAAPass(innerWidth, innerHeight));
const station = new THREE.Group();
scene.add(station);
let modelId = "ring",
	selectedView = "hero",
	rotating = false,
	token = 0;
const cache = new Map<string, THREE.Group>();
const stats = {
	loaded: false,
	modelId,
	fps: 0,
	triangles: 0,
	calls: 0,
	modelTriangles: 0,
	meshCount: 0,
	bounds: [0, 0, 0],
	view: "hero",
	errors: [] as string[],
};
const center = new THREE.Vector3(),
	extent = new THREE.Vector3();
let radius = 70;
let dock = new THREE.Vector3();
const angles: Record<string, number[]> = {
	ring: [0.42, 0.23, 1],
	drum: [0.8, 0.36, 1],
	assembly: [0.45, 0.26, 1],
	wheel: [0.39, 0.22, 1],
	derrick: [0.9, 0.75, 1],
	buoy: [0.85, 0.65, 1],
	rig: [0.8, 0.5, 1],
	cluster: [0.85, 0.6, 1],
	salvage: [0.5, 0.3, 1],
};
function setView(name: string) {
	selectedView = name;
	stats.view = name;
	station.rotation.set(0, 0, 0);
	let dir = new THREE.Vector3(...(angles[modelId] as [number, number, number]));
	let target = center.clone(),
		distance =
			(radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.09;
	if (name === "front") dir.set(0, 0.05, 1);
	if (name === "top") dir.set(0, 1, 0.001);
	if (name === "rear") dir.set(-0.7, 0.35, -1);
	if (name === "under") dir.set(0.6, -0.8, 1);
	if (name === "detail") {
		target = dock.clone();
		dir.set(
			0.4,
			modelId === "salvage" || names.indexOf(modelId) < 4 ? 0.25 : 1,
			1,
		);
		distance = 38 / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
	}
	distance *= Math.max(1, 1 / camera.aspect);
	camera.position.copy(target).add(dir.normalize().multiplyScalar(distance));
	controls.target.copy(target);
	controls.update();
	renderer.shadowMap.needsUpdate = true;
}
async function selectModel(id: string) {
	if (!names.includes(id)) return;
	const request = ++token;
	stats.loaded = false;
	document.getElementById("loading")!.style.display = "grid";
	try {
		let object = cache.get(id);
		if (!object) {
			const gltf = await new GLTFLoader().loadAsync(`./${id}.glb`);
			object = gltf.scene;
			object.scale.setScalar(0.1);
			object.traverse((o) => {
				if (o instanceof THREE.Mesh) {
					o.castShadow = true;
					o.receiveShadow = true;
					for (const m of Array.isArray(o.material) ? o.material : [o.material])
						if (m instanceof THREE.MeshStandardMaterial && m.map) {
							m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
							m.bumpMap = m.map;
							m.bumpScale = 0.025;
							m.needsUpdate = true;
						}
				}
			});
			cache.set(id, object);
		}
		if (request !== token) return;
		station.clear();
		station.rotation.set(0, 0, 0);
		station.add(object);
		modelId = id;
		stats.modelId = id;
		station.updateMatrixWorld(true);
		const bounds = new THREE.Box3().setFromObject(station);
		bounds.getCenter(center);
		bounds.getSize(extent);
		radius = Math.max(extent.x, extent.y, extent.z) * 0.5;
		stats.bounds = extent.toArray();
		dock = object
			.getObjectByName("docking-centre")!
			.getWorldPosition(new THREE.Vector3());
		stats.modelTriangles = 0;
		stats.meshCount = 0;
		object.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				stats.meshCount++;
				stats.modelTriangles +=
					(o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
			}
		});
		const lamp = new THREE.PointLight(0xffba65, 140, 25, 2);
		lamp.position.copy(dock).add(new THREE.Vector3(0, 0, -2));
		station.add(lamp);
		document.getElementById("model-name")!.textContent =
			id[0].toUpperCase() + id.slice(1);
		document
			.querySelectorAll<HTMLButtonElement>("[data-model]")
			.forEach((b) =>
				b.setAttribute("aria-pressed", String(b.dataset.model === id)),
			);
		(document.querySelector("#target-dialog img") as HTMLImageElement).src =
			`./target-${id}.png`;
		setView("hero");
		renderer.shadowMap.needsUpdate = true;
		stats.loaded = true;
		document.getElementById("loading")!.style.display = "none";
	} catch (e) {
		stats.errors.push(String(e));
		document.getElementById("loading")!.textContent =
			`Could not load ${id}: ${e}`;
		throw e;
	}
}
for (const [i, id] of names.entries()) {
	const b = document.createElement("button");
	b.dataset.model = id;
	b.textContent = `O${i + 1} · ${id[0].toUpperCase() + id.slice(1)}`;
	b.onclick = () => void selectModel(id);
	document.querySelector(".models")!.append(b);
}
document
	.querySelectorAll<HTMLButtonElement>("[data-view]")
	.forEach((b) => (b.onclick = () => setView(b.dataset.view!)));
document.getElementById("lights")!.onclick = () => {
	inspection.visible = !inspection.visible;
	document
		.getElementById("lights")!
		.setAttribute("aria-pressed", String(inspection.visible));
};
document.getElementById("spin")!.onclick = () => {
	rotating = !rotating;
	document
		.getElementById("spin")!
		.setAttribute("aria-pressed", String(rotating));
};
document.getElementById("target")!.onclick = () =>
	(document.getElementById("target-dialog") as HTMLDialogElement).showModal();
document.getElementById("close-target")!.onclick = () =>
	(document.getElementById("target-dialog") as HTMLDialogElement).close();
document.getElementById("save")!.onclick = () => {
	composer.render();
	const a = document.createElement("a");
	a.download = `station-${modelId}-${selectedView}.png`;
	a.href = renderer.domElement.toDataURL("image/png");
	a.click();
};
window.addEventListener("keydown", (e) => {
	if (e.key.toLowerCase() === "h") document.body.classList.toggle("capture");
});
addEventListener("resize", () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
	composer.setSize(innerWidth, innerHeight);
});
let last = performance.now(),
	sample = last,
	frames = 0;
function render(t: number) {
	requestAnimationFrame(render);
	const dt = Math.min(0.05, (t - last) / 1000);
	last = t;
	if (rotating) {
		station.rotation.y += dt * 0.12;
		renderer.shadowMap.needsUpdate = true;
	}
	controls.update();
	renderer.info.reset();
	composer.render();
	stats.triangles = renderer.info.render.triangles;
	stats.calls = renderer.info.render.calls;
	frames++;
	if (t - sample > 750) {
		stats.fps = (frames * 1000) / (t - sample);
		frames = 0;
		sample = t;
		document.getElementById("readout")!.textContent =
			`${stats.fps.toFixed(0)} FPS · ${Math.round(stats.modelTriangles / 1000)}k triangles\n${modelId} · authored model study`;
	}
}
requestAnimationFrame(render);
Object.assign(window, {
	__stations: {
		renderer,
		scene,
		camera,
		controls,
		station,
		stats,
		setView,
		selectModel,
		capture: () => document.body.classList.add("capture"),
	},
});
void selectModel(new URLSearchParams(location.search).get("model") ?? "ring");
