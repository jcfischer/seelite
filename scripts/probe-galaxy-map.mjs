/**
 * The galaxy map's browser tier — node #11.
 *
 * The headless suite owns the arithmetic: `tests/galaxy-route.test.ts` proves
 * the chains are optimal and the courses parse. What it cannot reach is the
 * thing the node was actually deciding — whether a **freely orbited** cluster
 * of 256 systems can be read and picked at all. Depth ambiguity is a fact about
 * a projection and a viewport, so it is measured here.
 *
 * Three checks carry that, and each is built so a wrong build fails it.
 *
 * **Picking is screen-space, and the check is the boundary rather than the
 * centre.** The first version of this clicked the exact projected centre of an
 * isolated point and asserted the right system was selected, at two zooms —
 * which a world-space raycast passes trivially, because ray-to-point distance
 * at the centre is ≈ 0 whatever the camera is doing. It verified nothing about
 * the thing its own comment claimed. What discriminates is where the target
 * *stops*: a screen-space pick has the same pixel boundary at every zoom, and a
 * world-space one cannot, so the probe clicks just inside and just outside the
 * radius at two camera distances and requires all four verdicts.
 *
 * **Crowding is measured over systems that are actually on screen.** It once
 * filtered only `behind`, so the zoomed-in sample counted pairs that had left
 * the viewport — and `galaxy-map.md` §5.1 reports the same quantity as "systems
 * on screen". The figure is now taken from a reset view, so the spec's table is
 * reproducible from this file.
 *
 * **The haze is a background channel.** Turning it on must not move a single
 * projected point.
 */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
/**
 * `crowding` is §5.1's measured figure at the default framing, ± the band a
 * change to the projection or the pick radius has to stay inside.
 *
 * **Per viewport, because the figure is.** One band across both was calibrated
 * on the desktop 40.2% and merely accommodated the narrow 38.7%, so the narrow
 * run reported a verdict against a threshold nobody had set for it. Each is now
 * its own measurement with its own band — still wide, because this is a
 * regression guard rather than a tuning target, but each end is a number
 * somebody measured at that width.
 *
 * ## Re-measured for the q = 0.7 disc (#118), and re-based on the spread
 *
 * The disc invalidated both bands, and #107's instruction was that they be
 * **re-measured rather than widened**. They were: this probe was run over all
 * eight galaxies at each viewport, and the band is that spread ± 4 points.
 *
 * ```
 *              galaxy 0..7                                   spread     band
 * desktop  44.5 41.0 40.2 40.6 48.0 47.3 39.8 41.0        39.8-48.0   36-52
 * narrow   43.6 33.5 42.0 33.9 50.5 43.6 39.4 39.5        33.5-50.5   29-55
 * ```
 *
 * **The desktop band tightened and the narrow one widened, and the widening is
 * the fix rather than the evasion.** #107 found that §5.1 quoted 40.2% as
 * though it were a constant when it is one galaxy of a 13-point spread. The old
 * narrow band of 29-49 was set from galaxy 0 alone, and galaxy 4 measures 50.5
 * — so that band was already outside its own subject and passed only because
 * the probe mounts galaxy 0. A band set from one sample is not a tighter band,
 * it is an untested one.
 *
 * **This band does not police the shape**, and is not asked to: it guards the
 * projection and the pick radius. The disc is asserted directly by the
 * edge-on/face-on aspect check below, which fails flat on a ball.
 */
const VIEWPORTS = [
	{
		name: "desktop",
		width: 1280,
		height: 760,
		crowding: { measured: 0.445, min: 0.36, max: 0.52 },
	},
	{
		name: "narrow",
		width: 390,
		height: 844,
		crowding: { measured: 0.436, min: 0.29, max: 0.55 },
	},
];

const nextFrame = (page) =>
	page.evaluate(
		() =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	);

await guardedOrigin(ORIGIN, ["src/galaxy-map.ts", "src/galaxy-route.ts"]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/**
 * §2's flattening, as a literal.
 *
 * A probe that reads a constant off the page cannot check that constant, and
 * this file's own rule is that a probe should not restate one. Both are true and
 * they pull opposite ways, so the split is: the *band* uses this literal, and
 * the page's reported `flatteningQ` is asserted equal to it in its own check.
 * Changing §2's shape then fails here, by name, instead of quietly re-aiming the
 * measurement at the new value.
 */
const EXPECTED_Q = 0.7;

/**
 * Which viewports actually framed the cluster and so measured the disc.
 *
 * Asserted after the loop, so a skip cannot become a silent retirement — and
 * asserted **by name**, not as a count. `discMeasured >= 1` was satisfied by
 * desktop alone while narrow is documented as always skipping, so the floor
 * encoded nothing: a change that also cropped desktop would have to drop the
 * count to zero to be caught, and by then the check is gone from both. Naming
 * desktop is what makes "desktop must keep measuring this" a thing the suite
 * knows rather than a thing this comment claims.
 */
const discMeasured = new Set();

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({
		viewport: { width: viewport.width, height: viewport.height },
	});
	watch(page, viewport.name);
	await page.goto(`${ORIGIN}/?galaxy-map=0`, { waitUntil: "load" });
	await page.waitForSelector("#galaxy-map canvas");
	await nextFrame(page);

	const initial = await page.evaluate(() => {
		const canvas = document.querySelector("#galaxy-map canvas");
		return {
			state: window.__seeliteGalaxyMap?.state,
			canvasWide: canvas instanceof HTMLCanvasElement && canvas.width > 0,
			gameConstructed: Boolean(window.__seelite),
			cardShown: getComputedStyle(document.querySelector("[data-map-record]"))
				.display,
		};
	});

	check(
		`${viewport.name}: the chart mounts one galaxy, no live game behind it`,
		initial.canvasWide &&
			!initial.gameConstructed &&
			initial.state?.systemCount === 256 &&
			initial.state?.galaxy === 0 &&
			// **A plausibility bracket, not a copy of the constant.** This read
			// `=== 22` and went red on #118 for reshaping the galaxy, which is
			// the failure mode `CLAUDE.md` names: a probe holding its own copy of
			// a module's constant fails when the module changes it, and says
			// nothing about the chart. What this check is for is that the chart
			// mounted the real generator rather than a stub, so the bracket is
			// wide and the disc itself is measured below.
			initial.state?.galaxyRadiusLy > 15 &&
			initial.state?.galaxyRadiusLy < 40 &&
			initial.state?.jumpRangeLy === 7,
	);

	// ---- the cluster is a disc, measured rather than declared ---------------

	/**
	 * §2's oblate spheroid, as drawn.
	 *
	 * The chart reports `flatteningQ`, and a check comparing that field to a
	 * literal would prove only that a number survived a getter. What is asserted
	 * instead is the **projected aspect of the drawn points**: seen edge-on the
	 * cluster must be about `q` as tall as it is wide, and seen face-on about
	 * square. A ball fails both halves — it is square at every angle — and so
	 * does a build that squashes the wrong axis.
	 *
	 * **What it does not reach.** `projected()` maps each system's `pos` through
	 * the pivot, so it sees the generator's squash and anything applied to the
	 * pivot transform, but *not* a squash baked into the point cloud's own
	 * geometry buffer — that would move the pixels without moving `pos`, and this
	 * check would pass. Claiming otherwise was an overclaim in an earlier round of
	 * this PR; the honest boundary is that this measures what the *projection* of
	 * the authoritative positions looks like, which is the thing §2's reference
	 * plane rests on.
	 *
	 * Pitch is driven through `orbit` and read back off the state rather than
	 * assumed from the drag: the pitch clamp is +/-1.45, so a probe that computed
	 * the angle from its own pixel arithmetic would silently measure a different
	 * view from the one it names.
	 */
	const aspectAtPitch = (targetPitch) =>
		page.evaluate(async (target) => {
			const map = window.__seeliteGalaxyMap;
			map.select(null);
			map.resetView();
			// Orbit in small steps toward the target, reading the state each time —
			// the drag-to-radians factor is the chart's business, not the probe's.
			// Step toward the target, halving on a genuine overshoot.
			//
			// A fixed drag against a 0.005 rad tolerance can straddle the target
			// and oscillate to the cap, which burns synchronous orbit calls and
			// lands somewhere arbitrary anyway. Two details matter and both were
			// wrong in an earlier version: `previous` is seeded from the *first*
			// delta rather than Infinity (whose sign is 1, so a negative opening
			// delta read as an overshoot and halved the step before anything had
			// been overshot), and the opening step is proportional to the distance
			// rather than a fixed 4, so a far target converges in about log2 steps
			// instead of walking there.
			let delta = target - map.state.pitch;
			let previous = delta;
			let step = Math.max(4, Math.abs(delta) * 40);
			let i = 0;
			for (; i < 400; i++) {
				delta = target - map.state.pitch;
				if (Math.abs(delta) < 0.005) break;
				if (i > 0 && Math.sign(delta) !== Math.sign(previous))
					step = Math.max(step / 2, 0.25);
				previous = delta;
				map.orbit(0, Math.sign(delta) * step);
			}
			if (Math.abs(target - map.state.pitch) > 0.02) {
				// **Throw rather than return an unconverged framing.** Returning it
				// let the aspect check run against a view nobody asked for and
				// report "the cluster is a disc — FAIL", so a stalled orbit
				// produced two failures naming two different defects.
				throw new Error(
					`aspectAtPitch: wanted ${target}, reached ${map.state.pitch} after ${i} steps`,
				);
			}
			await new Promise((r) =>
				requestAnimationFrame(() => requestAnimationFrame(r)),
			);
			const { width, height } = map.viewport();
			const pts = map
				.projected()
				.filter(
					(p) =>
						!p.behind && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height,
				);
			if (pts.length === 0) {
				// **Not a silent NaN.** `Math.max(...[])` is -Infinity, so the
				// spans become NaN, every comparison below is false, and the run
				// reports "skipped the disc aspect" — a broken measurement wearing
				// the skip's name, which is the one thing `discMeasured` exists to
				// stop.
				throw new Error("aspectAtPitch: nothing on screen");
			}
			const xs = pts.map((p) => p.x);
			const ys = pts.map((p) => p.y);
			return {
				pitch: map.state.pitch,
				q: map.state.flatteningQ,
				onScreen: pts.length,
				spanX: Math.max(...xs) - Math.min(...xs),
				spanY: Math.max(...ys) - Math.min(...ys),
				// **The chart's own extents, not the page's.** `spanX` is measured
				// against `map.viewport()`, so comparing it to the page viewport
				// would call a cropped cluster framed on any layout where the
				// canvas is smaller than the window — which §1 says is coming the
				// moment this becomes a Navigation tab.
				width,
				height,
			};
		}, targetPitch);

	const edgeOn = await aspectAtPitch(0);
	const faceOn = await aspectAtPitch(1.45);
	// **Convergence is its own verdict.** `aspectAtPitch` drives the pitch by
	// orbiting and reading the state back, and that loop can run out of steps or
	// step past its tolerance. Folded into the aspect check below, a failure to
	// reach the framing would print "the cluster is a disc — FAIL", which names
	// the wrong defect.
	check(
		`${viewport.name}: the chart reached both framings — pitch ${edgeOn.pitch.toFixed(3)} and ${faceOn.pitch.toFixed(3)} rad`,
		Math.abs(edgeOn.pitch) < 0.02 &&
			faceOn.pitch > 1.4 &&
			edgeOn.onScreen > 150 &&
			faceOn.onScreen > 150,
	);
	await page.evaluate(() => window.__seeliteGalaxyMap.resetView());
	/**
	 * **Only where the cluster is fully framed.** A 390 px column crops the
	 * galaxy horizontally at every distance the chart offers, so `spanX` there is
	 * the viewport's width and the aspect it yields is a fact about the phone,
	 * not about the disc. Measuring it anyway is how a check comes to assert
	 * something nobody meant: the narrow run reported 1.52 against a q of 0.70.
	 *
	 * Skipping is only safe if a skip cannot be silent, so `discMeasured` is
	 * asserted after the loop — a change that crops the desktop view too would
	 * otherwise retire this check without anything going red.
	 */
	const framed =
		Math.max(edgeOn.spanX, faceOn.spanX) < edgeOn.width - 2 &&
		Math.max(edgeOn.spanY, faceOn.spanY) < edgeOn.height - 2;
	const edgeAspect = edgeOn.spanY / edgeOn.spanX;
	const faceAspect = faceOn.spanY / faceOn.spanX;
	if (framed) discMeasured.add(viewport.name);
	check(
		framed
			? `${viewport.name}: the cluster is a disc — edge-on aspect ${edgeAspect.toFixed(2)} (expected ~${EXPECTED_Q}), face-on ${faceAspect.toFixed(2)}`
			: `${viewport.name}: skipped the disc aspect — the cluster does not fit this chart (${Math.round(edgeOn.spanX)} px of ${Math.round(edgeOn.width)})`,
		!framed ||
			// Edge-on the through-plane extent is the squashed one. Banded around
			// `EXPECTED_Q` rather than pinned, because the extremes are 256 samples
			// of a surface neither of which reaches it exactly.
			//
			// **Against a literal, not against `map.state.flatteningQ`.** Sourcing
			// the target from the page's own report of the constant makes the band
			// follow the defect: a build that changed `GALAXY_FLATTENING_Q` moves
			// the drawn extents and the reported `q` together and passes. The
			// reported value is asserted separately below, so a deliberate change
			// fails loudly in one named place rather than re-targeting this.
			(edgeAspect > EXPECTED_Q - 0.12 &&
				edgeAspect < EXPECTED_Q + 0.12 &&
				// Face-on it is a circle. This is the half a wrong-axis squash fails.
				faceAspect > 0.88 &&
				faceAspect < 1.12 &&
				// And the two views genuinely differ — the check a ball passes.
				faceAspect - edgeAspect > 0.15),
	);
	check(
		`${viewport.name}: the chart reports the shape it draws — q ${edgeOn.q}`,
		edgeOn.q === EXPECTED_Q,
	);

	// D6: nothing on this chart belongs to another galaxy — the lit set is the
	// ~3–17 the density profile predicts rather than a whole-cluster list.
	check(
		`${viewport.name}: the 7 LY shell lights a plausible neighbourhood (${initial.state?.litIndices.length})`,
		initial.state !== undefined &&
			initial.state.litIndices.length >= 1 &&
			initial.state.litIndices.length <= 40 &&
			new Set(initial.state.litIndices).size ===
				initial.state.litIndices.length,
	);

	// D2. `dropLineCount` is read off the geometry's draw range, so this can
	// fail on a build that draws the wrong number of segments — as a restatement
	// of `selected === null` it could only have failed on itself.
	check(
		`${viewport.name}: the unselected chart draws one drop-line and shows no card`,
		initial.state?.dropLineCount === 1 &&
			initial.state?.selectedIndex === null &&
			initial.cardShown === "none",
	);

	// ---- picking: the boundary, at two camera distances --------------------

	const pickRadius = await page.evaluate(
		() => window.__seeliteGalaxyMap.pickRadiusPx,
	);
	const clearance = pickRadius * 4;

	/**
	 * Find a system with nothing else within `clearance`, so a click that misses
	 * it cannot land on a neighbour instead, then click at a pixel offset along
	 * +x and report what got selected.
	 */
	const clickAtOffset = async (offsetPx) => {
		const target = await page.evaluate((clear) => {
			const map = window.__seeliteGalaxyMap;
			map.select(null);
			const { width, height } = map.viewport();
			const state = map.state;
			const visible = map
				.projected()
				.filter(
					(p) =>
						!p.behind &&
						p.index !== state.currentIndex &&
						p.x > 80 &&
						p.y > 80 &&
						p.x < width - 80 &&
						p.y < height - 80,
				);
			const found = visible.find((a) =>
				visible.every(
					(b) =>
						b.index === a.index || Math.hypot(a.x - b.x, a.y - b.y) > clear,
				),
			);
			const box = map.viewport();
			return found === undefined
				? null
				: { ...found, originLeft: box.left, originTop: box.top };
		}, clearance);
		if (target === null) return { target: null, selected: undefined };
		// `projected()` is canvas-relative; `page.mouse` wants client
		// coordinates. Converted through the canvas box rather than assumed
		// equal, because they only are while the chart fills the window.
		await page.mouse.click(
			target.x + target.originLeft + offsetPx,
			target.y + target.originTop,
		);
		const after = await page.evaluate(() => window.__seeliteGalaxyMap.state);
		return { target, selected: after.selectedIndex, state: after };
	};

	const boundaryAt = async (distanceLy) => {
		await page.evaluate((d) => {
			const map = window.__seeliteGalaxyMap;
			map.resetView();
			map.zoom(d - map.state.cameraDistanceLy);
		}, distanceLy);
		await nextFrame(page);
		return {
			inside: await clickAtOffset(pickRadius * 0.8),
			outside: await clickAtOffset(pickRadius * 1.6),
		};
	};

	const wideBoundary = await boundaryAt(62);
	const closeBoundary = await boundaryAt(18);

	// The same pixel boundary at 62 LY and at 18 LY is exactly what a world-unit
	// threshold cannot produce: whatever it is tuned to, one of these four
	// verdicts comes out wrong.
	check(
		`${viewport.name}: the pick radius is ${pickRadius} px at 62 LY and at 18 LY, not a world distance`,
		wideBoundary.inside.target !== null &&
			wideBoundary.inside.selected === wideBoundary.inside.target.index &&
			wideBoundary.outside.target !== null &&
			wideBoundary.outside.selected === null &&
			closeBoundary.inside.target !== null &&
			closeBoundary.inside.selected === closeBoundary.inside.target.index &&
			closeBoundary.outside.target !== null &&
			closeBoundary.outside.selected === null,
	);

	// A selection has to leave a selection behind for the card checks below.
	const selectedState = await page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		const { width, height } = map.viewport();
		const p = map
			.projected()
			.find(
				(q) =>
					!q.behind &&
					q.index !== map.state.currentIndex &&
					q.x > 80 &&
					q.y > 80 &&
					q.x < width - 80 &&
					q.y < height - 80,
			);
		map.select(p.index);
		return map.state;
	});
	await nextFrame(page);

	check(
		`${viewport.name}: a selection draws its drop-line and carries a record and a route`,
		selectedState.dropLineCount === 2 &&
			(selectedState.record?.name.length ?? 0) > 0 &&
			selectedState.route !== null,
	);

	// The record card must land on screen. A card 260 px wide against a 390 px
	// viewport is the case that pushes it off, and an off-screen record is the
	// same as no record.
	const cardBox = await page.evaluate(() => {
		const card = document.querySelector("[data-map-record]");
		const r = card.getBoundingClientRect();
		return {
			display: getComputedStyle(card).display,
			text: card.textContent,
			left: r.left,
			top: r.top,
			right: r.right,
			bottom: r.bottom,
			vw: window.innerWidth,
			vh: window.innerHeight,
		};
	});
	check(
		`${viewport.name}: the record card is visible, named, and inside the viewport`,
		cardBox.display === "block" &&
			selectedState.record !== null &&
			cardBox.text.includes(selectedState.record.name) &&
			cardBox.text.includes(selectedState.record.economy) &&
			cardBox.left >= 0 &&
			cardBox.top >= 0 &&
			cardBox.right <= cardBox.vw &&
			cardBox.bottom <= cardBox.vh,
	);

	// ---- crowding, which is the decision's actual risk ---------------------

	/**
	 * `zoom` moves a target; the frame loop moves the camera. Sampling straight
	 * after a `zoom` call reads the matrices the last render left behind, which
	 * once produced two identical figures reported as a comparison. Every sample
	 * waits two frames, and the check below asserts the two came from different
	 * distances so a regression to that bug fails rather than prints.
	 *
	 * The view is reset first, because crowding depends on the orientation as
	 * well as the distance — `galaxy-map.md` §5.1's table is quoted at the
	 * default framing and is only reproducible from it.
	 */
	const sampleCrowding = async (distanceLy) => {
		await page.evaluate((d) => {
			const map = window.__seeliteGalaxyMap;
			map.select(null);
			map.resetView();
			map.zoom(d - map.state.cameraDistanceLy);
		}, distanceLy);
		await nextFrame(page);
		return page.evaluate(() => {
			const map = window.__seeliteGalaxyMap;
			const radius = map.pickRadiusPx;
			const { width, height } = map.viewport();
			// On screen, not merely in front of the camera. Counting points that
			// have left the viewport inflates a zoomed-in view's crowding with
			// pairs the player cannot see.
			const visible = map
				.projected()
				.filter(
					(p) =>
						!p.behind && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height,
				);
			let crowded = 0;
			for (const a of visible) {
				for (const b of visible) {
					if (a.index === b.index) continue;
					if (Math.hypot(a.x - b.x, a.y - b.y) < radius) {
						crowded++;
						break;
					}
				}
			}
			return {
				crowded: visible.length === 0 ? 1 : crowded / visible.length,
				onScreen: visible.length,
				distanceLy: map.state.cameraDistanceLy,
			};
		});
	};

	const wide = await sampleCrowding(62);
	const close = await sampleCrowding(14);
	await page.evaluate(() => window.__seeliteGalaxyMap.resetView());

	check(
		`${viewport.name}: crowding ${(wide.crowded * 100).toFixed(1)}% of ${wide.onScreen} at ${wide.distanceLy} LY (spec: ${(viewport.crowding.measured * 100).toFixed(1)}%), ${(close.crowded * 100).toFixed(1)}% of ${close.onScreen} at ${close.distanceLy} LY`,
		// The two samples must be of two different cameras, or the comparison
		// below is between a figure and itself.
		close.distanceLy < wide.distanceLy &&
			// Floors on the sample size, not on a viewport's own count: the
			// cluster is 44 LY across and a 390 px column frames 194 of the 256
			// at the default distance where a 1280 px one frames all of them.
			// A floor written from the desktop figure fails the narrow run for
			// being narrow, which is not a defect in the chart.
			wide.onScreen >= 150 &&
			close.onScreen >= 25 &&
			// §5.1's figure, banded. This assertion is what makes the spec's
			// table a check rather than a note.
			wide.crowded >= viewport.crowding.min &&
			wide.crowded <= viewport.crowding.max &&
			// Zooming must resolve the cluster. If it did not, free orbit would
			// have no answer to depth ambiguity at all.
			close.crowded < wide.crowded,
	);

	// ---- the haze is a background channel ----------------------------------

	const hazeEffect = await page.evaluate(async () => {
		const map = window.__seeliteGalaxyMap;
		const frame = () =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		map.setHaze(false);
		await frame();
		const before = map.projected();
		const off = map.state.haze;
		map.setHaze(true);
		await frame();
		const after = map.projected();
		const on = map.state.haze;
		let moved = 0;
		for (let i = 0; i < before.length; i++) {
			if (
				Math.hypot(before[i].x - after[i].x, before[i].y - after[i].y) > 0.001
			) {
				moved++;
			}
		}
		const label = document
			.querySelector("[data-map-haze]")
			.getAttribute("aria-pressed");
		map.setHaze(false);
		return { off, on, moved, label };
	});
	check(
		`${viewport.name}: the core haze toggles without moving a single system`,
		hazeEffect.off === false &&
			hazeEffect.on === true &&
			hazeEffect.moved === 0 &&
			hazeEffect.label === "true",
	);

	// ---- D8: the course is a destination, and it re-derives -----------------

	/**
	 * The discriminating half is the last pair of assertions.
	 *
	 * An earlier version asserted only that the destination survived an
	 * off-plan jump and that some jumps remained — which a build storing the
	 * chain and advancing a cursor satisfies exactly. What a cursor cannot
	 * produce is the remainder of a route planned *from the system the ship
	 * actually reached*; it would report the plan-relative count instead. So the
	 * probe recomputes by selecting the destination from the new origin and
	 * compares against both answers.
	 */
	const courseWalk = await page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		// The farthest destination, so the chain is long enough that a cursor
		// and a re-plan can disagree.
		let target = null;
		let best = -1;
		for (const p of map.projected()) {
			map.select(p.index);
			const r = map.state.route;
			if (r !== null && r.jumps > best) {
				best = r.jumps;
				target = p.index;
			}
		}
		map.select(target);
		const committed = map.commitCourse();
		const set = map.state;
		const plan = set.route.hopIndices;

		map.jumpTo(plan[0]);
		const afterHop = map.state;
		const cursorWouldSay = afterHop.courseRemaining - 1;

		// **Choose the off-plan system that discriminates.** Taking the first
		// lit neighbour not on the chain risks landing on one that happens to
		// be exactly one hop closer — an equally optimal alternate route — where
		// a correct build's re-plan equals the cursor's answer and the check
		// goes false-red. So the probe asks each candidate what a re-plan from
		// there would cost, and takes the first whose answer a cursor could not
		// have produced. If none exists the check fails loudly rather than
		// falling back to an arbitrary jump.
		const here = afterHop.currentIndex;
		let offPlan = null;
		let offPlanFresh = null;
		for (const candidate of afterHop.litIndices) {
			if (plan.includes(candidate)) continue;
			map.jumpTo(candidate);
			map.select(target);
			const fresh = map.state.route.jumps;
			map.jumpTo(here);
			if (fresh !== cursorWouldSay) {
				offPlan = candidate;
				offPlanFresh = fresh;
				break;
			}
		}
		if (offPlan === null) {
			return { discriminatingOffPlanFound: false };
		}

		map.jumpTo(offPlan);
		const afterOffPlan = map.state;

		// What a re-plan from here costs, computed by the chart's own router
		// rather than by this probe: select the destination and read it.
		map.select(target);
		const freshFromHere = map.state.route.jumps;

		return {
			discriminatingOffPlanFound: true,
			committed,
			jumps: best,
			destination: set.course?.destinationIndex,
			remainingAtStart: set.courseRemaining,
			remainingAfterHop: afterHop.courseRemaining,
			destinationAfterOffPlan: afterOffPlan.course?.destinationIndex,
			remainingAfterOffPlan: afterOffPlan.courseRemaining,
			freshFromHere,
			offPlanFresh,
			cursorWouldSay,
		};
	});
	check(
		`${viewport.name}: a set course re-derives from where the ship is (${courseWalk.remainingAfterOffPlan} jumps; a cursor would say ${courseWalk.cursorWouldSay})`,
		// No discriminating off-plan neighbour means the check could not have
		// told the two implementations apart, and a green that proves nothing is
		// the failure this whole probe exists to avoid.
		courseWalk.discriminatingOffPlanFound &&
			courseWalk.committed &&
			courseWalk.jumps >= 2 &&
			courseWalk.destination === courseWalk.destinationAfterOffPlan &&
			courseWalk.remainingAfterHop === courseWalk.remainingAtStart - 1 &&
			// The remainder is a route planned from the ship's real position …
			courseWalk.remainingAfterOffPlan === courseWalk.freshFromHere &&
			// … and not the plan-relative decrement a stored cursor would give.
			courseWalk.remainingAfterOffPlan !== courseWalk.cursorWouldSay,
	);

	await page.close();
}

check(
	`the disc aspect was measured on [${[...discMeasured].join(", ")}] of ${VIEWPORTS.length} viewports`,
	// Desktop is the arm that frames the whole cluster, so it is the arm this
	// check lives or dies on. Narrow is expected to skip and is not required.
	discMeasured.has("desktop"),
);

await browser.close();
exit();
