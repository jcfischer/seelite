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
	26,
	innerWidth / innerHeight,
	0.2,
	5000,
);
camera.up.set(-0.11, 1, 0).normalize();
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 5;
controls.maxDistance = 800;
const pmrem = new THREE.PMREMGenerator(renderer),
	room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.25;
room.dispose();
pmrem.dispose();
const key = new THREE.DirectionalLight(0xffecd7, 3.3);
key.position.set(-100, 64, 95);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
Object.assign(key.shadow.camera, {
	left: -90,
	right: 90,
	top: 90,
	bottom: -90,
	near: 1,
	far: 400,
});
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.1;
scene.add(key);
const fill = new THREE.DirectionalLight(0xa5bedf, 0.8);
fill.position.set(25, 12, 45);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffe4c6, 0.45);
rim.position.set(60, 65, -75);
scene.add(rim);
for (const x of [-5.5])
	for (const z of [-20, 0, 20]) {
		const service = new THREE.PointLight(0xff8c28, 0, 12, 2);
		service.position.set(x, 4.6, z);
		scene.add(service);
	}
const bridgeLamp = new THREE.PointLight(0xff862c, 2.2, 4, 2);
bridgeLamp.position.set(61.2, 3.82, 6.8);
scene.add(bridgeLamp);
const inspection = new THREE.HemisphereLight(0xd9e7f3, 0x9b9b88, 1.7);
inspection.visible = false;
scene.add(inspection);
const stars = new Float32Array(480000 * 3);
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
const brightness = new Float32Array(stars.length / 3);
for (let i = 0; i < brightness.length; i++)
	brightness[i] = Math.pow(rand(), 11);
sg.setAttribute("brightness", new THREE.BufferAttribute(brightness, 1));
const starfield = new THREE.Points(
	sg,
	new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		vertexShader: `attribute float brightness; varying float vBrightness;
 void main(){vBrightness=brightness;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=0.5+brightness*4.5;}`,
		fragmentShader: `varying float vBrightness; void main(){vec2 q=gl_PointCoord-.5;float r=length(q);float core=exp(-r*r*80.0);float halo=exp(-r*r*14.0)*.14;float light=(core+halo)*(.06+vBrightness*.75);gl_FragColor=vec4(mix(vec3(.65,.77,.9),vec3(1.0,.90,.75),vBrightness),light);}`,
	}),
);
scene.add(starfield);
// Very faint directional dust, independent of orbit and without a visible horizon.
const dust = new THREE.Mesh(
	new THREE.SphereGeometry(850, 48, 24),
	new THREE.ShaderMaterial({
		side: THREE.BackSide,
		depthWrite: false,
		vertexShader: `varying vec3 d; void main(){d=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
		fragmentShader: `varying vec3 d; void main(){float n=sin(d.x*39.0+sin(d.y*21.0))*sin(d.z*31.0+sin(d.x*17.0));float n2=sin(d.x*123.0)*sin(d.y*111.0)*sin(d.z*147.0);float f=pow(clamp(n*.35+n2*.12+.45,0.0,1.0),3.0);gl_FragColor=vec4(vec3(.008,.009,.011)*f,1.0);}`,
	}),
);
dust.renderOrder = -2;
scene.add(dust);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ao = new SSAOPass(scene, camera, innerWidth, innerHeight);
ao.kernelRadius = 3.8;
ao.minDistance = 0.001;
ao.maxDistance = 0.06;
ao.enabled = true;
composer.addPass(ao);
composer.addPass(
	new UnrealBloomPass(
		new THREE.Vector2(innerWidth, innerHeight),
		0.22,
		0.32,
		1.7,
	),
);
composer.addPass(new OutputPass());
composer.addPass(new SMAAPass(innerWidth, innerHeight));
const ship = new THREE.Group();
scene.add(ship);
const views: Record<string, { position: number[]; target: number[] }> = {
	hero: { position: [68, 57, 166], target: [0, -6.3, 0] },
	front: { position: [240, 12, 0], target: [0, 0, 0] },
	top: { position: [0, 290, 0.01], target: [0, 0, 0] },
	rear: { position: [-210, 65, 180], target: [-20, 0, 0] },
	detail: { position: [100, 24, 60], target: [51, 0, 0] },
	under: { position: [90, -100, 240], target: [0, 0, 0] },
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
	"./discovery.glb",
	(gltf) => {
		gltf.scene.traverse((object) => {
			const o = object as THREE.Mesh;
			if (o.isMesh) {
				o.castShadow = true;
				o.receiveShadow = true;
				stats.meshCount++;
				stats.modelTriangles +=
					(o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
				for (const item of Array.isArray(o.material)
					? o.material
					: [o.material]) {
					const m = item as THREE.MeshStandardMaterial;
					if (m.name === "canopy-glass") {
						m.roughness = 0.45;
						m.metalness = 0.05;
					}
					if (m.isMeshStandardMaterial && m.map) {
						m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
						m.bumpMap = m.map;
						m.bumpScale = 0.001;

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
	a.download = `discovery-${selectedView}.png`;
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
	__discovery: {
		scene,
		composer,
		key,
		fill,
		rim,
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
		`DISCOVERY · EXTERIOR STUDY<br>${stats.fps.toFixed(0)} FPS · ${Math.round(stats.modelTriangles / 1000)}K TRIANGLES`;
}
requestAnimationFrame(frame);
