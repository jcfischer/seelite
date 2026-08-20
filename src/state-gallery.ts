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
export type HeadLook = "left" | "forward" | "right";

const LEFT_DEFAULT_DETAIL =
	"Target discovery, filters, clearance requests, and replies live here — never under the mouse.";
const RIGHT_DEFAULT_DETAIL =
	"Speed, throttle, assist, relative motion, charge and drive state belong here.";
const TUNING_DETAIL =
	"v_max 20 c · exponent 0.60 · drop 50 km · vicinity 10,000 km · lead 3 s";

function leftPanelBody(state: GalleryState): string {
	return state.panel === "Navigation" || state.panel === "Communications"
		? state.panelDetail
		: LEFT_DEFAULT_DETAIL;
}

function leftPanelTitle(state: GalleryState): string {
	return state.panel === "Navigation" || state.panel === "Communications"
		? state.panel
		: "Navigation";
}

function rightPanelBody(state: GalleryState, rightTab: RightTab): string {
	if (rightTab === "Tuning") return TUNING_DETAIL;
	return rightTab === state.panel ? state.panelDetail : RIGHT_DEFAULT_DETAIL;
}

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

function buildRadar(
	cockpit: THREE.Group,
	glow: THREE.MeshBasicMaterial,
	cyan: THREE.MeshBasicMaterial,
	green: THREE.MeshBasicMaterial,
): THREE.Group {
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
		[-0.58, 0.21, 0.42, green],
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
	return radar;
}

function buildStarfield(scene: THREE.Scene): THREE.BufferGeometry {
	const positions = new Float32Array(480 * 3);
	const randomAt = (index: number) =>
		((Math.imul(index + 1, 1_103_515_245) + 12_345) >>> 0) / 2 ** 32;
	for (let index = 0; index < 480; index += 1) {
		positions[index * 3] = (randomAt(index * 3) * 2 - 1) * 18;
		positions[index * 3 + 1] = (randomAt(index * 3 + 1) * 2 - 1) * 10;
		positions[index * 3 + 2] = -14 - randomAt(index * 3 + 2) * 50;
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	scene.add(
		new THREE.Points(
			geometry,
			new THREE.PointsMaterial({
				color: 0xb8ddf2,
				size: 0.045,
				sizeAttenuation: true,
			}),
		),
	);
	return geometry;
}

function disposeCockpitScene(
	scene: THREE.Scene,
	renderer: THREE.WebGLRenderer,
	canvas: HTMLCanvasElement,
): void {
	scene.traverse((object) => {
		const drawable = object as THREE.Object3D & {
			geometry?: THREE.BufferGeometry;
			material?: THREE.Material | THREE.Material[];
		};
		if (!drawable.geometry || !drawable.material) return;
		drawable.geometry.dispose();
		disposeMeshMaterials(drawable.material);
	});
	renderer.dispose();
	canvas.remove();
}

function disposeMeshMaterials(
	material: THREE.Material | THREE.Material[],
): void {
	for (const item of Array.isArray(material) ? material : [material]) {
		if ("map" in item && item.map instanceof THREE.Texture) item.map.dispose();
		item.dispose();
	}
}

type CockpitBox = (frame: {
	size: [number, number, number];
	position: [number, number, number];
	rotation?: [number, number, number];
	material?: THREE.Material;
}) => THREE.Mesh;

function buildCanopyFrame(
	addBox: CockpitBox,
	metal: THREE.Material,
	trim: THREE.Material,
): void {
	// The forward view needs a shallow physical frame, not flat panels at its
	// edges. Keep the heavier console faces outside the forward camera, while
	// its braces, sill, and deck establish the pilot's point of view.
	addBox({ size: [5.7, 0.14, 0.18], position: [0, 1.55, -0.8] });
	addBox({
		size: [5.15, 0.1, 0.16],
		position: [0, 1.04, -1.28],
		material: trim,
	});
	addBox({
		size: [0.18, 2.8, 0.22],
		position: [-4.05, 0.12, -0.9],
		rotation: [0, 0, -0.24],
	});
	addBox({
		size: [0.18, 2.8, 0.22],
		position: [4.05, 0.12, -0.9],
		rotation: [0, 0, 0.24],
	});
	addBox({
		size: [0.12, 1.72, 0.16],
		position: [-2.72, 0.34, -1.3],
		rotation: [0, 0, -0.42],
		material: trim,
	});
	addBox({
		size: [0.12, 1.72, 0.16],
		position: [2.72, 0.34, -1.3],
		rotation: [0, 0, 0.42],
		material: trim,
	});
	addBox({
		size: [4.4, 0.24, 1.45],
		position: [0, -0.88, -1.85],
		rotation: [0.42, 0, 0],
		material: trim,
	});
	addBox({
		size: [1.65, 0.08, 0.82],
		position: [-3.4, -0.52, -1.44],
		rotation: [0.42, 0.16, 0],
		material: metal,
	});
	addBox({
		size: [1.65, 0.08, 0.82],
		position: [3.4, -0.52, -1.44],
		rotation: [0.42, -0.16, 0],
		material: metal,
	});
}

function buildInstrumentDeck(
	addBox: CockpitBox,
	metal: THREE.Material,
	trim: THREE.Material,
	cyan: THREE.Material,
	amber: THREE.Material,
): void {
	// A layered, sloped centre stack catches the light as actual cockpit
	// hardware. The small emissive blocks are status instruments, not a second
	// radar or a replacement for the side-console work surfaces.
	addBox({
		size: [2.45, 0.24, 0.92],
		position: [0, -0.68, -1.7],
		rotation: [0.43, 0, 0],
		material: trim,
	});
	addBox({
		size: [1.76, 0.13, 0.64],
		position: [0, -0.48, -1.57],
		rotation: [0.43, 0, 0],
		material: metal,
	});
	addBox({
		size: [0.98, 0.04, 0.34],
		position: [0, -0.39, -1.45],
		rotation: [0.43, 0, 0],
		material: cyan,
	});
	addBox({
		size: [0.23, 0.05, 0.2],
		position: [-0.63, -0.37, -1.42],
		rotation: [0.43, 0, 0],
		material: cyan,
	});
	addBox({
		size: [0.23, 0.05, 0.2],
		position: [0.63, -0.37, -1.42],
		rotation: [0.43, 0, 0],
		material: amber,
	});
	addBox({
		size: [0.12, 0.42, 0.26],
		position: [-1.18, -0.43, -1.58],
		rotation: [0.22, 0, 0.32],
		material: trim,
	});
	addBox({
		size: [0.12, 0.42, 0.26],
		position: [1.18, -0.43, -1.58],
		rotation: [0.22, 0, -0.32],
		material: trim,
	});

	// These are opaque housings only. The detailed and legible console content
	// belongs to the HTML overlays that appear after a head turn.
	for (const [x, yaw, accent] of [
		[-3.12, 0.15, cyan],
		[3.12, -0.15, amber],
	] as const) {
		addBox({
			size: [1.7, 0.22, 1.08],
			position: [x, -0.68, -1.77],
			rotation: [0.48, yaw, 0],
			material: metal,
		});
		addBox({
			size: [1.3, 0.05, 0.7],
			position: [x, -0.49, -1.61],
			rotation: [0.48, yaw, 0],
			material: trim,
		});
		addBox({
			size: [0.8, 0.035, 0.08],
			position: [x, -0.43, -1.49],
			rotation: [0.48, yaw, 0],
			material: accent,
		});
	}
}

function addConsoleDisplay(
	cockpit: THREE.Group,
	{
		headLook,
		title,
		body,
		x,
		rotationY,
		accent,
	}: {
		headLook: HeadLook;
		title: string;
		body: string;
		x: number;
		rotationY: number;
		accent: string;
	},
): THREE.Mesh | null {
	const textureCanvas = document.createElement("canvas");
	textureCanvas.width = 680;
	textureCanvas.height = 512;
	const context = textureCanvas.getContext("2d");
	if (!context) return null;
	context.strokeStyle = accent;
	context.lineWidth = 7;
	context.strokeRect(8, 8, textureCanvas.width - 16, textureCanvas.height - 16);
	context.fillStyle = accent;
	context.font = "600 34px ui-monospace, monospace";
	context.fillText(title, 36, 66);
	context.fillStyle = "#d4efff";
	context.font = "24px ui-monospace, monospace";
	context.globalAlpha = 0.5;
	for (let row = 0; row < 7; row += 1) {
		context.fillRect(34, 158 + row * 42, 548 - row * 26, 2);
		context.fillRect(34, 175 + row * 42, 16 + (row % 3) * 46, 9);
	}
	context.globalAlpha = 1;
	const words = body.split(" ");
	let line = "";
	let y = 122;
	for (const word of words) {
		const next = `${line}${line ? " " : ""}${word}`;
		if (context.measureText(next).width > 430) {
			context.fillText(line, 36, y);
			line = word;
			y += 38;
		} else line = next;
	}
	context.fillText(line, 36, y);
	const texture = new THREE.CanvasTexture(textureCanvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	const displayOpacity = 0;
	const screen = new THREE.Mesh(
		new THREE.PlaneGeometry(4.5, 3.35),
		new THREE.MeshBasicMaterial({
			map: texture,
			transparent: true,
			opacity: displayOpacity,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		}),
	);
	screen.position.set(x, -0.05, -1.28);
	screen.rotation.set(-0.4, rotationY, 0);
	cockpit.add(screen);
	return screen;
}

function buildConsoleDisplays(
	cockpit: THREE.Group,
	headLook: HeadLook,
	state: GalleryState,
	rightTab: RightTab,
): THREE.Mesh[] {
	const leftTitle = leftPanelTitle(state).toUpperCase();
	const left = addConsoleDisplay(cockpit, {
		headLook,
		title: leftTitle,
		body: leftPanelBody(state),
		x: -3.15,
		rotationY: 0.48,
		accent: "#7ac5e8",
	});
	const right = addConsoleDisplay(cockpit, {
		headLook,
		title: rightTab.toUpperCase(),
		body: rightPanelBody(state, rightTab),
		x: 3.15,
		rotationY: -0.48,
		accent: "#e5aa52",
	});
	return [left, right].filter(
		(screen): screen is THREE.Mesh => screen !== null,
	);
}

type CockpitScene = {
	detach(): void;
	attach(
		stage: HTMLElement,
		state: GalleryState,
		rightTab: RightTab,
		headLook: HeadLook,
	): void;
	dispose(): void;
};

function disposeConsoleDisplay(display: THREE.Mesh): void {
	display.geometry.dispose();
	disposeMeshMaterials(display.material);
}

/** A self-contained rendered cockpit, kept separate from the game scene. */
function mountCockpit3D(
	stage: HTMLElement,
	state: GalleryState,
	rightTab: RightTab,
	headLook: HeadLook,
): CockpitScene {
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
	scene.add(new THREE.HemisphereLight(0xa8d7f2, 0x071118, 2.6));
	const lamp = new THREE.PointLight(0xf2b459, 28, 12);
	lamp.position.set(0, 0.4, 0.6);
	scene.add(lamp);
	const instrumentLamp = new THREE.PointLight(0x75cbed, 8, 7);
	instrumentLamp.position.set(-1.4, -0.08, 0.3);
	scene.add(instrumentLamp);

	const metal = new THREE.MeshStandardMaterial({
		color: 0x426d84,
		roughness: 0.3,
		metalness: 0.8,
		emissive: 0x0a2737,
		emissiveIntensity: 1.15,
	});
	const trim = new THREE.MeshStandardMaterial({
		color: 0x664827,
		roughness: 0.23,
		metalness: 0.68,
		emissive: 0x281407,
		emissiveIntensity: 0.8,
	});
	const glow = new THREE.MeshBasicMaterial({ color: 0xe6a23c });
	const cyan = new THREE.MeshBasicMaterial({ color: 0x78cbed });
	const green = new THREE.MeshBasicMaterial({ color: 0x9df5aa });
	const addBox: CockpitBox = ({
		size,
		position,
		rotation = [0, 0, 0],
		material = metal,
	}) => {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
		mesh.position.set(...position);
		mesh.rotation.set(...rotation);
		cockpit.add(mesh);
		return mesh;
	};
	buildCanopyFrame(addBox, metal, trim);
	buildInstrumentDeck(addBox, metal, trim, cyan, glow);
	let consoleDisplays = buildConsoleDisplays(
		cockpit,
		headLook,
		state,
		rightTab,
	);

	const radar = buildRadar(cockpit, glow, cyan, green);
	radar.visible = false;
	buildStarfield(scene);

	let mountedStage = stage;
	const resize = () => {
		const { width, height } = mountedStage.getBoundingClientRect();
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	};
	const resizeObserver = new ResizeObserver(resize);
	resizeObserver.observe(mountedStage);
	resize();
	let frame = 0;
	let currentHeadLook = headLook;
	const cameraPose: Record<
		HeadLook,
		{ position: THREE.Vector3; target: THREE.Vector3 }
	> = {
		forward: {
			position: new THREE.Vector3(0, 0.4, 2.7),
			target: new THREE.Vector3(0, -0.28, -2.3),
		},
		left: {
			position: new THREE.Vector3(-1.9, 0.25, 2.15),
			target: new THREE.Vector3(-3.15, -0.05, -1.28),
		},
		right: {
			position: new THREE.Vector3(1.9, 0.25, 2.15),
			target: new THREE.Vector3(3.15, -0.05, -1.28),
		},
	};
	const render = (time: number) => {
		const pose = cameraPose[currentHeadLook];
		camera.position.copy(pose.position);
		camera.position.x += Math.sin(time * 0.00018) * 0.018;
		camera.position.y += Math.sin(time * 0.00013) * 0.008;
		camera.lookAt(pose.target);
		renderer.render(scene, camera);
		canvas.dataset.galleryRenderedFrame = "true";
		frame = requestAnimationFrame(render);
	};
	frame = requestAnimationFrame(render);
	return {
		detach() {
			resizeObserver.unobserve(mountedStage);
		},
		attach(nextStage, nextState, nextRightTab, nextHeadLook) {
			mountedStage = nextStage;
			mountedStage.prepend(canvas);
			resizeObserver.observe(mountedStage);
			for (const display of consoleDisplays) {
				cockpit.remove(display);
				disposeConsoleDisplay(display);
			}
			currentHeadLook = nextHeadLook;
			consoleDisplays = buildConsoleDisplays(
				cockpit,
				currentHeadLook,
				nextState,
				nextRightTab,
			);
			resize();
		},
		dispose() {
			cancelAnimationFrame(frame);
			resizeObserver.disconnect();
			disposeCockpitScene(scene, renderer, canvas);
		},
	};
}

const STYLE = `
#state-gallery { position: fixed; inset: 0; z-index: 20; overflow: auto; color: #d8eeff; background: #02080e; font: 13px/1.35 ui-monospace, "SF Mono", Menlo, monospace; }
#state-gallery * { box-sizing: border-box; }
.sg-wrap { min-height: 100%; max-width: 1180px; margin: auto; padding: 20px; display: grid; gap: 14px; }
.sg-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 1px solid #355369; padding-bottom: 12px; }
.sg-head h1 { margin: 0; color: #9fd4ff; font-size: 16px; letter-spacing: .08em; }
.sg-head p { margin: 4px 0 0; color: #8299aa; font-size: 11px; }
.sg-head-actions,
.sg-look { display: flex; align-items: center; gap: 6px; }
.sg-look button { border: 1px solid #355369; background: #07121c; color: #8eb8cf; cursor: pointer; font: inherit; font-size: 10px; padding: 5px 6px; }
.sg-look button[aria-pressed="true"] { border-color: #e5aa52; color: #ffe0a2; }
.sg-close,
.sg-state { border: 1px solid #355369; border-radius: 3px; background: #07121c; color: #b8dfff; cursor: pointer; font: inherit; padding: 7px 9px; }
.sg-close:hover,
.sg-state:hover,
.sg-state[aria-pressed="true"] { border-color: #e5aa52; color: #ffe0a2; }
.sg-states { display: flex; flex-wrap: wrap; gap: 6px; }
.sg-shell { min-height: 540px; perspective: 1200px; }
.sg-cockpit { position: relative; height: 540px; overflow: hidden; border: 1px solid #355369; background: #02080e; box-shadow: 0 24px 40px rgba(0, 0, 0, .45); transform-style: preserve-3d; }
.sg-3d-canvas { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; }
.sg-cockpit[data-gallery-head-look="left"]::after,
.sg-cockpit[data-gallery-head-look="right"]::after { content: ""; position: absolute; z-index: 4; inset: 0; background: rgba(2, 8, 14, .72); pointer-events: none; }
.sg-canopy { display: none; }
.sg-panel,
.sg-glass { border: 1px solid #355369; background: linear-gradient(145deg, rgba(13, 36, 53, .82), rgba(2, 9, 15, .96)); box-shadow: inset 0 0 42px rgba(60, 162, 220, .08); }
/* The side displays are cockpit-projected work surfaces. Forward flight leaves
   them peripheral; a head turn makes exactly one fill the useful field. */
.sg-panel { display: none; position: absolute; z-index: 5; inset: 31px 5.5% 70px; overflow: hidden; padding: 18px 22px; border-color: rgba(229, 170, 82, .88); background: linear-gradient(104deg, rgba(46, 18, 5, .94), rgba(16, 8, 5, .88) 58%, rgba(6, 9, 12, .8)); box-shadow: inset 0 0 68px rgba(231, 123, 31, .16), 0 0 28px rgba(227, 133, 39, .15); color: #ffd48c; clip-path: polygon(3% 0, 97% 0, 100% 93%, 92% 100%, 6% 100%, 0 93%); }
.sg-cockpit[data-gallery-head-look="left"] .sg-panel[data-gallery-panel="left"][data-active="true"],
.sg-cockpit[data-gallery-head-look="right"] .sg-panel[data-gallery-panel="right"][data-active="true"] { display: block; }
.sg-console-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 0 3px 11px; border-bottom: 2px solid #e5aa52; color: #ffe1a9; font-size: 18px; letter-spacing: .08em; }
.sg-console-top small { color: #d8833b; font-size: 10px; }
.sg-panel h2 { margin: 0; color: #ffe1a9; font-size: 18px; letter-spacing: .1em; }
.sg-panel p { color: #ffdcb0; margin: 0; }
.sg-panel > small { display: block; color: #cb8c51; margin-top: 14px; }
.sg-tabs { display: flex; gap: 7px; margin: 12px 0; border-bottom: 1px solid rgba(229, 170, 82, .55); }
.sg-tab { border: 0; border-bottom: 2px solid transparent; background: transparent; color: #d49352; cursor: pointer; font: inherit; font-size: 11px; letter-spacing: .05em; padding: 7px 10px; }
.sg-tab[aria-selected="true"] { border-color: #ffe0a2; color: #fff0c9; background: rgba(223, 122, 20, .18); }
.sg-console-layout { display: grid; grid-template-columns: minmax(130px, .42fr) 1fr; gap: 18px; min-height: 240px; }
.sg-console-rail { display: grid; align-content: start; gap: 8px; padding: 14px 12px; border-right: 1px solid rgba(229, 170, 82, .42); color: #e9a766; font-size: 11px; }
.sg-console-rail b { color: #fff0c9; font-size: 13px; }
.sg-console-data { display: grid; align-content: start; gap: 12px; padding: 14px 2px; }
.sg-console-data h3 { margin: 0; color: #ffe1a9; font-size: 15px; letter-spacing: .08em; }
.sg-console-data p { max-width: 48ch; font-size: 13px; line-height: 1.6; }
.sg-console-list { display: grid; gap: 6px; color: #f5bd78; font-size: 11px; }
.sg-console-list span { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 4px; border-bottom: 1px solid rgba(229, 170, 82, .34); }
.sg-glass { position: absolute; z-index: 2; inset: 26px 72px 0; overflow: hidden; min-height: 470px; border: 0; background: transparent; box-shadow: none; clip-path: polygon(8% 0, 92% 0, 100% 100%, 0 100%); }
.sg-stars, .sg-dash-deck { display: none; }
.sg-director { position: absolute; z-index: 2; left: 50%; top: 42%; width: 185px; transform: translate(-50%, -50%); color: #ffe0a2; text-align: center; text-shadow: 0 0 14px rgba(229, 170, 82, .65); transition: opacity 120ms linear; }
.sg-cockpit[data-gallery-head-look="left"] .sg-director, .sg-cockpit[data-gallery-head-look="right"] .sg-director { opacity: .12; }
.sg-cockpit[data-gallery-head-look="left"] .sg-scanner, .sg-cockpit[data-gallery-head-look="right"] .sg-scanner, .sg-cockpit[data-gallery-head-look="left"] .sg-floor, .sg-cockpit[data-gallery-head-look="right"] .sg-floor { opacity: 0; }
.sg-director::before { content: ""; display: block; width: 68px; height: 68px; margin: 0 auto 9px; border: 2px solid currentColor; border-radius: 50%; box-shadow: 0 0 18px currentColor; }
.sg-target-arrow { position: absolute; left: 50%; top: 23px; color: #ffe0a2; font-size: 24px; line-height: 1; text-shadow: 0 0 12px rgba(229, 170, 82, .9); transform: rotate(var(--target-bearing)) translateX(48px); transform-origin: 0 50%; }
.sg-director[data-accent="green"] { color: #a8ffbf; }
.sg-director[data-accent="red"] { color: #ff9c8e; }
.sg-director[data-accent="cyan"] { color: #a7dcff; }
.sg-docking { margin-top: 8px; color: inherit; font-size: 11px; }
.sg-dash-deck { position: absolute; z-index: 1; left: 50%; bottom: -27px; width: 500px; height: 220px; border: 2px solid rgba(202, 153, 67, .5); background: linear-gradient(160deg, rgba(71, 47, 24, .82), rgba(9, 15, 19, .96) 45%, rgba(1, 5, 8, .98)); box-shadow: inset 0 1px 0 rgba(255, 205, 119, .28), 0 0 40px rgba(0, 0, 0, .55); clip-path: polygon(18% 0, 82% 0, 100% 100%, 0 100%); transform: translateX(-50%) perspective(430px) rotateX(57deg); transform-origin: bottom; }
.sg-scanner { position: absolute; z-index: 2; left: 50%; bottom: 65px; width: 330px; height: 156px; opacity: .92; pointer-events: none; transform: translateX(-50%); }
.sg-scanner::before { content: ""; position: absolute; inset: 25px 5px 10px; border: 2px solid #eaa632; border-radius: 50%; background: repeating-radial-gradient(ellipse at center, transparent 0 12px, rgba(234, 166, 50, .65) 13px 14px); box-shadow: 0 0 18px rgba(234, 166, 50, .35), inset 0 0 18px rgba(234, 166, 50, .15); }
.sg-scanner::after { content: ""; position: absolute; left: 50%; top: 15px; bottom: 14px; width: 1px; background: #eaa632; opacity: .65; }
.sg-contact { position: absolute; width: 9px; height: 9px; border: 1px solid #ffd274; border-radius: 50%; background: #221b08; z-index: 1; }
.sg-contact::after { content: ""; position: absolute; top: 7px; left: 3px; width: 2px; height: var(--height); background: currentColor; box-shadow: 0 0 5px currentColor; opacity: .9; }
.sg-contact-anchor { position: absolute; width: 28px; height: 9px; border: 1px solid currentColor; border-radius: 50%; background: rgba(15, 25, 12, .5); box-shadow: 0 0 8px currentColor; opacity: .85; }
.sg-contact.one { left: 68%; top: 40%; color: #ffd274; --height: 47px; } .sg-contact-anchor.one { left: calc(68% - 9px); top: 72%; color: #ffd274; } .sg-contact.two { left: 24%; top: 62%; border-color: #a6ffbf; color: #a6ffbf; --height: 34px; } .sg-contact-anchor.two { left: calc(24% - 9px); top: 85%; color: #a6ffbf; } .sg-contact.three { left: 52%; top: 32%; border-color: #81c9ef; color: #81c9ef; --height: 60px; } .sg-contact-anchor.three { left: calc(52% - 9px); top: 73%; color: #81c9ef; }
.sg-scanner-label { position: absolute; left: 50%; top: 2px; color: #d2a860; font-size: 10px; transform: translateX(-50%); white-space: nowrap; }
.sg-floor { position: absolute; z-index: 6; left: 14px; right: 14px; bottom: 14px; display: flex; justify-content: space-between; gap: 12px; padding: 9px; border: 1px solid #355369; background: rgba(3, 14, 23, .94); color: #9fd4ff; font-size: 11px; }
.sg-floor strong { color: #ffe0a2; font-weight: 600; }
.sg-note { margin: 0; color: #b4c8d4; }
@media (max-width: 600px) {
	.sg-wrap { padding: 12px; }
	.sg-head { align-items: flex-start; }
	.sg-states { display: grid; grid-template-columns: 1fr 1fr; }
	.sg-shell,
	.sg-cockpit { min-height: 500px; height: 500px; }
	.sg-canopy { border-width: 16px; border-bottom-width: 48px; }
	.sg-panel { inset: 8px; max-height: 190px; padding: 12px; clip-path: none; }
	.sg-console-top { padding-bottom: 7px; font-size: 13px; }
	.sg-console-layout { grid-template-columns: .45fr 1fr; gap: 8px; min-height: 0; }
	.sg-console-rail,
	.sg-console-data { padding-top: 7px; }
	.sg-console-data p { font-size: 11px; line-height: 1.35; }
	.sg-console-list { display: none; }
	.sg-glass { inset: 18px 12px 0; min-height: 480px; clip-path: none; }
	.sg-scanner { width: min(330px, calc(100% - 24px)); bottom: 65px; }
	.sg-floor { bottom: 12px; font-size: 10px; flex-direction: column; gap: 3px; }
}
`;

function renderConsolePanel({
	side,
	active,
	title,
	subtitle,
	tabs,
	rail,
	heading,
	body,
	list,
	footer,
}: {
	side: "left" | "right";
	active: boolean;
	title: string;
	subtitle: string;
	tabs: string;
	rail: string[];
	heading: string;
	body: string;
	list: readonly [string, string][];
	footer: string;
}): string {
	return `<aside class="sg-panel" data-gallery-panel="${side}" data-active="${active}"><header class="sg-console-top"><h2>${title}</h2><small>${subtitle}</small></header><nav class="sg-tabs" aria-label="${side} console tabs">${tabs}</nav><div class="sg-console-layout"><div class="sg-console-rail">${rail.map((item, index) => (index === 0 ? `<b>${item}</b>` : `<span>${item}</span>`)).join("")}</div><div class="sg-console-data"><h3>${heading}</h3><p ${title === "TUNING" ? "data-gallery-tuning" : ""}>${body}</p><div class="sg-console-list">${list.map(([label, value]) => `<span><b>${label}</b><em>${value}</em></span>`).join("")}</div></div></div><small>${footer}</small></aside>`;
}

export function renderGalleryState(
	state: GalleryState,
	rightTab: RightTab,
	headLook: HeadLook = "forward",
): string {
	const isLeft = headLook === "left";
	const isRight = headLook === "right";
	const leftTitle = leftPanelTitle(state);
	const leftConsole = renderConsolePanel({
		side: "left",
		active: isLeft,
		title: leftTitle.toUpperCase(),
		subtitle: "LOCAL · 24",
		tabs: '<span class="sg-tab" aria-current="page">Navigation</span><span class="sg-tab">Transactions</span><span class="sg-tab">Contacts</span>',
		rail: ["SYSTEM", "SEELITE", "SET FILTERS", "GALAXY MAP", "SYSTEM MAP"],
		heading: `${leftTitle.toUpperCase()} / ROUTE`,
		body: leftPanelBody(state),
		list: [
			["VETIN", "0.837 AU"],
			["TRADE STATION", "6,240 km"],
			["LAST CONTACT", "08:41"],
		],
		footer: "Simulation continues while this console is open.",
	});
	const rightConsole = renderConsolePanel({
		side: "right",
		active: isRight,
		title: rightTab.toUpperCase(),
		subtitle: "CMDR · SEELITE",
		tabs: (["Flight", "Drive", "Tuning"] as RightTab[])
			.map(
				(tab) =>
					`<button class="sg-tab" type="button" data-gallery-right-tab="${tab}" aria-selected="${rightTab === tab}">${tab}</button>`,
			)
			.join(""),
		rail: ["SHIP", "POWER", "MODULES", "INVENTORY", "STATUS"],
		heading: `${rightTab.toUpperCase()} / CONTROL`,
		body: rightPanelBody(state, rightTab),
		list: [
			["THROTTLE", "62%"],
			["HEAT", "18%"],
			["FUEL", "92%"],
		],
		footer:
			"Tuning stays on this right-console tab, never on the flight floor.",
	});
	return `<div class="sg-wrap" data-gallery-version="${GALLERY_VERSION}" data-gallery-state-active="${state.id}">
		<header class="sg-head"><div><h1>SEELITE · COCKPIT STATE GALLERY</h1><p>Issue #34 prototype — visual contract, not simulated docking.</p></div><div class="sg-head-actions"><nav class="sg-look" aria-label="Cockpit head direction">${(["left", "forward", "right"] as HeadLook[]).map((look) => `<button type="button" data-gallery-look="${look}" aria-pressed="${headLook === look}">look ${look}</button>`).join("")}</nav><button class="sg-close" type="button">return to flight</button></div></header>
		<nav class="sg-states" aria-label="Cockpit states">${GALLERY_STATES.map((candidate) => `<button class="sg-state" type="button" data-gallery-state="${candidate.id}" aria-pressed="${candidate.id === state.id}">${candidate.label}</button>`).join("")}</nav>
		<div class="sg-shell" data-gallery-3d-prototype>
			<div class="sg-cockpit" data-gallery-cockpit data-gallery-head-look="${headLook}" data-gallery-physical-console="${headLook}"><div class="sg-canopy" aria-hidden="true"></div>
			${leftConsole}
			<main class="sg-glass" aria-live="polite"><div class="sg-stars"></div><div class="sg-dash-deck" aria-hidden="true"></div><div class="sg-director" data-gallery-director data-accent="${state.accent}">${state.targetBearingDeg === undefined ? "" : `<i class="sg-target-arrow" data-gallery-target-arrow data-gallery-target-bearing="${state.targetBearingDeg}" style="--target-bearing:${state.targetBearingDeg}deg" aria-label="turn toward target bearing">➤</i>`}${state.director}${state.id.startsWith("docking-") ? `<div class="sg-docking" data-gallery-docking>AXIS FUNNEL · ROLL RING · ${state.id === "docking-granted" ? "CLEAR TO APPROACH" : "DO NOT ENTER"}</div>` : ""}</div><div class="sg-scanner" data-gallery-scanner aria-label="Local radar, 10,000 kilometre vicinity"><i class="sg-contact one" data-gallery-contact-stem></i><i class="sg-contact-anchor one" data-gallery-contact-anchor></i><i class="sg-contact two" data-gallery-contact-stem></i><i class="sg-contact-anchor two" data-gallery-contact-anchor></i><i class="sg-contact three" data-gallery-contact-stem></i><i class="sg-contact-anchor three" data-gallery-contact-anchor></i><span class="sg-scanner-label">LOCAL RADAR · 10,000 km</span></div><div class="sg-floor" data-gallery-floor><span>${state.mode}</span><strong>${state.target}</strong></div></main>
			${rightConsole}
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
	let headLook: HeadLook = "forward";
	let cockpitScene: CockpitScene | null = null;
	const paint = () => {
		cockpitScene?.detach();
		root.innerHTML = renderGalleryState(current, rightTab, headLook);
		const cockpit = root.querySelector<HTMLElement>("[data-gallery-cockpit]");
		if (!cockpit) return;
		if (cockpitScene) cockpitScene.attach(cockpit, current, rightTab, headLook);
		else cockpitScene = mountCockpit3D(cockpit, current, rightTab, headLook);
	};
	const setState = (id: string) => {
		current = galleryState(id);
		rightTab = current.panel === "Drive" ? "Drive" : "Flight";
		paint();
	};
	paint();
	root.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const look = target.closest<HTMLElement>("[data-gallery-look]");
		if (look) {
			headLook = look.dataset.galleryLook as HeadLook;
			paint();
			return;
		}
		const state = target.closest<HTMLElement>("[data-gallery-state]");
		if (state) {
			setState(state.dataset.galleryState ?? "assist-on");
			return;
		}
		const tab = target.closest<HTMLElement>("[data-gallery-right-tab]");
		if (
			tab &&
			["Flight", "Drive", "Tuning"].includes(tab.dataset.galleryRightTab ?? "")
		) {
			rightTab = tab.dataset.galleryRightTab as RightTab;
			paint();
			return;
		}
		if (target.closest(".sg-close")) {
			cockpitScene?.dispose();
			cockpitScene = null;
			style.remove();
			root.remove();
			return;
		}
	});
}
