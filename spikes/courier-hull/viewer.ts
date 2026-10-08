/** Isolated metre-scale authored hull viewer. Does not construct a Game. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { makeDisplay } from "./cockpit-instruments";

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
	26,
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
scene.environmentIntensity = 0.24;
room.dispose();
pmrem.dispose();
const key = new THREE.DirectionalLight(0xffead5, 3.2);
key.position.set(-55, 42, -16);
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
const fill = new THREE.DirectionalLight(0xb4c8dc, 0.24);
fill.position.set(25, 12, 45);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xc6d4df, 1.3);
rim.position.set(8, 20, -50);
scene.add(rim);
const metalBounce = new THREE.DirectionalLight(0xd4e1ed, 0.48);
metalBounce.position.set(-35, 16, 28);
scene.add(metalBounce);
RectAreaLightUniformsLib.init();
const softbox = new THREE.RectAreaLight(0xffdfb5, 4.5, 70, 28);
softbox.position.set(28, 48, -46);
softbox.lookAt(0, 0, -6);
scene.add(softbox);
const cockpitGlow = new THREE.PointLight(0x36c3d0, 0.65, 3.2, 2);
cockpitGlow.position.set(0, 3.4, 12.2);
scene.add(cockpitGlow);
for (const x of [-17, 17])
	for (const z of [-11, 1]) {
		const service = new THREE.PointLight(0xff8c28, 25, 8, 2);
		service.position.set(x, 2, z);
		scene.add(service);
	}
const inspection = new THREE.HemisphereLight(0xd9e7f3, 0x9b9b88, 1.7);
inspection.visible = false;
scene.add(inspection);
const stars = new Float32Array(18000 * 3);
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
		color: 0x85949f,
		size: 1.1,
		transparent: true,
		opacity: 0.75,
		sizeAttenuation: false,
	}),
);
scene.add(starfield);
// Sparse soft stellar highlights behind the small sharp field stars.
const starCanvas = document.createElement("canvas");
starCanvas.width = starCanvas.height = 32;
const starContext = starCanvas.getContext("2d")!;
const starGradient = starContext.createRadialGradient(16, 16, 0, 16, 16, 16);
starGradient.addColorStop(0, "rgba(235,245,255,1)");
starGradient.addColorStop(0.12, "rgba(210,228,255,.85)");
starGradient.addColorStop(0.35, "rgba(170,195,235,.18)");
starGradient.addColorStop(1, "rgba(150,180,225,0)");
starContext.fillStyle = starGradient;
starContext.fillRect(0, 0, 32, 32);
const starTexture = new THREE.CanvasTexture(starCanvas);
starTexture.colorSpace = THREE.SRGBColorSpace;
const brightGeometry = new THREE.BufferGeometry();
brightGeometry.setAttribute(
	"position",
	new THREE.BufferAttribute(stars.slice(0, 1200), 3),
);
scene.add(
	new THREE.Points(
		brightGeometry,
		new THREE.PointsMaterial({
			map: starTexture,
			color: 0xdce5ee,
			size: 6,
			sizeAttenuation: false,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		}),
	),
);
for (const side of [-1, 1]) {
	for (const z of [-20, -13.8, -7.7, -1.8]) {
		const practical = new THREE.PointLight(0xffa04a, 3.0, 3.0, 2);
		practical.position.set(side * 3.65, 4.0, z);
		scene.add(practical);
	}
}
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
		0.15,
		0.32,
		1.7,
	),
);
composer.addPass(new OutputPass());
composer.addPass(new SMAAPass(innerWidth, innerHeight));
const ship = new THREE.Group();
scene.add(ship);
const views: Record<
	string,
	{ position: number[]; target: number[]; fov?: number }
> = {
	hero: { position: [-57, 44, 69], target: [-3, 0, 1] },
	front: { position: [0, 8, 128], target: [0, 0, 0] },
	top: { position: [0, 128, 0.01], target: [0, 0, 1] },
	rear: { position: [70, 43, -108], target: [0, 0, -3] },
	detail: { position: [-16, 19, 37], target: [0, 2, 12] },
	interior: { position: [0, 4.4, 10.75], target: [0, 3.15, 13], fov: 64 },
	under: { position: [-64, -70, 84], target: [0, 0, 0] },
};
let rotating = false;
let selectedView = "hero";
function setView(name: string) {
	const v = views[name];
	if (!v) return;
	selectedView = name;
	ship.rotation.set(0, 0, 0);
	camera.fov = v.fov ?? 26;
	camera.updateProjectionMatrix();
	controls.minDistance = name === "interior" ? 0.2 : 5;
	camera.position.fromArray(v.position);
	controls.target.fromArray(v.target);
	camera.position
		.sub(controls.target)
		.multiplyScalar(name === "interior" ? 1 : Math.max(1, 1.6 / camera.aspect))
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
	"./courier-hull.glb",
	(gltf) => {
		gltf.scene.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				if (o.name.startsWith("interior-screen-"))
					o.material = makeDisplay(o.name.slice("interior-screen-".length));
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
	a.download = `courier-o4-${selectedView}.png`;
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
		.multiplyScalar(
			selectedView === "interior"
				? 1
				: Math.max(1, 1.6 / camera.aspect) / oldFit,
		)
		.add(controls.target);
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
	composer.setSize(innerWidth, innerHeight);
});
Object.assign(window, {
	__courier: {
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
