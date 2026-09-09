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
 *    habitation light and a pair of alternating hull strobes, the shipyard cold
 *    bays and a white arc, and the refinery a warm flare.
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
 * 3. **Detail falls with range.** The band is read as a level string at three
 *    ranges chosen from the station's own silhouette budget. No pixels are
 *    involved, and deliberately so.
 *
 *    §2's rule — a detail level may not change the outline — is **not** checked
 *    here, and that is a finding rather than an omission. Three rendered forms
 *    of it were tried: a near-versus-far mask comparison (the far mask is a
 *    handful of pixels and scored `1 − IoU` of 1.000 against a provably correct
 *    build), a same-range `1 − IoU` between the station drawn and stripped, and
 *    a bounding-box growth budget in pixels and then in per cent. All three
 *    measure the **bloom pass** rather than the geometry: an emissive accessory
 *    near a thin structure haloes outside it, and with the clock pinned so the
 *    strobes are actually lit that halo reaches 24 px on the shipyard's 98 px
 *    box — 32%, against the 170% a strobe deliberately moved to 2.5·r produces.
 *    Those two are not an order apart, so no threshold between them is honest.
 *
 *    The claim is owned headless, where it holds exactly: `station-visuals.test.ts`
 *    asserts the mesh's vertex reach is *identical* at all three detail levels.
 *    A rendered check that cannot discriminate is worse than none, because it
 *    reports a colour for a question it did not answer.
 *
 * 4. **The strobes flash, and they flash on the game clock.** §5.2 makes every
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
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
/** All three station types in one system — the only way to compare three lit
 *  signatures under one lighting setup — each framable and fully lit at docking
 *  range. See `probe-station.mjs`'s note on this constant for the re-pick
 *  criterion and for a known flake in that probe: the two share the fixture and
 *  must share the seed. */
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=54`;

const VIEWPORTS = [
	{ name: "desktop", width: 1100, height: 720 },
	{ name: "narrow", width: 390, height: 844 },
];

/** Docking range, in the station's own silhouette radii — inside the `full`
 *  band by a wide margin, and read as radii so the refinery's 0.4 km drum and
 *  the shipyard's 1.5 km frame are looked at from the same apparent size.
 *
 *  **The ranges stay in radii, and #263 settled why.** Radii is what lets one
 *  range look at a 0.68 km refinery and a 1.66 km shipyard at the same apparent
 *  size, which is the comparison this probe exists to make; absolute kilometres
 *  would buy a tuned constant per role and lose it. The unit was suspected of
 *  coupling the instrument to a design decision — a form's declared reach
 *  changing how well the probe works — and that coupling was the *drift's*: a
 *  form framed from 3.6 km absorbed an error one framed from 2.0 km did not, so
 *  radii only decided which form the drift broke first. With the placement
 *  co-moving there is nothing left for a declared reach to change. */
const CLOSE_RADII = 3;
/** Two ranges either side of the far band edge, likewise in radii. The band
 *  edges themselves come off the page; these only have to be clear of them. */
const REDUCED_RADII = 48;
const OUTLINE_RADII = 900;

/**
 * How far a placement may land from the framing it asked for: a fraction of the
 * range, and an angle off the aperture axis.
 *
 * Why a placement is a reading rather than a constant, and why it takes two
 * numbers, is `__viewAlongAxis`'s in `probe-guard.mjs`, beside the code that
 * measures them. What belongs here is where the two tolerances came from, and
 * that this is the check on the **framing itself** rather than on the aperture
 * pixels that were its downstream symptom — #263's refinery went to 0 lit
 * aperture pixels on one viewport, which reads as a form-specific defect and
 * was a framing that landed somewhere else.
 *
 * Bounded from above by the falsifying build. Parked, one run on this machine:
 * range trade −11.41% / −9.75%, refinery +3.83% / +2.15%, shipyard −2.15% /
 * −2.15%, and off-axis 14.24° / 11.96°, 14.89° / 10.89°, 6.18° / 6.18°
 * (desktop / narrow). So the tightest red arm is 2.15% on the range and 6.18°
 * on the angle, and a tolerance at or above either would not be a check on that
 * arm. Bounded from below by what co-moving lands: ≤0.02% and ≤0.01°,
 * printed in the detail of every one of these six checks. The magnitude of the
 * red side is **frame-cost dependent** — it is how far the station travelled
 * while the loop ran, not a constant of the geometry — so it is a figure to
 * re-measure rather than to quote.
 */
const FRAMING_TOLERANCE = 0.01;
const FRAMING_TOLERANCE_DEG = 0.5;

/** The silhouette mask is resampled to this grid before shapes are compared —
 *  `probe-station.mjs`'s grid, for the same reason: the comparison must be of
 *  shape and not of apparent size. */
const GRID = 24;

/*
 * `src/surface.ts` in place of `src/station-visuals.ts`, and the swap loses
 * nothing (#101).
 *
 * probe-guard fingerprints a module by its **top-level numeric constants**, and
 * the only one station-visuals ever had was `PLATE_TEXTURE_SIZE` — the profile
 * figures are nested inside `STATION_VISUALS` and the two light colours are hex,
 * neither of which the guard's pattern reads. That constant moved to the shared
 * generator when #101 split it out, so pointing the guard there follows the
 * fingerprint rather than dropping it, and picks up `SEAM_HALF_WIDTH_PX` on the
 * way.
 *
 * station-visuals therefore joins `cockpit.ts`, `live-cockpit.ts` and the two
 * planet shader modules in the set probe-guard cannot fingerprint at all (#104).
 * Written here rather than left to be rediscovered: leaving it in the list does
 * not guard it, it makes every run of this probe throw before it starts.
 */
await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/station-mesh.ts",
	"src/surface.ts",
]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

// The program scan below runs once, not once per viewport: a program is built
// from a material, not from a window size.
let scannedPrograms = false;

/**
 * Everything this probe needs about one station, from **one** evaluate.
 *
 * Five renders of the same scene — the station as drawn, with its aperture bars
 * hidden, with every role fixture unlit, with every accessory switched off, and
 * hidden altogether — differenced against each other, all at one pinned clock
 * value chosen so the strobes are lit.
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

			/**
			 * **Pin the clock with the strobes lit**, for the five renders below.
			 *
			 * Left free, `gameTime` is wherever the frame loop has got to, and at a
			 * 12% duty the strobes are dark in about seven captures out of eight.
			 * The lit-signature measurement would then be sampling a station whose
			 * strobes happen to be off, and would report a different warmth run to
			 * run. 0.05 s lands inside the first flash of a 2 s period.
			 */
			const savedClock = g.world.gameTime;
			g.world.gameTime = 0.05;

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
				"strobe-a",
				"strobe-b",
				"bay-flood",
				"weld-arc",
				"heat-glow",
				"flare",
				"vent-manifold",
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
			g.world.gameTime = savedClock;
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

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({
		viewport: { width: viewport.width, height: viewport.height },
	});
	watch(page);
	await installViewPlacement(page);
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
		const framing = await page.evaluate(
			([bodyId, range]) => window.__viewAlongAxis(bodyId, range),
			[id, silhouetteKm * CLOSE_RADII],
		);
		const drift = (framing.actualKm - framing.askedKm) / framing.askedKm;
		check(
			`${viewport.name}: ${type} is framed where it asked`,
			Math.abs(drift) <= FRAMING_TOLERANCE &&
				framing.offAxisDeg <= FRAMING_TOLERANCE_DEG,
			`asked ${framing.askedKm.toFixed(3)} km, landed ` +
				`${framing.actualKm.toFixed(3)} km (${(drift * 100).toFixed(2)}%), ` +
				`${framing.offAxisDeg.toFixed(2)}° off the axis`,
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

		// The accessories are drawn at all — which is what the lit-signature
		// measurement below rests on, since it differences them away.
		check(
			`${viewport.name}: ${type} draws accessories at docking range`,
			m.accessories.count > 0,
			`${m.accessories.count}px of accessory`,
		);
	}

	/**
	 * Every program the renderer built for the frames above actually linked.
	 *
	 * Asked once rather than per viewport: a program is built from a material,
	 * not from a window size, so the second pass would re-ask a question whose
	 * answer cannot have changed and print a second identical line.
	 *
	 * The rock's surface is a patched `MeshStandardMaterial`: four GLSL strings
	 * spliced into three.js's chunks by `onBeforeCompile`. The tests that guard
	 * it match *source text* — they can prove the crater field has one
	 * definition and that a rename has not left an interpolation dangling, and
	 * they cannot prove the result compiles, because `bun test` has no GL
	 * context. Not "nothing headless": `probe-planets` launches with
	 * `--use-gl=angle --enable-unsafe-swiftshader` and gets one. A compile
	 * check belongs where a context is, which is here. A patch that stopped linking would leave three.js logging to the
	 * console and rendering something, and the checks above would go on passing:
	 * they ask whether the refinery is on screen and lit, and it would be.
	 *
	 * `LINK_STATUS` is the direct question, asked of the programs the renderer
	 * actually built for this system.
	 *
	 * **Named, not counted.** "None of them failed" is equally true of a build
	 * where the rock compiled no program at all — a material that stopped being
	 * applied, an early return, a refinery that stopped drawing an asteroid —
	 * so a count alone can pass while the thing it exists to watch is absent.
	 * `applyRockSurface` sets `customProgramCacheKey` to "station-rock", which
	 * makes the rock's program findable by name rather than assumed to be in
	 * the pile.
	 */
	if (!scannedPrograms) {
		scannedPrograms = true;
		const programs = await page.evaluate(() => {
			const renderer = window.__seelite.renderer;
			const gl = renderer.getContext();
			const built = Array.from(renderer.info.programs ?? []);
			const linked = (p) =>
				Boolean(p.program) && gl.getProgramParameter(p.program, gl.LINK_STATUS);
			const rock = built.filter((p) =>
				String(p.cacheKey ?? "").includes("station-rock"),
			);
			return {
				total: built.length,
				unlinked: built.filter((p) => !linked(p)).length,
				rock: rock.length,
				rockLinked: rock.filter(linked).length,
			};
		});
		check(
			"every shader program the renderer has built linked",
			programs.total > 0 && programs.unlinked === 0,
			`${programs.total - programs.unlinked}/${programs.total} linked`,
		);
		check(
			"the rock's own program is among them, and linked",
			programs.rock > 0 && programs.rockLinked === programs.rock,
			`${programs.rockLinked}/${programs.rock} "station-rock" programs`,
		);

		/**
		 * And the patch is actually in that program.
		 *
		 * A linked program under the name `station-rock` proves the material
		 * was applied, not that anything was spliced into it: the cache key is
		 * set beside `onBeforeCompile`, not by it. Let one
		 * `#include <normal_fragment_maps>` marker go stale against a three.js
		 * chunk rename and the splice returns the string unchanged, a stock
		 * `MeshStandardMaterial` links cleanly under the rock's own name, and
		 * every check above stays green over a rock with no craters on it.
		 *
		 * `applyRockSurface` records whether each `replace` changed anything;
		 * this is where that gets read.
		 */
		const splices = await page.evaluate((refineryId) => {
			// Both layers: a body's layer is its distance, and the scan runs
			// after the loop above has left the camera wherever the last type
			// put it.
			const g = window.__seelite;
			const out = [];
			for (const scene of [g.nearScene, g.farScene])
				scene?.traverse((object) => {
					for (const material of [object.material].flat())
						if (material?.userData?.rockSplices)
							out.push(Object.entries(material.userData.rockSplices));
				});
			// Whether the refinery — the one station that has an asteroid — is
			// carrying a patched material at all. Counting splices alone cannot
			// answer this: a refinery that stopped calling `applyRockSurface`
			// contributes nothing to `out`, and a check over `out` then passes
			// on somebody else's rock. That is the failure this check names.
			let onRefinery = 0;
			const refinery = window.__meshOfBody(refineryId);
			refinery?.traverse((object) => {
				for (const material of [object.material].flat())
					if (material?.userData?.rockSplices) onRefinery++;
			});
			return { all: out, onRefinery };
		}, byType.refinery);
		const landed = splices.all.flat();
		check(
			"the refinery carries a patched rock material",
			splices.onRefinery > 0,
			`${splices.onRefinery} patched material(s) under the refinery`,
		);
		check(
			"every rock-surface splice found its marker",
			landed.length > 0 && landed.every(([, ok]) => ok),
			landed.length
				? `${landed.filter(([, ok]) => ok).length}/${landed.length} markers`
				: "no patched rock material in the scene",
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

// --- 4: the strobes flash, on the game clock ---------------------------------
{
	const page = await browser.newPage({
		viewport: { width: 1100, height: 720 },
	});
	watch(page);
	await installViewPlacement(page);
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
	 * Sample the strobes across one period by *writing the clock*.
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
				a: v.fixtures.find((f) => f.kind === "strobe-a").intensity,
				b: v.fixtures.find((f) => f.kind === "strobe-b").intensity,
			});
		}
		g.world.gameTime = saved;
		g.render(0);
		return out;
	}, trade);

	const a = samples.map((s) => s.a);
	const b = samples.map((s) => s.b);
	check(
		"the trade strobes flash on the game clock",
		Math.max(...a) > 0 && Math.min(...a) === 0,
		`strobe-a ${Math.min(...a).toFixed(2)}–${Math.max(...a).toFixed(2)}`,
	);
	// **Drive alternation, not pixel separation.** The earlier check asserted that
	// the two are never lit together, which at a 12% duty and a half-period
	// offset cannot fail: the lit windows are 0.24 s apart in a 2 s period, so
	// no sampling of a correct build *or* of one broken up to a 50% duty would
	// ever overlap. This snapshot is the fixture-drive oracle, so its honest
	// claim is only that each strobe is lit at some moment the other is dark;
	// occlusion and screen-space separation remain visual-sheet concerns.
	check(
		"the two strobe fixture drives alternate on the game clock",
		samples.some((s) => s.a > 0 && s.b === 0) &&
			samples.some((s) => s.b > 0 && s.a === 0),
		`${samples.filter((s) => s.a > 0 && s.b === 0).length} a-only, ` +
			`${samples.filter((s) => s.b > 0 && s.a === 0).length} b-only`,
	);
	check(
		"the same clock value gives the same strobe state",
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
			const first = at(20.05);
			const other = at(93.5);
			const again = at(20.05);
			return (
				JSON.stringify(first) === JSON.stringify(again) &&
				JSON.stringify(first) !== JSON.stringify(other)
			);
		}, trade),
		"sampled 20.05 s, 93.5 s, 20.05 s",
	);
	await page.close();
}

await browser.close();
exit();
