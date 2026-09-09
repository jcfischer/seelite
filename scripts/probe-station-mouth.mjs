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
 * 25,000–30,000 pixels a frame on the recording with nothing wrong. What only a
 * discontinuity can produce is a pixel where the two *neighbours* agree with
 * each other and the middle frame disagrees with both. Continuous motion across
 * an edge cannot.
 *
 * **And it is eroded, because a moving edge still trips the raw median.** A
 * one-pixel silhouette lands on a different pixel each frame, so hairlines trace
 * every rim in the raw mask — on the recording, 304 of 337 frames carry some.
 * Only a region that survives an erosion is a polygon rather than an edge, which
 * is the distinction acceptance 2 draws in the node.
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
} from "./lib/flicker-detector.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

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

await guardedOrigin(ORIGIN, [
	"src/station-mesh.ts",
	"src/station-interior-mesh.ts",
]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

try {
	const page = await browser.newPage({
		viewport: { width: 1100, height: 720 },
	});
	watch(page);
	await installFlickerDetector(page);
	await page.goto(`${ORIGIN}/?seed=54`, { waitUntil: "load" });
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

			/**
			 * Put the bodies at an absolute clock and the camera on the axis, in
			 * that order, without letting a real animation frame run.
			 *
			 * Writing `gameTime` alone moves only the *drawn* phase: bodies are
			 * placed by `advanceSystem`, which the write does not call. And
			 * `__viewAlongAxis` awaits two animation frames, which the loop
			 * servicing them advances the clock through — so a sweep placed with
			 * it starts wherever the page's boot happened to finish. Both were
			 * measured: they moved the same build's reading by 30%.
			 */
			const place = (rangeKm) => {
				g.world.gameTime = 0;
				advanceWorldClock(g.world, options.atS);
				const body = g.world.system.bodies.find((b) => b.id === id);
				const pose = g.poseOfStation(id);
				g.world.ship.pos = {
					x: body.pos.x + pose.axis.x * rangeKm,
					y: body.pos.y + pose.axis.y * rangeKm,
					z: body.pos.z + pose.axis.z * rangeKm,
				};
				// Co-moving, for `__placeShipAt`'s reason: at 1 AU a station is
				// carried at ~30 km/s, so a ship at rest in sim space is not parked
				// beside it.
				g.world.ship.vel = g.stationVelocity(id);
				const from = g.nearScene.position.clone().set(0, 0, -1);
				const to = g.nearScene.position
					.clone()
					.set(-pose.axis.x, -pose.axis.y, -pose.axis.z);
				g.orientation.setFromUnitVectors(from, to);
				const d = {
					x: g.world.ship.pos.x - body.pos.x,
					y: g.world.ship.pos.y - body.pos.y,
					z: g.world.ship.pos.z - body.pos.z,
				};
				const actualKm = Math.hypot(d.x, d.y, d.z);
				// **One frame drawn before anything is looked up.** A body's render
				// layer is decided inside `render`, so until a frame runs the
				// station is still wherever boot left it — and the first rung's
				// `getObjectByName` on the near scene found nothing, which made its
				// floor arm hide nothing and read identical to the present arm.
				// Identical is exactly what a floor that cannot be lowered looks
				// like, so the row passed as a defect and failed as a floor.
				g.render(0);
				// #271: a placement is a request, and a camera round the side of a
				// subject is looking at a different face of it. Both are read back.
				return {
					askedKm: rangeKm,
					actualKm,
					offAxisDeg:
						(Math.acos(
							Math.min(
								1,
								Math.max(
									-1,
									(d.x * pose.axis.x + d.y * pose.axis.y + d.z * pose.axis.z) /
										actualKm,
								),
							),
						) *
							180) /
						Math.PI,
				};
			};

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
				const placement = place(rung.rangeKm);
				// **Resolved after the placement, not before it.** A body's render
				// layer is its distance, so the station is in the far scene until
				// the camera is put beside it — looked up first, this found nothing
				// and the floor arm silently hid nothing at all, which reads exactly
				// like a floor that cannot be lowered.
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
