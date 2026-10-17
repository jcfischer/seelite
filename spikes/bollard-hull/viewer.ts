/** Isolated metre-scale authored hull viewer. Does not construct a Game. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";

const renderer = new THREE.WebGLRenderer({
	antialias: true,
	preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010203);
const camera = new THREE.PerspectiveCamera(
	24,
	innerWidth / innerHeight,
	0.2,
	3000,
);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 5;
controls.maxDistance = 240;
const pmrem = new THREE.PMREMGenerator(renderer),
	room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.17;
room.dispose();
pmrem.dispose();
const key = new THREE.DirectionalLight(0xffd6a0, 4.4);
key.position.set(-65, 45, 0);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
Object.assign(key.shadow.camera, {
	left: -46,
	right: 46,
	top: 46,
	bottom: -46,
	near: 1,
	far: 200,
});
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.1;
scene.add(key);
const fill = new THREE.DirectionalLight(0x92b3d1, 0.28);
fill.position.set(25, 12, 45);
scene.add(fill);
const rim = new THREE.DirectionalLight(0x9eaeb9, 1.7);
rim.position.set(8, 20, -50);
scene.add(rim);
for (const x of [-17, 17])
	for (const z of [-11, 1]) {
		const service = new THREE.PointLight(0xff8c28, 25, 8, 2);
		service.position.set(x, 2, z);
		scene.add(service);
	}
for (const [x, y, z] of [
	[-3, 6, -8],
	[3, 6, -8],
	[-6, 2, 14],
	[6, 2, 14],
	[-7, 1, 24],
	[7, 1, 24],
]) {
	const lamp = new THREE.PointLight(0xff8b23, z < 0 ? 18 : 35, 6, 2);
	lamp.position.set(x, y, z);
	scene.add(lamp);
}
const inspection = new THREE.HemisphereLight(0xd9e7f3, 0x9b9b88, 1.7);
inspection.visible = false;
scene.add(inspection);
const stars = new Float32Array(36000 * 3);
let seed = 795;
const rand = () =>
	(seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < stars.length; i += 3) {
	const y = rand() * 2 - 1,
		a = rand() * Math.PI * 2,
		r = Math.sqrt(1 - y * y);
	stars.set([700 * r * Math.cos(a), 700 * y, 700 * r * Math.sin(a)], i);
}
const sg = new THREE.BufferGeometry();
sg.setAttribute("position", new THREE.BufferAttribute(stars, 3));
const starfield = new THREE.Points(
	sg,
	new THREE.PointsMaterial({
		color: 0xaab7be,
		size: 0.75,
		sizeAttenuation: false,
	}),
);
scene.add(starfield);
const brightGeo = new THREE.BufferGeometry();
brightGeo.setAttribute(
	"position",
	new THREE.BufferAttribute(stars.slice(0, 4500), 3),
);
scene.add(
	new THREE.Points(
		brightGeo,
		new THREE.PointsMaterial({
			color: 0xcdd9e5,
			size: 1.7,
			sizeAttenuation: false,
		}),
	),
);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ao = new SSAOPass(scene, camera, innerWidth, innerHeight);
ao.kernelRadius = 1.5;
ao.minDistance = 0.001;
ao.maxDistance = 0.025;
composer.addPass(ao);
composer.addPass(
	new UnrealBloomPass(
		new THREE.Vector2(innerWidth, innerHeight),
		0.28,
		0.26,
		0.85,
	),
);
composer.addPass(new OutputPass());
composer.addPass(new SMAAPass(innerWidth, innerHeight));
const ship = new THREE.Group();
scene.add(ship);
const views: Record<string, { position: number[]; target: number[] }> = {
	hero: { position: [-55, 44, 78], target: [0, -3, 0] },
	front: { position: [0, 8, 128], target: [0, 0, 0] },
	top: { position: [0, 158, 0.01], target: [0, 0, 1] },
	rear: { position: [70, 43, -108], target: [0, 0, -3] },
	detail: { position: [-22, 23, 42], target: [0, 3, 8] },
	under: { position: [-64, -70, 84], target: [0, 0, 0] },
};
let rotating = false;
let selectedView = "hero";
function setView(name: string) {
	const v = views[name];
	if (!v) return;
	selectedView = name;
	ship.rotation.set(0, 0, 0);
	camera.position.fromArray(v.position);
	controls.target.fromArray(v.target);
	camera.position
		.sub(controls.target)
		.multiplyScalar(Math.max(1, 1.6 / camera.aspect))
		.add(controls.target);
	controls.update();
}
setView("hero");
const stats = {
	loaded: false,
	fps: 0,
	triangles: 0,
	calls: 0,
	modelTriangles: 0,
	meshCount: 0,
	bounds: [0, 0, 0],
	view: selectedView,
};
new GLTFLoader().load(
	"./bollard-hull.glb",
	(gltf) => {
		gltf.scene.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				o.castShadow = true;
				o.receiveShadow = true;
				stats.meshCount++;
				stats.modelTriangles +=
					(o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
				for (const m of Array.isArray(o.material) ? o.material : [o.material])
					if (m instanceof THREE.MeshStandardMaterial && m.map) {
						m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
						m.bumpMap = m.map;
						m.bumpScale = 0.012;
						m.needsUpdate = true;
					}
			}
		});
		ship.add(gltf.scene);
		stats.bounds = new THREE.Box3()
			.setFromObject(ship)
			.getSize(new THREE.Vector3())
			.toArray();
		stats.loaded = true;
		document.querySelector("#loading")?.remove();
	},
	undefined,
	(error) => {
		document.querySelector("#loading")!.textContent =
			"Model unavailable — reload to retry";
		console.error(error);
	},
);
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]"))
	b.onclick = () => setView(b.dataset.view!);
document.querySelector<HTMLButtonElement>("#lights")!.onclick = (e) => {
	inspection.visible = !inspection.visible;
	(e.currentTarget as HTMLElement).setAttribute(
		"aria-pressed",
		String(inspection.visible),
	);
};
document.querySelector<HTMLButtonElement>("#spin")!.onclick = (e) => {
	rotating = !rotating;
	(e.currentTarget as HTMLElement).setAttribute(
		"aria-pressed",
		String(rotating),
	);
};
const dialog = document.querySelector<HTMLDialogElement>("#target-dialog")!;
document.querySelector<HTMLButtonElement>("#target")!.onclick = () =>
	dialog.showModal();
document.querySelector<HTMLButtonElement>("#close-target")!.onclick = () =>
	dialog.close();
document.querySelector<HTMLButtonElement>("#save")!.onclick = () => {
	composer.render();
	const a = document.createElement("a");
	a.href = renderer.domElement.toDataURL("image/png");
	a.download = `bollard-o4-${selectedView}.png`;
	a.click();
};
window.addEventListener("keydown", (e) => {
	if (e.key.toLowerCase() === "h") document.body.classList.toggle("capture");
});
addEventListener("resize", () => {
	const oldFit = Math.max(1, 1.6 / camera.aspect);
	camera.aspect = innerWidth / innerHeight;
	camera.position
		.sub(controls.target)
		.multiplyScalar(Math.max(1, 1.6 / camera.aspect) / oldFit)
		.add(controls.target);
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
	composer.setSize(innerWidth, innerHeight);
});
Object.assign(window, {
	__bollard: {
		scene,
		camera,
		renderer,
		ship,
		controls,
		stats,
		setView,
		capture: () => document.body.classList.add("capture"),
	},
});
let previous = performance.now();
const times: number[] = [];
function frame(now: number) {
	requestAnimationFrame(frame);
	const delta = now - previous;
	previous = now;
	times.push(delta);
	if (times.length > 180) times.shift();
	if (rotating) ship.rotation.y += delta * 0.00015;
	controls.update();
	renderer.info.reset();
	composer.render();
	stats.fps = 1000 / (times.reduce((a, b) => a + b, 0) / times.length);
	stats.triangles = renderer.info.render.triangles;
	stats.calls = renderer.info.render.calls;
	stats.view = selectedView;
	document.querySelector("#readout")!.innerHTML =
		`O4 · AUTHORED HULL STUDY<br>${stats.fps.toFixed(0)} FPS · ${Math.round(stats.modelTriangles / 1000)}K TRIANGLES`;
}
requestAnimationFrame(frame);
