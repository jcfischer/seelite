/** Isolated metre-scale authored hull viewer. Does not construct a Game. */
import {
	anchorAssembly,
	cutterPosition,
	rockContactZ,
	MINING,
} from "./kinematics";
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
renderer.toneMappingExposure = 1.0;
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
controls.maxDistance = 450;
const pmrem = new THREE.PMREMGenerator(renderer),
	room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.24;
room.dispose();
pmrem.dispose();
const key = new THREE.DirectionalLight(0xffe8cf, 5.0);
key.position.set(-65, 70, 35);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
Object.assign(key.shadow.camera, {
	left: -70,
	right: 70,
	top: 70,
	bottom: -70,
	near: 1,
	far: 280,
});
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.1;
scene.add(key);
const fill = new THREE.DirectionalLight(0x92b3d1, 0.38);
fill.position.set(25, 12, 45);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xaac3de, 2.8);
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
ao.kernelRadius = 2.2;
// SSAO compares linear depth normalized by the camera range.
ao.minDistance = 0.06 / (camera.far - camera.near);
ao.maxDistance = 4 / (camera.far - camera.near);
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
	mining: { position: [-145, 72, 99], target: [0, -2, 7] },
	hero: { position: [-82, 49, 93], target: [0, -1, -5] },
	front: { position: [0, 8, 200], target: [0, 0, 0] },
	top: { position: [0, 235, 0.01], target: [0, 0, 1] },
	rear: { position: [110, 60, -150], target: [0, 0, -3] },
	detail: { position: [-37, 28, 78], target: [0, 0, 23] },
	under: { position: [-105, -95, 135], target: [0, 0, 0] },
};

const pose = { anchors: 0, extension: 0, cutting: false, rock: false };
const anchorLights = Array.from({ length: 4 }, () => {
	const light = new THREE.PointLight(0xffcf8c, 150, 12, 2);
	scene.add(light);
	return light;
});
const cutLight = new THREE.PointLight(0xffc985, 280, 20, 2);
cutLight.position.set(-3, -2, 44);
scene.add(cutLight);
const forward = new THREE.Vector3(0, 0, 1);
const rockGeometry = new THREE.PlaneGeometry(125, 110, 120, 110);
const positions = rockGeometry.attributes.position;
for (let i = 0; i < positions.count; i++) {
	const x = positions.getX(i),
		y = positions.getY(i);
	let h =
		2.2 +
		1.6 * Math.sin(x * 0.13) * Math.cos(y * 0.19) +
		0.55 * Math.sin(x * 0.43 + y * 0.29) +
		0.2 * Math.sin(x * 1.3 - y * 0.7);
	// Flatten only the four chosen anchor sockets and central cutter contact.
	let mask = 1;
	for (const [ax, ay, r] of [
		[-17, 9, 3.2],
		[17, 9, 3.2],
		[-17, -19, 3.2],
		[17, -19, 3.2],
		[0, -5, 6],
	])
		mask *= THREE.MathUtils.smoothstep(Math.hypot(x - ax, y - ay), r, r + 2);
	positions.setZ(i, rockContactZ(x, y) + Math.max(0, h) * mask);
}
rockGeometry.computeVertexNormals();
const rockTexture = new THREE.TextureLoader().load("./asteroid-albedo.png");
rockTexture.colorSpace = THREE.SRGBColorSpace;
rockTexture.wrapS = rockTexture.wrapT = THREE.RepeatWrapping;
rockTexture.repeat.set(5, 5);
rockTexture.anisotropy = 8;
const rockMat = new THREE.MeshStandardMaterial({
	color: 0xb0a99e,
	map: rockTexture,
	bumpMap: rockTexture,
	bumpScale: 0.22,
	roughness: 0.96,
	metalness: 0,
	side: THREE.DoubleSide,
});
const asteroid = new THREE.Mesh(rockGeometry, rockMat);
asteroid.castShadow = true;
asteroid.receiveShadow = true;
asteroid.visible = false;
scene.add(asteroid);
const rockColors = [];
for (let i = 0; i < positions.count; i++) {
	const x = positions.getX(i),
		y = positions.getY(i),
		v = 0.48 + 0.22 * Math.sin(x * 1.3 + y * 0.8) * Math.cos(x * 0.9 - y * 1.7);
	rockColors.push(v * 1.1, v * 1.04, v);
}
rockGeometry.setAttribute(
	"color",
	new THREE.Float32BufferAttribute(rockColors, 3),
);
rockMat.vertexColors = false;
function applyPose() {
	if (!stats.loaded) return;
	ship
		.getObjectByName("feed")!
		.position.set(0, MINING.cutterY, cutterPosition(pose.extension));
	for (let i = 0; i < 4; i++) {
		const p = anchorAssembly(i, pose.anchors),
			base = new THREE.Vector3(...p.base),
			end = new THREE.Vector3(...p.foot);
		const elbow = new THREE.Vector3(...p.elbow);
		const direction = elbow.clone().sub(base).normalize(),
			upperLength = elbow.distanceTo(base),
			lowerDirection = end.clone().sub(elbow).normalize(),
			lowerLength = end.distanceTo(elbow);
		const body = ship.getObjectByName(`anchor-${i}-body`)!,
			sleeve = ship.getObjectByName(`anchor-${i}-sleeve`)!,
			foot = ship.getObjectByName(`anchor-${i}-foot`)!;
		body.position.fromArray(p.base);
		body.quaternion.setFromUnitVectors(forward, direction);
		body.scale.z = (upperLength - 3) / 9;
		sleeve.position
			.fromArray(p.base)
			.addScaledVector(direction, upperLength - 3);
		sleeve.quaternion.copy(body.quaternion);
		sleeve.scale.set(1, 1, 3);
		const lower = ship.getObjectByName(`anchor-${i}-lower`)!,
			rod = ship.getObjectByName(`anchor-${i}-lower-rod`)!,
			joint = ship.getObjectByName(`anchor-${i}-elbow`)!;
		lower.position.copy(elbow);
		lower.quaternion.setFromUnitVectors(forward, lowerDirection);
		lower.scale.z = (lowerLength - 3) / 6;
		rod.position.copy(elbow).addScaledVector(lowerDirection, lowerLength - 3);
		rod.quaternion.copy(lower.quaternion);
		rod.scale.set(1, 1, 3);
		joint.position.copy(elbow);
		joint.quaternion.copy(lower.quaternion);
		foot.position.fromArray(p.foot);
		foot.quaternion
			.copy(body.quaternion)
			.slerp(
				new THREE.Quaternion().setFromAxisAngle(
					new THREE.Vector3(0, 1, 0),
					Math.atan(0.75),
				),
				pose.anchors,
			);
		foot.scale.setScalar(1.35);
		joint.scale.set(1.35, 1.35, 1.15);
		body.scale.x = body.scale.y = 1.25;
		lower.scale.x = lower.scale.y = 1.25;
		anchorLights[i].position
			.copy(foot.position)
			.add(new THREE.Vector3(-1, 1, -2));
		anchorLights[i].visible = pose.rock;
	}
	asteroid.visible = pose.rock;
	cutLight.visible = pose.rock;
}
function setPose(next: Partial<typeof pose>) {
	Object.assign(pose, next);
	applyPose();
	(document.querySelector("#anchors") as HTMLInputElement).value = String(
		pose.anchors,
	);
	(document.querySelector("#extension") as HTMLInputElement).value = String(
		pose.extension,
	);
	document
		.querySelector("#cut")!
		.setAttribute("aria-pressed", String(pose.cutting));
	document
		.querySelector("#rock")!
		.setAttribute("aria-pressed", String(pose.rock));
}
for (const name of ["anchors", "extension"] as const)
	document.querySelector<HTMLInputElement>("#" + name)!.oninput = (e) =>
		setPose({ [name]: Number((e.target as HTMLInputElement).value) });
document.querySelector<HTMLButtonElement>("#cut")!.onclick = () =>
	setPose({ cutting: !pose.cutting });
document.querySelector<HTMLButtonElement>("#rock")!.onclick = () =>
	setPose({ rock: !pose.rock });
document.querySelector<HTMLButtonElement>("#stow")!.onclick = () =>
	setPose({ anchors: 0, extension: 0, cutting: false, rock: false });
document.querySelector<HTMLButtonElement>("#mine")!.onclick = () => {
	setPose({ anchors: 1, extension: 1, cutting: true, rock: true });
	setView("mining");
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
	"./longwall-miner.glb",
	(gltf) => {
		gltf.scene.traverse((o) => {
			if ((o as THREE.Mesh).isMesh) {
				const mesh = o as THREE.Mesh;
				o.castShadow = true;
				o.receiveShadow = true;
				stats.meshCount++;
				stats.modelTriangles +=
					(mesh.geometry.index?.count ??
						mesh.geometry.attributes.position.count) / 3;
				for (const raw of Array.isArray(mesh.material)
					? mesh.material
					: [mesh.material]) {
					const m = raw as THREE.MeshStandardMaterial;
					if (m.isMeshStandardMaterial && m.map) {
						m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
						m.bumpMap = m.map;
						m.bumpScale = 0.012;
						m.needsUpdate = true;
					}
				}
			}
		});
		ship.add(gltf.scene);
		stats.bounds = new THREE.Box3()
			.setFromObject(ship)
			.getSize(new THREE.Vector3())
			.toArray();
		stats.loaded = true;
		applyPose();
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
	a.download = `longwall-o4-${selectedView}.png`;
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
	__longwall: {
		scene,
		camera,
		renderer,
		ship,
		controls,
		stats,
		setView,
		pose,
		setPose,
		asteroid,
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
	if (pose.cutting && stats.loaded)
		ship.getObjectByName("rotor")!.rotation.z += Math.min(delta, 100) * 0.001;
	controls.update();
	renderer.info.reset();
	composer.render();
	stats.fps = 1000 / (times.reduce((a, b) => a + b, 0) / times.length);
	stats.triangles = renderer.info.render.triangles;
	stats.calls = renderer.info.render.calls;
	stats.view = selectedView;
	document.querySelector("#readout")!.innerHTML =
		`LONGWALL B · ${pose.anchors > 0.99 ? "ANCHORED" : "FREE"}<br>${stats.fps.toFixed(0)} FPS · ${Math.round(stats.modelTriangles / 1000)}K TRIANGLES`;
}
requestAnimationFrame(frame);
