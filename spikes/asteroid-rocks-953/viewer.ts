import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadRocks } from "./load";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#080b10");
const camera = new THREE.PerspectiveCamera(
	38,
	innerWidth / innerHeight,
	0.01,
	100,
);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 1.05;
controls.maxDistance = 12;
const sun = new THREE.DirectionalLight(0xffe6c7, 3.0);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbacbe1, 0x12151c, 0.6));
const root = new THREE.Group();
root.position.x = 0.3;
scene.add(root);
controls.target.copy(root.position);
const clay = new THREE.MeshStandardMaterial({
	color: 0x92969b,
	roughness: 0.95,
});
const wire = new THREE.MeshBasicMaterial({ color: 0xbcb6a8, wireframe: true });
const el = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;
let rotating = false,
	level = 0,
	index = 0,
	mesh: THREE.Mesh;
let dirty = true;
let asset: Awaited<ReturnType<typeof loadRocks>>;
let standard: THREE.MeshStandardMaterial;
function reset() {
	camera.position.set(2.3, 1.25, 3.2);
	controls.target.copy(root.position);
	controls.update();
}
reset();
function light() {
	const a = (Number(el<HTMLInputElement>("light").value) * Math.PI) / 180;
	sun.position.set(Math.sin(a) * 4, 2.2, Math.cos(a) * 4);
	dirty = true;
}
light();
el("light").addEventListener("input", light);
el("exposure").addEventListener("input", () => {
	renderer.toneMappingExposure = Number(el<HTMLInputElement>("exposure").value);
	dirty = true;
});
function show() {
	if (!asset) return;
	if (mesh) root.remove(mesh);
	const mode = el<HTMLSelectElement>("shading").value;
	const mat =
		mode === "clay"
			? clay
			: mode === "wire"
				? wire
				: mode === "standard"
					? standard
					: asset.material;
	mesh = new THREE.Mesh(asset.levels[index][level], mat);
	root.add(mesh);
	dirty = true;
	const tris =
		(mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
	el("status").textContent =
		`${asset.levels.length} ${asset.levels.length === 1 ? "shape" : "shapes"} available · ${tris.toLocaleString()} triangles · ${["Near", "Mid", "Far"][level]}`;
}
el("levels").addEventListener("click", (e) => {
	const b = (e.target as HTMLElement).closest("button");
	if (!b) return;
	level = Number(b.dataset.level);
	for (const c of el("levels").children) c.classList.toggle("active", c === b);
	show();
});
el("shape").addEventListener("change", () => {
	index = Number(el<HTMLSelectElement>("shape").value);
	show();
});
el("shading").addEventListener("change", show);
el("reset").addEventListener("click", reset);
el("spin").addEventListener("click", () => {
	rotating = !rotating;
	el("spin").textContent = rotating ? "Stop" : "Rotate";
});
el("reference").addEventListener("click", () => {
	const im = el("target");
	const on = im.style.display !== "block";
	im.style.display = on ? "block" : "none";
	el("reference").textContent = on ? "Hide target" : "Show target";
});
addEventListener("resize", () => {
	renderer.setSize(innerWidth, innerHeight);
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	dirty = true;
});
renderer.setAnimationLoop(() => {
	if (rotating) {
		root.rotation.y += 0.002;
		dirty = true;
	}
	if (controls.update()) dirty = true;
	if (dirty) {
		renderer.render(scene, camera);
		dirty = false;
	}
});
try {
	asset = await loadRocks("lambert");
	const m = asset.material as THREE.MeshLambertMaterial;
	standard = new THREE.MeshStandardMaterial({
		color: m.color,
		map: m.map,
		normalMap: m.normalMap,
		normalScale: m.normalScale,
		roughness: 0.94,
	});
	const manifest = await (await fetch("./runtime/manifest.json")).json();
	el<HTMLSelectElement>("shape").innerHTML = manifest.archetypes
		.map(
			(a: { index: number; name: string }) =>
				`<option value="${a.index}">${String(a.index + 1).padStart(2, "0")} · ${a.name.replaceAll("-", " ")}</option>`,
		)
		.join("");
	show();
	Object.assign(window, {
		__asteroidViewer: { asset, renderer, scene, camera, controls, show },
	});
} catch (e) {
	el("error").textContent = String(e);
	throw e;
}
