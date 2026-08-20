/**
 * A query-gated visual prototype for the cockpit language decided on issue #34.
 * It does not talk to `Game`: docking, communications, panels, and scanner
 * contacts are still design consumers, not completed simulation systems.
 */
import * as THREE from "three";

/** A probe-guard fingerprint for this browser-only prototype. */
export const GALLERY_VERSION = 1;

export type GalleryStateId =
	| "assist-on"
	| "assist-off"
	| "cruise"
	| "target-acquisition"
	| "docking-granted"
	| "docking-denied";

export type GalleryState = {
	id: GalleryStateId;
	label: string;
	mode: string;
	target: string;
	director: string;
	targetBearingDeg?: number;
	notice: string;
	panel: "Navigation" | "Flight" | "Communications" | "Drive";
	panelDetail: string;
	accent: "cyan" | "amber" | "green" | "red";
};

export type RightTab = "Flight" | "Drive" | "Tuning";

/** The six states Jens-Christian asked the gallery to make inspectable. */
export const GALLERY_STATES: readonly GalleryState[] = [
	{
		id: "assist-on",
		label: "Assist on",
		mode: "NORMAL · ASSIST ON · THROTTLE 62%",
		target: "No target selected",
		director: "ATTITUDE · PROGRADE",
		notice: "Flight floor stays quiet until something needs attention.",
		panel: "Flight",
		panelDetail: "2.0 km/s cap · prograde centred · damped drift",
		accent: "cyan",
	},
	{
		id: "assist-off",
		label: "Assist off",
		mode: "NORMAL · ASSIST OFF · THROTTLE 0%",
		target: "Drifting clear",
		director: "PROGRADE 34° RIGHT",
		notice: "The green velocity marker separates from the cyan nose reference.",
		panel: "Flight",
		panelDetail: "18.4 km/s · lateral drift persists · rotate to recover",
		accent: "amber",
	},
	{
		id: "cruise",
		label: "Cruise",
		mode: "CRUISE · 20.00 c · CHARGE 8.4/12.0 AU",
		target: "VETIN · 0.837 AU · ETA 68s",
		director: "TARGET AHEAD · CLOSING 2,450 km/s",
		notice: "Cruise speed changes the ship, never the game clock.",
		panel: "Drive",
		panelDetail:
			"8.4 AU remaining · regenerates 1 AU/min · no time compression",
		accent: "cyan",
	},
	{
		id: "target-acquisition",
		label: "Target acquisition",
		mode: "NORMAL · ASSIST ON · THROTTLE 40%",
		target: "TRADE STATION · 6,240 km",
		director: "TURN TOWARD TARGET",
		targetBearingDeg: -112,
		notice:
			"The arrow on the target circle makes the next turn actionable, without angle reading.",
		panel: "Navigation",
		panelDetail: "Stations · planets · contacts · range and ETA filters",
		accent: "amber",
	},
	{
		id: "docking-granted",
		label: "Docking granted",
		mode: "NORMAL · ASSIST ON · THROTTLE 12%",
		target: "TRADE STATION · 2.4 km",
		director: "ALIGN AXIS · MATCH ROLL · CLEARANCE 08:41",
		notice: "Clearance is live. The director makes the active checks visible.",
		panel: "Communications",
		panelDetail: "DOCKING GRANTED · slot clear · grant expires in 08:41",
		accent: "green",
	},
	{
		id: "docking-denied",
		label: "Docking denied",
		mode: "NORMAL · ASSIST ON · THROTTLE 0%",
		target: "SHIPYARD · 1.8 km",
		director: "DO NOT ENTER · CLEARANCE DENIED",
		notice: "Red is blocking, and the reason is written beside the warning.",
		panel: "Communications",
		panelDetail: "DOCKING DENIED · hostile status · leave the approach",
		accent: "red",
	},
];

export function galleryState(id: string | null): GalleryState {
	return GALLERY_STATES.find((state) => state.id === id) ?? GALLERY_STATES[0];
}

/** A self-contained rendered cockpit, kept separate from the game scene. */
function mountCockpit3D(stage: HTMLElement): () => void {
	const canvas = document.createElement("canvas");
	canvas.className = "sg-3d-canvas";
	canvas.setAttribute("data-gallery-3d-canvas", "true");
	stage.prepend(canvas);
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.setClearColor(0x02080e, 1);
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(54, 1, 0.05, 100);
	camera.position.set(0, 0.4, 2.7);
	const cockpit = new THREE.Group();
	scene.add(cockpit);
	scene.add(new THREE.HemisphereLight(0x88b8d8, 0x05080b, 1.8));
	const lamp = new THREE.PointLight(0xe5a244, 18, 12);
	lamp.position.set(0, 0.4, 0.6);
	scene.add(lamp);

	const metal = new THREE.MeshStandardMaterial({
		color: 0x355267,
		roughness: 0.38,
		metalness: 0.82,
		emissive: 0x07131d,
		emissiveIntensity: 0.75,
	});
	const trim = new THREE.MeshStandardMaterial({
		color: 0x3e2b12,
		roughness: 0.26,
		metalness: 0.66,
		emissive: 0x120900,
		emissiveIntensity: 0.55,
	});
	const glow = new THREE.MeshBasicMaterial({ color: 0xe6a23c });
	const cyan = new THREE.MeshBasicMaterial({ color: 0x78cbed });
	const display = new THREE.MeshStandardMaterial({
		color: 0x122b38,
		emissive: 0x0c7da2,
		emissiveIntensity: 1.3,
		roughness: 0.2,
		metalness: 0.1,
	});
	const addBox = (
		width: number,
		height: number,
		depth: number,
		x: number,
		y: number,
		z: number,
		rx = 0,
		ry = 0,
		rz = 0,
		material: THREE.Material = metal,
	) => {
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(width, height, depth),
			material,
		);
		mesh.position.set(x, y, z);
		mesh.rotation.set(rx, ry, rz);
		cockpit.add(mesh);
		return mesh;
	};
	// Canopy structure and recessed physical instrument deck.
	addBox(5.7, 0.14, 0.18, 0, 1.55, -0.8);
	addBox(0.18, 2.8, 0.22, -2.55, 0.12, -0.9, 0, 0, -0.24);
	addBox(0.18, 2.8, 0.22, 2.55, 0.12, -0.9, 0, 0, 0.24);
	addBox(4.4, 0.24, 1.45, 0, -0.88, -1.85, 0.42, 0, 0, trim);
	addBox(1.65, 0.08, 0.82, -1.62, -0.52, -1.44, 0.42, 0.16, 0, metal);
	addBox(1.65, 0.08, 0.82, 1.62, -0.52, -1.44, 0.42, -0.16, 0, metal);
	addBox(1.16, 0.026, 0.48, -1.62, -0.45, -1.3, 0.42, 0.16, 0, display);
	addBox(1.16, 0.026, 0.48, 1.62, -0.45, -1.3, 0.42, -0.16, 0, display);

	const radar = new THREE.Group();
	radar.position.set(0, -0.5, -1.62);
	radar.rotation.x = -Math.PI / 2;
	cockpit.add(radar);
	for (let ring = 0; ring < 8; ring += 1) {
		const mesh = new THREE.Mesh(
			new THREE.TorusGeometry(0.22 + ring * 0.12, 0.012, 8, 64),
			glow,
		);
		mesh.scale.y = 0.52;
		radar.add(mesh);
	}
	for (const [x, z, height, material] of [
		[-0.58, 0.21, 0.42, new THREE.MeshBasicMaterial({ color: 0x9df5aa })],
		[0.12, -0.08, 0.68, cyan],
		[0.57, 0.16, 0.53, glow],
	] as const) {
		const anchor = new THREE.Mesh(
			new THREE.CylinderGeometry(0.12, 0.12, 0.022, 32),
			material,
		);
		anchor.position.set(x, z, 0);
		radar.add(anchor);
		const mast = new THREE.Mesh(
			new THREE.CylinderGeometry(0.018, 0.018, height, 12),
			material,
		);
		mast.position.set(x, z, height / 2);
		mast.rotation.x = Math.PI / 2;
		radar.add(mast);
		const contact = new THREE.Mesh(
			new THREE.SphereGeometry(0.05, 16, 12),
			material,
		);
		contact.position.set(x, z, height);
		radar.add(contact);
	}

	const starPositions = new Float32Array(480 * 3);
	for (let index = 0; index < 480; index += 1) {
		const seed = (index * 9301 + 49297) % 233280;
		starPositions[index * 3] = ((seed % 100) / 50 - 1) * 18;
		starPositions[index * 3 + 1] = (((seed / 100) % 100) / 50 - 1) * 10;
		starPositions[index * 3 + 2] = -14 - (seed % 50);
	}
	const stars = new THREE.BufferGeometry();
	stars.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
	scene.add(
		new THREE.Points(
			stars,
			new THREE.PointsMaterial({
				color: 0xb8ddf2,
				size: 0.045,
				sizeAttenuation: true,
			}),
		),
	);

	const resize = () => {
		const { width, height } = stage.getBoundingClientRect();
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	};
	const resizeObserver = new ResizeObserver(resize);
	resizeObserver.observe(stage);
	resize();
	let frame = 0;
	const render = (time: number) => {
		camera.position.x = Math.sin(time * 0.00018) * 0.035;
		camera.position.y = 0.4 + Math.sin(time * 0.00013) * 0.012;
		camera.lookAt(0, -0.28, -2.1);
		renderer.render(scene, camera);
		frame = requestAnimationFrame(render);
	};
	frame = requestAnimationFrame(render);
	return () => {
		cancelAnimationFrame(frame);
		resizeObserver.disconnect();
		scene.traverse((object) => {
			if (!(object instanceof THREE.Mesh)) return;
			object.geometry.dispose();
			const materials = Array.isArray(object.material)
				? object.material
				: [object.material];
			for (const material of materials) material.dispose();
		});
		stars.dispose();
		renderer.dispose();
		canvas.remove();
	};
}

const STYLE = `
#state-gallery { position: fixed; inset: 0; z-index: 20; overflow: auto; color: #d8eeff; background: #02080e; font: 13px/1.35 ui-monospace, "SF Mono", Menlo, monospace; }
#state-gallery * { box-sizing: border-box; }
.sg-wrap { min-height: 100%; max-width: 1180px; margin: auto; padding: 20px; display: grid; gap: 14px; }
.sg-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 1px solid #355369; padding-bottom: 12px; }
.sg-head h1 { margin: 0; color: #9fd4ff; font-size: 16px; letter-spacing: .08em; }
.sg-head p { margin: 4px 0 0; color: #8299aa; font-size: 11px; }
.sg-close, .sg-state { border: 1px solid #355369; border-radius: 3px; background: #07121c; color: #b8dfff; cursor: pointer; font: inherit; padding: 7px 9px; }
.sg-close:hover, .sg-state:hover, .sg-state[aria-pressed="true"] { border-color: #e5aa52; color: #ffe0a2; }
.sg-states { display: flex; flex-wrap: wrap; gap: 6px; }
.sg-shell { min-height: 540px; perspective: 1200px; }
.sg-cockpit { position: relative; height: 540px; overflow: hidden; border: 1px solid #355369; background: #02080e; box-shadow: 0 24px 40px rgba(0, 0, 0, .45); transform-style: preserve-3d; }
.sg-3d-canvas { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; }
.sg-canopy { display: none; }
.sg-panel, .sg-glass { border: 1px solid #355369; background: linear-gradient(145deg, rgba(13, 36, 53, .82), rgba(2, 9, 15, .96)); box-shadow: inset 0 0 42px rgba(60, 162, 220, .08); }
.sg-panel { position: absolute; z-index: 5; bottom: 14px; width: 224px; min-height: 164px; padding: 14px; background: linear-gradient(160deg, rgba(20, 39, 52, .98), rgba(3, 9, 14, .98)); box-shadow: inset 0 1px 0 rgba(177, 219, 240, .2), 0 12px 25px rgba(0, 0, 0, .5); }
.sg-panel[data-gallery-panel="left"] { left: 13px; transform: rotateY(26deg) rotateX(4deg); transform-origin: bottom left; }
.sg-panel[data-gallery-panel="right"] { right: 13px; transform: rotateY(-26deg) rotateX(4deg); transform-origin: bottom right; }
.sg-panel h2 { margin: 0 0 10px; color: #9fd4ff; font-size: 12px; letter-spacing: .1em; }
.sg-panel p { color: #bed4e2; margin: 0; }
.sg-panel small { display: block; color: #7893a6; margin-top: 14px; }
.sg-tabs { display: flex; gap: 4px; margin: 0 0 10px; }
.sg-tab { border: 0; border-bottom: 1px solid #355369; background: transparent; color: #7795aa; cursor: pointer; font: inherit; font-size: 10px; padding: 4px 6px; }
.sg-tab[aria-selected="true"] { border-color: #e5aa52; color: #ffe0a2; }
.sg-glass { position: absolute; z-index: 2; inset: 26px 72px 0; overflow: hidden; min-height: 470px; border: 0; background: transparent; box-shadow: none; clip-path: polygon(8% 0, 92% 0, 100% 100%, 0 100%); }
.sg-stars, .sg-dash-deck { display: none; }
.sg-director { position: absolute; z-index: 2; left: 50%; top: 42%; width: 185px; transform: translate(-50%, -50%); color: #ffe0a2; text-align: center; text-shadow: 0 0 14px rgba(229, 170, 82, .65); }
.sg-director::before { content: ""; display: block; width: 68px; height: 68px; margin: 0 auto 9px; border: 2px solid currentColor; border-radius: 50%; box-shadow: 0 0 18px currentColor; }
.sg-target-arrow { position: absolute; left: 50%; top: 23px; color: #ffe0a2; font-size: 24px; line-height: 1; text-shadow: 0 0 12px rgba(229, 170, 82, .9); transform: rotate(var(--target-bearing)) translateX(48px); transform-origin: 0 50%; }
.sg-director[data-accent="green"] { color: #a8ffbf; } .sg-director[data-accent="red"] { color: #ff9c8e; } .sg-director[data-accent="cyan"] { color: #a7dcff; }
.sg-docking { margin-top: 8px; color: inherit; font-size: 11px; }
.sg-dash-deck { position: absolute; z-index: 1; left: 50%; bottom: -27px; width: 500px; height: 220px; border: 2px solid rgba(202, 153, 67, .5); background: linear-gradient(160deg, rgba(71, 47, 24, .82), rgba(9, 15, 19, .96) 45%, rgba(1, 5, 8, .98)); box-shadow: inset 0 1px 0 rgba(255, 205, 119, .28), 0 0 40px rgba(0, 0, 0, .55); clip-path: polygon(18% 0, 82% 0, 100% 100%, 0 100%); transform: translateX(-50%) perspective(430px) rotateX(57deg); transform-origin: bottom; }
.sg-scanner { position: absolute; z-index: 2; left: 50%; bottom: 65px; width: 330px; height: 156px; opacity: 0; pointer-events: none; transform: translateX(-50%); }
.sg-scanner::before { content: ""; position: absolute; inset: 25px 5px 10px; border: 2px solid #eaa632; border-radius: 50%; background: repeating-radial-gradient(ellipse at center, transparent 0 12px, rgba(234, 166, 50, .65) 13px 14px); box-shadow: 0 0 18px rgba(234, 166, 50, .35), inset 0 0 18px rgba(234, 166, 50, .15); }
.sg-scanner::after { content: ""; position: absolute; left: 50%; top: 15px; bottom: 14px; width: 1px; background: #eaa632; opacity: .65; }
.sg-contact { position: absolute; width: 9px; height: 9px; border: 1px solid #ffd274; border-radius: 50%; background: #221b08; z-index: 1; } .sg-contact::after { content: ""; position: absolute; top: 7px; left: 3px; width: 2px; height: var(--height); background: currentColor; box-shadow: 0 0 5px currentColor; opacity: .9; }
.sg-contact-anchor { position: absolute; width: 28px; height: 9px; border: 1px solid currentColor; border-radius: 50%; background: rgba(15, 25, 12, .5); box-shadow: 0 0 8px currentColor; opacity: .85; }
.sg-contact.one { left: 68%; top: 40%; color: #ffd274; --height: 47px; } .sg-contact-anchor.one { left: calc(68% - 9px); top: 72%; color: #ffd274; } .sg-contact.two { left: 24%; top: 62%; border-color: #a6ffbf; color: #a6ffbf; --height: 34px; } .sg-contact-anchor.two { left: calc(24% - 9px); top: 85%; color: #a6ffbf; } .sg-contact.three { left: 52%; top: 32%; border-color: #81c9ef; color: #81c9ef; --height: 60px; } .sg-contact-anchor.three { left: calc(52% - 9px); top: 73%; color: #81c9ef; }
.sg-scanner-label { position: absolute; left: 50%; top: 2px; color: #d2a860; font-size: 10px; transform: translateX(-50%); white-space: nowrap; }
.sg-floor { position: absolute; z-index: 6; left: 14px; right: 14px; bottom: 14px; display: flex; justify-content: space-between; gap: 12px; padding: 9px; border: 1px solid #355369; background: rgba(3, 14, 23, .94); color: #9fd4ff; font-size: 11px; }
.sg-floor strong { color: #ffe0a2; font-weight: 600; } .sg-note { margin: 0; color: #b4c8d4; }
@media (max-width: 600px) { .sg-wrap { padding: 12px; } .sg-head { align-items: flex-start; } .sg-states { display: grid; grid-template-columns: 1fr 1fr; } .sg-shell, .sg-cockpit { min-height: 500px; height: 500px; } .sg-canopy { border-width: 16px; border-bottom-width: 48px; } .sg-panel { display: none; transform: none !important; } .sg-panel[data-active="true"] { position: absolute; z-index: 6; left: 8px; right: 8px; top: 8px; width: auto; display: block; } .sg-glass { inset: 18px 12px 0; min-height: 480px; clip-path: none; } .sg-scanner { width: min(330px, calc(100% - 24px)); bottom: 65px; } .sg-floor { bottom: 12px; font-size: 10px; flex-direction: column; gap: 3px; } }
`;

export function renderGalleryState(
	state: GalleryState,
	rightTab: RightTab,
): string {
	const isLeft =
		state.panel === "Navigation" || state.panel === "Communications";
	const isRight = state.panel === "Flight" || state.panel === "Drive";
	const sideDetail =
		"Target discovery, filters, clearance requests, and replies live here — never under the mouse.";
	const technicalDetail =
		"Speed, throttle, assist, relative motion, charge and drive state belong here.";
	const tuningDetail =
		"v_max 20 c · exponent 0.60 · drop 50 km · vicinity 10,000 km · lead 3 s";
	return `<div class="sg-wrap" data-gallery-state-active="${state.id}">
		<header class="sg-head"><div><h1>SEELITE · COCKPIT STATE GALLERY</h1><p>Issue #34 prototype — visual contract, not simulated docking.</p></div><button class="sg-close" type="button">return to flight</button></header>
		<nav class="sg-states" aria-label="Cockpit states">${GALLERY_STATES.map((candidate) => `<button class="sg-state" type="button" data-gallery-state="${candidate.id}" aria-pressed="${candidate.id === state.id}">${candidate.label}</button>`).join("")}</nav>
		<div class="sg-shell" data-gallery-3d-prototype>
			<div class="sg-cockpit" data-gallery-cockpit><div class="sg-canopy" aria-hidden="true"></div>
			<aside class="sg-panel" data-gallery-panel="left" data-active="${isLeft}"><h2>${isLeft ? state.panel : "NAVIGATION"}</h2><p>${isLeft ? state.panelDetail : sideDetail}</p><small>Simulation continues while this panel is open.</small></aside>
			<main class="sg-glass" aria-live="polite"><div class="sg-stars"></div><div class="sg-dash-deck" aria-hidden="true"></div><div class="sg-director" data-gallery-director data-accent="${state.accent}">${state.targetBearingDeg === undefined ? "" : `<i class="sg-target-arrow" data-gallery-target-arrow data-gallery-target-bearing="${state.targetBearingDeg}" style="--target-bearing:${state.targetBearingDeg}deg" aria-label="turn toward target bearing">➤</i>`}${state.director}${state.id.startsWith("docking-") ? `<div class="sg-docking" data-gallery-docking>AXIS FUNNEL · ROLL RING · ${state.id === "docking-granted" ? "CLEAR TO APPROACH" : "DO NOT ENTER"}</div>` : ""}</div><div class="sg-scanner" data-gallery-scanner aria-label="Elite-style 3D local radar, 10,000 kilometre vicinity"><i class="sg-contact one" data-gallery-contact-stem></i><i class="sg-contact-anchor one" data-gallery-contact-anchor></i><i class="sg-contact two" data-gallery-contact-stem></i><i class="sg-contact-anchor two" data-gallery-contact-anchor></i><i class="sg-contact three" data-gallery-contact-stem></i><i class="sg-contact-anchor three" data-gallery-contact-anchor></i><span class="sg-scanner-label">ELITE 3D RADAR · 10,000 km</span></div><div class="sg-floor" data-gallery-floor><span>${state.mode}</span><strong>${state.target}</strong></div></main>
			<aside class="sg-panel" data-gallery-panel="right" data-active="${isRight}"><nav class="sg-tabs" aria-label="Right panel tabs">${(["Flight", "Drive", "Tuning"] as RightTab[]).map((tab) => `<button class="sg-tab" type="button" data-gallery-right-tab="${tab}" aria-selected="${rightTab === tab}">${tab}</button>`).join("")}</nav><h2>${rightTab.toUpperCase()}</h2><p ${rightTab === "Tuning" ? "data-gallery-tuning" : ""}>${rightTab === "Tuning" ? tuningDetail : rightTab === state.panel ? state.panelDetail : technicalDetail}</p><small>Tuning stays in this right-panel tab, never on the flight floor.</small></aside>
			</div>
		</div><p class="sg-note" data-gallery-notice>${state.notice}</p>
	</div>`;
}

/** Mount only when a designer explicitly requests `?hud-gallery=<state>`. */
export function mountStateGallery(): void {
	const requested = new URLSearchParams(window.location.search).get(
		"hud-gallery",
	);
	if (requested === null) return;
	const style = document.createElement("style");
	style.textContent = STYLE;
	document.head.append(style);
	const root = document.createElement("section");
	root.id = "state-gallery";
	document.body.append(root);
	let current = galleryState(requested === "1" ? "assist-on" : requested);
	let rightTab: RightTab = current.panel === "Drive" ? "Drive" : "Flight";
	let unmountCockpit = () => {};
	const paint = () => {
		unmountCockpit();
		root.innerHTML = renderGalleryState(current, rightTab);
		const cockpit = root.querySelector<HTMLElement>("[data-gallery-cockpit]");
		if (cockpit) unmountCockpit = mountCockpit3D(cockpit);
	};
	const setState = (id: string) => {
		current = galleryState(id);
		rightTab = current.panel === "Drive" ? "Drive" : "Flight";
		paint();
	};
	paint();
	root.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const state = target.closest<HTMLElement>("[data-gallery-state]");
		if (state) setState(state.dataset.galleryState ?? "assist-on");
		const tab = target.closest<HTMLElement>("[data-gallery-right-tab]");
		if (
			tab &&
			["Flight", "Drive", "Tuning"].includes(tab.dataset.galleryRightTab ?? "")
		) {
			rightTab = tab.dataset.galleryRightTab as RightTab;
			paint();
		}
		if (target.closest(".sg-close")) {
			unmountCockpit();
			style.remove();
			root.remove();
		}
	});
}
