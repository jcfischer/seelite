/**
 * A query-gated procedural-model workbench. It deliberately does not construct
 * `Game`: this is a fast visual review surface for render assets, not a second
 * simulation route. New model families can register beside the ship chooser.
 */
import * as THREE from "three";

import {
	HULL_IDS,
	HULL_VISUALS,
	type HullId,
	buildShipMesh,
} from "./ship-mesh";

export const MODEL_VIEWER_VERSION = 1;

type ViewerState = {
	asset: HullId;
	beam: number;
	length: number;
	engine: number;
	wireframe: boolean;
	azimuth: number;
	elevation: number;
	distance: number;
};

const STYLE_ID = "seelite-model-viewer-style";

const STYLE = `
#model-viewer { position: fixed; inset: 0; z-index: 20; overflow: auto; color: #d7e9f2; background: radial-gradient(circle at 50% 38%, #132735, #030609 62%); font: 12px/1.35 ui-monospace, "SF Mono", Menlo, monospace; }
#model-viewer * { box-sizing: border-box; }
.mv-wrap { min-height: 100%; max-width: 1180px; margin: auto; padding: 18px; display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 14px; }
.mv-stage { position: relative; min-height: 620px; overflow: hidden; border: 1px solid rgba(124, 183, 211, .35); background: radial-gradient(circle at 50% 48%, rgba(23, 58, 76, .55), rgba(2, 5, 8, .85) 66%); }
.mv-stage canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.mv-axis { position: absolute; left: 14px; bottom: 12px; color: #7aa8ba; letter-spacing: .08em; pointer-events: none; }
.mv-panel { display: grid; align-content: start; gap: 12px; padding: 4px 0; }
.mv-title { margin: 0; color: #e6f7ff; font-size: 15px; letter-spacing: .08em; }
.mv-copy { margin: 0; color: #8fb2c1; }
.mv-set { display: grid; gap: 6px; padding: 10px; border: 1px solid rgba(124, 183, 211, .24); background: rgba(5, 13, 18, .6); }
.mv-set legend { color: #86bdd4; padding: 0 5px; }
.mv-assets { display: grid; gap: 5px; }
.mv-button { border: 1px solid rgba(124, 183, 211, .34); background: #0a1820; color: #b9dce9; padding: 8px; font: inherit; text-align: left; cursor: pointer; }
.mv-button[aria-pressed="true"] { border-color: #f0bc67; background: #34230e; color: #ffe0a2; }
.mv-control { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; color: #b9dce9; }
.mv-control input[type="range"] { grid-column: 1 / -1; width: 100%; accent-color: #e9ac58; }
.mv-check { display: flex; gap: 7px; align-items: center; color: #b9dce9; }
.mv-close { justify-self: start; border: 0; padding: 0; background: transparent; color: #f0bc67; font: inherit; cursor: pointer; }
@media (max-width: 720px) { .mv-wrap { grid-template-columns: 1fr; padding: 10px; } .mv-stage { min-height: 440px; } .mv-panel { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; } .mv-title, .mv-copy, .mv-close { grid-column: 1 / -1; } }
`;

function installStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = STYLE;
	document.head.append(style);
}

function displayName(id: HullId) {
	return `${id === "courier" ? "Courier Mk I" : id[0].toUpperCase() + id.slice(1)} · ${HULL_VISUALS[id].role}`;
}

/** Mount only when a designer explicitly requests `?model-viewer=ship`. */
export function mountModelViewer(): void {
	if (
		new URLSearchParams(window.location.search).get("model-viewer") !== "ship"
	)
		return;
	installStyle();
	const root = document.createElement("section");
	root.id = "model-viewer";
	root.innerHTML = `<div class="mv-wrap"><main class="mv-stage" data-model-stage aria-label="procedural model preview"><span class="mv-axis">DRAG TO ORBIT · WHEEL TO ZOOM</span></main><aside class="mv-panel"><h1 class="mv-title">MODEL WORKBENCH</h1><p class="mv-copy">Render-only studies combining an iconic role silhouette, coherent hull mass, functional landmarks, and restrained material breakup. References inform the grammar; no ship is a replica.</p><fieldset class="mv-set"><legend>Asset</legend><div class="mv-assets">${HULL_IDS.map((id) => `<button class="mv-button" type="button" data-model-asset="${id}" aria-pressed="${id === "courier"}">${displayName(id)}</button>`).join("")}</div></fieldset><fieldset class="mv-set"><legend>Draft controls</legend><label class="mv-control">Beam <output data-model-output="beam">100%</output><input data-model-control="beam" type="range" min="70" max="145" value="100" /></label><label class="mv-control">Length <output data-model-output="length">100%</output><input data-model-control="length" type="range" min="70" max="145" value="100" /></label><label class="mv-control">Engine cue <output data-model-output="engine">70%</output><input data-model-control="engine" type="range" min="0" max="140" value="70" /></label><label class="mv-check"><input data-model-control="wireframe" type="checkbox" /> wireframe</label></fieldset><button class="mv-close" type="button" data-model-close>return to flight</button></aside></div>`;
	document.body.append(root);
	document.querySelector("#keys")?.remove();

	const stage = root.querySelector<HTMLElement>(
		"[data-model-stage]",
	) as HTMLElement;
	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.35;
	stage.append(renderer.domElement);
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(42, 1, 0.001, 10);
	const key = new THREE.DirectionalLight(0xd5ecff, 3.2);
	key.position.set(0.13, 0.16, 0.12);
	const rim = new THREE.DirectionalLight(0x75b7d8, 2.1);
	rim.position.set(-0.1, 0.05, -0.12);
	scene.add(key, rim, new THREE.HemisphereLight(0x5c89a2, 0x050709, 2.8));
	const grid = new THREE.GridHelper(0.18, 12, 0x356274, 0x152d38);
	grid.position.y = -0.021;
	scene.add(grid);
	const holder = new THREE.Group();
	scene.add(holder);
	const state: ViewerState = {
		asset: "courier",
		beam: 1,
		length: 1,
		engine: 0.7,
		wireframe: false,
		azimuth: 2.55,
		elevation: 0.38,
		distance: 0.12,
	};
	let mesh: THREE.Group;
	let dragging = false;
	let previous = { x: 0, y: 0 };

	const rebuild = () => {
		if (mesh) {
			holder.remove(mesh);
			mesh.traverse((object) => {
				if (!(object instanceof THREE.Mesh)) return;
				object.geometry.dispose();
				const materials = Array.isArray(object.material)
					? object.material
					: [object.material];
				for (const material of materials) material.dispose();
			});
		}
		mesh = buildShipMesh(state.asset).root;
		holder.add(mesh);
		applyDraft();
	};
	const applyDraft = () => {
		mesh.scale.set(state.beam, 1, state.length);
		mesh.traverse((object) => {
			if (!(object instanceof THREE.Mesh)) return;
			const isEngine = object.name.includes("exhaust");
			const materials = Array.isArray(object.material)
				? object.material
				: [object.material];
			for (const material of materials) {
				if (material instanceof THREE.MeshStandardMaterial) {
					material.wireframe = state.wireframe;
					if (isEngine) material.emissiveIntensity = state.engine;
				}
			}
		});
		for (const name of ["beam", "length", "engine"] as const) {
			const output = root.querySelector<HTMLOutputElement>(
				`[data-model-output="${name}"]`,
			);
			if (output) output.value = `${Math.round(state[name] * 100)}%`;
		}
	};
	const resize = () => {
		const { width, height } = stage.getBoundingClientRect();
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height, false);
	};
	const frame = () => {
		const cosElevation = Math.cos(state.elevation);
		camera.position.set(
			Math.sin(state.azimuth) * cosElevation * state.distance,
			Math.sin(state.elevation) * state.distance,
			Math.cos(state.azimuth) * cosElevation * state.distance,
		);
		camera.lookAt(0, 0, 0);
		renderer.render(scene, camera);
		requestAnimationFrame(frame);
	};

	root.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const asset = target.closest<HTMLElement>("[data-model-asset]")?.dataset
			.modelAsset as HullId | undefined;
		if (asset && HULL_IDS.includes(asset)) {
			state.asset = asset;
			root
				.querySelectorAll<HTMLElement>("[data-model-asset]")
				.forEach((button) => {
					button.setAttribute(
						"aria-pressed",
						String(button.dataset.modelAsset === asset),
					);
				});
			rebuild();
		}
		if (target.closest("[data-model-close]")) {
			const flightUrl = new URL(window.location.href);
			flightUrl.searchParams.delete("model-viewer");
			window.location.assign(flightUrl);
		}
	});
	root
		.querySelectorAll<HTMLInputElement>("[data-model-control]")
		.forEach((input) => {
			input.addEventListener("input", () => {
				if (input.dataset.modelControl === "wireframe")
					state.wireframe = input.checked;
				else
					state[input.dataset.modelControl as "beam" | "length" | "engine"] =
						Number(input.value) / 100;
				applyDraft();
			});
		});
	renderer.domElement.addEventListener("pointerdown", (event) => {
		dragging = true;
		previous = { x: event.clientX, y: event.clientY };
		renderer.domElement.setPointerCapture(event.pointerId);
	});
	renderer.domElement.addEventListener("pointermove", (event) => {
		if (!dragging) return;
		state.azimuth -= (event.clientX - previous.x) * 0.012;
		state.elevation = THREE.MathUtils.clamp(
			state.elevation + (event.clientY - previous.y) * 0.01,
			-1.1,
			1.1,
		);
		previous = { x: event.clientX, y: event.clientY };
	});
	renderer.domElement.addEventListener("pointerup", () => (dragging = false));
	renderer.domElement.addEventListener("wheel", (event) => {
		event.preventDefault();
		state.distance = THREE.MathUtils.clamp(
			state.distance + event.deltaY * 0.00008,
			0.055,
			0.22,
		);
	});
	window.addEventListener("resize", resize);
	(
		window as unknown as { __seeliteModelViewer: { state: ViewerState } }
	).__seeliteModelViewer = { state };
	rebuild();
	resize();
	frame();
}
