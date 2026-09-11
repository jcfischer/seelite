/**
 * A query-gated visual prototype for the cockpit language decided on issue #34.
 * It does not talk to `Game`: docking, communications, panels, and scanner
 * contacts are still design consumers, not completed simulation systems.
 */
import * as THREE from "three";
import { TRAVERSAL_SECONDS_DEEP, TRAVERSAL_SECONDS_NEAR } from "./docking";
import {
	HOLD_REFERENCE_T,
	MARKET_PERIOD_MIN,
	type MarketStation,
	type StationTypeKey,
	marketEpoch,
	marketStationOf,
} from "./market";
import {
	type ConsoleMarketRow,
	type DockPhase,
	type StationConsoleTab,
	flightFloorVisible,
	signedDelta,
	stationConsoleVisible,
	stationEquipmentScreen,
	stationMarketScreen,
} from "./station-console";

export type GalleryStateId =
	| "assist-on"
	| "assist-off"
	| "cruise"
	| "target-acquisition"
	| "docking-granted"
	| "docking-denied"
	| "docked";

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

function isLeftConsolePanel(state: GalleryState): boolean {
	return state.panel === "Navigation" || state.panel === "Communications";
}

function leftPanelBody(state: GalleryState): string {
	return isLeftConsolePanel(state) ? state.panelDetail : LEFT_DEFAULT_DETAIL;
}

function leftPanelTitle(state: GalleryState): string {
	return isLeftConsolePanel(state) ? state.panel : "Navigation";
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
	{
		// §8's docked state. `mode` and `target` are unread here: M10 takes the
		// flight floor away and the floor is the only thing that renders them.
		// They are filled rather than blanked because `GalleryState` requires
		// them, and a reader comparing this entry with the six above should see
		// what the floor *would* have said.
		id: "docked",
		label: "Docked",
		mode: "DOCKED · FLIGHT SUSPENDED · THROTTLE INERT",
		target: "STATION CONSOLE",
		director: "",
		notice:
			"Docked reuses the cockpit: the console hangs on the forward wall, and launch stays on the Flight console.",
		panel: "Flight",
		panelDetail:
			"Flight is suspended while docked. Throttle and assist are shown inert; launch is the one live control.",
		accent: "cyan",
	},
];

// ---------------------------------------------------------------------------
// §8 — the station console the docked state hangs on the forward wall
// ---------------------------------------------------------------------------

/**
 * A station for the console to quote, chosen so the gallery can show both
 * halves of every rule §8 states as a biconditional.
 *
 * Three of them rather than one. M5's "priced **iff** `listsCommodity`" cannot
 * be seen at a single station — away from a fence the three illegal rows are
 * unpriced, at one they are priced like everything else, and one station shows
 * one side of that and reads like a rule with no exception. The shipyard is
 * there for a different reason: §8.3's hull heading is drawn at one and nowhere
 * else, so without it that state would be markup no gallery state reaches.
 */
export interface ConsoleStation {
	id: "trade" | "fence" | "yard";
	label: string;
	economy: number;
	displayTL: number;
	type: StationTypeKey;
	station: MarketStation;
	/** §5.2 marks left here by the player, so M6's delta has something to show. */
	moved: Record<string, number>;
}

const consoleStation = ({
	id,
	label,
	type,
	economy,
	displayTL,
	blackMarket,
}: {
	id: ConsoleStation["id"];
	label: string;
	type: StationTypeKey;
	economy: number;
	displayTL: number;
	blackMarket: boolean;
}): ConsoleStation => ({
	id,
	label,
	economy,
	displayTL,
	type,
	station: marketStationOf(
		{ type, localCarrierId: `gallery-${id}`, blackMarket },
		0x5ee1_17e,
	),
	// Computers rather than an arbitrary row: it is expensive at every economy,
	// so §5's proportional response moves it by credits a reader can see, and
	// its shelf is deep enough that the deficit is not swallowed by the clamp.
	moved: { Computers: 12 },
});

export const CONSOLE_STATIONS: readonly ConsoleStation[] = [
	// TL 4 is the frontier case M8 is written for: seven of the ten universal
	// items on the shelf, and three named with the tech level that would sell
	// them.
	consoleStation({
		id: "trade",
		label: "TRADE STATION · TL 4",
		type: "trade",
		economy: 3,
		displayTL: 4,
		blackMarket: false,
	}),
	consoleStation({
		id: "fence",
		label: "REFINERY · FENCE · TL 9",
		type: "refinery",
		economy: 5,
		displayTL: 9,
		blackMarket: true,
	}),
	// A shipyard, because §8.3's hull heading is drawn at one and nowhere else.
	// Without it the empty-hulls state §8.7's joint 4 names — one a player will
	// see — would ship in the markup and be rendered by no gallery state.
	consoleStation({
		id: "yard",
		label: "SHIPYARD · TL 11",
		type: "shipyard",
		economy: 1,
		displayTL: 11,
		blackMarket: false,
	}),
];

/** What the forward wall is showing: which station, which tab, and how far
 *  through the dock the player is. */
export interface ConsoleView {
	station: ConsoleStation;
	tab: StationConsoleTab;
	phase: DockPhase;
	/** #6's clock in game minutes — the epoch the quote is taken in. */
	gameTimeMin: number;
}

/** The two tabs, as values a DOM-sourced string can be checked against. */
export const CONSOLE_TABS: readonly StationConsoleTab[] = [
	"Market",
	"Equipment",
];

export const DEFAULT_CONSOLE_VIEW: ConsoleView = {
	station: CONSOLE_STATIONS[0],
	tab: "Market",
	phase: "docked",
	gameTimeMin: 0,
};

/** The gallery's arrival, inside §13.3's ratified range. `arrival.ts` owns the
 *  real law, which prices the route rather than assuming a berth. */
export const GALLERY_ARRIVAL_SECONDS =
	(TRAVERSAL_SECONDS_NEAR + TRAVERSAL_SECONDS_DEEP) / 2;

/**
 * Everything the console interpolates goes through here.
 *
 * The values are static table data today — `COMMODITIES` and `EQUIPMENT` — so
 * there is no live path in. The sink is not: `renderGalleryState`'s result is
 * assigned to `innerHTML`, and the day a station or good name comes from a save
 * or a URL the guard has to already be here rather than be remembered.
 */
const esc = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

const CR = (value: number): string => `${value.toFixed(1)} Cr`;

function renderMarketRow(row: ConsoleMarketRow): string {
	const marker = row.commodity.illegal
		? '<b class="sg-illegal" data-gallery-illegal title="restricted">⚠</b>'
		: "";
	const name = `<span class="sg-good">${esc(row.commodity.name)}${marker}</span>`;
	if (!row.listed)
		return `<div class="sg-market-row" data-gallery-market-row="${esc(row.commodity.name)}" data-gallery-listed="false">${name}<span class="sg-cell sg-absent">—</span><span class="sg-cell sg-absent">—</span></div>`;
	const priceDelta =
		row.priceDeltaCr === undefined
			? ""
			: `<em class="sg-delta" data-gallery-price-delta>${signedDelta(row.priceDeltaCr, 1)}</em>`;
	const shelfDelta =
		row.quantityDelta === undefined
			? ""
			: `<em class="sg-delta" data-gallery-shelf-delta>${signedDelta(row.quantityDelta, 0)}</em>`;
	return `<div class="sg-market-row" data-gallery-market-row="${esc(row.commodity.name)}" data-gallery-listed="true">${name}<span class="sg-cell"><span data-gallery-price>${CR(row.priceCr as number)}</span>${priceDelta}</span><span class="sg-cell"><span data-gallery-shelf>${row.quantity} ${esc(row.commodity.unit)}</span>${shelfDelta}</span></div>`;
}

function renderMarketTab(view: ConsoleView): string {
	const rows = stationMarketScreen({
		station: view.station.station,
		economy: view.station.economy,
		gameTimeMin: view.gameTimeMin,
		deficitOf: (name) => view.station.moved[name] ?? 0,
		// The gallery flies the baseline hull, and `HOLD_REFERENCE_T` *is* that
		// hull's row since #181 — reached through `market.ts`, already imported
		// here, rather than adding a second spelling of one figure to a
		// renderer-side module.
		holdT: HOLD_REFERENCE_T,
	});
	const traded = rows.filter((row) => row.listed);
	const absent = rows.filter((row) => !row.listed);
	// M5's named block. It is a heading and not a greyed-out remainder, because
	// station-types.md §3.4's failure mode is the exception being unread.
	const absentBlock =
		absent.length === 0
			? ""
			: `<h4 class="sg-block-head" data-gallery-not-traded>NOT TRADED HERE</h4>${absent.map(renderMarketRow).join("")}`;
	return `<div class="sg-market" data-gallery-market><div class="sg-market-row sg-market-head"><span class="sg-good">GOOD</span><span class="sg-cell">PRICE</span><span class="sg-cell">SHELF</span></div>${traded.map(renderMarketRow).join("")}${absentBlock}</div>`;
}

/**
 * One three-cell catalogue row. The equipment tab draws three kinds of them —
 * available, unavailable, hulls — and had three inlined copies of the grid.
 *
 * `rightCell` is the middle cell's whole attribute list rather than just a
 * class, because the unavailable row's reason carries a probe hook there.
 */
const catalogueRow = (
	rowAttribute: string,
	name: string,
	right: string,
	rightCell = 'class="sg-cell"',
): string =>
	`<div class="sg-market-row" ${rowAttribute}="${esc(name)}"><span class="sg-good">${esc(name)}</span><span ${rightCell}>${right}</span><span class="sg-cell"></span></div>`;

function renderEquipmentTab(view: ConsoleView): string {
	const screen = stationEquipmentScreen({
		type: view.station.type,
		displayTL: view.station.displayTL,
	});
	const available = screen.available
		.map((item) =>
			catalogueRow(
				"data-gallery-equipment-item",
				item.name,
				item.per === "ly"
					? `${item.priceCr.toFixed(1)} Cr / LY`
					: `${item.priceCr.toLocaleString("en-US")} Cr`,
			),
		)
		.join("");
	const unavailable = screen.unavailable
		.map((item) =>
			catalogueRow(
				"data-gallery-unavailable-item",
				item.name,
				esc(item.reason),
				'class="sg-cell sg-absent" data-gallery-unavailable-reason',
			),
		)
		.join("");
	// §8.7's joint 4: a heading with nothing under it is a state a player sees,
	// so the gallery renders it rather than hiding the gap until #26.
	// The heading is a shipyard's; what is under it is #26's. Rendering
	// `screen.hulls` rather than the placeholder unconditionally means the day
	// that node prices them the tab shows them instead of still saying nobody
	// has.
	const hulls = screen.hullsSection
		? `<h4 class="sg-block-head" data-gallery-hulls>HULLS</h4>${
				screen.hulls.length === 0
					? `<p class="sg-absent" data-gallery-hulls-empty>Not priced yet — the ship roster owes them.</p>`
					: screen.hulls
							.map((hull) =>
								catalogueRow(
									"data-gallery-hull-item",
									hull.name,
									`${hull.priceCr.toLocaleString("en-US")} Cr`,
								),
							)
							.join("")
			}`
		: "";
	return `<div class="sg-market" data-gallery-equipment>${available}<h4 class="sg-block-head" data-gallery-unavailable>UNAVAILABLE HERE</h4>${unavailable}${hulls}</div>`;
}

/**
 * **M2:** while docked, the canopy opening carries the console.
 *
 * Returns nothing at all during the arrival — M4, and §8.6's obligation 11 is
 * asserted *during* those seconds rather than after them, because a build that
 * never delayed would satisfy an end-state check.
 */
export function renderStationConsole(view: ConsoleView): string {
	if (!stationConsoleVisible(view.phase)) return "";
	const tabs = CONSOLE_TABS.map(
		(tab) =>
			`<button class="sg-tab" type="button" data-gallery-console-tab="${esc(tab)}" aria-selected="${view.tab === tab}">${tab}</button>`,
	).join("");
	return `<section class="sg-station-console" data-gallery-station-console data-gallery-console-station="${esc(view.station.id)}" data-gallery-console-active-tab="${esc(view.tab)}"><header class="sg-console-top"><h2>STATION</h2><small>${esc(view.station.label)}</small></header><nav class="sg-tabs" aria-label="Station console tabs">${tabs}</nav>${view.tab === "Market" ? renderMarketTab(view) : renderEquipmentTab(view)}</section>`;
}

export function galleryState(id: string | null): GalleryState {
	return GALLERY_STATES.find((state) => state.id === id) ?? GALLERY_STATES[0];
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

type CockpitScene = {
	detach(): void;
	attach(stage: HTMLElement, headLook: HeadLook): void;
	dispose(): void;
};

/** A self-contained rendered cockpit, kept separate from the game scene. */
function mountCockpit3D(stage: HTMLElement, headLook: HeadLook): CockpitScene {
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
		attach(nextStage, nextHeadLook) {
			mountedStage = nextStage;
			mountedStage.prepend(canvas);
			resizeObserver.observe(mountedStage);
			currentHeadLook = nextHeadLook;
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
.sg-floor { position: absolute; z-index: 6; left: 14px; right: 14px; bottom: 14px; display: flex; justify-content: space-between; gap: 12px; padding: 9px; border: 1px solid #355369; background: rgba(3, 14, 23, .94); color: #9fd4ff; font-size: 11px; }
.sg-floor strong { color: #ffe0a2; font-weight: 600; }
.sg-note { margin: 0; color: #b4c8d4; }
/* §8's station console. It fills the canopy opening rather than floating over
   it: M4 declined a translucent console on contrast, and the arrival it waits
   for is the last thing the forward wall showed. */
.sg-glass-docked { z-index: 3; inset: 10px 40px 8px; display: flex; align-items: stretch; clip-path: none; }
.sg-station-console { display: flex; flex-direction: column; width: 100%; overflow: hidden; padding: 14px 18px; border: 1px solid rgba(229, 170, 82, .88); background: linear-gradient(104deg, rgba(46, 18, 5, .96), rgba(12, 8, 5, .96) 62%, rgba(6, 9, 12, .95)); box-shadow: inset 0 0 68px rgba(231, 123, 31, .16); color: #ffd48c; }
.sg-cockpit[data-gallery-head-look="left"] .sg-station-console,
.sg-cockpit[data-gallery-head-look="right"] .sg-station-console { display: none; }
.sg-market { flex: 1; overflow: auto; margin-top: 8px; padding-right: 6px; }
.sg-market-row { display: grid; grid-template-columns: minmax(120px, 1.4fr) 1fr 1fr; gap: 10px; align-items: baseline; padding: 2px; border-bottom: 1px solid rgba(229, 170, 82, .22); font-size: 11px; }
.sg-station-console h2 { margin: 0; color: #ffe1a9; font-size: 18px; letter-spacing: .1em; }
.sg-market-head { color: #d8833b; border-bottom-width: 2px; letter-spacing: .08em; position: sticky; top: 0; background: #150a03; }
.sg-good { color: #fff0c9; }
.sg-cell { display: flex; justify-content: flex-start; gap: 8px; color: #f5bd78; }
.sg-delta { color: #ffe0a2; font-style: normal; }
.sg-absent { color: #a97a4a; }
.sg-illegal { margin-left: 6px; color: #ff9c8e; }
.sg-block-head { margin: 12px 0 4px; color: #ffb066; font-size: 11px; letter-spacing: .1em; }
.sg-launch { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.sg-launch-button { border: 1px solid #ffe0a2; background: rgba(223, 122, 20, .28); color: #fff0c9; cursor: pointer; font: inherit; font-size: 13px; letter-spacing: .12em; padding: 8px 18px; }
.sg-console-list[data-gallery-inert] em { color: #a97a4a; }
.sg-arriving { position: absolute; inset: auto 0 40% 0; margin: 0; color: #ffe0a2; font-size: 15px; letter-spacing: .3em; text-align: center; }
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
	/* The docked exception. The narrow rule drops the side console's list to
	   make room, which is right for the flying states — but docked, that list is
	   the INERT readout M9 puts beside the launch control, and dropping it
	   leaves LAUNCH on a console saying nothing about why it is the only live
	   thing on it. */
	.sg-console-list[data-gallery-inert] { display: grid; }
	.sg-glass { inset: 18px 12px 0; min-height: 480px; clip-path: none; }
	/* The docked glass is a table, not a window: it fits the cockpit shell and
	   scrolls its own rows, rather than growing the page under it. */
	.sg-glass-docked { inset: 12px 10px 12px; min-height: 0; }
	.sg-station-console { padding: 10px 12px; }
	.sg-market-row { grid-template-columns: minmax(90px, 1.3fr) 1fr .8fr; gap: 6px; font-size: 10px; }
	.sg-scanner { width: min(330px, calc(100% - 24px)); bottom: 65px; }
	.sg-floor { bottom: 12px; font-size: 10px; flex-direction: column; gap: 3px; }
}
`;

/**
 * Which flight state the gallery shows after a launch.
 *
 * **Arbitrary, and named so that it reads as arbitrary.** A real cockpit
 * resumes the flight it suspended; the gallery has six unrelated states and no
 * memory of which one preceded a dock, so it picks the quiet one. The live
 * cockpit should not inherit this — `docking.md` §12.2 says flight resumes, not
 * that it resets.
 */
const LAUNCH_RETURNS_TO = "assist-on";

/** M9's one live control while docked. */
const LAUNCH_CONTROL =
	'<div class="sg-launch"><button class="sg-launch-button" type="button" data-gallery-launch>LAUNCH</button><small>The one live control on this console while docked.</small></div>';

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
	dockedFlight = false,
	inertReadouts = false,
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
	/**
	 * **M9:** docked, the Flight console carries the launch control. Only that
	 * console and only that control — launching is flight, and §1 gives Flight
	 * to the right panel.
	 */
	dockedFlight?: boolean;
	/**
	 * **E5:** docked, this console's readouts are inert on every one of its
	 * tabs, because flight is suspended and not merely unavailable from one of
	 * them. Separate from `dockedFlight` because the two really are different
	 * conditions — an earlier round collapsed them and left the Drive tab saying
	 * THROTTLE INERT with no attribute on it.
	 *
	 * The attribute is what a probe reads; the value column reading INERT,
	 * dimmed against the live rows, is what a player reads.
	 */
	inertReadouts?: boolean;
}): string {
	return `<aside class="sg-panel" data-gallery-panel="${side}" data-active="${active}"><header class="sg-console-top"><h2>${title}</h2><small>${subtitle}</small></header><nav class="sg-tabs" aria-label="${side} console tabs">${tabs}</nav><div class="sg-console-layout"><div class="sg-console-rail">${rail.map((item, index) => (index === 0 ? `<b>${item}</b>` : `<span>${item}</span>`)).join("")}</div><div class="sg-console-data"><h3>${heading}</h3><p ${title === "TUNING" ? "data-gallery-tuning" : ""}>${body}</p><div class="sg-console-list"${inertReadouts ? " data-gallery-inert" : ""}>${list.map(([label, value]) => `<span><b>${label}</b><em>${value}</em></span>`).join("")}</div></div></div>${dockedFlight ? LAUNCH_CONTROL : ""}<small>${footer}</small></aside>`;
}

/**
 * The flying canopy: §5's director, compact scanner and persistent floor.
 *
 * Unchanged from what the six flight states have always rendered — it is a
 * function now only so the docked branch beside it is a name rather than a
 * second kilobyte on one line.
 */
function renderFlightGlass(state: GalleryState): string {
	return `<main class="sg-glass" aria-live="polite"><div class="sg-stars"></div><div class="sg-dash-deck" aria-hidden="true"></div><div class="sg-director" data-gallery-director data-accent="${state.accent}">${state.targetBearingDeg === undefined ? "" : `<i class="sg-target-arrow" data-gallery-target-arrow data-gallery-target-bearing="${state.targetBearingDeg}" style="--target-bearing:${state.targetBearingDeg}deg" aria-label="turn toward target bearing">➤</i>`}${state.director}${state.id.startsWith("docking-") ? `<div class="sg-docking" data-gallery-docking>AXIS FUNNEL · ROLL RING · ${state.id === "docking-granted" ? "CLEAR TO APPROACH" : "DO NOT ENTER"}</div>` : ""}</div><div class="sg-scanner" data-gallery-scanner aria-label="Local radar, 10,000 kilometre vicinity"><i class="sg-contact one" data-gallery-contact-stem></i><i class="sg-contact-anchor one" data-gallery-contact-anchor></i><i class="sg-contact two" data-gallery-contact-stem></i><i class="sg-contact-anchor two" data-gallery-contact-anchor></i><i class="sg-contact three" data-gallery-contact-stem></i><i class="sg-contact-anchor three" data-gallery-contact-anchor></i></div><div class="sg-floor" data-gallery-floor><span>${state.mode}</span><strong>${state.target}</strong></div></main>`;
}

/**
 * The docked gallery's own chrome: which station is quoted, and the two
 * controls that exist for the probe rather than for a player.
 *
 * **Deliberately outside the console.** M7 keeps the epoch off the market tab,
 * and a clock control on the tab would be the countdown that decision refuses.
 */
function renderConsoleRig(view: ConsoleView): string {
	return `<nav class="sg-states" aria-label="Console rig">${CONSOLE_STATIONS.map((candidate) => `<button class="sg-state" type="button" data-gallery-station="${esc(candidate.id)}" aria-pressed="${candidate.id === view.station.id}">${esc(candidate.label)}</button>`).join("")}<button class="sg-state" type="button" data-gallery-advance-clock>advance the clock past a market roll</button><button class="sg-state" type="button" data-gallery-redock>re-dock (replay the arrival)</button></nav>`;
}

/** M2's canopy: the station console, and nothing else. During the arrival it
 *  is the throat's payoff still running — M4, so the console is not there. */
function renderDockedGlass(view: ConsoleView): string {
	// No `aria-live` on the console. The flying glass has it because its live
	// content is one director line; here it would re-announce all seventeen rows
	// on every tab and station change. The arrival notice keeps it, being the
	// one thing on this wall that appears without the player acting.
	return `<main class="sg-glass sg-glass-docked">${renderStationConsole(view)}${view.phase === "arriving" ? `<p class="sg-arriving" data-gallery-arriving aria-live="polite">ARRIVING</p>` : ""}</main>`;
}

export function renderGalleryState(
	state: GalleryState,
	rightTab: RightTab,
	headLook: HeadLook = "forward",
	view: ConsoleView = DEFAULT_CONSOLE_VIEW,
): string {
	const isLeft = headLook === "left";
	const isRight = headLook === "right";
	const docked = state.id === "docked";
	// M4 and M10 as one value the markup obeys, rather than two `state.id`
	// tests beside two predicates nothing calls. Sage's round 1 found the
	// headless M10 check green against a renderer that could not fail it.
	const phase: DockPhase = docked ? view.phase : "flying";
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
	// M9: launching is flight, and §1 gives Flight to the right panel. The
	// console is otherwise inert while docked and says so.
	const flightDocked = docked && rightTab === "Flight";
	const rightConsole = renderConsolePanel({
		side: "right",
		active: isRight,
		dockedFlight: flightDocked,
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
		// `docked`, not `flightDocked`: E5 suspends flight, so the right console's
		// readouts are inert whichever of its three tabs is up. Only the *launch
		// control* is Flight's, which is what M9 places.
		inertReadouts: docked,
		list: docked
			? [
					["THROTTLE", "INERT"],
					["ASSIST", "INERT"],
					["FUEL", "92%"],
				]
			: [
					["THROTTLE", "62%"],
					["HEAT", "18%"],
					["FUEL", "92%"],
				],
		footer:
			"Tuning stays on this right-console tab, never on the flight floor.",
	});
	return `<div class="sg-wrap" data-gallery-state-active="${state.id}" data-gallery-dock-phase="${phase}" data-gallery-clock-min="${view.gameTimeMin}" data-gallery-market-epoch="${marketEpoch(view.station.station.phaseMin, view.gameTimeMin)}">
		<header class="sg-head"><div><h1>SEELITE · COCKPIT STATE GALLERY</h1><p>Issue #34 prototype — visual contract, not simulated docking.</p></div><div class="sg-head-actions"><nav class="sg-look" aria-label="Cockpit head direction">${(["left", "forward", "right"] as HeadLook[]).map((look) => `<button type="button" data-gallery-look="${look}" aria-pressed="${headLook === look}">look ${look}</button>`).join("")}</nav><button class="sg-close" type="button">return to flight</button></div></header>
		${docked ? renderConsoleRig(view) : ""}
		<nav class="sg-states" aria-label="Cockpit states">${GALLERY_STATES.map((candidate) => `<button class="sg-state" type="button" data-gallery-state="${candidate.id}" aria-pressed="${candidate.id === state.id}">${candidate.label}</button>`).join("")}</nav>
		<div class="sg-shell" data-gallery-3d-prototype>
			<div class="sg-cockpit" data-gallery-cockpit data-gallery-head-look="${headLook}" data-gallery-physical-console="${headLook}"><div class="sg-canopy" aria-hidden="true"></div>
			${leftConsole}
			${flightFloorVisible(phase) ? renderFlightGlass(state) : renderDockedGlass(view)}
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
	let view: ConsoleView = { ...DEFAULT_CONSOLE_VIEW };
	let arrivalTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * M4's sequence, run rather than described: entering the docked state starts
	 * an arrival, and the console appears only when it finishes. §8.6's
	 * obligation 11 is asserted inside these seconds, so a build that skipped
	 * them would pass an end-state check and fail this one.
	 */
	const beginArrival = () => {
		if (arrivalTimer !== null) clearTimeout(arrivalTimer);
		view = { ...view, phase: "arriving" };
		arrivalTimer = setTimeout(() => {
			arrivalTimer = null;
			view = { ...view, phase: "docked" };
			paint();
		}, GALLERY_ARRIVAL_SECONDS * 1000);
	};
	/**
	 * The docked console's controls. Returns whether it handled the click, so
	 * the listener stays one dispatch rather than growing a block per control.
	 */
	const handleConsoleClick = (target: HTMLElement): boolean => {
		const tabButton = target.closest<HTMLElement>("[data-gallery-console-tab]");
		if (tabButton) {
			// Validated, not cast. The value comes off the DOM and ends up back in
			// `innerHTML`; `as StationConsoleTab` asserted a shape nothing checked.
			const picked = CONSOLE_TABS.find(
				(candidate) => candidate === tabButton.dataset.galleryConsoleTab,
			);
			// `Boolean`, not an unconditional `true`: the ids are authored by the
			// same module that renders the buttons, so a miss is a bug, and
			// swallowing the click hides it behind a button that does nothing.
			if (picked) {
				view = { ...view, tab: picked };
				paint();
			}
			return Boolean(picked);
		}
		const stationButton = target.closest<HTMLElement>("[data-gallery-station]");
		if (stationButton) {
			const picked = CONSOLE_STATIONS.find(
				(candidate) => candidate.id === stationButton.dataset.galleryStation,
			);
			if (picked) {
				view = { ...view, station: picked };
				paint();
			}
			return Boolean(picked);
		}
		if (target.closest("[data-gallery-advance-clock]")) {
			// M7: the clock moves, and the market tab never says so. The control is
			// gallery chrome, deliberately outside the console it advances.
			view = { ...view, gameTimeMin: view.gameTimeMin + MARKET_PERIOD_MIN };
			paint();
			return true;
		}
		if (target.closest("[data-gallery-redock]")) {
			// Replays M4's sequence on demand. Without it the only arrival in the
			// gallery is the one that runs during page load, and a check written
			// against it races the load rather than measuring the decision.
			beginArrival();
			paint();
			return true;
		}
		if (target.closest("[data-gallery-launch]")) {
			// M9's control, doing what §12.2 says it leads to: flight resumes and
			// the flying cockpit comes back. The *motion* between the two is #77's
			// and the gallery has none of it — this is the state change only.
			headLook = "forward";
			setState(LAUNCH_RETURNS_TO);
			return true;
		}
		return false;
	};
	const paint = () => {
		cockpitScene?.detach();
		root.innerHTML = renderGalleryState(current, rightTab, headLook, view);
		const cockpit = root.querySelector<HTMLElement>("[data-gallery-cockpit]");
		if (!cockpit) return;
		if (cockpitScene) cockpitScene.attach(cockpit, headLook);
		else cockpitScene = mountCockpit3D(cockpit, headLook);
	};
	const setState = (id: string) => {
		current = galleryState(id);
		rightTab = current.panel === "Drive" ? "Drive" : "Flight";
		if (current.id === "docked") beginArrival();
		else if (arrivalTimer !== null) {
			clearTimeout(arrivalTimer);
			arrivalTimer = null;
		}
		paint();
	};
	if (current.id === "docked") beginArrival();
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
		if (handleConsoleClick(target)) return;
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
			if (arrivalTimer !== null) clearTimeout(arrivalTimer);
			cockpitScene?.dispose();
			const flightUrl = new URL(window.location.href);
			flightUrl.searchParams.delete("hud-gallery");
			window.location.assign(flightUrl);
			return;
		}
	});
}
