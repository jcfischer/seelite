/**
 * **What flickers at a station mouth, and which object is responsible (#269).**
 *
 * The principal's playtest recording holds a nearly stationary close-range
 * cockpit view on a trade aperture, and geometry at the inner mouth appears and
 * disappears between adjacent frames. This is the attribution instrument for
 * that: it reproduces the framing deterministically, finds the pixels that are
 * present in one frame and in neither of its neighbours, and then names the
 * objects those pixels are drawn from.
 *
 * **A whole-frame difference cannot see this and neither can a single pair.**
 * The station turns, so every adjacent pair differs over the whole silhouette —
 * measured on the recording, 25,000–30,000 pixels a frame moved past 24/255 with
 * nothing wrong. What isolates a discontinuity is the *temporal median*: a pixel
 * where the two neighbours agree with each other and the middle frame disagrees
 * with both. Continuous motion cannot produce that; a polygon that draws in one
 * frame and not the next can.
 *
 * **And the raw median mask is not a defect count either.** A rotating edge one
 * pixel wide legitimately lands on a different pixel each frame, so thin lines
 * trace every silhouette in the mask — 304 of the recording's 337 frames carry
 * some. The reading that means something is what survives an erosion: a filled
 * region several pixels across in every direction is a polygon, and a hairline
 * is an edge. `--erode` is that radius and `area` is what it leaves.
 *
 * Two attributions, because they answer different halves:
 *
 * - `rays` casts the camera ray through each surviving pixel and reports the
 *   two nearest hits by object name, with the gap between them. Two hits inside
 *   the depth buffer's resolution at that range is a depth fight and names both
 *   parties; one hit that is present at `t` and absent at `t ± dt` is a
 *   visibility change and names one.
 * - `hide` re-runs the whole sweep with one named set of objects hidden. The
 *   set whose removal takes the area to zero is the responsible one, and it is
 *   evidence a ray cast cannot give: a ray reads the scene graph, and a pass
 *   that draws outside it — occlusion, bloom — is invisible to it.
 *
 * Run against a dev server on this working tree (`npm run dev`), like every
 * other measurement script here.
 */
import {
	FLICKER_CHANGED,
	FLICKER_SAME,
	installFlickerDetector,
} from "./lib/flicker-detector.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.env.ORIGIN ?? "http://localhost:5173";

const arg = (name, fallback) => {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const num = (name, fallback) => Number(arg(name, fallback));

const SEED = arg("seed", "54");
const TYPE = arg("type", "trade");
/** Kilometres from the station's **centre**, not from its aperture plane —
 *  `__viewAlongAxis`'s own convention, and the trade's plane is 0.428 km out,
 *  so 0.6 km here is 0.17 km off the mouth. The recording's HUD reads Traffic
 *  at 0.9-1.0 km, which is about 1.4 km on this scale. */
const RANGE_KM = num("range", 1.2);
/** Where in the station's turn to start, as an **absolute** game clock. Body
 *  positions are not re-placed by the pin, so only the drawn phase moves. */
const FROM_S = num("from", 2);
/** How many frames to sweep, and the step between them. A 60 Hz step is what
 *  the recording was taken at, so a discontinuity visible there is visible
 *  here at the same sampling. */
const FRAMES = num("frames", 90);
const STEP_S = num("step", 1 / 60);
/** Erosion radius, pixels. 0 reports the raw median mask. */
const ERODE = num("erode", 2);
/** Per-channel difference that counts as a change, and the ceiling under which
 *  two frames count as agreeing. Defaulted from the shared detector, so a
 *  retune there reaches this instrument and the probe together — and still
 *  overridable here, because exploring a threshold is what an instrument is
 *  for. */
const CHANGED = num("changed", FLICKER_CHANGED);
const SAME = num("same", FLICKER_SAME);
const VIEW = arg("view", "cockpit");
const MODE = arg("mode", "sweep");
/** Names hidden in **every** arm, the baseline included. A residual is only
 *  legible against the thing already removed: with the lit bars hidden, what
 *  is left has to be a fight between two of the rings behind them. */
const BASE_HIDE = arg("base-hide", "")
	.split(",")
	.filter((n) => n !== "");
const TOP = num("top", 6);
/** Where to write the peak frame and the mask drawn over it. Empty writes
 *  nothing; a run that only wants the numbers should not pay for two PNGs. */
const SAVE = arg("save", "");

const browser = await launchChromium();
try {
	await guardedOrigin(ORIGIN, [
		"src/main.ts",
		"src/station-mesh.ts",
		"src/station-interior-mesh.ts",
	]);
	const page = await browser.newPage({
		viewport: { width: 1100, height: 720 },
	});
	await installViewPlacement(page);
	await installFlickerDetector(page);
	await page.goto(`${ORIGIN}/?seed=${SEED}`, { waitUntil: "load" });
	await bootedGame(page);

	const stationId = await page.evaluate(
		(type) =>
			window.__seelite.world.system.contents.stations.find(
				(station) => station.type === type,
			)?.id ?? null,
		TYPE,
	);
	if (!stationId) throw new Error(`seed ${SEED} has no ${TYPE} station`);

	const result = await page.evaluate(
		async ([id, options]) => {
			const g = window.__seelite;
			// **The optimised dep, not a bare specifier and not the source build.**
			// A bare `three` does not resolve in the page, and
			// `node_modules/three/build/three.module.js` is a *second* instance —
			// its `Raycaster` would be walking objects built by the first. This is
			// the module Vite already handed the app.
			const THREE = await import("/node_modules/.vite/deps/three.js");
			const { advanceWorldClock } = await import("/src/sim.ts");
			cancelAnimationFrame(g.animationFrame);
			g.view = options.view;
			g.setHeadLook("forward");
			// The dither is per-pixel noise added in display space, which is
			// exactly what the median detector is looking for. It is a display
			// term and not geometry, so removing it removes noise and no signal.
			g.outputPass.setDither(false);

			const gl = g.renderer.getContext();
			const depthBits = gl.getParameter(gl.DEPTH_BITS) || 24;

			const canvas = g.renderer.domElement;
			const W = canvas.width;
			const H = canvas.height;
			const scratch = document.createElement("canvas");
			scratch.width = W;
			scratch.height = H;
			const ctx = scratch.getContext("2d", { willReadFrequently: true });
			// **An absolute clock, and the bodies moved to it — then the camera
			// placed, in that order.** Three revisions of this were wrong, each
			// producing a different answer on the same build:
			//
			// - `savedClock + from` swept whatever part of the turn the page's own
			//   boot had reached, so two runs disagreed by 30%.
			// - Writing `gameTime` alone moves only the *drawn* phase — bodies are
			//   placed by `advanceSystem`, which the write does not call — so the
			//   station stayed wherever the boot's last real frame had left it, and
			//   the star and the aperture axis with it.
			// - Placing through `__viewAlongAxis` awaits two animation frames, and
			//   the loop servicing them advances the clock again.
			//
			// So: bodies to an absolute `t0` first, then the camera against the
			// pose read at that instant, then no more real frames — the sweep
			// writes `gameTime` and renders by hand, which turns the station and
			// nothing else.
			g.world.gameTime = 0;
			advanceWorldClock(g.world, options.fromS);
			const t0 = options.fromS;

			const body = g.world.system.bodies.find((b) => b.id === id);
			const pose = g.poseOfStation(id);
			g.world.ship.pos = {
				x: body.pos.x + pose.axis.x * options.rangeKm,
				y: body.pos.y + pose.axis.y * options.rangeKm,
				z: body.pos.z + pose.axis.z * options.rangeKm,
			};
			// Co-moving, for `__placeShipAt`'s reason: at 1 AU the station is
			// carried at ~30 km/s, and a camera at rest in sim space is not
			// parked beside it. Nothing here integrates the ship, so this only
			// has to be right for the frame the pose was read at — but the
			// **reading below is what says so**, rather than this comment.
			g.world.ship.vel = g.stationVelocity(id);
			g.orientation.setFromUnitVectors(
				new THREE.Vector3(0, 0, -1),
				new THREE.Vector3(-pose.axis.x, -pose.axis.y, -pose.axis.z),
			);
			// #271's reading: a placement is a request, and both numbers are owed
			// — a camera short in range but round the side is looking at a
			// different face.
			const d = {
				x: g.world.ship.pos.x - body.pos.x,
				y: g.world.ship.pos.y - body.pos.y,
				z: g.world.ship.pos.z - body.pos.z,
			};
			const actualKm = Math.hypot(d.x, d.y, d.z);
			const placement = {
				askedKm: options.rangeKm,
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

			// The named sets a run may hide, resolved once against this station's
			// drawn tree. `null` is the baseline arm and hides nothing.
			const station = window.__meshOfBody(id);
			const byName = new Map();
			station.traverse((child) => {
				if (!child.isMesh && !child.isGroup) return;
				if (!child.name) return;
				const bucket = byName.get(child.name) ?? [];
				bucket.push(child);
				byName.set(child.name, bucket);
			});

			const frameAt = (t) => {
				// Only the *drawn* phase moves: bodies are not re-placed, so this is
				// the same pin `probe-dock-arrival.mjs` and `probe-station-visuals`
				// use, and for the same reason — a sweep must decide on the build
				// and not on how long the run took.
				g.world.gameTime = t;
				g.render(0);
				ctx.drawImage(canvas, 0, 0);
				return ctx.getImageData(0, 0, W, H).data;
			};

			// The detector is `scripts/lib/flicker-detector.mjs`, shared with
			// `probe-station-mouth.mjs`. This script explains a mask and that one
			// gates on it, so a retune of either threshold has to reach both.
			const medianMask = (a, b, c) =>
				window.__flickerMask(a, b, c, {
					width: W,
					height: H,
					erode: options.erode,
					changed: options.changed,
					same: options.same,
				});

			const sweep = (hidden) => {
				const names = [...options.baseHide, ...(hidden ?? [])];
				const restore = hide(names);
				let a = frameAt(t0);
				let b = frameAt(t0 + options.stepS);
				const rows = [];
				let peak = null;
				for (let k = 2; k < options.frames; k++) {
					const c = frameAt(t0 + k * options.stepS);
					const { mask, area, rawCount } = medianMask(a, b, c);
					const at = t0 + (k - 1) * options.stepS;
					rows.push({ k: k - 1, at, area, rawCount });
					if (!peak || area > peak.area) peak = { k: k - 1, at, area, mask };
					a = b;
					b = c;
				}
				restore();
				return { rows, peak };
			};

			const summarise = ({ rows, peak }) => ({
				frames: rows.length,
				area: {
					total: rows.reduce((s, r) => s + r.area, 0),
					peak: peak?.area ?? 0,
					peakAtS: peak?.at ?? null,
					nonZero: rows.filter((r) => r.area > 0).length,
				},
				raw: {
					total: rows.reduce((s, r) => s + r.rawCount, 0),
					peak: Math.max(0, ...rows.map((r) => r.rawCount)),
				},
				worst: rows
					.slice()
					.sort((x, y) => y.area - x.area)
					.slice(0, 8)
					.map((r) => ({ k: r.k, at: r.at, area: r.area, raw: r.rawCount })),
			});

			const base = sweep(null);
			const out = {
				placement,
				viewport: { W, H },
				names: [...byName.keys()].sort(),
				baseline: summarise(base),
			};

			// **The mask, as a picture.** A count says how much moved and a
			// picture says what shape it is, which is the whole difference
			// between a rim that aliases and a polygon that pops. Returned as a
			// data URL so the run leaves the evidence on disk rather than in a
			// number the next reader has to trust.
			if (options.savePeak && base.peak?.area) {
				const restore = hide(options.baseHide);
				g.world.gameTime = base.peak.at;
				g.render(0);
				ctx.drawImage(canvas, 0, 0);
				out.peakFrame = scratch.toDataURL("image/png");
				const paint = ctx.getImageData(0, 0, W, H);
				for (let p = 0; p < W * H; p++) {
					if (!base.peak.mask[p]) continue;
					paint.data[p * 4] = 255;
					paint.data[p * 4 + 1] = 0;
					paint.data[p * 4 + 2] = 0;
				}
				ctx.putImageData(paint, 0, 0);
				out.peakOverlay = scratch.toDataURL("image/png");
				restore();
			}

			// **Which objects the surviving pixels are drawn from.** The camera
			// sits at the origin of the near scene by construction, so a ray is
			// the unprojected pixel direction from there.
			if (options.mode === "sweep" || options.mode === "rays") {
				const peak = base.peak;
				out.rays = { at: peak?.at ?? null, hits: [], points: [] };
				if (peak?.area) {
					// Under the same hiding the mask was measured under, and the
					// hidden objects excluded from the ray's own hits — a ray that
					// can still strike an object the arm removed reports it as the
					// culprit for a pixel that arm did not draw.
					const restoreRays = hide(options.baseHide);
					const excluded = new Set();
					for (const name of options.baseHide)
						for (const object of byName.get(name) ?? [])
							object.traverse((child) => excluded.add(child));
					g.world.gameTime = peak.at;
					g.render(0);
					const caster = new THREE.Raycaster();
					caster.camera = g.nearCamera;
					const origin = new THREE.Vector3(0, 0, 0);
					const dir = new THREE.Vector3();
					const tally = new Map();
					let sampled = 0;
					for (let p = 0; p < W * H && sampled < options.raySamples; p++) {
						if (!peak.mask[p]) continue;
						sampled++;
						const x = p % W;
						const y = Math.floor(p / W);
						dir
							.set((x / W) * 2 - 1, -((y / H) * 2 - 1), 0.5)
							.unproject(g.nearCamera)
							.normalize();
						caster.set(origin, dir);
						const hits = caster.intersectObject(g.nearScene, true);
						const named = hits
							.filter(
								(h) =>
									h.object.visible &&
									!inPlayer(h.object) &&
									!excluded.has(h.object),
							)
							.slice(0, 2)
							.map((h) => ({
								name: h.object.name || h.object.parent?.name || "(unnamed)",
								distanceKm: h.distance,
							}));
						const key = named.map((h) => h.name).join(" | ") || "(nothing)";
						if (named.length && out.rays.points.length < 12) {
							// The hit read back in the **station's own frame**, which is
							// where the geometry that placed it was written. A world
							// point says the ray hit something; a local one says which
							// face of which bar, and can be compared against the numbers
							// in `station-mesh.ts` directly.
							const first = hits.find(
								(h) => !inPlayer(h.object) && !excluded.has(h.object),
							);
							const local = station.worldToLocal(first.point.clone());
							out.rays.points.push({
								key,
								local: {
									x: local.x,
									y: local.y,
									z: local.z,
								},
								faceNormal: first.normal,
							});
						}
						const row = tally.get(key) ?? {
							key,
							count: 0,
							gapKm: [],
							nearKm: [],
							coincident: 0,
						};
						row.count++;
						if (named.length === 2) {
							const gap = named[1].distanceKm - named[0].distanceKm;
							row.gapKm.push(gap);
							// **The depth buffer's own resolution at this range**, which
							// is what decides whether two surfaces can be told apart:
							// `z²·(1/near − 1/far)/2^bits`. Anything inside it is a
							// fight rather than a stack.
							if (gap < quantumKm(named[0].distanceKm)) row.coincident++;
						}
						if (named.length >= 1) row.nearKm.push(named[0].distanceKm);
						tally.set(key, row);
					}
					out.rays.sampled = sampled;
					out.rays.depth = {
						nearKm: g.nearCamera.near,
						farKm: g.nearCamera.far,
						bits: depthBits,
					};
					restoreRays();
					out.rays.hits = [...tally.values()]
						.sort((a2, b2) => b2.count - a2.count)
						.map((row) => ({
							key: row.key,
							count: row.count,
							coincident: row.coincident,
							medianGapKm: median(row.gapKm),
							medianNearKm: median(row.nearKm),
							quantumKm:
								median(row.nearKm) === null
									? null
									: quantumKm(median(row.nearKm)),
						}));
				}
			}

			// **What removing a candidate does to the whole sweep.** One arm per
			// name, so an arm that takes the area to zero has named the object and
			// an arm that does not has cleared it.
			if (options.mode === "sweep" || options.mode === "hide") {
				out.hide = [];
				for (const name of options.hideNames.filter((n) => byName.has(n)))
					out.hide.push({ name, ...summarise(sweep([name])) });
			}

			g.outputPass.setDither(g.settings.value.dither === "on");
			g.render(0);
			return out;

			/**
			 * The player's own hull and cabin sit **at the camera**, so every ray
			 * hits them first at ~0 km and every attribution reads `nav-lights`.
			 * They are the one thing in the near scene that cannot be the subject
			 * of a framing on a station, so they are walked past rather than
			 * hidden — hiding them would change the frame the mask came from.
			 */
			/**
			 * How far apart two surfaces have to be at distance `z` before this
			 * depth buffer can order them, kilometres.
			 *
			 * `logarithmicDepthBuffer` is off (`main.ts`), so the stored value is
			 * the usual `1/z` hyperbola and one code covers
			 * `z²·(1/near − 1/far)/2^bits`. The bit count is read off the context
			 * rather than assumed: three asks for a depth *renderbuffer* on the
			 * composer's target and the driver picks the format, so a run on a
			 * 16-bit attachment resolves 256 times more coarsely than the 24-bit
			 * one this arithmetic would otherwise claim.
			 */
			function quantumKm(z) {
				return (
					(z * z * (1 / g.nearCamera.near - 1 / g.nearCamera.far)) /
					2 ** depthBits
				);
			}

			function inPlayer(object) {
				for (let n = object; n; n = n.parent)
					if (n.name === "ship" || n.name === "cockpit") return true;
				return false;
			}

			function median(values) {
				if (!values.length) return null;
				const s = values.slice().sort((x, y) => x - y);
				return s[Math.floor(s.length / 2)];
			}
		},
		[
			stationId,
			{
				view: VIEW,
				rangeKm: RANGE_KM,
				fromS: FROM_S,
				frames: FRAMES,
				stepS: STEP_S,
				erode: ERODE,
				changed: CHANGED,
				same: SAME,
				mode: MODE,
				baseHide: BASE_HIDE,
				raySamples: 400,
				savePeak: SAVE !== "",
				hideNames: [
					"aperture-light",
					"coaming",
					"station-nameplate",
					"interior-bulkhead",
					"interior-lane-edge",
					"station-interior",
					"aperture",
				],
			},
		],
	);

	const placement = result.placement;
	console.log(
		`mouth flicker — seed ${SEED} ${TYPE}, ${result.viewport.W}x${result.viewport.H}, ` +
			`bodies pinned at t=${FROM_S} s, ` +
			`asked ${placement.askedKm.toFixed(3)} km, actual ${placement.actualKm.toFixed(3)} km, ` +
			`${placement.offAxisDeg.toFixed(2)}° off axis`,
	);
	console.log(
		`sweep: ${FRAMES} frames at ${(STEP_S * 1000).toFixed(2)} ms, ` +
			`erode ${ERODE} px, changed >${CHANGED}, same <${SAME}` +
			(BASE_HIDE.length
				? `, hidden in every arm: ${BASE_HIDE.join(", ")}`
				: ""),
	);
	const b = result.baseline;
	console.log(
		`\nbaseline: eroded area total ${b.area.total}, peak ${b.area.peak} px at t=${
			b.area.peakAtS === null ? "—" : b.area.peakAtS.toFixed(4)
		} s, ${b.area.nonZero}/${b.frames} frames non-zero  (raw median total ${b.raw.total}, peak ${b.raw.peak})`,
	);
	console.log("  worst frames:");
	for (const w of b.worst)
		console.log(
			`    k=${w.k} t=${w.at.toFixed(4)}  area ${w.area}  raw ${w.raw}`,
		);

	if (result.rays) {
		const d = result.rays.depth;
		console.log(
			`\nrays at t=${result.rays.at === null ? "—" : result.rays.at.toFixed(4)} s, ${result.rays.sampled ?? 0} mask pixels sampled` +
				(d
					? `  (depth ${d.bits}-bit, near ${d.nearKm} km, far ${d.farKm} km)`
					: ""),
		);
		console.log(
			"   n   first | second hit                              range      gap      depth quantum   inside",
		);
		for (const hit of result.rays.hits.slice(0, TOP))
			console.log(
				`  ${String(hit.count).padStart(3)}  ${hit.key.padEnd(42)}` +
					` ${hit.medianNearKm === null ? "—" : `${hit.medianNearKm.toFixed(5)} km`}` +
					` ${hit.medianGapKm === null ? "        —" : `${(hit.medianGapKm * 1e6).toFixed(2).padStart(8)} mm`}` +
					` ${hit.quantumKm === null ? "        —" : `${(hit.quantumKm * 1e6).toFixed(2).padStart(9)} mm`}` +
					`   ${hit.coincident}/${hit.count}`,
			);
	}

	if (result.hide) {
		console.log("\nhide-and-diff (eroded area over the same sweep):");
		console.log(
			`  ${"(nothing hidden)".padEnd(24)} ${String(b.area.total).padStart(8)}  peak ${b.area.peak}`,
		);
		for (const arm of result.hide)
			console.log(
				`  ${arm.name.padEnd(24)} ${String(arm.area.total).padStart(8)}  peak ${arm.area.peak}`,
			);
		console.log(
			`\n  names present on this station: ${result.names.join(", ")}`,
		);
	}
	if (SAVE && result.peakOverlay) {
		const { writeFileSync, mkdirSync } = await import("node:fs");
		const { dirname } = await import("node:path");
		mkdirSync(dirname(`${SAVE}-overlay.png`), { recursive: true });
		for (const [suffix, url] of [
			["frame", result.peakFrame],
			["overlay", result.peakOverlay],
		])
			writeFileSync(
				`${SAVE}-${suffix}.png`,
				Buffer.from(url.split(",")[1], "base64"),
			);
		console.log(`\nwrote ${SAVE}-frame.png and ${SAVE}-overlay.png`);
	}

	if (result.rays?.points?.length) {
		console.log("\nfirst hits, in the station's own frame (core radii):");
		for (const p of result.rays.points)
			console.log(
				`  ${p.key.padEnd(42)} x ${p.local.x.toFixed(5)}  y ${p.local.y.toFixed(5)}  z ${p.local.z.toFixed(5)}` +
					(p.faceNormal
						? `   n (${p.faceNormal.x.toFixed(2)}, ${p.faceNormal.y.toFixed(2)}, ${p.faceNormal.z.toFixed(2)})`
						: ""),
			);
	}
} finally {
	await browser.close();
}
