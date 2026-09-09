/**
 * The galaxy map — node #11's chart, node #96's mount.
 *
 * `mountGalaxyChart` draws one galaxy's 256 systems as a freely orbitable cluster,
 * with the 7 LY shell around the current system, a derived route to whatever is
 * selected, and the core haze on a toggle so the two treatments of the density
 * gradient can be compared side by side rather than argued about.
 *
 * **This is a chart, not a console.** #70 ratified that every screen lives in
 * the cockpit and `hud-and-scanner.md` §2 gives system-scale discovery to the
 * left Navigation console, so the shipped map is a Navigation tab reached by a
 * head turn — `live-cockpit.ts` hands up a host element and `main.ts` mounts
 * this into it. What this module owns is the *chart surface* — the projection,
 * the shell, the drop-lines, the record card.
 *
 * `?galaxy-map` mounts the same function full-page. Two mounts, one
 * implementation — but **not one measurement**. Crowding is a pixel property
 * (the projection, the viewport and `PICK_RADIUS_PX`), so §5.1's 40.2% is a
 * fact about the workbench's whole page and not about a chart in a console
 * cell. The cell is smaller, which can only pack the points tighter: measured
 * separately at the shipped framing it is 68.8%, and
 * `probe-navigation-console.mjs` bands it there rather than inheriting the
 * table.
 *
 * Nothing here computes a route. `galaxy-route.ts` does, and it imports no
 * Three.js: the chart draws what the arithmetic returns, and a probe that wants
 * to check a chain reads it from there rather than from a line's vertices.
 */
import * as THREE from "three";
import {
	GALAXY_COUNT,
	GALAXY_FLATTENING_Q,
	GALAXY_RADIUS_LY,
	JUMP_RANGE_LY,
	SYSTEMS_PER_GALAXY,
	type Galaxy,
	type SystemRecord,
	CORE_RADIUS_LY,
	ECONOMY_NAMES,
	GOVERNMENT_NAMES,
	distanceLy,
	generateGalaxy,
	startSystem,
} from "./galaxy";
import { type FinderPanelState, mountFinderPanel } from "./galaxy-finder-panel";
import type { FinderKnowledge } from "./galaxy-finder";
import { carrierKey } from "./carrier-key";
import { generateContents } from "./system";
import {
	type Course,
	type CourseProgress,
	type Route,
	courseProgress,
	planRoute,
	reachable,
	setCourse,
} from "./galaxy-route";
import { type HoverRule, clickTarget, hoverCandidate } from "./hover-candidate";

/**
 * The map's vertical axis is galaxy-space **y**, and its reference plane is
 * `y = 0`.
 *
 * The choice is arbitrary and is stated because it is: `systemPosition` draws
 * an isotropic direction, so the cluster has no intrinsic equator and any axis
 * would look the same. What matters is that the *same* axis is used by the
 * plane, the drop-lines and the anchor discs — a plane on one axis and a mast
 * on another would draw a depth cue that means nothing.
 */
const UP = new THREE.Vector3(0, 1, 0);

/** One LY is one world unit. The cluster is 44 units across, which keeps the
 *  camera's near/far plane arithmetic trivial and lets a probe read a radius
 *  off the scene and compare it to `GALAXY_RADIUS_LY` without a factor. */
const CAMERA_START_LY = 62;
/** The default framing. Named rather than inlined because `galaxy-map.md`
 *  §5.1's crowding table is measured at exactly this view, and a figure quoted
 *  from an unnamed orientation is not reproducible. */
const DEFAULT_YAW = 0.6;
/**
 * 40°, up from the ball's 20° (#118).
 *
 * **Chosen on legibility, not on the crowding it buys.** Measured across the
 * whole clamp — 52.6% at 20° down to 46.3% at 83°, on the desktop framing — the
 * entire range is worth **6 points**, trending toward face-on and never
 * reaching the ball at *any* of its own angles (41.3-43.1% across the same
 * clamp). So pitch is a trim, not a remedy, and no angle recovers what the disc
 * cost — `bun scripts/measure-galaxy-shape.ts grid` is the q x pitch table
 * behind that. What 40° buys is
 * that the disc reads as one: face-on you see a circle and cannot tell it is
 * flat, which spends the reason #107 took the disc at all, and edge-on you lose
 * the cluster's extent. 40° shows the ellipse and the thickness together, and
 * sits well inside the ±1.45 clamp.
 *
 * Re-measure with `bun scripts/measure-galaxy-shape.ts pitch`.
 */
const DEFAULT_PITCH = 0.7;
const CAMERA_MIN_LY = 12;
const CAMERA_MAX_LY = 140;

/** §4 of `hud-and-scanner.md`: cool cyan for passive instrumentation, amber for
 *  the selected target, green for a confirmed state. The chart is a fourth
 *  surface speaking that language, not a fourth palette. */
const COLOUR = {
	dim: new THREE.Color(0x2f4a63),
	lit: new THREE.Color(0x58c6ff),
	current: new THREE.Color(0x67e08a),
	selected: new THREE.Color(0xffb347),
	plane: 0x1d2c3a,
	shell: 0x58c6ff,
	route: 0xffb347,
	drop: 0x7fa8c4,
};

/** Big enough to pick reliably under a mouse, small enough that the core is not
 *  a single blob. Screen-space picking uses this as its radius in pixels. */
const PICK_RADIUS_PX = 14;

/**
 * #108's D1: the hover label's stickiness, set against the pick radius above.
 *
 * The label holds the system it named while that system stays inside
 * `releaseRadiusPx`, and lets a rival take it only when the rival is nearer by
 * more than `switchMarginPx`. Both halves are needed and they answer different
 * failures — the release radius stops the label blinking off at exactly 14 px
 * as the cursor drifts, the margin stops two systems a pixel apart trading it
 * on sub-pixel movement. §5.1 measures 68.4%-77.7% of hovers in the shipped
 * console cell as having such a neighbour.
 *
 * **First values, not measured ones**, chosen against the 14 px pick radius and
 * recorded as retunable by #108's receipt. The browser tier pins the
 * behaviour rather than these numbers, so a retune moves them without moving a
 * check. The rule itself is `hover-candidate.ts`, which is a leaf and has its
 * own headless test.
 */
const HOVER_RULE: HoverRule = {
	pickRadiusPx: PICK_RADIUS_PX,
	releaseRadiusPx: 20,
	switchMarginPx: 3,
};

export interface GalaxyMapState {
	galaxy: number;
	systemCount: number;
	currentIndex: number;
	selectedIndex: number | null;
	/** Indices inside the 7 LY shell, nearest first — the lit points. */
	litIndices: number[];
	/** D2: drop-lines exist for the current system and the selection, and for
	 *  nothing else. Two segments when something is selected, one when not. */
	dropLineCount: number;
	haze: boolean;
	jumpRangeLy: number;
	galaxyRadiusLy: number;
	coreRadiusLy: number;
	/** The oblate-spheroid ratio of §2 — the cluster reaches `galaxyRadiusLy`
	 *  across and `flatteningQ x galaxyRadiusLy` through the reference plane.
	 *  Exposed so a probe can *measure* the disc rather than restate the
	 *  constant it is checking. */
	flatteningQ: number;
	/** Radians. Exposed with `flatteningQ` because the disc's projected aspect
	 *  is only interpretable against the angle it was seen from. */
	pitch: number;
	/** Radians. With `pitch`, `cameraDistanceLy` and `focusIndex` this is the
	 *  whole camera pose — which is what #115's D2 check compares across a row
	 *  click. A pose missing a component is one a broken build can move without
	 *  the check noticing. */
	yaw: number;
	cameraDistanceLy: number;
	/** The system the cluster is centred on, or `null` for the galaxy centre.
	 *  Only the per-row centre control changes it. */
	focusIndex: number | null;
	route: {
		jumps: number;
		totalLy: number;
		totalCr: number;
		hopIndices: number[];
	} | null;
	course: Course | null;
	courseRemaining: number | null;
	record: {
		name: string;
		economy: string;
		government: string;
		displayTL: number;
		population: number;
		distanceLy: number;
	} | null;
	/**
	 * The finder, as the panel currently shows it.
	 *
	 * `expanded` is read off the same rule the layout is (`finderIsNarrowed`),
	 * so a probe cannot be told the panel is open by a field the drawing does
	 * not agree with. The two lists are the rows themselves rather than counts,
	 * because D7's check is about *which* systems landed in which group.
	 */
	finder: FinderPanelState;
}

export interface Handle {
	state: GalaxyMapState;
	select(index: number | null): void;
	commitCourse(): boolean;
	clearCourse(): void;
	/**
	 * What the chart's own **Clear** button does — the course *and* the
	 * selection.
	 *
	 * Separate from `clearCourse`, which drops the course alone and has its own
	 * callers. #283's pad reaches the button through this handle and reproduced
	 * the pair by hand, dropping only the course; a named action is what stops
	 * one control behaving differently depending on which device pressed it.
	 */
	clearAll(): void;
	/** Step the finder's jump budget by `delta`, as its `−`/`+` buttons do. */
	stepFinderBudget(delta: number): void;
	setHaze(on: boolean): void;
	/** Move the ship, so a probe can watch the course re-derive from a new
	 *  origin rather than trusting that it would. */
	jumpTo(index: number): void;
	orbit(dxPx: number, dyPx: number): void;
	zoom(deltaLy: number): void;
	/** Type a name into the finder's field, as the player would. */
	setFinderQuery(query: string): void;
	/** Click one economy chip. */
	toggleFinderEconomy(economy: number): void;
	/** Step the jump budget to a value. */
	setFinderBudget(jumps: number): void;
	/** D2's per-row centre control: move the camera and nothing else. `null`
	 *  returns the centre of rotation to the galaxy's own. */
	centreOn(index: number | null): void;
	/** Back to the documented default framing — yaw, pitch, distance and focus.
	 *  Crowding depends on the orientation as well as the distance, so a
	 *  figure quoted in the spec is only reproducible from a known view. */
	resetView(): void;
	/**
	 * Every system's position in **canvas-relative** pixels, under the current
	 * camera. Add `viewport().left`/`top` for client coordinates.
	 *
	 * Exposed because it is the one thing about this chart a headless test
	 * cannot reach and a probe must not restate: whether the projection
	 * actually *separates* 256 systems in a 3:1-concentrated ball is the
	 * whole risk in choosing a free orbit, and it is a fact about the camera
	 * and the viewport rather than about the generator. A probe that computed
	 * it from `pos` would be checking its own arithmetic.
	 */
	projected(): {
		index: number;
		x: number;
		y: number;
		behind: boolean;
		/** NDC depth. `behind` is `depth > 1`; a point with `depth < -1` is in
		 *  front of the near plane and is clipped just as invisibly, which
		 *  `behind` alone does not say. A probe deciding what is *drawn* needs
		 *  both ends. */
		depth: number;
	}[];
	/** The canvas's box in CSS pixels. A probe measuring crowding has to discard
	 *  systems projected *outside* the viewport as well as behind the camera,
	 *  and the drawn box is the module's fact, not the window's. */
	viewport(): { width: number; height: number; left: number; top: number };
	/** The pick radius the chart itself uses, so a probe measuring crowding
	 *  compares against the module's number rather than a copy of it. */
	pickRadiusPx: number;
	/**
	 * The hover label's own state — #108's D1, as state rather than as text.
	 *
	 * `null` when nothing is labelled, which is also what a touch pointer and a
	 * suppressed drag both read as. `contested` is the badge's number: systems
	 * inside the **pick** radius other than the labelled one — how many systems
	 * the cursor cannot tell apart at this position, which is not the same as
	 * how ambiguous the click is (§5.3: since D1 the click is deterministic).
	 *
	 * Exposed instead of leaving a probe to scrape the label's text for an
	 * index. The text is a separate claim and is asserted as text; a name
	 * parsed back into an index would make one check stand for both, and the
	 * chart's names are not unique per galaxy in any way this module enforces.
	 */
	hovered(): { index: number; contested: number } | null;
}

/** A radial gradient, generated rather than downloaded — the core haze's only
 *  texture. Falls off on the density profile's own shape, `1/(1+(r/r_c)²)`,
 *  so the glow is the function `galaxy-generation.md` §3 specifies and not a
 *  hand-tuned blur that merely looks like it. */
function hazeTexture(): THREE.Texture {
	const size = 256;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (ctx === null) throw new Error("galaxy-map: no 2D context for the haze");
	const image = ctx.createImageData(size, size);
	const half = size / 2;
	// The sprite spans 2·GALAXY_RADIUS_LY, so one pixel is that over `size`.
	const lyPerPx = (2 * GALAXY_RADIUS_LY) / size;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = (x - half) * lyPerPx;
			const dy = (y - half) * lyPerPx;
			const r = Math.hypot(dx, dy);
			const rho = 1 / (1 + (r / CORE_RADIUS_LY) ** 2);
			// Zero outside the cluster: a haze that reaches past the rim would
			// draw geography where the generator places no systems.
			const edge = r > GALAXY_RADIUS_LY ? 0 : 1 - r / GALAXY_RADIUS_LY;
			const a = Math.round(255 * rho * edge * 0.55);
			const o = (y * size + x) * 4;
			image.data[o] = 0x4a;
			image.data[o + 1] = 0x8c;
			image.data[o + 2] = 0xd8;
			image.data[o + 3] = a;
		}
	}
	ctx.putImageData(image, 0, 0);
	const texture = new THREE.CanvasTexture(canvas);
	texture.needsUpdate = true;
	return texture;
}

const el = <K extends keyof HTMLElementTagNameMap>(
	tag: K,
): HTMLElementTagNameMap[K] => document.createElement(tag);

export interface GalaxyChartOptions {
	/** The element the chart draws into. Its own root is removed from that
	 *  element on `dispose`; anything else the host holds is untouched. */
	host: HTMLElement;
	worldSeed: number;
	galaxyIndex: number;
	/** Where the ship is. Defaults to the galaxy's own start system. */
	currentIndex?: number;
	/** Read-only last-known station intelligence; mounting never writes it.
	 *  Opening the map is not an information channel (§5.2.1). */
	knowledge?: FinderKnowledge;
	/** The world clock. Read on every render, so an age and an overdue
	 *  recovery are current rather than frozen at mount. */
	now?: () => number;
	/**
	 * Bind `h` and `Escape` on `window`. Default off.
	 *
	 * The workbench owns its whole page, so a window-level shortcut there is
	 * unambiguous. Inside the cockpit it is not: flight controls are live while
	 * the panel is open (`hud-and-scanner.md` §1), so both handlers would see
	 * the same key the day the game binds either — silently, since neither
	 * would error. The tab therefore leaves them off; the haze and clear
	 * controls are on-screen buttons, so nothing is unreachable without them.
	 */
	globalKeys?: boolean;
	/**
	 * The course the ship is already on, if any (#187).
	 *
	 * The chart used to be the only holder of a course, so closing the
	 * Navigation tab threw one away — the chart is disposed on every toggle.
	 * The game owns it now and hands it back on mount, which is
	 * `persistent-world-state.md` §8's rule applied to a UI lifetime rather than
	 * to a save: the intent is the thing, and the chain is re-derived here.
	 */
	course?: Course | null;
	/** Committed or cleared, so the owner can hold it across a remount and jump
	 *  along it (#187). */
	onCourse?: (course: Course | null) => void;
}

/**
 * A mounted chart, and the means to take it down again.
 *
 * `dispose` is the half that makes this hostable at all. As a workbench the
 * chart never stopped — one page, one loop, one lifetime — and a Navigation tab
 * that mounted it the same way would leave a WebGL context and a 60 Hz render
 * loop running behind the flight view for the rest of the session, every time
 * the player looked at the map.
 */
export interface GalaxyChart {
	handle: Handle;
	dispose(): void;
}

/**
 * Mount the chart into a supplied element.
 *
 * The shipped surface is a tab on the left Navigation console
 * (`galaxy-map.md` §1) and `?galaxy-map` is a workbench onto the same code.
 * Two mounts of one implementation rather than two implementations: a
 * projection that behaved differently in the cockpit from the surface its
 * crowding table was measured on would make the table a claim about nothing.
 */
export function mountGalaxyChart({
	host,
	worldSeed,
	galaxyIndex,
	currentIndex,
	knowledge = {},
	now = () => 0,
	globalKeys = false,
	course: initialCourse = null,
	onCourse,
}: GalaxyChartOptions): GalaxyChart {
	const galaxy: Galaxy = generateGalaxy(worldSeed, galaxyIndex);

	/**
	 * A system by its `index`, not by its array position.
	 *
	 * `generateGalaxy` builds the array in index order, so the two agree today —
	 * but `galaxy-route.ts` keeps them apart on purpose (`slot.set(pool[i].index,
	 * i)`), and the one caller that is *not* under this module's control is a
	 * `Course` loaded from a save under #46: `parseCourse` validates
	 * `destinationIndex` against the range and not against a slot, so a
	 * positional read there is a `.name` of `undefined` waiting for a generator
	 * change. `tests/galaxy-route.test.ts` pins the invariant; this respects it
	 * rather than assuming it.
	 */
	const systemByIndex = (index: number): SystemRecord | null =>
		galaxy.systems.find((s) => s.index === index) ?? null;
	let current =
		(currentIndex === undefined ? null : systemByIndex(currentIndex)) ??
		startSystem(galaxy);
	let selected: SystemRecord | null = null;
	// Seeded from the owner (#187), so re-opening the Navigation tab shows the
	// course the ship is actually on rather than an empty chart.
	let course: Course | null = initialCourse;
	let route: Route | null = null;

	// ---- DOM ---------------------------------------------------------------

	const root = el("div");
	root.id = "galaxy-map";
	root.setAttribute("data-galaxy-map", String(galaxyIndex));
	Object.assign(root.style, {
		// `absolute`, not `fixed`: in the Navigation tab the host is a grid cell
		// inside the console, and a fixed root would break out of the panel and
		// cover the flight view the panel is explicitly not allowed to replace
		// (`hud-and-scanner.md` §1 — the game continues while the panel is open).
		position: "absolute",
		inset: "0",
		background: "#05080d",
		color: "#cfe6f5",
		font: "13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
		overflow: "hidden",
		display: "flex",
	});
	host.appendChild(root);

	/**
	 * The chart's own box — everything the canvas draws into, and nothing the
	 * finder occupies.
	 *
	 * The finder is **beside** the chart when it is open, not over it, and that
	 * is a measurement decision rather than a taste one. #86's D3 keeps the
	 * default-closed cell so `probe-navigation-console.mjs`'s crowding band
	 * still describes what is on screen; opening the panel narrows the cell,
	 * which is a different figure and owes its own measurement (#115's first
	 * obligation). An overlaid panel would have left the canvas box unchanged
	 * and made that obligation unfalsifiable — the probe would re-measure the
	 * number it already had.
	 */
	const stage = el("div");
	stage.setAttribute("data-map-stage", "");
	Object.assign(stage.style, {
		position: "relative",
		flex: "1 1 auto",
		minWidth: "0",
		height: "100%",
	});
	root.appendChild(stage);

	const canvas = el("canvas");
	Object.assign(canvas.style, {
		position: "absolute",
		inset: "0",
		width: "100%",
		height: "100%",
		display: "block",
		touchAction: "none",
	});
	stage.appendChild(canvas);

	const legend = el("div");
	legend.setAttribute("data-map-legend", "");
	Object.assign(legend.style, {
		position: "absolute",
		left: "16px",
		top: "16px",
		padding: "10px 12px",
		background: "rgba(6,12,20,0.78)",
		border: "1px solid #1d3247",
		borderRadius: "3px",
		pointerEvents: "none",
		whiteSpace: "pre",
	});
	stage.appendChild(legend);

	const controls = el("div");
	Object.assign(controls.style, {
		position: "absolute",
		left: "16px",
		bottom: "16px",
		display: "flex",
		gap: "8px",
	});
	stage.appendChild(controls);

	const button = (label: string, attr: string): HTMLButtonElement => {
		const b = el("button");
		b.textContent = label;
		b.setAttribute(attr, "");
		Object.assign(b.style, {
			font: "inherit",
			color: "#cfe6f5",
			background: "rgba(10,20,32,0.9)",
			border: "1px solid #26506e",
			borderRadius: "3px",
			padding: "6px 10px",
			cursor: "pointer",
		});
		controls.appendChild(b);
		return b;
	};

	const hazeButton = button("core haze: off", "data-map-haze");
	const courseButton = button("set course", "data-map-course");
	const clearButton = button("clear", "data-map-clear");

	/** D7: the record rides beside the selected point rather than living in a
	 *  fixed pane — "without leaving the map" read literally. It is positioned
	 *  each frame from the projected position of the selection. */
	const card = el("div");
	card.setAttribute("data-map-record", "");
	Object.assign(card.style, {
		position: "absolute",
		display: "none",
		padding: "9px 11px",
		background: "rgba(8,14,22,0.92)",
		border: "1px solid #6b4d1f",
		borderLeft: "2px solid #ffb347",
		borderRadius: "3px",
		pointerEvents: "none",
		maxWidth: "260px",
		whiteSpace: "pre-wrap",
	});
	stage.appendChild(card);

	/**
	 * #108's D3: the hover label, and it is **its own element with its own
	 * placement**.
	 *
	 * One placement rule serving two floating things stacks them by
	 * construction, so this shares `toPixels` — the module's single conversion —
	 * and nothing else with the card above. The offset is the mirror of the
	 * card's `+18 / -12`: the card sits right of and above its point, this sits
	 * left of and below, so a system that is both selected and hovered would not
	 * put the two on top of each other even if the suppression below were
	 * removed.
	 *
	 * `pointerEvents: none` because the label follows the cursor's own point: an
	 * element that could take the pointer would steal the `pointermove` that
	 * placed it and the label would fight itself.
	 */
	const hoverLabel = el("div");
	hoverLabel.setAttribute("data-map-hover", "");
	Object.assign(hoverLabel.style, {
		position: "absolute",
		display: "none",
		padding: "4px 7px",
		background: "rgba(8,14,22,0.92)",
		border: "1px solid #26506e",
		borderRadius: "3px",
		pointerEvents: "none",
		whiteSpace: "nowrap",
		color: "#cfe6f5",
	});
	stage.appendChild(hoverLabel);

	// ---- Scene -------------------------------------------------------------

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);

	/** The whole cluster hangs off one pivot, and the camera never moves off the
	 *  +z axis. Orbiting the pivot rather than flying the camera keeps the
	 *  projection a pure function of two angles, which is what makes a probe
	 *  able to assert where a point landed. */
	const pivot = new THREE.Group();
	scene.add(pivot);

	/**
	 * The cluster inside the pivot, so a *centre* is a translation and the
	 * orbit stays a pure function of two angles.
	 *
	 * D2's per-row centre control has to move the camera, and this chart has no
	 * camera to move: the camera sits on +z and the pivot spins under it, which
	 * is exactly what lets a probe assert where a point landed. Offsetting the
	 * cluster by −`focus` puts the chosen system at the centre of rotation, so
	 * orbiting after a centre turns around the thing that was centred rather
	 * than sliding it back off screen.
	 */
	const cluster = new THREE.Group();
	pivot.add(cluster);

	let yaw = DEFAULT_YAW;
	let pitch = DEFAULT_PITCH;
	let distance = CAMERA_START_LY;

	// Reference plane: a faint disc the drop-lines land on. Not a grid of
	// squares — a circle, because the cluster is one, and a square grid would
	// imply an extent the galaxy does not have.
	const planeGroup = new THREE.Group();
	for (let ring = 1; ring <= 3; ring++) {
		const r = (GALAXY_RADIUS_LY * ring) / 3;
		const pts: THREE.Vector3[] = [];
		for (let i = 0; i <= 96; i++) {
			const a = (i / 96) * Math.PI * 2;
			pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
		}
		planeGroup.add(
			new THREE.Line(
				new THREE.BufferGeometry().setFromPoints(pts),
				new THREE.LineBasicMaterial({
					color: COLOUR.plane,
					transparent: true,
					opacity: 0.85,
				}),
			),
		);
	}
	cluster.add(planeGroup);

	// The systems, as one Points cloud with per-vertex colour. 256 separate
	// meshes would be 256 draw calls for a chart that is one object.
	const positions = new Float32Array(galaxy.systems.length * 3);
	const colours = new Float32Array(galaxy.systems.length * 3);
	galaxy.systems.forEach((s, i) => {
		// (x, y, z) galaxy-space maps to (x, y, z) world-space, with y up — see
		// the note on UP. No axis swap, so a probe comparing a drawn position to
		// a record's `pos` compares the same three numbers.
		positions[i * 3] = s.pos.x;
		positions[i * 3 + 1] = s.pos.y;
		positions[i * 3 + 2] = s.pos.z;
	});
	const cloudGeometry = new THREE.BufferGeometry();
	cloudGeometry.setAttribute(
		"position",
		new THREE.BufferAttribute(positions, 3),
	);
	cloudGeometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
	const cloud = new THREE.Points(
		cloudGeometry,
		new THREE.PointsMaterial({
			size: 0.62,
			vertexColors: true,
			sizeAttenuation: true,
			transparent: true,
		}),
	);
	cluster.add(cloud);

	// D3: the reachability shell. Wireframe rather than a solid translucent
	// ball — a solid one at 7 LY around a point deep inside a 24.5 LY cluster
	// tints every system behind it, which is the one thing the chart must not
	// do to the points it is about.
	const shell = new THREE.LineSegments(
		new THREE.WireframeGeometry(
			new THREE.SphereGeometry(JUMP_RANGE_LY, 24, 16),
		),
		new THREE.LineBasicMaterial({
			color: COLOUR.shell,
			transparent: true,
			opacity: 0.16,
		}),
	);
	cluster.add(shell);

	// D2: drop-lines, and their anchor discs. One buffer, rewritten each time
	// the selection changes; the count is what the probe reads.
	const dropGeometry = new THREE.BufferGeometry();
	dropGeometry.setAttribute(
		"position",
		new THREE.BufferAttribute(new Float32Array(4 * 3), 3),
	);
	const drops = new THREE.LineSegments(
		dropGeometry,
		new THREE.LineBasicMaterial({
			color: COLOUR.drop,
			transparent: true,
			opacity: 0.7,
		}),
	);
	cluster.add(drops);

	const anchors = new THREE.Group();
	cluster.add(anchors);
	for (let i = 0; i < 2; i++) {
		const disc = new THREE.Mesh(
			new THREE.RingGeometry(0.35, 0.55, 24),
			new THREE.MeshBasicMaterial({
				color: i === 0 ? COLOUR.current : COLOUR.selected,
				transparent: true,
				opacity: 0.8,
				side: THREE.DoubleSide,
			}),
		);
		disc.rotation.x = -Math.PI / 2;
		disc.visible = false;
		anchors.add(disc);
	}

	// D5: the route, drawn only once one is planned.
	const routeGeometry = new THREE.BufferGeometry();
	// Sized to the whole galaxy, not to a guess at how long a chain gets. A
	// route cannot revisit a system, so `SYSTEMS_PER_GALAXY` points is the hard
	// ceiling — and the previous 64 had no bound check behind it: a longer chain
	// would have written past the end, which a typed array swallows silently,
	// and then drawn the surplus vertices at the origin.
	routeGeometry.setAttribute(
		"position",
		new THREE.BufferAttribute(new Float32Array(3 * SYSTEMS_PER_GALAXY), 3),
	);
	const routeLine = new THREE.Line(
		routeGeometry,
		new THREE.LineBasicMaterial({ color: COLOUR.route, transparent: true }),
	);
	routeLine.visible = false;
	cluster.add(routeLine);

	// D4: the haze, off by default so the two treatments start from the same
	// place and the comparison is a keystroke rather than a rebuild.
	const haze = new THREE.Sprite(
		new THREE.SpriteMaterial({
			map: hazeTexture(),
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		}),
	);
	haze.scale.setScalar(2 * GALAXY_RADIUS_LY);
	haze.visible = false;
	cluster.add(haze);

	// ---- Finder ------------------------------------------------------------

	/**
	 * The system the cluster is centred on, or null for the galaxy centre.
	 *
	 * Held as an index rather than as a vector so `state` can report *what* was
	 * centred, which is what makes the D2 check readable: a probe asserts the
	 * pose is unchanged across a row click and changed across a centre click,
	 * and a raw offset would leave it comparing three floats to say so.
	 */
	let focusIndex: number | null = null;

	/**
	 * Set by anything that changes the canvas box, cleared by the frame loop.
	 *
	 * Declared here rather than beside `resize` because opening the finder is
	 * one of those things, and a layout change that did not reach the renderer
	 * would leave the projection describing the box the canvas had before the
	 * panel took its column.
	 */
	let resizePending = true;

	/**
	 * Move the centre of rotation onto one system, or back to the galaxy's.
	 *
	 * The camera and nothing else (D2). Selection is untouched here on purpose:
	 * the row click that preceded this one already made it, and a centre that
	 * also selected would give one act two owners.
	 */
	const centreOn = (index: number | null): void => {
		const system = index === null ? null : systemByIndex(index);
		focusIndex = system?.index ?? null;
		if (system === null) cluster.position.set(0, 0, 0);
		else cluster.position.set(-system.pos.x, -system.pos.y, -system.pos.z);
	};

	/**
	 * The finder panel (#86, §5.2), mounted rather than built here.
	 *
	 * What the chart hands it is four callbacks and two readers, and what it
	 * hands back is a `render` and its state. The selection stays the chart's —
	 * `onSelect` goes through the same `select` a click on the canvas does, so
	 * there is one selection and not two that have to agree.
	 */
	const finder = mountFinderPanel({
		root,
		systems: galaxy.systems,
		knowledge,
		now,
		currentSystem: () => current,
		selectedIndex: () => selected?.index ?? null,
		onSelect: (index) => select(index),
		onCentre: (index) => centreOn(index),
		onLayoutChange: () => {
			resizePending = true;
		},
	});

	// ---- Derived state -----------------------------------------------------

	let lit: SystemRecord[] = [];
	let progress: CourseProgress | null = null;
	/** Hoisted out of `recompute` so the hover label's 7 LY marker and the lit
	 *  points' colour are one fact rather than two derivations of `JUMP_RANGE_LY`
	 *  that have to agree. A label reading "in range" over a dim point would be
	 *  the map's recurring two-implementations trap in miniature. */
	let litSet = new Set<number>();

	const recompute = (): void => {
		lit = reachable(galaxy.systems, current);
		litSet = new Set(lit.map((s) => s.index));

		galaxy.systems.forEach((s, i) => {
			const c =
				s.index === current.index
					? COLOUR.current
					: s.index === selected?.index
						? COLOUR.selected
						: litSet.has(s.index)
							? COLOUR.lit
							: COLOUR.dim;
			colours[i * 3] = c.r;
			colours[i * 3 + 1] = c.g;
			colours[i * 3 + 2] = c.b;
		});
		cloudGeometry.attributes.color.needsUpdate = true;

		shell.position.set(current.pos.x, current.pos.y, current.pos.z);

		// Drop-lines: current always, selection when there is one.
		const dp = dropGeometry.attributes.position.array as Float32Array;
		const marks = selected === null ? [current] : [current, selected];
		dp.fill(0);
		marks.forEach((s, i) => {
			dp[i * 6] = s.pos.x;
			dp[i * 6 + 1] = s.pos.y;
			dp[i * 6 + 2] = s.pos.z;
			dp[i * 6 + 3] = s.pos.x;
			dp[i * 6 + 4] = 0;
			dp[i * 6 + 5] = s.pos.z;
		});
		dropGeometry.attributes.position.needsUpdate = true;
		dropGeometry.setDrawRange(0, marks.length * 2);
		anchors.children.forEach((disc, i) => {
			const s = marks[i];
			disc.visible = s !== undefined;
			if (s !== undefined) disc.position.set(s.pos.x, 0, s.pos.z);
		});

		route =
			selected === null ? null : planRoute(galaxy.systems, current, selected);

		if (route !== null && route.jumps > 0) {
			const rp = routeGeometry.attributes.position.array as Float32Array;
			const chain = [current, ...route.hops.map((h) => h.system)];
			const capacity = routeGeometry.attributes.position.count;
			chain.slice(0, capacity).forEach((s, i) => {
				rp[i * 3] = s.pos.x;
				rp[i * 3 + 1] = s.pos.y;
				rp[i * 3 + 2] = s.pos.z;
			});
			routeGeometry.attributes.position.needsUpdate = true;
			routeGeometry.setDrawRange(
				0,
				Math.min(chain.length, routeGeometry.attributes.position.count),
			);
			routeLine.visible = true;
		} else {
			routeLine.visible = false;
		}

		// Computed once here and held, not re-derived by the state getter.
		// `courseProgress` runs `planRoute` — an O(n²) Dijkstra over 256
		// systems — so a getter that looks free was one full search per read,
		// and the probe reads `state` inside a 256-iteration loop.
		progress =
			course === null ? null : courseProgress(galaxy.systems, course, current);

		legend.textContent = [
			`galaxy ${galaxyIndex}  ·  seed 0x${worldSeed.toString(16)}`,
			`at ${current.name}  ·  ${lit.length} within ${JUMP_RANGE_LY} LY`,
			course === null
				? "no course set"
				: `course: ${systemByIndex(course.destinationIndex)?.name ?? "?"}` +
					`  ·  ${progress?.remaining ?? "?"} jump(s) left` +
					(progress?.nextHop
						? `  ·  next ${progress.nextHop.system.name}`
						: "  ·  arrived"),
			"drag orbit · wheel zoom · click select · H haze",
		].join("\n");

		finder.render();

		courseButton.disabled = selected === null || route === null;
		hazeButton.textContent = `core haze: ${haze.visible ? "on" : "off"}`;
		hazeButton.setAttribute("aria-pressed", String(haze.visible));

		if (selected === null) {
			card.style.display = "none";
		} else {
			const record = selected;
			// **The record does not depend on a route.** It is seed-derived and
			// always knowable, and §5 says clicking a system shows it. Gating
			// the whole card on `route !== null` made an unroutable selection
			// read as a dead click — a colour change and nothing else. Only the
			// chain line is conditional.
			card.style.display = "block";
			// §5.2.1's roster: every station, its exact observation time and
			// report source — the finder row carries the compact relative age,
			// and this is where the number behind it lives.
			const stations = generateContents(record).stations.map((station) => {
				const known =
					knowledge[carrierKey(record.index, station.localCarrierId)];
				const condition = known
					? `${known.observedCondition} · ${known.source} @ ${known.observedAt.toFixed(0)}s`
					: "STATUS UNKNOWN";
				// **A remembered schedule is never promoted.** §5.2.1: passing
				// `completesAt` moves the card from `DUE` to `OVERDUE` and
				// changes nothing else — both are `UNCONFIRMED`, because only a
				// relay or a docking report may say the repair finished. The
				// row above still reads `repairing` either way.
				const recovery = known?.observedRecovery;
				const schedule = !recovery
					? ""
					: now() >= recovery.completesAt
						? ` · OVERDUE · UNCONFIRMED`
						: ` · DUE ${recovery.completesAt.toFixed(0)}s · UNCONFIRMED`;
				const fence =
					station.type !== "refinery"
						? ""
						: known?.knownPrivateFacts?.blackMarket
							? ` · ${station.blackMarket ? "KNOWN FENCE" : "KNOWN NO FENCE"}`
							: " · FENCE UNCHECKED";
				return `${station.name} — ${station.type.toUpperCase()} · ${condition}${schedule}${fence}`;
			});
			card.textContent = [
				selected.name,
				`${ECONOMY_NAMES[selected.economy]} · ${GOVERNMENT_NAMES[selected.government]}`,
				`TL ${selected.displayTL} · pop ${(selected.population / 10).toFixed(1)} bn`,
				`${distanceLy(current.pos, selected.pos).toFixed(1)} LY direct`,
				route === null
					? "no route within range"
					: route.jumps === 0
						? "you are here"
						: `${route.jumps} jump(s) · ${route.totalLy.toFixed(1)} LY · ${route.totalCr.toFixed(0)} Cr`,
				"",
				...stations,
				"",
				selected.description,
			].join("\n");
		}

		// D3 suppresses the label over the *selected* system, so a selection
		// change is a label change even though the pointer has not moved.
		renderHover();
	};

	// ---- Interaction -------------------------------------------------------

	/**
	 * A system's position in **client pixels**, and whether it is behind the
	 * camera.
	 *
	 * The one conversion in this module. It was written out three times — in
	 * `pick`, in the card placement and in `projected()` — and three near-copies
	 * of one formula is how picking and drawing come to disagree: they must
	 * produce the same pixel or the chart selects a system other than the one
	 * under the cursor.
	 *
	 * `scratch` is reused rather than allocated. One click walks all 256
	 * systems, and `projected()` does the same on every probe call.
	 */
	const scratch = new THREE.Vector3();
	/**
	 * **The world matrix is refreshed by the caller, once.**
	 *
	 * `localToWorld` runs `updateWorldMatrix` up the whole parent chain on every
	 * call, and `cluster` added an ancestor — so a `projected()` over 256
	 * systems recomposed the same two matrices 256 times. The refresh is
	 * `freshenCluster`, called once before each sweep.
	 */
	const toPixels = (
		s: SystemRecord,
		rect: DOMRect,
	): { x: number; y: number; behind: boolean; depth: number } => {
		scratch.set(s.pos.x, s.pos.y, s.pos.z).applyMatrix4(cluster.matrixWorld);
		scratch.project(camera);
		// **Canvas-relative, not client.** These once carried `rect.left`/`top`,
		// which made `projected()` client coordinates while `viewport()`
		// reported canvas extents — a pair that only agrees while the chart is
		// `position: fixed; inset: 0`, and §1 says that ends the moment it
		// becomes a Navigation tab. The one conversion to client space is at
		// the two call sites that need it.
		return {
			x: ((scratch.x + 1) / 2) * rect.width,
			y: ((-scratch.y + 1) / 2) * rect.height,
			behind: scratch.z > 1,
			// **The near plane is a second clip and `behind` is not it.** NDC
			// depth below -1 is a point in front of `camera.near` (0.5), which
			// WebGL discards while `behind` — depth *above* +1 — stays false and
			// the x/y can land anywhere inside the box. At `CAMERA_MIN_LY` the
			// camera sits 12 LY out and the cluster is 24.5 LY across, so a
			// handful of systems fall in that 0.5 LY slab at some orientations.
			// Reported rather than folded into `behind`, whose name means what
			// it says.
			depth: scratch.z,
		};
	};

	/**
	 * The canvas rect, cached.
	 *
	 * `getBoundingClientRect` forces layout, and the frame loop reads it once a
	 * frame while a selection exists. It changes only on a resize, which is the
	 * one place that invalidates it.
	 */
	/** Bring `cluster.matrixWorld` up to date — once per sweep, since every
	 *  system in one sweep is read under the same transform. */
	const freshenCluster = (): void => cluster.updateWorldMatrix(true, false);

	let cachedRect: DOMRect | null = null;
	const canvasRect = (): DOMRect => {
		if (cachedRect === null) cachedRect = canvas.getBoundingClientRect();
		return cachedRect;
	};

	/**
	 * Screen-space nearest point, not a raycast.
	 *
	 * A `Points` raycast tests a threshold in *world* units, so one threshold
	 * picks a fat target when zoomed in and a tiny one when zoomed out — and the
	 * core, at three systems per LY, is exactly where that matters. Comparing
	 * pixels makes the pick radius mean the thing the player experiences, which
	 * is a **constant target size at every zoom**. That constancy is what
	 * `probe-galaxy-map.mjs` measures, by finding the boundary at two camera
	 * distances rather than by clicking dead centre.
	 */
	/**
	 * Is a projected point one the chart actually **draws**?
	 *
	 * In front of the camera *and* inside the canvas box — the same predicate
	 * §5.1's crowding metric counts over, and `probe-navigation-console.mjs`
	 * installs once for the same reason.
	 *
	 * **The second half was missing here, and it let the chart name and select a
	 * system it does not draw.** `toPixels` maps NDC linearly, so a system just
	 * off the right edge lands at `rect.width + 5` — within the 14 px radius of
	 * a cursor 9 px inside the edge, and rasterised by nothing. It was
	 * invisible while only `pick` had it, because a click selecting a system
	 * nobody can see looks like a click on empty space; #112's label is what
	 * made it legible, by putting a name on it. Fixed in `pick` as well as in
	 * the hover, because D1 makes the two one quantity and a filter on one side
	 * alone is the divergence D1 exists to prevent.
	 */
	const drawn = (
		p: { x: number; y: number; behind: boolean; depth: number },
		rect: DOMRect,
	): boolean =>
		!p.behind &&
		// The near plane. `behind` alone was the first version of this and left
		// the same class of defect open at the far end of the zoom range.
		p.depth >= -1 &&
		p.x >= 0 &&
		p.y >= 0 &&
		p.x <= rect.width &&
		p.y <= rect.height;

	const pick = (clientX: number, clientY: number): SystemRecord | null => {
		const rect = canvasRect();
		freshenCluster();
		// Client to canvas, once, rather than canvas to client 256 times.
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		let best: SystemRecord | null = null;
		let bestD = Number.POSITIVE_INFINITY;
		for (const s of galaxy.systems) {
			const p = toPixels(s, rect);
			if (!drawn(p, rect)) continue;
			const d = Math.hypot(p.x - x, p.y - y);
			if (d < PICK_RADIUS_PX && d < bestD) {
				bestD = d;
				best = s;
			}
		}
		return best;
	};

	/**
	 * How far a pointer may travel between press and release and still count as
	 * a click.
	 *
	 * Not zero, which is what this was. A mouse drifting a single pixel — which
	 * a hand on a trackpad does constantly — set `dragged` and made `pointerup`
	 * return before selecting anything, so clicks failed silently and at random.
	 */
	const CLICK_SLOP_PX = 4;

	let dragging = false;
	let travelled = 0;
	let lastX = 0;
	let lastY = 0;

	/**
	 * #108's D5: the hover label is pointer-only.
	 *
	 * There is no hover on a touch screen, and a tap-to-label affordance would
	 * be a second selection grammar — #70's constraint. The chart stays fully
	 * usable without it: `pointerup` falls back to `pick()` wherever there is no
	 * hover state, which is the same function the click path has always used.
	 *
	 * Read once at mount rather than per event. A pointer type can change under
	 * a session, but this gates an *affordance* and not a code path: a mouse
	 * plugged into a tablet mid-session gets no label until the tab is
	 * re-entered, and gets the same clicks either way.
	 */
	const hoverCapable =
		typeof window.matchMedia === "function" &&
		window.matchMedia("(hover: hover)").matches;

	/** The labelled system and its badge count, or `null` for no label. */
	let hover: { system: SystemRecord; contested: number } | null = null;

	/**
	 * Where the pointer last was, in client pixels — `null` for "no live hover".
	 *
	 * **The candidate is recomputed on the frame, not on the pointer event**, and
	 * that is a correctness fix before it is a cost one. A `pointermove` is not
	 * the only thing that moves a system under the cursor: a wheel zoom, the
	 * finder's centre control, `resetView` and a panel resize all change the
	 * projection with the pointer perfectly still. Recomputing only on move left
	 * the label naming — and a click selecting — a system that had slid out from
	 * under the cursor. Round 3 of #112's review found it on the wheel.
	 *
	 * Clearing this is how a hover *ends*: D4 says the label does not return
	 * until the pointer moves again after a release, and a frame loop that
	 * recomputed from a remembered position would bring it straight back.
	 * `clearHover` is the one place both are dropped together.
	 *
	 * It also settles the sweep's cost, which is the smaller half: one 256-system
	 * projection is 0.084 ms, so a per-move sweep is 1% of a core at 120 Hz and
	 * a per-frame one is half that — and, unlike a cached projection, there is no
	 * invalidation to get silently wrong.
	 */
	let pointerClient: { x: number; y: number } | null = null;

	/**
	 * The label's drawn box, measured only when its **text** changes.
	 *
	 * `offsetWidth` forces a synchronous style-and-layout pass, and the frame
	 * loop needs the box every frame to clamp the label — so reading it there
	 * costs a forced layout at 60 Hz for the whole time a label is up. The size
	 * is a pure function of the text (the element is `nowrap` with fixed
	 * padding), and the text changes only when the hover moves to another system
	 * or its badge count changes, which is a handful of times a second at most.
	 *
	 * Measured on the text rather than on every `renderHover`, because
	 * `renderHover` runs once per `pointermove` — up to 120 Hz, which is worse
	 * than the frame loop it would be replacing.
	 */
	let hoverLabelText = "";
	let hoverLabelBox = { w: 0, h: 0 };

	/**
	 * Draw the label, or hide it.
	 *
	 * D3 and D4's three suppressions live here rather than at the three call
	 * sites that could each have forgotten one: while `dragging`, and over the
	 * selected system, whose record card already names it with more detail.
	 *
	 * A function declaration, not a `const`, so `recompute` — written above and
	 * called below — can reach it.
	 */
	function renderHover(): void {
		if (hover === null || dragging || hover.system.index === selected?.index) {
			hoverLabel.style.display = "none";
			return;
		}
		// D2: name, direct distance, and the 7 LY shell marker. Economy,
		// government and tech level stay on the record card — putting them here
		// would make the click redundant and turn the label into a second panel.
		hoverLabel.style.display = "block";
		const text =
			`${hover.system.name}  ${distanceLy(current.pos, hover.system.pos).toFixed(1)} LY  ` +
			(litSet.has(hover.system.index)
				? "\u25cf in range"
				: "\u25cb out of range") +
			(hover.contested > 0 ? `  (${hover.contested} more)` : "");
		if (text !== hoverLabelText) {
			hoverLabelText = text;
			hoverLabel.textContent = text;
			hoverLabelBox = {
				w: hoverLabel.offsetWidth,
				h: hoverLabel.offsetHeight,
			};
		}
	}

	/** Drop the label without waiting for another move. Used by the three
	 *  pointer events that end a hover and by `pointerup`, which by D4 does not
	 *  bring it back until the pointer moves again. */
	function clearHover(): void {
		hover = null;
		// **Both, together.** Leaving the remembered position behind would have
		// the frame loop rebuild the candidate on the very next frame, which is
		// precisely the return D4 forbids.
		pointerClient = null;
		renderHover();
	}

	/**
	 * Re-run the candidate search at a cursor position.
	 *
	 * The same nearest-within-`PICK_RADIUS_PX` sweep `pick` runs, handed to
	 * `hoverCandidate` with whatever was labelled last. The sweep is written out
	 * here rather than reusing `pick` because the rule needs *every* projected
	 * point — the rivals inside the radius are what the badge counts and what
	 * the switch margin is measured against — and `pick` returns only the
	 * winner.
	 */
	function updateHover(clientX: number, clientY: number, rect: DOMRect): void {
		if (!hoverCapable) return;
		// **The rect and the matrix refresh come from the caller.** Both the
		// hover and the two floating elements' placement need them, once each
		// per frame — read here as well and a live hover paid for a second
		// `updateWorldMatrix` up the whole parent chain every frame.
		const points: { index: number; x: number; y: number }[] = [];
		for (const s of galaxy.systems) {
			const p = toPixels(s, rect);
			if (!drawn(p, rect)) continue;
			points.push({ index: s.index, x: p.x, y: p.y });
		}
		const next = hoverCandidate(
			points,
			clientX - rect.left,
			clientY - rect.top,
			hover?.system.index ?? null,
			HOVER_RULE,
		);
		const system = next === null ? null : systemByIndex(next.index);
		hover =
			next === null || system === null
				? null
				: { system, contested: next.contested };
		renderHover();
	}

	const orbit = (dx: number, dy: number): void => {
		yaw += dx * 0.005;
		pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * 0.005));
	};

	canvas.addEventListener("pointerdown", (e) => {
		dragging = true;
		travelled = 0;
		lastX = e.clientX;
		lastY = e.clientY;
		canvas.setPointerCapture(e.pointerId);
		// D4: suppressed the moment a button goes down. The *candidate* is kept,
		// because `pointerup` selects it — clearing it here would send every
		// click back through a fresh `pick()` and re-open the two-implementations
		// gap D1 closes. What a touch tap does with it is `clickTarget`'s, which
		// is a rule rather than a branch in this handler.
		renderHover();
	});
	canvas.addEventListener("pointermove", (e) => {
		// **The hover path is the else-branch on the drag's own early return.**
		// D4: a label chasing the cursor through an orbit is noise, and the
		// orbit is what this handler was written for — so the drag path below is
		// untouched by the hover.
		if (!dragging) {
			// Recorded, not swept. The frame loop does the sweep, against the
			// projection that frame actually drew.
			pointerClient = { x: e.clientX, y: e.clientY };
			return;
		}
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		// Accumulated, not measured press-to-release: a circular drag that ends
		// where it started has travelled far and is plainly not a click.
		travelled += Math.hypot(dx, dy);
		orbit(dx, dy);
		lastX = e.clientX;
		lastY = e.clientY;
	});
	// A capture the browser takes back — a gesture, a lost pointer — never
	// reaches `pointerup`, so without these the flag stays set and every later
	// hover spins the cluster with no button held.
	for (const kind of ["pointercancel", "lostpointercapture"]) {
		canvas.addEventListener(kind, () => {
			dragging = false;
			clearHover();
		});
	}
	// **D4's third clear, and it is the label's alone.** A cursor that has left
	// the canvas leaves a name under nothing, so the label goes — but the drag
	// flag does not, because a capture the canvas still holds keeps orbiting
	// while the pointer is outside the box, and that is the gesture the existing
	// handler exists for. Adding this to the loop above would have ended an
	// orbit the moment the cursor crossed the edge on any build where the
	// browser fires the boundary event through a capture.
	canvas.addEventListener("pointerleave", () => clearHover());
	canvas.addEventListener("pointerup", (e) => {
		dragging = false;
		const labelled = hover?.system.index ?? null;
		// D4: the label does not come back until the pointer moves again, so it
		// is dropped *after* the selection reads it.
		clearHover();
		// A drag that ends over a point is a camera move, not a selection.
		if (travelled > CLICK_SLOP_PX) return;
		// D1 and D5's touch half, both in `clickTarget` — a leaf with a headless
		// test, because a hybrid device is not expressible in the probe tier.
		// `pick` runs unconditionally rather than behind a `??`: it is one 256
		// sweep at 0.084 ms, once per click, and a lazy fallback would put the
		// rule back in this handler to decide when to evaluate it.
		select(
			clickTarget(
				labelled,
				e.pointerType,
				pick(e.clientX, e.clientY)?.index ?? null,
			),
		);
	});
	canvas.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			// `deltaY` is only in pixels when `deltaMode` says so. Firefox
			// reports lines (≈3 per notch) and some setups report pages, so
			// treating the raw number as pixels moves the camera 0.15 LY a notch
			// across a 12–140 LY range — and §5.1's whole answer to crowding is
			// that zooming resolves the cluster. The probe tier is Chromium, so
			// nothing here would have caught it.
			const px =
				e.deltaMode === 1
					? e.deltaY * 16
					: e.deltaMode === 2
						? e.deltaY * stage.clientHeight
						: e.deltaY;
			zoom(px * 0.05);
		},
		{ passive: false },
	);

	function select(index: number | null): void {
		selected = index === null ? null : systemByIndex(index);
		recompute();
	}

	function zoom(deltaLy: number): void {
		distance = Math.max(
			CAMERA_MIN_LY,
			Math.min(CAMERA_MAX_LY, distance + deltaLy),
		);
	}

	function commitCourse(): boolean {
		if (selected === null) return false;
		const next = setCourse(galaxy.systems, current, selected);
		if (next === null) return false;
		course = next;
		onCourse?.(course);
		recompute();
		return true;
	}

	function setHaze(on: boolean): void {
		haze.visible = on;
		recompute();
	}

	hazeButton.addEventListener("click", () => setHaze(!haze.visible));
	courseButton.addEventListener("click", () => commitCourse());
	/**
	 * What Clear does: drop the course *and* the selection.
	 *
	 * A named action rather than a listener body, because #283's pad reaches the
	 * same control through `Handle` and had to reproduce the pair — it dropped
	 * only the course, leaving the selection, its route preview and its detail
	 * card on screen. One control behaving differently depending on which device
	 * pressed it is the thing a shared action prevents. Sage, round 4.
	 */
	const clearAll = () => {
		course = null;
		onCourse?.(null);
		select(null);
	};
	clearButton.addEventListener("click", clearAll);
	const onKeyDown = (e: KeyboardEvent): void => {
		if (e.key === "h" || e.key === "H") setHaze(!haze.visible);
		if (e.key === "Escape") select(null);
	};
	if (globalKeys) window.addEventListener("keydown", onKeyDown);

	// ---- Frame -------------------------------------------------------------

	const resize = (): void => {
		// **The stage, not the root.** They are the same box only while the
		// finder is closed; open, the root still spans the host and the canvas
		// has given up a column to the panel. Sizing the drawing buffer from the
		// root would stretch the projection across a box the canvas does not
		// occupy, and `viewport()` — which a probe measures crowding against —
		// would report a width nothing is drawn at.
		const w = stage.clientWidth;
		const h = stage.clientHeight;
		renderer.setSize(w, h, false);
		camera.aspect = w / Math.max(1, h);
		camera.updateProjectionMatrix();
		cachedRect = null;
	};
	window.addEventListener("resize", resize);
	// The window is not the only thing that can change this chart's box. Hosted
	// in the Navigation tab it is a grid cell, and the panel resizes under the
	// media query without the window doing anything the workbench would notice.
	// Coalesced into the next frame rather than applied per notification: a
	// panel under a CSS transition emits one box change per frame, and each
	// would otherwise be a full `setSize` and projection rebuild.
	const observer =
		typeof ResizeObserver === "undefined"
			? null
			: new ResizeObserver(() => {
					resizePending = true;
				});
	observer?.observe(stage);
	resize();

	/** Hoisted out of the frame loop: the pitch axis is recomputed every frame
	 *  and allocating a vector to hold it 60 times a second is churn for
	 *  nothing. */
	const pitchAxis = new THREE.Vector3();

	let animationFrame = 0;
	const frame = (): void => {
		if (resizePending) {
			resizePending = false;
			resize();
		}
		pivot.rotation.set(0, 0, 0);
		pivot.rotateOnWorldAxis(UP, yaw);
		pivot.rotateOnWorldAxis(
			pitchAxis.set(1, 0, 0).applyAxisAngle(UP, yaw),
			pitch,
		);
		camera.position.set(0, 0, distance);
		camera.lookAt(0, 0, 0);
		// The haze is a sprite, so it faces the camera for free; the shell and
		// the plane turn with the cluster because they are of it.
		renderer.render(scene, camera);

		// **One rect and one matrix refresh, for all three readers of the
		// projection this frame drew** — the hover sweep, the record card's
		// placement and the label's. They share `toPixels` and nothing else,
		// which is D3's seam; what they must not each own is the refresh, since
		// `updateWorldMatrix` walks the whole parent chain.
		//
		// The hover is suppressed during a drag by D4, and `pointerClient` is
		// null whenever there is no live hover at all — before the first move,
		// and after every clear.
		const hoverLive = pointerClient !== null && !dragging;
		if (hoverLive || (selected !== null && card.style.display !== "none")) {
			const rect = canvasRect();
			freshenCluster();
			// Before the two `*Shown` reads below, because `updateHover` is what
			// decides whether there is a label to place at all.
			if (hoverLive && pointerClient !== null)
				updateHover(pointerClient.x, pointerClient.y, rect);
			const cardShown = selected !== null && card.style.display !== "none";
			const labelShown = hover !== null && hoverLabel.style.display !== "none";
			if (selected !== null && cardShown) {
				const p = toPixels(selected, rect);
				// **Clamped, not merely offset.** The card is 260 px wide against a
				// 390 px narrow viewport, so a selection right of centre pushed it
				// off screen — and an off-screen record is the same as no record,
				// which is what the probe's own check says. Anchoring right of the
				// point stays the preference; the clamp is what makes it safe.
				const w = card.offsetWidth;
				const h = card.offsetHeight;
				const left = Math.min(
					Math.max(0, p.x + 18),
					Math.max(0, rect.width - w),
				);
				const top = Math.min(
					Math.max(0, p.y - 12),
					Math.max(0, rect.height - h),
				);
				card.style.left = `${left}px`;
				card.style.top = `${top}px`;
			}
			if (hover !== null && labelShown) {
				// **Anchored to the point, not to the cursor** (D3). A label
				// offset from the cursor drifts away from the thing it names,
				// and inside a 14 px radius it can come to sit over a different
				// system than the one it is naming.
				//
				// The offset mirrors the card's `+18 / -12`, and the clamp is
				// this element's own: the card's is written against the card's
				// width and preference for the right of its point.
				const q = toPixels(hover.system, rect);
				// The cached box, so a visible label does not force a layout on
				// every frame. See `hoverLabelBox`.
				const { w, h } = hoverLabelBox;
				hoverLabel.style.left = `${Math.min(
					Math.max(0, q.x - 18 - w),
					Math.max(0, rect.width - w),
				)}px`;
				hoverLabel.style.top = `${Math.min(
					Math.max(0, q.y + 12),
					Math.max(0, rect.height - h),
				)}px`;
			}
		}
		animationFrame = requestAnimationFrame(frame);
	};

	recompute();
	frame();

	// ---- Probe handle ------------------------------------------------------

	const handle: Handle = {
		get state(): GalaxyMapState {
			return {
				galaxy: galaxyIndex,
				systemCount: galaxy.systems.length,
				currentIndex: current.index,
				selectedIndex: selected?.index ?? null,
				litIndices: lit.map((s) => s.index),
				// **Read off the geometry, not restated from `selected`.** As
				// `selected === null ? 1 : 2` this reported the intent rather
				// than the drawing, so the probe's "the unselected chart drops
				// one line" could not fail on a build whose draw range was
				// wrong — it was asserting the same field twice.
				dropLineCount: dropGeometry.drawRange.count / 2,
				haze: haze.visible,
				jumpRangeLy: JUMP_RANGE_LY,
				galaxyRadiusLy: GALAXY_RADIUS_LY,
				coreRadiusLy: CORE_RADIUS_LY,
				flatteningQ: GALAXY_FLATTENING_Q,
				pitch,
				yaw,
				cameraDistanceLy: distance,
				focusIndex,
				route:
					route === null
						? null
						: {
								jumps: route.jumps,
								totalLy: route.totalLy,
								totalCr: route.totalCr,
								hopIndices: route.hops.map((h) => h.system.index),
							},
				course,
				courseRemaining: progress?.remaining ?? null,
				record:
					selected === null
						? null
						: {
								name: selected.name,
								economy: ECONOMY_NAMES[selected.economy],
								government: GOVERNMENT_NAMES[selected.government],
								displayTL: selected.displayTL,
								population: selected.population,
								distanceLy: distanceLy(current.pos, selected.pos),
							},
				finder: finder.state,
			};
		},
		select,
		commitCourse,
		clearCourse: () => {
			course = null;
			onCourse?.(null);
			recompute();
		},
		setHaze,
		jumpTo(index: number) {
			const next = systemByIndex(index);
			if (next === null) return;
			current = next;
			selected = null;
			recompute();
		},
		orbit(dx, dy) {
			orbit(dx, dy);
		},
		zoom,
		clearAll,
		stepFinderBudget(delta: number) {
			finder.setBudget(finder.state.filter.budgetJumps + delta);
		},
		setFinderQuery: finder.setQuery,
		toggleFinderEconomy: finder.toggleEconomy,
		setFinderBudget: finder.setBudget,
		centreOn,
		resetView() {
			yaw = DEFAULT_YAW;
			pitch = DEFAULT_PITCH;
			distance = CAMERA_START_LY;
			// **The focus too.** `resetView` is what a probe calls before quoting
			// a crowding figure, and a centred cluster projects differently from
			// one turning about its own middle — a figure measured after a centre
			// would be a different measurement wearing the spec's name.
			centreOn(null);
		},
		projected() {
			const rect = canvasRect();
			freshenCluster();
			return galaxy.systems.map((s) => ({
				index: s.index,
				...toPixels(s, rect),
			}));
		},
		viewport() {
			const rect = canvasRect();
			// `left`/`top` so a probe can turn a `projected()` point into the
			// client coordinates `page.mouse.click` wants, rather than assuming
			// the canvas fills the window.
			return {
				width: rect.width,
				height: rect.height,
				left: rect.left,
				top: rect.top,
			};
		},
		pickRadiusPx: PICK_RADIUS_PX,
		hovered: () =>
			hover === null || hoverLabel.style.display === "none"
				? null
				: { index: hover.system.index, contested: hover.contested },
	};

	(
		window as unknown as { __seeliteGalaxyMap: Handle | null }
	).__seeliteGalaxyMap = handle;

	return {
		handle,
		dispose() {
			// Order matters: stop the loop before the renderer goes, or one more
			// frame renders into a disposed context.
			if (animationFrame) cancelAnimationFrame(animationFrame);
			animationFrame = 0;
			window.removeEventListener("resize", resize);
			if (globalKeys) window.removeEventListener("keydown", onKeyDown);
			observer?.disconnect();
			finder.dispose();
			// `forceContextLoss` as well as `dispose`: a browser allows a small
			// number of live WebGL contexts, and the flight view already holds
			// one. Opening and closing the map tab a dozen times without giving
			// the context back is how the *game's* renderer gets evicted.
			renderer.dispose();
			renderer.forceContextLoss();
			root.remove();
			const owner = window as unknown as { __seeliteGalaxyMap: Handle | null };
			if (owner.__seeliteGalaxyMap === handle) owner.__seeliteGalaxyMap = null;
		},
	};
}

/**
 * `?galaxy-map` — the chart as a standalone workbench.
 *
 * A thin caller of `mountGalaxyChart`, reading the galaxy and seed off the
 * query string and filling the page. It is a chart surface, not a second game
 * mode: it builds no `Game`.
 */
export function mountGalaxyMap(): void {
	const query = new URLSearchParams(window.location.search);
	const rawGalaxy = Number(query.get("galaxy-map"));
	const galaxyIndex =
		Number.isInteger(rawGalaxy) && rawGalaxy >= 0 && rawGalaxy < GALAXY_COUNT
			? rawGalaxy
			: 0;
	const rawSeed = Number(query.get("seed"));
	const worldSeed =
		Number.isFinite(rawSeed) && query.has("seed")
			? Math.abs(Math.trunc(rawSeed)) >>> 0
			: 0x5ee11e;

	const host = el("div");
	Object.assign(host.style, { position: "fixed", inset: "0" });
	document.body.appendChild(host);
	mountGalaxyChart({ host, worldSeed, galaxyIndex, globalKeys: true });
}
