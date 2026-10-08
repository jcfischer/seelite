/** Isolated metre-scale authored hull viewer. Does not construct a Game. */
import * as THREE from "three";
import { buildShipMesh } from "../../src/ship-mesh";
import { HULL_SPECS } from "../../src/hull";
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
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;
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
controls.minDistance = 15;
controls.maxDistance = 1400;
const pmrem = new THREE.PMREMGenerator(renderer),
	room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.22;
room.dispose();
pmrem.dispose();
const key = new THREE.DirectionalLight(0xffe9cc, 4.8);
key.position.set(-300, 350, 200);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
Object.assign(key.shadow.camera, {
	left: -160,
	right: 160,
	top: 160,
	bottom: -160,
	near: 1,
	far: 1000,
});
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.1;
scene.add(key);
const fill = new THREE.DirectionalLight(0x92b3d1, 0.45);
fill.position.set(160, 65, 180);
scene.add(fill);
const rim = new THREE.DirectionalLight(0x9eaeb9, 1.7);
rim.position.set(70, 100, -240);
scene.add(rim);
for (const x of [-20, 20])
	for (const z of [-20, 20]) {
		const service = new THREE.PointLight(0xbddfff, 500, 70, 2);
		service.position.set(x, 16, z);
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
const stars = new Float32Array(5000 * 3);
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
ao.kernelRadius = 4;
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
const views: Record<string, { position: number[]; target: number[] }> = {};
let modelId = "o1";
let capsule: THREE.Object3D | null = null;
const names: Record<string, string> = {
	o1: "Gantry Works",
	o2: "Foundry Hangar",
	o3: "Crescent Slipway",
};
const heroViews: Record<string, number[]> = {
	o1: [-175, 114, 223],
	o2: [-205, 78, 275],
	o3: [-213, 160, 280],
};
function updateViews() {
	const c = capsule
		? capsule.getWorldPosition(new THREE.Vector3())
		: new THREE.Vector3();
	Object.assign(views, {
		hero: {
			position: heroViews[modelId],
			target:
				modelId === "o2" ? [0, 0, 0] : modelId === "o3" ? [0, 5, 8] : [0, 0, 0],
		},
		front: { position: [0, 32, 380], target: [0, 0, 0] },
		top: {
			position: [0, modelId === "o3" ? 520 : 420, 0.01],
			target: [0, 0, 15],
		},
		rear: { position: [210, 145, -310], target: [0, 0, 0] },
		detail: {
			position: c
				.clone()
				.add(
					modelId === "o3"
						? new THREE.Vector3(-44, 92, 28)
						: new THREE.Vector3(-44, 28, 92),
				)
				.toArray(),
			target: c.toArray(),
		},
		connection: {
			position: c
				.clone()
				.add(
					modelId === "o3"
						? new THREE.Vector3(65, 10, -72)
						: new THREE.Vector3(75, modelId === "o2" ? -38 : 48, -82),
				)
				.toArray(),
			target: c
				.clone()
				.add(
					modelId === "o3"
						? new THREE.Vector3(0, -15, 0)
						: new THREE.Vector3(0, 0, -15),
				)
				.toArray(),
		},
		under: { position: [-250, -200, 280], target: [0, 0, 0] },
	});
}
updateViews();
let rotating = false;
let tooling = false,
	toolTime = 0;
const movingTools: THREE.Object3D[] = [];
function updateTools(time: number) {
	for (const tool of movingTools) {
		const phase = Number(tool.userData.phase),
			amplitude = Number(tool.userData.amplitude);
		const wave = Math.sin(time * 0.24 + phase) - Math.sin(phase);
		if (tool.userData.tool_motion === "rail")
			tool.position.z = Number(tool.userData.restZ) + wave * amplitude * 5;
		else tool.rotation.z = wave * amplitude * 0.5;
	}
}
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
const cache = new Map<string, THREE.Group>();
const referenceCarrier = buildShipMesh("carrier", "a").root;
let generation = 0;
async function selectModel(id: string) {
	if (!names[id]) return;
	const token = ++generation;
	stats.loaded = false;
	let object = cache.get(id);
	if (!object) {
		const gltf = await new GLTFLoader().loadAsync("./" + id + ".glb");
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
						m.bumpScale = 0.012;
						if (m.name === "machined-alloy") {
							m.metalness = 0.94;
							m.roughness = 0.19;
							m.envMapIntensity = 2.4;
							m.bumpMap = null;
						}
						if (m.name === "dark-structure") {
							m.metalness = 0.82;
							m.roughness = 0.3;
							m.envMapIntensity = 1.6;
						}
						if (m.name.startsWith("pale-steel")) {
							m.metalness = 0.38;
							m.roughness = 0.39;
						}
						m.needsUpdate = true;
					}
			}
		});
		cache.set(id, object);
	}
	if (token !== generation) return;
	ship.clear();
	ship.add(object);
	modelId = id;
	const vessel = referenceCarrier.clone(true);
	if (token !== generation) return;
	vessel.name = "work-vessel";
	// Game hulls are kilometres; station GLBs are metres at 0.1 display scale.
	// 100 view units/km keeps the same physical size in every yard.
	vessel.scale.setScalar(100);
	vessel.rotation.y = Math.PI;
	vessel.userData.referenceEnvelopeKm = HULL_SPECS.carrier.env;
	vessel.position.fromArray(
		id === "o1" ? [0, 6, -8] : id === "o2" ? [-23.5, 2, 12] : [24, 7, 66],
	);
	vessel.traverse((o) => {
		if (o instanceof THREE.Mesh) {
			o.castShadow = true;
			o.receiveShadow = true;
		}
	});
	ship.add(vessel);
	for (const pos of id === "o1"
		? [
				[-8, 18, -8],
				[8, 18, 16],
			]
		: id === "o2"
			? [
					[-23.5, 18, 16],
					[23.5, 18, 16],
				]
			: [[25, 17, 66]]) {
		const work = new THREE.PointLight(0xc9dcf4, 1800, 45, 2);
		work.position.fromArray(pos);
		ship.add(work);
	}
	capsule = object.getObjectByName("life-capsule") ?? null;
	if (!capsule) throw Error("No independent life capsule");
	capsule.rotation.z = 0;
	renderer.shadowMap.needsUpdate = true;
	if (!capsule.getObjectByName("dock-light"))
		for (const x of [-35, 35]) {
			const light = new THREE.PointLight(0xffa143, 75, 22, 2);
			light.name = "dock-light";
			light.position.set(x, 12, 55);
			capsule.add(light);
		}
	movingTools.length = 0;
	toolTime = 0;
	object.traverse((o) => {
		if (o.userData.tool_motion) {
			if (o.userData.restZ === undefined) o.userData.restZ = o.position.z;
			movingTools.push(o);
		}
	});
	updateTools(0);
	ship.updateMatrixWorld(true);
	updateViews();
	setView("hero");
	stats.meshCount = 0;
	stats.modelTriangles = 0;
	ship.traverse((o) => {
		if (o instanceof THREE.Mesh) {
			stats.meshCount++;
			stats.modelTriangles +=
				(o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
		}
	});
	stats.bounds = new THREE.Box3()
		.setFromObject(ship)
		.getSize(new THREE.Vector3())
		.multiplyScalar(10)
		.toArray();
	document.querySelector("#model-name")!.textContent = names[id];
	document.querySelector<HTMLImageElement>("#target-dialog img")!.src =
		"./target-" + id + ".png";
	for (const b of document.querySelectorAll<HTMLElement>("[data-model]"))
		b.setAttribute("aria-pressed", String(b.dataset.model === id));
	stats.loaded = true;
	document.querySelector("#loading")?.remove();
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-model]"))
	b.onclick = () => {
		void selectModel(b.dataset.model!);
	};
document.querySelector<HTMLButtonElement>("#tooling")!.onclick = () => {
	tooling = !tooling;
	document
		.querySelector("#tooling")!
		.setAttribute("aria-pressed", String(tooling));
};
void selectModel(new URLSearchParams(location.search).get("model") ?? "o1");
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
	a.download = `shipyard-${modelId}-${selectedView}.png`;
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
	__shipyards: {
		scene,
		camera,
		renderer,
		ship,
		get capsule() {
			return capsule;
		},
		get movingTools() {
			return movingTools;
		},
		updateTools,
		get modelId() {
			return modelId;
		},
		selectModel,
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
	if (tooling) {
		toolTime += delta * 0.001;
		updateTools(toolTime);
		renderer.shadowMap.needsUpdate = true;
	}
	if (rotating && capsule) {
		capsule.rotation.z += delta * 0.00015;
		renderer.shadowMap.needsUpdate = true;
	}
	controls.update();
	renderer.info.reset();
	composer.render();
	stats.fps = 1000 / (times.reduce((a, b) => a + b, 0) / times.length);
	stats.triangles = renderer.info.render.triangles;
	stats.calls = renderer.info.render.calls;
	stats.view = selectedView;
	document.querySelector("#readout")!.innerHTML =
		`${modelId.toUpperCase()} · ${names[modelId].toUpperCase()}<br>${stats.fps.toFixed(0)} FPS · ${Math.round(stats.modelTriangles / 1000)}K TRIANGLES`;
}
requestAnimationFrame(frame);
