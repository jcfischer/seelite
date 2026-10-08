/** Isolated Dream Loop model study; no Game or simulation is constructed. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { buildStationForm } from "./station-mesh";
import { setStationFinish } from "./station-visuals";
import { STATION_GEOMETRY } from "./station";

const renderer = new THREE.WebGLRenderer({
	antialias: true,
	preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030506);
const stars = new Float32Array(700 * 3);
let seed = 790;
const rand = () =>
	(seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < stars.length; i += 3) {
	const az = rand() * Math.PI * 2;
	const y = rand() * 2 - 1;
	const r = Math.sqrt(1 - y * y);
	stars.set([8 * r * Math.cos(az), 8 * y, 8 * r * Math.sin(az)], i);
}
const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
scene.add(
	new THREE.Points(
		starGeometry,
		new THREE.PointsMaterial({
			color: 0x9dabad,
			size: 0.014,
			sizeAttenuation: true,
		}),
	),
);
const camera = new THREE.PerspectiveCamera(
	32,
	innerWidth / innerHeight,
	0.001,
	100,
);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.09;
controls.maxDistance = 5;
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.24;
room.dispose();
pmrem.dispose();
const key = new THREE.DirectionalLight(0xfff3df, 5.0);
key.position.set(-3.6, 2.6, 1.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -0.85;
key.shadow.camera.right = 0.85;
key.shadow.camera.top = 0.85;
key.shadow.camera.bottom = -0.85;
key.shadow.camera.near = 0.1;
key.shadow.camera.far = 6;
key.shadow.bias = -0.00015;
key.shadow.normalBias = 0.0006;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9eb6c1, 1.3);
rim.position.set(1.5, 0.4, -1);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xf5d7b0, 0.28);
fill.position.set(0.8, -0.5, 2);
scene.add(fill);
const dockingLight = new THREE.PointLight(0xffae55, 0.6, 0.34, 2);
dockingLight.position.set(0, 0.018, 0.4);
scene.add(dockingLight);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ao = new SSAOPass(scene, camera, innerWidth, innerHeight);
ao.kernelRadius = 14;
ao.minDistance = 0.0002;
ao.maxDistance = 0.015;
composer.addPass(ao);
const bloom = new UnrealBloomPass(
	new THREE.Vector2(innerWidth, innerHeight),
	0.2,
	0.35,
	1.8,
);
composer.addPass(bloom);
composer.addPass(new OutputPass());
composer.addPass(new SMAAPass(innerWidth, innerHeight));
const station = new THREE.Group();
scene.add(station);
let industrial: THREE.Group;
let original: THREE.Group | undefined;
let rotating = false;
let selected = "industrial";
let frameTimes: number[] = [];
let previous = performance.now();
const views: Record<string, { position: number[]; target: number[] }> = {
	hero: { position: [0.88, 0.37, 2.02], target: [0, -0.055, 0] },
	front: { position: [0, 0, 2.15], target: [0, 0, 0] },
	detail: { position: [0.16, 0.095, 0.84], target: [0, 0, 0.4] },
	rear: { position: [-1.1, 0.6, -2.1], target: [0, 0, 0] },
};
function setView(name: string) {
	const view = views[name];
	if (!view) return;
	camera.position.fromArray(view.position);
	controls.target.fromArray(view.target);
	station.rotation.set(0, 0, 0);
	controls.update();
}
setView("hero");
function selectModel(which: string) {
	if (!industrial) return;
	if (which === "original" && !original) {
		setStationFinish("worn");
		original = buildStationForm("trade", "a", 0x80909b, 0, 0).root;
		original.scale.setScalar(STATION_GEOMETRY.trade.coreRadiusKm);
		station.add(original);
	}
	selected = which;
	industrial.visible = which === "industrial";
	if (original) original.visible = which === "original";
	document
		.querySelector("#new")
		?.setAttribute("aria-pressed", String(which === "industrial"));
	document
		.querySelector("#original")
		?.setAttribute("aria-pressed", String(which === "original"));
}
document
	.querySelector("#new")
	?.addEventListener("click", () => selectModel("industrial"));
document
	.querySelector("#original")
	?.addEventListener("click", () => selectModel("original"));
document.querySelector("#spin")?.addEventListener("click", (event) => {
	rotating = !rotating;
	(event.target as HTMLElement).setAttribute("aria-pressed", String(rotating));
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
	"[data-view]",
)) {
	button.addEventListener("click", () => setView(button.dataset.view!));
}
addEventListener("resize", () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
	composer.setSize(innerWidth, innerHeight);
});
const stats = { fps: 0, triangles: 0, calls: 0, loaded: false, selected };
Object.assign(window, {
	__coriolis: {
		scene,
		camera,
		renderer,
		station,
		controls,
		stats,
		setView,
		selectModel,
		capture: () => document.body.classList.add("capture"),
	},
});
new GLTFLoader().load(
	"/spikes/coriolis/coriolis-industrial.glb",
	(gltf) => {
		industrial = gltf.scene;
		industrial.scale.setScalar(0.001);
		industrial.traverse((object) => {
			if (object instanceof THREE.Mesh) {
				object.castShadow = true;
				object.receiveShadow = true;
				const materials = Array.isArray(object.material)
					? object.material
					: [object.material];
				for (const material of materials) {
					if (material instanceof THREE.MeshStandardMaterial && material.map) {
						material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
						material.bumpMap = material.map;
						material.bumpScale = 0.00006;
						material.needsUpdate = true;
					}
				}
			}
		});
		station.add(industrial);
		stats.loaded = true;
		document.querySelector("#loading")?.remove();
	},
	undefined,
	(error) => {
		document.querySelector("#loading")!.textContent =
			"Model unavailable — see console";
		console.error(error);
	},
);
function animate(now: number) {
	requestAnimationFrame(animate);
	const delta = now - previous;
	previous = now;
	frameTimes.push(delta);
	if (frameTimes.length > 180) frameTimes.shift();
	if (rotating) station.rotation.z += delta * 0.00004;
	controls.update();
	renderer.info.reset();
	composer.render();
	stats.fps =
		1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length);
	stats.triangles = renderer.info.render.triangles;
	stats.calls = renderer.info.render.calls;
	stats.selected = selected;
	document.querySelector("#readout")!.innerHTML =
		`CORIOLIS · ${selected === "industrial" ? "INDUSTRIAL REFIT" : "CURRENT MODEL"}<br>120 × 70 M DOCK · ${stats.fps.toFixed(0)} FPS`;
}
requestAnimationFrame(animate);
