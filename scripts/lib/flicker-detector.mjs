/**
 * The one-frame-only pixel detector, page-side, for #269's two consumers.
 *
 * `probe-station-mouth.mjs` asserts on it and `measure-mouth-flicker.mjs`
 * attributes with it. They were written with a copy each and sage asked for one
 * (PR #284, round 1): a detector is a definition, and two definitions of one
 * measurement drift the moment either threshold is retuned — the probe would
 * then be gating on a rule the instrument no longer explains.
 *
 * **Here rather than in `probe-guard.mjs`**, for the reason that module's own
 * docstring gives for `view-placement.mjs`: an installer put there is injected
 * into every page this repo opens, and this one has two callers.
 *
 * ## What it measures, and why not a frame difference
 *
 * A station turns, so adjacent frames legitimately differ over the whole
 * silhouette — 25,000–30,000 pixels a frame on the principal's recording of a
 * mouth that was working. What this finds instead is a pixel where the two
 * *neighbours* agree with each other and the middle frame disagrees with both,
 * which is a discontinuity in what that pixel shows.
 *
 * ## And why it is eroded
 *
 * A one-pixel silhouette under rotation lands on a different pixel each frame,
 * so hairlines trace every rim in the raw mask — 304 of the recording's 337
 * frames carry some. Erosion drops those: only a region several pixels across in
 * every direction survives it. `rawCount` is kept beside `area` because a fix
 * that merely pushed a fight under the erosion radius would show as a raw count
 * that did not move.
 *
 * ## What a surviving region does **not** prove, and what closes the gap
 *
 * It does not prove a polygon popped, and an earlier revision of this file
 * claimed it did — that continuous motion across an edge could not produce one.
 * It can: a subject that moves further than its own extent between frames lands
 * on disjoint pixels in all three, so the middle one differs from two neighbours
 * that agree. Sage built the case (PR #284, round 2) and it is exact — an
 * always-visible 8x16 rectangle translating 12 px a frame reads `area` 48 at
 * `erode` 2.
 *
 * **So a mask says where to look and not what is there**, and the floor arm does
 * not close that gap either. An earlier revision said it did — that the same
 * sweep with the aperture hidden reading 0 showed the motion could not be what
 * the mask was made of. It does not: hiding the aperture removes the candidate
 * *and* the moving geometry together, so its zero is consistent with both
 * readings. Sage caught that in round 3, having caught the claim it replaced in
 * round 2. What the floor arm does establish is narrower and still worth having:
 * the mask requires the aperture, so it is not made by the rest of the station.
 *
 * What separates a depth fight from motion is **attribution, not the mask**. For
 * #269 that was `measure-mouth-flicker.mjs`'s ray column — every sampled pixel's
 * two nearest surfaces within the depth buffer's own resolution at that range,
 * 0.00 mm against 0.19 mm — together with the outcome: separating coplanar faces
 * by a metre removed the mask, and no motion-derived signal responds to that.
 *
 * A consumer of this detector therefore gates on *a discontinuity at the mouth*,
 * which is what #269's acceptance 2 asks for, and owes its diagnosis to an
 * instrument rather than to the count.
 */

/**
 * Install `window.__flickerMask(a, b, c, opts)` on this page.
 *
 * Call before `page.goto`; it re-runs on every navigation.
 */
export async function installFlickerDetector(page) {
	await page.addInitScript(() => {
		const dmax = (a, b, i) =>
			Math.max(
				Math.abs(a[i] - b[i]),
				Math.abs(a[i + 1] - b[i + 1]),
				Math.abs(a[i + 2] - b[i + 2]),
			);

		/**
		 * `a`, `b`, `c` are three consecutive frames as RGBA byte arrays.
		 *
		 * Returns `{ mask, area, rawCount }` — the eroded mask, how many pixels
		 * survive it, and how many were in the raw median before it. `erode` of 0
		 * returns the raw mask unchanged.
		 */
		window.__flickerMask = (a, b, c, opts) => {
			const { width: W, height: H, erode, changed, same } = opts;
			const raw = new Uint8Array(W * H);
			let rawCount = 0;
			for (let p = 0; p < W * H; p++) {
				const i = p * 4;
				if (
					dmax(a, c, i) < same &&
					dmax(a, b, i) > changed &&
					dmax(b, c, i) > changed
				) {
					raw[p] = 1;
					rawCount++;
				}
			}
			if (erode <= 0) return { mask: raw, area: rawCount, rawCount };
			// A pixel survives only with every neighbour inside the radius also
			// set: a hairline cannot, a filled region can.
			const eroded = new Uint8Array(W * H);
			let area = 0;
			for (let y = erode; y < H - erode; y++)
				for (let x = erode; x < W - erode; x++) {
					if (!raw[y * W + x]) continue;
					let solid = 1;
					for (let oy = -erode; oy <= erode && solid; oy++)
						for (let ox = -erode; ox <= erode; ox++)
							if (!raw[(y + oy) * W + x + ox]) {
								solid = 0;
								break;
							}
					if (solid) {
						eroded[y * W + x] = 1;
						area++;
					}
				}
			return { mask: eroded, area, rawCount };
		};
	});
}

/**
 * The thresholds both consumers read, so a retune reaches both.
 *
 * `CHANGED` is the per-channel difference that counts as a change and `SAME` the
 * ceiling under which two frames count as agreeing. Neither is a tone-mapping
 * tolerance: the dither is switched off for a sweep, because it is per-pixel
 * noise in display space and therefore exactly the shape this detector looks
 * for.
 */
export const FLICKER_CHANGED = 30;
export const FLICKER_SAME = 12;

/**
 * Install `window.__pinAndFrame(id, { atS, rangeKm })` on this page.
 *
 * Puts the bodies at an absolute game clock and the camera on a station's
 * aperture axis, in that order, without letting a real animation frame run —
 * and returns `{ askedKm, actualKm, offAxisDeg }`, which is #271's reading: a
 * placement is a request, and a camera round the side of a subject is looking at
 * a different face of it.
 *
 * **Shared because it is the measurement's basis** (sage, PR #284, round 2).
 * `probe-station-mouth.mjs` gates on a framing and `measure-mouth-flicker.mjs`
 * explains one, and two copies of the setup is two things to retune when the
 * framing moves.
 *
 * Three ways of doing this were wrong first, and each moved the same build's
 * answer:
 *
 * - an offset from the boot clock, which swept whatever part of the station's
 *   turn the page's own boot had reached;
 * - writing `gameTime` alone, which moves only the *drawn* phase — bodies are
 *   placed by `advanceSystem`, which the write does not call — leaving the
 *   station, the aperture axis and the star where boot left them;
 * - `__viewAlongAxis`, which awaits two animation frames that the loop
 *   servicing them advances the clock through.
 *
 * It draws one frame before returning, because a body's render layer is decided
 * inside `render`: until a frame has run the station is not in the near scene
 * and nothing can be looked up on it.
 *
 * Call before `page.goto`; it re-runs on every navigation.
 */
export async function installPinAndFrame(page) {
	await page.addInitScript(() => {
		window.__pinAndFrame = async (id, { atS, rangeKm }) => {
			const g = window.__seelite;
			const { advanceWorldClock } = await import("/src/sim.ts");
			g.world.gameTime = 0;
			advanceWorldClock(g.world, atS);
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
			g.render(0);
			const d = {
				x: g.world.ship.pos.x - body.pos.x,
				y: g.world.ship.pos.y - body.pos.y,
				z: g.world.ship.pos.z - body.pos.z,
			};
			const actualKm = Math.hypot(d.x, d.y, d.z);
			const cos =
				(d.x * pose.axis.x + d.y * pose.axis.y + d.z * pose.axis.z) / actualKm;
			return {
				askedKm: rangeKm,
				actualKm,
				offAxisDeg: (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI,
			};
		};
	});
}
