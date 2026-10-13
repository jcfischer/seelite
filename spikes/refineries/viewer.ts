/** Isolated metre-scale authored hull viewer. Does not construct a Game. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { STATION_GEOMETRY } from "../../src/station";
import { stationInterior } from "../../src/station-interior";
import { buildStationInterior } from "../../src/station-interior-mesh";
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
renderer.toneMappingExposure = 0.92;
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
controls.maxDistance = 1000;
const pmrem = new THREE.PMREMGenerator(renderer),
	room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.22;
room.dispose();
pmrem.dispose();
const key = new THREE.DirectionalLight(0xffedd6, 4.8);
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
const fill = new THREE.DirectionalLight(0xc6d3df, 0.75);
fill.position.set(160, 65, 180);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xbcc1c6, 1.0);
rim.position.set(70, 100, -240);
scene.add(rim);
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
ao.kernelRadius = 2.5;
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

const names: Record<string, string> = {
	o1: "Warren",
	o2: "Collar",
	o3: "Spar",
	o4: "Works",
};
const heroes: Record<string, number[]> = {
	o1: [115, 75, 255],
	o2: [120, 76, 285],
	o3: [225, 95, 225],
	o4: [110, 120, 215],
};
const cache = new Map<string, THREE.Group>();
// The flight export (#819) is the shipped asset the game loads: the recessed
// pad's housing in place of the review box, in the station's frame (+Z the
// axis, the aperture plane at the sim's figure). The sim's own deck and
// berths are drawn into it, as the game draws them.
const flightAsset: Record<string, string> = {
	o1: "warren",
	o2: "collar",
	o3: "spar",
	o4: "works",
};
let flight = new URLSearchParams(location.search).get("flight") === "1";
function simPad(): THREE.Group {
	const plane = STATION_GEOMETRY.refinery.aperturePlaneKm;
	const pad = buildStationInterior(
		"refinery",
		stationInterior("refinery", plane),
	);
	// Kilometres to the viewer's tenth-metre units.
	pad.scale.setScalar(100);
	return pad;
}
const dockCentre = new THREE.Vector3();
/** The model's own centre: the flight export is in the station's frame, so
 *  the rock no longer sits on the origin. */
const modelCentre = new THREE.Vector3();
let modelId = "o1",
	selectedView = "hero",
	rotating = false,
	generation = 0;
const stats = {
	loaded: false,
	fps: 0,
	triangles: 0,
	calls: 0,
	modelTriangles: 0,
	meshCount: 0,
	bounds: [0, 0, 0],
	view: "hero",
};
function setView(name: string) {
	const around = (p: number[]) =>
		new THREE.Vector3().fromArray(p).add(modelCentre).toArray();
	const positions: Record<string, number[]> = {
		hero: around(heroes[modelId]),
		front: around([0, 5, 330]),
		top: around([0, 340, 0.01]),
		rear: around([170, 90, -275]),
		under: around([-190, -160, 235]),
		detail: dockCentre
			.clone()
			.add(new THREE.Vector3(-48, 32, 98))
			.toArray(),
	};
	if (!positions[name]) return;
	selectedView = name;
	ship.rotation.set(0, 0, 0);
	controls.target.copy(
		name === "detail"
			? dockCentre
			: new THREE.Vector3(0, 0, modelId === "o3" ? -15 : 0).add(modelCentre),
	);
	camera.position
		.fromArray(positions[name])
		.sub(controls.target)
		.multiplyScalar(Math.max(1, 1.5 / camera.aspect))
		.add(controls.target);
	controls.update();
	renderer.shadowMap.needsUpdate = true;
}
async function selectModel(id: string) {
	if (!names[id]) id = "o1";
	const token = ++generation;
	stats.loaded = false;
	const key = flight ? id + ":flight" : id;
	let object = cache.get(key);
	if (!object) {
		const gltf = await new GLTFLoader()
			.setMeshoptDecoder(MeshoptDecoder)
			.loadAsync(
				flight
					? `../../src/models/refinery-${flightAsset[id]}.glb`
					: "./" + id + ".glb",
			);
		object = gltf.scene;
		object.scale.setScalar(0.1);
		if (flight) {
			const holder = new THREE.Group();
			holder.add(object, simPad());
			object = holder;
		}
		object.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				o.castShadow = true;
				o.receiveShadow = true;
				for (const m of Array.isArray(o.material) ? o.material : [o.material])
					if (m instanceof THREE.MeshStandardMaterial && m.map) {
						m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
						m.bumpMap = m.map;
						m.bumpScale = m.name === "mineral-bedrock" ? 0.6 : 0.025;
						if (id !== "o2" && m.name.startsWith("pale-steel")) {
							m.metalness = 0.32;
							m.roughness = 0.48;
						}
						m.needsUpdate = true;
					}
			}
		});
		cache.set(key, object);
	}
	if (token !== generation) return;
	ship.clear();
	ship.rotation.set(0, 0, 0);
	ship.add(object);
	const practicals: Record<string, number[][]> = {
		o1: [
			[-34, 7, 32],
			[29, 7, 29],
			[-24, 22, 2],
			[-10, 22, 8],
			[4, 22, 13],
			[23, 38, -17],
		],
		o2: [],
		o3: [
			[32, 2, 35],
			[32, 2, -24],
			[-32, 2, 35],
			[-32, 2, -24],
			[7, 14, -73],
			[7, -13, -73],
		],
		o4: [
			[-24, 14, 17],
			[23, 15, 18],
			[-5, 15, 17],
			[-24, 15, -2],
			[22, 15, -2],
			[0, 11, 33],
		],
	};
	for (const position of flight ? [] : practicals[id]) {
		const light = new THREE.PointLight(0xffa14b, id === "o1" ? 32 : 160, 18, 2);
		light.position.fromArray(position);
		ship.add(light);
	}
	modelId = id;
	scene.environmentIntensity = id === "o2" ? 0.22 : 0.32;
	fill.intensity = id === "o2" ? 0.75 : 1.15;
	ship.updateMatrixWorld(true);
	modelCentre.set(0, 0, 0);
	if (flight)
		new THREE.Box3().setFromObject(object.children[0]).getCenter(modelCentre);
	object
		.getObjectByName(flight ? "aperture-plane" : "docking-centre")!
		.getWorldPosition(dockCentre);
	stats.modelTriangles = 0;
	stats.meshCount = 0;
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
	document.querySelector("#model-name")!.textContent =
		names[id] + (flight ? " · flight export" : "");
	document.querySelector<HTMLImageElement>("#target-dialog img")!.src =
		"./target-" + id + ".png";
	for (const b of document.querySelectorAll<HTMLElement>("[data-model]"))
		b.setAttribute("aria-pressed", String(b.dataset.model === id));
	setView("hero");
	stats.loaded = true;
	document.querySelector("#loading")?.remove();
}
function showError(e: unknown) {
	let el = document.querySelector("#loading");
	if (!el) {
		el = document.createElement("div");
		el.id = "loading";
		document.body.append(el);
	}
	el.textContent = "Model failed to load: " + String(e);
	console.error(e);
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-model]"))
	b.onclick = () => {
		void selectModel(b.dataset.model!).catch(showError);
	};
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]"))
	b.onclick = () => setView(b.dataset.view!);
const flightButton = document.querySelector<HTMLButtonElement>("#flight")!;
flightButton.setAttribute("aria-pressed", String(flight));
flightButton.onclick = () => {
	flight = !flight;
	flightButton.setAttribute("aria-pressed", String(flight));
	void selectModel(modelId).catch(showError);
};
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
	a.download = "refinery-" + modelId + "-" + selectedView + ".png";
	a.click();
};
window.addEventListener("keydown", (e) => {
	if (e.key.toLowerCase() === "h") document.body.classList.toggle("capture");
});
addEventListener("resize", () => {
	const old = Math.max(1, 1.5 / camera.aspect);
	camera.aspect = innerWidth / innerHeight;
	camera.position
		.sub(controls.target)
		.multiplyScalar(Math.max(1, 1.5 / camera.aspect) / old)
		.add(controls.target);
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
	composer.setSize(innerWidth, innerHeight);
});
Object.assign(window, {
	__refineries: {
		scene,
		camera,
		renderer,
		ship,
		controls,
		stats,
		setView,
		selectModel,
		get modelId() {
			return modelId;
		},
		dockCentre,
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
	if (times.length > 120) times.shift();
	if (rotating) {
		ship.rotation.y += delta * 0.00015;
		renderer.shadowMap.needsUpdate = true;
	}
	controls.update();
	renderer.info.reset();
	composer.render();
	stats.fps = 1000 / (times.reduce((a, b) => a + b, 0) / times.length);
	stats.triangles = renderer.info.render.triangles;
	stats.calls = renderer.info.render.calls;
	stats.view = selectedView;
	document.querySelector("#readout")!.textContent =
		modelId.toUpperCase() +
		" · " +
		names[modelId] +
		(flight ? " · FLIGHT" : " · REVIEW") +
		" · " +
		stats.fps.toFixed(0) +
		" FPS · " +
		Math.round(stats.modelTriangles / 1000) +
		"K TRIANGLES";
}
requestAnimationFrame(frame);
void selectModel(
	new URLSearchParams(location.search).get("model") ?? "o1",
).catch(showError);
