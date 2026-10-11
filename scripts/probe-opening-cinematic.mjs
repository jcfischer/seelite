/** Opening cinematic contract: watched guided/free runs, input suppression,
 * shot captures, equality to skipped state, and the five-seed camera sweep. */
import { bootedGame, launchChromium, tally } from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { openingFixture } from "./lib/opening-probe.mjs";
const browser = await launchChromium();
const { check, watch, exit } = tally();
try {
	const {
		origin,
		out,
		SEED,
		endState,
		lastDocked,
		tradeKey,
		boot,
		untilOver,
		holdToShot,
		same,
		differing,
		trade,
		skippedEnd,
		skippedRecord,
	} = await openingFixture({ browser, check, watch });
	// ---------------------------------------------------------------------------
	// Guided, watched: every shot captured, and the pilot's keys ignored
	// ---------------------------------------------------------------------------

	const watched = await boot({ guided: true, cinematic: 1 }, "guided watched");
	const shots = [];
	let pressed = false;
	let prologue = null;
	const letterboxed = new Set();
	for (let i = 0; i < 400; i++) {
		const r = await watched.page.evaluate(() =>
			window.__seelite.openingReading(),
		);
		if (!r.active) break;
		if (r.shot && shots[shots.length - 1] !== r.shot) {
			shots.push(r.shot);
			// Into the shot, where it has settled.
			await watched.page.waitForTimeout(1200);
			// The frame is letterboxed while each shot runs, read then rather than
			// only after the end (sage round 1 on #536).
			if (
				await watched.page.evaluate(
					() => !!document.querySelector("[data-opening]")?.checkVisibility(),
				)
			)
				letterboxed.add(r.shot);
			// The prologue is empty space with the rift forming: no ship drawn, a
			// rift that is there and still growing.
			if (r.shot === "forming")
				prologue = await watched.page.evaluate(() => {
					const g = window.__seelite;
					return {
						shot: g.openingReading().shot,
						shipDrawn: g.shipMesh.visible,
						riftStrength: g.arrivalRift?.strength ?? 0,
						witchspace: g.witchspace.kind,
					};
				});
			await watched.page.screenshot({
				path: `${out}/${String(shots.length).padStart(2, "0")}-${r.shot}.png`,
			});
		}
		// The pilot's hands during the fly-past: throttle, cruise and a turn. None
		// may reach the ship, or the watched run would end somewhere else.
		if (r.shot === "flypast" && !pressed) {
			pressed = true;
			await watched.page.keyboard.down("Shift");
			await watched.page.keyboard.press("j");
			await watched.page.keyboard.down("a");
			await watched.page.waitForTimeout(600);
			await watched.page.keyboard.up("a");
			await watched.page.keyboard.up("Shift");
		}
		await watched.page.waitForTimeout(100);
	}
	await untilOver(watched.page);
	check(
		"a watched guided opening shows the rift forming, arrival, fly-past, planet fly-by, station approach and dock, in order",
		same(shots, [
			"forming",
			"arrival",
			"flypast",
			"cruise",
			"approach",
			"dock",
		]),
		shots.join(" → "),
	);
	check(
		"the prologue draws no ship and a rift still forming, before the witchspace exit begins",
		prologue?.shot === "forming" &&
			prologue.shipDrawn === false &&
			prologue.riftStrength > 0 &&
			prologue.riftStrength < 1 &&
			prologue.witchspace === "idle",
		JSON.stringify(prologue),
	);
	check(
		"the frame was letterboxed in every shot while it ran, and is gone after",
		letterboxed.size === shots.length &&
			(await watched.page.evaluate(
				() => !document.querySelector("[data-opening]")?.checkVisibility(),
			)),
		`letterboxed in ${[...letterboxed].join(", ")}`,
	);
	const watchedEnd = await endState(watched.page);
	check(
		"watched, with the pilot's keys pressed, it ends in the skipped run's state",
		same(watchedEnd, skippedEnd),
		differing(watchedEnd, skippedEnd) || `t=${watchedEnd.gameTime.toFixed(3)}`,
	);
	const watchedRecord = await lastDocked(watched.page);
	check(
		"and writes the same lastDocked",
		same(watchedRecord, skippedRecord),
		JSON.stringify(watchedRecord),
	);
	check(
		"the pilot gets the cockpit back, docked",
		await watched.page.evaluate(() => window.__seelite.view === "cockpit"),
	);
	await watched.page.screenshot({
		path: `${out}/${String(shots.length + 1).padStart(2, "0")}-docked.png`,
	});
	await watched.context.close();

	// ---------------------------------------------------------------------------
	// Every step of every shot, on the principal's seeds (47–51). The arrival
	// flicker the principal saw on 47 and the second ship on 49 only happened
	// *between* frames — the camera's side was float noise on seeds that face the
	// star, and swung round the ship each step — so the sampler has to see every
	// step the script runs at. Since #882 it does that by stepping the script with
	// its own phase handle rather than waiting for frames to arrive, which is finer
	// than a frame at 60 fps and costs 4 s per seed instead of 43. The note under
	// the sampler names what that trades away.
	// ---------------------------------------------------------------------------

	for (const seed of [47, 48, 49, 50, 51]) {
		const context = await browser.newContext({
			viewport: { width: 960, height: 600 },
		});
		const page = await context.newPage();
		watch(page, `frames ${seed}`);
		await page.goto(
			gameUrl(origin, { seed, raider: "off", guided: true, cinematic: 1 }),
		);
		await bootedGame(page);
		// **Stepped, not watched** (#882). The row measures the camera at the
		// opening's own steps, taking them through the game's phase handle instead of
		// waiting for frames to arrive: each seed samples the script in about 4 s
		// rather than the 43 s of wall clock its frames used to cost (five seeds: 217 s
		// of the probe's 396). What it measures agrees with the watched row to six
		// decimals on all five seeds — the figures, and the ladder between the watched
		// run, this sampler, and the too-wide one, are in
		// `docs/receipts/node-882-probe-wall-clock.md` §4 rather than here, because a
		// second copy of a measurement is how it starts to drift (sage round 5 on #884).
		// Fewer samples than the watched row, every one a distinct step of the script.
		//
		// **One step per sample, and the page says how wide a step is.** A shot shown
		// at 1.5x moves the script's shown clock by less than `OPENING.dtS` per step, so
		// an aim of `dtS` there swallows two steps: #882's first version of this sampler
		// aimed by a `1 / 60` it had typed itself and saw every second step of the
		// cruise, approach and dock shots while its comment claimed every one. So the
		// stride comes from `openingScript()` — `OPENING.dtS / SHOT_RATIO[shot]`, read
		// off the module that owns it, same as the shot order — and the check under this
		// sampler measures consecutive samples against it: one step apart in the script's
		// own clock, or the row is red. A stride one step too wide cannot hide, and
		// `tests/opening.test.ts` pins the same arithmetic without a browser.
		//
		// What a stepped run shows **less** of is the arrival's *look*: that runs on
		// wall time and a hold runs none of it. So this row is evidence about the camera
		// and the ship through the script, and never about what the flicker looked like
		// on a person's screen — that stays the watched row above, the shots it writes
		// to disk, and `npm run views`.
		const script = await page.evaluate(() => window.__seelite.openingScript());
		const {
			rows: frames,
			byShot,
			ended: swept,
			cap: truncated,
		} = await page.evaluate((script) => {
			const g = window.__seelite;
			const run = g.opening;
			const order = script.shots;
			const rows = [];
			/** Rows per shot, counted in the shot's own name: the check below holds
			 *  them to the steps `opening.ts` says a fixed-length shot has. */
			const byShot = {};
			/**
			 * Aim one step ahead in the shot being worked through, and follow the
			 * script when it moves on. A cut (`shot === null`) has no camera to sample,
			 * so the aim moves into the next shot at the shown seconds it has **already**
			 * reached — the step that ended the last shot may have given this one some,
			 * and aiming at zero would read as asking for a moment already past.
			 */
			const aimAfter = (i) => {
				const shot = order[i];
				return (run.shownBy[shot] ?? 0) + script.stepS[shot];
			};
			let si = Math.max(0, order.indexOf(run.shot ?? order[0]));
			let aim = aimAfter(si);
			let steps = 0;
			while (g.openingActive && steps++ < 60000) {
				const shot = order[si];
				if (!shot) break;
				try {
					g.holdOpening(shot, aim);
				} catch {
					break; // the script ended on that step
				}
				const cam = g.openingActive ? g.openingCamera() : null;
				if (cam) {
					const s = g.openingScene();
					const rel = {
						x: cam.pos.x - s.ship.pos.x,
						y: cam.pos.y - s.ship.pos.y,
						z: cam.pos.z - s.ship.pos.z,
					};
					const d = Math.hypot(rel.x, rel.y, rel.z);
					const c =
						-(
							rel.x * cam.forward.x +
							rel.y * cam.forward.y +
							rel.z * cam.forward.z
						) / d;
					const seen = g.openingReading().shot;
					/** The script's own clock for this row: the stride check below
					 * measures against it rather than against a count. */
					const shown = run.shownBy[seen];
					byShot[seen] = (byShot[seen] ?? 0) + 1;
					rows.push({
						shot: seen,
						shown,
						rel,
						cam: cam.pos,
						forward: cam.forward,
						distR: d / s.reachKm,
						offDeg: (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI,
					});
				}
				const now = run.shot;
				const wi =
					now === null
						? Math.min(si + 1, order.length - 1) // into the shot the cut leads to
						: order.indexOf(now);
				if (wi > si) si = wi;
				aim = aimAfter(si);
			}
			// A sweep that stopped early would otherwise look like a sweep that saw the
			// whole opening: `ended` is the script finishing, `cap` is this loop's own
			// ceiling, and the check under the sampler gates on both.
			return { rows, byShot, ended: !g.openingActive, cap: steps >= 60000 };
		}, script);
		// **One take from the arrival through the fly-past** (the principal's
		// sixth note): between two frames of it the camera may move only by the
		// orbit (~0.03 reaches a frame; the fly-past camera stands still in its
		// frame) and turn its aim by a few degrees. The noise jumps this was built
		// on were 4.3 and 5.9 reaches, and the old cut between the two scenes
		// moved the camera by several reaches at once.
		const take = new Set(["arrival", "flypast"]);
		let takeJumpR = 0;
		let takeTurnDeg = 0;
		let arrivalFrames = 0;
		let takeFrames = 0;
		for (let i = 1; i < frames.length; i++) {
			const [a, b] = [frames[i - 1], frames[i]];
			if (!take.has(a.shot) || !take.has(b.shot)) continue;
			takeFrames++;
			if (b.shot === "arrival") arrivalFrames++;
			const jump = Math.hypot(
				b.cam.x - a.cam.x,
				b.cam.y - a.cam.y,
				b.cam.z - a.cam.z,
			);
			takeJumpR = Math.max(takeJumpR, jump / 0.036);
			const c =
				a.forward.x * b.forward.x +
				a.forward.y * b.forward.y +
				a.forward.z * b.forward.z;
			takeTurnDeg = Math.max(
				takeTurnDeg,
				(Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI,
			);
		}
		const closestR = Math.min(...frames.map((f) => f.distR));
		const worstOff = Math.max(...frames.map((f) => f.offDeg));
		const shotsSeen = [
			...new Set(frames.map((f) => f.shot).filter(Boolean)),
		].join(" ");
		// **The stride, checked rather than claimed** (#882). Consecutive rows inside one
		// shot have to sit exactly one of the script's own steps apart — `openingStepS`,
		// which for a shot shown at 1.5x or 2x is *less* than `OPENING.dtS`. That is the
		// property the sampler has to have, and unlike a row count it holds for the shots
		// whose length the flight decides: the cruise shot begins when cruise engages and
		// the dock ends when the ship docks, so across the five seeds here the cruise
		// shot yields anywhere from 17 to 868 rows. Counting rows was this branch's first
		// attempt at the check, and it was wrong about exactly those shots.
		let strideErr = 0;
		for (let i = 1; i < frames.length; i++) {
			const [a, b] = [frames[i - 1], frames[i]];
			if (b.shot !== a.shot || typeof b.shown !== "number") continue;
			const stepS = script.stepS[b.shot];
			if (typeof stepS !== "number") continue;
			strideErr = Math.max(strideErr, Math.abs(b.shown - a.shown - stepS));
		}
		check(
			`seed ${seed}: the sweep walked the whole opening, one script step per sample`,
			// An empty sweep has no pair of rows to be one step apart, so a stride
			// check on it is vacuously true: the floor is what makes this a gate rather
			// than a tautology. The five seeds measure 2852–3702 rows here (#882's
			// ladder), so anything near this floor is a sampler that stopped seeing.
			frames.length > 1000 && strideErr < 1e-9 && swept === true && !truncated,
			JSON.stringify({
				rows: frames.length,
				strideErr,
				swept,
				truncated,
				samples: script.shots.map((x) => `${x} ${byShot[x] ?? 0}`).join(" "),
			}),
		);
		check(
			`seed ${seed}: arrival and fly-past are one steady take, the camera outside the hull, the ship in frame`,
			arrivalFrames > 100 &&
				takeFrames > arrivalFrames + 100 &&
				shotsSeen === "forming arrival flypast cruise approach dock" &&
				takeJumpR < 0.5 &&
				takeTurnDeg < 8 &&
				closestR > 2 &&
				worstOff < 25,
			JSON.stringify({
				frames: frames.length,
				arrivalFrames,
				takeFrames,
				shotsSeen,
				takeJumpR: Number(takeJumpR.toFixed(4)),
				takeTurnDeg: Number(takeTurnDeg.toFixed(2)),
				closestR: Number(closestR.toFixed(2)),
				worstOffDeg: Number(worstOff.toFixed(1)),
			}),
		);
		await context.close();
	}

	// ---------------------------------------------------------------------------
	// Free: arrival and fly-past, then control near the arrival point
	// ---------------------------------------------------------------------------

	const free = await boot({ cinematic: 1 }, "free watched");
	const arrivalPoint = await free.page.evaluate(() => {
		const p = window.__seelite.world.ship.pos;
		return [p.x, p.y, p.z];
	});
	const freeShots = new Set();
	for (let i = 0; i < 300; i++) {
		const r = await free.page.evaluate(() => window.__seelite.openingReading());
		if (!r.active) break;
		if (r.shot) freeShots.add(r.shot);
		await free.page.waitForTimeout(100);
	}
	await untilOver(free.page);
	const freeEnd = await free.page.evaluate((from) => {
		const g = window.__seelite;
		const p = g.world.ship.pos;
		return {
			outcome: g.openingReading().lastOutcome,
			dockPhase: g.dockPhase,
			regime: g.regime,
			gameTime: g.world.gameTime,
			fromArrivalKm: Math.hypot(p.x - from[0], p.y - from[1], p.z - from[2]),
			throttle: g.throttle,
			view: g.view,
		};
	}, arrivalPoint);
	check(
		"a free opening shows the rift forming, the arrival and the fly-past only",
		same([...freeShots], ["forming", "arrival", "flypast"]),
		[...freeShots].join(" → "),
	);
	check(
		"and hands over in flight, near the arrival point, throttle at zero",
		freeEnd.outcome === "flying" &&
			freeEnd.dockPhase === "flying" &&
			freeEnd.regime === "normal" &&
			freeEnd.fromArrivalKm < 2 &&
			freeEnd.throttle === 0 &&
			freeEnd.gameTime < 15,
		JSON.stringify(freeEnd),
	);
	await free.context.close();
} finally {
	await browser.close();
}
exit();
