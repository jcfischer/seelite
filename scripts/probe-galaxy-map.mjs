/**
 * The galaxy map's browser tier — node #11.
 *
 * The headless suite owns the arithmetic: `tests/galaxy-route.test.ts` proves
 * the chains are optimal and the courses parse. What it cannot reach is the
 * thing the node was actually deciding — whether a **freely orbited** cluster
 * of 256 systems can be read and picked at all. Depth ambiguity is a fact about
 * a projection and a viewport, so it is measured here.
 *
 * Three checks carry that, and each is built so a wrong build fails it:
 *
 * - **Picking agrees with drawing.** A click at a system's own projected pixel
 *   selects that system, *and still does after the camera is orbited*. A build
 *   that picked with a world-space raycast threshold passes the first and fails
 *   the second at a different zoom, which is why both are here.
 * - **Crowding is measured, not assumed.** The share of systems whose nearest
 *   on-screen neighbour is inside the pick radius, at the default framing and
 *   zoomed in. The claim being checked is that zooming resolves the core — if
 *   it did not, free orbit would have no answer to R1 and the decision would be
 *   wrong.
 * - **The haze is a background channel.** Turning it on must not move a single
 *   projected point. A haze implemented as anything that touches layout fails.
 */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const VIEWPORTS = [
	{ name: "desktop", width: 1280, height: 760 },
	{ name: "narrow", width: 390, height: 844 },
];

/** Share of systems whose nearest visible neighbour is inside `radius` px. */
function crowdingOf(points, radius) {
	const visible = points.filter((p) => !p.behind);
	if (visible.length === 0) return { crowded: 1, visible: 0 };
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
	return { crowded: crowded / visible.length, visible: visible.length };
}

await guardedOrigin(ORIGIN, ["src/galaxy-map.ts", "src/galaxy-route.ts"]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	watch(page, viewport.name);
	await page.goto(`${ORIGIN}/?galaxy-map=0`, { waitUntil: "load" });
	await page.waitForSelector("#galaxy-map canvas");
	// One frame, so the projection the handle reports is the drawn one.
	await page.evaluate(
		() =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	);

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

	// D6: nothing on this chart belongs to another galaxy — the lit set is a
	// subset of the drawn systems, and it is the ~3–17 the density profile
	// predicts rather than a whole-cluster list.
	check(
		`${viewport.name}: the 7 LY shell lights a plausible neighbourhood (${initial.state?.litIndices.length})`,
		initial.state !== undefined &&
			initial.state.litIndices.length >= 1 &&
			initial.state.litIndices.length <= 40 &&
			new Set(initial.state.litIndices).size ===
				initial.state.litIndices.length,
	);

	// D2: one drop-line with nothing selected, two once something is.
	check(
		`${viewport.name}: the unselected chart drops one line and shows no card`,
		initial.state?.dropLineCount === 1 &&
			initial.state?.selectedIndex === null &&
			initial.cardShown === "none",
	);

	// ---- picking agrees with drawing, at two camera angles -----------------

	const pickAt = async (label) => {
		const target = await page.evaluate(() => {
			const map = window.__seeliteGalaxyMap;
			const points = map.projected();
			const state = map.state;
			// A system that is on screen, not the current one, and not sitting
			// on top of a neighbour — picking an ambiguous point would test the
			// tie-break rather than the agreement.
			const visible = points.filter(
				(p) =>
					!p.behind &&
					p.index !== state.currentIndex &&
					p.x > 60 &&
					p.y > 60 &&
					p.x < window.innerWidth - 60 &&
					p.y < window.innerHeight - 60,
			);
			const isolated = visible.find((a) =>
				visible.every(
					(b) =>
						b.index === a.index ||
						Math.hypot(a.x - b.x, a.y - b.y) > map.pickRadiusPx * 2.5,
				),
			);
			return isolated ?? null;
		});
		if (target === null) return { ok: false, why: "no isolated point" };
		await page.mouse.click(target.x, target.y);
		const after = await page.evaluate(() => window.__seeliteGalaxyMap.state);
		return { ok: after.selectedIndex === target.index, after, target, label };
	};

	const firstPick = await pickAt("start framing");
	check(
		`${viewport.name}: a click selects the system drawn under it`,
		firstPick.ok &&
			firstPick.after?.dropLineCount === 2 &&
			firstPick.after?.record?.name.length > 0 &&
			firstPick.after?.route !== null,
	);

	// The record card must land on screen. A card anchored to a projected point
	// near the right edge is the case that pushes it off, and an off-screen
	// record is the same as no record.
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
		`${viewport.name}: the record card is visible, named, and on screen`,
		cardBox.display === "block" &&
			cardBox.text.includes(
				firstPick.after?.record?.name ?? "\u0000 no record",
			) &&
			cardBox.text.includes(
				firstPick.after?.record?.economy ?? "\u0000 no record",
			) &&
			cardBox.left >= 0 &&
			cardBox.top >= 0 &&
			cardBox.right <= cardBox.vw &&
			cardBox.bottom <= cardBox.vh,
	);

	await page.evaluate(() => {
		window.__seeliteGalaxyMap.select(null);
		window.__seeliteGalaxyMap.orbit(240, 110);
		window.__seeliteGalaxyMap.zoom(-22);
	});
	await page.evaluate(
		() =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	);
	const secondPick = await pickAt("orbited and zoomed");
	check(
		`${viewport.name}: picking still agrees after an orbit and a zoom`,
		secondPick.ok,
	);

	// ---- crowding, which is the decision's actual risk ---------------------

	/**
	 * **`zoom` moves a target, and the frame loop moves the camera.**
	 *
	 * The first version of this sampled straight after each `zoom` call and
	 * reported *identical* crowding at 62 LY and at 18 — because `projected()`
	 * reads the camera matrices the last render left behind, and no render had
	 * happened in between. It failed only because the assertion demanded the
	 * two differ; a check that had merely printed the figure would have shipped
	 * one camera measured twice and called it a comparison. Every sample now
	 * waits two frames, and the reported distance is read back off the state so
	 * the label cannot claim a framing that was never drawn.
	 */
	const crowding = await page.evaluate(
		async ({ crowdingSource }) => {
			const map = window.__seeliteGalaxyMap;
			const measure = new Function(`return (${crowdingSource})`)();
			const radius = map.pickRadiusPx;
			const frame = () =>
				new Promise((r) =>
					requestAnimationFrame(() => requestAnimationFrame(r)),
				);
			const sampleAt = async (distance) => {
				map.zoom(distance - map.state.cameraDistanceLy);
				await frame();
				const out = measure(map.projected(), radius);
				out.distanceLy = map.state.cameraDistanceLy;
				return out;
			};
			const wide = await sampleAt(62);
			const close = await sampleAt(14);
			await sampleAt(62);
			return { wide, close };
		},
		{ crowdingSource: crowdingOf.toString() },
	);

	check(
		`${viewport.name}: crowding ${(crowding.wide.crowded * 100).toFixed(0)}% at ${crowding.wide.distanceLy} LY, ${(crowding.close.crowded * 100).toFixed(0)}% at ${crowding.close.distanceLy} LY`,
		crowding.wide.visible > 100 &&
			crowding.close.visible > 40 &&
			// The two samples must be of two different cameras, or the
			// comparison below is between a figure and itself.
			crowding.close.distanceLy < crowding.wide.distanceLy &&
			// Zooming must resolve the cluster. If it did not, free orbit would
			// have no answer to depth ambiguity at all.
			crowding.close.crowded < crowding.wide.crowded,
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

	const courseWalk = await page.evaluate(() => {
		const map = window.__seeliteGalaxyMap;
		// Pick the farthest system, so the course is a real chain rather than
		// a single hop that would prove nothing about re-derivation.
		const points = map.projected();
		let target = null;
		let best = -1;
		for (const p of points) {
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
		const firstHop = set.route.hopIndices[0];
		map.jumpTo(firstHop);
		const afterJump = map.state;
		// Now go somewhere that is *not* on the plan and ask again.
		const offPlan = afterJump.litIndices.find(
			(i) => !set.route.hopIndices.includes(i),
		);
		map.jumpTo(offPlan ?? afterJump.litIndices[0]);
		const afterOffPlan = map.state;
		return {
			committed,
			jumps: best,
			destination: set.course?.destinationIndex,
			remainingAtStart: set.courseRemaining,
			remainingAfterHop: afterJump.courseRemaining,
			destinationAfterOffPlan: afterOffPlan.course?.destinationIndex,
			remainingAfterOffPlan: afterOffPlan.courseRemaining,
			offPlanUsed: offPlan !== undefined,
		};
	});
	check(
		`${viewport.name}: a set course survives an off-plan jump and keeps its destination`,
		courseWalk.committed &&
			courseWalk.jumps >= 2 &&
			courseWalk.destination === courseWalk.destinationAfterOffPlan &&
			courseWalk.remainingAfterHop === courseWalk.remainingAtStart - 1 &&
			courseWalk.offPlanUsed &&
			courseWalk.remainingAfterOffPlan >= 1,
	);

	await page.close();
}

await browser.close();
exit();
