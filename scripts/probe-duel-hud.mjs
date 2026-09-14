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
		for (
			let i = 0;
			i < 1800 && (quiet === null || firing === null || stacked === null);
			i++
		) {
			D.frame(aimed);
			const duelBox = g.floorRender?.duelBox;
			if (stacked === null && g.cockpitPrompt.text && duelBox)
				stacked = {
					prompt: { ...g.cockpitPrompt.bounds },
					text: g.cockpitPrompt.text,
					duelTop: duelBox.top,
				};
			const cue = g.cueRender;
			if (!cue?.at || !g.encounter) continue;
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
