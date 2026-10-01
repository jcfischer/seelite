/**
 * Chase view's weapons and cues (#607), in the running game.
 *
 *   npm run probe:one probe-chase-view
 *
 * Every row is taken with the chase camera **orbited** off the ship's axis.
 * Unorbited, the camera's rotation and the ship's are the same, so a row
 * there passes on the build that confused them.
 *
 * Each pixel is checked against **Three.js's own projection** of what the
 * renderer drew, through the camera that drew it, as `probe-hud.mjs` does.
 * The overlay places cues by direction with `hud.ts`'s arithmetic. Two
 * independent routes to one pixel catch a cue that is self-consistently in
 * the wrong place.
 *
 * - **every placed cue holds its body while the chase camera orbits** (F1):
 *   with a control that projects the same directions through the ship's
 *   frame, the pre-#607 arithmetic, and must miss by far more.
 * - **the gun is bolted to the hull** (D1): orbiting does not move the aim,
 *   which is the ship's nose, from the ship.
 * - **the ship-fixed cues are the cockpit's** (D2) and **chase draws a
 *   boresight pip on the nose's pixel** (D4).
 * - **the beam starts on each muzzle's pixel** (D3, D5): one beam per
 *   hardpoint, from the muzzle projected off the drawn hull.
 *
 * This is a default-layout probe (#381 D11): `v` is the view toggle and
 * Space the trigger in the shipped layout. The rows check the view changed and
 * a beam was drawn, so a dead key fails them rather than passes.
 */
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
const URL = gameUrl(
	ORIGIN,
	{ seed: 42, raider: "off" },
	{ override: process.env.PROBE_URL },
);

/** A pixel's tolerance in NDC: 0.004 of a 900-pixel viewport is under two
 *  pixels. The failure this catches is a tenth of the screen. */
const EPS_NDC = 4e-3;
/** The chase orbit every row is taken at, radians: well off the axis. */
const ORBIT = 0.7;
/** The pip's orbit: off the axis, with the nose still in frame. At `ORBIT`
 *  the nose is 40° off the camera, at the frame's edge at this aspect. */
const PIP_ORBIT = 0.35;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await installCamSim(page);
await page.goto(URL, { waitUntil: "load" });
await bootedGame(page);

// Into flight, facing the selected target, then the view key.
await page.evaluate(async () => {
	const g = window.__seelite;
	g.resetFlightToStart();
	g.faceTarget();
	await new Promise((r) => requestAnimationFrame(() => r()));
});
await page.keyboard.press("v");

/** Wait two frames, so what is read was drawn after the last write. */
const frames = () =>
	page.evaluate(async () => {
		for (let i = 0; i < 2; i++)
			await new Promise((r) => requestAnimationFrame(() => r()));
	});

const measure = (orbit) =>
	page.evaluate(
		async ([orbit]) => {
			const g = window.__seelite;
			g.chaseYaw = orbit;
			for (let i = 0; i < 2; i++)
				await new Promise((r) => requestAnimationFrame(() => r()));
			const { projectDirection } = await import("/src/hud.ts");
			const cam = window.__recoverCamSim();
			const fov = (g.nearCamera.fov * Math.PI) / 180;
			const bodies = [];
			for (const body of g.world.system.bodies) {
				const nearMesh = g.nearScene.getObjectByName(body.id);
				const mesh = nearMesh ?? g.farScene.getObjectByName(body.id);
				if (!mesh) continue;
				const three = mesh.position
					.clone()
					.project(nearMesh ? g.nearCamera : g.farCamera);
				const d = {
					x: body.pos.x - cam.x,
					y: body.pos.y - cam.y,
					z: body.pos.z - cam.z,
				};
				const cue = g.markerNdc(d);
				// The pre-#607 arithmetic: the same direction through the ship.
				const old = projectDirection(
					d,
					g.orientation,
					fov,
					g.nearCamera.aspect,
				);
				if (cue.behind || !cue.onScreen || three.z > 1) continue;
				bodies.push({
					id: body.id,
					err: Math.hypot(cue.ndcX - three.x, cue.ndcY - three.y),
					oldErr: Math.hypot(old.ndcX - three.x, old.ndcY - three.y),
				});
			}
			return {
				view: g.view,
				chaseYaw: g.chaseYaw,
				bodies,
				aim: g.weaponAim(),
				nose: g.nose(),
				origin: g.weaponOrigin(),
				ship: { ...g.world.ship.pos },
			};
		},
		[orbit],
	);

const at0 = await measure(0);
const orbited = await measure(ORBIT);
check(
	"the probe is in chase view, orbited off the axis",
	orbited.view === "chase" && orbited.chaseYaw === ORBIT,
	`${orbited.view}, chaseYaw ${orbited.chaseYaw}`,
);
{
	const worst = Math.max(...orbited.bodies.map((b) => b.err));
	const oldBest = Math.min(...orbited.bodies.map((b) => b.oldErr));
	check(
		"every placed cue lands on its body's drawn pixel while the chase camera orbits (#607 F1)",
		orbited.bodies.length > 0 && worst < EPS_NDC,
		`${orbited.bodies.length} bodies on screen; worst ${worst.toExponential(2)} NDC against ${EPS_NDC}`,
	);
	check(
		"control: the ship-frame projection misses every one of them by far more",
		orbited.bodies.length > 0 && oldBest > 25 * EPS_NDC,
		`closest miss ${oldBest.toFixed(3)} NDC`,
	);
}
{
	const diff = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
	check(
		"the gun is bolted to the hull: orbiting does not turn it, and it fires from the ship (#607 D1)",
		diff(at0.aim, orbited.aim) < 1e-9 &&
			diff(orbited.aim, orbited.nose) < 1e-9 &&
			diff(orbited.origin, orbited.ship) < 1e-9,
		`aim moved ${diff(at0.aim, orbited.aim).toExponential(2)}; off the nose ${diff(orbited.aim, orbited.nose).toExponential(2)}; origin ${diff(orbited.origin, orbited.ship).toExponential(2)} km from the ship`,
	);
}

// The ship-fixed cues, and the pip on the nose.
const cues = await page.evaluate(async (pipOrbit) => {
	const g = window.__seelite;
	g.chaseYaw = pipOrbit;
	for (let i = 0; i < 2; i++)
		await new Promise((r) => requestAnimationFrame(() => r()));
	const ship = g.nearScene.getObjectByName("ship");
	const overlay = document.getElementById("overlay");
	const { ndcToPx } = await import("/src/hud.ts");
	const nose = ship.position.clone();
	const forward = ship.position
		.clone()
		.set(0, 0, -1)
		.applyQuaternion(ship.quaternion);
	// A point far down the nose: its pixel is the nose's direction.
	const far = nose.add(forward.multiplyScalar(1e4)).project(g.nearCamera);
	return {
		floor: g.floorRender,
		pip: g.boresightRender,
		three: ndcToPx({ ndcX: far.x, ndcY: far.y }, overlay.width, overlay.height),
		width: overlay.width,
	};
}, PIP_ORBIT);
check(
	"chase draws no flight floor (#607 D2)",
	cues.floor === null,
	`floorRender ${cues.floor === null ? "null" : "drawn"}`,
);
{
	const off = cues.pip
		? Math.hypot(cues.pip.x - cues.three.x, cues.pip.y - cues.three.y)
		: Number.POSITIVE_INFINITY;
	check(
		"chase draws the boresight pip on the drawn nose's pixel (#607 D4)",
		off < (EPS_NDC / 2) * cues.width,
		cues.pip
			? `pip ${off.toFixed(2)} px from the nose's projected pixel`
			: "no pip drawn",
	);
}

// The beam: the trigger held, through the game's own keys.
await page.keyboard.down("Space");
await page.waitForTimeout(250);
const beam = await page.evaluate(async () => {
	const g = window.__seelite;
	const { shipMuzzlesKm } = await import("/src/ship-mesh.ts");
	const { HULL_SPECS } = await import("/src/hull.ts");
	const ship = g.nearScene.getObjectByName("ship");
	ship.updateMatrixWorld(true);
	const overlay = document.getElementById("overlay");
	const { ndcToPx } = await import("/src/hud.ts");
	const muzzles = shipMuzzlesKm(
		g.flownHull,
		HULL_SPECS[g.flownHull].variant,
	).map((m) => {
		const p = ship
			.localToWorld(ship.position.clone().set(m.x, m.y, m.z))
			.project(g.nearCamera);
		return ndcToPx({ ndcX: p.x, ndcY: p.y }, overlay.width, overlay.height);
	});
	// The route that does not share the muzzles' data: a ray from the camera
	// through each drawn start must strike the drawn hull. A beam starting in
	// empty space beside the ship misses it. The optimised dep, the app's own
	// instance (`measure-mouth-flicker.mjs`).
	const THREE = await import("/node_modules/.vite/deps/three.js");
	const caster = new THREE.Raycaster();
	const onHull = (g.beamRender ?? []).map((s) => {
		caster.setFromCamera(
			new THREE.Vector2(
				(s.from.x / overlay.width) * 2 - 1,
				1 - (s.from.y / overlay.height) * 2,
			),
			g.nearCamera,
		);
		return caster.intersectObject(ship, true).some((h) => h.face);
	});
	return {
		hull: g.flownHull,
		hardpoints: HULL_SPECS[g.flownHull].hardpoints,
		drawn: g.beamRender,
		muzzles,
		onHull,
		width: overlay.width,
	};
});
await page.keyboard.up("Space");
{
	const starts = beam.drawn ?? [];
	const offs = beam.muzzles.map((m) =>
		Math.min(...starts.map((s) => Math.hypot(s.from.x - m.x, s.from.y - m.y))),
	);
	check(
		"the chase beam starts on each muzzle's drawn pixel, one per hardpoint (#607 D3, D5)",
		starts.length === beam.hardpoints &&
			offs.every((o) => o < (EPS_NDC / 2) * beam.width),
		beam.drawn
			? `${beam.hull}: ${starts.length} beams for ${beam.hardpoints} hardpoints; ${offs.map((o) => o.toFixed(2)).join(", ")} px from the muzzles`
			: "no beam drawn",
	);
	// Independent of the muzzle data the draw and the row above both read: a
	// ray from the camera through each drawn start strikes the drawn hull.
	check(
		"each beam starts on the drawn hull's image, not in space beside it (sage round 2 on #608)",
		beam.onHull.length === beam.hardpoints && beam.onHull.every(Boolean),
		`ray through each start hits the hull: ${JSON.stringify(beam.onHull)}`,
	);
}

// And the cockpit is as it was.
await page.keyboard.press("v");
await frames();
const cockpit = await page.evaluate(() => {
	const g = window.__seelite;
	return {
		view: g.view,
		floor: g.floorRender !== null,
		pip: g.boresightRender,
	};
});
check(
	"back in the cockpit, the floor is drawn and there is no pip",
	cockpit.view === "cockpit" && cockpit.floor && cockpit.pip === null,
	JSON.stringify(cockpit),
);

await browser.close();
exit();
