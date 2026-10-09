/** Isolated metre-scale authored hull viewer. Does not construct a Game. */
import * as THREE from "three";
import { detailLevel, type DetailLevel } from "../../src/detail-level";
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
const role:Role=Object.hasOwn(catalog, query) ? query as Role : 'interceptor';
const [code,name]=catalog[role];
document.title=name+' — Exterior study';
document.querySelector('h1')!.textContent=name.toUpperCase();
document.querySelector('.sub')!.textContent=role==='explorer'?'80 m floor diameter · 3 RPM · 0.40 g':(role==='carrier'||role==='dreadnought')?'180 m floor diameter · 2.5 RPM · 0.63 g':role+' · Approved exterior study';
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
renderer.toneMappingExposure = 1.0;
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
	150000,
);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 5;
controls.maxDistance = 100000;
const pmrem = new THREE.PMREMGenerator(renderer),
	room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.16;
room.dispose();
pmrem.dispose();
const key = new THREE.DirectionalLight(0xffeedb, 4.5);
if (role === "carrier") key.position.set(-60, 65, 50);
else key.position.set(-45, 85, -30);
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
const fill = new THREE.DirectionalLight(0xb4c8dc, 0.70);
fill.position.set(25, 12, 45);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xc1d7ee, 1.2);
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
let habitatRPM=3;
const levels: Partial<Record<DetailLevel, THREE.Object3D>> = {};
const rotors: THREE.Object3D[] = [];
const levelTriangles: Partial<Record<DetailLevel, number>> = {};
const levelMeshes: Partial<Record<DetailLevel, number>> = {};
let activeLevel: DetailLevel = "full";
let lodMode: DetailLevel | "auto" = "auto";
let reach = 1;
const lodSelector=document.querySelector<HTMLSelectElement>('#lod')!;
lodSelector.onchange=()=>{lodMode=lodSelector.value as typeof lodMode;updateLevel();};
function updateLevel() {
 if(!stats.loaded)return;
 const worldCentre=ship.getWorldPosition(new THREE.Vector3());
 const distance=camera.position.distanceTo(worldCentre);
 // Adapt the reference 60-degree / 1800-device-pixel frame to this viewer.
 const pixelFrame=renderer.getDrawingBufferSize(new THREE.Vector2()).y;
 const equivalentRadii=distance/reach * Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/Math.tan(Math.PI/6) * 1800/pixelFrame;
 activeLevel=lodMode==='auto'?detailLevel(activeLevel,equivalentRadii):lodMode;
 for(const [level,object] of Object.entries(levels))object.visible=level===activeLevel;
 stats.lod=activeLevel;stats.lodMode=lodMode;stats.distanceRadii=equivalentRadii;
 stats.modelTriangles=levelTriangles[activeLevel]??0;stats.meshCount=levelMeshes[activeLevel]??0;
 rotor=rotors.find(o=>levels[activeLevel]?.getObjectByName('habitat-rotor')===o);
}

let selectedView = "hero";
if(role==="carrier")document.querySelector('[data-view="detail"]')!.textContent="Bay interior";
function setView(name: string) {
	const v = role==="carrier" && name==="detail" ? {position:[-2,1,47],target:[0,-1,25]} : views[name];
	if (!v) return;
	selectedView = name;
	ship.rotation.set(0, 0, 0);
	camera.position.fromArray(v.position);
    if(name==="hero")camera.position.multiplyScalar(role==="explorer"?1.15:(role==="carrier"||role==="dreadnought"?0.84:0.77));
	controls.target.fromArray(v.target);
	camera.position
		.sub(controls.target)
		.multiplyScalar(Math.max(1, 1.6 / camera.aspect))
		.add(controls.target);
	controls.update();
 // Fit full-hull inspection presets without changing the approved hero/detail view.
 if (ship.children.length && name !== "hero" && name !== "detail") {
  const bounds = new THREE.Box3().setFromObject(ship);
  const centre = bounds.getCenter(new THREE.Vector3());
  const back = camera.position.clone().sub(controls.target).normalize();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let distance = 0;
  for (const x of [bounds.min.x, bounds.max.x])
   for (const y of [bounds.min.y, bounds.max.y])
    for (const z of [bounds.min.z, bounds.max.z]) {
     const point = new THREE.Vector3(x, y, z).sub(centre);
     distance = Math.max(distance, point.dot(back) + 1.1 * Math.max(Math.abs(point.dot(up)) / tanY, Math.abs(point.dot(right)) / (tanY * camera.aspect)));
    }
  controls.target.copy(centre);
  camera.position.copy(centre).addScaledVector(back, distance);
  controls.update();
 }
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
 lod: "full" as DetailLevel, lodMode: "auto" as string, distanceRadii: 0,
};
async function loadLevels() {
 const loader=new GLTFLoader();
 const full=await loader.loadAsync(`./${role}/model.glb`);
 const sharedMaterials=new Map<string,THREE.Material>();
 full.scene.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])sharedMaterials.set(m.name,m);});
 const bounds=new THREE.Box3().setFromObject(full.scene);
 stats.bounds=bounds.getSize(new THREE.Vector3()).toArray();
 const centre=bounds.getCenter(new THREE.Vector3());
 const scale=70/Math.max(...stats.bounds);ship.scale.setScalar(scale);
 const report=await fetch(`./${role}/lod-report.json`).then(r=>{if(!r.ok)throw Error('LOD report unavailable');return r.json();});
 reach=report.reachMetres*scale;
 for(const level of ['full','reduced','outline'] as const) {
  const gltf=level==='full'?full:await loader.loadAsync(`./${role}/model-${level}.glb`);
  let triangles=0,meshes=0;
  const replacedMaterials=new Set<THREE.Material>();
  gltf.scene.traverse(object=>{
   const o=object as THREE.Mesh;if(!o.isMesh)return;
   if(level!=='full') {
    const reuse=(m:THREE.Material)=>{const shared=sharedMaterials.get(m.name);if(shared){replacedMaterials.add(m);return shared;}return m;};
    o.material=Array.isArray(o.material)?o.material.map(reuse):reuse(o.material);
   }
   o.castShadow=true;o.receiveShadow=true;meshes++;
   triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
   for(const item of Array.isArray(o.material)?o.material:[o.material]) {
    const m=item as THREE.MeshStandardMaterial;
    if(m.isMeshStandardMaterial&&m.map) {m.map.anisotropy=renderer.capabilities.getMaxAnisotropy();m.bumpMap=m.map;m.bumpScale=.008;m.needsUpdate=true;}
   }
  });
  const replacedTextures=new Set<THREE.Texture>();
  for(const material of replacedMaterials){for(const value of Object.values(material))if(value instanceof THREE.Texture)replacedTextures.add(value);material.dispose();}
  for(const texture of replacedTextures)texture.dispose();
  gltf.scene.position.sub(centre);ship.add(gltf.scene);
  levels[level]=gltf.scene;levelTriangles[level]=triangles;levelMeshes[level]=meshes;
  if(role==='carrier')for(const x of [-30,30])for(const z of [100,156]){
   const light=new THREE.PointLight(0xffc88b,16,12,2);light.position.set(x,18,z);gltf.scene.add(light);
  }
  const moving=gltf.scene.getObjectByName('habitat-rotor');if(moving)rotors.push(moving);
 }
 rotor=rotors[0];
 document.querySelector<HTMLButtonElement>('#habitat')!.hidden=!rotor;
 if(rotor){habitatRPM=Number(rotor.userData.rotationRPM);document.querySelector('#habitat')!.textContent='Habitat · '+habitatRPM+' RPM';}
 stats.loaded=true;updateLevel();document.querySelector('#loading')?.remove();
}
loadLevels().catch(error=>{document.querySelector('#loading')!.textContent='Model unavailable — reload to retry';console.error(error);});
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-range]'))button.onclick=()=>{
 const radii=Number(button.dataset.range);
 const pixelFrame=renderer.getDrawingBufferSize(new THREE.Vector2()).y;
 const distance=radii*reach*Math.tan(Math.PI/6)/Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*pixelFrame/1800;
 const direction=camera.position.clone().sub(controls.target).normalize();
 controls.target.set(0,0,0);camera.position.copy(direction.multiplyScalar(distance));controls.update();updateLevel();
};
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
        setView, levels, rotors, levelTriangles,
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
	if(habitatRunning)for(const moving of rotors)moving.rotation.z+=Math.min(delta,100)/1000*Math.PI*2*habitatRPM/60;
 updateLevel();
	controls.update();
	renderer.info.reset();
	composer.render();
	stats.fps = 1000 / (times.reduce((a, b) => a + b, 0) / times.length);
	stats.triangles = renderer.info.render.triangles;
	stats.calls = renderer.info.render.calls;
	stats.view = selectedView;
	document.querySelector("#readout")!.innerHTML =
		`${code} · ${name.toUpperCase()} · ${stats.lod.toUpperCase()}<br>${stats.fps.toFixed(0)} FPS · ${Math.round(stats.modelTriangles / 1000)}K TRIANGLES<br>${stats.bounds.map(v=>v.toFixed(1)).join(" × ")} m`;
}
requestAnimationFrame(frame);
