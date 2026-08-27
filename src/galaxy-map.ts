/**
 * The galaxy map, as a workbench — node #11.
 *
 * `?galaxy-map` draws one galaxy's 256 systems as a freely orbitable cluster,
 * with the 7 LY shell around the current system, a derived route to whatever is
 * selected, and the core haze on a toggle so the two treatments of the density
 * gradient can be compared side by side rather than argued about.
 *
 * **This is a chart, not a console.** #70 ratified that every screen lives in
 * the cockpit and `hud-and-scanner.md` §2 gives system-scale discovery to the
 * left Navigation console, so the shipped map is a Navigation tab reached by a
 * head turn. What this route owns is the *chart surface* — the projection, the
 * shell, the drop-lines, the record card — which is the part the node had to
 * decide by looking at. Mounting it into the cockpit is #69's panel work.
 *
 * Nothing here computes a route. `galaxy-route.ts` does, and it imports no
 * Three.js: the chart draws what the arithmetic returns, and a probe that wants
 * to check a chain reads it from there rather than from a line's vertices.
 */
import * as THREE from "three";
import {
	GALAXY_COUNT,
	GALAXY_RADIUS_LY,
	JUMP_RANGE_LY,
	type Galaxy,
	type SystemRecord,
	CORE_RADIUS_LY,
	ECONOMY_NAMES,
	GOVERNMENT_NAMES,
	distanceLy,
	generateGalaxy,
	startSystem,
} from "./galaxy";
import {
	type Course,
	type CourseProgress,
	type Route,
	courseProgress,
	planRoute,
	reachable,
	setCourse,
} from "./galaxy-route";

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
const DEFAULT_PITCH = 0.35;
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
	cameraDistanceLy: number;
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
}

interface Handle {
	state: GalaxyMapState;
	select(index: number | null): void;
	commitCourse(): boolean;
	clearCourse(): void;
	setHaze(on: boolean): void;
	/** Move the ship, so a probe can watch the course re-derive from a new
	 *  origin rather than trusting that it would. */
	jumpTo(index: number): void;
	orbit(dxPx: number, dyPx: number): void;
	zoom(deltaLy: number): void;
	/** Back to the documented default framing — yaw, pitch and distance.
	 *  Crowding depends on the orientation as well as the distance, so a
	 *  figure quoted in the spec is only reproducible from a known view. */
	resetView(): void;
	/**
	 * Every system's position in canvas pixels, under the current camera.
	 *
	 * Exposed because it is the one thing about this chart a headless test
	 * cannot reach and a probe must not restate: whether the projection
	 * actually *separates* 256 systems in a 3:1-concentrated ball is the
	 * whole risk in choosing a free orbit, and it is a fact about the camera
	 * and the viewport rather than about the generator. A probe that computed
	 * it from `pos` would be checking its own arithmetic.
	 */
	projected(): { index: number; x: number; y: number; behind: boolean }[];
	/** The canvas's size in CSS pixels. A probe measuring crowding has to
	 *  discard systems projected *outside* the viewport as well as behind the
	 *  camera, and the drawn size is the module's fact, not the window's. */
	viewport(): { width: number; height: number };
	/** The pick radius the chart itself uses, so a probe measuring crowding
	 *  compares against the module's number rather than a copy of it. */
	pickRadiusPx: number;
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
	className?: string,
): HTMLElementTagNameMap[K] => {
	const node = document.createElement(tag);
	if (className !== undefined) node.className = className;
	return node;
};

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

	const galaxy: Galaxy = generateGalaxy(worldSeed, galaxyIndex);
	let current = startSystem(galaxy);
	let selected: SystemRecord | null = null;
	let course: Course | null = null;
	let route: Route | null = null;

	// ---- DOM ---------------------------------------------------------------

	const root = el("div");
	root.id = "galaxy-map";
	root.setAttribute("data-galaxy-map", String(galaxyIndex));
	Object.assign(root.style, {
		position: "fixed",
		inset: "0",
		background: "#05080d",
		color: "#cfe6f5",
		font: "13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
		overflow: "hidden",
	});
	document.body.appendChild(root);

	const canvas = el("canvas");
	Object.assign(canvas.style, {
		position: "absolute",
		inset: "0",
		width: "100%",
		height: "100%",
		display: "block",
		touchAction: "none",
	});
	root.appendChild(canvas);

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
	root.appendChild(legend);

	const controls = el("div");
	Object.assign(controls.style, {
		position: "absolute",
		left: "16px",
		bottom: "16px",
		display: "flex",
		gap: "8px",
	});
	root.appendChild(controls);

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
	root.appendChild(card);

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
	pivot.add(planeGroup);

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
	pivot.add(cloud);

	// D3: the reachability shell. Wireframe rather than a solid translucent
	// ball — a solid one at 7 LY around a point deep inside a 22 LY cluster
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
	pivot.add(shell);

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
	pivot.add(drops);

	const anchors = new THREE.Group();
	pivot.add(anchors);
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
	routeGeometry.setAttribute(
		"position",
		new THREE.BufferAttribute(new Float32Array(3 * 64), 3),
	);
	const routeLine = new THREE.Line(
		routeGeometry,
		new THREE.LineBasicMaterial({ color: COLOUR.route, transparent: true }),
	);
	routeLine.visible = false;
	pivot.add(routeLine);

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
	pivot.add(haze);

	// ---- Derived state -----------------------------------------------------

	let lit: SystemRecord[] = [];
	let progress: CourseProgress | null = null;

	const recompute = (): void => {
		lit = reachable(galaxy.systems, current);
		const litSet = new Set(lit.map((s) => s.index));

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
			chain.forEach((s, i) => {
				rp[i * 3] = s.pos.x;
				rp[i * 3 + 1] = s.pos.y;
				rp[i * 3 + 2] = s.pos.z;
			});
			routeGeometry.attributes.position.needsUpdate = true;
			routeGeometry.setDrawRange(0, chain.length);
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
				: `course: ${galaxy.systems[course.destinationIndex].name}` +
					`  ·  ${progress?.remaining ?? "?"} jump(s) left` +
					(progress?.nextHop
						? `  ·  next ${progress.nextHop.system.name}`
						: "  ·  arrived"),
			"drag orbit · wheel zoom · click select · H haze",
		].join("\n");

		courseButton.disabled = selected === null || route === null;
		hazeButton.textContent = `core haze: ${haze.visible ? "on" : "off"}`;
		hazeButton.setAttribute("aria-pressed", String(haze.visible));

		if (selected === null || route === null) {
			card.style.display = "none";
		} else {
			card.style.display = "block";
			card.textContent = [
				selected.name,
				`${ECONOMY_NAMES[selected.economy]} · ${GOVERNMENT_NAMES[selected.government]}`,
				`TL ${selected.displayTL} · pop ${(selected.population / 10).toFixed(1)} bn`,
				`${distanceLy(current.pos, selected.pos).toFixed(1)} LY direct`,
				route.jumps === 0
					? "you are here"
					: `${route.jumps} jump(s) · ${route.totalLy.toFixed(1)} LY · ${route.totalCr.toFixed(0)} Cr`,
				"",
				selected.description,
			].join("\n");
		}
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
	const toPixels = (
		s: SystemRecord,
		rect: DOMRect,
	): { x: number; y: number; behind: boolean } => {
		scratch.set(s.pos.x, s.pos.y, s.pos.z);
		pivot.localToWorld(scratch);
		scratch.project(camera);
		return {
			x: ((scratch.x + 1) / 2) * rect.width + rect.left,
			y: ((-scratch.y + 1) / 2) * rect.height + rect.top,
			behind: scratch.z > 1,
		};
	};

	/**
	 * The canvas rect, cached.
	 *
	 * `getBoundingClientRect` forces layout, and the frame loop reads it once a
	 * frame while a selection exists. It changes only on a resize, which is the
	 * one place that invalidates it.
	 */
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
	const pick = (clientX: number, clientY: number): SystemRecord | null => {
		const rect = canvasRect();
		let best: SystemRecord | null = null;
		let bestD = Number.POSITIVE_INFINITY;
		for (const s of galaxy.systems) {
			const p = toPixels(s, rect);
			if (p.behind) continue;
			const d = Math.hypot(p.x - clientX, p.y - clientY);
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
	});
	canvas.addEventListener("pointermove", (e) => {
		if (!dragging) return;
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		// Accumulated, not measured press-to-release: a circular drag that ends
		// where it started has travelled far and is plainly not a click.
		travelled += Math.hypot(dx, dy);
		orbit(dx, dy);
		lastX = e.clientX;
		lastY = e.clientY;
	});
	canvas.addEventListener("pointerup", (e) => {
		dragging = false;
		// A drag that ends over a point is a camera move, not a selection.
		if (travelled > CLICK_SLOP_PX) return;
		select(pick(e.clientX, e.clientY)?.index ?? null);
	});
	canvas.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			zoom(e.deltaY * 0.05);
		},
		{ passive: false },
	);

	function select(index: number | null): void {
		selected = index === null ? null : (galaxy.systems[index] ?? null);
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
		recompute();
		return true;
	}

	function setHaze(on: boolean): void {
		haze.visible = on;
		recompute();
	}

	hazeButton.addEventListener("click", () => setHaze(!haze.visible));
	courseButton.addEventListener("click", () => commitCourse());
	clearButton.addEventListener("click", () => {
		course = null;
		select(null);
	});
	window.addEventListener("keydown", (e) => {
		if (e.key === "h" || e.key === "H") setHaze(!haze.visible);
		if (e.key === "Escape") select(null);
	});

	// ---- Frame -------------------------------------------------------------

	const resize = (): void => {
		const w = root.clientWidth;
		const h = root.clientHeight;
		renderer.setSize(w, h, false);
		camera.aspect = w / Math.max(1, h);
		camera.updateProjectionMatrix();
		cachedRect = null;
	};
	window.addEventListener("resize", resize);
	resize();

	/** Hoisted out of the frame loop: the pitch axis is recomputed every frame
	 *  and allocating a vector to hold it 60 times a second is churn for
	 *  nothing. */
	const pitchAxis = new THREE.Vector3();

	const frame = (): void => {
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

		if (selected !== null && card.style.display !== "none") {
			const rect = canvasRect();
			const p = toPixels(selected, rect);
			// **Clamped, not merely offset.** The card is 260 px wide against a
			// 390 px narrow viewport, so a selection right of centre pushed it
			// off screen — and an off-screen record is the same as no record,
			// which is what the probe's own check says. Anchoring right of the
			// point stays the preference; the clamp is what makes it safe.
			const w = card.offsetWidth;
			const h = card.offsetHeight;
			const left = Math.min(
				Math.max(0, p.x - rect.left + 18),
				Math.max(0, rect.width - w),
			);
			const top = Math.min(
				Math.max(0, p.y - rect.top - 12),
				Math.max(0, rect.height - h),
			);
			card.style.left = `${left}px`;
			card.style.top = `${top}px`;
		}
		requestAnimationFrame(frame);
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
				cameraDistanceLy: distance,
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
			};
		},
		select,
		commitCourse,
		clearCourse: () => {
			course = null;
			recompute();
		},
		setHaze,
		jumpTo(index: number) {
			const next = galaxy.systems[index];
			if (next === undefined) return;
			current = next;
			selected = null;
			recompute();
		},
		orbit(dx, dy) {
			orbit(dx, dy);
		},
		zoom,
		resetView() {
			yaw = DEFAULT_YAW;
			pitch = DEFAULT_PITCH;
			distance = CAMERA_START_LY;
		},
		projected() {
			const rect = canvasRect();
			return galaxy.systems.map((s) => ({
				index: s.index,
				...toPixels(s, rect),
			}));
		},
		viewport() {
			const rect = canvasRect();
			return { width: rect.width, height: rect.height };
		},
		pickRadiusPx: PICK_RADIUS_PX,
	};

	(window as unknown as { __seeliteGalaxyMap: Handle }).__seeliteGalaxyMap =
		handle;
}
