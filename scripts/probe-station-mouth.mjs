/**
 * #269: nothing at a station mouth appears for exactly one frame.
 *
 * The principal's playtest recording holds a close-range cockpit view on a
 * turning trade aperture, and geometry at the inner mouth pops in and out
 * between adjacent frames. What produces it is four rings that share one inner
 * rectangle — `station-interior.ts` sets `laneHalfAcrossKm` to
 * `aperture.widthKm / 2`, and `ringAround` puts every ring's inner face exactly
 * there — so the coaming, the lit aperture bars, the bay's mouth bulkhead and
 * its lane edge all claim the same inner aperture wall, and any two of them that
 * also overlap in depth fight over it.
 *
 * **The metric is a temporal median, not a frame difference.** The station
 * turns, so adjacent frames legitimately differ over the whole silhouette —
 * 25,000–30,000 pixels a frame on the recording with nothing wrong. This finds a
 * pixel where the two *neighbours* agree with each other and the middle frame
 * disagrees with both, and erodes the result, because a one-pixel silhouette
 * lands on a different pixel each frame and hairlines otherwise trace every rim
 * — on the recording, 304 of 337 frames carry some.
 *
 * **What this gates on is a discontinuity at the mouth, not a diagnosis of one.**
 * A subject moving further than its own extent between frames produces the same
 * signature — the detector's docstring carries the counterexample and the two
 * rounds of overclaiming it took to get that written down. The floor arm, which
 * hides the aperture group, does not settle it either: it removes the candidate
 * and the moving geometry together. What it does establish is that a non-zero
 * reading needs the aperture, so a rung whose floor is not 0 is reporting on its
 * own framing rather than on the mouth — which is why each floor is checked as
 * its own row instead of assumed.
 *
 * Naming the cause is `measure-mouth-flicker.mjs`'s job, and for #269 the answer
 * was two surfaces inside the depth buffer's own resolution.
 *
 * **Two framings, because one erosion radius cannot serve both.** The fighting
 * face is 24 m deep at a lateral 35 m, so its projected width falls from about
 * 18 px at 0.6 km to about 2.4 px at 0.9 km. A radius that isolates a polygon at
 * the near framing silently passes the far one, which is how a fix that only
 * moved the defect below the detector would read green. So the near rung erodes
 * at 2 and the far rung at 1, and both are checked.
 *
 * **The floor comes from outside the arm.** Zero is only meaningful beside a
 * reading that is zero because there is nothing to fight — the same sweep with
 * the whole aperture group hidden. On the build this was written against the
 * present rows read 2748 and 31 against a hidden-aperture floor of 0 and 0.
 */
import {
	FLICKER_CHANGED,
	FLICKER_SAME,
	installFlickerDetector,
	installPinAndFrame,
} from "./lib/flicker-detector.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";

/**
 * The two rungs, and what each is for.
 *
 * `rangeKm` is from the station's **centre**, which is `__viewAlongAxis`'s
 * convention and not the aperture plane — the trade's plane is 0.428 km out, so
 * 0.6 km here is 170 m off the mouth.
 */
const RUNGS = [
	{ rangeKm: 0.6, erode: 2, label: "at 0.17 km off the mouth" },
	{ rangeKm: 0.9, erode: 1, label: "at 0.47 km off the mouth" },
];
/** An absolute game clock the bodies are placed at, and the sweep across it. */
const AT_S = 2;
const FRAMES = 30;
const STEP_S = 1 / 60;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

try {
	const page = await browser.newPage({
		viewport: { width: 1100, height: 720 },
	});
	watch(page);
	await installFlickerDetector(page);
	await installPinAndFrame(page);
	await page.goto(gameUrl(ORIGIN, { seed: 54 }), { waitUntil: "load" });
	await bootedGame(page);

	const stationId = await page.evaluate(
		() =>
			window.__seelite.world.system.contents.stations.find(
				(station) => station.type === "trade",
			)?.id ?? null,
	);
	if (!stationId) throw new Error("seed 54 has no trade station");

	const result = await page.evaluate(
		async ([id, options]) => {
			const g = window.__seelite;
			const { advanceWorldClock } = await import("/src/sim.ts");
			cancelAnimationFrame(g.animationFrame);
			g.view = "cockpit";
			g.setHeadLook("forward");
			// The dither is per-pixel noise in display space — exactly the shape
			// this detector looks for, and a display term rather than geometry, so
			// removing it removes noise and no signal.
			g.outputPass.setDither(false);

			const canvas = g.renderer.domElement;
			const W = canvas.width;
			const H = canvas.height;
			const scratch = document.createElement("canvas");
			scratch.width = W;
			scratch.height = H;
			const ctx = scratch.getContext("2d", { willReadFrequently: true });

			const frameAt = (t) => {
				g.world.gameTime = t;
				g.render(0);
				ctx.drawImage(canvas, 0, 0);
				return ctx.getImageData(0, 0, W, H).data;
			};
			const sweep = (erode) => {
				let a = frameAt(options.atS);
				let b = frameAt(options.atS + options.stepS);
				let peak = 0;
				let total = 0;
				let peakAtS = null;
				for (let k = 2; k < options.frames; k++) {
					const c = frameAt(options.atS + k * options.stepS);
					// The detector is `scripts/lib/flicker-detector.mjs`, shared with
					// `measure-mouth-flicker.mjs`: this row gates on it and that one
					// explains it, and two copies would let the two disagree about
					// what was measured.
					const { area } = window.__flickerMask(a, b, c, {
						width: W,
						height: H,
						erode,
						changed: options.changed,
						same: options.same,
					});
					total += area;
					if (area > peak) {
						peak = area;
						peakAtS = options.atS + (k - 1) * options.stepS;
					}
					a = b;
					b = c;
				}
				return { peak, total, peakAtS };
			};

			const rungs = [];
			let apertureGroups = 0;
			for (const rung of options.rungs) {
				// `installPinAndFrame` in `scripts/lib/flicker-detector.mjs`, shared
				// with `measure-mouth-flicker.mjs`: the framing is the basis of the
				// measurement, and two copies of it are two things to retune.
				const placement = await window.__pinAndFrame(id, {
					atS: options.atS,
					rangeKm: rung.rangeKm,
				});
				// **Resolved after the placement, not before it.** A body's render
				// layer is its distance, so the station is in the far scene until
				// the camera is put beside it and a frame has drawn — looked up
				// first, this found nothing, the floor arm hid nothing at all, and
				// it read exactly like a floor that cannot be lowered.
				// `__pinAndFrame` draws that frame before it returns.
				const aperture = [];
				g.nearScene.getObjectByName(id)?.traverse((child) => {
					if (child.name === "aperture") aperture.push(child);
				});
				apertureGroups = Math.max(apertureGroups, aperture.length);
				if (aperture.length !== 1)
					throw new Error(
						`expected one aperture group at ${rung.rangeKm} km, found ${aperture.length}`,
					);
				const present = sweep(rung.erode);
				for (const group of aperture) group.visible = false;
				const floor = sweep(rung.erode);
				for (const group of aperture) group.visible = true;
				rungs.push({ ...rung, placement, present, floor });
			}

			g.outputPass.setDither(g.settings.value.dither === "on");
			return { rungs, apertureGroups };
		},
		[
			stationId,
			{
				atS: AT_S,
				frames: FRAMES,
				stepS: STEP_S,
				rungs: RUNGS,
				changed: FLICKER_CHANGED,
				same: FLICKER_SAME,
			},
		],
	);

	check(
		"the trade station draws an aperture group to measure",
		result.apertureGroups === 1,
		`${result.apertureGroups} group(s) named "aperture"`,
	);

	for (const rung of result.rungs) {
		const where = `${rung.label}, erode ${rung.erode} px`;
		check(
			`the camera reaches the mouth ${where}`,
			Math.abs(rung.placement.actualKm - rung.placement.askedKm) < 0.01 &&
				rung.placement.offAxisDeg < 0.5,
			`asked ${rung.placement.askedKm.toFixed(3)} km, got ${rung.placement.actualKm.toFixed(3)} km at ${rung.placement.offAxisDeg.toFixed(2)}°`,
		);
		check(
			`an aperture-less mouth flickers on nothing ${where}`,
			rung.floor.peak === 0,
			`floor peak ${rung.floor.peak} px, total ${rung.floor.total}`,
		);
		check(
			`no mouth geometry draws for exactly one frame ${where}`,
			rung.present.peak === 0,
			`peak ${rung.present.peak} px at t=${rung.present.peakAtS?.toFixed(4) ?? "—"} s, total ${rung.present.total} over ${FRAMES - 2} triples (floor ${rung.floor.peak})`,
		);
	}
} finally {
	await browser.close();
}

exit();
