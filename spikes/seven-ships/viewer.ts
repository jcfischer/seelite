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

const catalog = {interceptor:['F1','Lance'],patrol:['F2','Warden'],explorer:['F3','Pilgrim'],raider:['F4','Shiv'],carrier:['F5','Bastion'],prospector:['F6','Sluice'],dreadnought:['F7','Rampart']} as const;
type Role=keyof typeof catalog;
const query=new URLSearchParams(location.search).get('ship')??'interceptor';
const role:Role=query in catalog ? query as Role : 'interceptor';
const [code,name]=catalog[role];
document.title=name+' — Exterior study';
document.querySelector('h1')!.textContent=name.toUpperCase();
document.querySelector('.sub')!.textContent=role==='explorer'?'80 m floor diameter · 3 RPM · 0.40 g':role+' · Approved exterior study';
(document.querySelector('#target-dialog img') as HTMLImageElement).src='./'+role+'/target.png';
const selector=document.querySelector<HTMLSelectElement>('#ship')!;
selector.value=role;selector.onchange=()=>{location.search='?ship='+selector.value;};
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
controls.maxDistance = 400;
const pmrem = new THREE.PMREMGenerator(renderer),
	room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.28;
room.dispose();
pmrem.dispose();
const key = new THREE.DirectionalLight(0xffebd2, 3.7);
key.position.set(-60, 65, 50);
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
const fill = new THREE.DirectionalLight(0xb4c8dc, 0.65);
fill.position.set(25, 12, 45);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffe4c6, 0.8);
rim.position.set(60, 65, -75);
scene.add(rim);
for (const x of [] as number[])
	for (const z of [-20, 0, 20]) {
		const service = new THREE.PointLight(0xff8c28, 90, 12, 2);
		service.position.set(x, 4.6, z);
		scene.add(service);
	}
const inspection = new THREE.HemisphereLight(0xd9e7f3, 0x9b9b88, 1.7);
inspection.visible = false;
scene.add(inspection);
const stars = new Float32Array(11000 * 3);
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
for (let i = 0; i < brightness.length; i++) brightness[i] = Math.pow(rand(), 5);
sg.setAttribute("brightness", new THREE.BufferAttribute(brightness, 1));
const starfield = new THREE.Points(
	sg,
	new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		vertexShader: `attribute float brightness; varying float vBrightness;
 void main(){vBrightness=brightness;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=1.0+brightness*5.0;}`,
		fragmentShader: `varying float vBrightness; void main(){vec2 q=gl_PointCoord-.5;float r=length(q);float core=exp(-r*r*80.0);float halo=exp(-r*r*14.0)*.14;float light=(core+halo)*(.15+vBrightness*1.7);gl_FragColor=vec4(mix(vec3(.65,.77,.9),vec3(1.0,.90,.75),vBrightness),light);}`,
	}),
);
scene.add(starfield);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ao = new SSAOPass(scene, camera, innerWidth, innerHeight);
ao.kernelRadius = 2.1;
ao.minDistance = 0.001;
ao.maxDistance = 0.025;
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
	hero: { position: [-85, 52, 92], target: [0, 0, 0] },
	front: { position: [0, 8, 128], target: [0, 0, 0] },
	top: { position: [0, 128, 0.01], target: [0, 0, 1] },
	rear: { position: [70, 43, -108], target: [0, 0, -3] },
	detail: { position: [-26, 16, 53], target: [0, 0, 21] },
	under: { position: [-64, -70, 84], target: [0, 0, 0] },
};
let rotating = false;
let rotor: THREE.Object3D | undefined;
let habitatRunning=false;
let selectedView = "hero";
function setView(name: string) {
	const v = views[name];
	if (!v) return;
	selectedView = name;
	ship.rotation.set(0, 0, 0);
	camera.position.fromArray(v.position);
    if(name==="hero")camera.position.multiplyScalar(role==="explorer"?1.15:(role==="carrier"||role==="dreadnought"?0.91:0.80));
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
	`./${role}/model.glb`,
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
					if (m.isMeshStandardMaterial && m.map) {
						m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
						m.bumpMap = m.map;
						m.bumpScale = 0.008;

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
		const bounds=new THREE.Box3().setFromObject(gltf.scene);const centre=bounds.getCenter(new THREE.Vector3());
        gltf.scene.position.sub(centre);const scale=70/Math.max(...stats.bounds);ship.scale.setScalar(scale);
        rotor=gltf.scene.getObjectByName('habitat-rotor');
        document.querySelector<HTMLButtonElement>('#habitat')!.hidden=!rotor;
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
document.querySelector<HTMLButtonElement>('#habitat')!.onclick=(e)=>{habitatRunning=!habitatRunning;(e.currentTarget as HTMLElement).setAttribute('aria-pressed',String(habitatRunning));};
const dialog = document.querySelector<HTMLDialogElement>("#target-dialog")!;
document.querySelector<HTMLButtonElement>("#target")!.onclick = () =>
	dialog.showModal();
document.querySelector<HTMLButtonElement>("#close-target")!.onclick = () =>
	dialog.close();
document.querySelector<HTMLButtonElement>("#save")!.onclick = () => {
	composer.render();
	const a = document.createElement("a");
	a.href = renderer.domElement.toDataURL("image/png");
	a.download = `${role}-${selectedView}.png`;
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
	__fleet: {
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
        get rotor(){return rotor;},
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
	if(rotor&&habitatRunning)rotor.rotation.z+=Math.min(delta,100)/1000*Math.PI*2*3/60;
	controls.update();
	renderer.info.reset();
	composer.render();
	stats.fps = 1000 / (times.reduce((a, b) => a + b, 0) / times.length);
	stats.triangles = renderer.info.render.triangles;
	stats.calls = renderer.info.render.calls;
	stats.view = selectedView;
	document.querySelector("#readout")!.innerHTML =
		`${code} · ${name.toUpperCase()}<br>${stats.fps.toFixed(0)} FPS · ${Math.round(stats.modelTriangles / 1000)}K TRIANGLES<br>${stats.bounds.map(v=>v.toFixed(1)).join(" × ")} m`;
}
requestAnimationFrame(frame);
