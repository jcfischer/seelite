/**
 * #36's visual pass, measured on screen — `docs/specs/station-visuals.md` §6.
 *
 *   npm run dev                              # in one shell
 *   node scripts/probe-station-visuals.mjs   # in another
 *
 * `tests/station-visuals.test.ts` owns the arithmetic: the bands, the texel
 * buffers, the waveforms, and §2's rule that a detail level may not change the
 * outline. What is left for a browser is what none of that can see.
 *
 * 1. **Each role's lit signature is its own.** §5 gives the trade station warm
 *    habitation light with a red/green beacon pair, the shipyard cold bays and a
 *    white arc, and the refinery a warm flare.
 *
 *    Measured on the pixels the role's **own fixtures** contribute — the frame
 *    as drawn, differenced against the same frame with every fixture switched
 *    off — and not on the station's lit pixels generally. The first version did
 *    the latter and could not tell this pass's light from two things it does not
 *    own: `STATION_COLORS`' hull paint, which differs per type by design, and
 *    the sun, whose direction depends on where in its orbit that station is.
 *    Differencing against a lights-off render removes both, because both are
 *    present in each capture.
 *
 *    #28's amber aperture frame is left *out* of the fixture set. It is not this
 *    pass's light and it is the same colour on all three, so including it would
 *    only dilute the three signatures toward each other.
 *
 * 2. **The aperture is the brightest thing on the station.** The four emissive
 *    bars are hidden and the frame re-rendered; the pixels that changed are the
 *    aperture's, and their mean luminance is compared to the station's. Only the
 *    bars are hidden, never the dark mouth they surround — hiding both moves the
 *    brightness in two directions at once and nets out to nothing.
 *
 * 3. **Detail falls with range, and the outline does not move when it does.**
 *    Two separate measurements, because they are not measurable at the same
 *    range.
 *
 *    The band is read as a level string at three ranges chosen from the
 *    station's own silhouette budget — no pixels involved.
 *
 *    The outline is compared at **one** range, docking range, between the
 *    station as drawn and the same station with every accessory hidden. Not
 *    between a near and a far capture, which is what an earlier version did: at
 *    the `outline` band a station is a handful of pixels, so resampling that
 *    mask to a 24 × 24 grid measures the sampler rather than the station, and
 *    the far masks scored a `1 − IoU` of 1.000 against a build whose vertex
 *    reach was provably identical at every level. Both captures here come from
 *    one evaluate, so the station cannot move between them.
 *
 * 4. **The beacons flash, and they flash on the game clock.** §5.2 makes every
 *    intensity a pure function of `gameTime`, so this writes a clock value and
 *    renders rather than waiting for a flash to happen. A probe that waited
 *    would be timing the frame loop.
 *
 * Everything measured here is read through `visualOfStation` — the same handle
 * the render loop writes — rather than recomputed. The bands are directional, so
 * "what level would the arithmetic return" and "what level is on screen" are
 * different questions, and only the second one is what a player sees.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
/** Seed 1, for `probe-station.mjs`'s reason: its start system holds all three
 *  station types, which is the only way to compare three lit signatures under
 *  one lighting setup. */
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=1`;

const VIEWPORTS = [
	{ name: "desktop", width: 1100, height: 720 },
	{ name: "narrow", width: 390, height: 844 },
];

/** Docking range, in the station's own silhouette radii — inside the `full`
 *  band by a wide margin, and read as radii so the refinery's 0.4 km drum and
 *  the shipyard's 1.5 km frame are looked at from the same apparent size. */
const CLOSE_RADII = 8;
/** Two ranges either side of the far band edge, likewise in radii. The band
 *  edges themselves come off the page; these only have to be clear of them. */
const REDUCED_RADII = 48;
const OUTLINE_RADII = 900;

/** The silhouette mask is resampled to this grid before shapes are compared —
 *  `probe-station.mjs`'s grid, for the same reason: the comparison must be of
 *  shape and not of apparent size. */
const GRID = 24;
/**
 * How much the silhouette may move when every accessory is switched off, as
 * `1 − IoU` on the resampled masks.
 *
 * Not a noise floor: both captures come from one evaluate at one range and one
 * clock, so the only noise left is the resampling of two masks that differ by a
 * bloom halo. Measured on a passing build, the three types come out at 0.000,
 * 0.000 and 0.026 — the 0.026 being the trade station, whose hull *is* its
 * silhouette and whose beacons therefore bloom closest to the limb.
 *
 * Be plain about which side that derivation comes from: 0.05 is twice the worst
 * value a **passing** build produces, and nothing here has measured a build
 * where an accessory really does carry the outline. What sets the other end of
 * the scale is `probe-station.mjs`, which measures this same `1 − IoU` between
 * *different* station types on the same resampled grid and records 0.35, 0.61
 * and 0.62. Two shapes that genuinely differ score an order of magnitude above
 * this line; a build that keeps its outline sits at least an order below it.
 *
 * The exact form of this claim is headless — the mesh's vertex reach is
 * identical at all three levels — and this is the rendered half, which is the
 * one that also sees the bloom pass.
 */
const MAX_OUTLINE_DRIFT = 0.05;

const installHelpers = (page) =>
	page.addInitScript(() => {
		window.__meshOfBody = (id) =>
			window.__seelite.nearScene.getObjectByName(id) ??
			window.__seelite.farScene.getObjectByName(id) ??
			null;
		window.__placeShipAt = async (pos) => {
			const g = window.__seelite;
			g.world.ship.pos = pos;
			g.world.ship.vel = { x: 0, y: 0, z: 0 };
			await new Promise((r) => requestAnimationFrame(() => r()));
			await new Promise((r) => requestAnimationFrame(() => r()));
		};
		/** Put the camera on a station's aperture axis at `rangeKm` and look back
		 *  down it — the view a docking approach has, and the one viewpoint
		 *  defined for all three types. The axis comes from `poseOfStation`. */
		window.__viewAlongAxis = async (bodyId, rangeKm) => {
			const g = window.__seelite;
			const body = g.world.system.bodies.find((b) => b.id === bodyId);
			const pose = g.poseOfStation(bodyId);
			await window.__placeShipAt({
				x: body.pos.x + pose.axis.x * rangeKm,
				y: body.pos.y + pose.axis.y * rangeKm,
				z: body.pos.z + pose.axis.z * rangeKm,
			});
			const from = g.nearScene.position.clone().set(0, 0, -1);
			const to = g.nearScene.position
				.clone()
				.set(-pose.axis.x, -pose.axis.y, -pose.axis.z);
			g.orientation.setFromUnitVectors(from, to);
			await new Promise((r) => requestAnimationFrame(() => r()));
		};
	});

await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/station-mesh.ts",
	"src/station-visuals.ts",
]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/**
 * Everything this probe needs about one station, from **one** evaluate.
 *
 * Five renders of the same scene — the station as drawn, with its aperture bars
 * hidden, with every role fixture unlit, with every accessory switched off, and
 * hidden altogether — differenced against each other.
 *
 * One evaluate and not four, and that is not a tidiness point. Between two
 * evaluates the frame loop runs: the station spins, its orbit carries it, and
 * the ship drifts. Measured across separate calls the same station's mask moved
 * by 1–3% and its bounding box by a pixel, which is the same size as the effect
 * being measured — so a correct build failed and the obvious repair would have
 * been to loosen the threshold until motion fitted inside it.
 *
 * The station is isolated by what *changed* rather than by thresholding the
 * frame, `probe-station.mjs`'s method: a starfield puts lit pixels everywhere
 * and the sun's direction depends on where in its orbit the station is, so any
 * absolute threshold would be tuned to one moment of one orbit.
 */
const measure = (page, bodyId) =>
	page.evaluate(
		([id, grid]) => {
			const g = window.__seelite;
			const W = 560;
			const H = 400;
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
			const mesh = window.__meshOfBody(id);
			if (!mesh) return { missing: true };

			const hideWhere = (predicate) => {
				const hidden = [];
				mesh.traverse((child) => {
					if (child.visible && predicate(child)) {
						child.visible = false;
						hidden.push(child);
					}
				});
				return hidden;
			};
			const show = (objects) => {
				for (const object of objects) object.visible = true;
			};

			const drawn = frame();
			const bars = hideWhere((c) => c.name === "aperture-light");
			const noAperture = frame();
			show(bars);
			// Every light §5 gives a role, by name. #28's amber aperture frame is
			// **not** in the list: it is not this pass's light and it is the same
			// colour on all three, so including it would dilute the three
			// signatures toward each other.
			const fixtureNames = [
				"windows",
				"beacon-port",
				"beacon-starboard",
				"bay-flood",
				"weld-arc",
				"heat-glow",
				"flare",
			];
			const lights = hideWhere((c) => fixtureNames.includes(c.name));
			const unlit = frame();
			show(lights);
			// By `userData.minDetail` and not by a list of names: that tag is what
			// `setStationDetail` itself reads, so this hides exactly the set the
			// detail bands hide. A name list here would be a second copy of the
			// tagging, and it would go out of date the first time a fixture was
			// added.
			const accessories = hideWhere((c) => Boolean(c.userData.minDetail));
			const bare = frame();
			show(accessories);
			mesh.visible = false;
			const empty = frame();
			mesh.visible = true;
			g.render(0);

			const luma = (d, i) =>
				0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];

			/** The pixels that differ between two renders, cropped to their own
			 *  box and resampled — so two masks compare as shapes and not as
			 *  apparent sizes. */
			const maskOf = (a, b) => {
				const mask = new Uint8Array(W * H);
				const lit = [];
				let minX = W;
				let maxX = -1;
				let minY = H;
				let maxY = -1;
				for (let i = 0; i < W * H; i++) {
					if (Math.abs(luma(a, i) - luma(b, i)) <= 6) continue;
					mask[i] = 1;
					lit.push(i);
					const x = i % W;
					const y = (i / W) | 0;
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
				// A shaped zero rather than a bare one: every caller reads `cells`
				// and `box`, and a station that failed to render should produce a
				// named red check rather than a TypeError with no check name on it.
				if (!lit.length)
					return {
						count: 0,
						warmth: 0,
						topLuma: 0,
						meanLuma: 0,
						box: { w: 0, h: 0 },
						cells: Array.from(new Uint8Array(grid * grid)),
					};
				const w = maxX - minX + 1;
				const h = maxY - minY + 1;
				const cells = new Uint8Array(grid * grid);
				for (let gy = 0; gy < grid; gy++) {
					for (let gx = 0; gx < grid; gx++) {
						const x = minX + Math.floor(((gx + 0.5) * w) / grid);
						const y = minY + Math.floor(((gy + 0.5) * h) / grid);
						cells[gy * grid + gx] = mask[y * W + x];
					}
				}
				// `warmth` is over the whole mask, because for the mask that
				// matters — the fixtures' own contribution — every pixel in it is
				// light this pass put there. `topLuma` stays on the brightest fifth,
				// which is what "brighter than the hull around it" is asking about.
				lit.sort((p, q) => luma(drawn, q) - luma(drawn, p));
				const top = lit.slice(0, Math.max(1, Math.floor(lit.length * 0.2)));
				let warmth = 0;
				let topLuma = 0;
				for (const i of lit) warmth += (drawn[i * 4] - drawn[i * 4 + 2]) / 255;
				for (const i of top) topLuma += luma(drawn, i);
				let meanLuma = 0;
				for (const i of lit) meanLuma += luma(drawn, i);
				return {
					count: lit.length,
					warmth: warmth / lit.length,
					topLuma: topLuma / top.length,
					meanLuma: meanLuma / lit.length,
					box: { w, h },
					cells: Array.from(cells),
				};
			};

			return {
				station: maskOf(drawn, empty),
				aperture: maskOf(drawn, noAperture),
				// What this pass's own fixtures put on screen — hull paint and
				// sunlight are in both captures and difference away.
				lights: maskOf(drawn, unlit),
				bare: maskOf(bare, empty),
				// What the accessories themselves contribute, measured directly
				// rather than as a difference of two counts.
				accessories: maskOf(drawn, bare),
			};
		},
		[bodyId, GRID],
	);

/** `1 − IoU` over two resampled masks. Zero is the same shape. */
const shapeDifference = (a, b) => {
	let union = 0;
	let both = 0;
	for (let i = 0; i < a.length; i++) {
		if (a[i] || b[i]) union++;
		if (a[i] && b[i]) both++;
	}
	return union ? 1 - both / union : 1;
};

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({
		viewport: { width: viewport.width, height: viewport.height },
	});
	watch(page);
	await installHelpers(page);
	await page.goto(URL, { waitUntil: "load" });
	await bootedGame(page);

	const stations = await page.evaluate(() =>
		window.__seelite.world.system.contents.stations.map((s) => ({
			id: s.id,
			type: s.type,
		})),
	);
	const byType = Object.fromEntries(stations.map((s) => [s.type, s.id]));
	const allThree = ["trade", "shipyard", "refinery"].every((t) => byType[t]);
	check(`${viewport.name}: the system holds all three station types`, allThree);
	if (!allThree) {
		await page.close();
		continue;
	}

	// --- 1 and 2: the lit signature, and the aperture inside it ---------------
	const lit = {};
	for (const [type, id] of Object.entries(byType)) {
		const silhouetteKm = await page.evaluate(
			(bodyId) => window.__seelite.visualOfStation(bodyId).silhouetteKm,
			id,
		);
		await page.evaluate(
			([bodyId, range]) => window.__viewAlongAxis(bodyId, range),
			[id, silhouetteKm * CLOSE_RADII],
		);
		const m = await measure(page, id);
		lit[type] = { ...m, silhouetteKm };
		check(
			`${viewport.name}: ${type} is on screen with its aperture lit`,
			m.station.count > 200 && m.aperture.count > 0,
			`station ${m.station.count}px, aperture ${m.aperture.count}px`,
		);
		check(
			`${viewport.name}: ${type}'s aperture is brighter than the hull around it`,
			m.aperture.topLuma > m.station.meanLuma,
			`aperture ${m.aperture.topLuma?.toFixed(1)} vs station ` +
				`${m.station.meanLuma?.toFixed(1)}`,
		);

		// §2's rule, on screen: switching every accessory off must leave the same
		// outline behind. The headless tier owns the exact form of this — vertex
		// reach, identical at all three levels — and this is the rendered half,
		// which is what a player actually sees change.
		const drift = shapeDifference(m.station.cells, m.bare.cells);
		check(
			`${viewport.name}: ${type} keeps its outline when the detail goes`,
			m.bare.count > 0 && drift <= MAX_OUTLINE_DRIFT,
			`1 − IoU = ${drift.toFixed(3)} against ${MAX_OUTLINE_DRIFT}`,
		);
		check(
			`${viewport.name}: ${type}'s accessories are inside its silhouette`,
			m.bare.count > 0 &&
				m.bare.box.w === m.station.box.w &&
				m.bare.box.h === m.station.box.h,
			`${m.station.box.w}×${m.station.box.h} drawn, ` +
				`${m.bare.box.w}×${m.bare.box.h} bare`,
		);
		// And the accessories are really drawn, or the two checks above are
		// comparing a capture with itself and prove nothing.
		check(
			`${viewport.name}: ${type} draws accessories at docking range`,
			m.accessories.count > 0,
			`${m.accessories.count}px of accessory`,
		);
	}

	console.log(
		`\n[${viewport.name}] warmth: ` +
			Object.entries(lit)
				.map(([t, m]) => `${t} ${m.lights.warmth.toFixed(3)}`)
				.join(", "),
	);
	const roleLight = (type) => lit[type].lights;
	check(
		`${viewport.name}: every role puts its own light on screen`,
		["trade", "shipyard", "refinery"].every((t) => roleLight(t).count > 0),
		["trade", "shipyard", "refinery"]
			.map((t) => `${t} ${roleLight(t).count}px`)
			.join(", "),
	);
	check(
		`${viewport.name}: the three roles light differently, warm to cold`,
		roleLight("refinery").warmth > roleLight("trade").warmth &&
			roleLight("trade").warmth > roleLight("shipyard").warmth,
		`refinery ${roleLight("refinery").warmth.toFixed(3)} > trade ` +
			`${roleLight("trade").warmth.toFixed(3)} > shipyard ` +
			`${roleLight("shipyard").warmth.toFixed(3)}`,
	);

	// --- 3: detail falls with range ------------------------------------------
	for (const [type, id] of Object.entries(byType)) {
		const { silhouetteKm } = lit[type];
		const levelAt = async (radii) => {
			await page.evaluate(
				([bodyId, range]) => window.__viewAlongAxis(bodyId, range),
				[id, silhouetteKm * radii],
			);
			return page.evaluate(
				(bodyId) => window.__seelite.visualOfStation(bodyId).detail,
				id,
			);
		};
		const close = await levelAt(CLOSE_RADII);
		const mid = await levelAt(REDUCED_RADII);
		const far = await levelAt(OUTLINE_RADII);
		check(
			`${viewport.name}: ${type} drops detail as it recedes`,
			close === "full" && mid === "reduced" && far === "outline",
			`${close} → ${mid} → ${far}`,
		);
	}
	await page.close();
}

// --- 4: the beacons flash, on the game clock ---------------------------------
{
	const page = await browser.newPage({
		viewport: { width: 1100, height: 720 },
	});
	watch(page);
	await installHelpers(page);
	await page.goto(URL, { waitUntil: "load" });
	await bootedGame(page);

	const trade = await page.evaluate(() => {
		const s = window.__seelite.world.system.contents.stations.find(
			(x) => x.type === "trade",
		);
		return s ? s.id : null;
	});
	const silhouetteKm = await page.evaluate(
		(id) => window.__seelite.visualOfStation(id).silhouetteKm,
		trade,
	);
	await page.evaluate(
		([id, range]) => window.__viewAlongAxis(id, range),
		[trade, silhouetteKm * CLOSE_RADII],
	);

	/**
	 * Sample the beacons across one period by *writing the clock*.
	 *
	 * §5.2's whole point: every intensity is a pure function of `gameTime`, so
	 * the flash can be sampled rather than waited for. Waiting would be timing
	 * the frame loop, which is the thing that makes a strobe test flaky.
	 */
	const samples = await page.evaluate((id) => {
		const g = window.__seelite;
		const saved = g.world.gameTime;
		const out = [];
		for (let i = 0; i < 40; i++) {
			g.world.gameTime = i * 0.05;
			g.render(0);
			const v = g.visualOfStation(id);
			out.push({
				port: v.fixtures.find((f) => f.kind === "beacon-port").intensity,
				starboard: v.fixtures.find((f) => f.kind === "beacon-starboard")
					.intensity,
			});
		}
		g.world.gameTime = saved;
		g.render(0);
		return out;
	}, trade);

	const port = samples.map((s) => s.port);
	const starboard = samples.map((s) => s.starboard);
	check(
		"the trade beacons flash on the game clock",
		Math.max(...port) > 1 && Math.min(...port) === 0,
		`port ${Math.min(...port).toFixed(2)}–${Math.max(...port).toFixed(2)}`,
	);
	check(
		"the two beacons are never lit together",
		samples.every((s) => s.port === 0 || s.starboard === 0),
		`${samples.filter((s) => s.port > 0 && s.starboard > 0).length} overlaps`,
	);
	check(
		"the same clock value gives the same beacon state",
		await page.evaluate((id) => {
			const g = window.__seelite;
			const at = (t) => {
				g.world.gameTime = t;
				g.render(0);
				return g.visualOfStation(id).fixtures.map((f) => f.intensity);
			};
			// 20.05 s lands inside a flash and 93.5 s does not, which is what
			// makes the inequality below non-vacuous: two dark samples would
			// compare equal and the check would pass having proved nothing.
			const a = at(20.05);
			const b = at(93.5);
			const c = at(20.05);
			return (
				JSON.stringify(a) === JSON.stringify(c) &&
				JSON.stringify(a) !== JSON.stringify(b)
			);
		}, trade),
		"sampled 20.05 s, 93.5 s, 20.05 s",
	);
	check(
		"the starboard beacon is not a copy of the port one",
		JSON.stringify(port) !== JSON.stringify(starboard),
	);
	await page.close();
}

await browser.close();
exit();
