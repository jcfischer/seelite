import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildSpike } from "./assembly";
import { CELL_KM } from "./blocks";
import { NODE, TUBE_X, TUBE_Y } from "../../../src/station-modular";
import { STATION_GEOMETRY } from "../../../src/station";

const renderer = new THREE.WebGLRenderer({
	antialias: true,
	preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03070a);
const pmrem = new THREE.PMREMGenerator(renderer),
	room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture;
scene.environmentIntensity = 0.36;
room.dispose();
pmrem.dispose();
for (const [color, intensity, position] of [
	[0xfff1da, 4.5, [-1.8, 2.6, 2.5]],
	[0xffe5bf, 1.1, [1.8, 0.6, 1.5]],
	[0xa6bbca, 1.0, [0.8, 0.8, -1.9]],
] as const) {
	const light = new THREE.DirectionalLight(color, intensity);
	light.position.set(position[0], position[1], position[2]);
	scene.add(light);
}
const camera = new THREE.PerspectiveCamera(
	38,
	innerWidth / innerHeight,
	0.001,
	20,
);
const controls = new OrbitControls(camera, renderer.domElement);
controls.minDistance = 0.08;
controls.maxDistance = 10;
const kit = (
	await new GLTFLoader().loadAsync(
		new URL("./blocks.glb", import.meta.url).href,
	)
).scene;
let current: ReturnType<typeof buildSpike> | undefined;
let state = { seed: 0, authored: true, view: "overview", phase: 0 };
let framing: { target: number[]; camera: number[]; joint: unknown };
function frame(view: string) {
	const target = new THREE.Vector3(0, 0, 0.06);
	let offset = new THREE.Vector3(1.15, 0.8, 2.7),
		joint: unknown = null;
	if (view === "rear") offset.set(-1.2, 0.8, -2.7);
	if (view === "hub" || view === "hub-quarter") {
		target.set(0.21, 0, 0.035);
		offset.set(0.24, 0.3, 0.54);
	}
	if (view === "joint") {
		const node =
			[...current!.placements]
				.sort((a, b) => Math.hypot(b.dx, b.dy) - Math.hypot(a.dx, a.dy))
				.find(
					(p) =>
						p.module === NODE &&
						p.beside.some((m) => m === TUBE_X || m === TUBE_Y),
				) ?? current!.placements.find((p) => p.module === NODE);
		if (!node) throw Error(`Seed ${state.seed} has no NODE for joint evidence`);
		const dir = node.beside.findIndex((m) => m === TUBE_X || m === TUBE_Y);
		const axes = [
			[-1, 0],
			[1, 0],
			[0, -1],
			[0, 1],
		];
		const axis = axes[Math.max(0, dir)];
		target.set(
			node.dx * CELL_KM + (axis[0] * CELL_KM) / 2,
			node.dy * CELL_KM + (axis[1] * CELL_KM) / 2,
			0,
		);
		offset.set(
			Math.sign(node.dx || 1) * 0.16,
			Math.sign(node.dy || 1) * 0.14,
			0.4,
		);
		joint = { dx: node.dx, dy: node.dy, beside: node.beside, direction: dir };
	}
	camera.position.copy(target).add(offset);
	controls.target.copy(target);
	controls.update();
	framing = {
		target: target.toArray(),
		camera: camera.position.toArray(),
		joint,
	};
}
function set(next: Partial<typeof state>) {
	const rebuild =
		!current ||
		(next.seed !== undefined && next.seed !== state.seed) ||
		(next.authored !== undefined && next.authored !== state.authored);
	state = { ...state, ...next };
	if (rebuild) {
		if (current) {
			scene.remove(current.mesh.root);
			current.mesh.dispose();
		}
		current = buildSpike(state.seed, state.authored ? kit : undefined);
		current.mesh.root.scale.setScalar(STATION_GEOMETRY.trade.coreRadiusKm);
		scene.add(current.mesh.root);
	}
	state.phase = state.view === "hub-quarter" ? Math.PI / 2 : 0;
	current!.mesh.spinner.rotation.z = state.phase;
	frame(state.view);
	render();
	(document.querySelector("#seed") as HTMLSelectElement).value =
		`${state.seed}`;
	document.querySelector("#toggle")!.textContent = state.authored
		? "Authored"
		: "Procedural";
	return snapshot();
}
function render() {
	renderer.render(scene, camera);
}
function snapshot() {
	return {
		...state,
		framing,
		calls: renderer.info.render.calls,
		triangles: renderer.info.render.triangles,
		placements: current!.placements,
		instances: current!.instances,
	};
}
document
	.querySelector("#seed")!
	.addEventListener("change", (e) =>
		set({ seed: Number((e.target as HTMLSelectElement).value) }),
	);
document
	.querySelector("#toggle")!
	.addEventListener("click", () => set({ authored: !state.authored }));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]"))
	b.addEventListener("click", () => set({ view: b.dataset.view }));
addEventListener("resize", () => {
	renderer.setSize(innerWidth, innerHeight);
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	render();
});
controls.addEventListener("change", render);
set({});
(window as any).__assemblyKit = { renderer, set, snapshot, ready: true };
document.querySelector("#status")!.textContent =
	"200 m grid · drag to orbit · wheel to zoom · Phase 1 study, awaiting visual approval";
