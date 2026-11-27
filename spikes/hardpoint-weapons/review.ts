import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import {
	fittingFamilies,
	buildFitting,
	type FittingFamily,
} from "../../src/hardpoint-model";
import { fittingStudio } from "../../src/hardpoint-preview";
import { hardpointSeats, placeFitting } from "../../src/hardpoint-exterior";
import { buildShipMesh } from "../../src/ship-mesh";
import { HULL_SPECS } from "../../src/hull";
import { CHASE_BACK_KM, CHASE_UP_KM } from "../../src/chase-orbit";

const roles: Record<FittingFamily, string> = {
	"pulse-laser": "A compact pulse optic for the starter hardpoint.",
	"beam-laser":
		"The long slit distinguishes the continuous beam from the pulse optic.",
	"military-laser": "A triangular aperture under a swept armour plate.",
	"mining-laser": "Separated ochre jaws frame the work light.",
	"missile-rack":
		"Four armoured cell covers distinguish the launcher from an optical fitting.",
	autocannon:
		"Concept · Size 2. Amber drum pulses reward sustained tracking. Competes with the beam laser; repeated discrete flashes distinguish it.",
	railgun:
		"Concept · Size 2. Light races down the open fork for one precisely timed shot. Trades the military laser’s repeat fire for a long recovery.",
	scattergun:
		"Concept · Size 1. The scalloped mouth flashes across its width. A close pass trades reach for a forgiving firing window.",
	"plasma-projector":
		"Concept · Size 2. An amber orb swells and leaves the cradle. Leading its slow bolt makes a different commitment from missile lock.",
};
const studio = fittingStudio();
const hull = buildShipMesh("interceptor", HULL_SPECS.interceptor.variant).root;
const seat = hardpointSeats(hull, "interceptor")[0];
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x171c23);
scene.add(hull, new THREE.HemisphereLight(0xfff7de, 0xa2afb9, 2));
const key = new THREE.DirectionalLight(0xffe9ca, 3);
key.position.set(-2, 4, -3);
scene.add(key);
const camera = new THREE.PerspectiveCamera(60, 1.9, 0.0001, 2);
camera.position.set(-CHASE_BACK_KM * 0.8, CHASE_UP_KM, -CHASE_BACK_KM * 0.6);
camera.lookAt(0, 0, 0);
const grid = document.querySelector(".grid")!;
for (const [index, family] of fittingFamilies.entries()) {
	const tile = document.createElement("article");
	grid.append(tile);
	const title = document.createElement("h2");
	title.textContent = family.replaceAll("-", " ").toUpperCase();
	tile.append(title);
	const sub = document.createElement("small");
	sub.textContent = index < 5 ? "CATALOG" : "CONCEPT";
	tile.append(sub);
	const preview = document.createElement("img");
	preview.alt = family + " Equipment model";
	tile.append(preview);
	let step = 0;
	function draw() {
		studio.show(family, 0.87 + (step * Math.PI) / 4, 608, 320);
		preview.src = studio.renderer.domElement.toDataURL();
	}
	draw();
	const model = placeFitting(family, family === "scattergun" ? 1 : 2, seat);
	hull.add(model);
	studio.renderer.setSize(1920, 1080, false);
	camera.aspect = 1920 / 1080;
	camera.updateProjectionMatrix();
	studio.renderer.render(scene, camera);
	const exterior = document.createElement("img");
	exterior.src = studio.renderer.domElement.toDataURL();
	exterior.alt = "Interceptor outside view at normal orbit distance";
	tile.append(exterior);
	const crop = document.createElement("canvas");
	crop.width = 320;
	crop.height = 180;
	const projected = new THREE.Vector3().copy(seat).project(camera);
	crop
		.getContext("2d")
		?.drawImage(
			studio.renderer.domElement,
			(1 + projected.x) * 960 - 160,
			(1 - projected.y) * 540 - 90,
			320,
			180,
			0,
			0,
			320,
			180,
		);
	const detail = document.createElement("img");
	detail.src = crop.toDataURL();
	detail.alt = "Hardpoint crop from the same 1920 × 1080 outside view";
	const details = document.createElement("details");
	const summary = document.createElement("summary");
	summary.textContent = "Inspect fitted hardpoint";
	details.append(summary, detail);
	tile.append(details);
	exterior.onclick = () => {
		const tab = window.open();
		if (tab) {
			tab.document.title = family + " fitted";
			const image = tab.document.createElement("img");
			image.src = exterior.src;
			image.style.maxWidth = "100%";
			tab.document.body.append(image);
		}
	};
	hull.remove(model);
	const role = document.createElement("p");
	role.textContent = roles[family];
	tile.append(role);
	const rotate = document.createElement("button");
	rotate.textContent = "Rotate fitting";
	rotate.onclick = () => {
		step++;
		draw();
	};
	tile.append(rotate);
	const save = document.createElement("button");
	save.textContent = "Export GLB";
	save.onclick = async () => {
		const data = await new GLTFExporter().parseAsync(buildFitting(family), {
			binary: true,
		});
		if (!(data instanceof ArrayBuffer)) throw Error("Binary GLB required");
		const a = document.createElement("a");
		a.href = URL.createObjectURL(new Blob([data]));
		a.download = family + ".glb";
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	};
	tile.append(save);
}
document.documentElement.dataset.ready = "true";
