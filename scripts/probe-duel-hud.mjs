import { installCockpitTextProbe } from "./lib/cockpit-text-probe.mjs";
/**
 * Node #324 part (c)'s browser tier: the duel HUD in the running game.
 *
 * `tests/duel-hud.test.ts` owns the readings and tones, and `tests/duel.test.ts`
 * owns the on-target predicate. What only the page can answer is the wiring:
 * that the duel row is drawn in its own band only while a raider is contesting,
 * dueling or selected, that it overlaps neither the course row nor the prompt,
 * that the selected raider's ring is painted amber and red while it fires, that
 * the on-target mark follows the sightline, and that the Flight console shows
 * the detail in a fight and hides it in peace. Since #931 the band also
 * carries the hull-temperature gauge, and the last rows fly a skim.
 *
 * **Colour is read off the overlay's pixels**, with the sampler shape
 * `probe-live-cockpit.mjs` uses for the refusal tone: a tone is a field on a
 * record, and a record can say anything.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { installCompositeFrame } from "./lib/composite-frame.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

// `floorScale` is the floor fit origin/main drew at before #945 put a plate
// under every duel-band cell; a plate that changed it would be a shrunk band.
const VIEWPORTS = [
	{ name: "desktop", width: 900, height: 620, floorScale: 1 },
	{ name: "narrow", width: 390, height: 780, floorScale: 0.72 },
];

const installHelpers = () => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	/** Red and amber pixels in a square around a point on the overlay. */
	const tonesAround = (at, half = 20) => {
		const overlay = document.getElementById("overlay");
		const ctx = overlay.getContext("2d", { willReadFrequently: true });
		const data = ctx.getImageData(
			Math.floor(at.x - half),
			Math.floor(at.y - half),
			half * 2,
			half * 2,
		).data;
		let red = 0;
		let amber = 0;
		for (let i = 0; i < data.length; i += 4) {
			if (data[i + 3] <= 40 || data[i] <= 170) continue;
			// The refusal sampler's own thresholds, and amber as its complement:
			// a strong green channel over a weaker blue.
			if (data[i + 1] < 150 && data[i] > data[i + 2] + 60) red++;
			else if (data[i + 1] >= 150 && data[i + 1] > data[i + 2] + 40) amber++;
		}
		return { red, amber };
	};
	/** Pixels in `data` that pass `keep(r, g, b, a)`. */
	const countPixels = (data, keep) => {
		let n = 0;
		for (let i = 0; i < data.length; i += 4)
			if (keep(data[i], data[i + 1], data[i + 2], data[i + 3])) n++;
		return n;
	};
	/** Pixels in a rectangle of the overlay that pass `keep`. */
	const countIn = (x, y, width, height, keep) => {
		const overlay = document.getElementById("overlay");
		const ctx = overlay.getContext("2d", { willReadFrequently: true });
		return countPixels(
			ctx.getImageData(
				Math.floor(x),
				Math.floor(y),
				Math.ceil(width),
				Math.ceil(height),
			).data,
			keep,
		);
	};
	/** The same, off the frame the player sees (`lib/composite-frame.mjs`),
	 *  rendered in the task that reads it. */
	const countInFrame = (x, y, width, height, keep) => {
		const overlay = document.getElementById("overlay");
		return countPixels(
			window.__compositeFrame(overlay.width, overlay.height, {
				x,
				y,
				width,
				height,
			}).data,
			keep,
		);
	};
	/** The raider's warm beam colour: strong red, middling green, weak blue.
	 *  Green under 160, not 180: the beam reads (254, 137, 88) in the frame,
	 *  and an amber mark at (207, 175, 101) crossed the cockpit's sample
	 *  square at the narrow viewport (node #806). */
	const warm = (r, gr, b, a) =>
		a > 120 && r > 200 && gr > 100 && gr < 160 && b < 130;
	/** The rim's red, at any alpha it is drawn with. */
	const rimRed = (r, gr, b, a) => a > 12 && r > 200 && gr < 120 && b < 100;
	/** The passive tone's cyan-white, and nothing else drawn near the label: the
	 *  tracer's cyan is greener with less red, and a context label is drawn at
	 *  55% alpha. A plain lit count read 112 here with the line not drawn. */
	const passive = (r, gr, b, a) =>
		a > 150 && r >= 140 && r <= 162 && gr >= 194 && gr <= 216 && b >= 228;
	const aimAt = (pos) => {
		const p = g.world.ship.pos;
		g.setAttitude(
			{ x: pos.x - p.x, y: pos.y - p.y, z: pos.z - p.z },
			g.shipUp(),
		);
	};
	window.__duel = {
		dt,
		tonesAround,
		aimAt,
		/**
		 * Warm beam pixels in a small square on the beam, read off the frame the
		 * player sees: the WebGL canvas with the overlay over it, in the task
		 * that rendered them.
		 *
		 * **In the cockpit the beam is in the frame and ends below it** (node
		 * #806): it runs to the pilot and the dash hides its lower part, so the
		 * square sits 28 px from the raider's end — past its marker ring, whose
		 * amber reads as warm, and above the dash with the raider aimed at —
		 * rather than at the midpoint. Chase keeps its beam on the
		 * overlay, ending on the hull, and is sampled at the midpoint as before.
		 *
		 * **And never under a duel-band plate** (#945): at 900 px the square 28
		 * px down sat in the band, and the plate a cell stands on darkens the
		 * beam behind it. The square walks on down the beam until it is clear.
		 */
		beamPaint(beam) {
			const dx = beam.to.x - beam.from.x;
			const dy = beam.to.y - beam.from.y;
			const len = Math.hypot(dx, dy) || 1;
			const plates = g.floorRender?.duelPlates ?? [];
			const at = (along) => ({
				x: beam.from.x + (dx / len) * along,
				y: beam.from.y + (dy / len) * along,
			});
			const clear = ({ x, y }) =>
				plates.every(
					(p) =>
						x + 6 < p.x ||
						x - 6 > p.x + p.width ||
						y + 6 < p.top ||
						y - 6 > p.top + p.height,
				);
			let along = g.view === "cockpit" ? Math.min(28, len / 2) : len / 2;
			while (!clear(at(along)) && along < len) along += 2;
			const { x, y } = at(along);
			return countInFrame(x - 6, y - 6, 12, 12, warm);
		},
		/** Rim-red pixels in the glass's top-left corner. */
		rimPaint() {
			return countIn(2, 2, 16, 16, rimRed);
		},
		/** Park the ship at rest `rOverR` star radii from the star's centre. */
		parkAtStar(rOverR) {
			const star = g.world.system.bodies.find((b) => b.kind === "star");
			g.world.ship.pos = {
				x: star.pos.x + rOverR * star.radiusKm,
				y: star.pos.y,
				z: star.pos.z,
			};
			g.world.ship.vel = { x: 0, y: 0, z: 0 };
		},
		/** Passive-tone pixels in a rectangle of the overlay. */
		passiveIn(x, y, width, height) {
			return countIn(x, y, width, height, passive);
		},
		/** Lit overlay pixels in a box: any opaque glyph ink, whatever its tone,
		 *  and never the dark plate under it (#932). `passive` above is one
		 *  tone's hue, and the floor's labels are not drawn in it. */
		litIn(box) {
			if (!box) return Number.NaN;
			const lit = (r, gr, b, a) => a > 150 && r + gr + b > 240;
			return countIn(box.x, box.top, box.width, box.height, lit);
		},
		/** Share of a box's overlay pixels that are the dark plate (#931). */
		plateShare(box) {
			if (!box) return 0;
			const dark = (r, gr, b, a) => a > 150 && r < 40 && gr < 40 && b < 50;
			const n = countIn(box.x, box.top, box.width, box.height, dark);
			return n / (Math.ceil(box.width) * Math.ceil(box.height));
		},
		/**
		 * Each duel-band plate as painted (#945): its name, its painted dark
		 * share, and the dark pixels in a one-pixel column at the middle of the
		 * gap to the next plate — zero where two plates do not touch.
		 */
		platesPainted(floor) {
			const plates = floor?.duelPlates ?? [];
			const dark = (r, gr, b, a) => a > 150 && r < 40 && gr < 40 && b < 50;
			return plates.map((plate, i) => {
				const next = plates[i + 1];
				const end = plate.x + plate.width;
				return {
					label: plate.label,
					share: this.plateShare(plate),
					gapPx: next ? next.x - end : null,
					gapDark: next
						? countIn((end + next.x) / 2, plate.top, 1, plate.height, dark)
						: null,
				};
			});
		},
		/** Lit pixels in the band the condition line under the selected label is
		 *  painted in.
		 *
		 *  **Centred on the baseline, because the overlay draws with
		 *  `textBaseline = "middle"`.** This read `at.y + 9` for a line painted at
		 *  `at.y + TARGET_CONDITION_DY`, which is 18 — a band sitting nine pixels
		 *  high of the ink, catching its bottom two rows out of eleven. It passed,
		 *  because the name line above it leaks into the same box, which is the
		 *  reason a check like this has to be centred rather than merely nonzero. */
		enemyLinePaint(at) {
			return countIn(at.x + 20, at.y + 12, 110, 12, passive);
		},
		cruise() {
			g.resetFlightToStart();
			g.setHeadLook("forward");
			let far = null;
			let farKm = 0;
			for (const body of g.world.system.bodies) {
				const d = Math.hypot(
					body.pos.x - g.world.ship.pos.x,
					body.pos.y - g.world.ship.pos.y,
					body.pos.z - g.world.ship.pos.z,
				);
				if (body.kind !== "star" && d > farKm) {
					far = body;
					farKm = d;
				}
			}
			g.targetId = far.id;
			g.faceTarget?.();
			g.engageCruise();
			for (let i = 0; i < 100 && g.regime !== "cruise"; i++) g.step(dt);
			return g.regime;
		},
		frame(each) {
			g.step(dt);
			each?.();
			g.render(dt);
		},
		steps(seconds, each) {
			for (let i = 0; i < Math.round(seconds / dt); i++) this.frame(each);
		},
		floor() {
			const r = g.floorRender;
			return r
				? {
						duelRow: r.duelRow,
						duelBox: r.duelBox,
						duelPlates: r.duelPlates,
						tempPlate: r.tempPlate,
						scoopPlate: r.scoopPlate,
						scale: r.scale,
						overflowPx: r.overflowPx,
						courseBox: r.courseBox,
						glassBottomY: r.glassBottomY,
						marginPx: r.marginPx,
					}
				: null;
		},
		console() {
			const block = document.querySelector("[data-live-duel]");
			const text = (sel) => document.querySelector(sel)?.textContent ?? null;
			const assist = document.querySelector("[data-live-assist]");
			return {
				present: block !== null,
				visible: block?.checkVisibility() ?? false,
				inlineDisplay: block?.style.display ?? null,
				// §6 hides every `.lc-readout` below 600 px, ASSIST included; the
				// duel block follows the same rule rather than one of its own.
				assistVisible: assist?.checkVisibility() ?? false,
				fore: text("[data-live-duel-fore]"),
				hull: text("[data-live-duel-hull]"),
				heat: text("[data-live-duel-heat]"),
			};
		},
	};
};

const nextFrames = (page, n = 3) =>
	page.evaluate(
		(count) =>
			new Promise((done) => {
				let left = count;
				const tick = () => (left-- ? requestAnimationFrame(tick) : done());
				requestAnimationFrame(tick);
			}),
		n,
	);

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({
		viewport: { width: viewport.width, height: viewport.height },
	});
	watch(page);
	await installCompositeFrame(page);
	await page.goto(gameUrl(origin, { seed: 42 }));
	await bootedGame(page);
	await installCockpitTextProbe(page);
	await page.evaluate(installHelpers);
	const v = viewport.name;
	const peace = await page.evaluate(() => {
		const g = window.__seelite,
			D = window.__duel;
		const regime = D.cruise();
		D.steps(0.2);
		return {
			regime,
			encounter: g.encounter,
			combat: g.cockpit.text.readings.get("combat") ?? [],
			lasers: window.__cockpitSourcePainted("lasers"),
			cue: g.cueRender,
		};
	});
	check(
		`${v}: in peace the armed group is painted on its face without combat values`,
		peace.regime === "cruise" &&
			peace.encounter === null &&
			peace.lasers &&
			peace.combat.length === 0 &&
			peace.cue === null,
		JSON.stringify(peace),
	);
	const contest = await page.evaluate(() => {
		const g = window.__seelite,
			D = window.__duel;
		g.forceRaider("behind", 0.5, 30);
		D.steps(1.2);
		return {
			phase: g.encounter?.phase,
			text: (g.cockpit.text.readings.get("combat") ?? [])
				.map((l) => l.text)
				.join(" "),
			painted: window.__cockpitSourcePainted("combat"),
			lasers: window.__cockpitSourcePainted("lasers"),
			glass: g.floorRender,
		};
	});
	check(
		`${v}: a contest paints shields and heat on a cabin face alongside the armed group`,
		contest.phase === "contest" &&
			contest.text.includes("SHD") &&
			contest.text.includes("HEAT") &&
			contest.painted &&
			contest.lasers &&
			contest.glass === null,
		JSON.stringify(contest),
	);
	const duel = await page.evaluate(() => {
		const g = window.__seelite,
			D = window.__duel;
		D.steps(3.5);
		g.targetId = g.raiderContact.id;
		let onTarget = null,
			beam = null,
			beamQuiet = null,
			rim = null,
			rimQuiet = null,
			condition = null,
			lastBeam = null;
		for (
			let i = 0;
			i < 1800 &&
			(!onTarget || !beam || !beamQuiet || !rim || !rimQuiet || !condition);
			i++
		) {
			D.frame(() => {
				const r = g.encounter?.raider;
				if (r) D.aimAt(r.flight.ship.pos);
			});
			const fire = g.hostileFireRender;
			if (fire.beam && !beam) {
				beam = { ...fire.beam, paint: D.beamPaint(fire.beam) };
				lastBeam = fire.beam;
			}
			if (!fire.beam && lastBeam && !beamQuiet)
				beamQuiet = { paint: D.beamPaint(lastBeam) };
			if (fire.rim > 0.5 && !rim)
				rim = { strength: fire.rim, view: g.view, paint: D.rimPaint() };
			if (fire.rim === 0 && !rimQuiet) rimQuiet = { paint: D.rimPaint() };
			if (g.cueRender?.onTarget) onTarget = g.cueRender;
			if (g.selectedRender?.conditionLine && g.cueRender?.at && !condition)
				condition = {
					text: g.selectedRender.conditionLine,
					paint: D.enemyLinePaint(g.cueRender.at),
				};
		}
		const phase = g.encounter?.phase;
		const reading = (g.cockpit.text.readings.get("combat") ?? [])
			.map((l) => l.text)
			.join(" ");
		const painted = window.__cockpitSourcePainted("combat");
		g.setAttitude({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
		g.render(0);
		return {
			phase,
			onTarget,
			offTarget: g.cueRender?.onTarget,
			beam,
			beamQuiet,
			rim,
			rimQuiet,
			condition,
			reading,
			painted,
		};
	});
	check(
		`${v}: the duel keeps its shields and heat painted`,
		duel.phase === "duel" && duel.painted && duel.reading.includes("SHD"),
		JSON.stringify({ phase: duel.phase, reading: duel.reading }),
	);
	check(
		`${v}: the selected opponent has a painted condition line`,
		!!duel.condition && duel.condition.paint > 0,
		JSON.stringify(duel.condition),
	);
	check(
		`${v}: aimed at the raider the on-target cue appears, then clears off aim`,
		!!duel.onTarget && duel.offTarget === false,
		JSON.stringify({ on: duel.onTarget?.onTarget, off: duel.offTarget }),
	);
	check(
		`${v}: incoming fire paints a beam and clears between shots`,
		!!duel.beam && duel.beam.paint > 0 && duel.beamQuiet?.paint === 0,
		JSON.stringify({ beam: duel.beam, quiet: duel.beamQuiet }),
	);
	check(
		`${v}: a player hit paints the cockpit rim and a quiet frame clears it`,
		duel.rim?.view === "cockpit" &&
			duel.rim.paint > 50 &&
			duel.rimQuiet?.paint === 0,
		JSON.stringify({ rim: duel.rim, quiet: duel.rimQuiet }),
	);
	await page.evaluate(() => window.__seelite.setHeadLook("right"));
	await nextFrames(page);
	const flightConsole = await page.evaluate(() => ({
		fore: document.querySelector("[data-live-duel-fore]")?.textContent,
		heat: document.querySelector("[data-live-duel-heat]")?.textContent,
	}));
	check(
		`${v}: the Flight console still carries combat detail`,
		!!flightConsole.fore && !!flightConsole.heat,
		JSON.stringify(flightConsole),
	);
	await page.evaluate(() => {
		const g = window.__seelite;
		g.setHeadLook("forward");
		g.encounter = null;
		g.resetFlightToStart();
	});
	await page.evaluate(() => {
		const g = window.__seelite;
		g.resetFlightToStart();
		window.__duel.cruise();
		g.forceRaider("ahead", 0.5, 6);
	});
	await page.keyboard.down("Space");
	const rout = await page.evaluate(() => {
		const g = window.__seelite;
		const D = window.__duel;
		const PINNED_HULL = 15;
		let shaped = false;
		let lastGap = null;
		let lastHitGap = null;
		let releaseGap = null;
		let minHullSeen = Infinity;
		const gap = () => {
			const p = g.world.ship.pos;
			const q = g.encounter.raider.flight.ship.pos;
			return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
		};
		D.steps(30, () => {
			const r = g.encounter?.raider;
			if (!r) {
				if (shaped && releaseGap === null) releaseGap = lastGap;
				return;
			}
			if (!shaped) {
				shaped = true;
				r.condition = { ...r.condition, fore: 0, aft: 0, hull: PINNED_HULL };
			}
			const id = g.raiderContact?.id;
			if (id) g.targetId = id;
			D.aimAt(r.flight.ship.pos);
			const after = gap();
			const struck = r.condition.hull;
			if (struck < minHullSeen) minHullSeen = struck;
			if (struck < PINNED_HULL) lastHitGap = lastGap ?? after;
			r.condition = { ...r.condition, hull: PINNED_HULL };
			lastGap = after;
		});
		return {
			lastHitGap,
			releaseGap,
			minHullSeen,
			released: g.encounter === null,
		};
	});
	await page.keyboard.up("Space");
	check(
		`${v}: a crippled raider is let go at the range the beam stops reaching`,
		rout.released &&
			rout.lastHitGap > 1 &&
			rout.releaseGap !== null &&
			rout.releaseGap > rout.lastHitGap &&
			rout.releaseGap - rout.lastHitGap < 0.5,
		JSON.stringify(rout),
	);
	const thermal = await page.evaluate(() => {
		const g = window.__seelite,
			D = window.__duel;
		const home = { ...g.world.ship.pos };
		D.parkAtStar(1.2);
		D.steps(3);
		const hot = {
			temp: g.condition.hullTemp,
			text: (g.cockpit.text.readings.get("combat") ?? [])
				.map((l) => l.text)
				.join(" "),
			painted: window.__cockpitSourcePainted("combat"),
		};
		g.world.ship.pos = home;
		g.world.ship.vel = { x: 0, y: 0, z: 0 };
		g.condition = { ...g.condition, hullTemp: 0.0051 };
		D.steps(1);
		return {
			hot,
			ambient: g.condition.hullTemp,
			cold: (g.cockpit.text.readings.get("combat") ?? [])
				.map((l) => l.text)
				.join(" "),
		};
	});
	check(
		`${v}: a star skim paints TEMP on a cabin face and ambient clears it`,
		thermal.hot.temp > 0 &&
			thermal.hot.text.includes("TEMP") &&
			thermal.hot.painted &&
			thermal.ambient === 0 &&
			!thermal.cold.includes("TEMP"),
		JSON.stringify(thermal),
	);
	const scoop = await page.evaluate(async () => {
		const g = window.__seelite,
			D = window.__duel;
		const { makeModule, freeSlot } = await import("/src/loadout.ts");
		const module = makeModule("fuel-scoop", 1);
		const slot = freeSlot(g.commander.loadout, g.commander.hull, module);
		g.commander = {
			...g.commander,
			loadout: { ...g.commander.loadout, [slot.key]: module },
		};
		g.fuelLy = 2;
		g.targetId = null;
		g.engageCruise();
		for (let i = 0; i < 100 && g.regime !== "cruise"; i++) g.step(D.dt);
		D.parkAtStar(1.2);
		g.setAttitude({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 });
		const before = g.fuelLy;
		D.steps(0.5);
		return {
			before,
			fuel: g.fuelLy,
			scooping: g.scooping,
			text: (g.cockpit.text.readings.get("combat") ?? [])
				.map((l) => l.text)
				.join(" "),
			painted: window.__cockpitSourcePainted("combat"),
		};
	});
	check(
		`${v}: a filling fuel scoop paints its live reading with the temperature`,
		scoop.fuel > scoop.before &&
			scoop.scooping &&
			scoop.text.includes("SCOOPING") &&
			scoop.text.includes("TEMP") &&
			scoop.painted,
		JSON.stringify(scoop),
	);
	await page.screenshot({ path: `/tmp/seelite-1151-duel-${v}.png` });
	const burnt = await page.evaluate(() => {
		const g = window.__seelite;
		window.__duel.parkAtStar(1.06);
		g.condition = { ...g.condition, hull: 2, hullTemp: 2 };
		const fore = g.condition.fore;
		let seconds = 0;
		while (!g.dead && seconds < 5) {
			g.step(g.units.MAX_DT);
			seconds += g.units.MAX_DT;
		}
		return {
			dead: g.dead,
			seconds,
			hull: g.condition.hull,
			foreBefore: fore,
			foreAfter: g.condition.fore,
			lastExit: g.lastExit,
		};
	});
	check(
		`${v}: a hull above the top runs out of integrity and the ship is destroyed, shields untouched`,
		burnt.dead === true &&
			burnt.hull === 0 &&
			burnt.foreAfter === burnt.foreBefore &&
			burnt.lastExit === "ship destroyed",
		JSON.stringify(burnt),
	);
	await page.close();
}
await browser.close();
exit();
