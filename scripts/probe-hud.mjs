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
 */
import {
	bootedGame,
	guardedOrigin,
	installCamSim,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=42&legacy-hud=1`;

/** How far a marker may sit from the mesh it marks, in NDC. 0.002 of a 900-pixel
 *  viewport is under a pixel; the failure this catches is half a screen. */
const EPS_NDC = 2e-3;

const VIEWPORT = { width: 900, height: 620 };

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, exit } = tally();

const page = await browser.newPage({ viewport: VIEWPORT });
page.on("pageerror", (e) => check(`no page error (${e.message})`, false));
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

	// What the panel says while the ship sits in normal flight with a distant
	// target selected — the state the first session was flown in.
	const hudText = document.getElementById("hud").textContent;
	const t = g.world.system.byId.get(g.targetId);
	// Reported rather than assumed: everything below dereferences this, and a
	// run with nothing selected would throw inside the evaluate and kill the
	// probe instead of producing a FAIL line — the same reason `probe-cruise`
	// returns `noStation`.
	if (!t) return { noTarget: true, targetId: g.targetId };
	const targetKm = Math.hypot(
		t.pos.x - g.world.ship.pos.x,
		t.pos.y - g.world.ship.pos.y,
		t.pos.z - g.world.ship.pos.z,
	);

	// And the same readout in the one state where an *absolute* speed flatters
	// it: **assist off**, flying fast across the target rather than towards it.
	//
	// The construction matters. With the assist on, `stepFlight` caps total
	// velocity at 2 km/s, which is also the estimate's floor — so absolute and
	// closing agree there and no test built on that state can tell them apart.
	// The first version of this check was built on it and passed against the bug
	// it was written for. Assist off is Newtonian and uncapped, which is exactly
	// how the principal was flying when he first met this panel.
	const to = {
		x: t.pos.x - g.world.ship.pos.x,
		y: t.pos.y - g.world.ship.pos.y,
		z: t.pos.z - g.world.ship.pos.z,
	};
	const len = Math.hypot(to.x, to.y, to.z);
	// A vector across the line of sight: fast, and closing on nothing.
	const across = { x: -to.y / len, y: to.x / len, z: 0 };
	const crossKms = 20;
	g.assist = false;
	g.setThrottle(0);
	g.world.ship.vel = {
		x: across.x * crossKms,
		y: across.y * crossKms,
		z: across.z * crossKms,
	};
	g.world.gameTime += 1;
	await new Promise((r) => requestAnimationFrame(() => r()));
	await new Promise((r) => requestAnimationFrame(() => r()));
	const hudTextMatched = document.getElementById("hud").textContent;
	const carriedKms = crossKms;

	return {
		hudText,
		hudTextMatched,
		carriedKms,
		targetKm,
		regime: g.regime,
		assistCapKms: g.assistCapKms,
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

// The panel has to say that this regime cannot get there, and what to do about
// it. A blank `eta —` is what the first flight of this build actually saw: full
// throttle, 0.837 AU, and no indication that normal flight would need two years
// or that a keypress existed.
check(
	"in normal flight the panel names the regime that can get there",
	state.regime === "normal" && /press J to cruise/.test(state.hudText),
	state.hudText.split("\n")[1] ?? state.hudText,
);
check(
	"and reports an honest eta for the regime the ship is actually in",
	// Two years at 2 km/s reads in days, never in seconds and never as a blank.
	/eta \d+(\.\d+)?d/.test(state.hudText),
	`${(state.targetKm / state.assistCapKms / 86400).toFixed(0)} d at the assist cap`,
);

// The blocker this check was written for: `timeToTarget` computed the
// normal-flight estimate from the ship's *absolute* speed, while the panel
// beside it argues — correctly — that only closing speed answers "will I
// arrive". Flying across the target at 20 km/s with the assist off closes on it
// at nothing, and an absolute figure reports the leg ten times faster than the
// ship is actually approaching. Neither the boot state nor a velocity-matched
// one can catch that: both sit at or under the estimate's own 2 km/s floor.
const daysMatched = /eta (\d+)d/.exec(state.hudTextMatched);
const capDays = state.targetKm / state.assistCapKms / 86400;
const absoluteDays = state.targetKm / state.carriedKms / 86400;
check(
	"the eta counts progress toward the target, not speed — flying across it",
	daysMatched !== null && Number(daysMatched[1]) > absoluteDays * 2,
	`reads ${daysMatched?.[1] ?? "—"}d; the cap says ${capDays.toFixed(0)}d, ` +
		`and ${state.carriedKms.toFixed(0)} km/s of crossing motion would say ` +
		`${absoluteDays.toFixed(0)}d if it counted as progress`,
);

await browser.close();
exit();
