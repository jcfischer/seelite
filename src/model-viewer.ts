/**
 * A query-gated procedural-model workbench. It deliberately does not construct
 * `Game`: this is a fast visual review surface for render assets, not a second
 * simulation route. New model families can register beside the ship chooser.
 */
import * as THREE from "three";

import {
	HULL_IDS,
	HULL_VARIANTS,
	HULL_VISUALS,
	type HullId,
	type HullVariantId,
	buildShipMesh,
} from "./ship-mesh";

export const MODEL_VIEWER_VERSION = 1;

type ViewerState = {
	asset: HullId;
	variant: HullVariantId;
	selectedVariants: Record<HullId, HullVariantId>;
	rankings: Record<HullId, HullVariantId[]>;
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
.mv-wrap { min-height: 100%; max-width: 1240px; margin: auto; padding: 18px; display: grid; grid-template-columns: minmax(0, 1fr) 310px; gap: 14px; }
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
.mv-role-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.mv-role-tabs .mv-button { padding: 7px 4px; text-align: center; text-transform: uppercase; font-size: 10px; }
.mv-variants[hidden] { display: none; }
.mv-variants { display: grid; gap: 6px; }
.mv-variant { display: grid; grid-template-columns: minmax(0, 1fr) 44px; gap: 5px; }
.mv-concept { display: grid; gap: 2px; }
.mv-concept strong { color: inherit; font-size: 12px; }
.mv-concept small { color: #7899a7; line-height: 1.25; }
.mv-concept[aria-pressed="true"] small { color: #d4b77f; }
.mv-rank { display: grid; place-items: center; border: 1px solid rgba(124, 183, 211, .28); background: #071116; color: #7fa2b1; font: inherit; cursor: pointer; }
.mv-rank[data-rank-position] { border-color: #73aee0; color: #d5ecff; background: #102638; }
.mv-ranking { min-height: 5.5em; margin: 0; padding: 8px; white-space: pre-wrap; color: #9fc0ce; background: rgba(2, 8, 11, .7); border: 1px solid rgba(124, 183, 211, .18); }
.mv-reset { border: 0; padding: 0; background: transparent; color: #f0bc67; font: inherit; cursor: pointer; text-align: left; }
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

function variantMarkup(role: HullId) {
	return `<div class="mv-variants" data-model-variants="${role}"${role === "courier" ? "" : " hidden"}>${HULL_VARIANTS[
		role
	]
		.map(
			(variant) =>
				`<div class="mv-variant"><button class="mv-button mv-concept" type="button" data-model-role="${role}" data-model-variant="${variant.id}" aria-pressed="${role === "courier" && variant.id === "a"}"><strong>${variant.id.toUpperCase()} · ${variant.name}</strong><small>${variant.thesis}</small></button><button class="mv-rank" type="button" data-model-role="${role}" data-model-rank="${variant.id}" aria-label="rank ${variant.name}">rank</button></div>`,
		)
		.join("")}</div>`;
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
	root.innerHTML = `<div class="mv-wrap"><main class="mv-stage" data-model-stage aria-label="procedural model preview"><span class="mv-axis">DRAG TO ORBIT · WHEEL TO ZOOM</span></main><aside class="mv-panel"><h1 class="mv-title">SHIP DESIGN TOURNAMENT</h1><p class="mv-copy">Inspect three different construction ideas per role. Use <b>rank</b> in preference order; click a numbered rank to remove it.</p><fieldset class="mv-set"><legend>Role</legend><div class="mv-role-tabs">${HULL_IDS.map((id) => `<button class="mv-button" type="button" data-model-asset="${id}" aria-pressed="${id === "courier"}">${id}</button>`).join("")}</div></fieldset><fieldset class="mv-set"><legend>Concepts</legend>${HULL_IDS.map(variantMarkup).join("")}</fieldset><fieldset class="mv-set"><legend>Your ranking</legend><pre class="mv-ranking" data-model-ranking></pre><button class="mv-reset" type="button" data-model-reset-ranking>clear current role</button></fieldset><fieldset class="mv-set"><legend>Draft controls</legend><label class="mv-control">Beam <output data-model-output="beam">100%</output><input data-model-control="beam" type="range" min="70" max="145" value="100" /></label><label class="mv-control">Length <output data-model-output="length">100%</output><input data-model-control="length" type="range" min="70" max="145" value="100" /></label><label class="mv-control">Engine cue <output data-model-output="engine">70%</output><input data-model-control="engine" type="range" min="0" max="140" value="70" /></label><label class="mv-check"><input data-model-control="wireframe" type="checkbox" /> wireframe</label></fieldset><button class="mv-close" type="button" data-model-close>return to flight</button></aside></div>`;
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
		variant: "a",
		selectedVariants: { courier: "a", interceptor: "a", freighter: "a" },
		rankings: { courier: [], interceptor: [], freighter: [] },
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
		mesh = buildShipMesh(state.asset, state.variant).root;
		holder.add(mesh);
		applyDraft();
	};
	const updateTournament = () => {
		root
			.querySelectorAll<HTMLElement>("[data-model-variants]")
			.forEach((panel) => {
				panel.hidden = panel.dataset.modelVariants !== state.asset;
			});
		root
			.querySelectorAll<HTMLElement>("[data-model-variant]")
			.forEach((button) => {
				button.setAttribute(
					"aria-pressed",
					String(
						button.dataset.modelRole === state.asset &&
							button.dataset.modelVariant === state.variant,
					),
				);
			});
		root
			.querySelectorAll<HTMLElement>("[data-model-rank]")
			.forEach((button) => {
				const role = button.dataset.modelRole as HullId;
				const variant = button.dataset.modelRank as HullVariantId;
				const position = state.rankings[role].indexOf(variant);
				button.textContent = position < 0 ? "rank" : `#${position + 1}`;
				if (position < 0) button.removeAttribute("data-rank-position");
				else button.dataset.rankPosition = String(position + 1);
			});
		const summary = root.querySelector<HTMLElement>("[data-model-ranking]");
		if (summary)
			summary.textContent = HULL_IDS.map((role) => {
				const order = state.rankings[role]
					.map((variant) => variant.toUpperCase())
					.join(" > ");
				return `${role}: ${order || "—"}`;
			}).join("\n");
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
			state.variant = state.selectedVariants[asset];
			root
				.querySelectorAll<HTMLElement>("[data-model-asset]")
				.forEach((button) => {
					button.setAttribute(
						"aria-pressed",
						String(button.dataset.modelAsset === asset),
					);
				});
			updateTournament();
			rebuild();
		}
		const variantButton = target.closest<HTMLElement>("[data-model-variant]");
		const variant = variantButton?.dataset.modelVariant as
			| HullVariantId
			| undefined;
		const variantRole = variantButton?.dataset.modelRole as HullId | undefined;
		if (variant && variantRole === state.asset) {
			state.variant = variant;
			state.selectedVariants[state.asset] = variant;
			updateTournament();
			rebuild();
		}
		const rankButton = target.closest<HTMLElement>("[data-model-rank]");
		const rankedVariant = rankButton?.dataset.modelRank as
			| HullVariantId
			| undefined;
		const rankedRole = rankButton?.dataset.modelRole as HullId | undefined;
		if (rankedVariant && rankedRole === state.asset) {
			const ranking = state.rankings[rankedRole];
			const position = ranking.indexOf(rankedVariant);
			if (position < 0) ranking.push(rankedVariant);
			else ranking.splice(position, 1);
			updateTournament();
		}
		if (target.closest("[data-model-reset-ranking]")) {
			state.rankings[state.asset] = [];
			updateTournament();
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
	updateTournament();
	rebuild();
	resize();
	frame();
}
