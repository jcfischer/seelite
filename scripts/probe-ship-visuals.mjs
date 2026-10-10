/** Prove the live renderer exposes #35's hull identity only where it is useful:
 * chase view. Cockpit remains the instrument-first flight view. */
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const VIEWPORTS = [
	{ name: "desktop", width: 1280, height: 760 },
	{ name: "narrow", width: 390, height: 844 },
];

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

async function state() {
	const { COURIER_FRAME_NAME } = await import("/src/courier-hull.ts");
	const game = window.__seelite;
	const ship = game.shipMesh;
	const cockpit = document.querySelector("[data-live-cockpit]");
	return {
		view: game.view,
		shipVisible: ship.visible,
		hullId: ship.userData.hullId,
		variant: ship.userData.variant,
		chaseYaw: game.chaseYaw,
		chaseElevation: game.chaseElevation,
		// The near camera sits at the origin, so the hull's own position is the
		// camera-relative one. That makes it the honest observable for an orbit:
		// a camera swinging round the ship must turn this vector without
		// changing its length.
		shipOffset: ship.position.toArray(),
		// The authored O4 model (node #812), not the procedural Kestrel's
		// named parts, and its two drive glows wherever the frame holds them.
		courierCore:
			ship.userData.authored === true &&
			Boolean(ship.getObjectByName(COURIER_FRAME_NAME)) &&
			Boolean(ship.getObjectByName("canopy-glass")),
		exhausts: (() => {
			let found = 0;
			ship.traverse((child) => {
				if (child.name.endsWith("-exhaust")) found += 1;
			});
			return found;
		})(),
		// Chase shows the player's hull and nothing else. The count is asserted
		// rather than the absence of two old names, so a future extra hull
		// parented here has to be a deliberate change to this line.
		hulls: (() => {
			let found = 0;
			game.nearScene.traverse((child) => {
				if (child.userData.hullId !== undefined) found += 1;
			});
			return found;
		})(),
		fleet: game.nearScene.getObjectByName("fleet-review")?.children.length ?? 0,
		liveCockpit:
			cockpit instanceof HTMLElement &&
			getComputedStyle(cockpit).display !== "none",
		physicalCockpit:
			Boolean(game.cabinScene.getObjectByName("cockpit")?.visible) &&
			["flight-instrument", "target-instrument", "scanner"].every((name) =>
				Boolean(game.cabinScene.getObjectByName(name)),
			),
		duplicateDomFloor: Boolean(document.querySelector("[data-live-floor]")),
	};
}

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	watch(page, viewport.name);
	await page.goto(gameUrl(ORIGIN, { seed: 42 }), { waitUntil: "load" });
	await page.waitForFunction(() => window.__seelite?.frames > 1);
	const cockpit = await page.evaluate(state);
	check(
		`${viewport.name}: cockpit keeps the hull out of the flight view`,
		cockpit.view === "cockpit" &&
			!cockpit.shipVisible &&
			cockpit.liveCockpit &&
			cockpit.physicalCockpit &&
			!cockpit.duplicateDomFloor,
	);
	// Node #831 boots with the Kestrel; this row measures the authored hull.
	await page.evaluate(() => window.__seelite.loadCourierHullAfterBoot());
	await page.keyboard.press("v");
	// Visibility is written by render after the view changes in the key handler.
	// Waiting on the drawn state cannot be satisfied by frames before the press.
	await page.waitForFunction(
		() =>
			window.__seelite?.view === "chase" && window.__seelite.shipMesh.visible,
	);
	const chase = await page.evaluate(state);
	check(
		`${viewport.name}: chase exposes the named courier silhouette`,
		chase.view === "chase" &&
			chase.shipVisible &&
			chase.hullId === "courier" &&
			chase.variant === "a" &&
			chase.courierCore &&
			chase.exhausts === 2 &&
			chase.hulls === 1 &&
			!chase.liveCockpit,
	);
	// Orbit to port and hold until the camera has swung a good part of a
	// quarter turn, rather than sleeping for a guessed number of frames.
	await page.keyboard.down("1");
	const orbitMoved = await page
		.waitForFunction(() => window.__seelite?.chaseYaw < -0.6, null, {
			timeout: 4000,
		})
		.then(
			() => true,
			() => false,
		);
	await page.keyboard.up("1");
	const orbited = await page.evaluate(state);
	const length = (v) => Math.hypot(v[0], v[1], v[2]);
	const alignment =
		orbited.shipOffset.reduce((sum, n, i) => sum + n * chase.shipOffset[i], 0) /
		(length(orbited.shipOffset) * length(chase.shipOffset));
	check(
		`${viewport.name}: chase orbit turns the camera round the hull at a fixed range`,
		orbitMoved &&
			orbited.view === "chase" &&
			orbited.shipVisible &&
			orbited.chaseYaw < -0.6 &&
			alignment < 0.95 &&
			Math.abs(length(orbited.shipOffset) - length(chase.shipOffset)) < 1e-6,
	);

	// `2` zeroes the whole orbit pose in the key handler — the elevation the
	// pointer sets as well as the yaw (node #691), so one is raised first; render
	// then restores the astern offset. Wait for that offset itself so earlier
	// frames cannot satisfy it.
	await page.evaluate(() => {
		window.__seelite.chaseElevation = 0.6;
	});
	await page.keyboard.press("2");
	await page.waitForFunction(
		(offset) =>
			window.__seelite.chaseYaw === 0 &&
			window.__seelite.chaseElevation === 0 &&
			window.__seelite.shipMesh.position
				.toArray()
				.every((n, i) => Math.abs(n - offset[i]) < 1e-6),
		chase.shipOffset,
	);
	const centred = await page.evaluate(state);
	check(
		`${viewport.name}: 2 returns the chase camera astern`,
		centred.chaseYaw === 0 &&
			centred.chaseElevation === 0 &&
			centred.shipOffset.every(
				(n, i) => Math.abs(n - chase.shipOffset[i]) < 1e-6,
			),
	);

	await page.keyboard.press("v");
	await page.waitForFunction(() => window.__seelite?.view === "cockpit");
	// The orbit is a chase control. Holding it in the cockpit must not quietly
	// steer a camera the player cannot see moving.
	await page.keyboard.down("1");
	await page.waitForTimeout(220);
	await page.keyboard.up("1");
	const returned = await page.evaluate(state);
	check(
		`${viewport.name}: the orbit key does not move the camera in cockpit view`,
		returned.chaseYaw === 0,
	);
	check(
		`${viewport.name}: returning to cockpit restores instrument priority`,
		returned.view === "cockpit" &&
			!returned.shipVisible &&
			returned.liveCockpit &&
			returned.physicalCockpit &&
			!returned.duplicateDomFloor,
	);
	await page.close();
}

// The review avenue is gated, so the default game has to be proved clean of it
// and the gate proved to actually place hulls in the world — not parented to
// the player, which is the mistake the samples it replaces made.
for (const viewport of VIEWPORTS.slice(0, 1)) {
	const page = await browser.newPage({ viewport });
	watch(page, `${viewport.name} fleet`);
	await page.goto(gameUrl(ORIGIN, { seed: 42 }), { waitUntil: "load" });
	await page.waitForFunction(() => window.__seelite?.frames > 1);
	const ungated = await page.evaluate(state);
	check(
		`${viewport.name}: the default game carries no review fleet`,
		ungated.fleet === 0 && ungated.hulls === 1,
	);

	await page.goto(gameUrl(ORIGIN, { seed: 42, fleet: true }), {
		waitUntil: "load",
	});
	await page.waitForFunction(() => window.__seelite?.frames > 2);
	const gated = await page.evaluate(() => {
		const game = window.__seelite;
		const fleet = game.nearScene.getObjectByName("fleet-review");
		const ship = game.world.ship.pos;
		// A hull's position here is its offset from the camera in *world* axes,
		// and the ship does not boot facing world -Z. Rotate into the ship's own
		// frame before asking whether something is in front of it.
		const intoShipFrame = game.orientation.clone().invert();
		const hulls = fleet.children.map((hull) => ({
			name: hull.name,
			ahead: hull.position.clone().applyQuaternion(intoShipFrame).z,
			range: Math.hypot(...hull.position.toArray()),
		}));
		return {
			count: fleet.children.length,
			displayOnly: fleet.userData.displayOnly === true,
			// Parked in the world, not on the player: nothing here appears in the
			// sim's body list, and so nothing can be targeted or scanned.
			simBodies: game.world.system.bodies.filter((body) =>
				String(body.id).startsWith("fleet"),
			).length,
			nearest: Math.min(...hulls.map((hull) => hull.range)),
			farthest: Math.max(...hulls.map((hull) => hull.range)),
			allAhead: hulls.every((hull) => hull.ahead < 0),
			shipMoved: ship,
		};
	});
	check(
		`${viewport.name}: the gate parks every hull ahead of the player`,
		// Twelve hulls × three variants since #331; a literal, for the reason
		// probe-display-contacts gives.
		gated.count === 36 &&
			gated.displayOnly &&
			gated.simBodies === 0 &&
			gated.allAhead &&
			gated.nearest > 0.1 &&
			gated.farthest > 20,
	);
	await page.close();
}

/**
 * #101's hull surface: the maps are on the materials, the patch landed, and the
 * seam map is *reaching the frame*.
 *
 * The last one is the point. The map's own finding (#69) is that a renderer's
 * record cannot prove anything was painted — a material carrying a `normalMap`
 * property proves the assignment ran, not that a single fragment sampled it, and
 * a splice that missed its marker leaves a stock material that links, renders and
 * reports its own name. So the frame is measured twice, with the seam map on and
 * off, over the pixels the hull actually occupies. If the map is not reaching the
 * shader the two frames are identical, and this goes red.
 *
 * The quality setting is the switch because it is the one the game already has:
 * `low` drops exactly this term (`settings.ts`), so the control costs nothing to
 * build and the probe checks the shipped gate at the same time.
 */
{
	const page = await browser.newPage({ viewport: VIEWPORTS[0] });
	watch(page, "hull surface");
	// On a procedural hull: the courier draws its authored model since node
	// #812, which carries its own textures and none of #101's plating, so the
	// plating is checked where it still ships — a fresh game's `?hull=`.
	await page.goto(gameUrl(ORIGIN, { seed: 42, hull: "interceptor" }), {
		waitUntil: "load",
	});
	await page.waitForFunction(() => window.__seelite?.frames > 1);
	// Chase, so the hull is in front of the camera and fills enough of the frame
	// for a plate to be more than one pixel across.
	await page.keyboard.press("v");
	await page.waitForFunction(() => window.__seelite?.view === "chase");

	const surface = await page.evaluate(() => {
		const g = window.__seelite;
		const ship = g.shipMesh;
		const materials = new Set();
		ship.traverse((child) => {
			const material = child.material;
			if (material?.userData?.hullSplices) materials.add(material);
		});
		const all = [...materials];
		/*
		 * The shape every check reads, with nothing in it.
		 *
		 * One literal, spread into both returns, because the bail and the real
		 * result have to carry the same fields and keeping two lists in step by
		 * hand is how they diverge: the first bail returned `{ materials: 0 }`
		 * alone and the third check still crashed on `undefined.length` — the
		 * same defect one line further down from the one it fixed.
		 */
		const EMPTY = {
			materials: 0,
			maps: [],
			splices: 0,
			splicesLanded: 0,
			withSeams: [],
			withoutSeams: [],
			hullPixels: 0,
			moved: 0,
			stdev: 0,
		};
		// No patched material means the hull has not been built or drawn, which
		// the checks should report as named failures rather than as a TypeError
		// in the runner.
		if (!all.length) return EMPTY;
		const splices = all.flatMap((m) => Object.values(m.userData.hullSplices));
		const W = 480;
		const H = 300;
		const src = g.renderer.domElement;
		const scratch = document.createElement("canvas");
		scratch.width = W;
		scratch.height = H;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const frame = () => {
			// Render and read in the same task: a WebGL canvas without
			// `preserveDrawingBuffer` is cleared at the next composite.
			g.render(0);
			ctx.drawImage(src, 0, 0, W, H);
			return ctx.getImageData(0, 0, W, H).data;
		};
		const restore = g.settings.value.quality;
		// **High before the bare frame**, for `probe-light-rig.mjs`'s reason: the
		// mask and the frame it is differenced against must be one configuration,
		// or on a page whose stored setting is `low` the mask stops being the
		// hull.
		g.settings.set("quality", "high");
		// **Removed from the scene, not hidden.** `render` assigns
		// `shipMesh.visible = view === "chase"` on every frame, so clearing the
		// flag and re-rendering gives the hull straight back — the mask came out
		// empty and both measurements below read zero while every record-level
		// check stayed green. Re-parenting is the one lever the frame loop does
		// not own.
		const parent = ship.parent;
		parent.remove(ship);
		const bare = frame();
		parent.add(ship);
		const high = frame();
		const withSeams = all.map((m) => Boolean(m.normalMap));

		/*
		 * **The lever is the seam map's texels, not whether it is attached** —
		 * and this check took two wrong levers before this one.
		 *
		 * First it toggled the quality setting. That passed at 30.3% of hull
		 * pixels on a build whose seam map was generated *flat*, because `low`
		 * also drops the baked environment (#99): the check was reading someone
		 * else's term and reporting it as this node's.
		 *
		 * Then it nulled `material.normalMap`. That passed at 29.0% on the same
		 * flat build, because attaching *any* normal map changes three.js's own
		 * defines and sends the fragment down `perturbNormal2Arb` with a
		 * screen-space tangent frame. The presence of the map moves pixels on
		 * its own; what this node added is the map's content.
		 *
		 * So the bytes are overwritten in place and the texture — not the
		 * material — is marked dirty. Same program, same defines, same sampler:
		 * the only thing that changes is what it reads. On a flat build this
		 * writes flat over flat and the difference is exactly zero, which is
		 * what makes it a check rather than a reading.
		 */
		const seamTexture = all[0].normalMap;
		// The same defect the `EMPTY` literal above was added for, one lever
		// further down: with no map attached this throws and the run reports a
		// runner crash where `the quality gate adds and removes the seam map`
		// should have failed by name.
		if (!seamTexture) {
			g.settings.set("quality", restore);
			return { ...EMPTY, materials: all.length, withSeams };
		}
		const texels = seamTexture.image.data;
		const original = texels.slice();
		for (let i = 0; i < texels.length; i += 4) {
			texels[i] = 128;
			texels[i + 1] = 128;
			texels[i + 2] = 255;
		}
		seamTexture.needsUpdate = true;
		const flat = frame();
		texels.set(original);
		seamTexture.needsUpdate = true;
		frame();

		g.settings.set("quality", "low");
		frame();
		const withoutSeams = all.map((m) => Boolean(m.normalMap));
		g.settings.set("quality", restore);
		frame();

		const luma = (d, i) =>
			0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
		let hullPixels = 0;
		let moved = 0;
		let spread = 0;
		let sum = 0;
		const values = [];
		for (let i = 0; i < high.length; i += 4) {
			// A pixel is the hull's where hiding it changed the frame. Two levels
			// rather than any, so the starfield the hull occludes does not join
			// the mask.
			if (Math.abs(luma(high, i) - luma(bare, i)) < 3) continue;
			hullPixels++;
			const here = luma(high, i);
			values.push(here);
			sum += here;
			if (Math.abs(here - luma(flat, i)) >= 1) moved++;
		}
		const mean = hullPixels ? sum / hullPixels : 0;
		for (const v of values) spread += (v - mean) ** 2;
		return {
			...EMPTY,
			materials: all.length,
			maps: all.map((m) => ({
				map: Boolean(m.map),
				roughnessMap: Boolean(m.roughnessMap),
				metalnessMap: Boolean(m.metalnessMap),
			})),
			splices: splices.length,
			splicesLanded: splices.filter(Boolean).length,
			withSeams,
			withoutSeams,
			hullPixels,
			moved,
			// The control for the measurement below: a hull rendered as one flat
			// value would report a large `hullPixels` and a spread near zero, and
			// no difference between the two frames would then mean anything.
			stdev: hullPixels ? Math.sqrt(spread / hullPixels) : 0,
		};
	});

	check(
		`hull surface: every plated material carries its three maps`,
		surface.materials >= 3 &&
			surface.maps.every((m) => m.map && m.roughnessMap && m.metalnessMap),
		`${surface.materials} material(s)`,
	);
	check(
		// A count as well as an equality: the log is written when a material is
		// plated and filled when its program links, so an empty log is "not
		// compiled" rather than "nothing missed" — and `0 === 0` would pass it.
		`hull surface: every shader splice found its marker`,
		surface.splices > 0 && surface.splicesLanded === surface.splices,
		`${surface.splicesLanded}/${surface.splices}`,
	);
	check(
		`hull surface: the quality gate adds and removes the seam map`,
		surface.withSeams.length > 0 &&
			surface.withSeams.every(Boolean) &&
			surface.withoutSeams.every((on) => !on),
	);
	check(
		`hull surface: the hull is drawn, and drawn with variation in it`,
		surface.hullPixels > 500 && surface.stdev > 2,
		`${surface.hullPixels} px, stdev ${surface.stdev.toFixed(1)}`,
	);
	/**
	 * **The floor moved from 5% to 3% in #201, and the reason is a measurement.**
	 *
	 * The lever is still the seam map's own bytes — flat texels written over the
	 * real ones — so a map that has gone flat or stopped being sampled still
	 * reads exactly zero and this still catches it. What changed is the size of
	 * the signal, because #201 put the star's shadow on the hull and an
	 * ambient-occlusion pass over it, and both subtract from the direct light
	 * the seam map is most visible in. Measured on one build, same framing, with
	 * those two passes off and on: **6.6%** against **3.9%** of hull pixels
	 * moved. The off reading reproduces the pre-#201 build's 6.3%, so nothing
	 * else moved.
	 *
	 * 3% leaves the same headroom over the shipped reading that 5% left over the
	 * old one — about a quarter — so the check is no weaker than it was. It is
	 * simply measuring a hull with occlusion on it. **The 40% reduction in the
	 * seam map's visible contribution is a real change to the picture** and the
	 * canonical sheet is where it is judged, not here.
	 *
	 * Pinning the occlusion off inside the measurement was tried first and is
	 * worse: toggling `setOcclusion` between the frames of one evaluate reported
	 * 13.2% — double the unoccluded baseline — and a warm frame did not fix it,
	 * so whatever it measures is not the seam map.
	 */
	check(
		`hull surface: the seam map reaches the frame`,
		surface.moved / Math.max(1, surface.hullPixels) > 0.03,
		`${((surface.moved / Math.max(1, surface.hullPixels)) * 100).toFixed(1)}% of hull pixels moved`,
	);
	await page.close();
}

await browser.close();
exit();
