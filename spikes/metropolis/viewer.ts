import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { createMetropolis } from "./model";
import { CAPACITY } from "./growth";

const $ = <E extends HTMLElement>(id: string) =>
	document.getElementById(id) as E;
const renderer = new T.WebGLRenderer({
	antialias: true,
	preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.info.autoReset = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
document.body.prepend(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color(0x020306);
const camera = new T.PerspectiveCamera(31, innerWidth / innerHeight, 5, 180000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 150;
controls.maxDistance = 25000;
const pmrem = new T.PMREMGenerator(renderer),
	room = new RoomEnvironment();
const env = pmrem.fromScene(room, 0.04).texture;
scene.environment = env;
scene.environmentIntensity = 0.22;
room.dispose();
pmrem.dispose();
const sun = new T.DirectionalLight(0xffe8c8, 4.8);
sun.position.set(-6000, 6500, 2000);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, {
	left: -4600,
	right: 4600,
	top: 2600,
	bottom: -2600,
	near: 50,
	far: 16000,
});
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 2;
scene.add(sun);
const fill = new T.DirectionalLight(0x94aabe, 0.5);
fill.position.set(2000, -3000, 5000);
scene.add(fill);
const rim = new T.DirectionalLight(0xf2c693, 2.15);
rim.position.set(1000, 2000, -6000);
scene.add(rim);

// Fixed sparse starfield, independent of the station's assembly seed.
let s = 19;
const rand = () =>
	(s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
const points = new Float32Array(2200 * 3);
for (let i = 0; i < points.length; i += 3) {
	const z = rand() * 2 - 1,
		a = rand() * Math.PI * 2,
		r = Math.sqrt(1 - z * z);
	points.set([r * Math.cos(a) * 80000, z * 80000, r * Math.sin(a) * 80000], i);
}
const sg = new T.BufferGeometry();
sg.setAttribute("position", new T.BufferAttribute(points, 3));
scene.add(
	new T.Points(
		sg,
		new T.PointsMaterial({
			color: 0x9caab4,
			size: 1.15,
			sizeAttenuation: false,
		}),
	),
);

const planetGeo = new T.SphereGeometry(12500, 96, 64);
const planetMat = new T.ShaderMaterial({
	vertexShader: `varying vec3 n; varying vec3 p; void main(){n=normalize(normalMatrix*normal);p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
	fragmentShader: `varying vec3 n;varying vec3 p;
 float hash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,45.164)))*43758.5453);}
 float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
 void main(){vec3 q=p/12500.;float f=noise(q*8.)*.5+noise(q*25.)*.25+noise(q*70.)*.13;float band=sin(q.y*38.+f*6.)*.5+.5;vec3 c=mix(vec3(.09,.075,.065),vec3(.21,.17,.13),band*.4+f);float lit=max(0.,dot(normalize(n),normalize(vec3(-.6,.75,-.12))));float fres=pow(1.-max(0.,n.z),6.);gl_FragColor=vec4(c*(.008+lit*.75)+vec3(.04,.10,.19)*fres*lit,1.);}`,
});
const planet = new T.Mesh(planetGeo, planetMat);
planet.position.set(48000, -9000, -24500);
planet.scale.setScalar(1.5);
planet.rotation.z = -0.4;
scene.add(planet);

const renderTarget = new T.WebGLRenderTarget(innerWidth, innerHeight, {
	type: T.HalfFloatType,
	samples: 4,
});
const composer = new EffectComposer(renderer, renderTarget);
composer.addPass(new RenderPass(scene, camera));
const ao = new SSAOPass(scene, camera, innerWidth, innerHeight);
ao.kernelRadius = 12;
ao.minDistance = 0.0001;
ao.maxDistance = 0.025;
composer.addPass(ao);
composer.addPass(
	new UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), 0.22, 0.35, 1.2),
);
composer.addPass(new OutputPass());
let station: Awaited<ReturnType<typeof createMetropolis>>;
let spinning = false,
	growing = false,
	loaded = false,
	frames = 0,
	last = performance.now(),
	fps = 0,
	nextGrowth = 0;
const times: number[] = [];
const setView = (view: string) => {
	if (view === "detail") {
		camera.position.set(-1500, 950, 3700);
		controls.target.set(0, 400, -80);
	} else if (view === "front") {
		camera.position.set(-400, 150, 11500);
		controls.target.set(-400, 0, 0);
	} else if (view === "rear") {
		camera.position.set(2200, 1600, -10500);
		controls.target.set(-300, 0, -100);
	} else {
		camera.position.set(-5900, 1400, 6750);
		controls.target.set(-430, 0, -70);
	}
	controls.update();
};
setView("hero");
function setCount(n: number) {
	station.setCount(n);
	$("count-value").textContent = `${n} / ${CAPACITY}`;
	$<HTMLInputElement>("count").value = String(n);
	$<HTMLButtonElement>("add").disabled = n === CAPACITY;
	renderer.shadowMap.needsUpdate = true;
}
let loadSequence = 0;
async function loadSeed(seed: number) {
	const seq = ++loadSequence;
	loaded = false;
	const count = station?.count ?? 42;
	document
		.querySelectorAll("aside button,aside input")
		.forEach((el) => ((el as HTMLInputElement).disabled = true));
	try {
		const next = await createMetropolis(seed, count);
		if (seq !== loadSequence) {
			next.dispose();
			return;
		}
		if (station) {
			scene.remove(station.root);
			station.dispose();
		}
		station = next;
		scene.add(station.root);
		loaded = true;
		document
			.querySelectorAll("aside button,aside input")
			.forEach((el) => ((el as HTMLInputElement).disabled = false));
		setCount(count);
	} catch (e) {
		$("status").textContent = String(e);
		throw e;
	}
}
$("count").oninput = () => {
	growing = false;
	setCount(Number($<HTMLInputElement>("count").value));
	$("grow").textContent = "Watch expansion";
};
$("add").onclick = () => {
	if (loaded && station.count < CAPACITY) setCount(station.count + 1);
};
$("grow").onclick = () => {
	growing = !growing;
	if (growing && station.count === CAPACITY) setCount(0);
	$("grow").textContent = growing ? "Pause expansion" : "Watch expansion";
};
$("seed").onchange = () => {
	const n = Number($<HTMLInputElement>("seed").value);
	if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) void loadSeed(n);
};
$("hero").onclick = () => setView("hero");
$("detail").onclick = () => setView("detail");
$("spin").onclick = () => {
	spinning = !spinning;
	$("spin").textContent = `Rotation ${spinning ? "on" : "off"}`;
};
addEventListener("resize", () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
	composer.setSize(innerWidth, innerHeight);
});
const api = {
	get loaded() {
		return loaded;
	},
	get station() {
		return station;
	},
	get fps() {
		return fps;
	},
	renderer,
	scene,
	camera,
	setView,
	setCount,
	loadSeed,
	times,
	get stats() {
		return {
			modules: station?.count,
			drawCalls: renderer.info.render.calls,
			triangles: renderer.info.render.triangles,
			fps,
			geometries: renderer.info.memory.geometries,
		};
	},
	capture() {
		document.body.classList.add("capture");
	},
	get spinning() {
		return spinning;
	},
	set spinning(v: boolean) {
		spinning = v;
	},
};
(window as any).__metropolis = api;
await loadSeed(47);
let then = performance.now();
renderer.setAnimationLoop(() => {
	const now = performance.now(),
		dt = Math.min((now - then) / 1000, 0.1);
	then = now;
	controls.update();
	if (loaded && spinning) {
		station.rotors[0].rotation.z += dt * 0.025;
		station.rotors[1].rotation.z -= dt * 0.035;
		renderer.shadowMap.needsUpdate = true;
	}
	if (loaded && growing && now > nextGrowth) {
		if (station.count < CAPACITY) setCount(station.count + 1);
		else {
			growing = false;
			$("grow").textContent = "Watch expansion";
		}
		nextGrowth = now + 900;
	}
	const t = performance.now();
	renderer.info.reset();
	composer.render();
	times.push(performance.now() - t);
	if (times.length > 300) times.shift();
	frames++;
	if (now - last > 1000) {
		fps = (frames * 1000) / (now - last);
		frames = 0;
		last = now;
		const b = new T.Box3().setFromObject(station.root).getSize(new T.Vector3());
		$("status").textContent =
			`${(b.x / 1000).toFixed(1)} km span · ${station.count} districts\n${fps.toFixed(0)} fps · drag to explore`;
	}
});
