/**
 * The marker overlay — that it covers the screen, and that its markers land on
 * the things they mark.
 *
 *   npm run dev                    # in one shell
 *   node scripts/probe-hud.mjs     # in another
 *
 * ## Why this probe exists
 *
 * It was written after a bug that every headless test passed. `hud.ts`'s
 * projection was correct, its unit tests were green, and the markers still all
 * appeared in a small box in the top-left corner of the window — because the
 * canvas's backing store was never sized. `onResize` set it, and `onResize` only
 * runs on a resize *event*, so a window nobody dragged kept the 300×150 default;
 * a `<canvas>` takes its width/height attributes as its intrinsic size, and with
 * `width: auto` the element was that size too, pinned at the corner. The
 * arithmetic was never wrong; the surface it was drawn onto was.
 *
 * That failure is invisible to anything that does not measure the *page*, which
 * is what this probe is for. It is the cheap version of the principal noticing
 * and sending a screenshot.
 *
 * ## The claims
 *
 * 1. The overlay's backing store is the viewport — same width and height, so a
 *    pixel written at (w/2, h/2) is the centre of the screen and not the centre
 *    of a box in the corner.
 * 2. The overlay element covers the viewport — the CSS half of the same claim.
 *    Check (1) is the one that catches the original bug; see the note above it,
 *    which records which of the two was measured to bite and which did not.
 * 3. A marker lands on the body it marks. Checked against **Three.js's own**
 *    projection of the mesh: `hud.ts` places markers by direction with its own
 *    arithmetic, and the renderer places meshes with a projection matrix. Two
 *    independent routes to one pixel is the only way to catch a marker that is
 *    self-consistently in the wrong place.
 * 4. It holds in *both* render layers — a body drawn at `FAR_SCALE` an AU away
 *    and one drawn at 1:1 must both be marked correctly, which is the property
 *    that lets one overlay serve three layers.
 * 5. The Core mark (`hud-and-scanner.md` §5.5, node #478) is painted where the
 *    live system's Core bearing projects: its record agrees with `markerNdc`,
 *    and the overlay carries ink in a box around it that the same pose and frame
 *    with the mark withheld does not. Deleting the strokes and keeping the record
 *    turns the ink row red, which is the defect a record-only check would pass.
 * 6. The Core mark's label gives way to the selected target's edge label, at a
 *    pose built to put the two on one row, against a control at the same pose
 *    with nothing selected.
 */
// A default-layout probe (#381 D11): https://github.com/jcfischer/seelite/issues/381
import {
	bootedGame,
	guardedOrigin,
	installCamSim,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const URL = gameUrl(ORIGIN, { seed: 42 }, { override: process.env.PROBE_URL });

/** How far a marker may sit from the mesh it marks, in NDC. 0.002 of a 900-pixel
 *  viewport is under a pixel; the failure this catches is half a screen. */
const EPS_NDC = 2e-3;

const VIEWPORT = { width: 900, height: 620 };

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: VIEWPORT });
watch(page);
// The shared camera recovery, installed as an init script — `probe-boot.mjs`
// uses the same one, and re-deriving `shipSim - shipMesh` in each probe is one
// more place for the camera-relative contract to be restated slightly wrong.
await installCamSim(page);
await page.goto(URL, { waitUntil: "load" });
await bootedGame(page);

const state = await page.evaluate(async () => {
	const g = window.__seelite;
	// Point at the selected target so at least one marker is on screen, then let
	// two frames pass — the first may already be in flight when the orientation
	// is written.
	g.faceTarget();
	await new Promise((r) => requestAnimationFrame(() => r()));
	await new Promise((r) => requestAnimationFrame(() => r()));

	const overlay = document.getElementById("overlay");
	const box = overlay.getBoundingClientRect();
	const cam = window.__recoverCamSim();

	const bodies = [];
	for (const body of g.world.system.bodies) {
		const nearMesh = g.nearScene.getObjectByName(body.id);
		const mesh = nearMesh ?? g.farScene.getObjectByName(body.id);
		if (!mesh) continue;
		// Three.js's own answer: project the drawn position through the camera
		// that drew it.
		const camera = nearMesh ? g.nearCamera : g.farCamera;
		const projected = mesh.position.clone().project(camera);
		// `hud.ts`'s answer: the direction from the camera to the body in sim
		// space, projected by hand.
		const d = {
			x: body.pos.x - cam.x,
			y: body.pos.y - cam.y,
			z: body.pos.z - cam.z,
		};
		const len = Math.hypot(d.x, d.y, d.z);
		const marker = g.markerNdc({ x: d.x / len, y: d.y / len, z: d.z / len });
		bodies.push({
			id: body.id,
			layer: nearMesh ? "near" : "far",
			distanceKm: len,
			three: { x: projected.x, y: projected.y, z: projected.z },
			marker,
		});
	}

	const t = g.world.system.byId.get(g.targetId);
	// Reported rather than assumed: everything below dereferences this, and a
	// run with nothing selected would throw inside the evaluate and kill the
	// probe instead of producing a FAIL line — the same reason `probe-cruise`
	// returns `noStation`.
	if (!t) return { noTarget: true, targetId: g.targetId };
	return {
		liveCockpit: document
			.querySelector("[data-live-cockpit]")
			?.getAttribute("data-live-active"),
		viewport: { w: window.innerWidth, h: window.innerHeight },
		backing: { w: overlay.width, h: overlay.height },
		box: { w: box.width, h: box.height, x: box.x, y: box.y },
		targetId: g.targetId,
		bodies,
	};
});

if (state.noTarget) {
	check(
		"something is selected to measure the markers against",
		false,
		`targetId ${state.targetId ?? "none"}`,
	);
	await browser.close();
	exit();
}

// (1) The backing store is the viewport. This is the number the drawing code
// divides by, so a mismatch puts every marker in a scaled corner of the screen.
check(
	"the overlay's backing store matches the viewport",
	state.backing.w === state.viewport.w && state.backing.h === state.viewport.h,
	`canvas ${state.backing.w}×${state.backing.h}, viewport ${state.viewport.w}×${state.viewport.h}`,
);

// (2) And the element it is painted into covers the viewport — the CSS half.
//
// Which of these two catches the original bug was **measured, not assumed**:
// with the constructor's sizing removed the canvas reports 300×150 here and (1)
// goes red, while (2) stays green because the stylesheet now stretches the
// element regardless. With the stylesheet reverted instead, both stay green,
// because a canvas whose width/height attributes are set takes them as its
// intrinsic size. So (1) is the check that bites and the CSS is belt and
// braces — worth keeping, since a future `width: auto` would need it, but not
// worth claiming credit it does not have.
check(
	"the overlay element covers the viewport",
	Math.abs(state.box.w - state.viewport.w) < 1 &&
		Math.abs(state.box.h - state.viewport.h) < 1 &&
		Math.abs(state.box.x) < 1 &&
		Math.abs(state.box.y) < 1,
	`element ${state.box.w.toFixed(0)}×${state.box.h.toFixed(0)} at ` +
		`(${state.box.x.toFixed(0)}, ${state.box.y.toFixed(0)})`,
);

// (3) and (4). Only bodies actually in front of the camera: `project` mirrors
// anything behind it, which is the case `hud.ts` reports as `behind` rather than
// projecting, so comparing the two there would be comparing a number against a
// deliberate refusal to produce one.
const ahead = state.bodies.filter((b) => !b.marker.behind && b.three.z < 1);
check(
	"there is something in front of the ship to mark",
	ahead.length > 0,
	`${ahead.length} of ${state.bodies.length} bodies ahead`,
);
for (const b of ahead) {
	const dx = Math.abs(b.marker.ndcX - b.three.x);
	const dy = Math.abs(b.marker.ndcY - b.three.y);
	check(
		`${b.id}: the marker sits on the mesh (${b.layer} layer)`,
		dx < EPS_NDC && dy < EPS_NDC,
		`hud (${b.marker.ndcX.toFixed(4)}, ${b.marker.ndcY.toFixed(4)}) vs ` +
			`three (${b.three.x.toFixed(4)}, ${b.three.y.toFixed(4)})`,
	);
}

// The layering claim stated directly: one overlay, both scales.
const layers = new Set(ahead.map((b) => b.layer));
console.log(
	`\nmarked ${ahead.length} bodies across ${[...layers].join(" + ")} layer(s), ` +
		`target ${state.targetId}\n`,
);

// And the target itself is marked, since it is what `faceTarget` pointed at —
// a run where every marked body happened to be scenery would pass everything
// above while the one marker the player needs was broken.
const target = ahead.find((b) => b.id === state.targetId);
check(
	"the selected target is among them, dead ahead",
	target !== undefined &&
		Math.hypot(target.marker.ndcX, target.marker.ndcY) < 0.05,
	target
		? `${state.targetId} at (${target.marker.ndcX.toFixed(3)}, ${target.marker.ndcY.toFixed(3)})`
		: `${state.targetId} not among the bodies ahead`,
);

check(
	"the default route mounts the live cockpit",
	state.liveCockpit === "true",
	`live cockpit active: ${state.liveCockpit ?? "absent"}`,
);

// (5) The Core mark (`hud-and-scanner.md` §5.5, node #478) is painted where the
// Core bearing lands. The record alone proves nothing was painted (#69, #447),
// so the overlay's own pixels are read in a box around the mark with the bearing
// 15° right of the nose. The control is the *same pose and the same box* with the
// mark withheld — the game's own `coreDir` field nulled for two frames and put
// back, which is what the draw reads and nothing else does. Turning the ship
// away would be no control at all: every body marker and label moves with the
// view, so one near the core bearing would light the hit box and leave the
// control bare. The row counts the pixels inked *only* with the mark present, per
// pixel rather than as two totals, so another marker in the box cannot carry it
// and a frame that lost ink in one place and gained it in another cannot pass.
// Only the overlay canvas is read, so the sky behind it cannot light the box.
const CORE_OFF_NOSE_DEG = 15;
/** Half the side of the box read around the mark: the brackets' radius plus a
 *  stroke's width and antialiasing, and short of the label beside it. */
const CORE_BOX_PX = 9;
const coreMark = await page.evaluate(
	async ({ offDeg, boxPx }) => {
		const g = window.__seelite;
		const core = g.coreBearingDir;
		if (!core) return { noCore: true };
		// The control writes the field the draw reads. A rename would make that
		// write a new, unread property and leave the mark drawn, so the field's
		// presence is checked rather than assumed.
		const fieldPresent = Object.hasOwn(g, "coreDir") && g.coreDir === core;
		const frames = async () => {
			await new Promise((r) => requestAnimationFrame(() => r()));
			await new Promise((r) => requestAnimationFrame(() => r()));
		};
		const norm = (v) => {
			const l = Math.hypot(v.x, v.y, v.z);
			return { x: v.x / l, y: v.y / l, z: v.z / l };
		};
		// `face` looks along a direction with world +y as up, so the camera's right
		// is `dir × up`. Turning the nose *left* of the core in that plane puts the
		// mark about 15° right of centre, near its height (at 900x620 it lands near
		// (592, 290)). Nothing here needs the box clear of the nose cross or the
		// horizon: the control is the same pose, so anything else in the box is
		// inked in both frames and the ink row does not count it.
		const up = { x: 0, y: 1, z: 0 };
		const crossUp = (v) => ({ x: -v.z * up.y, y: 0, z: v.x * up.y });
		const right0 = norm(
			Math.hypot(core.x, core.z) > 1e-3 ? crossUp(core) : { x: 1, y: 0, z: 0 },
		);
		const a = (offDeg * Math.PI) / 180;
		const facing = norm({
			x: core.x * Math.cos(a) - right0.x * Math.sin(a),
			y: core.y * Math.cos(a) - right0.y * Math.sin(a),
			z: core.z * Math.cos(a) - right0.z * Math.sin(a),
		});
		const overlay = document.getElementById("overlay");
		const ctx = overlay.getContext("2d");
		/** The box's alpha channel, one entry per pixel: inked or bare. */
		const mask = (x, y) => {
			const side = 2 * boxPx + 1;
			const data = ctx.getImageData(
				Math.round(x) - boxPx,
				Math.round(y) - boxPx,
				side,
				side,
			).data;
			const out = [];
			for (let i = 3; i < data.length; i += 4) out.push(data[i] > 0);
			return out;
		};
		g.face(facing);
		await frames();
		const hit = g.coreRender;
		const projected = g.markerNdc(core);
		const w = overlay.width;
		const h = overlay.height;
		const expected = {
			x: (projected.ndcX * 0.5 + 0.5) * w,
			y: (1 - (projected.ndcY * 0.5 + 0.5)) * h,
		};
		const at = hit?.at ?? expected;
		const hitMask = mask(at.x, at.y);
		// The control: same pose, mark withheld.
		let withheld = null;
		let controlMask = hitMask.map(() => true);
		if (fieldPresent) {
			g.coreDir = null;
			try {
				g.face(facing);
				await frames();
				withheld = { render: g.coreRender };
				controlMask = mask(at.x, at.y);
			} finally {
				g.coreDir = core;
			}
		}
		let hitInk = 0;
		let controlInk = 0;
		let markOnly = 0;
		for (let i = 0; i < hitMask.length; i++) {
			if (hitMask[i]) hitInk++;
			if (controlMask[i]) controlInk++;
			if (hitMask[i] && !controlMask[i]) markOnly++;
		}
		// And behind the camera: no mark is recorded at all.
		g.face({ x: -core.x, y: -core.y, z: -core.z });
		await frames();
		const behind = g.coreRender;
		return {
			core,
			fieldPresent,
			hit,
			expected,
			hitInk,
			controlInk,
			markOnly,
			withheld,
			behind,
			view: g.view,
		};
	},
	{ offDeg: CORE_OFF_NOSE_DEG, boxPx: CORE_BOX_PX },
);

if (coreMark.noCore) {
	check(
		"the live system has a Core bearing to mark",
		false,
		"coreBearingDir is null",
	);
} else {
	check(
		`the Core mark is drawn ${CORE_OFF_NOSE_DEG}° off the nose, where the bearing projects`,
		coreMark.hit !== null &&
			Math.abs(coreMark.hit.at.x - coreMark.expected.x) < 0.5 &&
			Math.abs(coreMark.hit.at.y - coreMark.expected.y) < 0.5,
		coreMark.hit
			? `drawn at (${coreMark.hit.at.x.toFixed(1)}, ${coreMark.hit.at.y.toFixed(1)}), ` +
					`projected (${coreMark.expected.x.toFixed(1)}, ${coreMark.expected.y.toFixed(1)}), ` +
					`label ${coreMark.hit.labelled ? "drawn" : "declined"}, view ${coreMark.view}`
			: `no mark recorded; projected (${coreMark.expected.x.toFixed(1)}, ${coreMark.expected.y.toFixed(1)}), view ${coreMark.view}`,
	);
	// The control is only a control if the mark really was withheld: the field
	// existed and held the bearing, and the frame drawn without it recorded none.
	check(
		"the control frame withholds the Core mark at the same pose",
		coreMark.fieldPresent &&
			coreMark.withheld !== null &&
			coreMark.withheld.render === null,
		!coreMark.fieldPresent
			? "Game has no own coreDir field holding the bearing — the control cannot withhold the mark"
			: coreMark.withheld?.render
				? "a Core mark was recorded with coreDir null"
				: "withheld",
	);
	// The pixels the mark alone puts in its box. A floor, so a stray pixel cannot
	// carry it: the two brackets and the dot paint well over this at any
	// antialiasing. Deleting the strokes and keeping the record reads 0 here.
	check(
		"the Core mark puts ink on the glass that the same frame without it lacks",
		coreMark.markOnly >= 15,
		`${coreMark.markOnly} px inked only with the mark ` +
			`(${coreMark.hitInk} inked with it, ${coreMark.controlInk} without, same box)`,
	);
	check(
		"facing away from the core, no Core mark is recorded",
		coreMark.behind === null,
		coreMark.behind
			? `recorded at (${coreMark.behind.at.x.toFixed(1)}, ${coreMark.behind.at.y.toFixed(1)})`
			: "none",
	);
}

// (6) The Core mark's label yields to the selected target's *edge* label
// (§5.5, sage on node #478). A target behind the ship is named beside its edge
// arrow, and that name outranks CORE as surely as the on-glass one does. The
// pose is built so the two collide: the nose lies in the plane of the core and
// the target, tilted until the core lands near the top of the glass, and rolled
// so that plane is the screen's vertical — the core straight above centre and
// the target astern, so its arrow sits on the top edge and its name on CORE's
// room. The control is the same pose with nothing selected, where CORE must be
// labelled; it runs first, because a refused label stays refused for
// `MARKER_LABEL_REAPPEAR_S` and would carry over into a control taken after.
/** Where the core is put on the glass: near the top, so its label shares a
 *  row with an edge label hung under the top edge. */
const CORE_EDGE_Y_PX = 40;
const coreEdge = await page.evaluate(
	async ({ coreYPx }) => {
		const g = window.__seelite;
		const core = g.coreBearingDir;
		if (!core) return { noCore: true };
		const frames = async () => {
			await new Promise((r) => requestAnimationFrame(() => r()));
			await new Promise((r) => requestAnimationFrame(() => r()));
		};
		const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
		const norm = (v) => {
			const l = Math.hypot(v.x, v.y, v.z);
			return { x: v.x / l, y: v.y / l, z: v.z / l };
		};
		const cross = (a, b) => ({
			x: a.y * b.z - a.z * b.y,
			y: a.z * b.x - a.x * b.z,
			z: a.x * b.y - a.y * b.x,
		});
		const ship = g.world.ship.pos;
		// A target 100°–150° round from the core: once the core is tilted above
		// the nose, that puts the target astern and above, so its arrow takes the
		// top edge.
		const candidates = [];
		for (const body of g.world.system.bodies) {
			const d = {
				x: body.pos.x - ship.x,
				y: body.pos.y - ship.y,
				z: body.pos.z - ship.z,
			};
			if (Math.hypot(d.x, d.y, d.z) < 1) continue;
			const t = norm(d);
			const beta =
				(Math.acos(Math.max(-1, Math.min(1, dot(core, t)))) * 180) / Math.PI;
			if (beta > 100 && beta < 150) candidates.push({ id: body.id, t, beta });
		}
		if (candidates.length === 0) return { noCandidate: true };
		const { id, t, beta } = candidates[0];
		// `u` is the target's side of the plane, perpendicular to the core.
		const c = dot(core, t);
		const u = norm({
			x: t.x - core.x * c,
			y: t.y - core.y * c,
			z: t.z - core.z * c,
		});
		// Three's own classes, reached through objects the game already holds.
		const V = g.nearCamera.position.constructor;
		const M = g.nearCamera.matrixWorld.constructor;
		/** Nose tilted `a` away from the core, rolled so the core is straight up. */
		const pose = (a) => {
			const forward = {
				x: core.x * Math.cos(a) - u.x * Math.sin(a),
				y: core.y * Math.cos(a) - u.y * Math.sin(a),
				z: core.z * Math.cos(a) - u.z * Math.sin(a),
			};
			const up = {
				x: core.x * Math.sin(a) + u.x * Math.cos(a),
				y: core.y * Math.sin(a) + u.y * Math.cos(a),
				z: core.z * Math.sin(a) + u.z * Math.cos(a),
			};
			const right = cross(forward, up);
			g.orientation.setFromRotationMatrix(
				new M().makeBasis(
					new V(right.x, right.y, right.z),
					new V(up.x, up.y, up.z),
					new V(-forward.x, -forward.y, -forward.z),
				),
			);
		};
		const h = window.innerHeight;
		const wantNdcY = 1 - (2 * coreYPx) / h;
		let lo = 0;
		let hi = Math.PI / 3;
		for (let i = 0; i < 40; i++) {
			const mid = (lo + hi) / 2;
			pose(mid);
			if (g.markerNdc(core).ndcY < wantNdcY) lo = mid;
			else hi = mid;
		}
		const a = (lo + hi) / 2;
		const original = g.targetId;
		try {
			g.targetId = null;
			pose(a);
			await frames();
			const control = g.coreRender;
			g.targetId = id;
			pose(a);
			await frames();
			const hit = g.coreRender;
			const target = g.markerNdc(t);
			const coreNdc = g.markerNdc(core);
			return {
				id,
				beta,
				control,
				hit,
				targetBehind: target.behind,
				coreNdc,
			};
		} finally {
			g.targetId = original;
		}
	},
	{ coreYPx: CORE_EDGE_Y_PX },
);

if (coreEdge.noCore) {
	check(
		"the live system has a Core bearing to collide with an edge label",
		false,
		"coreBearingDir is null",
	);
} else if (coreEdge.noCandidate) {
	check(
		"a body lies 100°–150° from the core, to put its edge label on CORE's room",
		false,
		"no body in that band",
	);
} else {
	const pose =
		`${coreEdge.id} ${coreEdge.beta.toFixed(0)}° from the core, ` +
		`${coreEdge.targetBehind ? "astern" : "NOT astern"}; core at ndc ` +
		`(${coreEdge.coreNdc.ndcX.toFixed(3)}, ${coreEdge.coreNdc.ndcY.toFixed(3)})`;
	// The control earns the row: at this pose, with nothing selected, CORE has
	// its room, so a refusal below is the edge label's doing and nothing else's.
	check(
		"with nothing selected, CORE is labelled at the edge-collision pose",
		coreEdge.control?.labelled === true,
		coreEdge.control
			? `label ${coreEdge.control.labelled ? "drawn" : "declined"}; ${pose}`
			: `no Core mark recorded; ${pose}`,
	);
	check(
		"CORE gives way to the selected target's edge label",
		coreEdge.targetBehind === true &&
			coreEdge.hit !== null &&
			coreEdge.hit.labelled === false,
		coreEdge.hit
			? `label ${coreEdge.hit.labelled ? "drawn over the edge label" : "declined"}; ${pose}`
			: `no Core mark recorded; ${pose}`,
	);
}

// The overlay assertions above deliberately use the default live-cockpit route.
// Keep this older legacy-HUD ETA check as a separate compatibility pass.
await page.goto(gameUrl(ORIGIN, { seed: 42, "legacy-hud": 1 }), {
	waitUntil: "load",
});
await bootedGame(page);
const legacyEta = await page.evaluate(async () => {
	const g = window.__seelite;
	const target = g.world.system.byId.get(g.targetId);
	if (!target) return { noTarget: true, targetId: g.targetId };
	const targetKm = Math.hypot(
		target.pos.x - g.world.ship.pos.x,
		target.pos.y - g.world.ship.pos.y,
		target.pos.z - g.world.ship.pos.z,
	);
	const bootText = document.getElementById("hud").textContent;
	const to = {
		x: target.pos.x - g.world.ship.pos.x,
		y: target.pos.y - g.world.ship.pos.y,
		z: target.pos.z - g.world.ship.pos.z,
	};
	const length = Math.hypot(to.x, to.y, to.z);
	const crossingKms = 20;
	g.assist = false;
	g.setThrottle(0);
	g.world.ship.vel = {
		x: (-to.y / length) * crossingKms,
		y: (to.x / length) * crossingKms,
		z: 0,
	};
	g.world.gameTime += 1;
	await new Promise((resolve) => requestAnimationFrame(() => resolve()));
	await new Promise((resolve) => requestAnimationFrame(() => resolve()));
	return {
		bootText,
		crossingText: document.getElementById("hud").textContent,
		crossingKms,
		targetKm,
		regime: g.regime,
		assistCapKms: g.assistCapKms,
	};
});

if (legacyEta.noTarget) {
	check(
		"the legacy compatibility route selects a target",
		false,
		`targetId ${legacyEta.targetId ?? "none"}`,
	);
} else {
	check(
		"the legacy compatibility panel names the regime that can get there",
		legacyEta.regime === "normal" &&
			/press j to cruise/.test(legacyEta.bootText),
		legacyEta.bootText.split("\n")[1] ?? legacyEta.bootText,
	);
	check(
		"the legacy compatibility panel reports an honest normal-flight eta",
		/eta \d+(\.\d+)?d/.test(legacyEta.bootText),
		`${(legacyEta.targetKm / legacyEta.assistCapKms / 86400).toFixed(0)} d at the assist cap`,
	);
	const daysMatched = /eta (\d+)d/.exec(legacyEta.crossingText);
	const absoluteDays = legacyEta.targetKm / legacyEta.crossingKms / 86400;
	check(
		"the legacy compatibility eta counts closing progress, not crossing speed",
		daysMatched !== null && Number(daysMatched[1]) > absoluteDays * 2,
		`reads ${daysMatched?.[1] ?? "—"}d; crossing speed would say ${absoluteDays.toFixed(0)}d`,
	);
}

await page.evaluate(() => {
	const g = window.__seelite;
	g.setHeadLook("forward");
	g.faceTarget();
});
await page.keyboard.press("7");
const wide = await page.evaluate(async () => {
	const g = window.__seelite;
	await new Promise((r) =>
		requestAnimationFrame(() => requestAnimationFrame(r)),
	);
	const { Vector2, Vector3 } = await import(
		"/node_modules/.vite/deps/three.js"
	);
	const direction = { x: 0.3, y: 0.2, z: -1 };
	const forward = new Vector3(
		direction.x,
		direction.y,
		direction.z,
	).applyQuaternion(g.nearCamera.quaternion);
	const marker = g.markerNdc(forward);
	const projected = forward.clone().project(g.nearCamera);
	const cameras = [
		g.backdropCamera,
		g.farCamera,
		g.approachCamera,
		g.nearCamera,
		g.cabinCamera,
	];
	const stored = JSON.parse(localStorage.getItem("seelite:settings:v1"));
	return {
		setting: g.settings.value.cockpitFov,
		stored: stored.cockpitFov,
		fovs: cameras.map((camera) => camera.fov),
		error: Math.hypot(marker.ndcX - projected.x, marker.ndcY - projected.y),
		focal: g.focalPx,
		expectedFocal:
			g.renderer.getSize(new Vector2()).y /
			(2 * Math.tan((g.nearCamera.fov * Math.PI) / 360)),
	};
});
check(
	"7 persists wide FOV and updates all five layer cameras",
	wide.setting === "wide" &&
		wide.stored === "wide" &&
		wide.fovs.every((fov) => fov === 80),
	JSON.stringify(wide),
);
check(
	"wide FOV keeps off-axis target markers aligned and target sizing live",
	wide.error < EPS_NDC && Math.abs(wide.focal - wide.expectedFocal) < 1e-6,
	JSON.stringify(wide),
);
await page.keyboard.press("v");
await page.keyboard.press("7");
const chaseFov = await page.evaluate(async () => {
	await new Promise((r) =>
		requestAnimationFrame(() => requestAnimationFrame(r)),
	);
	const g = window.__seelite;
	return {
		view: g.view,
		fov: g.nearCamera.fov,
		setting: g.settings.value.cockpitFov,
	};
});
check(
	"chase keeps its own 60 degree FOV and ignores the cockpit toggle",
	chaseFov.view === "chase" &&
		chaseFov.fov === 60 &&
		chaseFov.setting === "wide",
	JSON.stringify(chaseFov),
);
await page.keyboard.press("v");
await page.waitForFunction(() => window.__seelite.nearCamera.fov === 80);
await page.keyboard.press("7");
const normal = await page.evaluate(() => ({
	fov: window.__seelite.nearCamera.fov,
	setting: window.__seelite.settings.value.cockpitFov,
}));
check(
	"returning to cockpit restores wide and 7 returns to normal live",
	normal.fov === 60 && normal.setting === "normal",
	JSON.stringify(normal),
);

await browser.close();
exit();
