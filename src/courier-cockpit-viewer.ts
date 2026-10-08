/** Isolated geometry study. Fixture instruments, no Game, save or flight simulation. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildShipMesh } from "./ship-mesh";

const assets = "/spikes/courier-cockpit/";
const renderer = new THREE.WebGLRenderer({
	antialias: true,
	preserveDrawingBuffer: true,
	logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020509);
const camera = new THREE.PerspectiveCamera(
	58,
	innerWidth / innerHeight,
	0.04,
	10000,
);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxDistance = 80;
controls.minDistance = 0.2;
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.22;
room.dispose();
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0x9db5c8, 0x292322, 0.4));
const key = new THREE.DirectionalLight(0xffe2bd, 0.85);
key.position.set(-4, 7, -8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, {
	left: -8,
	right: 8,
	top: 8,
	bottom: -8,
	near: 0.5,
	far: 40,
});
key.shadow.bias = -0.00015;
key.shadow.normalBias = 0.012;
scene.add(key);
const fill = new THREE.DirectionalLight(0x6c9db6, 0.65);
fill.position.set(2, 2, 1);
scene.add(fill);
const inspection = new THREE.DirectionalLight(0xd4ecff, 0);
inspection.position.set(0, 4, 4);
scene.add(inspection);
for (const [x, color, power] of [
	[-1.6, 0x39c2e8, 5],
	[1.6, 0xffae54, 4],
	[0, 0xffb050, 1.5],
]) {
	const lamp = new THREE.PointLight(color, power, 4, 2);
	lamp.position.set(x, -1.65, -1.65);
	scene.add(lamp);
}
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(
	new UnrealBloomPass(
		new THREE.Vector2(innerWidth, innerHeight),
		0.17,
		0.35,
		1.25,
	),
);
composer.addPass(new OutputPass());

// Fixed stars are true world geometry; an orbit reveals parallax and mesh depth.
let seed = 792;
const rand = () =>
	(seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const starPos: number[] = [],
	starColors: number[] = [];
for (let i = 0; i < 2600; i++) {
	const az = rand() * Math.PI * 2,
		y = rand() * 2 - 1,
		r = Math.sqrt(1 - y * y),
		distance = 4500 + rand() * 1000;
	starPos.push(
		distance * r * Math.cos(az),
		distance * y,
		distance * r * Math.sin(az),
	);
	const c = new THREE.Color().setHSL(
		0.08 + rand() * 0.55,
		0.1 + rand() * 0.3,
		0.35 + rand() * 0.55,
	);
	starColors.push(c.r, c.g, c.b);
}
const starsGeometry = new THREE.BufferGeometry();
starsGeometry.setAttribute(
	"position",
	new THREE.Float32BufferAttribute(starPos, 3),
);
starsGeometry.setAttribute(
	"color",
	new THREE.Float32BufferAttribute(starColors, 3),
);
const stars = new THREE.Points(
	starsGeometry,
	new THREE.PointsMaterial({
		size: 4.5,
		vertexColors: true,
		sizeAttenuation: true,
	}),
);
scene.add(stars);

// The current courier A, unchanged source geometry. Interior cutaway is viewer-only.
const hull = buildShipMesh("courier", "a").root;
hull.scale.setScalar(1000);
hull.position.set(0, -4.7, 12.5);
scene.add(hull);
const hullClip = new THREE.Plane(new THREE.Vector3(0, 0, -1), -5.6);
const hullMaterials: THREE.MeshStandardMaterial[] = [];
hull.traverse((o) => {
	if (o instanceof THREE.Mesh) {
		const originals = Array.isArray(o.material) ? o.material : [o.material];
		const materials = originals.map((m) => {
			const copy = m.clone();
			if (copy instanceof THREE.MeshStandardMaterial) {
				copy.clippingPlanes = [hullClip];
				copy.onBeforeCompile = () => {};
				copy.customProgramCacheKey = () => "cockpit-hull";
				copy.color.setHex(0x668ca4);
				copy.metalness = 0.4;
				copy.roughness = 0.5;
				hullMaterials.push(copy);
			}
			return copy;
		});
		o.material = Array.isArray(o.material) ? materials : materials[0];
		o.receiveShadow = true;
		if (o.name === "courier-cockpit" || o.name === "courier-cockpit-fairing")
			o.visible = false;
	}
});

function makeDisplay(kind: string) {
	const canvas = document.createElement("canvas");
	canvas.width = 1024;
	canvas.height = kind === "systems" ? 300 : 700;
	const ctx = canvas.getContext("2d")!;
	const w = canvas.width,
		h = canvas.height;
	ctx.fillStyle = "#01090b";
	ctx.fillRect(0, 0, w, h);
	const color = kind === "flight" || kind === "systems" ? "#62e5ee" : "#ffc263";
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineWidth = 2;
	ctx.shadowColor = color;
	ctx.shadowBlur = 5;
	ctx.font = "26px monospace";
	const text = (s: string, x: number, y: number, size = 26) => {
		ctx.font = `${Math.round(size * 1.35)}px monospace`;
		ctx.fillText(s, x, y);
	};
	const line = (x: number, y: number, x1: number, y1: number) => {
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x1, y1);
		ctx.stroke();
	};
	const ship = (x: number, y: number, scale = 1) => {
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(scale, scale);
		ctx.beginPath();
		ctx.moveTo(0, -100);
		ctx.lineTo(65, 70);
		ctx.lineTo(35, 90);
		ctx.lineTo(0, 65);
		ctx.lineTo(-35, 90);
		ctx.lineTo(-65, 70);
		ctx.closePath();
		ctx.stroke();
		line(0, -100, 0, 65);
		line(-50, 20, 50, 20);
		line(-65, 70, 65, 70);
		for (const s of [-1, 1]) ctx.strokeRect(s * 80 - 13, -15, 26, 95);
		ctx.restore();
	};
	if (kind === "radar") {
		text("LOCAL / 5 KM", 34, 42, 20);
		text("ASSIST ON", 780, 42, 20);
		ctx.save();
		ctx.translate(w / 2, h * 0.52);
		ctx.scale(1, 0.67);
		for (const r of [75, 150, 230, 310, 405]) {
			ctx.beginPath();
			ctx.arc(0, 0, r, 0, Math.PI * 2);
			ctx.stroke();
		}
		line(-425, 0, 425, 0);
		line(0, -425, 0, 425);
		ctx.restore();
		for (const [x, y] of [
			[270, 400],
			[630, 330],
			[720, 410],
		]) {
			ctx.fillRect(x, y, 7, 7);
			line(x + 3, y, x + 3, y - 45);
		}
		ctx.strokeStyle = "#77e8ef";
		ship(w / 2, h * 0.51, 0.33);
		ctx.strokeStyle = color;
		text("MODE NORMAL   THR 0%   CHARGE 12.0 AU", 38, h - 25, 21);
	} else if (kind === "flight") {
		text("REL. VELOCITY", 42, 65, 28);
		text("0.000", 42, 170, 66);
		text("km/s", 300, 166, 35);
		for (let i = 0; i < 13; i++) ctx.fillRect(44 + i * 26, 205, 18, 20);
		line(40, 270, 530, 270);
		text("STATION FRAME", 42, 330, 26);
		text("INERTIAL 29 km/s", 42, 388, 26);
		text("ASSIST ON", 42, 470, 23);
		text("FUEL 7.0 LY", 42, 530, 23);
		ship(760, 310, 1.75);
	} else if (kind === "systems") {
		["SYS", "ENG", "WEP"].forEach((s, i) => {
			text(s, 45, 68 + i * 76, 30);
			for (let k = 0; k < 6; k++)
				ctx.fillRect(150 + k * 28, 45 + i * 76, 19, 27);
		});
		ship(750, 145, 0.85);
	} else {
		text("TARGET", 42, 70, 26);
		text("STATION · TRADE", 42, 135, 25);
		text("ARTEQUGE", 42, 235, 44);
		text("2.2 km", 710, 235, 34);
		line(42, 305, 975, 305);
		text("REL V  0.00 km/s", 42, 374, 25);
		text("CLEARANCE  NONE", 42, 440, 25);
		text("NAV / DOCK / COMMS", 42, 535, 22);
	}
	ctx.shadowBlur = 0;
	ctx.globalAlpha = 0.09;
	ctx.fillStyle = "#000";
	for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
	ctx.globalAlpha = 1;
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	texture.flipY = false;
	return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
}

function makeEquipmentLabel(name: string) {
	const canvas = document.createElement("canvas");
	canvas.width = 768;
	canvas.height = name.startsWith("key-") ? 256 : 80;
	const ctx = canvas.getContext("2d")!;
	ctx.fillStyle = "#111719";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	const labels: Record<string, string> = {
		"label-radar": "SCOPE  /  RANGE SELECT",
		"label-flight": "FLIGHT  /  RELATIVE",
		"label-systems": "POWER DISTRIBUTION",
		"label-target": "NAVIGATION COMPUTER",
	};
	const keys = [
		"1",
		"2",
		"3",
		"NAV",
		"ENT",
		"4",
		"5",
		"6",
		"DCK",
		"CLR",
		"7",
		"8",
		"9",
		"COM",
		"0",
	];
	const key = name.startsWith("key-");
	ctx.fillStyle = key ? "#e4c896" : "#aebdc0";
	ctx.font = `${key ? 120 : 46}px monospace`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(
		key ? (keys[Number(name.slice(4))] ?? "") : (labels[name] ?? ""),
		canvas.width / 2,
		canvas.height / 2,
	);
	const map = new THREE.CanvasTexture(canvas);
	map.colorSpace = THREE.SRGBColorSpace;
	map.flipY = false;
	map.anisotropy = 8;
	return new THREE.MeshBasicMaterial({ map, toneMapped: false });
}
const loader = new GLTFLoader();
let cockpit: THREE.Group, station: THREE.Group;
let fit = false,
	view = "pilot",
	yaw = 0,
	pitch = 0;
const skyTexture = new THREE.TextureLoader().load(assets + "starfield.png");
skyTexture.colorSpace = THREE.SRGBColorSpace;
skyTexture.mapping = THREE.EquirectangularReflectionMapping;
const skyBackdrop = new THREE.Mesh(
	new THREE.PlaneGeometry(14500, 7800),
	new THREE.MeshBasicMaterial({
		map: skyTexture,
		color: 0x999999,
		toneMapped: false,
		depthWrite: false,
	}),
);
skyTexture.mapping = THREE.UVMapping;
skyBackdrop.position.set(0, 500, -6500);
scene.add(skyBackdrop);
const stats = {
	loaded: false,
	fps: 0,
	frameMs: 0,
	triangles: 0,
	calls: 0,
	view,
	fit,
};
const views: Record<string, { p: number[]; t: number[]; fov?: number }> = {
	pilot: { p: [0, 0, 1.15], t: [0, -2.75, -10], fov: 64 },
	orbit: { p: [7, 4, 6], t: [0, -0.8, -2.5], fov: 50 },
	instruments: { p: [0, -0.12, -0.1], t: [0, -1.12, -2.35], fov: 50 },
	side: { p: [6, 1.6, -1], t: [0, -0.6, -2.2], fov: 50 },
};
function setView(name: string) {
	yaw = 0;
	pitch = name === "pilot" ? -0.242 : 0;
	const v = views[name];
	if (!v) return;
	view = name;
	camera.position.fromArray(v.p);
	controls.target.fromArray(v.t);
	camera.fov = v.fov ?? 58;
	camera.updateProjectionMatrix();
	controls.enablePan = name !== "pilot";
	controls.enableZoom = name !== "pilot";
	controls.enableRotate = name !== "pilot";
	controls.update();
	for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]"))
		b.setAttribute("aria-pressed", String(b.dataset.view === name));
	if (station) station.visible = name === "pilot";
	stars.visible = name === "pilot";
	hull.visible = name === "pilot" || fit;
	if (name !== "pilot" && !fit) hull.visible = false;
	skyBackdrop.visible = name === "pilot";
	scene.background = new THREE.Color(0x030609);
	stats.view = view;
}
function setFit(on: boolean) {
	fit = on;
	stats.fit = fit;
	for (const m of hullMaterials) {
		m.clippingPlanes = fit ? [] : [hullClip];
		m.wireframe = fit;
		m.transparent = fit;
		m.opacity = fit ? 0.24 : 1;
		m.depthWrite = !fit;
		m.needsUpdate = true;
	}
	hull.traverse((o) => {
		if (o.name === "courier-cockpit" || o.name === "courier-cockpit-fairing")
			o.visible = fit;
	});
	hull.visible = view === "pilot" || fit;
	document.querySelector("#fit")?.setAttribute("aria-pressed", String(fit));
}
setView("pilot");
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]"))
	b.onclick = () => setView(b.dataset.view!);
document.querySelector<HTMLButtonElement>("#fit")!.onclick = () => {
	if (view === "pilot") setView("orbit");
	setFit(!fit);
};
document.querySelector<HTMLButtonElement>("#lights")!.onclick = (e) => {
	inspection.intensity = inspection.intensity ? 0 : 2.5;
	(e.currentTarget as HTMLElement).setAttribute(
		"aria-pressed",
		String(inspection.intensity > 0),
	);
};
const dialog = document.querySelector<HTMLDivElement>("#target-dialog")!;
document.querySelector<HTMLButtonElement>("#target")!.onclick = () =>
	(dialog.hidden = false);
document.querySelector<HTMLButtonElement>("#close-target")!.onclick = () =>
	(dialog.hidden = true);
document.querySelector<HTMLButtonElement>("#capture")!.onclick = () => {
	const a = document.createElement("a");
	a.download = `courier-${view}.png`;
	a.href = renderer.domElement.toDataURL("image/png");
	a.click();
};
window.addEventListener("keydown", (e) => {
	if (e.key === "Escape") dialog.hidden = true;
	if (e.key.toLowerCase() === "p") {
		setFit(false);
		setView("pilot");
	}
	if (e.key.toLowerCase() === "h") document.body.classList.toggle("capture");
});
let down = false,
	lastX = 0,
	lastY = 0;
renderer.domElement.addEventListener("pointerdown", (e) => {
	if (view === "pilot") {
		down = true;
		lastX = e.clientX;
		lastY = e.clientY;
		renderer.domElement.setPointerCapture(e.pointerId);
	}
});
renderer.domElement.addEventListener("pointerup", () => (down = false));
renderer.domElement.addEventListener("pointercancel", () => (down = false));
renderer.domElement.addEventListener("pointermove", (e) => {
	if (!down || view !== "pilot") return;
	yaw = Math.max(-0.9, Math.min(0.9, yaw - (e.clientX - lastX) * 0.003));
	pitch = Math.max(-0.55, Math.min(0.4, pitch + (e.clientY - lastY) * 0.003));
	lastX = e.clientX;
	lastY = e.clientY;
	controls.target.set(
		camera.position.x + Math.sin(yaw) * 10,
		camera.position.y + Math.sin(pitch) * 10,
		camera.position.z - Math.cos(yaw) * Math.cos(pitch) * 10,
	);
	controls.update();
});
addEventListener("resize", () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
	composer.setSize(innerWidth, innerHeight);
});
Object.assign(window, {
	__cockpit: {
		scene,
		camera,
		renderer,
		controls,
		stats,
		setView,
		setFit,
		capture: () => document.body.classList.add("capture"),
	},
});

try {
	const [interior, exterior] = await Promise.all([
		loader.loadAsync(assets + "courier-cockpit.glb"),
		loader.loadAsync(assets + "station-reference.glb"),
	]);
	cockpit = interior.scene;
	scene.add(cockpit);
	cockpit.traverse((o) => {
		if (o instanceof THREE.Mesh) {
			o.castShadow = true;
			o.receiveShadow = true;
			if (o.name.startsWith("screen-")) {
				o.material = makeDisplay(o.name.slice(7));
				o.castShadow = false;
				return;
			}
			if (o.name.startsWith("label-") || o.name.startsWith("key-")) {
				o.material = makeEquipmentLabel(o.name);
				o.castShadow = false;
				return;
			}
			for (const m of Array.isArray(o.material) ? o.material : [o.material])
				if (m instanceof THREE.MeshStandardMaterial && m.map) {
					const tints: Record<string, number> = {
						"weathered-blue-steel": 0x405868,
						"graphite-housings": 0x283842,
						"exposed-machined-edges": 0x8d9395,
						"service-ochre": 0xbc7923,
						"guarded-red": 0x992c20,
					};
					m.color.setHex(tints[m.name] ?? 0xffffff);
					m.envMapIntensity = 1.15;
					if (m.name !== "exposed-machined-edges") {
						m.metalness = 0.65;
						m.roughness = m.name === "graphite-housings" ? 0.42 : 0.34;
					}
					m.map.anisotropy = 8;
					m.bumpMap = m.map;
					m.bumpScale = 0.004;
					m.needsUpdate = true;
				}
		}
	});
	station = exterior.scene;
	station.traverse((o) => {
		o.layers.set(1);
		if (o instanceof THREE.Mesh) {
			for (const m of Array.isArray(o.material) ? o.material : [o.material])
				if (m instanceof THREE.MeshStandardMaterial) {
					m.envMapIntensity = 0.25;
					if (m.map) {
						m.map.anisotropy = 8;
						m.map.minFilter = THREE.LinearMipmapLinearFilter;
						m.map.magFilter = THREE.LinearFilter;
					}
				}
		}
	});
	station.position.set(0, -35, -2580);
	station.rotation.set(0.12, -0.36, 0.08);
	scene.add(station);
	const bayLamp = new THREE.PointLight(0xffb15a, 1500000, 550, 2);
	bayLamp.position.set(0, 0, 390);
	bayLamp.layers.set(1);
	station.add(bayLamp);
	camera.layers.enable(1);
	const stationKey = new THREE.DirectionalLight(0xffe4c9, 3.5);
	stationKey.position.set(-5, 7, 9);
	stationKey.layers.set(1);
	scene.add(stationKey);
	const stationFill = new THREE.DirectionalLight(0x789aaa, 0.7);
	stationFill.position.set(5, 2, 3);
	stationFill.layers.set(1);
	scene.add(stationFill);
	stats.loaded = true;
	document.querySelector("#loading")?.remove();
} catch (error) {
	document.querySelector("#loading")!.textContent =
		"Model failed to load. Reload the viewer.";
	console.error(error);
}
let previous = performance.now();
const times: number[] = [];
function animate(now: number) {
	requestAnimationFrame(animate);
	times.push(now - previous);
	previous = now;
	if (times.length > 120) times.shift();
	controls.update();
	renderer.info.reset();
	composer.render();
	stats.frameMs = times.reduce((s, t) => s + t, 0) / times.length;
	stats.fps = 1000 / stats.frameMs;
	stats.triangles = renderer.info.render.triangles;
	stats.calls = renderer.info.render.calls;
	document.querySelector("#readout")!.textContent =
		`${stats.fps.toFixed(0)} FPS · ${stats.frameMs.toFixed(1)} ms\nCOURIER A · ${view.toUpperCase()}`;
}
requestAnimationFrame(animate);
