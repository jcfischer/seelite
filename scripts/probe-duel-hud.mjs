/**
 * Node #324 part (c)'s browser tier: the duel HUD in the running game.
 *
 * `tests/duel-hud.test.ts` owns the readings and tones, and `tests/duel.test.ts`
 * owns the on-target predicate. What only the page can answer is the wiring:
 * that the duel row is drawn in its own band only while a raider is contesting,
 * dueling or selected, that it overlaps neither the course row nor the prompt,
 * that the selected raider's ring is painted amber and red while it fires, that
 * the on-target mark follows the sightline, and that the Flight console shows
 * the detail in a fight and hides it in peace.
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
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const VIEWPORTS = [
	{ name: "desktop", width: 900, height: 620 },
	{ name: "narrow", width: 390, height: 780 },
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
	/** Pixels in a rectangle that pass `keep(r, g, b, a)`. */
	const countIn = (x, y, width, height, keep) => {
		const overlay = document.getElementById("overlay");
		const ctx = overlay.getContext("2d", { willReadFrequently: true });
		const data = ctx.getImageData(
			Math.floor(x),
			Math.floor(y),
			Math.ceil(width),
			Math.ceil(height),
		).data;
		let n = 0;
		for (let i = 0; i < data.length; i += 4)
			if (keep(data[i], data[i + 1], data[i + 2], data[i + 3])) n++;
		return n;
	};
	/** The raider's warm beam colour: strong red, middling green, weak blue. */
	const warm = (r, gr, b, a) =>
		a > 120 && r > 200 && gr > 100 && gr < 180 && b < 130;
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
		/** Warm beam pixels in a small square at the beam's midpoint. */
		beamPaint(beam) {
			const x = (beam.from.x + beam.to.x) / 2;
			const y = (beam.from.y + beam.to.y) / 2;
			return countIn(x - 6, y - 6, 12, 12, warm);
		},
		/** Rim-red pixels in the glass's top-left corner. */
		rimPaint() {
			return countIn(2, 2, 16, 16, rimRed);
		},
		/** Lit pixels in the band under the selected label, where the enemy's
		 *  condition line is drawn. */
		enemyLinePaint(at) {
			return countIn(at.x + 20, at.y + 9, 110, 11, passive);
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
	await page.goto(gameUrl(origin, { seed: 42 }));
	await bootedGame(page);
	await page.evaluate(installHelpers);
	const v = viewport.name;

	// -------------------------------------------------------------------------
	// Peace: no row, no cue, no console detail.
	// -------------------------------------------------------------------------
	const peace = await page.evaluate(() => {
		const g = window.__seelite;
		const D = window.__duel;
		const regime = D.cruise();
		// A course, so the course band is drawn and the stacking below has two
		// rows to compare.
		const here = g.world.system.record;
		const elsewhere = g.world.galaxy.systems.find(
			(s) => s.galaxy === here.galaxy && s.index !== here.index,
		);
		g.commitCourseTo(elsewhere.index);
		D.steps(0.2);
		return {
			regime,
			encounter: g.encounter,
			floor: D.floor(),
			cue: g.cueRender,
		};
	});
	check(
		`${v}: in peace the duel row is not drawn and no cue is recorded`,
		peace.regime === "cruise" &&
			peace.encounter === null &&
			peace.floor !== null &&
			peace.floor.duelRow === null &&
			peace.floor.duelBox === null &&
			peace.cue === null,
		JSON.stringify(peace),
	);

	// -------------------------------------------------------------------------
	// Contest: the row appears in its own band, above the course row and below
	// nothing it collides with.
	// -------------------------------------------------------------------------
	const contest = await page.evaluate(() => {
		const g = window.__seelite;
		const D = window.__duel;
		g.forceRaider("behind", 0.5, 30);
		D.steps(1.2);
		return {
			phase: g.encounter?.phase ?? null,
			regime: g.regime,
			floor: D.floor(),
			stripTop: g.floorRender.glassBottomY - g.floorRender.duelBox?.height,
		};
	});
	const row = contest.floor?.duelRow ?? null;
	const box = contest.floor?.duelBox ?? null;
	const course = contest.floor?.courseBox ?? null;
	check(
		`${v}: a contesting raider draws the SHD and HEAT row`,
		contest.phase === "contest" &&
			row !== null &&
			row.map((c) => c.label).join(",") === "SHD,HEAT" &&
			box !== null,
		JSON.stringify(contest.floor),
	);
	check(
		`${v}: the duel row sits inside the glass, within the margins`,
		box !== null &&
			box.top > 0 &&
			box.x >= contest.floor.marginPx &&
			box.x + box.width <= viewport.width - contest.floor.marginPx,
		JSON.stringify(box),
	);
	check(
		`${v}: the duel row is above the course row, and the course row above the strip`,
		box !== null &&
			course !== null &&
			box.top + box.height <= course.top &&
			course.top + course.height <= contest.stripTop + 1e-6,
		`duel ${box?.top}+${box?.height}, course ${course?.top}+${course?.height}, strip from ${contest.stripTop}`,
	);

	// -------------------------------------------------------------------------
	// Duel: the selected raider's ring, its tones, and the on-target mark.
	// -------------------------------------------------------------------------
	const duel = await page.evaluate(() => {
		const g = window.__seelite;
		const D = window.__duel;
		D.steps(3.5);
		const phase = g.encounter?.phase ?? null;
		g.targetId = g.raiderContact.id;
		const aimed = () => {
			const r = g.encounter?.raider;
			if (r) D.aimAt(r.flight.ship.pos);
		};
		let quiet = null;
		let firing = null;
		let onTarget = null;
		// **The prompt is read in the duel, not the contest.** `cruisePrompt` is
		// empty in cruise, so the contest has no prompt to stack; the drop to
		// normal flight with a course set brings the jump line back.
		let stacked = null;
		// The raider's fire and condition, each read off the paint with a
		// control from a frame where the record says nothing is drawn.
		let beam = null;
		let beamQuiet = null;
		let rim = null;
		let rimQuiet = null;
		let line = null;
		let lastBeam = null;
		for (
			let i = 0;
			i < 1800 &&
			(quiet === null ||
				firing === null ||
				stacked === null ||
				beam === null ||
				beamQuiet === null ||
				rim === null ||
				rimQuiet === null ||
				line === null);
			i++
		) {
			D.frame(aimed);
			const fire = g.hostileFireRender;
			if (fire.beam && beam === null) {
				beam = { ...fire.beam, paint: D.beamPaint(fire.beam) };
				lastBeam = fire.beam;
			}
			if (!fire.beam && lastBeam && beamQuiet === null)
				beamQuiet = { paint: D.beamPaint(lastBeam) };
			if (fire.rim > 0.5 && rim === null)
				rim = { strength: fire.rim, view: g.view, paint: D.rimPaint() };
			if (fire.rim === 0 && rimQuiet === null)
				rimQuiet = { view: g.view, paint: D.rimPaint() };
			const duelBox = g.floorRender?.duelBox;
			if (stacked === null && g.cockpitPrompt.text && duelBox)
				stacked = {
					prompt: { ...g.cockpitPrompt.bounds },
					text: g.cockpitPrompt.text,
					duelTop: duelBox.top,
				};
			const cue = g.cueRender;
			if (!cue?.at || !g.encounter) continue;
			if (cue.enemyLine && line === null && g.encounter.raider)
				line = {
					text: cue.enemyLine,
					hull: Math.round(g.encounter.raider.condition.hull),
					paint: D.enemyLinePaint(cue.at),
				};
			if (cue.onTarget && onTarget === null) onTarget = { ...cue };
			const tones = D.tonesAround(cue.at);
			if (g.raiderFiring && firing === null)
				firing = { tone: cue.tone, ...tones };
			if (!g.raiderFiring && quiet === null)
				quiet = { tone: cue.tone, ...tones };
		}
		// Aim a quarter turn off the raider: the mark must go.
		let offAim = null;
		const r = g.encounter?.raider;
		if (r) {
			D.frame(() => {
				const n = g.nose();
				const u = g.shipUp();
				const across = {
					x: u.y * n.z - u.z * n.y,
					y: u.z * n.x - u.x * n.z,
					z: u.x * n.y - u.y * n.x,
				};
				g.setAttitude(across, u);
			});
			offAim = g.cueRender ? { ...g.cueRender } : null;
		}
		return {
			phase,
			quiet,
			firing,
			beam,
			beamQuiet,
			rim,
			rimQuiet,
			line,
			onTarget,
			offAim,
			stacked,
			floor: D.floor(),
		};
	});
	check(
		`${v}: the jump prompt clears the duel row`,
		// The prompt must be drawn, or this asserts nothing.
		duel.stacked !== null &&
			duel.stacked.prompt.top + duel.stacked.prompt.height <=
				duel.stacked.duelTop,
		JSON.stringify(duel.stacked),
	);
	check(
		`${v}: the duel starts and the row stays drawn through it`,
		duel.phase === "duel" && duel.floor?.duelRow !== null,
		JSON.stringify({ phase: duel.phase, row: duel.floor?.duelRow }),
	);
	check(
		`${v}: a raider not firing is ringed amber, with no red painted`,
		duel.quiet !== null &&
			duel.quiet.tone === "action" &&
			duel.quiet.amber > 20 &&
			duel.quiet.red === 0,
		JSON.stringify(duel.quiet),
	);
	check(
		`${v}: a raider firing is ringed red`,
		duel.firing !== null &&
			duel.firing.tone === "refused" &&
			duel.firing.red > 20,
		JSON.stringify(duel.firing),
	);
	check(
		`${v}: the selected raider's shields and hull are drawn under its label`,
		// The line reads the raider's own hull; `tests/duel-hud.test.ts` owns the
		// format, so only the hull figure is matched here.
		duel.line !== null &&
			duel.line.text.startsWith("SHD F ") &&
			duel.line.text.endsWith(`HULL ${duel.line.hull}`) &&
			duel.line.paint > 30,
		JSON.stringify(duel.line),
	);
	check(
		`${v}: while the raider fires its beam is painted, and not after`,
		duel.beam !== null &&
			duel.beam.paint > 10 &&
			duel.beamQuiet !== null &&
			duel.beamQuiet.paint === 0,
		JSON.stringify({ beam: duel.beam, quiet: duel.beamQuiet }),
	);
	check(
		`${v}: a hit on the player glows on the canopy rim, and the rim is clear otherwise`,
		duel.rim !== null &&
			duel.rim.view === "cockpit" &&
			duel.rim.paint > 50 &&
			duel.rimQuiet !== null &&
			duel.rimQuiet.paint === 0,
		JSON.stringify({ rim: duel.rim, quiet: duel.rimQuiet }),
	);
	check(
		`${v}: aimed along the sightline, the cue marks the raider on target`,
		duel.onTarget !== null && duel.onTarget.onTarget === true,
		JSON.stringify(duel.onTarget),
	);
	check(
		`${v}: aimed a quarter turn away, the on-target mark is gone`,
		// A cue must be recorded, which it is only while the raider is selected:
		// a null here is the encounter gone, and would assert nothing.
		duel.offAim !== null && duel.offAim.onTarget === false,
		JSON.stringify(duel.offAim),
	);

	// -------------------------------------------------------------------------
	// The Flight console carries the detail in a fight.
	// -------------------------------------------------------------------------
	await page.evaluate(() => {
		const g = window.__seelite;
		g.rightTab = "Flight";
		g.setHeadLook("right");
		window.__duel.steps(0.1);
	});
	await nextFrames(page);
	const inFight = await page.evaluate(() => {
		const g = window.__seelite;
		return {
			phase: g.encounter?.phase ?? null,
			condition: {
				fore: Math.round(g.condition.fore),
				hull: Math.round(g.condition.hull),
				hullMax: g.condition.hullMax,
			},
			...window.__duel.console(),
		};
	});
	// Read against the condition by value, not by restating the formatter: the
	// console's first figure is the pool, and the hull reading ends on its max.
	// The fight runs between the two reads by at most a frame's recharge, so
	// the pool is compared within a point.
	check(
		`${v}: in a fight the Flight console shows FORE, HULL and HEAT from the ship's condition`,
		inFight.present &&
			inFight.inlineDisplay === "" &&
			// Shown wherever the console shows ASSIST: at desktop that is visible,
			// and the row below asserts it is.
			inFight.visible === inFight.assistVisible &&
			Math.abs(
				Number(inFight.fore?.split(" / ")[0]) - inFight.condition.fore,
			) <= 1 &&
			inFight.hull?.endsWith(`/ ${inFight.condition.hullMax}`) &&
			typeof inFight.heat === "string" &&
			inFight.heat.length > 0,
		JSON.stringify(inFight),
	);
	if (viewport.width > 600)
		check(
			`${v}: the duel detail is visible on the Flight console`,
			inFight.visible,
			JSON.stringify(inFight),
		);

	// -------------------------------------------------------------------------
	// #367. Whether a crippled raider is let go at the range the beam stops
	// reaching rather than at twice it. Measured rather than asserted against a
	// constant — the probe has no page surface for either figure and should not
	// need one, because the claim is that the two ranges are the one range.
	//
	// **The fight must end by letting go, not by a kill.** A kill writes the
	// raider's destruction to world state, and `resetFlightToStart` rewinds the game
	// clock while world-state keeps its own high-water mark, so a kill after a
	// long scripted run dies on `world-state: destroy … is before the clock`.
	// The raider's hull is held above zero for that reason as well as to keep the
	// rout running.
	//
	// **The trigger is pulled after the cruise reset, not before it.** That reset
	// clears the pressed-key set, and a key held across it is neither released nor
	// re-pressed: the gun sits silent while every other reading looks normal.
	// -------------------------------------------------------------------------
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
		/** A fifth of its hull, held there every frame: below #53's nerve the
		 *  raider turns and runs, and below §2's share its bank stops buying
		 *  shields, which is the crippled state the playtest reached. A kill is
		 *  impossible from here, so the only way this fight can end is letting go.
		 */
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
			// Read before the pin, so the minimum is what the fight was actually
			// carrying and not what the probe handed it.
			if (struck < minHullSeen) minHullSeen = struck;
			// `steps` runs this after `g.step`, so a hull below the pin is this
			// frame's damage, and `lastGap` is the gap that shot was aimed at.
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
			// **One comparison carries the row: the beam stopped landing and the
			// fight stopped, at the same range.** `lastHitGap > 1` is the bound that
			// does the work — it is false when the raider was let go before the beam
			// ever connected, which is what an exit forced to one kilometre produced
			// when measured, and a bare `releaseGap > lastHitGap` would have read
			// that `null` as zero and called it a pass. `releaseGap` is the range it
			// was let go at, so the difference below is the whole claim.
			//
			// `minHullSeen` is printed, not asserted: the hull is re-pinned every
			// frame, so it cannot reach zero and a guard on it would be a guard on
			// the probe's own arithmetic. That this is a release and not a kill is
			// held by construction — a kill needs a strike through `applyDamage`, and
			// there is none — and `tests/encounter.test.ts` reads `end` directly.
			rout.lastHitGap > 1 &&
			rout.releaseGap !== null &&
			rout.releaseGap > rout.lastHitGap &&
			// One frame of the raider's top speed is 0.2 km, so half a kilometre is
			// the loosest reading that still says "the beam stopped and the fight
			// stopped together". On the build before #367 the same script measured
			// the last hit at 11.83 km and the end at 24.83 km, and this row was red.
			rout.releaseGap - rout.lastHitGap < 0.5,
		JSON.stringify(rout),
	);
	// **D1 has no browser row.** Its state — a live hull that prints 0 — is one

	// -------------------------------------------------------------------------
	// Peace again: the reset ends the encounter, and every surface goes.
	// -------------------------------------------------------------------------
	const after = await page.evaluate(() => {
		const g = window.__seelite;
		const D = window.__duel;
		g.resetFlightToStart();
		g.rightTab = "Flight";
		g.setHeadLook("right");
		D.steps(0.1);
		return { encounter: g.encounter, raiderFiring: g.raiderFiring };
	});
	await nextFrames(page);
	const afterConsole = await page.evaluate(() => window.__duel.console());
	const afterFloor = await page.evaluate(() => {
		const g = window.__seelite;
		g.setHeadLook("forward");
		window.__duel.steps(0.1);
		return { floor: window.__duel.floor(), cue: g.cueRender };
	});
	check(
		`${v}: after the encounter ends the row, the cue and the console detail are gone`,
		after.encounter === null &&
			after.raiderFiring === false &&
			afterConsole.present &&
			// The block's own switch, not only what shows: below 600 px every
			// readout is hidden, so `visible` alone would pass there on nothing.
			afterConsole.inlineDisplay === "none" &&
			!afterConsole.visible &&
			afterFloor.floor?.duelRow === null &&
			afterFloor.cue === null,
		JSON.stringify({ after, afterConsole, afterFloor }),
	);
	// The contest's side of the on-target gate is headless (`onTargetMark` in
	// `tests/duel-hud.test.ts`). A browser row was built here and removed: the
	// contest's raider is beyond the laser's range, so it passed with the gate
	// deleted.
	await page.close();
}

await browser.close();
exit();
