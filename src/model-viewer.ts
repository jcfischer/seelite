/**
 * A query-gated procedural-model workbench. It deliberately does not construct
 * `Game`: this is a fast visual review surface for render assets, not a second
 * simulation route.
 *
 * **Two families now, one workbench.** `?model-viewer=ship` reviews #35's hull
 * roles and `?model-viewer=station` reviews #56's station forms. The second was
 * nearly a copy of this file — the orbit, the ranking, the draft sliders and the
 * stage are the same apparatus, and only what is being built differs — and two
 * workbenches would have drifted the first time either was improved. So the
 * ship-specific parts are gathered into a `ModelFamily` and everything else is
 * written against that.
 */
import * as THREE from "three";

import { HULL_IDS, HULL_SPECS, type HullId } from "./hull";
import { LIGHT_RIG, equirectEnvironment } from "./light-rig";
import {
	HULL_REACH_KM,
	HULL_VARIANTS,
	SHIP_DESIGN_ROUND,
	buildShipMesh,
} from "./ship-mesh";
import {
	HULL_FINISHES,
	HULL_FINISH_IDS,
	type HullFinishId,
	hullFinishId,
	setHullFinish,
} from "./ship-surface";
import {
	STATION_DESIGN_ROUND,
	STATION_FORMS,
	STATION_FORM_IDS,
	type StationFormId,
	buildStationForm,
} from "./station-mesh";
import { STATION_TYPES, type StationType } from "./station";
import {
	STATION_FINISHES,
	STATION_FINISH_IDS,
	type StationFinishId,
	setStationFinish,
	stationFinishId,
} from "./station-visuals";

/** One concept a reviewer can select and rank. */
interface FamilyVariant {
	readonly id: string;
	readonly name: string;
	readonly thesis: string;
}

/**
 * Everything the workbench needs that is specific to what it is reviewing.
 *
 * `reachKm` is what frames the stage: a capital hull is several times the
 * largest courier and a shipyard is twice a trade station, so a fixed orbit
 * radius puts the camera inside the subject. `emissive` names the parts the
 * "engine cue" slider drives — exhausts on a ship, strobes and flares on a
 * station.
 *
 * `finishes` is the second axis of the tournament (#202, #203): a **finish**
 * is everything about a subject that is not its silhouette — plating, paint,
 * fixtures — and it is ranked the way a silhouette is, by looking at every
 * candidate under every finish. `setFinish` selects the one every subject
 * built from now on carries; the workbench rebuilds on each switch rather
 * than patching a built mesh, so a subject is always whole under one finish.
 */
interface ModelFamily {
	readonly id: string;
	readonly title: string;
	readonly copy: string;
	readonly assets: readonly string[];
	readonly variantIds: readonly string[];
	readonly variants: (asset: string) => readonly FamilyVariant[];
	readonly reachKm: (asset: string, variant: string) => number;
	/** `assembly` is the plan seed a wave-function-collapse form solves from
	 *  (#257); a hand-authored form ignores it. The berth seed stays zero on
	 *  the workbench, for the reason `STATION_FAMILY.build` gives. */
	readonly build: (
		asset: string,
		variant: string,
		assembly: number,
	) => THREE.Group;
	readonly emissive: (name: string) => boolean;
	readonly finishes: readonly FamilyVariant[];
	readonly finishId: () => string;
	readonly setFinish: (id: string) => void;
}

const SHIP_FAMILY: ModelFamily = {
	id: "ship",
	title: `SHIP TOURNAMENT · ROUND ${SHIP_DESIGN_ROUND}`,
	copy: "Ranking-guided descendants of round one. Use <b>rank</b> in preference order; click a numbered rank to remove it. <b>Finish</b> switches the surface and the shared primitives under every hull.",
	assets: HULL_IDS,
	variantIds: ["a", "b", "c"],
	variants: (asset) => HULL_VARIANTS[asset as HullId],
	reachKm: (asset) => HULL_REACH_KM[asset as HullId],
	build: (asset, variant) =>
		buildShipMesh(
			asset as HullId,
			variant as (typeof HULL_VARIANTS)[HullId][number]["id"],
		).root,
	emissive: (name) => name.includes("exhaust"),
	finishes: HULL_FINISH_IDS.map((id) => ({
		id,
		name: HULL_FINISHES[id].name,
		thesis: HULL_FINISHES[id].thesis,
	})),
	finishId: hullFinishId,
	setFinish: (id) => setHullFinish(id as HullFinishId),
};

const STATION_FAMILY: ModelFamily = {
	id: "station",
	title: `STATION FORMS · ROUND ${STATION_DESIGN_ROUND}`,
	copy: "#28's three outlines rebuilt in the ship hulls' swept-loft language. Each role keeps its ranked top two and spends its last slot; the refinery spent all three. Use <b>rank</b> in preference order; click a numbered rank to remove it.",
	assets: STATION_TYPES,
	variantIds: STATION_FORM_IDS,
	variants: (asset) => STATION_FORMS[asset as StationType],
	reachKm: (asset, variant) =>
		STATION_FORMS[asset as StationType].find((form) => form.id === variant)
			?.reachKm ?? 1,
	// A neutral grey, not `STATION_COLORS`: this round is about *form*, and a
	// per-role paint would let colour carry a ranking that is supposed to be
	// about shape (`station-types.md` §7's own standard, applied to the review).
	// The **kilometre** group, not the root. `buildStationForm` normalises its
	// root to one core radius across, which is what the renderer's single
	// `mesh.scale = radiusKm × layerFactor` rule needs and is exactly wrong
	// here: the stage frames the camera from a reach in kilometres, so handing
	// it a root already divided by 0.6 puts the camera 1.9 radii out and inside
	// the station. Reparenting the inner group is safe — the root is discarded.
	build: (asset, variant, assembly) =>
		buildStationForm(
			asset as StationType,
			variant as StationFormId,
			0x9aa6b2,
			// **Seed zero, deliberately.** The workbench ranks *forms*, and the
			// berth draw decides only which wall an outpost's second berth is on
			// (`docking.md` §13.2). A varying seed would make two captures of one
			// form differ for a reason that has nothing to do with the form.
			0,
			// **The assembly seed is the one thing that may vary**, and only by
			// `?assembly=<n>`: for a form solved by wave function collapse the plan
			// *is* the variety the form is ranked on, and a sheet of one plan
			// cannot show it. Zero unless asked for, so every other capture is
			// what it was.
			assembly,
		).root.getObjectByName("km") as THREE.Group,
	// `beacon-` is #202's macro-structure lamp, driven in the game by the
	// same fixture list as the strobes; here it is lit by name like they are,
	// or the sheet shows every beacon dark under the one finish that has them.
	emissive: (name) =>
		name.startsWith("strobe") ||
		name.startsWith("beacon") ||
		name === "flare" ||
		name === "heat-glow" ||
		name === "weld-arc" ||
		name === "bay-flood" ||
		name === "windows",
	finishes: STATION_FINISH_IDS.map((id) => ({
		id,
		name: STATION_FINISHES[id].name,
		thesis: STATION_FINISHES[id].thesis,
	})),
	finishId: stationFinishId,
	setFinish: (id) => setStationFinish(id as StationFinishId),
};

const FAMILIES: ModelFamily[] = [SHIP_FAMILY, STATION_FAMILY];

type ViewerState = {
	asset: string;
	variant: string;
	/** The finish every subject is built under; `?finish=<id>` preselects it
	 *  so a capture script can load a finish rather than click for it. */
	finish: string;
	/** The assembly seed every solved form is built from; `?assembly=<n>`
	 *  presets it, and it is read back the way `finish` is. */
	assembly: number;
	selectedVariants: Record<string, string>;
	rankings: Record<string, string[]>;
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
.mv-set { display: grid; gap: 6px; min-width: 0; padding: 10px; border: 1px solid rgba(124, 183, 211, .24); background: rgba(5, 13, 18, .6); }
.mv-set legend { color: #86bdd4; padding: 0 5px; }
.mv-assets { display: grid; gap: 5px; }
.mv-button { border: 1px solid rgba(124, 183, 211, .34); background: #0a1820; color: #b9dce9; padding: 8px; font: inherit; text-align: left; cursor: pointer; }
.mv-button[aria-pressed="true"] { border-color: #f0bc67; background: #34230e; color: #ffe0a2; }
.mv-role-tabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(68px, 1fr)); gap: 4px; }
.mv-role-tabs .mv-button { padding: 7px 4px; text-align: center; text-transform: uppercase; font-size: 10px; }
.mv-variants[hidden] { display: none; }
.mv-variants { display: grid; gap: 6px; }
.mv-variant { display: grid; grid-template-columns: minmax(0, 1fr) 44px; gap: 5px; }
.mv-concept { display: grid; gap: 2px; }
.mv-concept strong { color: inherit; font-size: 12px; }
.mv-concept small { color: #7899a7; line-height: 1.25; }
.mv-concept[aria-pressed="true"] small { color: #d4b77f; }
.mv-finishes { display: grid; gap: 5px; }
.mv-rank { display: grid; place-items: center; border: 1px solid rgba(124, 183, 211, .28); background: #071116; color: #7fa2b1; font: inherit; cursor: pointer; }
.mv-rank[data-rank-position] { border-color: #73aee0; color: #d5ecff; background: #102638; }
.mv-ranking { min-height: 5.5em; margin: 0; padding: 8px; white-space: pre-wrap; color: #9fc0ce; background: rgba(2, 8, 11, .7); border: 1px solid rgba(124, 183, 211, .18); }
.mv-reset { border: 0; padding: 0; background: transparent; color: #f0bc67; font: inherit; cursor: pointer; text-align: left; }
.mv-control { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; color: #b9dce9; }
.mv-control input[type="range"] { grid-column: 1 / -1; width: 100%; accent-color: #e9ac58; }
.mv-check { display: flex; gap: 7px; align-items: center; color: #b9dce9; }
.mv-close { justify-self: start; border: 0; padding: 0; background: transparent; color: #f0bc67; font: inherit; cursor: pointer; }
@media (max-width: 720px) { .mv-wrap { grid-template-columns: 1fr; padding: 10px; } .mv-stage { min-height: 440px; } .mv-panel { grid-template-columns: 1fr; } .mv-title, .mv-copy, .mv-close { grid-column: 1 / -1; } }
`;

function installStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = STYLE;
	document.head.append(style);
}

function displayName(id: HullId) {
	return `${id === "courier" ? "Courier Mk I" : id[0].toUpperCase() + id.slice(1)} · ${HULL_SPECS[id].role}`;
}

function variantMarkup(family: ModelFamily, role: string) {
	return `<div class="mv-variants" data-model-variants="${role}"${role === "courier" ? "" : " hidden"}>${family
		.variants(role)
		.map(
			(variant) =>
				`<div class="mv-variant"><button class="mv-button mv-concept" type="button" data-model-role="${role}" data-model-variant="${variant.id}" aria-pressed="${role === family.assets[0] && variant.id === family.variantIds[0]}"><strong>${variant.id.toUpperCase()} · ${variant.name}</strong><small>${variant.thesis}</small></button><button class="mv-rank" type="button" data-model-role="${role}" data-model-rank="${variant.id}" aria-label="rank ${variant.name}">rank</button></div>`,
		)
		.join("")}</div>`;
}

/** Mount only when a designer explicitly requests a family by name —
 *  `?model-viewer=ship` or `?model-viewer=station`. An unknown name mounts
 *  nothing rather than defaulting to one, because a typo silently reviewing the
 *  wrong family is worse than a blank page. */
export function mountModelViewer(): void {
	const query = new URLSearchParams(window.location.search);
	const requested = query.get("model-viewer");
	const family = FAMILIES.find((candidate) => candidate.id === requested);
	if (!family) return;
	// A finish named in the URL is selected before the first build, and an
	// unknown one is ignored rather than defaulted: the capture script that
	// asks for `?finish=industrial` and gets stock has captured the wrong sheet
	// under the right label, so the state it reads back is what it must check.
	const requestedFinish = query.get("finish");
	if (
		requestedFinish &&
		family.finishes.some((finish) => finish.id === requestedFinish)
	)
		family.setFinish(requestedFinish);
	// An assembly seed named in the URL, an unsigned integer; anything else is
	// zero, and the capture script reads the state back rather than trusting
	// what it asked for.
	const requestedAssembly = Number.parseInt(query.get("assembly") ?? "0", 10);
	const assembly =
		Number.isInteger(requestedAssembly) && requestedAssembly >= 0
			? requestedAssembly
			: 0;
	installStyle();
	const root = document.createElement("section");
	root.id = "model-viewer";
	root.innerHTML = `<div class="mv-wrap"><main class="mv-stage" data-model-stage aria-label="procedural model preview"><span class="mv-axis">DRAG TO ORBIT · WHEEL TO ZOOM</span></main><aside class="mv-panel"><h1 class="mv-title">${family.title}</h1><p class="mv-copy">${family.copy}</p><fieldset class="mv-set"><legend>Role</legend><div class="mv-role-tabs">${family.assets.map((id, index) => `<button class="mv-button" type="button" data-model-asset="${id}" aria-pressed="${index === 0}">${id}</button>`).join("")}</div></fieldset><fieldset class="mv-set"><legend>Finish</legend><div class="mv-finishes">${family.finishes.map((finish) => `<button class="mv-button mv-concept" type="button" data-model-finish="${finish.id}" aria-pressed="${finish.id === family.finishId()}"><strong>${finish.name}</strong><small>${finish.thesis}</small></button>`).join("")}</div></fieldset><fieldset class="mv-set"><legend>Concepts</legend>${family.assets.map((id) => variantMarkup(family, id)).join("")}</fieldset><fieldset class="mv-set"><legend>Your ranking</legend><pre class="mv-ranking" data-model-ranking></pre><button class="mv-reset" type="button" data-model-reset-ranking>clear current role</button></fieldset><fieldset class="mv-set"><legend>Draft controls</legend><label class="mv-control">Beam <output data-model-output="beam">100%</output><input data-model-control="beam" type="range" min="70" max="145" value="100" /></label><label class="mv-control">Length <output data-model-output="length">100%</output><input data-model-control="length" type="range" min="70" max="145" value="100" /></label><label class="mv-control">Engine cue <output data-model-output="engine">70%</output><input data-model-control="engine" type="range" min="0" max="140" value="70" /></label><label class="mv-check"><input data-model-control="wireframe" type="checkbox" /> wireframe</label></fieldset><button class="mv-close" type="button" data-model-close>return to flight</button></aside></div>`;
	document.body.append(root);
	document.querySelector("#keys")?.remove();
	// Unconditionally here, unlike in the game: a workbench is an instrument
	// already, and the reason to open one is usually to judge what a form costs
	// as well as how it looks. `mountFpsMeter` is idempotent, so opening the
	// workbench with `?fps` as well gives one readout rather than two.
	//
	// Dynamic like `main.ts`'s `?fps` branch, and unawaited unlike it — boot
	// there is already inside an async entry and gains nothing by racing,
	// whereas this sits in a synchronous mount and the meter can attach a frame
	// late without measuring anything differently. The disposer is
	// dropped because `[data-model-close]` navigates, so the browser takes the
	// whole document; `probe-boot` asserts that rather than leaving it to be
	// reasoned about.
	void import("./fps-meter").then((m) => m.mountFpsMeter());

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
	const inspectionFill = new THREE.DirectionalLight(0x7899ad, 2.2);
	inspectionFill.position.set(0.04, -0.12, 0.03);
	scene.add(
		key,
		rim,
		inspectionFill,
		new THREE.HemisphereLight(0x5c89a2, 0x263845, 2.8),
	);
	// **The game's environment, on the workbench** (#203). #98 measured the
	// rig here as better than flight's and the difference was partly this: the
	// workbench had no `scene.environment`, so every plated material — a
	// standard material at metalness 0.3 to 0.6 — had nothing to reflect, and
	// a collar or an embossed seam judged here was judged as plastic. The same
	// bake `main.ts` makes per system, from the rig's own sun tint, at the
	// rig's own intensity; the inspection lights above stay, because this is
	// still an inspection stage and not a flight frame.
	{
		const { data, width, height } = equirectEnvironment(LIGHT_RIG.sun.color);
		const source = new THREE.DataTexture(
			data,
			width,
			height,
			THREE.RGBAFormat,
			THREE.FloatType,
		);
		source.mapping = THREE.EquirectangularReflectionMapping;
		source.colorSpace = THREE.LinearSRGBColorSpace;
		source.needsUpdate = true;
		const pmrem = new THREE.PMREMGenerator(renderer);
		scene.environment = pmrem.fromEquirectangular(source).texture;
		scene.environmentIntensity = LIGHT_RIG.environmentIntensity;
		pmrem.dispose();
		source.dispose();
	}
	// The stage is framed from the hull's own reach. A fixed camera distance and
	// a fixed grid worked while every hull was within a factor of two of the
	// next; a capital hull is several times the largest of them, and a constant
	// 0.12 km orbit would put the camera inside it.
	const framing = (id: string, variant: string) =>
		family.reachKm(id, variant) * 3.2;
	let grid = new THREE.GridHelper(0.18, 12, 0x356274, 0x152d38);
	scene.add(grid);
	const reframe = (id: string, variant: string) => {
		const reach = family.reachKm(id, variant);
		scene.remove(grid);
		grid.dispose();
		grid = new THREE.GridHelper(reach * 6, 12, 0x356274, 0x152d38);
		grid.position.y = -reach * 0.7;
		scene.add(grid);
		camera.far = reach * 40;
		camera.near = reach * 0.004;
		camera.updateProjectionMatrix();
	};
	const holder = new THREE.Group();
	scene.add(holder);
	const state: ViewerState = {
		asset: family.assets[0],
		variant: family.variantIds[0],
		finish: family.finishId(),
		assembly,
		// Derived from HULL_IDS so adding a role cannot leave a hole here that
		// only shows up as an undefined ranking at click time.
		selectedVariants: Object.fromEntries(
			family.assets.map((id) => [id, family.variantIds[0]]),
		),
		rankings: Object.fromEntries(
			family.assets.map((id) => [id, [] as string[]]),
		),
		beam: 1,
		length: 1,
		engine: 0.7,
		wireframe: false,
		azimuth: 2.55,
		elevation: 0.38,
		distance: framing(family.assets[0], family.variantIds[0]),
	};
	/** The reach the stage is currently framed for, so a reframe that would
	 *  change nothing can be skipped. */
	let currentReach = family.reachKm(state.asset, state.variant);
	let mesh: THREE.Group | undefined;
	let dragging = false;
	let previous = { x: 0, y: 0 };

	const rebuild = () => {
		if (mesh) {
			holder.remove(mesh);
			// Geometry only. Palettes are shared per role now, so a hull that
			// disposed its materials would take out every other hull of that role
			// — including the next one this workbench builds.
			mesh.traverse((object) => {
				if (object instanceof THREE.Mesh) object.geometry.dispose();
				// An instanced mesh's matrices are a buffer the geometry does not
				// own, released only by its own `dispose`; without it every
				// finish switch left an industrial station's fixture matrices
				// on the GPU.
				if (object instanceof THREE.InstancedMesh) object.dispose();
			});
			// Dropped after disposal so the old tree is unreachable rather than
			// held alive by this closure until the next rebuild replaces it.
			mesh = undefined;
		}
		mesh = family.build(state.asset, state.variant, state.assembly);
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
				const role = button.dataset.modelRole as string;
				const variant = button.dataset.modelRank as string;
				const position = state.rankings[role].indexOf(variant);
				button.textContent = position < 0 ? "rank" : `#${position + 1}`;
				if (position < 0) button.removeAttribute("data-rank-position");
				else button.dataset.rankPosition = String(position + 1);
			});
		const summary = root.querySelector<HTMLElement>("[data-model-ranking]");
		if (summary)
			summary.textContent = family.assets
				.map((role) => {
					const order = state.rankings[role]
						.map((variant) => variant.toUpperCase())
						.join(" > ");
					return `${role}: ${order || "—"}`;
				})
				.join("\n");
	};
	const applyDraft = () => {
		if (!mesh) return;
		mesh.scale.set(state.beam, 1, state.length);
		mesh.traverse((object) => {
			const isEngine = family.emissive(object.name);
			// **A lamp's glare takes the cue with its lamp** (#300's review). A
			// glow is named like its fitting, so the name rule reaches it, but it
			// is `Points` or a shader-material pool and the loop below skipped
			// both — every beacon's glare stayed dark in the sheet. A blinking
			// glow and a pool own their material; a steady glow's is shared and
			// never mutated (`station-glow.ts`), so it keeps its own drive.
			if (object.userData.glow) {
				const material = (object as THREE.Mesh | THREE.Points)
					.material as THREE.ShaderMaterial;
				const owned =
					object.userData.pool || (material.uniforms?.uHalo?.value ?? 0) > 0;
				if (isEngine && owned && material.uniforms?.uIntensity)
					material.uniforms.uIntensity.value = state.engine;
				return;
			}
			if (!(object instanceof THREE.Mesh)) return;
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
		const asset =
			target.closest<HTMLElement>("[data-model-asset]")?.dataset.modelAsset;
		if (asset && family.assets.includes(asset)) {
			state.asset = asset;
			state.variant = state.selectedVariants[asset];
			// A capital hull and a courier cannot share an orbit radius, so the
			// stage reframes rather than leaving the camera inside the new ship.
			currentReach = family.reachKm(asset, state.variant);
			state.distance = framing(asset, state.variant);
			reframe(asset, state.variant);
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
		const variant = variantButton?.dataset.modelVariant;
		const variantRole = variantButton?.dataset.modelRole;
		if (variant && variantRole === state.asset) {
			state.variant = variant;
			state.selectedVariants[state.asset] = variant;
			// A station form's reach is per *form*, not per role — a ring is half
			// again a drum — so selecting one reframes the stage the way selecting
			// a role does. Guarded on the reach actually changing: on the ship
			// family every variant of a role shares one, and `reframe` disposes a
			// `GridHelper` and builds another, which is a real allocation to spend
			// on a no-op.
			const reach = family.reachKm(state.asset, variant);
			if (reach !== currentReach) {
				currentReach = reach;
				state.distance = framing(state.asset, variant);
				reframe(state.asset, variant);
			}
			updateTournament();
			rebuild();
		}
		const finishButton = target.closest<HTMLElement>("[data-model-finish]");
		const finish = finishButton?.dataset.modelFinish;
		if (
			finish &&
			family.finishes.some((candidate) => candidate.id === finish)
		) {
			family.setFinish(finish);
			state.finish = family.finishId();
			root
				.querySelectorAll<HTMLElement>("[data-model-finish]")
				.forEach((button) => {
					button.setAttribute(
						"aria-pressed",
						String(button.dataset.modelFinish === state.finish),
					);
				});
			rebuild();
		}
		const rankButton = target.closest<HTMLElement>("[data-model-rank]");
		const rankedVariant = rankButton?.dataset.modelRank;
		const rankedRole = rankButton?.dataset.modelRole;
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
		const reach = family.reachKm(state.asset, state.variant);
		state.distance = THREE.MathUtils.clamp(
			state.distance * (1 + event.deltaY * 0.0009),
			reach * 1.5,
			reach * 9,
		);
	});
	window.addEventListener("resize", resize);
	// The renderer beside the state, so `scripts/shot-finishes.mjs` can read
	// the real rasteriser back the way `capture-views.mjs` does through
	// `window.__seelite` — which the workbench deliberately never sets.
	// And the holder, so `probe-model-viewer.mjs` can read a fixture's
	// material back rather than trust the selector above by name.
	(
		window as unknown as {
			__seeliteModelViewer: {
				state: ViewerState;
				renderer: THREE.WebGLRenderer;
				holder: THREE.Group;
			};
		}
	).__seeliteModelViewer = { state, renderer, holder };
	updateTournament();
	reframe(state.asset, state.variant);
	rebuild();
	resize();
	frame();
}
