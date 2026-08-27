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
const VIEWPORTS = [
	{ name: "desktop", width: 1280, height: 760 },
	{ name: "narrow", width: 390, height: 844 },
];

/** §5.1's measured figure at the default framing, with the band a change to
 *  the projection or the pick radius has to stay inside. Wide, because it is a
 *  regression band and not a tuning target — but not so wide that halving the
 *  point separation would pass. */
const CROWDING_AT_DEFAULT = { min: 0.25, max: 0.6 };

const nextFrame = (page) =>
	page.evaluate(
		() =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	);

await guardedOrigin(ORIGIN, ["src/galaxy-map.ts", "src/galaxy-route.ts"]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
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
			initial.state?.galaxyRadiusLy === 22 &&
			initial.state?.jumpRangeLy === 7,
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
			return (
				visible.find((a) =>
					visible.every(
						(b) =>
							b.index === a.index || Math.hypot(a.x - b.x, a.y - b.y) > clear,
					),
				) ?? null
			);
		}, clearance);
		if (target === null) return { target: null, selected: undefined };
		await page.mouse.click(target.x + offsetPx, target.y);
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
		`${viewport.name}: crowding ${(wide.crowded * 100).toFixed(1)}% of ${wide.onScreen} at ${wide.distanceLy} LY, ${(close.crowded * 100).toFixed(1)}% of ${close.onScreen} at ${close.distanceLy} LY`,
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
			wide.crowded >= CROWDING_AT_DEFAULT.min &&
			wide.crowded <= CROWDING_AT_DEFAULT.max &&
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

		// Somewhere reachable that the plan does not contain.
		const offPlan = afterHop.litIndices.find((i) => !plan.includes(i));
		map.jumpTo(offPlan ?? afterHop.litIndices[0]);
		const afterOffPlan = map.state;

		// What a re-plan from here costs, computed by the chart's own router
		// rather than by this probe: select the destination and read it.
		map.select(target);
		const freshFromHere = map.state.route.jumps;

		return {
			committed,
			jumps: best,
			destination: set.course?.destinationIndex,
			remainingAtStart: set.courseRemaining,
			remainingAfterHop: afterHop.courseRemaining,
			destinationAfterOffPlan: afterOffPlan.course?.destinationIndex,
			remainingAfterOffPlan: afterOffPlan.courseRemaining,
			freshFromHere,
			// What a stored cursor would have said: one fewer than the previous
			// remainder, wherever the ship actually went.
			cursorWouldSay: afterHop.courseRemaining - 1,
			offPlanUsed: offPlan !== undefined,
		};
	});
	check(
		`${viewport.name}: a set course re-derives from where the ship is (${courseWalk.remainingAfterOffPlan} jumps; a cursor would say ${courseWalk.cursorWouldSay})`,
		courseWalk.committed &&
			courseWalk.jumps >= 2 &&
			courseWalk.offPlanUsed &&
			courseWalk.destination === courseWalk.destinationAfterOffPlan &&
			courseWalk.remainingAfterHop === courseWalk.remainingAtStart - 1 &&
			// The remainder is a route planned from the ship's real position …
			courseWalk.remainingAfterOffPlan === courseWalk.freshFromHere &&
			// … and not the plan-relative decrement a stored cursor would give.
			courseWalk.remainingAfterOffPlan !== courseWalk.cursorWouldSay,
	);

	await page.close();
}

await browser.close();
exit();
